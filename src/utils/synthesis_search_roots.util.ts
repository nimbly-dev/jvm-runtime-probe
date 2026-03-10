import * as path from "node:path";

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index, arr) => !!value && arr.indexOf(value) === index);
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

  return uniqueStrings(roots.map((root) => path.resolve(root)));
}
