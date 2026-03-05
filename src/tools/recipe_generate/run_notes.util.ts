import type { AuthResolution } from "../../models/auth_resolution.model";
import type { RecipeCandidate, RecipeExecutionPlan } from "../../utils/recipe_types.util";

export function buildRunNotes(args: {
  selectedMode: "regression_api_only" | "single_line_probe" | "regression_plus_line_probe";
  lineHint?: number;
  inferredLine?: number;
  bestRequest?: RecipeCandidate;
  routingNote?: string;
  matchedBranchCondition?: string;
  auth: AuthResolution;
  executionPlan: RecipeExecutionPlan;
  readiness: "ready" | "needs_user_input";
}): string[] {
  const notes: string[] = [];
  if (!args.bestRequest) {
    notes.push("No controller call mapping found in the selected module roots.");
  }
  if (args.routingNote) notes.push(args.routingNote);
  if (args.selectedMode === "regression_api_only") {
    notes.push("Probe tools are disabled for this route.");
  } else {
    notes.push("Probe verification requires strict line key Class#method:line.");
  }
  if (
    typeof args.lineHint === "number" &&
    typeof args.inferredLine === "number" &&
    args.inferredLine !== args.lineHint
  ) {
    notes.push(
      `Provided line hint (${args.lineHint}) differs from inferred method start (${args.inferredLine}).`,
    );
  }
  if (args.matchedBranchCondition)
    notes.push(`Line/branch precondition hint: ${args.matchedBranchCondition}`);
  if (args.bestRequest?.confidence !== undefined) {
    notes.push(`Request candidate confidence=${args.bestRequest.confidence.toFixed(2)}.`);
  }
  if (args.bestRequest?.needsConfirmation?.length) {
    notes.push(`Needs confirmation: ${args.bestRequest.needsConfirmation.join(" ")}`);
  }
  if (args.bestRequest?.assumptions?.length) {
    notes.push(`Assumed: ${args.bestRequest.assumptions.join(" ")}`);
  }
  if (args.auth.status === "needs_user_input" && args.bestRequest) {
    notes.push(
      `Missing input: ${(args.auth.missing ?? ["authToken"]).join(", ")}. Use the generated request skeleton after providing these values.`,
    );
  }
  notes.push(
    `probe_calls_total=${args.executionPlan.probeCallPlan.total} by_tool=${JSON.stringify(args.executionPlan.probeCallPlan.byTool)}`,
  );
  notes.push(`execution_readiness=${args.readiness}`);
  return notes;
}
