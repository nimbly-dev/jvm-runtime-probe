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
  InferenceDiagnostics,
  InferenceFailurePhase,
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

export type GenerateRecipeResult = {
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
  failurePhase?: InferenceFailurePhase;
  failureReasonCode?: string;
  inferenceDiagnostics: InferenceDiagnostics;
  auth: AuthResolution;
  notes: string[];
};

export type GenerateRecipeDeps = {
  inferTargetsFn?: typeof inferTargets;
  findControllerRequestCandidateFn?: typeof findControllerRequestCandidate;
  resolveAuthForRecipeFn?: typeof resolveAuthForRecipe;
};

function buildUnknownTargetAuth(): AuthResolution {
  return {
    required: "unknown",
    status: "unknown",
    strategy: "unknown",
    nextAction: "No target inferred; cannot resolve auth strategy yet.",
    notes: ["No method candidate matched current hints."],
  };
}

function buildMissingRouteAuth(): AuthResolution {
  return {
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
}

export async function generateRecipe(
  args: {
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
  },
  deps: GenerateRecipeDeps = {},
): Promise<GenerateRecipeResult> {
  const inferTargetsFn = deps.inferTargetsFn ?? inferTargets;
  const findControllerRequestCandidateFn =
    deps.findControllerRequestCandidateFn ?? findControllerRequestCandidate;
  const resolveAuthForRecipeFn = deps.resolveAuthForRecipeFn ?? resolveAuthForRecipe;

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
  const inferred = await inferTargetsFn(inferArgs);
  const top = inferred.candidates[0];

  const searchRootsAbs = buildSearchRoots(normalized.rootAbs, normalized.workspaceRootAbs);
  const controllerMatch = await findControllerRequestCandidateFn({
    searchRootsAbs,
    methodHint: normalized.methodHint,
    ...(top ? { inferredTargetFileAbs: top.file } : {}),
  });
  const bestRequest = controllerMatch.recipe;
  const matchedControllerFile = controllerMatch.matchedControllerFile;
  const matchedBranchCondition = controllerMatch.matchedBranchCondition;
  const authRootAbs = controllerMatch.matchedRootAbs ?? normalized.rootAbs;

  const inferenceDiagnostics: InferenceDiagnostics = {
    target: {
      attempted: true,
      matched: Boolean(top),
      candidateCount: inferred.candidates.length,
      ...(typeof top?.confidence === "number" ? { topConfidence: top.confidence } : {}),
    },
    request: {
      attempted: true,
      matched: Boolean(bestRequest),
      ...(controllerMatch.requestSource ? { source: controllerMatch.requestSource } : {}),
    },
  };

  const inferredTarget: GenerateRecipeResult["inferredTarget"] = top
    ? {
        file: top.file,
        confidence: top.confidence,
        ...(top.key ? { key: top.key } : {}),
        ...(typeof top.line === "number" ? { line: top.line } : {}),
      }
    : undefined;

  const auth: AuthResolution =
    bestRequest || matchedControllerFile
      ? await resolveAuthForRecipeFn({
          projectRootAbs: authRootAbs,
          workspaceRootAbs: normalized.workspaceRootAbs,
          endpointPath: bestRequest?.path,
          controllerFileAbs: matchedControllerFile,
          authToken: normalized.authToken,
          authUsername: normalized.authUsername,
          authPassword: normalized.authPassword,
          loginDiscoveryEnabled: normalized.authLoginDiscoveryEnabled,
        })
      : top
        ? buildMissingRouteAuth()
        : buildUnknownTargetAuth();

  const executionPlan = buildRecipeExecutionPlan({
    decision: routingDecision,
    auth,
    ...(inferredTarget?.file ? { targetFile: inferredTarget.file } : {}),
    actuationEnabled: normalized.actuationEnabled,
    ...(typeof normalized.actuationReturnBoolean === "boolean"
      ? { actuationReturnBoolean: normalized.actuationReturnBoolean }
      : {}),
    ...(normalized.actuationActuatorId ? { actuationActuatorId: normalized.actuationActuatorId } : {}),
    ...(typeof normalized.lineHint === "number" ? { lineHint: normalized.lineHint } : {}),
    ...(inferredTarget?.key ? { inferredTargetKey: inferredTarget.key } : {}),
    ...(bestRequest ? { requestCandidate: bestRequest } : {}),
  });

  let resultType: RecipeResultType = "recipe";
  let status: RecipeStatus = routingDecision.downgradedFrom
    ? "regression_api_only_downgraded_line_target_missing"
    : defaultStatusForMode(routingDecision.selectedMode);
  let nextAction: string | undefined;
  let failurePhase: InferenceFailurePhase | undefined;
  let failureReasonCode: string | undefined;

  if (!top) {
    const fallbackAllowed =
      routingDecision.selectedMode === "regression_api_only" && Boolean(bestRequest);
    if (!fallbackAllowed) {
      resultType = "report";
      status = "target_not_inferred";
      failurePhase = "target_inference";
      failureReasonCode = bestRequest
        ? "line_target_required_for_probe_mode"
        : "target_candidate_missing";
      nextAction = bestRequest
        ? "Strict line target could not be inferred for probe verification. Refine classHint/methodHint/lineHint and rerun recipe_generate."
        : "Refine classHint/methodHint/lineHint and rerun recipe_generate before attempting execution.";
    }
  } else if (!bestRequest) {
    resultType = "report";
    status = "api_request_not_inferred";
    failurePhase = "request_inference";
    failureReasonCode = "request_candidate_missing";
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
    if (status !== "api_request_not_inferred" && status !== "target_not_inferred") {
      status = "execution_input_required";
      failurePhase = "auth_resolution";
      failureReasonCode = "auth_input_required";
    }
    if (!nextAction && readiness.nextAction) nextAction = readiness.nextAction;
  }

  const runNotes = buildRunNotes({
    selectedMode: routingDecision.selectedMode,
    ...(typeof normalized.lineHint === "number" ? { lineHint: normalized.lineHint } : {}),
    ...(typeof inferredTarget?.line === "number" ? { inferredLine: inferredTarget.line } : {}),
    ...(bestRequest ? { bestRequest } : {}),
    ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
    ...(matchedBranchCondition ? { matchedBranchCondition: matchedBranchCondition } : {}),
    auth,
    executionPlan,
    readiness: readiness.executionReadiness,
  });
  runNotes.push(
    `inference_target=matched:${String(inferenceDiagnostics.target.matched)} candidates:${inferenceDiagnostics.target.candidateCount}`,
  );
  runNotes.push(
    `inference_request=matched:${String(inferenceDiagnostics.request.matched)}` +
      (inferenceDiagnostics.request.source ? ` source:${inferenceDiagnostics.request.source}` : ""),
  );
  if (failurePhase) runNotes.push(`failure_phase=${failurePhase}`);
  if (failureReasonCode) runNotes.push(`failure_reason=${failureReasonCode}`);

  return {
    ...(inferredTarget ? { inferredTarget } : {}),
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
    ...(failurePhase ? { failurePhase } : {}),
    ...(failureReasonCode ? { failureReasonCode } : {}),
    inferenceDiagnostics,
    auth,
    notes: runNotes,
  };
}
