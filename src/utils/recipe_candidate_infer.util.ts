import * as fs from "node:fs/promises";
import * as path from "node:path";
import { inferBranchCondition } from "./recipe.util";
import { buildJavaIndex } from "../tools/java_index";
import { inferTargets } from "../tools/target_infer";
import type { RecipeCandidate, RequestInferenceSource } from "./recipe_types.util";

type ParamType = {
  name: string;
  requestName: string;
  javaType?: string;
};

type ControllerParam = ParamType & {
  source: "query" | "path" | "header" | "body" | "unknown";
};

type MethodCallContext = {
  line: number;
  contextLines: string[];
  argNames: string[];
  enclosingMethodName?: string;
};

export type ControllerRequestMatch = {
  recipe?: RecipeCandidate;
  requestSource?: RequestInferenceSource;
  matchedControllerFile?: string;
  matchedBranchCondition?: string;
  matchedRootAbs?: string;
};

type CallerMethodCandidate = {
  methodName: string;
  fileAbs: string;
  score: number;
};

function sampleValueForType(javaType?: string): string {
  const t = (javaType ?? "").toLowerCase();
  if (t.includes("double") || t.includes("float") || t.includes("bigdecimal")) return "1000";
  if (t.includes("int") || t.includes("long")) return "1";
  if (t.includes("bool")) return "true";
  return "value";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getJavaMethodRx(): RegExp {
  return /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|protected|private|static|final|synchronized|native|abstract|strictfp|default|\s)+[A-Za-z_$][A-Za-z0-9_$<>\[\],.? ]*\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^;]*\)\s*(?:\{|throws\b)/;
}

function findEnclosingMethodStartLine(lines: string[], startLineIndex: number): number | undefined {
  const methodRx = getJavaMethodRx();
  const begin = Math.max(0, startLineIndex - 80);
  for (let i = startLineIndex; i >= begin; i--) {
    if (methodRx.test(lines[i] ?? "")) return i;
  }
  return undefined;
}

function findEnclosingMethodName(lines: string[], startLineIndex: number): string | undefined {
  const line = findEnclosingMethodStartLine(lines, startLineIndex);
  if (typeof line !== "number") return undefined;
  const m = lines[line]!.match(getJavaMethodRx());
  return m?.[1];
}

function findMethodCallContext(text: string, methodName: string): MethodCallContext | null {
  const lines = text.split(/\r?\n/);
  const rx = new RegExp(`\\b${escapeRegExp(methodName)}\\s*\\(([^)]*)\\)`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(rx);
    if (!m) continue;
    const start = Math.max(0, i - 6);
    const end = Math.min(lines.length - 1, i + 2);
    const rawArgs = (m[1] ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter((a) => !!a);
    const argNames = rawArgs
      .map((a) => a.match(/([A-Za-z_][A-Za-z0-9_]*)$/)?.[1])
      .filter((a): a is string => typeof a === "string");
    const out: MethodCallContext = {
      line: i + 1,
      contextLines: lines.slice(start, end + 1),
      argNames,
    };
    const enclosingMethodName = findEnclosingMethodName(lines, i);
    if (enclosingMethodName) out.enclosingMethodName = enclosingMethodName;
    return out;
  }
  return null;
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function joinHttpPaths(base: string, sub: string): string {
  const b = normalizePath(base);
  const s = sub.trim();
  if (!s) return b;
  const cleanSub = s.startsWith("/") ? s : `/${s}`;
  const joined = `${b === "/" ? "" : b}${cleanSub}`;
  return joined || "/";
}

function extractAnnotationPath(annotationArgs: string): string | undefined {
  const named = annotationArgs.match(/\b(?:path|value)\s*=\s*"([^"]*)"/);
  if (named?.[1]) return named[1];
  const firstLiteral = annotationArgs.match(/"([^"]*)"/);
  if (firstLiteral?.[1]) return firstLiteral[1];
  return undefined;
}

function extractClassAnnotationBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const classLine = lines.findIndex((line) =>
    /\b(?:class|interface|enum|record)\s+[A-Za-z_$][A-Za-z0-9_$]*/.test(line),
  );
  if (classLine <= 0) return "";

  const collected: string[] = [];
  for (let i = classLine - 1; i >= Math.max(0, classLine - 24); i--) {
    const trimmed = (lines[i] ?? "").trim();
    if (!trimmed) break;
    if (
      trimmed.startsWith("@") ||
      trimmed.startsWith(")") ||
      trimmed.startsWith("(") ||
      trimmed.startsWith(",") ||
      trimmed.startsWith("value") ||
      trimmed.startsWith("path")
    ) {
      collected.unshift(trimmed);
      continue;
    }
    break;
  }
  return collected.join(" ");
}

