import { fetchJson } from "../lib/http";
import {
  clampInt,
  DEFAULT_PROBE_POLL_INTERVAL_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_PROBE_WAIT_MAX_RETRIES,
  HARD_MAX_PROBE_POLL_INTERVAL_MS,
  HARD_MAX_PROBE_TIMEOUT_MS,
  HARD_MAX_PROBE_WAIT_MAX_RETRIES,
} from "../lib/safety";
import { joinUrl, parseProbeSnapshot, probeUnreachableMessage } from "../utils/probe.util";
import {
  classifyExecutionHitStrictLine,
  classifyReproStatusStrictLine,
  isLineKey,
  resolveProbeKey,
} from "./probe/key.util";
import { formatProbeOutput } from "./probe/output.util";
import type { ToolTextResponse } from "./probe/types.util";

const LAST_RESET_EPOCH_BY_KEY = new Map<string, number>();

function buildTextResponse(
  structuredContent: Record<string, unknown>,
  text: string,
): ToolTextResponse {
  return { content: [{ type: "text", text }], structuredContent };
}

function buildLineKeyRequiredResponse(args: {
  request: Record<string, unknown>;
  targetPath: string;
  httpRequest: string;
  requestMethod: string;
  requestUrl: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  result: Record<string, unknown>;
  runNotes: string;
}): ToolTextResponse {
  const structuredContent: Record<string, unknown> = {
    request: args.request,
    result: args.result,
  };
  const text = formatProbeOutput({
    probeKey: args.targetPath,
    httpRequest: args.httpRequest,
    requestMethod: args.requestMethod,
    requestUrl: args.requestUrl,
    ...(args.requestHeaders ? { requestHeaders: args.requestHeaders } : {}),
    ...(typeof args.requestBody !== "undefined" ? { requestBody: args.requestBody } : {}),
    executionHit: "not_hit",
    apiOutcome: "error",
    reproStatus: "line_key_required",
    probeHit: "line probe key required (Class#method:<line>); method-only checks disabled",
    httpCode: 400,
    httpResponse: args.result,
    runDuration: "Not measured",
    runNotes: args.runNotes,
  });
  return buildTextResponse(structuredContent, text);
}

function readLineValidation(json: Record<string, unknown> | null): {
  lineValidation?: string;
  lineResolvable?: boolean;
  invalidLineTarget: boolean;
} {
  const out: { lineValidation?: string; lineResolvable?: boolean; invalidLineTarget: boolean } = {
    invalidLineTarget: false,
  };
  if (typeof json?.lineValidation === "string") out.lineValidation = json.lineValidation;
  if (typeof json?.lineResolvable === "boolean") out.lineResolvable = json.lineResolvable;
  out.invalidLineTarget = out.lineValidation === "invalid_line_target" || out.lineResolvable === false;
  return out;
}

function invalidLineTargetProbeHitMessage(hitCount: number): string {
  return (
    "target line cannot be resolved to executable bytecode for this Class#method; " +
    `hitCount=${hitCount} is not evidence of method non-execution`
  );
}

