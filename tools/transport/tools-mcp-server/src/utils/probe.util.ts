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
  lastHitMs?: number;
} {
  const response = structuredContent.response as Record<string, unknown> | undefined;
  const json = response?.json as Record<string, unknown> | undefined;
  const probe =
    json && typeof json.probe === "object" && json.probe !== null
      ? (json.probe as Record<string, unknown>)
      : json;
  const out: { key?: string; hitCount?: number; lastHitMs?: number } = {};
  const key = probe?.key;
  const hitCount = probe?.hitCount;
  const lastHitMs = typeof probe?.lastHitMs === "number" ? probe.lastHitMs : probe?.lastHitEpoch;
  if (typeof key === "string") out.key = key;
  if (typeof hitCount === "number") out.hitCount = hitCount;
  if (typeof lastHitMs === "number") out.lastHitMs = lastHitMs;
  return out;
}
