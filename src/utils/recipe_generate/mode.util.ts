import {
  API_REQUEST_NOT_INFERRED_NOTE,
  type IntentMode,
  type RecipeStatus,
} from "@/utils/recipe_constants.util";
import type { RoutingDecision } from "@/utils/recipe_intent_routing.util";

export function defaultStatusForMode(mode: IntentMode): RecipeStatus {
  if (mode === "single_line_probe") return "single_line_probe_ready";
  if (mode === "regression_plus_line_probe") return "regression_plus_line_probe_ready";
  return "regression_http_only_ready";
}

export function buildMissingRequestNextAction(decision: RoutingDecision): string {
  if (decision.selectedMode === "single_line_probe") {
    return `${API_REQUEST_NOT_INFERRED_NOTE} Probe trigger request is required for single-line verification.`;
  }
  if (decision.selectedMode === "regression_plus_line_probe") {
    return `${API_REQUEST_NOT_INFERRED_NOTE} Combined mode needs one request to drive API assertions and probe verification.`;
  }
  return API_REQUEST_NOT_INFERRED_NOTE;
}
