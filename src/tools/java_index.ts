import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "build",
  "out",
  ".idea",
  ".vscode",
]);

export type JavaMethod = {
  name: string;
  line: number;
  signature: string;
};

export type JavaFileIndex = {
  fileAbs: string;
  packageName?: string;
  className?: string;
  methods: JavaMethod[];
  text: string;
};

async function walkJavaFiles(
  rootAbs: string,
  maxFiles: number,
  classHint?: string,
): Promise<string[]> {
  const prioritized: string[] = [];
  const fallback: string[] = [];
  const queue: string[] = [rootAbs];
  const classHintLower = classHint?.toLowerCase();

  while (queue.length > 0 && prioritized.length + fallback.length < maxFiles) {
    const dir = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (prioritized.length + fallback.length >= maxFiles) break;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        queue.push(abs);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".java")) continue;
      if (classHintLower) {
        const basenameLower = e.name.toLowerCase();
        if (basenameLower.includes(classHintLower)) {
          prioritized.push(abs);
          continue;
        }
      }
      fallback.push(abs);
    }
  }
  return [...prioritized, ...fallback];
}

export async function buildJavaIndex(args: {
  rootAbs: string;
  maxFiles?: number;
  classHint?: string;
}): Promise<JavaFileIndex[]> {
  const maxFiles = Math.max(20, Math.min(5_000, args.maxFiles ?? 1_000));
  const files = await walkJavaFiles(args.rootAbs, maxFiles, args.classHint);
  const results: JavaFileIndex[] = [];

  for (const fileAbs of files) {
    let text = "";
    try {
      text = await fs.readFile(fileAbs, "utf8");
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    const packageMatch = text.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m);
    const classMatch = text.match(
      /^\s*(?:public\s+)?(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)\b/m,
    );

    const methods: JavaMethod[] = [];
    // Intentionally simple method signature matcher for PoC.
    const methodRx =
      /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|protected|private|static|final|synchronized|native|abstract|strictfp|default|\s)+[A-Za-z_$][A-Za-z0-9_$<>\[\],.? ]*\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^;]*\)\s*(?:\{|throws\b)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const m = line.match(methodRx);
      if (!m) continue;
      const name = m[1];
      if (!name) continue;
      if (
        name === "if" ||
        name === "for" ||
        name === "while" ||
        name === "switch" ||
        name === "catch"
      ) {
        continue;
      }
      methods.push({
        name,
        line: i + 1,
        signature: line.trim(),
      });
    }

    const entry: JavaFileIndex = {
      fileAbs,
      methods,
      text,
    };
    if (packageMatch?.[1]) entry.packageName = packageMatch[1];
    if (classMatch?.[1]) entry.className = classMatch[1];
    results.push(entry);
  }

  return results;
}
