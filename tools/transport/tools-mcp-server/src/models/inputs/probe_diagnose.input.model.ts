import * as z from "zod/v4";

export const ProbeDiagnoseInputSchema = {
  baseUrl: z
    .string()
    .optional()
    .describe("Override probe base URL (default from MCP_PROBE_BASE_URL)."),
  http: z
    .object({
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional HTTP headers applied to probe reset/status requests."),
    })
    .optional()
    .describe("Optional HTTP transport overrides for protected probe endpoints."),
  timeoutMs: z.number().int().positive().optional(),
} as const;
