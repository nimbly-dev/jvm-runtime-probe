import { fetchJson } from "../lib/http";
import { CONFIG_DEFAULTS } from "../config/defaults";
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
const DEFAULT_PROBE_WAIT_UNREACHABLE_MAX_RETRIES =
  CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_MAX_RETRIES;
const HARD_MAX_PROBE_WAIT_UNREACHABLE_MAX_RETRIES =
  CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_MAX_RETRIES_MAX;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readProbeUnreachableErrorMessage(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.includes("Probe endpoint unreachable:") ? raw : null;
}

async function probeStatusWithUnreachablePolicy(args: {
  key: string;
  baseUrl: string;
  statusPath: string;
  timeoutMs: number;
  pollIntervalMs: number;
  unreachableRetryEnabled: boolean;
  unreachableMaxRetries: number;
}): Promise<
  | { kind: "status"; response: ToolTextResponse }
  | {
      kind: "unreachable";
      details: {
        endpoint: string;
        lastError: string;
        unreachableAttempts: number;
        unreachableMaxRetries: number;
        unreachableRetryEnabled: boolean;
      };
    }
> {
  const endpointUrl = new URL(joinUrl(args.baseUrl, args.statusPath));
  endpointUrl.searchParams.set("key", args.key);
  const maxAttempts = args.unreachableRetryEnabled ? args.unreachableMaxRetries : 1;
  let lastError = "Probe endpoint unreachable";

  for (let unreachableAttempt = 1; unreachableAttempt <= maxAttempts; unreachableAttempt++) {
    try {
      const response = await probeStatus({
        key: args.key,
        baseUrl: args.baseUrl,
        statusPath: args.statusPath,
        timeoutMs: args.timeoutMs,
      });
      return { kind: "status", response };
    } catch (err) {
      const unreachableError = readProbeUnreachableErrorMessage(err);
      if (!unreachableError) throw err;
      lastError = unreachableError;
      if (unreachableAttempt >= maxAttempts) {
        return {
          kind: "unreachable",
          details: {
            endpoint: endpointUrl.toString(),
            lastError,
            unreachableAttempts: unreachableAttempt,
            unreachableMaxRetries: maxAttempts,
            unreachableRetryEnabled: args.unreachableRetryEnabled,
          },
        };
      }
      await sleep(args.pollIntervalMs);
    }
  }

  return {
    kind: "unreachable",
    details: {
      endpoint: endpointUrl.toString(),
      lastError,
      unreachableAttempts: maxAttempts,
      unreachableMaxRetries: maxAttempts,
      unreachableRetryEnabled: args.unreachableRetryEnabled,
    },
  };
}

