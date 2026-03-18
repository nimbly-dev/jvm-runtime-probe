import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";

const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".idea",
  ".vscode",
  "node_modules",
  "target",
  "build",
  "dist",
  "out",
]);
const SPRING_BUILD_FILE_NAMES = ["pom.xml", "build.gradle", "build.gradle.kts"] as const;
const SPRING_CONTROLLER_ANNOTATION_REGEX =
  /@(RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\b/;

type SpringDetectionOptions = {
  searchRootsAbs?: string[];
  inferredTargetFileAbs?: string;
  maxScanDepth?: number;
  maxScannedDirs?: number;
};

async function readIfExists(fileAbs: string): Promise<string | null> {
  try {
    return await fs.readFile(fileAbs, "utf8");
  } catch {
    return null;
  }
}

function hasSpringDependencyText(text: string | null): boolean {
  return Boolean(text && /(spring-boot|org\.springframework)/i.test(text));
}

function uniqueResolvedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of paths) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    const normalized = path.resolve(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function collectAncestorDirs(startFileAbs: string): string[] {
  const ancestors: string[] = [];
  let cursor = path.resolve(path.dirname(startFileAbs));
  while (true) {
    ancestors.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return ancestors;
}

async function hasSpringMarkersAtRoot(rootAbs: string): Promise<boolean> {
  for (const buildFile of SPRING_BUILD_FILE_NAMES) {
    const text = await readIfExists(path.join(rootAbs, buildFile));
    if (hasSpringDependencyText(text)) return true;
  }
  return false;
}

async function hasSpringControllerMarker(fileAbs: string): Promise<boolean> {
  const content = await readIfExists(fileAbs);
  return Boolean(content && SPRING_CONTROLLER_ANNOTATION_REGEX.test(content));
}

async function findSpringMarkerRecursively(
  startRootAbs: string,
  maxScanDepth: number,
  maxScannedDirs: number,
): Promise<boolean> {
  type QueueEntry = { dirAbs: string; depth: number };
  const queue: QueueEntry[] = [{ dirAbs: startRootAbs, depth: 0 }];
  const visited = new Set<string>();
  let scanned = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (visited.has(current.dirAbs)) continue;
    visited.add(current.dirAbs);
    scanned += 1;
    if (scanned > maxScannedDirs) break;

    if (await hasSpringMarkersAtRoot(current.dirAbs)) return true;
    if (current.depth >= maxScanDepth) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current.dirAbs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      queue.push({
        dirAbs: path.join(current.dirAbs, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  return false;
}

export async function isSpringProject(
  rootAbs: string,
  options: SpringDetectionOptions = {},
): Promise<boolean> {
  const maxScanDepth = Math.max(1, options.maxScanDepth ?? 5);
  const maxScannedDirs = Math.max(50, options.maxScannedDirs ?? 1500);

  const directRoots = uniqueResolvedPaths([rootAbs, ...(options.searchRootsAbs ?? [])]);
  for (const root of directRoots) {
    if (await hasSpringMarkersAtRoot(root)) return true;
  }

  if (options.inferredTargetFileAbs) {
    if (await hasSpringControllerMarker(options.inferredTargetFileAbs)) return true;
    const targetAncestors = collectAncestorDirs(options.inferredTargetFileAbs);
    for (const ancestor of targetAncestors) {
      if (await hasSpringMarkersAtRoot(ancestor)) return true;
    }
  }

  for (const root of directRoots) {
    if (await findSpringMarkerRecursively(root, maxScanDepth, maxScannedDirs)) return true;
  }

  return false;
}
