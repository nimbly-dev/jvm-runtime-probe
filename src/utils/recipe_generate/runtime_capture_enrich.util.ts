import { probeStatus } from "@/utils/probe/probe_status.util";

export type RuntimeCaptureSummary =
  | {
      status: "available";
      capturePreview: Record<string, unknown>;
      lineValidation?: string;
      lineResolvable?: boolean;
    }
  | {
      status: "not_captured_yet" | "unavailable";
      reason: string;
    };

export async function enrichRuntimeCapture(args: {
  inferredKey?: string;
  inferredLine?: number;
  probeBaseUrl: string;
  probeStatusPath: string;
  probeStatusFn?: typeof probeStatus;
}): Promise<RuntimeCaptureSummary> {
  if (!args.inferredKey || typeof args.inferredLine !== "number") {
    return {
      status: "unavailable",
      reason: "probe_key_or_line_missing",
    };
  }

  const probeStatusFn = args.probeStatusFn ?? probeStatus;
  try {
    const runtimeStatus = await probeStatusFn({
      key: args.inferredKey,
      lineHint: args.inferredLine,
      baseUrl: args.probeBaseUrl,
      statusPath: args.probeStatusPath,
      timeoutMs: 2_500,
    });
    const statusJson = ((runtimeStatus.structuredContent as any)?.response?.json ??
      null) as Record<string, unknown> | null;
    const capturePreview =
      statusJson && typeof statusJson.capturePreview === "object"
        ? (statusJson.capturePreview as Record<string, unknown>)
        : null;
    if (capturePreview && capturePreview.available === true) {
      const lineValidation =
        typeof statusJson?.lineValidation === "string" ? statusJson.lineValidation : undefined;
      const lineResolvable =
        typeof statusJson?.lineResolvable === "boolean" ? statusJson.lineResolvable : undefined;
      return {
        status: "available",
        capturePreview,
        ...(lineValidation ? { lineValidation } : {}),
        ...(typeof lineResolvable === "boolean" ? { lineResolvable } : {}),
      };
    }
    return {
      status: "not_captured_yet",
      reason: "status_checked_but_capture_unavailable",
    };
  } catch (err) {
    return {
      status: "unavailable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
