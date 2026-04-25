import type {
  BuildPreflightArgs,
  PlanPrerequisite,
  PrerequisiteResolution,
  PlanStep,
  PreflightResult,
} from "@tools-regression-execution-plan-spec/models/regression_execution_plan_spec.model";

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
} from "@tools-regression-execution-plan-spec/models/regression_execution_plan_spec.model";

function hasDuplicate(values: number[]): boolean {
  return new Set(values).size !== values.length;
}

function isStrictProbeKey(value: string): boolean {
  return /^[\w.$]+#[\w$]+:\d+$/.test(value.trim());
}

function hasNonBlank(value: unknown): boolean {
  return typeof value !== "undefined" && value !== null && String(value).trim() !== "";
}

function emptyPreflightDetails() {
  return {
    missing: [] as string[],
    discoverablePending: [] as string[],
    prerequisiteResolution: [] as PrerequisiteResolution[],
  };
}

function classifyPrerequisites(args: {
  prerequisites: PlanPrerequisite[];
  providedContext: Record<string, unknown>;
  discoveryPolicy: "disabled" | "allow_discoverable_prerequisites";
}):
  | {
      type: "ok";
      resolution: PrerequisiteResolution[];
      missing: string[];
      discoverablePending: string[];
    }
  | {
      type: "blocked_invalid";
      reasonCode:
        | "invalid_discoverable_prerequisite"
        | "discoverable_prerequisite_policy_disabled"
        | "secret_default_forbidden";
      requiredUserAction: string[];
      resolution: PrerequisiteResolution[];
    } {
  const resolution: PrerequisiteResolution[] = [];
  const missing: string[] = [];
  const discoverablePending: string[] = [];

  for (const prerequisite of args.prerequisites) {
    if (prerequisite.secret && typeof prerequisite.default !== "undefined") {
      return {
        type: "blocked_invalid",
        reasonCode: "secret_default_forbidden",
        requiredUserAction: [
          `Remove default value from secret prerequisite '${prerequisite.key}'.`,
        ],
        resolution,
      };
    }

    if (
      prerequisite.provisioning === "discoverable" &&
      (typeof prerequisite.discoverySource === "undefined" || prerequisite.discoverySource === null)
    ) {
      return {
        type: "blocked_invalid",
        reasonCode: "invalid_discoverable_prerequisite",
        requiredUserAction: [
          `Set discoverySource for discoverable prerequisite '${prerequisite.key}'.`,
        ],
        resolution,
      };
    }

    const provided = args.providedContext[prerequisite.key];
    if (hasNonBlank(provided)) {
      resolution.push({
        key: prerequisite.key,
        required: prerequisite.required,
        secret: prerequisite.secret,
        provisioning: prerequisite.provisioning,
        status: "provided",
      });
      continue;
    }

    if (typeof prerequisite.default !== "undefined") {
      resolution.push({
        key: prerequisite.key,
        required: prerequisite.required,
        secret: prerequisite.secret,
        provisioning: prerequisite.provisioning,
        status: "default_applied",
      });
      continue;
    }

    if (!prerequisite.required) {
      continue;
    }

    if (prerequisite.provisioning === "discoverable") {
      if (args.discoveryPolicy !== "allow_discoverable_prerequisites") {
        return {
          type: "blocked_invalid",
          reasonCode: "discoverable_prerequisite_policy_disabled",
          requiredUserAction: [
            "Set metadata.execution.discoveryPolicy to allow_discoverable_prerequisites.",
          ],
          resolution,
        };
      }
      discoverablePending.push(prerequisite.key);
      resolution.push({
        key: prerequisite.key,
        required: prerequisite.required,
        secret: prerequisite.secret,
        provisioning: prerequisite.provisioning,
        status: "discoverable_pending",
      });
      continue;
    }

    missing.push(prerequisite.key);
    resolution.push({
      key: prerequisite.key,
      required: prerequisite.required,
      secret: prerequisite.secret,
      provisioning: prerequisite.provisioning,
      status: "needs_user_input",
    });
  }

  return {
    type: "ok",
    resolution,
    missing,
    discoverablePending,
  };
}

