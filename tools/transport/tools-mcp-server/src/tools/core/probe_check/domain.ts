import { fetchJson } from "@/lib/http";
import { clampInt, DEFAULT_PROBE_TIMEOUT_MS, HARD_MAX_PROBE_TIMEOUT_MS } from "@/lib/safety";
import { joinUrl } from "@/utils/probe.util";
import { formatProbeOutput } from "@/utils/probe/output.util";

function sanitizeRuntime(runtime: unknown): Record<string, unknown> | undefined {
  if (!runtime || typeof runtime !== "object") return undefined;
  const input = runtime as Record<string, unknown>;
  const out: Record<string, unknown> = { ...input };

  // serverEpoch is a remote host clock and can be misleading in mixed-host setups.
  delete out.serverEpoch;
  // Runtime applicationType is intentionally omitted from MCP diagnostics.
  delete out.applicationType;

  const appPort =
    typeof out.appPort === "object" && out.appPort !== null
      ? (out.appPort as Record<string, unknown>)
      : undefined;
  if (appPort) {
    delete appPort.confidence;
    out.appPort = appPort;
  }

  return out;
}

function sanitizeCheckPayload(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const out = { ...(json as Record<string, unknown>) };
  delete out.contractVersion;
  const runtime = sanitizeRuntime(out.runtime);
  if (runtime && Object.keys(runtime).length > 0) {
    out.runtime = runtime;
  } else {
    delete out.runtime;
  }
  return out;
}

export async function probeDiagnose(args: {
  baseUrl: string;
  statusPath: string;
  resetPath: string;
  timeoutMs?: number;
}): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
}> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );

  const probeKey = "mcp.jvm.diagnose#key";
  const statusUrl = new URL(joinUrl(args.baseUrl, args.statusPath));
  statusUrl.searchParams.set("key", probeKey);
  const resetUrl = joinUrl(args.baseUrl, args.resetPath);

  const checks: Record<string, unknown> = {};
  const recommendations: string[] = [];
  let contractVersion: string | undefined;

  try {
    const reset = await fetchJson(resetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: probeKey }),
      timeoutMs,
    });
    const resetJson = sanitizeCheckPayload(reset.json);
    if (!contractVersion && typeof reset.json?.contractVersion === "string") {
      contractVersion = reset.json.contractVersion;
    }
    checks.reset = {
      ok: reset.status >= 200 && reset.status < 300,
      status: reset.status,
      ...(resetJson ? { json: resetJson } : {}),
    };
  } catch (err) {
    checks.reset = { ok: false, error: err instanceof Error ? err.message : String(err) };
    recommendations.push(
      "Probe reset endpoint unreachable. Confirm docker service is running and probe port mapping is correct.",
    );
  }

  try {
    const status = await fetchJson(statusUrl.toString(), { method: "GET", timeoutMs });
    const statusJson = sanitizeCheckPayload(status.json);
    if (!contractVersion && typeof status.json?.contractVersion === "string") {
      contractVersion = status.json.contractVersion;
    }
    const responseKey =
      typeof status.json?.probe?.key === "string"
        ? status.json.probe.key
        : typeof status.json?.key === "string"
          ? status.json.key
          : undefined;
    const decodeOk = responseKey === probeKey;
    checks.status = {
      ok: status.status >= 200 && status.status < 300,
      status: status.status,
      ...(statusJson ? { json: statusJson } : {}),
      keyDecodingOk: decodeOk,
    };
    if (!decodeOk) {
      recommendations.push(
        "Probe key decoding mismatch detected. Rebuild/redeploy java-agent so query keys with # are decoded correctly.",
      );
    }
  } catch (err) {
    checks.status = { ok: false, error: err instanceof Error ? err.message : String(err) };
    recommendations.push(
      "Probe status endpoint unreachable. If port is unknown, ask user which service probe port is mapped.",
    );
  }

  const structuredContent: Record<string, unknown> = {
    config: {
      baseUrl: args.baseUrl,
      statusPath: args.statusPath,
      resetPath: args.resetPath,
      timeoutMs,
    },
    checks,
    recommendations,
    ...(contractVersion ? { contractVersion } : {}),
  };
  const allOk =
    (checks.reset as any)?.ok === true &&
    (checks.status as any)?.ok === true &&
    (checks.status as any)?.keyDecodingOk !== false;
  const text = formatProbeOutput({
    probeKey,
    httpRequest: `POST ${resetUrl} + GET ${statusUrl.toString()}`,
    requestMethod: "DIAGNOSE",
    requestUrl: statusUrl.toString(),
    executionHit: allOk ? "line_hit" : "not_hit",
    apiOutcome: allOk ? "ok" : "error",
    reproStatus: allOk ? "diagnose_ok" : "diagnose_failed",
    probeHit: allOk ? "probe wiring healthy" : "probe wiring has issues",
    httpCode: allOk ? 200 : "error",
    httpResponse: { checks, recommendations },
    runDuration: "Not measured",
    runNotes: recommendations.join(" | ") || "No recommendations",
  });

  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}
