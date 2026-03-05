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

export function formatProbeOutput(args: {
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
}): string {
  const parsedRequest = parseHttpRequestLine(args.httpRequest);
  const requestMethod = args.requestMethod ?? parsedRequest.method;
  const requestUrl = args.requestUrl ?? parsedRequest.url;
  const runtimeMode = args.runtimeMode ?? "unknown";
  const syntheticWarning = args.syntheticWarning ?? synthWarningForMode(runtimeMode);

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
      notes: toText(args.runNotes, "-"),
    },
    null,
    2,
  );
}