export async function probeStatus(args: {
  key: string;
  lineHint?: number;
  baseUrl: string;
  statusPath: string;
  timeoutMs?: number;
}): Promise<ToolTextResponse> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );
  const resolvedKey = resolveProbeKey(args.key, args.lineHint);
  const urlString = `${joinUrl(args.baseUrl, args.statusPath)}?key=${encodeURIComponent(resolvedKey)}`;

  if (!isLineKey(resolvedKey)) {
    return buildLineKeyRequiredResponse({
      request: { key: args.key, resolvedKey, lineHint: args.lineHint, timeoutMs },
      targetPath: resolvedKey,
      httpRequest: `GET ${urlString}`,
      requestMethod: "GET",
      requestUrl: urlString,
      result: { hit: false, reason: "line_key_required" },
      runNotes: "probe_status strict line mode",
    });
  }

  const url = new URL(joinUrl(args.baseUrl, args.statusPath));
  url.searchParams.set("key", resolvedKey);

  let res;
  try {
    res = await fetchJson(url.toString(), { method: "GET", timeoutMs });
  } catch (err) {
    throw new Error(probeUnreachableMessage(url.toString(), err));
  }

  const structuredContent: Record<string, unknown> = {
    request: {
      key: args.key,
      resolvedKey,
      lineHint: args.lineHint,
      url: url.toString(),
      timeoutMs,
    },
    response: { status: res.status, json: res.json, text: res.json ? undefined : res.text },
  };

  const json = res.json as Record<string, unknown> | null;
  const hitCount = typeof json?.hitCount === "number" ? json.hitCount : 0;
  const lineValidation = readLineValidation(json);
  const reproStatus = lineValidation.invalidLineTarget ? "invalid_line_target" : "status_checked";
  const executionHit = lineValidation.invalidLineTarget
    ? "not_hit"
    : classifyExecutionHitStrictLine(resolvedKey, hitCount > 0);
  const probeHit = lineValidation.invalidLineTarget
    ? invalidLineTargetProbeHitMessage(hitCount)
    : json !== null
      ? `hitCount=${typeof json.hitCount === "number" ? json.hitCount : 0}, lastHitEpochMs=${typeof json.lastHitEpochMs === "number" ? json.lastHitEpochMs : 0}`
      : "No JSON probe payload";

  const text = formatProbeOutput({
    probeKey: resolvedKey,
    httpRequest: `GET ${url.toString()}`,
    requestMethod: "GET",
    requestUrl: url.toString(),
    executionHit,
    apiOutcome: res.status >= 200 && res.status < 300 ? "ok" : "error",
    reproStatus,
    probeHit,
    httpCode: res.status,
    httpResponse: res.json ?? res.text,
    runtimeMode: typeof json?.mode === "string" ? json.mode : undefined,
    runDuration: "Not measured",
    runNotes: lineValidation.invalidLineTarget
      ? "probe_status executed with invalid line target"
      : "probe_status executed",
  });

  return buildTextResponse(structuredContent, text);
}

export async function probeReset(args: {
  key: string;
  lineHint?: number;
  baseUrl: string;
  resetPath: string;
  timeoutMs?: number;
}): Promise<ToolTextResponse> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );
  const resolvedKey = resolveProbeKey(args.key, args.lineHint);
  const url = joinUrl(args.baseUrl, args.resetPath);

  if (!isLineKey(resolvedKey)) {
    return buildLineKeyRequiredResponse({
      request: { key: args.key, resolvedKey, lineHint: args.lineHint, timeoutMs },
      targetPath: resolvedKey,
      httpRequest: `POST ${url}`,
      requestMethod: "POST",
      requestUrl: url,
      requestHeaders: { "content-type": "application/json" },
      requestBody: { key: resolvedKey },
      result: { reset: false, reason: "line_key_required" },
      runNotes: "probe_reset strict line mode",
    });
  }

  let res;
  try {
    res = await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: resolvedKey }),
      timeoutMs,
    });
  } catch (err) {
    throw new Error(probeUnreachableMessage(url, err));
  }

  const structuredContent: Record<string, unknown> = {
    request: { key: args.key, resolvedKey, lineHint: args.lineHint, url, timeoutMs },
    response: { status: res.status, json: res.json, text: res.json ? undefined : res.text },
  };
  const json = res.json as Record<string, unknown> | null;
  const lineValidation = readLineValidation(json);
  const isOk = res.status >= 200 && res.status < 300;

  if (isOk) {
    LAST_RESET_EPOCH_BY_KEY.set(resolvedKey, Date.now());
  }

  const text = formatProbeOutput({
    probeKey: resolvedKey,
    httpRequest: `POST ${url}`,
    requestMethod: "POST",
    requestUrl: url,
    requestHeaders: { "content-type": "application/json" },
    requestBody: { key: resolvedKey },
    executionHit: "not_applicable",
    apiOutcome: isOk ? "ok" : "error",
    reproStatus: lineValidation.invalidLineTarget
      ? "invalid_line_target"
      : isOk
        ? "reset_done"
        : "reset_failed",
    probeHit: lineValidation.invalidLineTarget
      ? `${invalidLineTargetProbeHitMessage(0)}; counter reset requested`
      : "counter reset requested",
    httpCode: res.status,
    httpResponse: res.json ?? res.text,
    runDuration: "Not measured",
    runNotes: lineValidation.invalidLineTarget
      ? "probe_reset executed with invalid line target"
      : "probe_reset executed",
  });

  return buildTextResponse(structuredContent, text);
}

