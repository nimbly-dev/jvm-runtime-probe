import type { SynthesizerFailure } from "@/models/synthesis/synthesizer_failure.model";
import type { SynthesizerInput } from "@/models/synthesis/synthesizer_input.model";
import type {
  JvmAstRequestMappingFailure,
  JvmAstRequestMappingResult,
} from "@/models/synthesis/request_mapping_ast.model";
import type { SynthesizerOutput } from "@/models/synthesis/synthesizer_output.model";
import { resolveRequestMappingAst } from "@/lib/request_mapping_ast_resolver";
import { SPRING_FAILURE_CODES } from "@tools-spring-http/failure_codes.util";

export type SynthesizeSpringRecipeDeps = {
  resolveRequestMappingFn?: (input: {
    projectRootAbs: string;
    searchRootsAbs?: string[];
    classHint: string;
    methodHint: string;
    lineHint?: number;
    inferredTargetFileAbs?: string;
  }) => Promise<JvmAstRequestMappingResult>;
};

function readResolverContextPathHint(
  extensions: Record<string, unknown> | undefined,
): string | undefined {
  if (!extensions) return undefined;
  for (const key of ["contextPathHint", "apiBasePath", "contextPath"]) {
    const value = extensions[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function mapResolverFailureToSynthFailure(
  failure: JvmAstRequestMappingFailure,
  input: SynthesizerInput,
): SynthesizerFailure {
  if (
    failure.reasonCode === "ast_resolver_unavailable" ||
    failure.reasonCode === "project_root_invalid" ||
    failure.reasonCode === "target_type_not_found" ||
    failure.reasonCode === "target_type_ambiguous" ||
    failure.reasonCode === "target_method_not_found" ||
    failure.reasonCode === "mapper_plugin_unavailable"
  ) {
    return {
      status: "report",
      reasonCode: failure.reasonCode,
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
    ...(input.searchRootsAbs.length > 0 ? { searchRootsAbs: input.searchRootsAbs } : {}),
    classHint: input.classHint,
    methodHint: input.methodHint,
    ...(typeof input.lineHint === "number" ? { lineHint: input.lineHint } : {}),
    ...(input.inferredTargetFileAbs ? { inferredTargetFileAbs: input.inferredTargetFileAbs } : {}),
  });

  if (resolved.status !== "ok") {
    return mapResolverFailureToSynthFailure(resolved, input);
  }
  const contextPathHint = readResolverContextPathHint(resolved.extensions);

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
      ...(contextPathHint ? [`ast_context_path_hint=${contextPathHint}`] : []),
    ],
    attemptedStrategies: resolved.attemptedStrategies,
  };
  return out;
}
