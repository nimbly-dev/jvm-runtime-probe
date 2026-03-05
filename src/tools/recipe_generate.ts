import type { AuthResolution } from "../models/auth_resolution.model";
import { API_REQUEST_NOT_INFERRED_NOTE, type IntentMode, type RecipeStatus } from "../utils/recipe_constants.util";
import {
  buildRoutingContext,
  resolveSelectedMode,
  type RoutingDecision,
} from "../utils/recipe_intent_routing.util";
import { buildRecipeExecutionPlan } from "../utils/recipe_execution_plan.util";
import { buildSearchRoots, findControllerRequestCandidate } from "../utils/recipe_candidate_infer.util";
import type { RecipeCandidate, RecipeExecutionPlan } from "../utils/recipe_types.util";
import { resolveAuthForRecipe } from "./auth_resolve";
import { inferTargets } from "./target_infer";

export type { RecipeCandidate, RecipeExecutionPlan } from "../utils/recipe_types.util";
export type RecipeResultType = "recipe" | "report";

type NormalizedRecipeGenerateInput = {
  rootAbs: string;
  workspaceRootAbs: string;
  classHint: string;
  methodHint: string;
  intentMode: IntentMode;
  lineHint?: number;
  maxCandidates: number;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  authLoginDiscoveryEnabled: boolean;
};

function normalizeRecipeGenerateInput(args: {
  rootAbs: string;
  workspaceRootAbs: string;
  classHint: string;
  methodHint: string;
  lineHint?: number;
  intentMode: IntentMode;
  maxCandidates?: number;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  authLoginDiscoveryEnabled: boolean;
}): NormalizedRecipeGenerateInput {
  return {
    rootAbs: args.rootAbs,
    workspaceRootAbs: args.workspaceRootAbs,
    classHint: args.classHint,
    methodHint: args.methodHint,
    intentMode: args.intentMode,
    ...(typeof args.lineHint === "number" ? { lineHint: args.lineHint } : {}),
    maxCandidates: typeof args.maxCandidates === "number" ? Math.max(1, args.maxCandidates) : 1,
    ...(args.authToken ? { authToken: args.authToken } : {}),
    ...(args.authUsername ? { authUsername: args.authUsername } : {}),
    ...(args.authPassword ? { authPassword: args.authPassword } : {}),
    authLoginDiscoveryEnabled: args.authLoginDiscoveryEnabled,
  };
}

function defaultStatusForMode(mode: IntentMode): RecipeStatus {
  if (mode === "single_line_probe") return "single_line_probe_ready";
  if (mode === "regression_plus_line_probe") return "regression_plus_line_probe_ready";
  return "regression_api_only_ready";
}

function buildMissingRequestNextAction(decision: RoutingDecision): string {
  if (decision.selectedMode === "single_line_probe") {
    return `${API_REQUEST_NOT_INFERRED_NOTE} Probe trigger request is required for single-line verification.`;
  }
  if (decision.selectedMode === "regression_plus_line_probe") {
    return `${API_REQUEST_NOT_INFERRED_NOTE} Combined mode needs one request to drive API assertions and probe verification.`;
  }
  return API_REQUEST_NOT_INFERRED_NOTE;
}