export async function probeWaitHit(args: {
  key: string;
  lineHint?: number;
  baseUrl: string;
  statusPath: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxRetries?: number;
}): Promise<ToolTextResponse> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );
  const pollIntervalMs = clampInt(
    args.pollIntervalMs ?? DEFAULT_PROBE_POLL_INTERVAL_MS,
    100,
    HARD_MAX_PROBE_POLL_INTERVAL_MS,
  );
  const maxRetries = clampInt(
    args.maxRetries ?? DEFAULT_PROBE_WAIT_MAX_RETRIES,
    1,
    HARD_MAX_PROBE_WAIT_MAX_RETRIES,
  );
  const resolvedKey = resolveProbeKey(args.key, args.lineHint);
  const pollUrl = joinUrl(args.baseUrl, args.statusPath);

  if (!isLineKey(resolvedKey)) {
    return buildLineKeyRequiredResponse({
      request: { key: args.key, resolvedKey, timeoutMs, pollIntervalMs, maxRetries },
      targetPath: resolvedKey,
      httpRequest: `POLL ${pollUrl} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
      requestMethod: "POLL",
      requestUrl: pollUrl,
      requestBody: { key: resolvedKey, maxRetries, pollIntervalMs, timeoutMs },
      result: { hit: false, inline: false, reason: "line_key_required" },
      runNotes: "probe_wait_hit strict line mode",
    });
  }

  let last: Record<string, unknown> | null = null;
  let staleCandidate: Record<string, unknown> | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const waitStartEpochMs = Date.now();
    const inlineStartEpochMs = LAST_RESET_EPOCH_BY_KEY.get(resolvedKey) ?? waitStartEpochMs;

    const baselineRes = await probeStatus({
      key: resolvedKey,
      baseUrl: args.baseUrl,
      statusPath: args.statusPath,
      timeoutMs: Math.min(5_000, timeoutMs),
    });
    const baselineJson = ((baselineRes.structuredContent as any)?.response?.json ??
      null) as Record<string, unknown> | null;
    const baselineLineValidation = readLineValidation(baselineJson);
    const baseline = parseProbeSnapshot(baselineRes.structuredContent);
    const baselineHitCount = baseline.hitCount ?? 0;
    const baselineLastHitEpochMs = baseline.lastHitEpochMs ?? 0;
    if (baselineLineValidation.invalidLineTarget) {
      const structuredContent: Record<string, unknown> = {
        request: {
          key: args.key,
          resolvedKey,
          timeoutMs,
          pollIntervalMs,
          maxRetries,
          attempt,
          waitStartEpochMs,
          inlineStartEpochMs,
        },
        result: {
          hit: false,
          inline: false,
          reason: "invalid_line_target",
          lineValidation: baselineLineValidation.lineValidation ?? "invalid_line_target",
          lastStatus: baselineJson,
        },
      };
      const text = formatProbeOutput({
        probeKey: resolvedKey,
        httpRequest: `POLL ${pollUrl} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
        requestMethod: "POLL",
        requestUrl: pollUrl,
        requestBody: { key: resolvedKey, maxRetries, pollIntervalMs, timeoutMs },
        executionHit: "not_hit",
        apiOutcome: "error",
        reproStatus: "invalid_line_target",
        probeHit: invalidLineTargetProbeHitMessage(baselineHitCount),
        httpCode: 422,
        httpResponse: structuredContent.result,
        runtimeMode: typeof baselineJson?.mode === "string" ? baselineJson.mode : undefined,
        runDuration: `${Date.now() - waitStartEpochMs}ms`,
        runNotes: "probe_wait_hit invalid line target detected at baseline status",
      });
      return buildTextResponse(structuredContent, text);
    }

    if (
      baselineHitCount > 0 &&
      baselineLastHitEpochMs > 0 &&
      baselineLastHitEpochMs >= inlineStartEpochMs
    ) {
      const baselineJsonForHit = (baselineJson ?? {}) as Record<string, unknown>;
      const structuredContent: Record<string, unknown> = {
        request: {
          key: args.key,
          resolvedKey,
          timeoutMs,
          pollIntervalMs,
          maxRetries,
          attempt,
          waitStartEpochMs,
          inlineStartEpochMs,
        },
        baseline: { hitCount: baselineHitCount, lastHitEpochMs: baselineLastHitEpochMs },
        result: {
          hit: true,
          inline: true,
          source: "already_hit_since_inline_start",
          hitCount: baselineHitCount,
          hitDelta: 0,
          lastStatus: baselineJsonForHit,
        },
      };
      const text = formatProbeOutput({
        probeKey: resolvedKey,
        httpRequest: `POLL ${pollUrl} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
        requestMethod: "POLL",
        requestUrl: pollUrl,
        requestBody: { key: resolvedKey, maxRetries, pollIntervalMs, timeoutMs },
        executionHit: classifyExecutionHitStrictLine(resolvedKey, true),
        apiOutcome: "ok",
        reproStatus: classifyReproStatusStrictLine(resolvedKey, true),
        probeHit: `inline line hit confirmed; hitCount=${baselineHitCount}`,
        httpCode: 200,
        httpResponse: structuredContent.result,
        runtimeMode:
          typeof baselineJsonForHit?.mode === "string" ? baselineJsonForHit.mode : undefined,
        runDuration: `${Date.now() - waitStartEpochMs}ms`,
        runNotes: "probe_wait_hit detected baseline inline hit",
      });
      return buildTextResponse(structuredContent, text);
    }

    const start = waitStartEpochMs;
    while (Date.now() - start < timeoutMs) {
      const res = await probeStatus({
        key: resolvedKey,
        baseUrl: args.baseUrl,
        statusPath: args.statusPath,
        timeoutMs: Math.min(5_000, timeoutMs),
      });
      last = res.structuredContent;

      const json = (last as any)?.response?.json as Record<string, unknown> | undefined;
      const lineValidation = readLineValidation(json ?? null);
      if (lineValidation.invalidLineTarget) {
        const structuredContent: Record<string, unknown> = {
          request: {
            key: args.key,
            resolvedKey,
            timeoutMs,
            pollIntervalMs,
            maxRetries,
            attempt,
            waitStartEpochMs,
            inlineStartEpochMs,
          },
          baseline: { hitCount: baselineHitCount, lastHitEpochMs: baselineLastHitEpochMs },
          result: {
            hit: false,
            inline: false,
            reason: "invalid_line_target",
            lineValidation: lineValidation.lineValidation ?? "invalid_line_target",
            lastStatus: json ?? null,
          },
        };
        const text = formatProbeOutput({
          probeKey: resolvedKey,
          httpRequest: `POLL ${pollUrl} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
          requestMethod: "POLL",
          requestUrl: pollUrl,
          requestBody: { key: resolvedKey, maxRetries, pollIntervalMs, timeoutMs },
          executionHit: "not_hit",
          apiOutcome: "error",
          reproStatus: "invalid_line_target",
          probeHit: invalidLineTargetProbeHitMessage(baselineHitCount),
          httpCode: 422,
          httpResponse: structuredContent.result,
          runtimeMode: typeof json?.mode === "string" ? json.mode : undefined,
          runDuration: `${Date.now() - waitStartEpochMs}ms`,
          runNotes: "probe_wait_hit invalid line target detected during poll",
        });
        return buildTextResponse(structuredContent, text);
      }
      const hitCount = typeof json?.hitCount === "number" ? json.hitCount : null;
      const lastHitEpochMs = typeof json?.lastHitEpochMs === "number" ? json.lastHitEpochMs : null;
      if (hitCount !== null) {
        const hitDelta = hitCount - baselineHitCount;
        const isInlineByCount = hitDelta > 0;
        const isInlineByTime = lastHitEpochMs !== null && lastHitEpochMs >= inlineStartEpochMs;
        if (isInlineByCount && isInlineByTime) {
          const structuredContent: Record<string, unknown> = {
            request: {
              key: args.key,
              resolvedKey,
              timeoutMs,
              pollIntervalMs,
              maxRetries,
              attempt,
              waitStartEpochMs,
              inlineStartEpochMs,
            },
            baseline: { hitCount: baselineHitCount, lastHitEpochMs: baselineLastHitEpochMs },
            result: { hit: true, inline: true, hitCount, hitDelta, lastStatus: json },
          };
          const text = formatProbeOutput({
            probeKey: resolvedKey,
            httpRequest: `POLL ${pollUrl} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
            requestMethod: "POLL",
            requestUrl: pollUrl,
            requestBody: { key: resolvedKey, maxRetries, pollIntervalMs, timeoutMs },
            executionHit: classifyExecutionHitStrictLine(resolvedKey, true),
            apiOutcome: "ok",
            reproStatus: classifyReproStatusStrictLine(resolvedKey, true),
            probeHit: `inline line hit confirmed; hitCount=${hitCount}, hitDelta=${hitDelta}`,
            httpCode: 200,
            httpResponse: structuredContent.result,
            runtimeMode: typeof json?.mode === "string" ? json.mode : undefined,
            runDuration: `${Date.now() - waitStartEpochMs}ms`,
            runNotes: "probe_wait_hit detected inline hit during poll",
          });
          return buildTextResponse(structuredContent, text);
        }
        if (isInlineByCount && !isInlineByTime) {
          staleCandidate = {
            hitCount,
            hitDelta,
            lastHitEpochMs,
            reason: "hit_count_changed_but_not_inline_to_current_wait_window",
          };
        }
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  const structuredContent: Record<string, unknown> = {
    request: { key: args.key, resolvedKey, timeoutMs, pollIntervalMs, maxRetries },
    result: { hit: false, inline: false, reason: "timeout_no_inline_hit", last, staleCandidate },
  };
  const text = formatProbeOutput({
    probeKey: resolvedKey,
    httpRequest: `POLL ${pollUrl} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
    requestMethod: "POLL",
    requestUrl: pollUrl,
    requestBody: { key: resolvedKey, maxRetries, pollIntervalMs, timeoutMs },
    executionHit: classifyExecutionHitStrictLine(resolvedKey, false),
    apiOutcome: "timeout",
    reproStatus: classifyReproStatusStrictLine(resolvedKey, false),
    probeHit: "no inline line hit observed",
    httpCode: 408,
    httpResponse: structuredContent.result,
    runtimeMode:
      typeof (last as any)?.response?.json?.mode === "string"
        ? (last as any).response.json.mode
        : undefined,
    runDuration: `${timeoutMs}ms x ${maxRetries}`,
    runNotes: "probe_wait_hit timeout",
  });
  return buildTextResponse(structuredContent, text);
}

export async function probeActuate(args: {
  baseUrl: string;
  actuatePath: string;
  mode?: "observe" | "actuate";
  actuatorId?: string;
  targetKey?: string;
  returnBoolean?: boolean;
  timeoutMs?: number;
}): Promise<ToolTextResponse> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );
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
      runNotes: "probe_actuate strict line mode",
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
  const effectiveActuatorId =
    typeof json.actuatorId === "string" ? json.actuatorId : (args.actuatorId ?? "");
  const effectiveTargetKey =
    typeof json.targetKey === "string" ? json.targetKey : (args.targetKey ?? "");
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
      "probe_actuate executed (branch forcing applies only to conditional jump opcodes encountered on targetKey line)",
  });

  return buildTextResponse(structuredContent, text);
}