function inferClassBasePathWithJaxRs(text: string): string {
  const classAnnotations = extractClassAnnotationBlock(text);
  const springReq = classAnnotations.match(/@RequestMapping\s*\(([\s\S]*?)\)/);
  if (springReq?.[1]) {
    return normalizePath(extractAnnotationPath(springReq[1]) ?? "/");
  }
  const jaxPath = classAnnotations.match(/@(?:[A-Za-z_][A-Za-z0-9_$.]*\.)?Path\s*\(([\s\S]*?)\)/);
  if (jaxPath?.[1]) {
    return normalizePath(extractAnnotationPath(jaxPath[1]) ?? "/");
  }
  return "/";
}

function parseEndpointFromAnnotationBlock(
  annotationBlock: string,
  classBase: string,
): { method: RecipeCandidate["method"]; path: string; source: RequestInferenceSource } | null {
  const directMappings: Array<{ rx: RegExp; method: RecipeCandidate["method"] }> = [
    { rx: /@GetMapping(?:\(([\s\S]*?)\))?/, method: "GET" },
    { rx: /@PostMapping(?:\(([\s\S]*?)\))?/, method: "POST" },
    { rx: /@PutMapping(?:\(([\s\S]*?)\))?/, method: "PUT" },
    { rx: /@PatchMapping(?:\(([\s\S]*?)\))?/, method: "PATCH" },
    { rx: /@DeleteMapping(?:\(([\s\S]*?)\))?/, method: "DELETE" },
  ];

  for (const m of directMappings) {
    const found = annotationBlock.match(m.rx);
    if (!found) continue;
    const subPath = extractAnnotationPath(found[1] ?? "") ?? "";
    return {
      method: m.method,
      path: joinHttpPaths(classBase, subPath),
      source: "spring_mvc",
    };
  }

  const reqMapping = annotationBlock.match(/@RequestMapping(?:\(([\s\S]*?)\))?/);
  if (reqMapping) {
    const args = reqMapping[1] ?? "";
    const method = args.match(/RequestMethod\.(GET|POST|PUT|PATCH|DELETE)/)?.[1] as
      | RecipeCandidate["method"]
      | undefined;
    const subPath = extractAnnotationPath(args) ?? "";
    if (method) {
      return {
        method,
        path: joinHttpPaths(classBase, subPath),
        source: "spring_mvc",
      };
    }
  }

  const jaxrsMappings: Array<{ rx: RegExp; method: RecipeCandidate["method"] }> = [
    { rx: /@(?:[A-Za-z_][A-Za-z0-9_$.]*\.)?GET\b/, method: "GET" },
    { rx: /@(?:[A-Za-z_][A-Za-z0-9_$.]*\.)?POST\b/, method: "POST" },
    { rx: /@(?:[A-Za-z_][A-Za-z0-9_$.]*\.)?PUT\b/, method: "PUT" },
    { rx: /@(?:[A-Za-z_][A-Za-z0-9_$.]*\.)?PATCH\b/, method: "PATCH" },
    { rx: /@(?:[A-Za-z_][A-Za-z0-9_$.]*\.)?DELETE\b/, method: "DELETE" },
  ];
  for (const m of jaxrsMappings) {
    if (!m.rx.test(annotationBlock)) continue;
    const jaxPath = annotationBlock.match(/@(?:[A-Za-z_][A-Za-z0-9_$.]*\.)?Path\s*\(([\s\S]*?)\)/);
    const subPath = jaxPath?.[1] ? extractAnnotationPath(jaxPath[1]) ?? "" : "";
    return {
      method: m.method,
      path: joinHttpPaths(classBase, subPath),
      source: "jaxrs",
    };
  }

  return null;
}

function collectMethodAnnotationBlock(lines: string[], methodLineIndex: number): string {
  const collected: string[] = [];
  const start = Math.max(0, methodLineIndex - 18);
  for (let i = methodLineIndex - 1; i >= start; i--) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) break;
    if (
      trimmed.startsWith("@") ||
      trimmed.startsWith(")") ||
      trimmed.startsWith("(") ||
      trimmed.startsWith(",") ||
      trimmed.startsWith("value") ||
      trimmed.startsWith("path") ||
      trimmed.includes("RequestMethod.")
    ) {
      collected.unshift(trimmed);
      continue;
    }
    break;
  }
  return collected.join(" ");
}

function inferEndpointMappingForCall(
  text: string,
  callLine: number,
): { method: RecipeCandidate["method"]; path: string; source: RequestInferenceSource } | null {
  const lines = text.split(/\r?\n/);
  const methodLineIndex =
    findEnclosingMethodStartLine(lines, Math.max(0, callLine - 1)) ?? Math.max(0, callLine - 1);
  const annotationBlock = collectMethodAnnotationBlock(lines, methodLineIndex);
  const classBase = inferClassBasePathWithJaxRs(text);
  return parseEndpointFromAnnotationBlock(annotationBlock, classBase);
}