function buildServiceUnreachableResponse(args: {
  key: string;
  resolvedKey: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maxRetries: number;
  unreachableRetryEnabled: boolean;
  unreachableMaxRetries: number;
  attempt: number;
  waitStartEpochMs: number;
  inlineStartEpochMs: number;
  stage: "baseline_status_check" | "poll_status_check";
  baselineHitCount?: number;
  baselineLastHitEpochMs?: number;
  details: {
    endpoint: string;
    lastError: string;
    unreachableAttempts: number;
    unreachableMaxRetries: number;
    unreachableRetryEnabled: boolean;
  };
}): ToolTextResponse {
  const structuredContent: Record<string, unknown> = {
    request: {
      key: args.key,
      resolvedKey: args.resolvedKey,
      timeoutMs: args.timeoutMs,
      pollIntervalMs: args.pollIntervalMs,
      maxRetries: args.maxRetries,
      unreachableRetryEnabled: args.unreachableRetryEnabled,
      unreachableMaxRetries: args.unreachableMaxRetries,
      attempt: args.attempt,
      waitStartEpochMs: args.waitStartEpochMs,
      inlineStartEpochMs: args.inlineStartEpochMs,
      stage: args.stage,
    },
    result: {
      hit: false,
      inline: false,
      reason: "service_unreachable",
      endpoint: args.details.endpoint,
      lastError: args.details.lastError,
      unreachableAttempts: args.details.unreachableAttempts,
      unreachableMaxRetries: args.details.unreachableMaxRetries,
      unreachableRetryEnabled: args.details.unreachableRetryEnabled,
    },
  };
  if (
    typeof args.baselineHitCount === "number" &&
    typeof args.baselineLastHitEpochMs === "number"
  ) {
    structuredContent.baseline = {
      hitCount: args.baselineHitCount,
      lastHitEpochMs: args.baselineLastHitEpochMs,
    };
  }
  const text = formatProbeOutput({
    probeKey: args.resolvedKey,
    httpRequest: `POLL ${args.details.endpoint}`,
    requestMethod: "POLL",
    requestUrl: args.details.endpoint,
    requestBody: {
      key: args.resolvedKey,
      timeoutMs: args.timeoutMs,
      pollIntervalMs: args.pollIntervalMs,
      maxRetries: args.maxRetries,
      unreachableRetryEnabled: args.unreachableRetryEnabled,
      unreachableMaxRetries: args.unreachableMaxRetries,
    },
    executionHit: "not_hit",
    apiOutcome: "error",
    reproStatus: "probe_unreachable",
    probeHit:
      `probe endpoint unreachable; attempts=${args.details.unreachableAttempts}/` +
      `${args.details.unreachableMaxRetries}`,
    httpCode: 503,
    httpResponse: structuredContent.result,
    runDuration: `${Date.now() - args.waitStartEpochMs}ms`,
    runNotes: `probe_wait_hit service unreachable during ${args.stage}`,
  });
  return buildTextResponse(structuredContent, text);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalStringArray(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length > 0 ? out : undefined;
}

function validateSelectorCount(
  selectorName: "probe_status" | "probe_reset",
  selectors: Array<{ enabled: boolean; name: string }>,
): void {
  const active = selectors.filter((s) => s.enabled).map((s) => s.name);
  if (active.length === 1) return;
  if (active.length === 0) {
    throw new Error(
      `${selectorName} requires exactly one selector: ` +
        (selectorName === "probe_status" ? "`key` or `keys`." : "`key`, `keys`, or `className`."),
    );
  }
  throw new Error(
    `${selectorName} received conflicting selectors (${active.join(", ")}). ` +
      "Provide exactly one selector.",
  );
}

function buildBatchSummary(results: Array<{ apiOutcome: string }>): {
  total: number;
  ok: number;
  failed: number;
} {
  let ok = 0;
  for (const result of results) {
    if (result.apiOutcome === "ok") ok += 1;
  }
  return { total: results.length, ok, failed: results.length - ok };
}

function buildBatchResponse(args: {
  operation: "status" | "reset";
  request: Record<string, unknown>;
  results: Array<Record<string, unknown> & { apiOutcome: string }>;
  response?: unknown;
}): ToolTextResponse {
  const summary = buildBatchSummary(args.results);
  const payload = {
    mode: "probe_batch",
    operation: args.operation,
    request: args.request,
    summary,
    results: args.results,
    ...(typeof args.response !== "undefined" ? { response: args.response } : {}),
  };
  return buildTextResponse(payload, JSON.stringify(payload, null, 2));
}

async function probeStatusSingle(args: {
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

async function probeStatusBatch(args: {
  keys: string[];
  baseUrl: string;
  statusPath: string;
  timeoutMs?: number;
}): Promise<ToolTextResponse> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );
  const url = joinUrl(args.baseUrl, args.statusPath);
  const keys = normalizeOptionalStringArray(args.keys) ?? [];

  const localByKey = new Map<string, Record<string, unknown> & { apiOutcome: string }>();
  const lineKeys: string[] = [];
  for (const key of keys) {
    if (!isLineKey(key)) {
      localByKey.set(key, {
        key,
        executionHit: "not_hit",
        apiOutcome: "error",
        reproStatus: "line_key_required",
        probeHit: "line probe key required (Class#method:<line>); method-only checks disabled",
        httpCode: 400,
        httpResponse: { hit: false, reason: "line_key_required" },
      });
      continue;
    }
    lineKeys.push(key);
  }

  let remoteResponse: { status: number; json: unknown; text: string | null } | undefined;
  const remoteByKey = new Map<string, Record<string, unknown>>();
  if (lineKeys.length > 0) {
    try {
      remoteResponse = await fetchJson(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: lineKeys }),
        timeoutMs,
      });
    } catch (err) {
      throw new Error(probeUnreachableMessage(url, err));
    }
    const rawJson = remoteResponse.json as Record<string, unknown> | null;
    const rawResults = Array.isArray(rawJson?.results)
      ? (rawJson.results as Array<Record<string, unknown>>)
      : [];
    for (const row of rawResults) {
      if (typeof row?.key !== "string") continue;
      remoteByKey.set(row.key, row);
    }
  }

  for (const key of lineKeys) {
    const row = remoteByKey.get(key);
    if (!row) {
      localByKey.set(key, {
        key,
        executionHit: "not_hit",
        apiOutcome: "error",
        reproStatus: "status_failed",
        probeHit: "missing batch status row for key",
        httpCode: remoteResponse?.status ?? 500,
        httpResponse: remoteResponse?.json ?? remoteResponse?.text ?? null,
      });
      continue;
    }
    const hitCount = typeof row.hitCount === "number" ? row.hitCount : 0;
    const lineValidation = readLineValidation(row);
    localByKey.set(key, {
      key,
      executionHit: lineValidation.invalidLineTarget
        ? "not_hit"
        : classifyExecutionHitStrictLine(key, hitCount > 0),
      apiOutcome:
        typeof row.ok === "boolean"
          ? row.ok
            ? "ok"
            : "error"
          : remoteResponse && remoteResponse.status >= 200 && remoteResponse.status < 300
            ? "ok"
            : "error",
      reproStatus: lineValidation.invalidLineTarget ? "invalid_line_target" : "status_checked",
      probeHit: lineValidation.invalidLineTarget
        ? invalidLineTargetProbeHitMessage(hitCount)
        : `hitCount=${hitCount}, lastHitEpochMs=${typeof row.lastHitEpochMs === "number" ? row.lastHitEpochMs : 0}`,
      httpCode: remoteResponse?.status ?? 200,
      httpResponse: row,
      runtimeMode: typeof row.mode === "string" ? row.mode : undefined,
    });
  }
  const orderedResults: Array<Record<string, unknown> & { apiOutcome: string }> = [];
  for (const key of keys) {
    const row = localByKey.get(key);
    if (!row) continue;
    orderedResults.push(row);
  }

  return buildBatchResponse({
    operation: "status",
    request: { keys, url, timeoutMs },
    results: orderedResults,
    response: remoteResponse
      ? { status: remoteResponse.status, json: remoteResponse.json, text: remoteResponse.text }
      : undefined,
  });
}

