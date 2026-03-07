import * as z from "zod/v4";

export const ProbeCaptureGetInputSchema = {
  captureId: z.string().min(1).describe("Capture identifier returned by probe_get_status capturePreview.captureId."),
  baseUrl: z
    .string()
    .optional()
    .describe("Override probe base URL (default from MCP_PROBE_BASE_URL)."),
  timeoutMs: z.number().int().positive().optional(),
} as const;
