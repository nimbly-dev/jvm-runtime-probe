import { fetchJson } from "@/lib/http";
import { clampInt, DEFAULT_PROBE_TIMEOUT_MS, HARD_MAX_PROBE_TIMEOUT_MS } from "@/lib/safety";
import type { ProbeCaptureRecordPayload } from "@/models/probe_runtime_capture.model";
import type { ToolTextResponse } from "@/models/tool_response.model";
import { joinUrl, probeUnreachableMessage } from "@/utils/probe.util";
import { buildTextResponse } from "@/utils/probe/response_builders.util";

export async function probeCaptureGet(args: {
  captureId: string;
  baseUrl: string;
  capturePath: string;
  timeoutMs?: number;
}): Promise<ToolTextResponse> {
  const timeoutMs = clampInt(args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS, 1_000, HARD_MAX_PROBE_TIMEOUT_MS);
  const captureId = args.captureId.trim();
  if (!captureId) {
    throw new Error("probe_get_capture requires captureId.");
  }
  const url = new URL(joinUrl(args.baseUrl, args.capturePath));
  url.searchParams.set("captureId", captureId);

  let res;
  try {
    res = await fetchJson(url.toString(), { method: "GET", timeoutMs });
  } catch (err) {
    throw new Error(probeUnreachableMessage(url.toString(), err));
  }

  const json = (res.json as Record<string, unknown> | null) ?? null;
  const capture =
    json && typeof json.capture === "object" && json.capture !== null
      ? ({ ...(json.capture as ProbeCaptureRecordPayload) } as ProbeCaptureRecordPayload)
      : null;
  if (capture && Array.isArray(capture.executionPaths)) {
    capture.executionPaths = capture.executionPaths.filter(
      (value): value is string => typeof value === "string",
    );
  }
  const found = res.status >= 200 && res.status < 300 && capture !== null;

  const structuredContent: Record<string, unknown> = {
    request: {
      captureId,
      url: url.toString(),
      timeoutMs,
    },
    response: { status: res.status, json, text: json ? undefined : res.text },
    result: found
      ? {
          found: true,
          capture,
        }
      : {
          found: false,
          reason: typeof json?.error === "string" ? json.error : "capture_unavailable",
        },
  };

  const textPayload = {
    mode: "probe_get_capture",
    request: structuredContent.request,
    response: {
      status: res.status,
    },
    result: found
      ? {
          found: true,
          captureId: capture?.captureId,
          methodKey: capture?.methodKey,
          capturedAtEpochMs: capture?.capturedAtEpochMs,
          argsCount: Array.isArray(capture?.args) ? capture.args.length : 0,
          hasReturnValue: capture?.returnValue != null,
          hasThrownValue: capture?.thrownValue != null,
          executionPathCount: Array.isArray(capture?.executionPaths) ? capture.executionPaths.length : 0,
        }
      : {
          found: false,
          reason: typeof json?.error === "string" ? json.error : "capture_unavailable",
        },
    notes: "Use structuredContent.result.capture for full payload.",
  };
  return buildTextResponse(structuredContent, JSON.stringify(textPayload, null, 2));
}
