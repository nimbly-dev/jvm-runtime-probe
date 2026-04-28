export const API_REQUEST_NOT_INFERRED_NOTE =
  "No endpoint candidate could be inferred for API execution. Refine classHint/methodHint/lineHint or provide explicit request context.";

export type IntentMode = "regression" | "single_line_probe" | "regression_plus_line_probe";

export type RecipeStatus =
  | "regression_ready"
  | "single_line_probe_ready"
  | "regression_plus_line_probe_ready"
  | "execution_input_required"
  | "api_request_not_inferred"
  | "target_not_inferred";

