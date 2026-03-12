export function readLineValidation(json: Record<string, unknown> | null): {
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

function sanitizeRuntimeHints(runtime: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...runtime };
  if (typeof out.serverEpochMs === "number") {
    out.serverMs = out.serverEpochMs;
    delete out.serverEpochMs;
  }
  const applicationType =
    typeof out.applicationType === "object" && out.applicationType !== null
      ? { ...(out.applicationType as Record<string, unknown>) }
      : undefined;
  if (applicationType) {
    delete applicationType.confidence;
    out.applicationType = applicationType;
  }
  const appPort =
    typeof out.appPort === "object" && out.appPort !== null
      ? { ...(out.appPort as Record<string, unknown>) }
      : undefined;
  if (appPort) {
    delete appPort.confidence;
    out.appPort = appPort;
  }
  return out;
}

function sanitizeCapturePreview(capturePreview: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...capturePreview };
  if (typeof out.capturedAtEpochMs === "number") {
    out.capturedAtMs = out.capturedAtEpochMs;
    delete out.capturedAtEpochMs;
  }
  return out;
}

export function normalizeStatusJson(
  raw: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!raw) return null;
  const probe =
    typeof raw.probe === "object" && raw.probe !== null
      ? (raw.probe as Record<string, unknown>)
      : raw;
  const runtime =
    typeof raw.runtime === "object" && raw.runtime !== null
      ? (raw.runtime as Record<string, unknown>)
      : null;
  const out: Record<string, unknown> = { ...probe };
  if (typeof out.lastHitEpochMs === "number") {
    out.lastHitMs = out.lastHitEpochMs;
    delete out.lastHitEpochMs;
  }
  if (typeof raw.contractVersion === "string") out.contractVersion = raw.contractVersion;
  if (typeof raw.capturePreview === "object" && raw.capturePreview !== null) {
    out.capturePreview = sanitizeCapturePreview(raw.capturePreview as Record<string, unknown>);
  }
  if (runtime) {
    const sanitizedRuntime = sanitizeRuntimeHints(runtime);
    out.runtime = sanitizedRuntime;
    if (typeof sanitizedRuntime.mode === "string") out.mode = sanitizedRuntime.mode;
  }
  return out;
}

export function normalizeStatusBatchRow(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.probe !== "object" || raw.probe === null) return raw;
  const out: Record<string, unknown> = {
    ...(raw.probe as Record<string, unknown>),
  };
  if (typeof out.lastHitEpochMs === "number") {
    out.lastHitMs = out.lastHitEpochMs;
    delete out.lastHitEpochMs;
  }
  if (typeof raw.ok === "boolean") out.ok = raw.ok;
  if (typeof raw.capturePreview === "object" && raw.capturePreview !== null) {
    out.capturePreview = sanitizeCapturePreview(raw.capturePreview as Record<string, unknown>);
  }
  if (typeof raw.runtime === "object" && raw.runtime !== null) {
    const sanitizedRuntime = sanitizeRuntimeHints(raw.runtime as Record<string, unknown>);
    out.runtime = sanitizedRuntime;
    const mode = sanitizedRuntime.mode;
    if (typeof mode === "string") out.mode = mode;
  }
  return out;
}

export function normalizeStatusBatchPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const json = raw as Record<string, unknown>;
  const results = Array.isArray(json.results) ? json.results : null;
  if (!results) return raw;
  return {
    ...json,
    results: results
      .map((row) =>
        row && typeof row === "object" ? normalizeStatusBatchRow(row as Record<string, unknown>) : row,
      )
      .filter((row) => !!row),
  };
}

export function invalidLineTargetProbeHitMessage(hitCount: number): string {
  return (
    "target line cannot be resolved to executable bytecode for this Class#method; " +
    `hitCount=${hitCount} is not evidence of method non-execution`
  );
}
