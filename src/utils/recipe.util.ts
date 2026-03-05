export function inferBranchCondition(contextLines: string[]): string | undefined {
  const candidates = contextLines
    .map((l) => l.trim())
    .filter((l) => /^if\s*\(|^else\s+if\s*\(/.test(l));
  if (candidates.length === 0) return undefined;
  return candidates[candidates.length - 1];
}
