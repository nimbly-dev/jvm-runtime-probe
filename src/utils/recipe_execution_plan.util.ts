import type { AuthResolution } from "../models/auth_resolution.model";
import { redactSecret } from "./redaction.util";
import type { RecipeCandidate, RecipeExecutionPlan, RecipeExecutionStep } from "./recipe_types.util";

function formatAuthHeaderHint(auth: AuthResolution): string {
  if (!auth.requestHeaders) {
    if (auth.status === "needs_user_input") {
      return `Auth unresolved. ${auth.nextAction}`;
    }
    return "No auth headers required.";
  }
  return Object.entries(auth.requestHeaders)
    .map(([k, v]) => `${k}: ${redactSecret(v)}`)
    .join("; ");
}

function buildLineHitInstruction(args: {
  lineHint?: number;
  targetFile?: string;
  inferredTargetKey?: string;
}): string {
  if (typeof args.lineHint !== "number") {
    return "Line hint is required for strict line verification. Return report with status=line_key_required.";
  }
  const breakpointHint = args.targetFile
    ? `Set/confirm a JVM breakpoint at ${args.targetFile}:${args.lineHint}.`
    : `Set/confirm a JVM breakpoint at target line ${args.lineHint}.`;
  const lineKey = args.inferredTargetKey ? `${args.inferredTargetKey}:${args.lineHint}` : undefined;
  if (lineKey) {
    return `${breakpointHint} Success criterion is line_hit via probe_status(key=${lineKey}) with hitCount increased after the request.`;
  }
  return `${breakpointHint} Line key could not be derived for strict line verification. Return report with status=line_key_required.`;
}

export function buildRecipeExecutionPlan(args: {
  requestedMode?: "natural" | "actuated";
  inferredTargetKey?: string;
  targetFile?: string;
  lineHint?: number;
  requestCandidate?: RecipeCandidate;
  auth: AuthResolution;
}): RecipeExecutionPlan {
  const requestedMode = args.requestedMode ?? "natural";
  const key = args.inferredTargetKey ?? "(not inferred)";
  const request = args.requestCandidate;
  const naturalSteps: RecipeExecutionStep[] = [];
  const actuatedSteps: RecipeExecutionStep[] = [];

  if (requestedMode === "natural") {
    if (!request) {
      if (args.auth.status === "needs_user_input") {
        naturalSteps.push({
          phase: "prepare",
          title: "Resolve authentication",
          instruction: args.auth.nextAction,
        });
      }
      naturalSteps.push({
        phase: "prepare",
        title: "Natural path unavailable",
        instruction:
          "Controller/request mapping could not be inferred for this target. Natural reproduction is currently unreachable.",
      });
      naturalSteps.push({
        phase: "prepare",
        title: "Deterministic fallback",
        instruction:
          key === "(not inferred)"
            ? "actuated_mode: unavailable (missing inferred target key). Refine classHint/methodHint/lineHint."
            : `actuated_mode: available (targetKey=${key}${typeof args.lineHint === "number" ? `:${args.lineHint}` : ""}). Use explicit actuated run only after reporting natural unavailability.`,
      });
      naturalSteps.push({
        phase: "verify",
        title: "Report limitation",
        instruction:
          "Return REPORT with status=unreachable_natural and ask whether to proceed with explicit actuated mode.",
      });
      return {
        mode: "natural",
        modeReason:
          "Natural HTTP reproduction path could not be inferred from controller/OpenAPI mapping.",
        naturalSteps,
        actuatedSteps: [],
      };
    }

    if (args.auth.status === "needs_user_input") {
      naturalSteps.push({
        phase: "prepare",
        title: "Resolve authentication",
        instruction: args.auth.nextAction,
      });
    }
    naturalSteps.push({
      phase: "prepare",
      title: "Reset probe baseline",
      instruction:
        key === "(not inferred)"
          ? "Probe key was not inferred; skip reset and rely on application-side logs."
          : typeof args.lineHint === "number"
            ? `Call probe_reset with key=${key}:${args.lineHint} before sending the request.`
            : "Line hint is required for strict line verification; do not run probe reset/status with method-only key.",
    });
    naturalSteps.push({
      phase: "execute",
      title: "Execute natural request",
      instruction:
        `${request.method} ${request.fullUrlHint} (headers: ${formatAuthHeaderHint(args.auth)})` +
        (request.bodyTemplate ? ` body: ${request.bodyTemplate}` : "") +
        " On Windows PowerShell, use curl.exe (not curl alias) and pass payload via a file or variable to avoid quoting/alias issues.",
    });
    naturalSteps.push({
      phase: "verify",
      title: typeof args.lineHint === "number" ? "Verify line hit" : "Line verification unavailable",
      instruction: buildLineHitInstruction({
        ...(typeof args.lineHint === "number" ? { lineHint: args.lineHint } : {}),
        ...(args.targetFile ? { targetFile: args.targetFile } : {}),
        ...(args.inferredTargetKey ? { inferredTargetKey: args.inferredTargetKey } : {}),
      }),
    });
    return {
      mode: "natural",
      modeReason:
        "Natural reproduction path is available from inferred controller/request mapping.",
      naturalSteps,
      actuatedSteps: [],
    };
  }

  const modeReason =
    "Actuated mode was explicitly requested. This is non-natural execution and should be used only after natural mode is reported unreachable.";
  if (key === "(not inferred)") {
    actuatedSteps.push({
      phase: "prepare",
      title: "Refine target inference",
      instruction:
        "Actuation cannot be enabled because probe key was not inferred. Re-run recipe_generate with tighter classHint/methodHint/lineHint.",
    });
  } else {
    const lineActuateKey = typeof args.lineHint === "number" ? `${key}:${args.lineHint}` : undefined;
    const actuateInstruction = lineActuateKey
      ? `Call probe_actuate with mode=actuate, targetKey=${lineActuateKey}, returnBoolean=true, actuatorId=recipe_generate_fallback to force branch-taken on conditional jumps at that line. Use returnBoolean=false to force fallthrough.`
      : "Line hint is required for branch actuation. Return report with status=line_key_required.";
    actuatedSteps.push({
      phase: "prepare",
      title: "Enable actuation mode",
      instruction: actuateInstruction,
    });
    actuatedSteps.push({
      phase: "verify",
      title: typeof args.lineHint === "number" ? "Verify line hit after trigger" : "Line verification unavailable",
      instruction:
        typeof args.lineHint === "number"
          ? `Invoke the closest reachable trigger path. Then require line_hit at line ${args.lineHint}; do not treat probe_hit alone as success.`
          : "Line hint is required for strict line verification. Return report with status=line_key_required.",
    });
    actuatedSteps.push({
      phase: "cleanup",
      title: "Cleanup actuation",
      instruction:
        lineActuateKey
          ? `Call probe_actuate with mode=observe, targetKey=${lineActuateKey} to disarm override behavior.`
          : "Call probe_actuate with mode=observe to disarm override behavior.",
    });
  }
  return {
    mode: "actuated",
    modeReason,
    naturalSteps,
    actuatedSteps,
  };
}
