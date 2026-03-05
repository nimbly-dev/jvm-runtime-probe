import * as z from "zod/v4";

export const ProbeActuateInputSchema = {
  baseUrl: z
    .string()
    .optional()
    .describe("Override probe base URL (default from MCP_PROBE_BASE_URL)."),
  mode: z
    .enum(["observe", "actuate"])
    .optional()
    .describe("Runtime probe mode. Use 'observe' to disarm actuation."),
  actuatorId: z.string().optional().describe("Optional actuator identifier for tracing/auditing."),
  targetKey: z
    .string()
    .optional()
    .describe(
      "Target line key for branch actuation in strict mode, e.g. fully.qualified.Class#method:line.",
    ),
  returnBoolean: z
    .boolean()
    .optional()
    .describe(
      "Branch decision for target conditional at targetKey: true=force jump/taken, false=force fallthrough.",
    ),
  timeoutMs: z.number().int().positive().optional(),
} as const;
