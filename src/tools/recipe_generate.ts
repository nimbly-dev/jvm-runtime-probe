import type { AuthResolution } from "../models/auth_resolution.model";
import { resolveAuthForRecipe } from "./auth_resolve";
import { inferTargets } from "./target_infer";
import { buildRecipeExecutionPlan } from "../utils/recipe_execution_plan.util";
import { buildSearchRoots, findControllerRequestCandidate } from "../utils/recipe_candidate_infer.util";
import type { RecipeCandidate, RecipeExecutionPlan } from "../utils/recipe_types.util";

export type { RecipeCandidate, RecipeExecutionPlan } from "../utils/recipe_types.util";

export type RecipeResultType = "recipe" | "report";
export type RecipeStatus =
  | "natural_ready"
  | "unreachable_natural"
  | "actuated_ready"
  | "actuated_blocked"
  | "target_not_inferred";

export async function generateRecipe(args: {
  rootAbs: string;
  workspaceRootAbs: string;
  classHint: string;
  methodHint: string;
  lineHint?: number;
  mode?: "natural" | "actuated";
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
  nextAction?: string;
  auth: AuthResolution;
  notes: string[];
}> {
  const requestedMode = args.mode ?? "natural";
  const inferArgs: Parameters<typeof inferTargets>[0] = {
    rootAbs: args.rootAbs,
    classHint: args.classHint,
    methodHint: args.methodHint,
    maxCandidates: 1,
  };
  if (typeof args.lineHint === "number") inferArgs.lineHint = args.lineHint;
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
    const planArgs: Parameters<typeof buildRecipeExecutionPlan>[0] = {
      requestedMode,
      auth: unresolvedAuth,
    };
    if (typeof args.lineHint === "number") planArgs.lineHint = args.lineHint;
    const executionPlan = buildRecipeExecutionPlan(planArgs);
    return {
      requestCandidates: [],
      executionPlan,
      resultType: "report",
      status: "target_not_inferred",
      nextAction:
        "Refine classHint/methodHint/lineHint and rerun recipe_generate before attempting natural or actuated execution.",
      auth: unresolvedAuth,
      notes: ["No matching method candidate inferred from current hints."],
    };
  }

  const searchRootsAbs = buildSearchRoots(args.rootAbs, args.workspaceRootAbs);
  const controllerMatch = await findControllerRequestCandidate({
    searchRootsAbs,
    methodHint: args.methodHint,
    inferredTargetFileAbs: top.file,
  });

  const bestRequest = controllerMatch.recipe;
  const matchedControllerFile = controllerMatch.matchedControllerFile;
  const matchedBranchCondition = controllerMatch.matchedBranchCondition;
  const authRootAbs = controllerMatch.matchedRootAbs ?? args.rootAbs;

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
          workspaceRootAbs: args.workspaceRootAbs,
          endpointPath: bestRequest?.path,
          controllerFileAbs: matchedControllerFile,
          authToken: args.authToken,
          authUsername: args.authUsername,
          authPassword: args.authPassword,
          loginDiscoveryEnabled: args.authLoginDiscoveryEnabled,
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

  const planArgs: Parameters<typeof buildRecipeExecutionPlan>[0] = {
    requestedMode,
    auth,
    targetFile: inferredTarget.file,
  };
  if (typeof args.lineHint === "number") planArgs.lineHint = args.lineHint;
  if (inferredTarget.key) planArgs.inferredTargetKey = inferredTarget.key;
  if (bestRequest) planArgs.requestCandidate = bestRequest;
  const executionPlan = buildRecipeExecutionPlan(planArgs);

  let resultType: RecipeResultType = "recipe";
  let status: RecipeStatus = requestedMode === "actuated" ? "actuated_ready" : "natural_ready";
  let nextAction: string | undefined;

  if (requestedMode === "natural") {
    if (!bestRequest) {
      resultType = "report";
      status = "unreachable_natural";
      nextAction = inferredTarget.key
        ? `Natural mode unavailable: no endpoint candidate could be inferred. Actuated mode is available with key=${inferredTarget.key}.`
        : "Natural mode unavailable: no endpoint candidate could be inferred and target key is missing. Refine classHint/methodHint/lineHint first.";
    } else if (auth.status === "needs_user_input") {
      nextAction =
        `Missing input: ${(auth.missing ?? ["authToken"]).join(", ")}. ` +
        "Provide missing auth inputs and execute the same natural request template.";
    }
  } else if (!inferredTarget.key) {
    resultType = "report";
    status = "actuated_blocked";
    nextAction = "Actuated mode requires an inferred targetKey. Refine classHint/methodHint/lineHint and rerun.";
  }

  const baseNotes = bestRequest
    ? []
    : [
        "No controller call mapping found in the selected module roots; use inferred key with manual endpoint discovery.",
      ];

  if (typeof args.lineHint === "number") {
    baseNotes.push("Success criterion is line_hit when lineHint is provided.");
    baseNotes.push(
      "Use line probe key Class#method:line for line_hit verification.",
    );
    if (typeof inferredTarget.line === "number" && inferredTarget.line !== args.lineHint) {
      baseNotes.push(
        `Provided line hint (${args.lineHint}) differs from inferred method start (${inferredTarget.line}).`,
      );
    }
  }
  if (typeof args.lineHint !== "number") {
    baseNotes.push("Strict line mode: lineHint is required; method-only probe checks are disabled.");
  }

  if (matchedBranchCondition) {
    baseNotes.push(`Line/branch precondition hint: ${matchedBranchCondition}`);
  }

  if (bestRequest?.confidence !== undefined) {
    baseNotes.push(`Request candidate confidence=${bestRequest.confidence.toFixed(2)}.`);
  }
  if (bestRequest?.needsConfirmation?.length) {
    baseNotes.push(`Needs confirmation: ${bestRequest.needsConfirmation.join(" ")}`);
  }
  if (bestRequest?.assumptions?.length) {
    baseNotes.push(`Assumed: ${bestRequest.assumptions.join(" ")}`);
  }
  if (auth.status === "needs_user_input" && bestRequest) {
    baseNotes.push(
      `Missing input: ${(auth.missing ?? ["authToken"]).join(", ")}. Use the generated request skeleton after providing these values.`,
    );
  }

  if (requestedMode === "natural") {
    baseNotes.push("Natural mode does not auto-switch to actuated mode. Actuation requires explicit second prompt.");
  }
  if (requestedMode === "actuated") {
    baseNotes.push(
      "Actuation targets line-level branch behavior only (Class#method:line) and does not imply natural-path reachability.",
    );
  }

  return {
    inferredTarget,
    requestCandidates: bestRequest ? [bestRequest] : [],
    executionPlan,
    resultType,
    status,
    ...(nextAction ? { nextAction } : {}),
    auth,
    notes: baseNotes,
  };
}
