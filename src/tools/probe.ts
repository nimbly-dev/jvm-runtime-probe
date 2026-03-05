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
import {
  DEFAULT_RECIPE_OUTPUT_TEMPLATE,
  renderRecipeTemplate,
  type RecipeTemplateModel,
} from "../lib/recipe_template";
import {
  joinUrl,
  parseProbeSnapshot,
  probeUnreachableMessage,
} from "../utils/probe.util";

const LAST_RESET_EPOCH_BY_KEY = new Map<string, number>();

function isLineKey(key: string): boolean {
  return /#[^:]+:\d+$/.test(key);
}

function resolveProbeKey(key: string, lineHint?: number): string {
  if (typeof lineHint !== "number") return key;
  if (isLineKey(key)) return key;
  return `${key}:${lineHint}`;
}

function classifyExecutionHitStrictLine(key: string, hit: boolean): string {
  if (!isLineKey(key)) return "not_hit";
  return hit ? "line_hit" : "not_hit";
}

function classifyReproStatusStrictLine(key: string, hit: boolean): string {
  if (!isLineKey(key)) return "line_key_required";
  return hit ? "line_reproduced" : "line_not_reproduced";
}

function toText(value: unknown, fallback = "-"): string {
  if (value === null || typeof value === "undefined") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function parseHttpRequestLine(raw: string): { method: string; url: string } {
  const trimmed = raw.trim();
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace <= 0) {
    return { method: "UNKNOWN", url: trimmed };
  }
  const method = trimmed.slice(0, firstSpace).trim().toUpperCase();
  const rest = trimmed.slice(firstSpace + 1).trim();
  const end = rest.indexOf(" ");
  const url = end > 0 ? rest.slice(0, end).trim() : rest;
  return { method, url };
}

function synthWarningForMode(modeUsed: string | undefined): string | undefined {
  if (modeUsed !== "actuate") return undefined;
  return "Actuation mode is synthetic. Validate final reproducibility in observe mode for natural behavior.";
}

function renderProbeRecipe(args: {
  targetPath: string;
  probeKey: string;
  httpRequest: string;
  requestMethod?: string;
  requestUrl?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  executionHit: string;
  apiOutcome: string;
  reproStatus: string;
  probeHit: string;
  httpCode: number | string;
  httpResponse: unknown;
  runtimeMode?: string | undefined;
  syntheticWarning?: string | undefined;
  runDuration: string;
  runNotes?: string;
  authStatus?: string;
  authStrategy?: string;
  outputTemplate?: string | undefined;
}): string {
  const parsedRequest = parseHttpRequestLine(args.httpRequest);
  const requestMethod = args.requestMethod ?? parsedRequest.method;
  const requestUrl = args.requestUrl ?? parsedRequest.url;
  const runtimeMode = args.runtimeMode ?? "unknown";
  const syntheticWarning = args.syntheticWarning ?? synthWarningForMode(runtimeMode);

  const recipeSteps = [
    "1. [execute] Run probe utility call",
    `   ${args.httpRequest}`,
    "2. [verify] Inspect probe result",
    `   ${args.probeHit}`,
  ].join("\n");
  const model: RecipeTemplateModel = {
    "recipe.mode": "probe",
    "recipe.mode_reason":
      "Direct probe tool execution output; no request-inference planning was performed.",
    "recipe.steps": recipeSteps,
    "target.path": args.targetPath,
    "probe.key": args.probeKey,
    "http.request": args.httpRequest,
    execution_hit: args.executionHit,
    api_outcome: args.apiOutcome,
    repro_status: args.reproStatus,
    "auth.status": args.authStatus ?? "not_applicable",
    "auth.strategy": args.authStrategy ?? "none",
    "auth.next_action": "-",
    "auth.headers": "-",
    "auth.missing": "-",
    "auth.source": "-",
    "auth.login.path": "-",
    "auth.login.body": "-",
    "probe.hit": args.probeHit,
    "http.code": toText(args.httpCode),
    "http.response": toText(args.httpResponse),
    "run.duration": args.runDuration,
    "run.notes":
      [args.runNotes ?? "-", `runtime.mode=${runtimeMode}`, syntheticWarning ? `warning=${syntheticWarning}` : ""]
        .filter((s) => s.length > 0)
        .join(" | "),
  };
  // Avoid recursive "recipe of a probe call" loops in agent workflows:
  // emit compact JSON by default; only render templates when explicitly requested.
  if (!args.outputTemplate || args.outputTemplate.trim().length === 0) {
    return JSON.stringify(
      {
        mode: "probe",
        request: args.httpRequest,
        requestDetails: {
          method: requestMethod,
          url: requestUrl,
          headers: args.requestHeaders ?? {},
          body: typeof args.requestBody === "undefined" ? null : args.requestBody,
        },
        responseDetails: {
          code: args.httpCode,
          body: args.httpResponse,
        },
        targetKey: args.probeKey,
        executionHit: args.executionHit,
        apiOutcome: args.apiOutcome,
        reproStatus: args.reproStatus,
        probeHit: args.probeHit,
        runtime: {
          mode: runtimeMode,
          synthetic: runtimeMode === "actuate",
          warning: syntheticWarning ?? null,
        },
        httpCode: args.httpCode,
        httpResponse: args.httpResponse,
        runDuration: args.runDuration,
        notes: args.runNotes ?? "-",
      },
      null,
      2,
    );
  }
  const template = args.outputTemplate ?? DEFAULT_RECIPE_OUTPUT_TEMPLATE;
  return renderRecipeTemplate(template, model);
}

