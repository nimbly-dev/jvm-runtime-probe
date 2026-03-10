import type { SynthesizerFailure } from "../../../models/synthesis/synthesizer_failure.model";
import type { SynthesizerInput } from "../../../models/synthesis/synthesizer_input.model";
import type {
  JvmAstRequestMappingFailure,
  JvmAstRequestMappingResult,
} from "../../../models/synthesis/request_mapping_ast.model";
import type { SynthesizerOutput } from "../../../models/synthesis/synthesizer_output.model";
import { resolveRequestMappingAst } from "../../../lib/request_mapping_ast_resolver";
import { SPRING_FAILURE_CODES } from "./failure_codes.util";

export type SynthesizeSpringRecipeDeps = {
  resolveRequestMappingFn?: (input: {
    projectRootAbs: string;
    classHint: string;
    methodHint: string;
    lineHint?: number;
    inferredTargetFileAbs?: string;
  }) => Promise<JvmAstRequestMappingResult>;
};

function mapResolverFailureToSynthFailure(
  failure: JvmAstRequestMappingFailure,
  input: SynthesizerInput,
): SynthesizerFailure {
  if (failure.reasonCode === "ast_resolver_unavailable") {
    return {
      status: "report",
      reasonCode: "ast_resolver_unavailable",
      failedStep: failure.failedStep,
      nextAction: failure.nextAction,
      evidence: failure.evidence,
      attemptedStrategies: failure.attemptedStrategies,
      synthesizerUsed: "spring",
    };
  }

  return {
    status: "report",
    reasonCode: SPRING_FAILURE_CODES.ENTRYPOINT_NOT_PROVEN,
    failedStep: "spring_entrypoint_resolution",
    nextAction:
      "Spring entrypoint could not be proven from AST-backed request mapping resolution. Provide tighter classHint/methodHint/lineHint and rerun probe_recipe_create.",
    evidence: [
      `classHint=${input.classHint}`,
      `methodHint=${input.methodHint}`,
      `lineHint=${typeof input.lineHint === "number" ? String(input.lineHint) : "(none)"}`,
      ...failure.evidence,
    ],
    attemptedStrategies: failure.attemptedStrategies,
    synthesizerUsed: "spring",
  };
}

export async function synthesizeSpringRecipe(
  input: SynthesizerInput,
  deps: SynthesizeSpringRecipeDeps = {},
): Promise<SynthesizerOutput | SynthesizerFailure> {
  const resolveRequestMappingFn = deps.resolveRequestMappingFn ?? resolveRequestMappingAst;
  const resolved = await resolveRequestMappingFn({
    projectRootAbs: input.rootAbs,
    classHint: input.classHint,
    methodHint: input.methodHint,
    ...(typeof input.lineHint === "number" ? { lineHint: input.lineHint } : {}),
    ...(input.inferredTargetFileAbs ? { inferredTargetFileAbs: input.inferredTargetFileAbs } : {}),
  });

  if (resolved.status !== "ok") {
    return mapResolverFailureToSynthFailure(resolved, input);
  }

  const out: SynthesizerOutput = {
    status: "recipe",
    synthesizerUsed: "spring",
    framework: "spring",
    requestCandidate: resolved.requestCandidate,
    trigger: {
      kind: "http",
      method: resolved.requestCandidate.method,
      path: resolved.requestCandidate.path,
      queryTemplate: resolved.requestCandidate.queryTemplate,
      fullUrlHint: resolved.requestCandidate.fullUrlHint,
      ...(resolved.requestCandidate.bodyTemplate
        ? { bodyTemplate: resolved.requestCandidate.bodyTemplate }
        : {}),
      headers: {},
      ...(resolved.requestCandidate.bodyTemplate ? { contentType: "application/json" } : {}),
    },
    requestSource: resolved.requestSource,
    matchedControllerFile: resolved.matchedTypeFile,
    matchedRootAbs: resolved.matchedRootAbs,
    evidence: [
      `request_source=${resolved.requestSource}`,
      `controller_file=${resolved.matchedTypeFile}`,
      `ast_framework=${resolved.framework}`,
      ...resolved.evidence,
    ],
    attemptedStrategies: resolved.attemptedStrategies,
  };
  return out;
}