function extractImplementedInterfaces(text: string): string[] {
  const classDecl = text.match(/\bclass\b[\s\S]*?\{/);
  const decl = classDecl?.[0] ?? "";
  const impl = decl.match(/\bimplements\s+([^{]+)/);
  if (!impl?.[1]) return [];
  return impl[1]
    .split(",")
    .map((v) => v.trim())
    .map((v) => v.replace(/<[^>]+>/g, ""))
    .map((v) => v.split(".").pop() ?? v)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function findMethodDeclarationLine(lines: string[], methodName: string): number | undefined {
  const rx = new RegExp(`\\b${escapeRegExp(methodName)}\\s*\\(`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!rx.test(line)) continue;
    const trimmed = line.trim();
    if (
      trimmed.startsWith("@") ||
      trimmed.startsWith("if ") ||
      trimmed.startsWith("for ") ||
      trimmed.startsWith("while ") ||
      trimmed.startsWith("switch ")
    ) {
      continue;
    }
    return i;
  }
  return undefined;
}

async function findJavaTypeFile(
  searchRootsAbs: string[],
  typeName: string,
): Promise<string | undefined> {
  for (const rootAbs of searchRootsAbs) {
    const index = await buildJavaIndex({
      rootAbs,
      classHint: typeName,
      maxFiles: 3500,
    });
    const exact = index.find((e) => e.className === typeName);
    if (exact?.fileAbs) return exact.fileAbs;
  }
  return undefined;
}

async function inferEndpointMappingFromInterface(args: {
  controllerText: string;
  controllerMethodName?: string;
  searchRootsAbs: string[];
}): Promise<{ method: RecipeCandidate["method"]; path: string; source: RequestInferenceSource } | null> {
  if (!args.controllerMethodName) return null;
  const interfaceNames = extractImplementedInterfaces(args.controllerText);
  if (interfaceNames.length === 0) return null;

  for (const interfaceName of interfaceNames) {
    const fileAbs = await findJavaTypeFile(args.searchRootsAbs, interfaceName);
    if (!fileAbs) continue;
    let text = "";
    try {
      text = await fs.readFile(fileAbs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const methodLine = findMethodDeclarationLine(lines, args.controllerMethodName);
    if (typeof methodLine !== "number") continue;
    const annotationBlock = collectMethodAnnotationBlock(lines, methodLine);
    const classBase = inferClassBasePathWithJaxRs(text);
    const mapped = parseEndpointFromAnnotationBlock(annotationBlock, classBase);
    if (mapped) return mapped;
  }
  return null;
}

function parseRequestParamsFromController(text: string): ParamType[] {
  const out: ParamType[] = [];
  const rx =
    /@(RequestParam|QueryParam)(?:\s*\(\s*([^)]*)\s*\))?\s*(?:final\s+)?([A-Za-z0-9_<>\[\].?]+)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const annotationArgs = m[2];
    const javaType = m[3];
    const name = m[4];
    if (!name) continue;
    if (out.some((p) => p.name === name)) continue;
    let requestName = name;
    if (annotationArgs) {
      const named = annotationArgs.match(/\b(?:name|value)\s*=\s*"([^"]+)"/);
      const bare = annotationArgs.match(/"([^"]+)"/);
      if (named?.[1]) {
        requestName = named[1];
      } else if (bare?.[1]) {
        requestName = bare[1];
      }
    }
    const entry: ParamType = { name, requestName };
    if (javaType) entry.javaType = javaType;
    out.push(entry);
  }
  return out;
}

function extractNamedValueFromAnnotationArgs(annotationArgs?: string): string | undefined {
  if (!annotationArgs) return undefined;
  const named = annotationArgs.match(/\b(?:name|value)\s*=\s*"([^"]+)"/);
  if (named?.[1]) return named[1];
  const bare = annotationArgs.match(/"([^"]+)"/);
  if (bare?.[1]) return bare[1];
  return undefined;
}

