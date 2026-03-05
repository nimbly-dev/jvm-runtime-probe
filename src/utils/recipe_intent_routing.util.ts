import { LINE_TARGET_MISSING_NOTE, type IntentMode } from "./recipe_constants.util";

export type RoutingContext = {
  requestedIntentMode: IntentMode;
  lineHint?: number;
};

export type RoutingDecision = {
  requestedMode: IntentMode;
  selectedMode: IntentMode;
  lineTargetProvided: boolean;
  probeIntentRequested: boolean;
  downgradedFrom?: IntentMode;
  routingNote?: string;
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

  if (probeIntentRequested && !lineTargetProvided) {
    return {
      requestedMode: ctx.requestedIntentMode,
      selectedMode: "regression_api_only",
      lineTargetProvided,
      probeIntentRequested,
      downgradedFrom: ctx.requestedIntentMode,
      routingNote: LINE_TARGET_MISSING_NOTE,
      routingReason:
        "Probe intent requires explicit line target. Routing downgraded to regression API only.",
    };
  }

  return {
    requestedMode: ctx.requestedIntentMode,
    selectedMode: ctx.requestedIntentMode,
    lineTargetProvided,
    probeIntentRequested,
    routingReason:
      ctx.requestedIntentMode === "regression_api_only"
        ? "Regression API checks requested without probe verification."
        : ctx.requestedIntentMode === "single_line_probe"
          ? "Line probe verification requested with explicit line target."
          : "Combined API regression and line probe verification requested with explicit line target.",
  };
}
