import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";

export type DiscoveredProject = {
  id: string;
  rootAbs: string;
  build: "maven" | "gradle";
  markers: string[];
  probeScope: {
    sourceRoots: string[];
    packageSamples: number;
    candidateBasePackages: string[];
    suggestedInclude?: string;
  };
};

const EXCLUDED_DIRS = new Set([".git", "node_modules", "target", "build", "out", ".idea"]);

const JAVA_SCOPE_EXCLUDED_PREFIXES = [
  "java.",
  "javax.",
  "jakarta.",
  "kotlin.",
  "scala.",
  "org.springframework.",
];

const DEFAULT_MAX_JAVA_FILES_PER_PROJECT = 300;

function sanitizeId(rel: string): string {
  // Stable-ish id: path with separators replaced
  return rel.replace(/[\\/]/g, "__").replace(/[^a-zA-Z0-9_.-]/g, "_") || "root";
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function findJavaSourceRoots(projectRootAbs: string): Promise<string[]> {
  const roots: string[] = [];
  const queue: string[] = [projectRootAbs];

  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const srcMainJava = path.join(dir, "src", "main", "java");
    if (await dirExists(srcMainJava)) {
      roots.push(srcMainJava);
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (EXCLUDED_DIRS.has(e.name)) continue;
      queue.push(path.join(dir, e.name));
    }
  }

  return roots.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
}

async function collectJavaFiles(sourceRoots: string[], maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [...sourceRoots];

  while (queue.length > 0 && files.length < maxFiles) {
    const dir = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (files.length >= maxFiles) break;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        queue.push(abs);
        continue;
      }
      if (e.isFile() && e.name.endsWith(".java")) {
        files.push(abs);
      }
    }
  }

  return files;
}

async function readPackageName(javaFileAbs: string): Promise<string | null> {
  let text = "";
  try {
    text = await fs.readFile(javaFileAbs, "utf8");
  } catch {
    return null;
  }
  const m = text.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m);
  if (!m) return null;
  return m[1] ?? null;
}

function buildCandidateBasePackages(packages: string[]): string[] {
  const counts = new Map<string, number>();
  for (const pkg of packages) {
    if (!pkg || JAVA_SCOPE_EXCLUDED_PREFIXES.some((p) => pkg.startsWith(p))) continue;
    const parts = pkg.split(".").filter(Boolean);
    const maxDepth = Math.min(parts.length, 5);
    for (let d = 2; d <= maxDepth; d++) {
      const prefix = parts.slice(0, d).join(".");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const al = a[0].split(".").length;
      const bl = b[0].split(".").length;
      if (bl !== al) return bl - al;
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 5)
    .map(([k]) => k);
}

async function inferProbeScope(
  projectRootAbs: string,
  maxJavaFiles: number,
): Promise<DiscoveredProject["probeScope"]> {
  const sourceRoots = await findJavaSourceRoots(projectRootAbs);
  if (sourceRoots.length === 0) {
    return {
      sourceRoots,
      packageSamples: 0,
      candidateBasePackages: [],
    };
  }

  const javaFiles = await collectJavaFiles(sourceRoots, Math.max(10, maxJavaFiles));
  const packages: string[] = [];
  for (const f of javaFiles) {
    const p = await readPackageName(f);
    if (p) packages.push(p);
  }

  const candidates = buildCandidateBasePackages(packages);
  const suggestedBase = candidates[0];
  const result: DiscoveredProject["probeScope"] = {
    sourceRoots,
    packageSamples: packages.length,
    candidateBasePackages: candidates,
  };
  if (suggestedBase) {
    result.suggestedInclude = `${suggestedBase}.**`;
  }
  return result;
}

export async function discoverProjects(
  workspaceRootAbs: string,
  maxProjects: number,
  maxJavaFilesPerProject = DEFAULT_MAX_JAVA_FILES_PER_PROJECT,
): Promise<DiscoveredProject[]> {
  const results: DiscoveredProject[] = [];

  // Breadth-first walk with a shallow bias: most Java projects are not deeply nested.
  const queue: string[] = [workspaceRootAbs];

  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (results.length >= maxProjects) break;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const markers: string[] = [];
    const pom = path.join(dir, "pom.xml");
    const gradle = path.join(dir, "build.gradle");
    const gradleKts = path.join(dir, "build.gradle.kts");

    const hasPom = await fileExists(pom);
    const hasGradle = await fileExists(gradle);
    const hasGradleKts = await fileExists(gradleKts);

    if (hasPom) markers.push("pom.xml");
    if (hasGradle) markers.push("build.gradle");
    if (hasGradleKts) markers.push("build.gradle.kts");

    if (markers.length > 0) {
      const rel = path.relative(workspaceRootAbs, dir) || ".";
      const build: DiscoveredProject["build"] = hasPom ? "maven" : "gradle";
      const probeScope = await inferProbeScope(dir, maxJavaFilesPerProject);
      results.push({
        id: sanitizeId(rel),
        rootAbs: dir,
        build,
        markers,
        probeScope,
      });
      // Still continue scanning; monorepos can contain nested projects.
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (EXCLUDED_DIRS.has(e.name)) continue;
      queue.push(path.join(dir, e.name));
    }
  }

  // Prefer shorter paths first (more "top-level" projects).
  results.sort((a, b) => a.rootAbs.split(path.sep).length - b.rootAbs.split(path.sep).length);

  return results;
}