function parseControllerMethodParams(text: string, callLine: number): ControllerParam[] {
  const lines = text.split(/\r?\n/);
  const methodLineIndex =
    findEnclosingMethodStartLine(lines, Math.max(0, callLine - 1)) ?? Math.max(0, callLine - 1);
  if (methodLineIndex < 0 || methodLineIndex >= lines.length) return [];

  const chunks: string[] = [];
  let parenDepth = 0;
  let seenOpenParen = false;
  for (let i = methodLineIndex; i < Math.min(lines.length, methodLineIndex + 24); i++) {
    const line = lines[i] ?? "";
    if (!seenOpenParen && !line.includes("(")) continue;
    chunks.push(line.trim());
    for (const ch of line) {
      if (ch === "(") {
        parenDepth += 1;
        seenOpenParen = true;
        continue;
      }
      if (ch === ")" && parenDepth > 0) {
        parenDepth -= 1;
      }
    }
    if (seenOpenParen && parenDepth === 0) break;
  }
  const signature = chunks.join(" ");
  const openIdx = signature.indexOf("(");
  const closeIdx = signature.lastIndexOf(")");
  if (openIdx < 0 || closeIdx <= openIdx) return [];
  const inside = signature.slice(openIdx + 1, closeIdx).trim();
  if (!inside) return [];

  const rawParams = inside
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const out: ControllerParam[] = [];
  for (const rawParam of rawParams) {
    const annotationPairs: Array<{ name: string; args?: string }> = [];
    const annotationRx = /@([A-Za-z_][A-Za-z0-9_$.]*)(?:\s*\(([^)]*)\))?/g;
    let ann: RegExpExecArray | null;
    while ((ann = annotationRx.exec(rawParam)) !== null) {
      if (!ann[1]) continue;
      if (typeof ann[2] === "string") {
        annotationPairs.push({ name: ann[1], args: ann[2] });
      } else {
        annotationPairs.push({ name: ann[1] });
      }
    }

    const withoutAnnotations = rawParam
      .replace(/@[A-Za-z_][A-Za-z0-9_$.]*(?:\s*\([^)]*\))?\s*/g, "")
      .trim();
    const cleaned = withoutAnnotations
      .replace(/\bfinal\b/g, "")
      .replace(/\bvolatile\b/g, "")
      .trim();
    const m = cleaned.match(/([A-Za-z0-9_<>\[\].?]+)\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!m?.[2]) continue;
    const javaType = m[1];
    const name = m[2];

    let source: ControllerParam["source"] = "unknown";
    let requestName = name;

    for (const pair of annotationPairs) {
      const annName = pair.name.split(".").pop() ?? pair.name;
      if (annName === "RequestParam") {
        source = "query";
        requestName = extractNamedValueFromAnnotationArgs(pair.args) ?? requestName;
        break;
      }
      if (annName === "QueryParam") {
        source = "query";
        requestName = extractNamedValueFromAnnotationArgs(pair.args) ?? requestName;
        break;
      }
      if (annName === "PathVariable") {
        source = "path";
        requestName = extractNamedValueFromAnnotationArgs(pair.args) ?? requestName;
        break;
      }
      if (annName === "PathParam") {
        source = "path";
        requestName = extractNamedValueFromAnnotationArgs(pair.args) ?? requestName;
        break;
      }
      if (annName === "RequestHeader") {
        source = "header";
        requestName = extractNamedValueFromAnnotationArgs(pair.args) ?? requestName;
        break;
      }
      if (annName === "HeaderParam") {
        source = "header";
        requestName = extractNamedValueFromAnnotationArgs(pair.args) ?? requestName;
        break;
      }
      if (annName === "RequestBody") {
        source = "body";
        break;
      }
    }

    const param: ControllerParam = {
      name,
      requestName,
      source,
      ...(javaType ? { javaType } : {}),
    };
    out.push(param);
  }

  return out;
}

function sampleBodyForType(javaType?: string): string {
  const t = (javaType ?? "").toLowerCase();
  if (!t) return '{"example":"value"}';
  if (t.includes("jsonnode") || t.includes("objectnode") || t.includes("map")) {
    return '{"Notification_Email_Preferences":{"Email_Notifications":true}}';
  }
  if (t.includes("string")) return '"value"';
  if (t.includes("int") || t.includes("long") || t.includes("double") || t.includes("float"))
    return "1";
  if (t.includes("bool")) return "true";
  return '{"example":"value"}';
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, i, arr) => !!value && arr.indexOf(value) === i);
}

function normalizeOperationId(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, "");
}

