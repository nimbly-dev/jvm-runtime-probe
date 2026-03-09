import type { SynthesizerFailure } from "../../../models/synthesis/synthesizer_failure.model";
import type { SynthesizerInput } from "../../../models/synthesis/synthesizer_input.model";
import type { SynthesizerOutput } from "../../../models/synthesis/synthesizer_output.model";
import { buildSearchRoots, findControllerRequestCandidate } from "./request_candidate.util";
import { SPRING_FAILURE_CODES } from "./failure_codes.util";

export async function synthesizeSpringRecipe(
  input: SynthesizerInput,
): Promise<SynthesizerOutput | SynthesizerFailure> {
  const searchRootsAbs =
    input.searchRootsAbs.length > 0
      ? input.searchRootsAbs
      : buildSearchRoots(input.rootAbs, input.workspaceRootAbs);

  const match = await findControllerRequestCandidate({
    searchRootsAbs,
    methodHint: input.methodHint,
    ...(input.inferredTargetFileAbs ? { inferredTargetFileAbs: input.inferredTargetFileAbs } : {}),
  });

  if (!match.recipe) {
    const out: SynthesizerFailure = {
      status: "report",
      reasonCode: SPRING_FAILURE_CODES.ENTRYPOINT_NOT_PROVEN,
      failedStep: "spring_entrypoint_resolution",
      nextAction:
        "Spring entrypoint could not be proven from controller mappings. Provide tighter classHint/methodHint/lineHint and rerun probe_recipe_create.",
      evidence: [
        `classHint=${input.classHint}`,
        `methodHint=${input.methodHint}`,
        `lineHint=${typeof input.lineHint === "number" ? String(input.lineHint) : "(none)"}`,
      ],
      attemptedStrategies: ["spring_annotation_mapping", "spring_call_chain_resolution"],
      synthesizerUsed: "spring",
    };
    return out;
  }

  const out: SynthesizerOutput = {
    status: "recipe",
    synthesizerUsed: "spring",
    framework: "spring",
    requestCandidate: match.recipe,
    trigger: {
      kind: "http",
      method: match.recipe.method,
      path: match.recipe.path,
      queryTemplate: match.recipe.queryTemplate,
      fullUrlHint: match.recipe.fullUrlHint,
      ...(match.recipe.bodyTemplate ? { bodyTemplate: match.recipe.bodyTemplate } : {}),
      headers: {},
      ...(match.recipe.bodyTemplate ? { contentType: "application/json" } : {}),
    },
    ...(match.requestSource ? { requestSource: match.requestSource } : {}),
    ...(match.matchedControllerFile ? { matchedControllerFile: match.matchedControllerFile } : {}),
    ...(match.matchedBranchCondition ? { matchedBranchCondition: match.matchedBranchCondition } : {}),
    ...(match.matchedRootAbs ? { matchedRootAbs: match.matchedRootAbs } : {}),
    evidence: [
      `request_source=${match.requestSource ?? "unknown"}`,
      `controller_file=${match.matchedControllerFile ?? "(not_provided)"}`,
    ],
    attemptedStrategies: ["spring_annotation_mapping", "spring_call_chain_resolution"],
  };
  return out;
}
