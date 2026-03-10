import * as z from "zod/v4";

export const RecipeGenerateInputSchema = {
  projectRootAbs: z
    .string()
    .describe("Absolute project root selected by orchestrator; all inference stays scoped here."),
  classHint: z.string().describe("Class hint, e.g. CatalogShoeSpecifications"),
  methodHint: z.string().describe("Method hint, e.g. finalPriceLte"),
  lineHint: z.number().int().positive().optional(),
  intentMode: z
    .enum(["regression_api_only", "single_line_probe", "regression_plus_line_probe"])
    .describe("Required execution intent routing mode."),
  authToken: z
    .string()
    .optional()
    .describe(
      "Optional bearer token. If auth is required and missing, tool returns needs_user_input.",
    ),
  authUsername: z
    .string()
    .optional()
    .describe("Optional auth username/email for login discovery flows."),
  authPassword: z.string().optional().describe("Optional auth password for login discovery flows."),
  actuationEnabled: z
    .boolean()
    .optional()
    .describe(
      "Optional flag to emit probe_enable enable/disable steps around probe verification.",
    ),
  actuationReturnBoolean: z
    .boolean()
    .optional()
    .describe("Optional branch decision for actuated mode. Required when actuationEnabled=true."),
  actuationActuatorId: z
    .string()
    .optional()
    .describe("Optional actuator identifier to correlate enable/disable actuation calls."),
  outputTemplate: z
    .string()
    .optional()
    .describe(
      "Optional response template override. Placeholders include {{recipe.mode}}, {{recipe.mode_reason}}, {{recipe.steps}}, {{target.path}}, {{http.request}}, {{execution_hit}}, {{api_outcome}}, {{repro_status}}, {{auth.status}}, {{auth.strategy}}, {{auth.next_action}}, {{auth.headers}}, {{auth.missing}}, {{auth.source}}, {{auth.login.path}}, {{auth.login.body}}, {{probe.hit}}, {{http.code}}, {{http.response}}, {{run.duration}}, {{probe.key}}, {{run.notes}}.",
    ),
} as const;