export async function probeStatus(args: {
  key?: string;
  keys?: string[];
  lineHint?: number;
  baseUrl: string;
  statusPath: string;
  timeoutMs?: number;
}): Promise<ToolTextResponse> {
  const key = normalizeOptionalString(args.key);
  const keys = normalizeOptionalStringArray(args.keys);
  validateSelectorCount("probe_status", [
    { enabled: typeof key === "string", name: "key" },
    { enabled: Array.isArray(keys), name: "keys" },
  ]);
  if (keys) {
    if (typeof args.lineHint === "number") {
      throw new Error("probe_status does not allow lineHint with keys[]. Use explicit line keys.");
    }
    const batchArgs: Parameters<typeof probeStatusBatch>[0] = {
      keys,
      baseUrl: args.baseUrl,
      statusPath: args.statusPath,
    };
    if (typeof args.timeoutMs === "number") batchArgs.timeoutMs = args.timeoutMs;
    return probeStatusBatch(batchArgs);
  }
  const singleArgs: Parameters<typeof probeStatusSingle>[0] = {
    key: key!,
    baseUrl: args.baseUrl,
    statusPath: args.statusPath,
  };
  if (typeof args.lineHint === "number") singleArgs.lineHint = args.lineHint;
  if (typeof args.timeoutMs === "number") singleArgs.timeoutMs = args.timeoutMs;
  return probeStatusSingle(singleArgs);
}

