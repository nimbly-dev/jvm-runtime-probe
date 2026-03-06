import type { RecipeTemplateModel } from "../lib/recipe_template";
import type { generateRecipe } from "../tools/recipe_generate";
import type { RecipeExecutionStep } from "../utils/recipe_types.util";
import { redactSecret } from "../utils/redaction.util";

type GeneratedRecipe = Awaited<ReturnType<typeof generateRecipe>>;

function formatSteps(steps: RecipeExecutionStep[]): string {
  if (steps.length === 0) return "No steps available.";
  return steps
    .map((s, index) => `${index + 1}. [${s.phase}] ${s.title}\n   ${s.instruction}`)
    .join("\n");
}

function formatRecipeSteps(generated: GeneratedRecipe): string {
  const selectedModeLine = `Selected mode: ${generated.selectedMode}`;
  if (generated.resultType === "report") {
    const missingInput =
      generated.auth.status === "needs_user_input"
        ? `Missing Input: ${(generated.auth.missing ?? []).join(", ") || "authToken"}`
        : "Missing Input: (none)";
    return [
      "Reproduction report",
      selectedModeLine,
      `Status: ${generated.status}`,
      generated.routingNote ? `Routing Note: ${generated.routingNote}` : "Routing Note: (none)",
      generated.nextAction ? `Next Action: ${generated.nextAction}` : "Next Action: (none)",
      missingInput,
      "",
      "Context:",
      formatSteps(generated.executionPlan.steps),
    ].join("\n");
  }
  return [
    "Reproduction execution plan",
    selectedModeLine,
    `Routing Reason: ${generated.executionPlan.routingReason}`,
    generated.routingNote ? `Routing Note: ${generated.routingNote}` : "Routing Note: (none)",
    formatSteps(generated.executionPlan.steps),
  ].join("\n");
}

export function buildRecipeTemplateModel(args: {
  classHint: string;
  methodHint: string;
  lineHint?: number;
  generated: GeneratedRecipe;
}): RecipeTemplateModel {
  const { classHint, methodHint, lineHint, generated } = args;
  const inferredPath = generated.inferredTarget?.key
    ? generated.inferredTarget.key
    : `${classHint}.${methodHint}`;
  const firstReq = generated.requestCandidates[0];
  const requestDetails = firstReq
    ? `${firstReq.method} ${firstReq.fullUrlHint}${firstReq.bodyTemplate ? ` body=${firstReq.bodyTemplate}` : ""}${typeof firstReq.confidence === "number" ? ` confidence=${firstReq.confidence.toFixed(2)}` : ""}`
    : generated.nextAction
      ? `Request candidate unavailable. ${generated.nextAction}`
      : "Request candidate unavailable. Provide workspace/class/method hints and rerun.";
  const authHeaders = generated.auth.requestHeaders
    ? Object.entries(generated.auth.requestHeaders)
        .map(([k, v]) => `${k}: ${redactSecret(v)}`)
        .join("; ")
    : "Not provided";
  const authMissing = generated.auth.missing?.join(", ") ?? "-";
  const authLoginPath = generated.auth.loginHint?.path ?? "Not inferred";
  const authLoginBody = generated.auth.loginHint?.bodyTemplate ?? "Not inferred";
  const recipeSteps = formatRecipeSteps(generated);
  const planMode = generated.executionPlan.selectedMode;
  const planReason = generated.executionPlan.routingReason;
  const successCriterion =
    generated.selectedMode === "regression_api_only"
      ? "api_regression_only"
      : typeof lineHint === "number"
        ? "line_hit (probe key Class#method:line; breakpoint optional)"
        : "line_key_required (Class#method:line)";

  return {
    "target.path": inferredPath,
    "target.class": classHint,
    "target.method": methodHint,
    "target.line_hint": typeof lineHint === "number" ? String(lineHint) : "Not provided",
    "probe.key": generated.inferredTarget?.key ?? "Not inferred",
    "probe.hit": "Not executed (recipe only)",
    "http.request": requestDetails,
    "http.method": firstReq?.method ?? "Not inferred",
    "http.path": firstReq?.path ?? "Not inferred",
    "http.query": firstReq?.queryTemplate ?? "Not inferred",
    "http.code": "Not executed",
    "http.response": "Not executed",
    execution_hit: "not_executed",
    api_outcome: "not_executed",
    repro_status: generated.status,
    "auth.required": String(generated.auth.required),
    "auth.status": generated.auth.status,
    "auth.strategy": generated.auth.strategy,
    "auth.next_action": generated.auth.nextAction,
    "auth.headers": authHeaders,
    "auth.missing": authMissing,
    "auth.source": generated.auth.source ?? "Not resolved",
    "auth.login.path": authLoginPath,
    "auth.login.body": authLoginBody,
    "recipe.mode": planMode,
    "recipe.mode_reason": planReason,
    "recipe.steps": recipeSteps,
    "run.duration": "Not measured",
    "run.notes":
      [
        `result_type=${generated.resultType}`,
        `status=${generated.status}`,
        `selected_mode=${generated.selectedMode}`,
        `routing_reason=${planReason}`,
        generated.failurePhase ? `failure_phase=${generated.failurePhase}` : "",
        generated.failureReasonCode ? `failure_reason=${generated.failureReasonCode}` : "",
        `inference_target_matched=${String(generated.inferenceDiagnostics.target.matched)}`,
        `inference_request_matched=${String(generated.inferenceDiagnostics.request.matched)}`,
        generated.inferenceDiagnostics.request.source
          ? `inference_request_source=${generated.inferenceDiagnostics.request.source}`
          : "",
        generated.routingNote ? `routing_note=${generated.routingNote}` : "",
        `success_criterion=${successCriterion}`,
        ...generated.notes,
        ...generated.auth.notes,
      ]
        .filter((s) => s.length > 0)
        .join(" | ") || "-",
  };
}
