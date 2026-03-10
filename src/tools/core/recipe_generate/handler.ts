import * as path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { renderRecipeTemplate } from "../../../lib/recipe_template";
import { buildRecipeTemplateModel } from "../../../models/recipe_output_model";
import { validateProjectRootAbs } from "../../../utils/project_root_validate.util";
import { enrichRuntimeCapture } from "../../../utils/recipe_generate/runtime_capture_enrich.util";
import { generateRecipe } from "./domain";
import { RECIPE_CREATE_TOOL } from "./contract";

export type RecipeGenerateHandlerDeps = {
  probeBaseUrl: string;
  probeStatusPath: string;
};

function toActionCode(step: { title: string }): string {
  const title = step.title.trim().toLowerCase();
  if (title === "resolve authentication") return "resolve_auth";
  if (title === "request candidate missing") return "request_candidate_missing";
  if (title === "return report") return "return_report";
  if (title === "line target unresolved") return "line_target_unresolved";
  if (title === "reset probe baseline") return "probe_reset_baseline";
  if (title === "execute regression api check") return "execute_api_check";
  if (title === "verify api regression outcome") return "verify_api_regression";
  if (title === "execute probe trigger request") return "execute_probe_trigger";
  if (title === "verify single-line probe hit") return "verify_probe_hit";
  if (title === "verify api and line probe outcomes") return "verify_api_and_probe";
  if (title === "enable branch actuation") return "enable_actuation";
  if (title === "disable branch actuation") return "disable_actuation";
  return title.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function compactRoutingReason(selectedMode: string): string {
  if (selectedMode === "regression_api_only") return "regression_api_only_no_probe";
  if (selectedMode === "single_line_probe") return "single_line_probe";
  if (selectedMode === "regression_plus_line_probe") return "regression_plus_line_probe";
  return "mode_selected";
}

function compactExecutionPlanForOutput(args: {
  resultType: "recipe" | "report";
  executionPlan: {
    selectedMode: string;
    routingReason: string;
    steps: Array<{ phase: string; title: string; instruction: string }>;
    probeCallPlan: unknown;
  };
}) {
  if (args.resultType !== "report") return args.executionPlan;
  return {
    selectedMode: args.executionPlan.selectedMode,
    routingReason: compactRoutingReason(args.executionPlan.selectedMode),
    steps: args.executionPlan.steps.map((step) => ({
      phase: step.phase,
      actionCode: toActionCode(step),
    })),
    probeCallPlan: args.executionPlan.probeCallPlan,
  };
}

export function registerRecipeCreateTool(
  server: McpServer,
  deps: RecipeGenerateHandlerDeps,
): void {
  const deprecatedSelectorKeys = ["serviceHint", "projectId", "workspaceRoot"] as const;

  server.registerTool(
    RECIPE_CREATE_TOOL.name,
    {
      description: RECIPE_CREATE_TOOL.description,
      inputSchema: RECIPE_CREATE_TOOL.inputSchema,
    },
    async (input) => {
      const deprecatedUsed = deprecatedSelectorKeys.filter(
        (key) => key in (input as Record<string, unknown>),
      );
      if (deprecatedUsed.length > 0) {
        const structuredContent = {
          resultType: "report",
          status: "project_selector_invalid",
          reason: `Unsupported selector inputs: ${deprecatedUsed.join(", ")}`,
          nextAction:
            "Remove legacy selector fields and provide only projectRootAbs as the project selector.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const {
        projectRootAbs,
        classHint,
        methodHint,
        lineHint,
        intentMode,
        authToken,
        authUsername,
        authPassword,
        actuationEnabled,
        actuationReturnBoolean,
        actuationActuatorId,
        outputTemplate,
      } = input;

      const validated = await validateProjectRootAbs(projectRootAbs);
      if (!validated.ok) {
        const structuredContent = {
          resultType: "report",
          status: validated.status,
          reason: validated.reason,
          ...(validated.value ? { projectRootAbs: validated.value } : {}),
          nextAction: validated.nextAction,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const projectRoot = validated.projectRootAbs;
      const generateArgs: Parameters<typeof generateRecipe>[0] = {
        rootAbs: projectRoot,
        workspaceRootAbs: projectRoot,
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
        probeBaseUrl: deps.probeBaseUrl,
        probeStatusPath: deps.probeStatusPath,
      });

      const structuredContent = {
        projectRoot,
        hints: {
          classHint,
          methodHint,
          lineHint,
          actuationEnabled,
          actuationReturnBoolean,
          actuationActuatorId,
        },
        inferredTarget: generated.inferredTarget
          ? {
              ...generated.inferredTarget,
              file: path.relative(projectRoot, generated.inferredTarget.file),
            }
          : undefined,
        requestCandidates: generated.requestCandidates,
        executionPlan: compactExecutionPlanForOutput({
          resultType: generated.resultType,
          executionPlan: generated.executionPlan,
        }),
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
        executionPlan: compactExecutionPlanForOutput({
          resultType: generated.resultType,
          executionPlan: generated.executionPlan,
        }),
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
