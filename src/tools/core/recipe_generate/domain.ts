import type { AuthResolution } from "../../../models/auth_resolution.model";
import type { SynthesizerFailure } from "../../../models/synthesis/synthesizer_failure.model";
import type { SynthesisHttpTrigger, SynthesizerOutput } from "../../../models/synthesis/synthesizer_output.model";
import { type IntentMode, type RecipeStatus } from "../../../utils/recipe_constants.util";
import { buildExecutionReadiness } from "../../../utils/execution_readiness.util";
import { buildRecipeExecutionPlan } from "../../../utils/recipe_execution_plan.util";
import { buildRoutingContext, resolveSelectedMode } from "../../../utils/recipe_intent_routing.util";
import { buildSearchRoots } from "../../../utils/synthesis_search_roots.util";
import type {
  ExecutionReadiness,
  InferenceDiagnostics,
  InferenceFailurePhase,
  MissingExecutionInput,
  RecipeCandidate,
  RecipeExecutionPlan,
} from "../../../utils/recipe_types.util";
import { resolveAuthForRecipe } from "../../../utils/recipe_generate/auth_resolve.util";
import {
  defaultStatusForMode,
  buildMissingRequestNextAction,
} from "../../../utils/recipe_generate/mode.util";
import { normalizeRecipeGenerateInput } from "../../../utils/recipe_generate/normalize_input.util";
import { buildRunNotes } from "../../../utils/recipe_generate/run_notes.util";
import {
  createDefaultSynthesizerRegistry,
  type SynthesizerRegistry,
} from "../../synthesizers/registry/plugin.loader";
import { inferTargets } from "../target_infer/domain";

export type { RecipeCandidate, RecipeExecutionPlan } from "../../../utils/recipe_types.util";
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
  reasonCode?: string;
  failedStep?: string;
  synthesizerUsed?: string;
  attemptedStrategies: string[];
  evidence: string[];
  trigger?: SynthesisHttpTrigger;
  inferenceDiagnostics: InferenceDiagnostics;
  auth: AuthResolution;
  notes: string[];
};

export type GenerateRecipeDeps = {
  inferTargetsFn?: typeof inferTargets;
  synthesizerRegistry?: SynthesizerRegistry;
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
  },
  deps: GenerateRecipeDeps = {},
): Promise<GenerateRecipeResult> {
  const inferTargetsFn = deps.inferTargetsFn ?? inferTargets;
  const resolveAuthForRecipeFn = deps.resolveAuthForRecipeFn ?? resolveAuthForRecipe;
  const synthesizerRegistry = deps.synthesizerRegistry ?? createDefaultSynthesizerRegistry();

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
  const synthesis = await synthesizerRegistry.synthesize({
    rootAbs: normalized.rootAbs,
    workspaceRootAbs: normalized.workspaceRootAbs,
    searchRootsAbs,
    classHint: normalized.classHint,
    methodHint: normalized.methodHint,
    intentMode: normalized.intentMode,
    ...(typeof normalized.lineHint === "number" ? { lineHint: normalized.lineHint } : {}),
    ...(top?.file ? { inferredTargetFileAbs: top.file } : {}),
  });

  const synthesisSuccess = synthesis.status === "recipe" ? synthesis : undefined;
  const synthesisFailure = synthesis.status === "report" ? synthesis : undefined;
  const bestRequest = synthesisSuccess?.requestCandidate;
  const matchedControllerFile = synthesisSuccess?.matchedControllerFile;
  const matchedBranchCondition = synthesisSuccess?.matchedBranchCondition;
  const authRootAbs = synthesisSuccess?.matchedRootAbs ?? normalized.rootAbs;
  const synthesizerUsed = synthesisSuccess?.synthesizerUsed ?? synthesisFailure?.synthesizerUsed;
  const attemptedStrategies =
    synthesisSuccess?.attemptedStrategies ?? synthesisFailure?.attemptedStrategies ?? [];
  const evidence = synthesisSuccess?.evidence ?? synthesisFailure?.evidence ?? [];
  const trigger = synthesisSuccess?.trigger;
  let reasonCode = synthesisFailure?.reasonCode;
  let failedStep = synthesisFailure?.failedStep;

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
      ...(synthesisSuccess?.requestSource ? { source: synthesisSuccess.requestSource } : {}),
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
            ? "Strict line target could not be inferred for probe verification. Refine classHint/methodHint/lineHint and rerun probe_recipe_create."
            : "Refine classHint/methodHint/lineHint and rerun probe_recipe_create before attempting execution.";
    }
  } else if (!bestRequest) {
    resultType = "report";
    status = "api_request_not_inferred";
    failurePhase = "request_inference";
    failureReasonCode = reasonCode ?? "request_candidate_missing";
    reasonCode = reasonCode ?? "request_candidate_missing";
    failedStep = failedStep ?? "request_synthesis";
    nextAction = synthesisFailure?.nextAction ?? buildMissingRequestNextAction(routingDecision);
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
  if (reasonCode) runNotes.push(`synthesis_reason_code=${reasonCode}`);
  if (failedStep) runNotes.push(`synthesis_failed_step=${failedStep}`);
  if (synthesizerUsed) runNotes.push(`synthesizer_used=${synthesizerUsed}`);
  const notesForOutput =
    resultType === "report"
      ? runNotes.filter(
          (note) =>
            note.startsWith("execution_readiness=") ||
            note.startsWith("inference_target=") ||
            note.startsWith("inference_request=") ||
            note.startsWith("failure_") ||
            note.startsWith("synthesis_"),
        )
      : runNotes;

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
    ...(reasonCode ? { reasonCode } : {}),
    ...(failedStep ? { failedStep } : {}),
    ...(synthesizerUsed ? { synthesizerUsed } : {}),
    ...(trigger ? { trigger } : {}),
    attemptedStrategies,
    evidence,
    inferenceDiagnostics,
    auth,
    notes: notesForOutput,
  };
}