export async function probeStatus(args: {
  key: string;
  lineHint?: number;
  baseUrl: string;
  statusPath: string;
  outputTemplate?: string | undefined;
  timeoutMs?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> }> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );

  const resolvedKey = resolveProbeKey(args.key, args.lineHint);
  if (!isLineKey(resolvedKey)) {
    const structuredContent: Record<string, unknown> = {
      request: { key: args.key, resolvedKey, lineHint: args.lineHint, timeoutMs },
      result: {
        hit: false,
        reason: "line_key_required",
      },
    };
    const text = renderProbeRecipe({
      targetPath: resolvedKey,
      probeKey: resolvedKey,
      httpRequest: `GET ${joinUrl(args.baseUrl, args.statusPath)}?key=${encodeURIComponent(resolvedKey)}`,
      requestMethod: "GET",
      requestUrl: `${joinUrl(args.baseUrl, args.statusPath)}?key=${encodeURIComponent(resolvedKey)}`,
      executionHit: "not_hit",
      apiOutcome: "error",
      reproStatus: "line_key_required",
      probeHit: "line probe key required (Class#method:<line>); method-only checks disabled",
      httpCode: 400,
      httpResponse: structuredContent.result,
      runDuration: "Not measured",
      runNotes: "probe_status strict line mode",
      outputTemplate: args.outputTemplate,
    });
    return { content: [{ type: "text", text }], structuredContent };
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
    request: { key: args.key, resolvedKey, lineHint: args.lineHint, url: url.toString(), timeoutMs },
    response: { status: res.status, json: res.json, text: res.json ? undefined : res.text },
  };

  const json = res.json as Record<string, unknown> | null;
  const hitCount = typeof json?.hitCount === "number" ? json.hitCount : 0;
  const text = renderProbeRecipe({
    targetPath: resolvedKey,
    probeKey: resolvedKey,
    httpRequest: `GET ${url.toString()}`,
    requestMethod: "GET",
    requestUrl: url.toString(),
    executionHit: classifyExecutionHitStrictLine(resolvedKey, hitCount > 0),
    apiOutcome: res.status >= 200 && res.status < 300 ? "ok" : "error",
    reproStatus: "status_checked",
    probeHit:
      json !== null
        ? `hitCount=${toText(json.hitCount, "0")}, lastHitEpochMs=${toText(json.lastHitEpochMs, "0")}`
        : "No JSON probe payload",
    httpCode: res.status,
    httpResponse: res.json ?? res.text,
    runtimeMode: typeof json?.mode === "string" ? json.mode : undefined,
    runDuration: "Not measured",
    runNotes: "probe_status executed",
    outputTemplate: args.outputTemplate,
  });

  return { content: [{ type: "text", text }], structuredContent };
}

export async function probeReset(args: {
  key: string;
  lineHint?: number;
  baseUrl: string;
  resetPath: string;
  outputTemplate?: string | undefined;
  timeoutMs?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> }> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );

  const resolvedKey = resolveProbeKey(args.key, args.lineHint);
  if (!isLineKey(resolvedKey)) {
    const structuredContent: Record<string, unknown> = {
      request: { key: args.key, resolvedKey, lineHint: args.lineHint, timeoutMs },
      result: {
        reset: false,
        reason: "line_key_required",
      },
    };
    const text = renderProbeRecipe({
      targetPath: resolvedKey,
      probeKey: resolvedKey,
      httpRequest: `POST ${joinUrl(args.baseUrl, args.resetPath)}`,
      requestMethod: "POST",
      requestUrl: joinUrl(args.baseUrl, args.resetPath),
      requestHeaders: { "content-type": "application/json" },
      requestBody: { key: resolvedKey },
      executionHit: "not_hit",
      apiOutcome: "error",
      reproStatus: "line_key_required",
      probeHit: "line probe key required (Class#method:<line>); method-only checks disabled",
      httpCode: 400,
      httpResponse: structuredContent.result,
      runDuration: "Not measured",
      runNotes: "probe_reset strict line mode",
      outputTemplate: args.outputTemplate,
    });
    return { content: [{ type: "text", text }], structuredContent };
  }

  const url = joinUrl(args.baseUrl, args.resetPath);
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

  if (res.status >= 200 && res.status < 300) {
    LAST_RESET_EPOCH_BY_KEY.set(resolvedKey, Date.now());
  }

  const text = renderProbeRecipe({
    targetPath: resolvedKey,
    probeKey: resolvedKey,
    httpRequest: `POST ${url}`,
    requestMethod: "POST",
    requestUrl: url,
    requestHeaders: { "content-type": "application/json" },
    requestBody: { key: resolvedKey },
    executionHit: "not_applicable",
    apiOutcome: res.status >= 200 && res.status < 300 ? "ok" : "error",
    reproStatus: res.status >= 200 && res.status < 300 ? "reset_done" : "reset_failed",
    probeHit: "counter reset requested",
    httpCode: res.status,
    httpResponse: res.json ?? res.text,
    runDuration: "Not measured",
    runNotes: "probe_reset executed",
    outputTemplate: args.outputTemplate,
  });

  return { content: [{ type: "text", text }], structuredContent };
}

