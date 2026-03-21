import * as path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { renderRecipeTemplate } from "@/lib/recipe_template";
import { buildRecipeTemplateModel } from "@/models/recipe_output_model";
import { validateProjectRootAbs } from "@/utils/project_root_validate.util";
import { enrichRuntimeCapture } from "@/utils/recipe_generate/runtime_capture_enrich.util";
import { generateRecipe } from "@/tools/core/recipe_generate/domain";
import { RECIPE_CREATE_TOOL } from "@/tools/core/recipe_generate/contract";

export type RecipeGenerateHandlerDeps = {
  probeBaseUrl: string;
  probeStatusPath: string;
  workspaceRootAbs: string;
};

function isFqcn(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.includes(".")) return false;
  const segments = trimmed.split(".");
  if (segments.some((segment) => segment.length === 0)) return false;
  return segments.every((segment) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment));
}

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
  if (selectedMode === "regression_http_only") return "regression_http_only_no_probe";
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

function compactExecutionPlanForText(executionPlan: {
  selectedMode: string;
  routingReason: string;
  steps: Array<{ phase: string; title: string; instruction: string }>;
  probeCallPlan: unknown;
}) {
  return {
    selectedMode: executionPlan.selectedMode,
    routingReason: compactRoutingReason(executionPlan.selectedMode),
    steps: executionPlan.steps.map((step) => ({
      phase: step.phase,
      actionCode: toActionCode(step),
    })),
    probeCallPlan: executionPlan.probeCallPlan,
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
      const inputHints = {
        classHint: typeof input.classHint === "string" ? input.classHint : undefined,
        methodHint: typeof input.methodHint === "string" ? input.methodHint : undefined,
        lineHint: typeof input.lineHint === "number" ? input.lineHint : undefined,
        apiBasePath: typeof input.apiBasePath === "string" ? input.apiBasePath : undefined,
        actuationEnabled:
          typeof input.actuationEnabled === "boolean" ? input.actuationEnabled : undefined,
        actuationReturnBoolean:
          typeof input.actuationReturnBoolean === "boolean"
            ? input.actuationReturnBoolean
            : undefined,
        actuationActuatorId:
          typeof input.actuationActuatorId === "string" ? input.actuationActuatorId : undefined,
      };
      const deprecatedUsed = deprecatedSelectorKeys.filter(
        (key) => key in (input as Record<string, unknown>),
      );
      if (deprecatedUsed.length > 0) {
        const structuredContent = {
          projectRoot:
            typeof input.projectRootAbs === "string" ? input.projectRootAbs : "(project_root_unset)",
          hints: inputHints,
          resultType: "report",
          status: "project_selector_invalid",
          reasonCode: "project_selector_invalid",
          failedStep: "input_validation",
          evidence: [`unsupportedSelectors=${deprecatedUsed.join(",")}`],
          attemptedStrategies: ["selector_input_validation"],
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
        apiBasePath,
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
          projectRoot: validated.value ?? projectRootAbs ?? "(project_root_unset)",
          hints: inputHints,
          resultType: "report",
          status: validated.status,
          reasonCode: validated.status,
          failedStep: "project_root_validation",
          evidence: [validated.reason],
          attemptedStrategies: ["project_root_validation"],
          reason: validated.reason,
          nextAction: validated.nextAction,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const projectRoot = validated.projectRootAbs;
      if (!isFqcn(classHint)) {
        const structuredContent = {
          projectRoot,
          hints: inputHints,
          resultType: "report",
          status: "class_hint_not_fqcn",
          reasonCode: "class_hint_not_fqcn",
          failedStep: "input_validation",
          evidence: [`classHint=${classHint}`],
          attemptedStrategies: ["class_hint_validation"],
          reason: "classHint must be a fully qualified class name (FQCN).",
          nextAction:
            "Provide exact FQCN in classHint (for example: com.acme.catalog.web.controller.CatalogShoeController) and rerun probe_recipe_create.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const generateArgs: Parameters<typeof generateRecipe>[0] = {
        rootAbs: projectRoot,
        workspaceRootAbs: deps.workspaceRootAbs,
        classHint,
        methodHint,
        intentMode,
      };
      if (typeof lineHint === "number") generateArgs.lineHint = lineHint;
      if (typeof apiBasePath === "string") generateArgs.apiBasePath = apiBasePath;
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
          apiBasePath,
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
        lineTargetProvided: generated.lineTargetProvided,
        probeIntentRequested: generated.probeIntentRequested,
        executionReadiness: generated.executionReadiness,
        missingInputs: generated.missingInputs,
        ...(generated.nextAction ? { nextAction: generated.nextAction } : {}),
        ...(generated.failurePhase ? { failurePhase: generated.failurePhase } : {}),
        ...(generated.failureReasonCode ? { failureReasonCode: generated.failureReasonCode } : {}),
        ...(generated.reasonCode ? { reasonCode: generated.reasonCode } : {}),
        ...(generated.failedStep ? { failedStep: generated.failedStep } : {}),
        ...(generated.synthesizerUsed ? { synthesizerUsed: generated.synthesizerUsed } : {}),
        ...(generated.applicationType ? { applicationType: generated.applicationType } : {}),
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
        lineTargetProvided: generated.lineTargetProvided,
        probeIntentRequested: generated.probeIntentRequested,
        executionReadiness: generated.executionReadiness,
        missingInputs: generated.missingInputs,
        ...(generated.nextAction ? { nextAction: generated.nextAction } : {}),
        ...(generated.failurePhase ? { failurePhase: generated.failurePhase } : {}),
        ...(generated.failureReasonCode ? { failureReasonCode: generated.failureReasonCode } : {}),
        ...(generated.reasonCode ? { reasonCode: generated.reasonCode } : {}),
        ...(generated.failedStep ? { failedStep: generated.failedStep } : {}),
        ...(generated.synthesizerUsed ? { synthesizerUsed: generated.synthesizerUsed } : {}),
        ...(generated.applicationType ? { applicationType: generated.applicationType } : {}),
        ...(generated.trigger
          ? {
              trigger: {
                kind: generated.trigger.kind,
                method: generated.trigger.method,
                path: generated.trigger.path,
                queryTemplate: generated.trigger.queryTemplate,
              },
            }
          : {}),
        attemptedStrategies: generated.attemptedStrategies.slice(0, 6),
        inferenceDiagnostics: generated.inferenceDiagnostics,
        routingReason: generated.executionPlan.routingReason,
        inferredTarget: structuredContent.inferredTarget,
        requestCandidates: generated.requestCandidates.map((candidate) => ({
          method: candidate.method,
          path: candidate.path,
          queryTemplate: candidate.queryTemplate,
        })),
        executionPlan: compactExecutionPlanForText(generated.executionPlan),
        auth: generated.auth,
        runtimeCapture:
          runtimeCapture.status === "available"
            ? {
                status: "available",
                capturePreview: {
                  available: true,
                  captureId: runtimeCapture.capturePreview?.captureId,
                  capturedAtEpoch: runtimeCapture.capturePreview?.capturedAtEpoch,
                },
                lineValidation: runtimeCapture.lineValidation,
                lineResolvable: runtimeCapture.lineResolvable,
              }
            : runtimeCapture,
        notes: generated.notes.slice(0, 6),
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