export async function generateRecipe(args: {
  rootAbs: string;
  workspaceRootAbs: string;
  classHint: string;
  methodHint: string;
  lineHint?: number;
  intentMode: IntentMode;
  maxCandidates?: number;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  authLoginDiscoveryEnabled: boolean;
}): Promise<{
  inferredTarget?: {
    key?: string;
    file: string;
    line?: number;
    confidence: number;
  };
  requestCandidates: RecipeCandidate[];
  executionPlan: RecipeExecutionPlan;
  resultType: RecipeResultType;
  status: RecipeStatus;
  selectedMode: IntentMode;
  downgradedFrom?: IntentMode;
  lineTargetProvided: boolean;
  probeIntentRequested: boolean;
  routingNote?: string;
  nextAction?: string;
  auth: AuthResolution;
  notes: string[];
}> {
  const normalized = normalizeRecipeGenerateInput(args);
  const routingDecision = resolveSelectedMode(
    buildRoutingContext({
      intentMode: normalized.intentMode,
      ...(typeof normalized.lineHint === "number" ? { lineHint: normalized.lineHint } : {}),
    }),
  );

  const inferArgs: Parameters<typeof inferTargets>[0] = {
    rootAbs: normalized.rootAbs,
    classHint: normalized.classHint,
    methodHint: normalized.methodHint,
    maxCandidates: normalized.maxCandidates,
  };
  if (typeof normalized.lineHint === "number") inferArgs.lineHint = normalized.lineHint;
  const inferred = await inferTargets(inferArgs);
  const top = inferred.candidates[0];

  const unresolvedAuth: AuthResolution = {
    required: "unknown",
    status: "unknown",
    strategy: "unknown",
    nextAction: "No target inferred; cannot resolve auth strategy yet.",
    notes: ["No method candidate matched current hints."],
  };

  if (!top) {
    const executionPlan = buildRecipeExecutionPlan({
      decision: routingDecision,
      auth: unresolvedAuth,
      ...(typeof normalized.lineHint === "number" ? { lineHint: normalized.lineHint } : {}),
    });
    const notes = ["No matching method candidate inferred from current hints."];
    if (routingDecision.routingNote) notes.push(routingDecision.routingNote);
    return {
      requestCandidates: [],
      executionPlan,
      resultType: "report",
      status: "target_not_inferred",
      selectedMode: routingDecision.selectedMode,
      ...(routingDecision.downgradedFrom
        ? { downgradedFrom: routingDecision.downgradedFrom }
        : {}),
      lineTargetProvided: routingDecision.lineTargetProvided,
      probeIntentRequested: routingDecision.probeIntentRequested,
      ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
      nextAction:
        "Refine classHint/methodHint/lineHint and rerun recipe_generate before attempting execution.",
      auth: unresolvedAuth,
      notes,
    };
  }

  const searchRootsAbs = buildSearchRoots(normalized.rootAbs, normalized.workspaceRootAbs);
  const controllerMatch = await findControllerRequestCandidate({
    searchRootsAbs,
    methodHint: normalized.methodHint,
    inferredTargetFileAbs: top.file,
  });
  const bestRequest = controllerMatch.recipe;
  const matchedControllerFile = controllerMatch.matchedControllerFile;
  const matchedBranchCondition = controllerMatch.matchedBranchCondition;
  const authRootAbs = controllerMatch.matchedRootAbs ?? normalized.rootAbs;

  const inferredTarget: {
    key?: string;
    file: string;
    line?: number;
    confidence: number;
  } = {
    file: top.file,
    confidence: top.confidence,
  };
  if (top.key) inferredTarget.key = top.key;
  if (typeof top.line === "number") inferredTarget.line = top.line;

  const auth: AuthResolution =
    bestRequest || matchedControllerFile
      ? await resolveAuthForRecipe({
          projectRootAbs: authRootAbs,
          workspaceRootAbs: normalized.workspaceRootAbs,
          endpointPath: bestRequest?.path,
          controllerFileAbs: matchedControllerFile,
          authToken: normalized.authToken,
          authUsername: normalized.authUsername,
          authPassword: normalized.authPassword,
          loginDiscoveryEnabled: normalized.authLoginDiscoveryEnabled,
        })
      : {
          required: "unknown",
          status: "needs_user_input",
          strategy: "unknown",
          missing: ["authToken"],
          nextAction:
            "Entrypoint/auth requirements could not be inferred. Ask user for authToken (Bearer) or confirm no auth is required.",
          notes: [
            "No controller->method mapping was inferred, so route-level auth inference is unavailable.",
            "Automatic credential discovery is disabled; credentials must be provided explicitly.",
          ],
        };

  const executionPlan = buildRecipeExecutionPlan({
    decision: routingDecision,
    auth,
    targetFile: inferredTarget.file,
    ...(typeof normalized.lineHint === "number" ? { lineHint: normalized.lineHint } : {}),
    ...(inferredTarget.key ? { inferredTargetKey: inferredTarget.key } : {}),
    ...(bestRequest ? { requestCandidate: bestRequest } : {}),
  });

  let resultType: RecipeResultType = "recipe";
  let status: RecipeStatus = routingDecision.downgradedFrom
    ? "regression_api_only_downgraded_line_target_missing"
    : defaultStatusForMode(routingDecision.selectedMode);
  let nextAction: string | undefined;

  if (!bestRequest) {
    resultType = "report";
    status = "api_request_not_inferred";
    nextAction = buildMissingRequestNextAction(routingDecision);
  } else if (auth.status === "needs_user_input") {
    nextAction =
      `Missing input: ${(auth.missing ?? ["authToken"]).join(", ")}. ` +
      "Provide missing auth inputs and execute the generated request steps.";
  }

  const runNotes: string[] = [];
  if (!bestRequest) {
    runNotes.push("No controller call mapping found in the selected module roots.");
  }
  if (routingDecision.routingNote) runNotes.push(routingDecision.routingNote);
  if (routingDecision.selectedMode === "regression_api_only") {
    runNotes.push("Probe tools are disabled for this route.");
  } else {
    runNotes.push("Probe verification requires strict line key Class#method:line.");
  }
  if (typeof normalized.lineHint === "number" && typeof inferredTarget.line === "number" && inferredTarget.line !== normalized.lineHint) {
    runNotes.push(
      `Provided line hint (${normalized.lineHint}) differs from inferred method start (${inferredTarget.line}).`,
    );
  }
  if (matchedBranchCondition) runNotes.push(`Line/branch precondition hint: ${matchedBranchCondition}`);
  if (bestRequest?.confidence !== undefined) {
    runNotes.push(`Request candidate confidence=${bestRequest.confidence.toFixed(2)}.`);
  }
  if (bestRequest?.needsConfirmation?.length) {
    runNotes.push(`Needs confirmation: ${bestRequest.needsConfirmation.join(" ")}`);
  }
  if (bestRequest?.assumptions?.length) {
    runNotes.push(`Assumed: ${bestRequest.assumptions.join(" ")}`);
  }
  if (auth.status === "needs_user_input" && bestRequest) {
    runNotes.push(
      `Missing input: ${(auth.missing ?? ["authToken"]).join(", ")}. Use the generated request skeleton after providing these values.`,
    );
  }

  return {
    inferredTarget,
    requestCandidates: bestRequest ? [bestRequest] : [],
    executionPlan,
    resultType,
    status,
    selectedMode: routingDecision.selectedMode,
    ...(routingDecision.downgradedFrom
      ? { downgradedFrom: routingDecision.downgradedFrom }
      : {}),
    lineTargetProvided: routingDecision.lineTargetProvided,
    probeIntentRequested: routingDecision.probeIntentRequested,
    ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
    ...(nextAction ? { nextAction } : {}),
    auth,
    notes: runNotes,
  };
}