async function probeResetSingle(args: {
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

async function probeResetBatch(args: {
  keys?: string[];
  className?: string;
  baseUrl: string;
  resetPath: string;
  timeoutMs?: number;
}): Promise<ToolTextResponse> {
  const timeoutMs = clampInt(
    args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    1_000,
    HARD_MAX_PROBE_TIMEOUT_MS,
  );
  const url = joinUrl(args.baseUrl, args.resetPath);
  const keys = normalizeOptionalStringArray(args.keys);
  const className = normalizeOptionalString(args.className);
  const requestedKeys = keys ? [...keys] : undefined;
  let requestedLineKeys: string[] = [];

  let requestBody: Record<string, unknown>;
  const localByKey = new Map<string, Record<string, unknown> & { apiOutcome: string }>();

  if (keys) {
    const lineKeys: string[] = [];
    for (const key of keys) {
      if (!isLineKey(key)) {
        localByKey.set(key, {
          key,
          executionHit: "not_applicable",
          apiOutcome: "error",
          reproStatus: "line_key_required",
          probeHit: "line probe key required (Class#method:<line>); method-only checks disabled",
          httpCode: 400,
          httpResponse: { reset: false, reason: "line_key_required" },
        });
        continue;
      }
      lineKeys.push(key);
    }
    requestedLineKeys = [...lineKeys];
    requestBody = { keys: lineKeys };
  } else if (className) {
    requestBody = { className };
  } else {
    requestBody = { keys: [] };
  }

  let res;
  try {
    res = await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
      timeoutMs,
    });
  } catch (err) {
    throw new Error(probeUnreachableMessage(url, err));
  }

  const json = res.json as Record<string, unknown> | null;
  const rawResults = Array.isArray(json?.results)
    ? (json.results as Array<Record<string, unknown>>)
    : [];
  const remoteByKey = new Map<string, Record<string, unknown>>();
  for (const row of rawResults) {
    if (typeof row?.key !== "string") continue;
    remoteByKey.set(row.key, row);
  }
  const remoteResults: Array<Record<string, unknown> & { apiOutcome: string }> = [];
  for (const row of rawResults) {
    const key = typeof row?.key === "string" ? row.key : undefined;
    if (!key) continue;
    const lineValidation = readLineValidation(row);
    const rowOk =
      typeof row.ok === "boolean" ? row.ok : res.status >= 200 && res.status < 300;
    if (rowOk) {
      LAST_RESET_EPOCH_BY_KEY.set(key, Date.now());
    }
    remoteResults.push({
      key,
      executionHit: "not_applicable",
      apiOutcome: rowOk ? "ok" : "error",
      reproStatus: lineValidation.invalidLineTarget
        ? "invalid_line_target"
        : rowOk
          ? "reset_done"
          : "reset_failed",
      probeHit: lineValidation.invalidLineTarget
        ? `${invalidLineTargetProbeHitMessage(0)}; counter reset requested`
        : "counter reset requested",
      httpCode: res.status,
      httpResponse: row,
    });
  }
  for (const key of requestedLineKeys) {
    if (remoteByKey.has(key)) continue;
    remoteResults.push({
      key,
      executionHit: "not_applicable",
      apiOutcome: "error",
      reproStatus: "reset_failed",
      probeHit: "missing batch reset row for key",
      httpCode: res.status,
      httpResponse: res.json ?? res.text,
    });
  }
  const orderedResults: Array<Record<string, unknown> & { apiOutcome: string }> = [];
  if (requestedKeys) {
    const remoteResultByKey = new Map<string, Record<string, unknown> & { apiOutcome: string }>();
    for (const row of remoteResults) {
      if (typeof row.key !== "string") continue;
      if (!remoteResultByKey.has(row.key)) remoteResultByKey.set(row.key, row);
    }
    for (const key of requestedKeys) {
      if (localByKey.has(key)) orderedResults.push(localByKey.get(key)!);
      const remote = remoteResultByKey.get(key);
      if (remote) orderedResults.push(remote);
    }
  } else {
    orderedResults.push(...remoteResults);
  }

  return buildBatchResponse({
    operation: "reset",
    request: { ...(keys ? { keys } : {}), ...(className ? { className } : {}), url, timeoutMs },
    results: orderedResults,
    response: { status: res.status, json: res.json, text: res.json ? undefined : res.text },
  });
}

export async function probeReset(args: {
  key?: string;
  keys?: string[];
  className?: string;
  lineHint?: number;
  baseUrl: string;
  resetPath: string;
  timeoutMs?: number;
}): Promise<ToolTextResponse> {
  const key = normalizeOptionalString(args.key);
  const keys = normalizeOptionalStringArray(args.keys);
  const className = normalizeOptionalString(args.className);
  validateSelectorCount("probe_reset", [
    { enabled: typeof key === "string", name: "key" },
    { enabled: Array.isArray(keys), name: "keys" },
    { enabled: typeof className === "string", name: "className" },
  ]);
  if (keys || className) {
    if (typeof args.lineHint === "number") {
      throw new Error(
        "probe_reset does not allow lineHint with keys[] or className. Use explicit line keys.",
      );
    }
    const batchArgs: Parameters<typeof probeResetBatch>[0] = {
      ...(keys ? { keys } : {}),
      ...(className ? { className } : {}),
      baseUrl: args.baseUrl,
      resetPath: args.resetPath,
    };
    if (typeof args.timeoutMs === "number") batchArgs.timeoutMs = args.timeoutMs;
    return probeResetBatch(batchArgs);
  }
  const singleArgs: Parameters<typeof probeResetSingle>[0] = {
    key: key!,
    baseUrl: args.baseUrl,
    resetPath: args.resetPath,
  };
  if (typeof args.lineHint === "number") singleArgs.lineHint = args.lineHint;
  if (typeof args.timeoutMs === "number") singleArgs.timeoutMs = args.timeoutMs;
  return probeResetSingle(singleArgs);
}