export function buildReplayPreflight(args: BuildPreflightArgs): PreflightResult {
  const { metadata, contract, providedContext, targetCandidateCount } = args;

  if (metadata.execution.intent !== "regression") {
    return {
      status: "blocked_invalid",
      reasonCode: "invalid_execution_intent",
      ...emptyPreflightDetails(),
      requiredUserAction: ["Set metadata.execution.intent to 'regression'."],
    };
  }
  if (!contract.targets.length) {
    return {
      status: "blocked_invalid",
      reasonCode: "target_missing",
      ...emptyPreflightDetails(),
      requiredUserAction: ["Add at least one target in contract.targets."],
    };
  }
  if (!contract.steps.length) {
    return {
      status: "blocked_invalid",
      reasonCode: "steps_missing",
      ...emptyPreflightDetails(),
      requiredUserAction: ["Add at least one step in contract.steps."],
    };
  }

  const stepOrders = contract.steps.map((step) => step.order);
  if (hasDuplicate(stepOrders)) {
    return {
      status: "blocked_invalid",
      reasonCode: "step_order_duplicate",
      ...emptyPreflightDetails(),
      requiredUserAction: ["Ensure each step.order value is unique."],
    };
  }

  const sorted = [...stepOrders].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i + 1) {
        return {
          status: "blocked_invalid",
          reasonCode: "step_order_non_sequential",
          ...emptyPreflightDetails(),
          requiredUserAction: ["Ensure steps are sequentially numbered from 1..N."],
        };
      }
  }

  for (const step of contract.steps) {
    if (!(step.protocol in step.transport)) {
      return {
        status: "blocked_invalid",
        reasonCode: "transport_protocol_mismatch",
        ...emptyPreflightDetails(),
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
      ...emptyPreflightDetails(),
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
          ...emptyPreflightDetails(),
          requiredUserAction: ["Update runtimeVerification.strictProbeKey to Class#method:line."],
        };
      }
    }
  }

  const prerequisiteClassification = classifyPrerequisites({
    prerequisites: contract.prerequisites,
    providedContext,
    discoveryPolicy: metadata.execution.discoveryPolicy,
  });

  if (prerequisiteClassification.type === "blocked_invalid") {
    return {
      status: "blocked_invalid",
      reasonCode: prerequisiteClassification.reasonCode,
      missing: [],
      discoverablePending: [],
      prerequisiteResolution: prerequisiteClassification.resolution,
      requiredUserAction: prerequisiteClassification.requiredUserAction,
    };
  }

  const { missing, discoverablePending, resolution } = prerequisiteClassification;

  if (missing.length > 0 && discoverablePending.length > 0) {
    return {
      status: "needs_user_input",
      reasonCode: "missing_prerequisites_mixed",
      missing,
      discoverablePending,
      prerequisiteResolution: resolution,
      requiredUserAction: [
        ...missing.map((field) => `Provide ${field}`),
        `Run discovery resolver for: ${discoverablePending.join(", ")}`,
      ],
    };
  }

  if (missing.length > 0) {
    return {
      status: "needs_user_input",
      reasonCode: "missing_prerequisites_user_input",
      missing,
      discoverablePending,
      prerequisiteResolution: resolution,
      requiredUserAction: missing.map((field) => `Provide ${field}`),
    };
  }

  if (discoverablePending.length > 0) {
    return {
      status: "needs_discovery",
      reasonCode: "missing_prerequisites_discoverable",
      missing,
      discoverablePending,
      prerequisiteResolution: resolution,
      requiredUserAction: [`Run discovery resolver for: ${discoverablePending.join(", ")}`],
    };
  }

  return {
    status: "ready",
    reasonCode: "ok",
    missing: [],
    discoverablePending: [],
    prerequisiteResolution: resolution,
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
    if (hasNonBlank(provided)) {
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

