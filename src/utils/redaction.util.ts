export function redactSecret(value: string): string {
  const v = value.trim();
  if (!v) return "***";
  if (v.length <= 8) return "***";
  return `${v.slice(0, 4)}...${v.slice(-2)}`;
}
