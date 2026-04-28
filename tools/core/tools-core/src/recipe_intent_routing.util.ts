import type { IntentMode } from "@tools-core/recipe_constants.util";

export type RoutingContext = {
  intentMode: "line_probe" | "regression";
  lineHint?: number;
};

export type RoutingDecision = {
  requestedMode: IntentMode;
  selectedMode: IntentMode;
  lineTargetProvided: boolean;
  probeIntentRequested: boolean;
  routingReason: string;
};

export function buildRoutingContext(args: {
  intentMode: "line_probe" | "regression";
  lineHint?: number;
}): RoutingContext {
  return {
    intentMode: args.intentMode,
    ...(typeof args.lineHint === "number" ? { lineHint: args.lineHint } : {}),
  };
}

export function hasExplicitLineTarget(ctx: RoutingContext): boolean {
  return typeof ctx.lineHint === "number";
}

export function requiresLineTarget(mode: IntentMode): boolean {
  return mode === "single_line_probe" || mode === "regression_plus_line_probe";
}

export function resolveSelectedMode(ctx: RoutingContext): RoutingDecision {
  const lineTargetProvided = hasExplicitLineTarget(ctx);
  const selectedMode: IntentMode =
    ctx.intentMode === "line_probe" ? "single_line_probe" : "regression";
  const probeIntentRequested = requiresLineTarget(selectedMode);

  return {
    requestedMode: selectedMode,
    selectedMode,
    lineTargetProvided,
    probeIntentRequested,
    routingReason:
      ctx.intentMode === "line_probe"
        ? "Line probe requested with strict line verification semantics."
        : "Regression API checks requested without strict line probe requirement.",
  };
}

