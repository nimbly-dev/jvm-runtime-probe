import type { ProbeCaptureRecordPayload } from "@/models/probe_runtime_capture.model";

const ENV_INCLUDE_EXECUTION_PATHS = "MCP_PROBE_INCLUDE_EXECUTION_PATHS";

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return defaultValue;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return defaultValue;
}

export function includeExecutionPathsInProbePayload(): boolean {
  return readBooleanEnv(ENV_INCLUDE_EXECUTION_PATHS, false);
}

export function compactExecutionPaths(paths: unknown): string[] | undefined {
  if (!includeExecutionPathsInProbePayload()) return undefined;
  if (!Array.isArray(paths)) return undefined;
  const normalized = paths.filter((value): value is string => typeof value === "string");
  return normalized.length > 0 ? normalized : undefined;
}

export function compactCapturePreview(preview: Record<string, unknown>): Record<string, unknown> {
  const capturedAtEpoch =
    typeof preview.capturedAtEpoch === "number"
      ? preview.capturedAtEpoch
      : undefined;
  const out: Record<string, unknown> = {};
  if (typeof preview.available === "boolean") out.available = preview.available;
  if (typeof preview.captureId === "string") out.captureId = preview.captureId;
  if (typeof capturedAtEpoch === "number") out.capturedAtEpoch = capturedAtEpoch;
  if (typeof preview.methodKey === "string") out.methodKey = preview.methodKey;
  if (typeof preview.redactionMode === "string") out.redactionMode = preview.redactionMode;
  if (typeof preview.truncatedAny === "boolean") out.truncatedAny = preview.truncatedAny;
  const executionPaths = compactExecutionPaths(preview.executionPaths);
  if (executionPaths) out.executionPaths = executionPaths;
  return out;
}

export function compactRuntimeHints(runtime: Record<string, unknown>): Record<string, unknown> {
  const appPort =
    typeof runtime.appPort === "object" && runtime.appPort !== null
      ? ({ ...(runtime.appPort as Record<string, unknown>) } as Record<string, unknown>)
      : undefined;
  if (appPort) {
    delete appPort.confidence;
  }
  const out: Record<string, unknown> = {};
  if (typeof runtime.mode === "string") out.mode = runtime.mode;
  if (typeof runtime.actuatorId === "string") out.actuatorId = runtime.actuatorId;
  if (typeof runtime.actuateTargetKey === "string") out.actuateTargetKey = runtime.actuateTargetKey;
  if (typeof runtime.actuateReturnBoolean === "boolean") {
    out.actuateReturnBoolean = runtime.actuateReturnBoolean;
  }
  if (appPort && Object.keys(appPort).length > 0) out.appPort = appPort;
  return out;
}

export function compactStatusPayload(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  const out: Record<string, unknown> = {};
  if (typeof raw.key === "string") out.key = raw.key;
  if (typeof raw.hitCount === "number") out.hitCount = raw.hitCount;
  const lastHitEpochMs =
    typeof raw.lastHitEpochMs === "number"
      ? raw.lastHitEpochMs
      : typeof raw.lastHitMs === "number"
        ? raw.lastHitMs
        : undefined;
  if (typeof lastHitEpochMs === "number") out.lastHitEpochMs = lastHitEpochMs;
  if (typeof raw.lineResolvable === "boolean") out.lineResolvable = raw.lineResolvable;
  if (typeof raw.lineValidation === "string") out.lineValidation = raw.lineValidation;
  if (typeof raw.contractVersion === "string") out.contractVersion = raw.contractVersion;
  if (typeof raw.mode === "string") out.mode = raw.mode;
  if (typeof raw.capturePreview === "object" && raw.capturePreview !== null) {
    out.capturePreview = compactCapturePreview(raw.capturePreview as Record<string, unknown>);
  }
  if (typeof raw.runtime === "object" && raw.runtime !== null) {
    const runtime = compactRuntimeHints(raw.runtime as Record<string, unknown>);
    if (Object.keys(runtime).length > 0) out.runtime = runtime;
  }
  return out;
}

export function compactCaptureRecord(capture: ProbeCaptureRecordPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rawCapture = capture as Record<string, unknown>;
  const capturedAtEpoch =
    typeof rawCapture.capturedAtEpoch === "number"
      ? rawCapture.capturedAtEpoch
      : undefined;
  if (typeof capture.captureId === "string") out.captureId = capture.captureId;
  if (typeof capture.methodKey === "string") out.methodKey = capture.methodKey;
  if (typeof capturedAtEpoch === "number") out.capturedAtEpoch = capturedAtEpoch;
  if (typeof capture.redactionMode === "string") out.redactionMode = capture.redactionMode;
  if (typeof capture.truncatedAny === "boolean") out.truncatedAny = capture.truncatedAny;
  const args = Array.isArray(rawCapture.args)
    ? (rawCapture.args as unknown[])
    : [];
  out.argsCount = args.length;
  out.hasReturnValue = rawCapture.returnValue != null;
  out.hasThrownValue = rawCapture.thrownValue != null;
  const executionPaths = compactExecutionPaths(capture.executionPaths);
  if (executionPaths) out.executionPaths = executionPaths;
  return out;
}
