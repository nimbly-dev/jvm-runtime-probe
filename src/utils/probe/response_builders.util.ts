import { formatProbeOutput } from "@/utils/probe/output.util";
import type { ToolTextResponse } from "@/models/tool_response.model";

export function buildTextResponse(
  structuredContent: Record<string, unknown>,
  text: string,
): ToolTextResponse {
  return { content: [{ type: "text", text }], structuredContent };
}

export function buildLineKeyRequiredResponse(args: {
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

export function buildBatchResponse(args: {
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
