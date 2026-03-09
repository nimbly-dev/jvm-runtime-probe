import * as path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { renderRecipeTemplate } from "../../../lib/recipe_template";
import { buildRecipeTemplateModel } from "../../../models/recipe_output_model";
import type { ServerConfig } from "../../../config/server-config";
import { resolveProjectForInference } from "../../../utils/project_resolution.util";
import { buildRoutingContext, resolveSelectedMode } from "../../../utils/recipe_intent_routing.util";
import { enrichRuntimeCapture } from "../../../utils/recipe_generate/runtime_capture_enrich.util";
import type { ProjectRuntime } from "../../../utils/project_discovery/project_runtime.util";
import { inferTargets } from "../target_infer/domain";
import { generateRecipe } from "./domain";
import { RECIPE_CREATE_TOOL } from "./contract";

export type RecipeGenerateHandlerDeps = {
  config: ServerConfig;
  probeStatusPath: string;
  projectRuntime: ProjectRuntime;
};

export function registerRecipeCreateTool(
  server: McpServer,
  deps: RecipeGenerateHandlerDeps,
): void {
  server.registerTool(
    RECIPE_CREATE_TOOL.name,
    {
      description: RECIPE_CREATE_TOOL.description,
      inputSchema: RECIPE_CREATE_TOOL.inputSchema,
    },
    async ({
      classHint,
      methodHint,
      lineHint,
      intentMode,
      serviceHint,
      projectId,
      workspaceRoot,
      authToken,
      authUsername,
      authPassword,
      actuationEnabled,
      actuationReturnBoolean,
      actuationActuatorId,
      outputTemplate,
    }) => {
      if (
        !deps.projectRuntime.explicitDiscoveryPerformed &&
        (!workspaceRoot || workspaceRoot.trim().length === 0)
      ) {
        const routingDecision = resolveSelectedMode(
          buildRoutingContext({
            intentMode,
            ...(typeof lineHint === "number" ? { lineHint } : {}),
          }),
        );
        const structuredContent = {
          resultType: "report",
          status: "project_list_required",
          selectedMode: routingDecision.selectedMode,
          ...(routingDecision.downgradedFrom
            ? { downgradedFrom: routingDecision.downgradedFrom }
            : {}),
          ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
          nextAction:
            "Call project_list first, then rerun probe_recipe_create. Discovery is required before endpoint/route inference.",
          notes: [
            "probe_recipe_create is blocked until project_list is completed at least once.",
            "This guard prevents endpoint guessing and reduces false negatives from wrong base/context paths.",
          ],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }
      const workspaceRootAbs = path.resolve(workspaceRoot ?? deps.config.workspaceRootAbs);
      const projects = await deps.projectRuntime.ensureProjects(workspaceRootAbs);
      // Future runtime-assisted issue can extend the agent/MCP contract with service/class identity.
      // For now, project selection remains repo-side and uses discovered projects plus source inference.
      const resolution = await resolveProjectForInference(
        {
          workspaceRootAbs,
          projects,
          classHint,
          methodHint,
          ...(typeof lineHint === "number" ? { lineHint } : {}),
          ...(serviceHint ? { serviceHint } : {}),
          ...(projectId ? { projectId } : {}),
        },
        { inferTargetsFn: inferTargets },
      );
      if (resolution.kind === "selector_not_found") {
        const routingDecision = resolveSelectedMode(
          buildRoutingContext({
            intentMode,
            ...(typeof lineHint === "number" ? { lineHint } : {}),
          }),
        );
        const structuredContent = {
          resultType: "report",
          status: "project_resolution_failed",
          selectedMode: routingDecision.selectedMode,
          ...(routingDecision.downgradedFrom
            ? { downgradedFrom: routingDecision.downgradedFrom }
            : {}),
          ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
          workspaceRoot: resolution.workspaceRootAbs,
          hints: { classHint, methodHint, lineHint, serviceHint, projectId },
          projectResolution: {
            mode: resolution.resolutionMode,
            selectorValue: resolution.selectorValue,
            availableProjects: resolution.availableProjects.map((p) => ({
              id: p.id,
              root: p.rootAbs,
            })),
          },
          nextAction: resolution.nextAction,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }
      if (resolution.kind === "cross_project_inference" && resolution.isAmbiguous) {
        const routingDecision = resolveSelectedMode(
          buildRoutingContext({
            intentMode,
            ...(typeof lineHint === "number" ? { lineHint } : {}),
          }),
        );
        const structuredContent = {
          resultType: "report",
          status: "ambiguous_project_match",
          selectedMode: routingDecision.selectedMode,
          ...(routingDecision.downgradedFrom
            ? { downgradedFrom: routingDecision.downgradedFrom }
            : {}),
          ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
          workspaceRoot: resolution.workspaceRootAbs,
          hints: { classHint, methodHint, lineHint, serviceHint, projectId },
          scannedJavaFiles: resolution.scannedJavaFiles,
          projectResolution: {
            mode: resolution.resolutionMode,
            topConfidence: resolution.topConfidence,
            topProjectIds: resolution.topProjectIds,
            isAmbiguous: true,
          },
          candidates: resolution.candidates.map((c) => ({
            ...c,
            file: path.relative(resolution.workspaceRootAbs, c.file) || c.file,
            projectRoot:
              path.relative(resolution.workspaceRootAbs, c.projectRootAbs) || c.projectRootAbs,
          })),
          nextAction:
            "Provide projectId or serviceHint to disambiguate the target project, then rerun probe_recipe_create.",
          notes: [
            "Multiple discovered projects produced equally strong top target matches.",
            "Automatic project selection is blocked to avoid generating a recipe for the wrong service.",
          ],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }
      const resolvedProject =
        resolution.kind === "resolved_project"
          ? resolution
          : {
              workspaceRootAbs: resolution.workspaceRootAbs,
              projectRootAbs: resolution.selectedProjectRootAbs ?? resolution.workspaceRootAbs,
              projectId: resolution.selectedProjectId,
              resolutionMode: resolution.resolutionMode,
            };

      const generateArgs: Parameters<typeof generateRecipe>[0] = {
        rootAbs: resolvedProject.projectRootAbs,
        workspaceRootAbs: resolvedProject.workspaceRootAbs,
        classHint,
        methodHint,
        intentMode,
      };
      if (typeof lineHint === "number") generateArgs.lineHint = lineHint;
      if (authToken) generateArgs.authToken = authToken;
      if (authUsername) generateArgs.authUsername = authUsername;
      if (authPassword) generateArgs.authPassword = authPassword;
      if (typeof actuationEnabled === "boolean") generateArgs.actuationEnabled = actuationEnabled;
      if (typeof actuationReturnBoolean === "boolean") {
        generateArgs.actuationReturnBoolean = actuationReturnBoolean;
      }
      if (actuationActuatorId) generateArgs.actuationActuatorId = actuationActuatorId;
      const generated = await generateRecipe(generateArgs);
      const modelArgs: Parameters<typeof buildRecipeTemplateModel>[0] = {
        classHint,
        methodHint,
        generated,
      };
      if (typeof lineHint === "number") modelArgs.lineHint = lineHint;
      const model = buildRecipeTemplateModel(modelArgs);
      const hasExplicitTemplate =
        typeof outputTemplate === "string" && outputTemplate.trim().length > 0;
      const template = hasExplicitTemplate ? outputTemplate : undefined;
      const rendered = template ? renderRecipeTemplate(template, model) : undefined;

      const inferredKey = generated.inferredTarget?.key;
      const inferredLine =
        typeof lineHint === "number"
          ? lineHint
          : typeof generated.inferredTarget?.line === "number"
            ? generated.inferredTarget.line
            : undefined;
      const runtimeCapture = await enrichRuntimeCapture({
        ...(inferredKey ? { inferredKey } : {}),
        ...(typeof inferredLine === "number" ? { inferredLine } : {}),
        probeBaseUrl: deps.config.probeBaseUrl,
        probeStatusPath: deps.probeStatusPath,
      });

      const structuredContent = {
        workspaceRoot: resolvedProject.workspaceRootAbs,
        projectRoot: resolvedProject.projectRootAbs,
        hints: {
          classHint,
          methodHint,
          lineHint,
          serviceHint,
          projectId,
          actuationEnabled,
          actuationReturnBoolean,
          actuationActuatorId,
        },
        projectResolution:
          resolution.kind === "resolved_project"
            ? {
                mode: resolution.resolutionMode,
                ...(resolution.projectId ? { selectedProjectId: resolution.projectId } : {}),
                selectedProjectRoot: resolution.projectRootAbs,
              }
            : {
                mode: resolution.resolutionMode,
                topConfidence: resolution.topConfidence,
                topProjectIds: resolution.topProjectIds,
                isAmbiguous: false,
                ...(resolution.selectedProjectId
                  ? {
                      selectedProjectId: resolution.selectedProjectId,
                      selectedProjectRoot: resolution.selectedProjectRootAbs,
                    }
                  : {}),
              },
        inferredTarget: generated.inferredTarget
          ? {
              ...generated.inferredTarget,
              file: path.relative(resolvedProject.workspaceRootAbs, generated.inferredTarget.file),
            }
          : undefined,
        requestCandidates: generated.requestCandidates,
        executionPlan: generated.executionPlan,
        resultType: generated.resultType,
        status: generated.status,
        selectedMode: generated.selectedMode,
        ...(generated.downgradedFrom ? { downgradedFrom: generated.downgradedFrom } : {}),
        lineTargetProvided: generated.lineTargetProvided,
        probeIntentRequested: generated.probeIntentRequested,
        executionReadiness: generated.executionReadiness,
        missingInputs: generated.missingInputs,
        ...(generated.routingNote ? { routingNote: generated.routingNote } : {}),
        ...(generated.nextAction ? { nextAction: generated.nextAction } : {}),
        ...(generated.failurePhase ? { failurePhase: generated.failurePhase } : {}),
        ...(generated.failureReasonCode ? { failureReasonCode: generated.failureReasonCode } : {}),
        ...(generated.reasonCode ? { reasonCode: generated.reasonCode } : {}),
        ...(generated.failedStep ? { failedStep: generated.failedStep } : {}),
        ...(generated.synthesizerUsed ? { synthesizerUsed: generated.synthesizerUsed } : {}),
        ...(generated.trigger ? { trigger: generated.trigger } : {}),
        attemptedStrategies: generated.attemptedStrategies,
        evidence: generated.evidence,
        inferenceDiagnostics: generated.inferenceDiagnostics,
        auth: generated.auth,
        notes: generated.notes,
        runtimeCapture,
        ...(rendered ? { rendered } : {}),
      };
      const internalContent = {
        resultType: generated.resultType,
        status: generated.status,
        selectedMode: generated.selectedMode,
        ...(generated.downgradedFrom ? { downgradedFrom: generated.downgradedFrom } : {}),
        lineTargetProvided: generated.lineTargetProvided,
        probeIntentRequested: generated.probeIntentRequested,
        executionReadiness: generated.executionReadiness,
        missingInputs: generated.missingInputs,
        ...(generated.routingNote ? { routingNote: generated.routingNote } : {}),
        ...(generated.nextAction ? { nextAction: generated.nextAction } : {}),
        ...(generated.failurePhase ? { failurePhase: generated.failurePhase } : {}),
        ...(generated.failureReasonCode ? { failureReasonCode: generated.failureReasonCode } : {}),
        ...(generated.reasonCode ? { reasonCode: generated.reasonCode } : {}),
        ...(generated.failedStep ? { failedStep: generated.failedStep } : {}),
        ...(generated.synthesizerUsed ? { synthesizerUsed: generated.synthesizerUsed } : {}),
        ...(generated.trigger ? { trigger: generated.trigger } : {}),
        attemptedStrategies: generated.attemptedStrategies,
        evidence: generated.evidence,
        inferenceDiagnostics: generated.inferenceDiagnostics,
        routingReason: generated.executionPlan.routingReason,
        inferredTarget: structuredContent.inferredTarget,
        requestCandidates: generated.requestCandidates,
        executionPlan: generated.executionPlan,
        auth: generated.auth,
        notes: generated.notes,
        runtimeCapture,
      };
      return {
        content: [
          {
            type: "text",
            text: rendered ?? JSON.stringify(internalContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );
}
