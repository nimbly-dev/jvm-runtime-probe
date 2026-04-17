import type {
  BuildPreflightArgs,
  PlanPrerequisite,
  PlanStep,
  PreflightResult,
} from "@tools-core/models/regression_execution_plan_spec.model";

export type {
  BuildPreflightArgs,
  PlanContract,
  PlanMetadata,
  PlanPrerequisite,
  PlanStep,
  PlanTarget,
  PreflightResult,
  PreflightStatus,
  RegressionExecutionIntent,
} from "@tools-core/models/regression_execution_plan_spec.model";

function hasDuplicate(values: number[]): boolean {
  return new Set(values).size !== values.length;
}

function isStrictProbeKey(value: string): boolean {
  return /^[\w.$]+#[\w$]+:\d+$/.test(value.trim());
}

export function buildReplayPreflight(args: BuildPreflightArgs): PreflightResult {
  const { metadata, contract, providedContext, targetCandidateCount } = args;

  if (metadata.execution.intent !== "regression") {
    return {
      status: "blocked_invalid",
      reasonCode: "invalid_execution_intent",
      missing: [],
      requiredUserAction: ["Set metadata.execution.intent to 'regression'."],
    };
  }
  if (!contract.targets.length) {
    return {
      status: "blocked_invalid",
      reasonCode: "target_missing",
      missing: [],
      requiredUserAction: ["Add at least one target in contract.targets."],
    };
  }
  if (!contract.steps.length) {
    return {
      status: "blocked_invalid",
      reasonCode: "steps_missing",
      missing: [],
      requiredUserAction: ["Add at least one step in contract.steps."],
    };
  }

  const stepOrders = contract.steps.map((step) => step.order);
  if (hasDuplicate(stepOrders)) {
    return {
      status: "blocked_invalid",
      reasonCode: "step_order_duplicate",
      missing: [],
      requiredUserAction: ["Ensure each step.order value is unique."],
    };
  }

  const sorted = [...stepOrders].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i + 1) {
      return {
        status: "blocked_invalid",
        reasonCode: "step_order_non_sequential",
        missing: [],
        requiredUserAction: ["Ensure steps are sequentially numbered from 1..N."],
      };
    }
  }

  for (const step of contract.steps) {
    if (!(step.protocol in step.transport)) {
      return {
        status: "blocked_invalid",
        reasonCode: "transport_protocol_mismatch",
        missing: [],
        requiredUserAction: [
          `Add transport.${step.protocol} for step '${step.id}' or correct step.protocol.`,
        ],
      };
    }
  }

  if (targetCandidateCount > 1) {
    return {
      status: "blocked_ambiguous",
      reasonCode: "target_ambiguous",
      missing: [],
      requiredUserAction: ["Narrow selectors (for example sourceRoot/signature) to one target."],
    };
  }

  if (metadata.execution.verifyRuntime && metadata.execution.pinStrictProbeKey) {
    for (const target of contract.targets) {
      const key = target.runtimeVerification?.strictProbeKey;
      if (!key || !isStrictProbeKey(key)) {
        return {
          status: "stale_plan",
          reasonCode: "strict_probe_key_invalid",
          missing: [],
          requiredUserAction: ["Update runtimeVerification.strictProbeKey to Class#method:line."],
        };
      }
    }
  }

  const missing = contract.prerequisites
    .filter((p) => p.required)
    .filter((p) => {
      const provided = providedContext[p.key];
      if (typeof provided !== "undefined" && provided !== null && String(provided).trim() !== "") {
        return false;
      }
      return typeof p.default === "undefined";
    })
    .map((p) => p.key);

  if (missing.length > 0) {
    return {
      status: "needs_user_input",
      reasonCode: "missing_prerequisites",
      missing,
      requiredUserAction: missing.map((field) => `Provide ${field}`),
    };
  }

  return {
    status: "ready",
    reasonCode: "ok",
    missing: [],
    requiredUserAction: [],
  };
}

export function resolvePrerequisiteContext(
  prerequisites: PlanPrerequisite[],
  providedContext: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const prerequisite of prerequisites) {
    const provided = providedContext[prerequisite.key];
    if (typeof provided !== "undefined" && provided !== null && String(provided).trim() !== "") {
      resolved[prerequisite.key] = provided;
      continue;
    }
    if (typeof prerequisite.default !== "undefined") {
      resolved[prerequisite.key] = prerequisite.default;
    }
  }
  return resolved;
}

function deepResolveValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_match, key) => {
      const resolved = context[key];
      if (typeof resolved === "undefined" || resolved === null) {
        throw new Error(`missing_context:${key}`);
      }
      return String(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepResolveValue(item, context));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      output[k] = deepResolveValue(v, context);
    }
    return output;
  }
  return value;
}

export function resolveStepTransport(step: PlanStep, context: Record<string, unknown>): Record<string, unknown> {
  return deepResolveValue(step.transport, context) as Record<string, unknown>;
}

function readByPath(input: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let cursor: unknown = input;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export function applyStepExtract(
  output: Record<string, unknown>,
  extract: Array<{ from: string; as: string }> | undefined,
  context: Record<string, unknown>,
): Record<string, unknown> {
  if (!extract?.length) return context;
  const next = { ...context };
  for (const mapping of extract) {
    const value = readByPath(output, mapping.from);
    if (typeof value !== "undefined") next[mapping.as] = value;
  }
  return next;
}

export function buildTimestampRunId(now: Date, seq: number): string {
  const iso = now.toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
  return `${iso}_${String(seq).padStart(2, "0")}`;
}
