import * as path from "node:path";
import { buildJavaIndex } from "./java_index";

export type InferredTarget = {
  file: string;
  className?: string;
  methodName?: string;
  line?: number;
  signature?: string;
  returnsBoolean?: boolean;
  fqcn?: string;
  key?: string;
  confidence: number;
  reasons: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferReturnsBoolean(signature: string, methodName: string): boolean {
  const rx = new RegExp(
    `\\b(?:boolean|Boolean|java\\.lang\\.Boolean)\\s+${escapeRegExp(methodName)}\\s*\\(`,
  );
  return rx.test(signature);
}

function normalize(s?: string): string {
  return (s ?? "").trim().toLowerCase();
}

function scoreCandidate(args: {
  classHint?: string;
  methodHint?: string;
  lineHint?: number;
  filePath: string;
  className?: string;
  methodName?: string;
  methodLine?: number;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const classHint = normalize(args.classHint);
  const methodHint = normalize(args.methodHint);
  const fileBase = path.basename(args.filePath, ".java").toLowerCase();
  const className = normalize(args.className);
  const methodName = normalize(args.methodName);
  let classMatched = false;
  let methodMatched = false;

  if (classHint) {
    if (className === classHint) {
      score += 45;
      reasons.push("class exact match");
      classMatched = true;
    } else if (className.includes(classHint) || fileBase.includes(classHint)) {
      score += 25;
      reasons.push("class partial match");
      classMatched = true;
    }
  }

  if (methodHint) {
    if (methodName === methodHint) {
      score += 40;
      reasons.push("method exact match");
      methodMatched = true;
    } else if (methodName.includes(methodHint)) {
      score += 22;
      reasons.push("method partial match");
      methodMatched = true;
    }
  }

  // Guardrail: when textual hints are provided, do not return line-only matches
  // from unrelated classes/methods.
  if ((classHint || methodHint) && !classMatched && !methodMatched) {
    return { score: 0, reasons: [] };
  }

  if (typeof args.lineHint === "number" && typeof args.methodLine === "number") {
    const d = Math.abs(args.lineHint - args.methodLine);
    if (d === 0) {
      score += 25;
      reasons.push("line exact match");
    } else if (d <= 3) {
      score += 16;
      reasons.push("line near match");
    } else if (d <= 12) {
      score += 8;
      reasons.push("line loose match");
    }
  }

  return { score, reasons };
}

export async function inferTargets(args: {
  rootAbs: string;
  classHint?: string;
  methodHint?: string;
  lineHint?: number;
  maxFiles?: number;
  maxCandidates?: number;
}): Promise<{ scannedJavaFiles: number; candidates: InferredTarget[] }> {
  const indexArgs: Parameters<typeof buildJavaIndex>[0] = {
    rootAbs: args.rootAbs,
    maxFiles: args.maxFiles ?? 1500,
  };
  if (args.classHint) indexArgs.classHint = args.classHint;
  const index = await buildJavaIndex(indexArgs);

  const out: InferredTarget[] = [];
  for (const f of index) {
    if (f.methods.length === 0) continue;

    for (const m of f.methods) {
      const scoreArgs: Parameters<typeof scoreCandidate>[0] = {
        filePath: f.fileAbs,
        methodName: m.name,
        methodLine: m.line,
      };
      if (args.classHint) scoreArgs.classHint = args.classHint;
      if (args.methodHint) scoreArgs.methodHint = args.methodHint;
      if (typeof args.lineHint === "number") scoreArgs.lineHint = args.lineHint;
      if (f.className) scoreArgs.className = f.className;
      const scored = scoreCandidate(scoreArgs);
      if (scored.score <= 0) continue;
      const fqcn = f.packageName && f.className ? `${f.packageName}.${f.className}` : undefined;
      const candidate: InferredTarget = {
        file: f.fileAbs,
        methodName: m.name,
        signature: m.signature,
        returnsBoolean: inferReturnsBoolean(m.signature, m.name),
        confidence: Math.min(100, scored.score),
        reasons: scored.reasons,
      };
      if (f.className) candidate.className = f.className;
      candidate.line = m.line;
      if (fqcn) {
        candidate.fqcn = fqcn;
        candidate.key = `${fqcn}#${m.name}`;
      }
      out.push(candidate);
    }
  }

  out.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const al = typeof a.line === "number" ? a.line : Number.MAX_SAFE_INTEGER;
    const bl = typeof b.line === "number" ? b.line : Number.MAX_SAFE_INTEGER;
    return al - bl;
  });

  return {
    scannedJavaFiles: index.length,
    candidates: out.slice(0, Math.max(1, Math.min(args.maxCandidates ?? 8, 20))),
  };
}