async function findOpenApiOperationByOperationIds(args: {
  searchRootsAbs: string[];
  operationIds: string[];
}): Promise<{ method: RecipeCandidate["method"]; path: string } | null> {
  const operationIdSet = new Set(
    args.operationIds.map((v) => normalizeOperationId(v)).filter((v) => v.length > 0),
  );
  if (operationIdSet.size === 0) return null;

  for (const rootAbs of args.searchRootsAbs) {
    const candidates = [
      path.join(rootAbs, "docs", "openapi", "openapi.yaml"),
      path.join(rootAbs, "docs", "openapi", "openapi.yml"),
      path.join(rootAbs, "openapi.yaml"),
      path.join(rootAbs, "openapi.yml"),
      path.join(rootAbs, "swagger.yaml"),
      path.join(rootAbs, "swagger.yml"),
    ];

    for (const fileAbs of candidates) {
      let text = "";
      try {
        text = await fs.readFile(fileAbs, "utf8");
      } catch {
        continue;
      }

      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const m = line.match(/^\s*operationId:\s*([^\s#]+)\s*$/);
        const opId = m?.[1] ? normalizeOperationId(m[1]) : "";
        if (!opId || !operationIdSet.has(opId)) continue;

        let method: RecipeCandidate["method"] | undefined;
        let pathValue: string | undefined;
        for (let j = i; j >= 0; j--) {
          const l = lines[j] ?? "";
          const methodMatch = l.match(/^\s{4}(get|post|put|patch|delete):\s*$/i);
          if (!method && methodMatch?.[1]) {
            method = methodMatch[1].toUpperCase() as RecipeCandidate["method"];
          }
          const pathMatch = l.match(/^\s{2}(\/[^:]+):\s*$/);
          if (pathMatch?.[1]) {
            pathValue = pathMatch[1];
            break;
          }
        }
        if (method && pathValue) {
          return { method, path: pathValue };
        }
      }
    }
  }

  return null;
}

function scoreCallerFile(fileAbs: string, className?: string): number {
  let score = 0;
  const lowerFile = fileAbs.toLowerCase();
  const lowerClass = (className ?? "").toLowerCase();
  if (lowerFile.includes(`${path.sep}service${path.sep}`)) score += 4;
  if (lowerClass.includes("service")) score += 2;
  if (lowerFile.includes(`${path.sep}controller${path.sep}`)) score -= 2;
  return score;
}

function findCallerMethodsForCallee(args: {
  index: Array<{ fileAbs: string; className?: string; text: string }>;
  calleeMethodName: string;
  controllerSet: Set<string>;
}): CallerMethodCandidate[] {
  const out: CallerMethodCandidate[] = [];
  for (const entry of args.index) {
    if (args.controllerSet.has(entry.fileAbs)) continue;
    if (entry.fileAbs.includes(`${path.sep}src${path.sep}test${path.sep}`)) continue;
    const call = findMethodCallContext(entry.text, args.calleeMethodName);
    if (!call?.enclosingMethodName) continue;
    out.push({
      methodName: call.enclosingMethodName,
      fileAbs: entry.fileAbs,
      score: scoreCallerFile(entry.fileAbs, entry.className),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function buildSearchRoots(rootAbs: string, workspaceRootAbs: string): string[] {
  const roots: string[] = [rootAbs];
  const normalizedRoot = path.resolve(rootAbs);
  const baseName = path.basename(normalizedRoot).toLowerCase();

  if (baseName.endsWith("-core")) {
    const parent = path.dirname(normalizedRoot);
    if (parent && parent !== normalizedRoot) roots.push(parent);
  }

  const normalizedWorkspace = path.resolve(workspaceRootAbs);
  if (normalizedRoot === normalizedWorkspace) {
    roots.push(normalizedWorkspace);
  }
  return uniqueStrings(roots.map((r) => path.resolve(r)));
}

async function findOpenApiPathHint(
  searchRootsAbs: string[],
  paramName: string,
): Promise<string | null> {
  for (const rootAbs of searchRootsAbs) {
    const candidates = [
      path.join(rootAbs, "docs", "openapi", "openapi.yaml"),
      path.join(rootAbs, "docs", "openapi", "openapi.yml"),
      path.join(rootAbs, "openapi.yaml"),
      path.join(rootAbs, "openapi.yml"),
      path.join(rootAbs, "swagger.yaml"),
      path.join(rootAbs, "swagger.yml"),
    ];
    for (const p of candidates) {
      let text = "";
      try {
        text = await fs.readFile(p, "utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]!.includes(`name: ${paramName}`)) continue;
        for (let j = i; j >= 0; j--) {
          const line = lines[j]!;
          const m = line.match(/^\s{2}(\/[^:]+):\s*$/);
          if (m?.[1]) return m[1];
        }
      }
    }
  }
  return null;
}

async function buildRecipeCandidate(args: {
  text: string;
  call: MethodCallContext;
  methodNameForRationale: string;
  searchRootsAbs: string[];
}): Promise<{
  recipe?: RecipeCandidate;
  branchCondition?: string;
  requestSource?: RequestInferenceSource;
}> {
  const controllerMethodParams = parseControllerMethodParams(args.text, args.call.line);
  const legacyRequestParams = parseRequestParamsFromController(args.text);
  const endpointMapping =
    inferEndpointMappingForCall(args.text, args.call.line) ??
    (await inferEndpointMappingFromInterface({
      controllerText: args.text,
      ...(args.call.enclosingMethodName
        ? { controllerMethodName: args.call.enclosingMethodName }
        : {}),
      searchRootsAbs: args.searchRootsAbs,
    }));
  const endpoint = endpointMapping?.path ?? inferClassBasePathWithJaxRs(args.text);
  const openApiOperationHints = uniqueStrings([
    args.call.enclosingMethodName ?? "",
    (args.methodNameForRationale.split("(")[0] ?? "").split(" ").at(-1) ?? "",
  ]);
  const openApiOperation = await findOpenApiOperationByOperationIds({
    searchRootsAbs: args.searchRootsAbs,
    operationIds: openApiOperationHints,
  });

  const mappedParams = args.call.argNames
    .map((argName) => controllerMethodParams.find((p) => p.name === argName))
    .filter((p): p is ControllerParam => typeof p !== "undefined");
  const queryMappedParams = mappedParams.filter((p) => p.source === "query");
  const pathMappedParams = mappedParams.filter((p) => p.source === "path");
  const legacyMatchedParams = args.call.argNames
    .map((argName) => legacyRequestParams.find((p) => p.name === argName))
    .filter((p): p is ParamType => typeof p !== "undefined");
  const requestParamName =
    queryMappedParams[0]?.requestName ??
    legacyMatchedParams[0]?.requestName ??
    pathMappedParams[0]?.requestName;
  const requestParamType =
    queryMappedParams[0]?.javaType ?? legacyMatchedParams[0]?.javaType ?? pathMappedParams[0]?.javaType;

  const queryParts: string[] = [];
  const queryNameSet = new Set<string>();
  for (const queryParam of queryMappedParams) {
    const qName = queryParam.requestName || queryParam.name;
    if (queryNameSet.has(qName)) continue;
    queryNameSet.add(qName);
    queryParts.push(`${qName}=${sampleValueForType(queryParam.javaType)}`);
  }
  if (queryParts.length === 0 && requestParamName) {
    queryParts.push(`${requestParamName}=${sampleValueForType(requestParamType)}`);
  }
  if (controllerMethodParams.some((p) => p.name === "page" && p.source === "query"))
    queryParts.push("page=0");
  if (controllerMethodParams.some((p) => p.name === "size" && p.source === "query"))
    queryParts.push("size=1");

  let pathHint = endpoint;
  for (const pathParam of pathMappedParams) {
    const requestName = pathParam.requestName || pathParam.name;
    const pathParamValue = sampleValueForType(pathParam.javaType);
    const withRequestName = pathHint.replace(
      new RegExp(`\\{${escapeRegExp(requestName)}\\}`, "g"),
      pathParamValue,
    );
    pathHint = withRequestName.replace(
      new RegExp(`\\{${escapeRegExp(pathParam.name)}\\}`, "g"),
      pathParamValue,
    );
    pathHint = pathHint.replace(
      new RegExp(`\\:${escapeRegExp(requestName)}\\b`, "g"),
      pathParamValue,
    );
    pathHint = pathHint.replace(new RegExp(`\\:${escapeRegExp(pathParam.name)}\\b`, "g"), pathParamValue);
  }

  const ctx = args.call.contextLines.join("\n");
  if (/else\s+if\s*\(\s*maxPrice\s*!=\s*null/.test(ctx) && /minPrice/.test(ctx)) {
    queryParts.push("minPrice=<omit>");
  }
  const branchCondition = inferBranchCondition(args.call.contextLines);

  const openapiPath = requestParamName
    ? await findOpenApiPathHint(args.searchRootsAbs, requestParamName)
    : null;
  let method: RecipeCandidate["method"] = endpointMapping?.method ?? "GET";
  let requestSource: RequestInferenceSource | undefined = endpointMapping?.source;
  // OpenAPI is authoritative when available to avoid context/base-path drift.
  if (openApiOperation) {
    pathHint = openApiOperation.path;
    method = openApiOperation.method;
    requestSource = "openapi";
  } else if (openapiPath) {
    pathHint = openapiPath;
    requestSource = "openapi";
  }

  // Avoid emitting fake "GET /" routes; treat unresolved entrypoint as no candidate.
  const routeResolved =
    Boolean(endpointMapping) || Boolean(openapiPath) || Boolean(openApiOperation);
  if (!routeResolved && pathHint === "/") {
    const out: {
      recipe?: RecipeCandidate;
      branchCondition?: string;
      requestSource?: RequestInferenceSource;
    } = {};
    if (branchCondition) out.branchCondition = branchCondition;
    if (requestSource) out.requestSource = requestSource;
    return out;
  }

  const filteredQuery = queryParts.filter((q) => !q.endsWith("<omit>"));
  const fullUrlHint =
    filteredQuery.length > 0 ? `${pathHint}?${filteredQuery.join("&")}` : pathHint;
  const bodyParam = mappedParams.find((p) => p.source === "body") ?? controllerMethodParams.find((p) => p.source === "body");
  let confidence = 0.65;
  const assumptions: string[] = [];
  const needsConfirmation: string[] = [];
  if (openApiOperation) {
    confidence = 0.95;
  } else if (endpointMapping) {
    confidence = 0.82;
  } else if (openapiPath) {
    confidence = 0.75;
    assumptions.push("Path inferred from OpenAPI parameter usage; confirm endpoint method/path.");
    needsConfirmation.push("Confirm HTTP method/path against controller mapping.");
  } else {
    assumptions.push("Method/path inferred from static code patterns.");
    needsConfirmation.push("Confirm endpoint mapping before execution.");
  }
  const out: {
    recipe?: RecipeCandidate;
    branchCondition?: string;
    requestSource?: RequestInferenceSource;
  } = {
    recipe: {
      method,
      path: pathHint,
      queryTemplate: queryParts.join("&"),
      fullUrlHint,
      ...(bodyParam ? { bodyTemplate: sampleBodyForType(bodyParam.javaType) } : {}),
      confidence,
      ...(assumptions.length > 0 ? { assumptions } : {}),
      ...(needsConfirmation.length > 0 ? { needsConfirmation } : {}),
      rationale: [
        `Controller call matched: ${args.methodNameForRationale}`,
        `Inferred endpoint path: ${pathHint}`,
        ...(openApiOperation ? ["Endpoint source: OpenAPI operationId match (preferred)."] : []),
        ...(!openApiOperation && requestSource ? [`Endpoint source: ${requestSource}.`] : []),
        `Inferred request param: ${
          requestParamName ?? (bodyParam ? `${bodyParam.name} (request body)` : "(unknown)")
        }`,
        ...(branchCondition ? [`Branch condition context: ${branchCondition}`] : []),
      ],
    },
  };
  if (branchCondition) out.branchCondition = branchCondition;
  if (requestSource) out.requestSource = requestSource;
  return out;
}

async function buildBestEffortCandidateFromControllerDeclaration(args: {
  controllerFileAbs: string;
  methodHint: string;
  searchRootsAbs: string[];
}): Promise<ControllerRequestMatch> {
  let text = "";
  try {
    text = await fs.readFile(args.controllerFileAbs, "utf8");
  } catch {
    return {};
  }
  const lines = text.split(/\r?\n/);
  const methodLine = findMethodDeclarationLine(lines, args.methodHint);
  if (typeof methodLine !== "number") return {};

  const params = parseControllerMethodParams(text, methodLine + 1);
  const pseudoCall: MethodCallContext = {
    line: methodLine + 1,
    contextLines: lines.slice(Math.max(0, methodLine - 3), Math.min(lines.length, methodLine + 3)),
    argNames: params.map((p) => p.name),
    enclosingMethodName: args.methodHint,
  };
  const built = await buildRecipeCandidate({
    text,
    call: pseudoCall,
    methodNameForRationale: `${args.methodHint}(...) [best-effort controller declaration]`,
    searchRootsAbs: args.searchRootsAbs,
  });
  if (!built.recipe) return {};

  const updated: RecipeCandidate = {
    ...built.recipe,
    confidence: Math.min(built.recipe.confidence ?? 0.8, 0.78),
    assumptions: [
      ...(built.recipe.assumptions ?? []),
      "Controller declaration mapping is used as a best-effort fallback when full call-chain mapping is incomplete.",
    ],
    needsConfirmation: [
      ...(built.recipe.needsConfirmation ?? []),
      "Best-effort candidate from controller declaration; confirm mapping/auth before execution.",
    ],
  };
  return {
    recipe: updated,
    requestSource: "controller_declaration_fallback",
    matchedControllerFile: args.controllerFileAbs,
    ...(built.branchCondition ? { matchedBranchCondition: built.branchCondition } : {}),
  };
}

export async function findControllerRequestCandidate(args: {
  searchRootsAbs: string[];
  methodHint: string;
  inferredTargetFileAbs?: string;
}): Promise<ControllerRequestMatch> {
  const operationIdHints = new Set<string>([args.methodHint]);
  const schemaFirst = await findOpenApiOperationByOperationIds({
    searchRootsAbs: args.searchRootsAbs,
    operationIds: [args.methodHint],
  });
  if (schemaFirst) {
    const bodyTemplate =
      schemaFirst.method === "GET" || schemaFirst.method === "DELETE"
        ? undefined
        : '{"example":"value"}';
    return {
      recipe: {
        method: schemaFirst.method,
        path: schemaFirst.path,
        queryTemplate: "",
        fullUrlHint: schemaFirst.path,
        ...(bodyTemplate ? { bodyTemplate } : {}),
        confidence: 0.95,
        rationale: [
          `Resolved endpoint from local OpenAPI schema first (operationId hint: ${args.methodHint}).`,
          "Controller lookup is used as fallback when OpenAPI mapping is unavailable.",
        ],
      },
      requestSource: "openapi",
    };
  }

  if (args.inferredTargetFileAbs && /controller/i.test(path.basename(args.inferredTargetFileAbs))) {
    const bestEffort = await buildBestEffortCandidateFromControllerDeclaration({
      controllerFileAbs: args.inferredTargetFileAbs,
      methodHint: args.methodHint,
      searchRootsAbs: args.searchRootsAbs,
    });
    if (bestEffort.recipe) {
      return bestEffort;
    }
  }

  for (const rootAbs of args.searchRootsAbs) {
    const controllerFiles = await inferTargets({
      rootAbs,
      classHint: "Controller",
      maxCandidates: 120,
    });
    const inferredControllers = controllerFiles.candidates
      .map((c) => c.file)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 120);
    const chosenControllers = [...inferredControllers];
    if (chosenControllers.length === 0) {
      const rawIndex = await buildJavaIndex({
        rootAbs,
        classHint: "Controller",
        maxFiles: 2500,
      });
      for (const entry of rawIndex) {
        const base = path.basename(entry.fileAbs).toLowerCase();
        const className = (entry.className ?? "").toLowerCase();
        if (!base.includes("controller") && !className.includes("controller")) continue;
        if (chosenControllers.includes(entry.fileAbs)) continue;
        chosenControllers.push(entry.fileAbs);
        if (chosenControllers.length >= 120) break;
      }
    }
    const controllerSet = new Set(chosenControllers);

    for (const file of chosenControllers) {
      const declarationFirst = await buildBestEffortCandidateFromControllerDeclaration({
        controllerFileAbs: file,
        methodHint: args.methodHint,
        searchRootsAbs: [rootAbs, ...args.searchRootsAbs],
      });
      if (declarationFirst.recipe) {
        const out: ControllerRequestMatch = {
          ...declarationFirst,
          matchedRootAbs: rootAbs,
        };
        return out;
      }

      let text = "";
      try {
        text = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      const directCall = findMethodCallContext(text, args.methodHint);
      if (!directCall) continue;
      const built = await buildRecipeCandidate({
        text,
        call: directCall,
        methodNameForRationale: `${args.methodHint}(${directCall.argNames.join(", ") || "?"})`,
        searchRootsAbs: [rootAbs, ...args.searchRootsAbs],
      });
      if (!built.recipe) continue;
      const out: ControllerRequestMatch = {
        recipe: built.recipe,
        ...(built.requestSource ? { requestSource: built.requestSource } : {}),
        matchedControllerFile: file,
        matchedRootAbs: rootAbs,
      };
      if (built.branchCondition) out.matchedBranchCondition = built.branchCondition;
      return out;
    }

    const index = await buildJavaIndex({ rootAbs, maxFiles: 2500 });
    const methodQueue: Array<{ methodName: string; depth: number; chain: string[] }> = [
      { methodName: args.methodHint, depth: 0, chain: [args.methodHint] },
    ];
    const seenMethodDepth = new Set<string>([`0:${args.methodHint}`]);
    const intermediateCandidates: Array<{
      methodName: string;
      chain: string[];
      callerFileAbs: string;
      score: number;
    }> = [];

    while (methodQueue.length > 0) {
      const current = methodQueue.shift()!;
      if (current.depth >= 2) continue;

      const callers = findCallerMethodsForCallee({
        index,
        calleeMethodName: current.methodName,
        controllerSet,
      }).slice(0, 16);

      for (const caller of callers) {
        operationIdHints.add(caller.methodName);
        const chain = [caller.methodName, ...current.chain];
        intermediateCandidates.push({
          methodName: caller.methodName,
          chain,
          callerFileAbs: caller.fileAbs,
          score: caller.score,
        });

        const nextDepth = current.depth + 1;
        const seenKey = `${nextDepth}:${caller.methodName}`;
        if (seenMethodDepth.has(seenKey)) continue;
        seenMethodDepth.add(seenKey);
        methodQueue.push({
          methodName: caller.methodName,
          depth: nextDepth,
          chain,
        });
      }
    }

    intermediateCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.chain.length - b.chain.length;
    });

    for (const candidate of intermediateCandidates) {
      for (const file of chosenControllers) {
        let text = "";
        try {
          text = await fs.readFile(file, "utf8");
        } catch {
          continue;
        }
        const indirectCall = findMethodCallContext(text, candidate.methodName);
        if (!indirectCall) continue;
        const chainRationale = `${candidate.chain.join("(...) -> ")}(...)`;
        const built = await buildRecipeCandidate({
          text,
          call: indirectCall,
          methodNameForRationale: `${chainRationale} [via ${path.basename(candidate.callerFileAbs)}]`,
          searchRootsAbs: [rootAbs, ...args.searchRootsAbs],
        });
        if (!built.recipe) continue;
        const out: ControllerRequestMatch = {
          recipe: built.recipe,
          ...(built.requestSource ? { requestSource: built.requestSource } : {}),
          matchedControllerFile: file,
          matchedRootAbs: rootAbs,
        };
        if (built.branchCondition) out.matchedBranchCondition = built.branchCondition;
        return out;
      }
    }

    for (const file of chosenControllers) {
      const bestEffort = await buildBestEffortCandidateFromControllerDeclaration({
        controllerFileAbs: file,
        methodHint: args.methodHint,
        searchRootsAbs: [rootAbs, ...args.searchRootsAbs],
      });
      if (!bestEffort.recipe) continue;
      const out: ControllerRequestMatch = {
        ...bestEffort,
        matchedRootAbs: rootAbs,
      };
      return out;
    }
  }

  const openApiFallback = await findOpenApiOperationByOperationIds({
    searchRootsAbs: args.searchRootsAbs,
    operationIds: Array.from(operationIdHints),
  });
  if (openApiFallback) {
    const bodyTemplate =
      openApiFallback.method === "GET" || openApiFallback.method === "DELETE"
        ? undefined
        : '{"example":"value"}';
    return {
      recipe: {
        method: openApiFallback.method,
        path: openApiFallback.path,
        queryTemplate: "",
        fullUrlHint: openApiFallback.path,
        ...(bodyTemplate ? { bodyTemplate } : {}),
        confidence: 0.9,
        needsConfirmation: ["Resolved via OpenAPI fallback after controller chain ambiguity."],
        rationale: [
          `Recovered endpoint from OpenAPI operationId hint(s): ${Array.from(operationIdHints).join(", ")}`,
          "Controller-to-target call chain was ambiguous in static analysis.",
        ],
      },
      requestSource: "openapi",
    };
  }

  return {};
}
