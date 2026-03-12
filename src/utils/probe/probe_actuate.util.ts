import { fetchJson } from "@/lib/http";
import { clampInt, DEFAULT_PROBE_TIMEOUT_MS, HARD_MAX_PROBE_TIMEOUT_MS } from "@/lib/safety";
import type { ToolTextResponse } from "@/models/tool_response.model";
import { joinUrl, probeUnreachableMessage } from "@/utils/probe.util";
import { isLineKey } from "@/utils/probe/key.util";
import { formatProbeOutput } from "@/utils/probe/output.util";
import { buildTextResponse } from "@/utils/probe/response_builders.util";

export async function probeActuate(args: {
  baseUrl: string;
  actuatePath: string;
  mode?: "observe" | "actuate";
  actuatorId?: string;
  targetKey?: string;
  returnBoolean?: boolean;
  timeoutMs?: number;
}): Promise<ToolTextResponse> {
  const timeoutMs = clampInt(args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS, 1_000, HARD_MAX_PROBE_TIMEOUT_MS);
  const url = joinUrl(args.baseUrl, args.actuatePath);

  if (args.mode === "actuate" && (!args.targetKey || !isLineKey(args.targetKey))) {
    const structuredContent: Record<string, unknown> = {
      request: {
        mode: args.mode,
        targetKey: args.targetKey,
        returnBoolean: args.returnBoolean,
        timeoutMs,
      },
      result: { actuated: false, reason: "line_key_required" },
    };
    const text = formatProbeOutput({
      probeKey: args.targetKey ?? "probe_actuation",
      httpRequest: `POST ${url}`,
      requestMethod: "POST",
      requestUrl: url,
      requestHeaders: { "content-type": "application/json" },
      requestBody: {
        mode: args.mode,
        targetKey: args.targetKey,
        returnBoolean: args.returnBoolean,
        actuatorId: args.actuatorId,
      },
      executionHit: "not_hit",
      apiOutcome: "error",
      reproStatus: "line_key_required",
      probeHit: "line targetKey required for branch actuation (Class#method:<line>)",
      httpCode: 400,
      httpResponse: structuredContent.result,
      runtimeMode: args.mode,
      runDuration: "Not measured",
      runNotes: "probe_enable strict line mode",
    });
    return buildTextResponse(structuredContent, text);
  }

  const body: Record<string, unknown> = {};
  if (typeof args.mode === "string") body.mode = args.mode;
  if (typeof args.actuatorId === "string") body.actuatorId = args.actuatorId;
  if (typeof args.targetKey === "string") body.targetKey = args.targetKey;
  if (typeof args.returnBoolean === "boolean") body.returnBoolean = args.returnBoolean;

  let res;
  try {
    res = await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs,
    });
  } catch (err) {
    throw new Error(probeUnreachableMessage(url, err));
  }

  const structuredContent: Record<string, unknown> = {
    request: { url, timeoutMs, body },
    response: { status: res.status, json: res.json, text: res.json ? undefined : res.text },
  };
  const json = (res.json as Record<string, unknown> | null) ?? {};
  const effectiveMode = typeof json.mode === "string" ? json.mode : (args.mode ?? "observe");
  const effectiveActuatorId = typeof json.actuatorId === "string" ? json.actuatorId : (args.actuatorId ?? "");
  const effectiveTargetKey = typeof json.targetKey === "string" ? json.targetKey : (args.targetKey ?? "");
  const branchDecision =
    typeof json.returnBoolean === "boolean"
      ? json.returnBoolean
      : typeof args.returnBoolean === "boolean"
        ? args.returnBoolean
        : undefined;

  const text = formatProbeOutput({
    probeKey: effectiveTargetKey || "probe_actuation",
    httpRequest: `POST ${url}`,
    requestMethod: "POST",
    requestUrl: url,
    requestHeaders: { "content-type": "application/json" },
    requestBody: body,
    executionHit: "not_applicable",
    apiOutcome: res.status >= 200 && res.status < 300 ? "ok" : "error",
    reproStatus: res.status >= 200 && res.status < 300 ? "actuation_applied" : "actuation_failed",
    probeHit:
      `mode=${effectiveMode}, actuatorId=${effectiveActuatorId || "(none)"}` +
      (typeof branchDecision === "boolean"
        ? `, branchDecision=${branchDecision ? "taken" : "fallthrough"}`
        : ""),
    httpCode: res.status,
    httpResponse: res.json ?? res.text,
    runtimeMode: effectiveMode,
    runDuration: "Not measured",
    runNotes:
      "probe_enable executed (branch forcing applies only to conditional jump opcodes encountered on targetKey line)",
  });

  return buildTextResponse(structuredContent, text);
}
