import type { IntentMode } from "@/utils/recipe_constants.util";

export type RoutingContext = {
  requestedIntentMode: IntentMode;
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
  intentMode: IntentMode;
  lineHint?: number;
}): RoutingContext {
  return {
    requestedIntentMode: args.intentMode,
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
  const probeIntentRequested = requiresLineTarget(ctx.requestedIntentMode);

  return {
    requestedMode: ctx.requestedIntentMode,
    selectedMode: ctx.requestedIntentMode,
    lineTargetProvided,
    probeIntentRequested,
    routingReason:
      ctx.requestedIntentMode === "regression_http_only"
        ? "Regression API checks requested without probe verification."
        : ctx.requestedIntentMode === "single_line_probe"
          ? "Line probe verification requested with explicit line target."
          : "Combined API regression and line probe verification requested with explicit line target.",
  };
}