export async function probeWaitHit(args: {
  key: string;
  lineHint?: number;
  baseUrl: string;
  statusPath: string;
  outputTemplate?: string | undefined;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxRetries?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> }> {
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

  if (!isLineKey(resolvedKey)) {
    const structuredContent: Record<string, unknown> = {
      request: {
        key: args.key,
        resolvedKey,
        timeoutMs,
        pollIntervalMs,
        maxRetries,
      },
      result: {
        hit: false,
        inline: false,
        reason: "line_key_required",
      },
    };
    const text = renderProbeRecipe({
      targetPath: resolvedKey,
      probeKey: resolvedKey,
      httpRequest: `POLL ${joinUrl(args.baseUrl, args.statusPath)} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
      requestMethod: "POLL",
      requestUrl: joinUrl(args.baseUrl, args.statusPath),
      requestBody: { key: resolvedKey, maxRetries, pollIntervalMs, timeoutMs },
      executionHit: "not_hit",
      apiOutcome: "error",
      reproStatus: "line_key_required",
      probeHit: "line probe key required (Class#method:<line>); method-only checks disabled",
      httpCode: 400,
      httpResponse: structuredContent.result,
      runDuration: "Not measured",
      runNotes: "probe_wait_hit strict line mode",
      outputTemplate: args.outputTemplate,
    });
    return { content: [{ type: "text", text }], structuredContent };
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
      outputTemplate: args.outputTemplate,
    });
    const baseline = parseProbeSnapshot(baselineRes.structuredContent as Record<string, unknown>);
    const baselineHitCount = baseline.hitCount ?? 0;
    const baselineLastHitEpochMs = baseline.lastHitEpochMs ?? 0;

    if (
      baselineHitCount > 0 &&
      baselineLastHitEpochMs > 0 &&
      baselineLastHitEpochMs >= inlineStartEpochMs
    ) {
      const baselineJson = (
        (baselineRes.structuredContent as any)?.response?.json ?? {}
      ) as Record<string, unknown>;
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
        baseline: {
          hitCount: baselineHitCount,
          lastHitEpochMs: baselineLastHitEpochMs,
        },
        result: {
          hit: true,
          inline: true,
          source: "already_hit_since_inline_start",
          hitCount: baselineHitCount,
          hitDelta: 0,
          lastStatus: baselineJson,
        },
      };
      const text = renderProbeRecipe({
        targetPath: resolvedKey,
        probeKey: resolvedKey,
        httpRequest: `POLL ${joinUrl(args.baseUrl, args.statusPath)} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
        requestMethod: "POLL",
        requestUrl: joinUrl(args.baseUrl, args.statusPath),
        requestBody: { key: resolvedKey, maxRetries, pollIntervalMs, timeoutMs },
        executionHit: classifyExecutionHitStrictLine(resolvedKey, true),
        apiOutcome: "ok",
        reproStatus: classifyReproStatusStrictLine(resolvedKey, true),
        probeHit: `inline line hit confirmed; hitCount=${baselineHitCount}`,
        httpCode: 200,
        httpResponse: structuredContent.result,
        runtimeMode: typeof baselineJson?.mode === "string" ? baselineJson.mode : undefined,
        runDuration: `${Date.now() - waitStartEpochMs}ms`,
        runNotes: "probe_wait_hit detected baseline inline hit",
        outputTemplate: args.outputTemplate,
      });
      return { content: [{ type: "text", text }], structuredContent };
    }

    const start = waitStartEpochMs;
    while (Date.now() - start < timeoutMs) {
      const res = await probeStatus({
        key: resolvedKey,
        baseUrl: args.baseUrl,
        statusPath: args.statusPath,
        timeoutMs: Math.min(5_000, timeoutMs),
        outputTemplate: args.outputTemplate,
      });
      last = res.structuredContent as Record<string, unknown>;

      const json = (last as any)?.response?.json as Record<string, unknown> | undefined;
      const hitCount = typeof json?.hitCount === "number" ? json.hitCount : null;
      const lastHitEpochMs = typeof json?.lastHitEpochMs === "number" ? json.lastHitEpochMs : null;
      if (hitCount !== null) {
        const hitDelta = hitCount - baselineHitCount;
        const isInlineByCount = hitDelta > 0;
        const isInlineByTime = lastHitEpochMs !== null && lastHitEpochMs >= inlineStartEpochMs;
        const isInline = isInlineByCount && isInlineByTime;
        if (isInline) {
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
            baseline: {
              hitCount: baselineHitCount,
              lastHitEpochMs: baselineLastHitEpochMs,
            },
            result: {
              hit: true,
              inline: true,
              hitCount,
              hitDelta,
              lastStatus: json,
            },
          };
          const text = renderProbeRecipe({
            targetPath: resolvedKey,
            probeKey: resolvedKey,
            httpRequest: `POLL ${joinUrl(args.baseUrl, args.statusPath)} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
            requestMethod: "POLL",
            requestUrl: joinUrl(args.baseUrl, args.statusPath),
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
            outputTemplate: args.outputTemplate,
          });
          return { content: [{ type: "text", text }], structuredContent };
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
    request: {
      key: args.key,
      resolvedKey,
      timeoutMs,
      pollIntervalMs,
      maxRetries,
    },
    result: {
      hit: false,
      inline: false,
      reason: "timeout_no_inline_hit",
      last,
      staleCandidate,
    },
  };
  const text = renderProbeRecipe({
    targetPath: resolvedKey,
    probeKey: resolvedKey,
    httpRequest: `POLL ${joinUrl(args.baseUrl, args.statusPath)} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
    requestMethod: "POLL",
    requestUrl: joinUrl(args.baseUrl, args.statusPath),
    requestBody: { key: resolvedKey, maxRetries, pollIntervalMs, timeoutMs },
    executionHit: classifyExecutionHitStrictLine(resolvedKey, false),
    apiOutcome: "timeout",
    reproStatus: classifyReproStatusStrictLine(resolvedKey, false),
    probeHit: "no inline line hit observed",
    httpCode: 408,
    httpResponse: structuredContent.result,
    runtimeMode: typeof (last as any)?.response?.json?.mode === "string" ? (last as any).response.json.mode : undefined,
    runDuration: `${timeoutMs}ms x ${maxRetries}`,
    runNotes: "probe_wait_hit timeout",
    outputTemplate: args.outputTemplate,
  });
  return { content: [{ type: "text", text }], structuredContent };
}

export async function probeActuate(args: {
  baseUrl: string;
  actuatePath: string;
  mode?: "observe" | "actuate";
  actuatorId?: string;
  targetKey?: string;
  returnBoolean?: boolean;
  outputTemplate?: string | undefined;
  timeoutMs?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> }> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );

  if (args.mode === "actuate") {
    if (!args.targetKey || !isLineKey(args.targetKey)) {
      const structuredContent: Record<string, unknown> = {
        request: {
          mode: args.mode,
          targetKey: args.targetKey,
          returnBoolean: args.returnBoolean,
          timeoutMs,
        },
        result: {
          actuated: false,
          reason: "line_key_required",
        },
      };
      const text = renderProbeRecipe({
        targetPath: args.targetKey ?? "probe_actuation",
        probeKey: args.targetKey ?? "probe_actuation",
        httpRequest: `POST ${joinUrl(args.baseUrl, args.actuatePath)}`,
        requestMethod: "POST",
        requestUrl: joinUrl(args.baseUrl, args.actuatePath),
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
        outputTemplate: args.outputTemplate,
      });
      return { content: [{ type: "text", text }], structuredContent };
    }
  }

  const url = joinUrl(args.baseUrl, args.actuatePath);
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
  const effectiveMode = typeof json.mode === "string" ? json.mode : args.mode ?? "observe";
  const effectiveActuatorId = typeof json.actuatorId === "string" ? json.actuatorId : args.actuatorId ?? "";
  const effectiveTargetKey = typeof json.targetKey === "string" ? json.targetKey : args.targetKey ?? "";
  const branchDecision =
    typeof json.returnBoolean === "boolean"
      ? json.returnBoolean
      : typeof args.returnBoolean === "boolean"
        ? args.returnBoolean
        : undefined;

  const text = renderProbeRecipe({
    targetPath: effectiveTargetKey || "probe_actuation",
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
    outputTemplate: args.outputTemplate,
  });

  return { content: [{ type: "text", text }], structuredContent };
}