export async function probeWaitHit(args: {
  key: string;
  lineHint?: number;
  baseUrl: string;
  statusPath: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxRetries?: number;
  unreachableRetryEnabled?: boolean;
  unreachableMaxRetries?: number;
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
  const unreachableRetryEnabled = args.unreachableRetryEnabled === true;
  const unreachableMaxRetries = clampInt(
    args.unreachableMaxRetries ?? DEFAULT_PROBE_WAIT_UNREACHABLE_MAX_RETRIES,
    1,
    HARD_MAX_PROBE_WAIT_UNREACHABLE_MAX_RETRIES,
  );
  const resolvedKey = resolveProbeKey(args.key, args.lineHint);
  const pollUrl = joinUrl(args.baseUrl, args.statusPath);

  if (!isLineKey(resolvedKey)) {
    return buildLineKeyRequiredResponse({
      request: {
        key: args.key,
        resolvedKey,
        timeoutMs,
        pollIntervalMs,
        maxRetries,
        unreachableRetryEnabled,
        unreachableMaxRetries,
      },
      targetPath: resolvedKey,
      httpRequest: `POLL ${pollUrl} (maxRetries=${maxRetries}, pollMs=${pollIntervalMs})`,
      requestMethod: "POLL",
      requestUrl: pollUrl,
      requestBody: {
        key: resolvedKey,
        maxRetries,
        pollIntervalMs,
        timeoutMs,
        unreachableRetryEnabled,
        unreachableMaxRetries,
      },
      result: { hit: false, inline: false, reason: "line_key_required" },
      runNotes: "probe_wait_hit strict line mode",
    });
  }

  let last: Record<string, unknown> | null = null;
  let staleCandidate: Record<string, unknown> | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const waitStartEpochMs = Date.now();
    const inlineStartEpochMs = LAST_RESET_EPOCH_BY_KEY.get(resolvedKey) ?? waitStartEpochMs;

    const baselineStatus = await probeStatusWithUnreachablePolicy({
      key: resolvedKey,
      baseUrl: args.baseUrl,
      statusPath: args.statusPath,
      timeoutMs: Math.min(5_000, timeoutMs),
      pollIntervalMs,
      unreachableRetryEnabled,
      unreachableMaxRetries,
    });
    if (baselineStatus.kind === "unreachable") {
      return buildServiceUnreachableResponse({
        key: args.key,
        resolvedKey,
        timeoutMs,
        pollIntervalMs,
        maxRetries,
        unreachableRetryEnabled,
        unreachableMaxRetries,
        attempt,
        waitStartEpochMs,
        inlineStartEpochMs,
        stage: "baseline_status_check",
        details: baselineStatus.details,
      });
    }
    const baselineRes = baselineStatus.response;
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
          unreachableRetryEnabled,
          unreachableMaxRetries,
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
      const polledStatus = await probeStatusWithUnreachablePolicy({
        key: resolvedKey,
        baseUrl: args.baseUrl,
        statusPath: args.statusPath,
        timeoutMs: Math.min(5_000, timeoutMs),
        pollIntervalMs,
        unreachableRetryEnabled,
        unreachableMaxRetries,
      });
      if (polledStatus.kind === "unreachable") {
        return buildServiceUnreachableResponse({
          key: args.key,
          resolvedKey,
          timeoutMs,
          pollIntervalMs,
          maxRetries,
          unreachableRetryEnabled,
          unreachableMaxRetries,
          attempt,
          waitStartEpochMs,
          inlineStartEpochMs,
          stage: "poll_status_check",
          baselineHitCount,
          baselineLastHitEpochMs,
          details: polledStatus.details,
        });
      }
      const res = polledStatus.response;
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
            unreachableRetryEnabled,
            unreachableMaxRetries,
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
              unreachableRetryEnabled,
              unreachableMaxRetries,
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
      await sleep(pollIntervalMs);
    }
  }

  const structuredContent: Record<string, unknown> = {
    request: {
      key: args.key,
      resolvedKey,
      timeoutMs,
      pollIntervalMs,
      maxRetries,
      unreachableRetryEnabled,
      unreachableMaxRetries,
    },
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
