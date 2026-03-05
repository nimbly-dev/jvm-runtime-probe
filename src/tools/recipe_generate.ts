import type { AuthResolution } from "../models/auth_resolution.model";
import { type IntentMode, type RecipeStatus } from "../utils/recipe_constants.util";
import { buildExecutionReadiness } from "../utils/execution_readiness.util";
import { buildRecipeExecutionPlan } from "../utils/recipe_execution_plan.util";
import { buildRoutingContext, resolveSelectedMode } from "../utils/recipe_intent_routing.util";
import {
  buildSearchRoots,
  findControllerRequestCandidate,
} from "../utils/recipe_candidate_infer.util";
import type {
  ExecutionReadiness,
  MissingExecutionInput,
  RecipeCandidate,
  RecipeExecutionPlan,
} from "../utils/recipe_types.util";
import { resolveAuthForRecipe } from "./auth_resolve";
import { defaultStatusForMode, buildMissingRequestNextAction } from "./recipe_generate/mode.util";
import { normalizeRecipeGenerateInput } from "./recipe_generate/normalize_input.util";
import { buildRunNotes } from "./recipe_generate/run_notes.util";
import { inferTargets } from "./target_infer";

export type { RecipeCandidate, RecipeExecutionPlan } from "../utils/recipe_types.util";
export type RecipeResultType = "recipe" | "report";

function buildNoTargetResult(args: {
  routingDecision: ReturnType<typeof resolveSelectedMode>;
  unresolvedAuth: AuthResolution;
  actuationEnabled: boolean;
  actuationReturnBoolean?: boolean;
  actuationActuatorId?: string;
  lineHint?: number;
}): {
  requestCandidates: RecipeCandidate[];
  executionPlan: RecipeExecutionPlan;
  resultType: RecipeResultType;
  status: RecipeStatus;
  selectedMode: IntentMode;
  downgradedFrom?: IntentMode;
  lineTargetProvided: boolean;
  probeIntentRequested: boolean;
  executionReadiness: ExecutionReadiness;
  missingInputs: MissingExecutionInput[];
  routingNote?: string;
  nextAction?: string;
  auth: AuthResolution;
  notes: string[];
} {
  const executionPlan = buildRecipeExecutionPlan({
    decision: args.routingDecision,
    auth: args.unresolvedAuth,
    actuationEnabled: args.actuationEnabled,
    ...(typeof args.actuationReturnBoolean === "boolean"
      ? { actuationReturnBoolean: args.actuationReturnBoolean }
      : {}),
    ...(args.actuationActuatorId ? { actuationActuatorId: args.actuationActuatorId } : {}),
    ...(typeof args.lineHint === "number" ? { lineHint: args.lineHint } : {}),
  });
  const readiness = buildExecutionReadiness({
    selectedMode: args.routingDecision.selectedMode,
    lineTargetProvided: args.routingDecision.lineTargetProvided,
    auth: args.unresolvedAuth,
    actuationEnabled: args.actuationEnabled,
    ...(typeof args.actuationReturnBoolean === "boolean"
      ? { actuationReturnBoolean: args.actuationReturnBoolean }
      : {}),
  });

  const notes = ["No matching method candidate inferred from current hints."];
  if (args.routingDecision.routingNote) notes.push(args.routingDecision.routingNote);
  notes.push(
    `probe_calls_total=${executionPlan.probeCallPlan.total} by_tool=${JSON.stringify(executionPlan.probeCallPlan.byTool)}`,
  );
  notes.push(`execution_readiness=${readiness.executionReadiness}`);

  return {
    requestCandidates: [],
    executionPlan,
    resultType: "report",
    status: "target_not_inferred",
    selectedMode: args.routingDecision.selectedMode,
    ...(args.routingDecision.downgradedFrom
      ? { downgradedFrom: args.routingDecision.downgradedFrom }
      : {}),
    lineTargetProvided: args.routingDecision.lineTargetProvided,
    probeIntentRequested: args.routingDecision.probeIntentRequested,
    executionReadiness: readiness.executionReadiness,
    missingInputs: readiness.missingInputs,
    ...(args.routingDecision.routingNote ? { routingNote: args.routingDecision.routingNote } : {}),
    nextAction:
      "Refine classHint/methodHint/lineHint and rerun recipe_generate before attempting execution.",
    auth: args.unresolvedAuth,
    notes,
  };
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
  actuationEnabled?: boolean;
  actuationReturnBoolean?: boolean;
  actuationActuatorId?: string;
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
  executionReadiness: ExecutionReadiness;
  missingInputs: MissingExecutionInput[];
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
    return buildNoTargetResult({
      routingDecision,
      unresolvedAuth,
      actuationEnabled: normalized.actuationEnabled,
      ...(typeof normalized.actuationReturnBoolean === "boolean"
        ? { actuationReturnBoolean: normalized.actuationReturnBoolean }
        : {}),
      ...(normalized.actuationActuatorId
        ? { actuationActuatorId: normalized.actuationActuatorId }
        : {}),
      ...(typeof normalized.lineHint === "number" ? { lineHint: normalized.lineHint } : {}),
    });
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
    actuationEnabled: normalized.actuationEnabled,
    ...(typeof normalized.actuationReturnBoolean === "boolean"
      ? { actuationReturnBoolean: normalized.actuationReturnBoolean }
      : {}),
    ...(normalized.actuationActuatorId
      ? { actuationActuatorId: normalized.actuationActuatorId }
      : {}),
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

  const readiness = buildExecutionReadiness({
    selectedMode: routingDecision.selectedMode,
    lineTargetProvided: routingDecision.lineTargetProvided,
    auth,
    actuationEnabled: normalized.actuationEnabled,
    ...(typeof normalized.actuationReturnBoolean === "boolean"
      ? { actuationReturnBoolean: normalized.actuationReturnBoolean }
      : {}),
    ...(bestRequest ? { requestCandidate: bestRequest } : {}),
  });
  if (readiness.executionReadiness === "needs_user_input") {
    resultType = "report";
    if (status !== "api_request_not_inferred") {
      status = "execution_input_required";
    }
    if (!nextAction && readiness.nextAction) nextAction = readiness.nextAction;
  }

  const runNotes = buildRunNotes({
    selectedMode: routingDecision.selectedMode,
    ...(typeof normalized.lineHint === "number" ? { lineHint: normalized.lineHint } : {}),
    ...(typeof inferredTarget.line === "number" ? { inferredLine: inferredTarget.line } : {}),
    ...(bestRequest ? { bestRequest } : {}),
    ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
    ...(matchedBranchCondition ? { matchedBranchCondition } : {}),
    auth,
    executionPlan,
    readiness: readiness.executionReadiness,
  });

  return {
    inferredTarget,
    requestCandidates: bestRequest ? [bestRequest] : [],
    executionPlan,
    resultType,
    status,
    selectedMode: routingDecision.selectedMode,
    ...(routingDecision.downgradedFrom ? { downgradedFrom: routingDecision.downgradedFrom } : {}),
    lineTargetProvided: routingDecision.lineTargetProvided,
    probeIntentRequested: routingDecision.probeIntentRequested,
    executionReadiness: readiness.executionReadiness,
    missingInputs: readiness.missingInputs,
    ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
    ...(nextAction ? { nextAction } : {}),
    auth,
    notes: runNotes,
  };
}
