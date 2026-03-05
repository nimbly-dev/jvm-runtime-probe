import * as z from "zod/v4";

export const ProbeDiagnoseInputSchema = {
  baseUrl: z
    .string()
    .optional()
    .describe("Override probe base URL (default from MCP_PROBE_BASE_URL)."),
  timeoutMs: z.number().int().positive().optional(),
} as const;
