import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AuthLoginHint, AuthResolution, AuthStrategy } from "../models/auth_resolution.model";

type SecretValue = {
  value: string;
  source: string;
};

type OpenApiAuthHints = {
  required: boolean;
  strategy: AuthStrategy;
  notes: string[];
  loginHint?: AuthLoginHint;
};

function firstProvided(value: string | undefined, source: string): SecretValue | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return { value: trimmed, source };
}

function detectAuthStrategyFromOpenApiText(text: string): AuthStrategy {
  if (/scheme:\s*bearer/i.test(text)) return "bearer";
  if (/scheme:\s*basic/i.test(text)) return "basic";
  if (/type:\s*apiKey[\s\S]{0,220}in:\s*cookie/i.test(text)) return "cookie";
  return "unknown";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathBlockContainsSecurity(text: string, endpointPath: string | undefined): boolean {
  if (!endpointPath) return false;
  const lines = text.split(/\r?\n/);
  const pathRx = new RegExp(`^\\s{2}${escapeRegExp(endpointPath)}:\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (pathRx.test(lines[i] ?? "")) {
      start = i;
      break;
    }
  }
  if (start < 0) return false;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s{2}\/[^:]+:\s*$/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  const block = lines.slice(start, end).join("\n");
  return /^\s{4,8}security:\s*$/m.test(block);
}

function globalSecurityExists(text: string): boolean {
  return /^security:\s*$/m.test(text);
}

function discoverLoginHintFromOpenApi(text: string): AuthLoginHint | undefined {
  const lines = text.split(/\r?\n/);
  const keywordRx = /(login|signin|sign-in|token|auth|authenticate|session)/i;

  let currentPath: string | undefined;
  let pathStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(/^\s{2}(\/[^:]+):\s*$/);
    if (m?.[1]) {
      currentPath = m[1];
      pathStart = i;
      continue;
    }
    if (!currentPath || pathStart < 0) continue;
    if (!/^\s{4}post:\s*$/.test(line)) continue;

    let blockEnd = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s{2}\/[^:]+:\s*$/.test(lines[j] ?? "")) {
        blockEnd = j;
        break;
      }
    }
    const blockText = lines.slice(i, blockEnd).join("\n").toLowerCase();
    const pathLooksLikeLogin = keywordRx.test(currentPath);
    const blockLooksLikeLogin =
      /password/.test(blockText) &&
      (/(username|user(name)?|login)/.test(blockText) || /email/.test(blockText));

    if (!pathLooksLikeLogin && !blockLooksLikeLogin) continue;

    const userField = /email/.test(blockText) ? "email" : "username";
    return {
      method: "POST",
      path: currentPath,
      bodyTemplate: `{"${userField}":"{{auth.username}}","password":"{{auth.password}}"}`,
    };
  }

  return undefined;
}

async function readOpenApiHints(args: {
  projectRootAbs: string;
  endpointPath: string | undefined;
  loginDiscoveryEnabled: boolean;
}): Promise<OpenApiAuthHints> {
  const candidates = [
    path.join(args.projectRootAbs, "docs", "openapi", "openapi.yaml"),
    path.join(args.projectRootAbs, "docs", "openapi", "openapi.yml"),
    path.join(args.projectRootAbs, "openapi.yaml"),
    path.join(args.projectRootAbs, "openapi.yml"),
    path.join(args.projectRootAbs, "swagger.yaml"),
    path.join(args.projectRootAbs, "swagger.yml"),
  ];

  for (const p of candidates) {
    let text = "";
    try {
      text = await fs.readFile(p, "utf8");
    } catch {
      continue;
    }

    const endpointSecurity = pathBlockContainsSecurity(text, args.endpointPath);
    const globalSecurity = globalSecurityExists(text);
    const required = endpointSecurity || globalSecurity;
    const strategy = required ? detectAuthStrategyFromOpenApiText(text) : "none";

    const notes: string[] = [];
    notes.push(`OpenAPI source: ${p}`);
    if (endpointSecurity) notes.push("Endpoint-level security found in OpenAPI.");
    if (!endpointSecurity && globalSecurity) {
      notes.push("Global OpenAPI security found.");
    }
    if (!required) notes.push("No OpenAPI security requirement found.");

    const hint: OpenApiAuthHints = {
      required,
      strategy,
      notes,
    };
    if (args.loginDiscoveryEnabled) {
      const loginHint = discoverLoginHintFromOpenApi(text);
      if (loginHint) hint.loginHint = loginHint;
    }
    return hint;
  }

  return {
    required: false,
    strategy: "unknown",
    notes: ["No OpenAPI file found for auth inference."],
  };
}

async function controllerMayRequireAuth(controllerFileAbs: string | undefined): Promise<boolean> {
  if (!controllerFileAbs) return false;
  let text = "";
  try {
    text = await fs.readFile(controllerFileAbs, "utf8");
  } catch {
    return false;
  }
  return /@(PreAuthorize|Secured|RolesAllowed|SecurityRequirement)\b/.test(text);
}

export async function resolveAuthForRecipe(args: {
  projectRootAbs: string;
  workspaceRootAbs: string;
  endpointPath: string | undefined;
  controllerFileAbs: string | undefined;
  authToken: string | undefined;
  authUsername: string | undefined;
  authPassword: string | undefined;
  loginDiscoveryEnabled: boolean;
}): Promise<AuthResolution> {
  const notes: string[] = [];
  const openapi = await readOpenApiHints({
    projectRootAbs: args.projectRootAbs,
    endpointPath: args.endpointPath,
    loginDiscoveryEnabled: args.loginDiscoveryEnabled,
  });
  notes.push(...openapi.notes);

  const controllerSecure = await controllerMayRequireAuth(args.controllerFileAbs);
  if (controllerSecure) notes.push("Controller has security annotations.");

  notes.push(
    "Automatic credential discovery is disabled; credentials must be provided explicitly.",
  );

  const required = openapi.required || controllerSecure;
  let strategy: AuthStrategy = required ? openapi.strategy : "none";
  if (required && strategy === "none") {
    strategy = "unknown";
  }

  if (!required) {
    return {
      required: false,
      status: "not_required",
      strategy: "none",
      nextAction: "No auth requirement inferred for this route.",
      notes,
    };
  }

  const token = firstProvided(args.authToken, "input.authToken");
  const username = firstProvided(args.authUsername, "input.authUsername");
  const password = firstProvided(args.authPassword, "input.authPassword");
  const loginHint = args.loginDiscoveryEnabled ? openapi.loginHint : undefined;

  if (strategy === "basic") {
    if (username && password) {
      const basic = Buffer.from(`${username.value}:${password.value}`).toString("base64");
      return {
        required: true,
        status: "auto_resolved",
        strategy: "basic",
        source: `${username.source}, ${password.source}`,
        nextAction: "Use generated Basic Authorization header in the request.",
        notes,
        requestHeaders: {
          Authorization: `Basic ${basic}`,
        },
      };
    }
    const missing: string[] = [];
    if (!username) missing.push("authUsername");
    if (!password) missing.push("authPassword");
    const resolution: AuthResolution = {
      required: true,
      status: "needs_user_input",
      strategy: "basic",
      missing,
      nextAction: "Ask user for authUsername/authPassword and rerun recipe generation.",
      notes,
    };
    if (loginHint) resolution.loginHint = loginHint;
    return resolution;
  }

  if (token) {
    const chosenStrategy = strategy === "cookie" ? "cookie" : "bearer";
    const resolution: AuthResolution = {
      required: true,
      status: "auto_resolved",
      strategy: chosenStrategy,
      source: token.source,
      nextAction:
        chosenStrategy === "cookie"
          ? "Use the provided token as cookie/session credential."
          : "Use the provided Bearer token in Authorization header.",
      notes,
    };
    if (chosenStrategy === "cookie") {
      resolution.requestHeaders = {
        Cookie: `session=${token.value}`,
      };
      return resolution;
    }
    resolution.requestHeaders = {
      Authorization: `Bearer ${token.value}`,
    };
    return resolution;
  }

  const missing: string[] = ["authToken"];
  if (!username) missing.push("authUsername");
  if (!password) missing.push("authPassword");

  const resolution: AuthResolution = {
    required: true,
    status: "needs_user_input",
    strategy: strategy === "unknown" ? "bearer" : strategy,
    missing,
    nextAction:
      "Ask user for authToken (Bearer). If unavailable, ask for authUsername/authPassword and obtain token first.",
    notes,
  };
  if (loginHint) resolution.loginHint = loginHint;
  return resolution;
}
