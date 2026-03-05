export function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export function probeUnreachableMessage(url: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    `Probe endpoint unreachable: ${url}\n` +
    `Error: ${raw}\n` +
    `Check MCP_PROBE_BASE_URL (host + port) for the running service. ` +
    `If the active probe port is unknown, ask the user for the mapped probe port (for example 9193).`
  );
}

export function parseProbeSnapshot(structuredContent: Record<string, unknown>): {
  key?: string;
  hitCount?: number;
  lastHitEpochMs?: number;
} {
  const response = structuredContent.response as Record<string, unknown> | undefined;
  const json = response?.json as Record<string, unknown> | undefined;
  const out: { key?: string; hitCount?: number; lastHitEpochMs?: number } = {};
  const key = json?.key;
  const hitCount = json?.hitCount;
  const lastHitEpochMs = json?.lastHitEpochMs;
  if (typeof key === "string") out.key = key;
  if (typeof hitCount === "number") out.hitCount = hitCount;
  if (typeof lastHitEpochMs === "number") out.lastHitEpochMs = lastHitEpochMs;
  return out;
}
