export type RegressionExecutionIntent = "regression";

export type PreflightStatus =
  | "ready"
  | "needs_user_input"
  | "needs_discovery"
  | "stale_plan"
  | "blocked_ambiguous"
  | "blocked_invalid";

export type PreflightReasonCode =
  | "ok"
  | "missing_prerequisites_user_input"
  | "missing_prerequisites_discoverable"
  | "missing_prerequisites_mixed"
  | "discoverable_prerequisite_policy_disabled"
  | "invalid_execution_intent"
  | "target_missing"
  | "steps_missing"
  | "step_order_duplicate"
  | "step_order_non_sequential"
  | "transport_protocol_mismatch"
  | "target_ambiguous"
  | "strict_probe_key_invalid"
  | "invalid_discoverable_prerequisite"
  | "secret_default_forbidden";

export type PrerequisiteProvisioning = "user_input" | "discoverable";

export type PrerequisiteResolutionStatus =
  | "provided"
  | "default_applied"
  | "discoverable_pending"
  | "needs_user_input";

export type PrerequisiteResolution = {
  key: string;
  required: boolean;
  secret: boolean;
  provisioning: PrerequisiteProvisioning;
  status: PrerequisiteResolutionStatus;
};

export type PreflightResult = {
  status: PreflightStatus;
  reasonCode: PreflightReasonCode;
  missing: string[];
  discoverablePending: string[];
  prerequisiteResolution: PrerequisiteResolution[];
  requiredUserAction: string[];
};

export type PlanMetadata = {
  specVersion: string;
  execution: {
    intent: RegressionExecutionIntent;
    verifyRuntime: boolean;
    pinStrictProbeKey: boolean;
    discoveryPolicy: "disabled" | "allow_discoverable_prerequisites";
    retry?: {
      enabled: boolean;
      maxAttempts: number;
    };
  };
};

export type PlanPrerequisite = {
  key: string;
  required: boolean;
  secret: boolean;
  provisioning: PrerequisiteProvisioning;
  discoverySource?: "datasource" | "runtime_context";
  default?: unknown;
};

export type PlanTarget = {
  type: "class_method" | "class_scope" | "module_scope";
  selectors: {
    fqcn: string;
    method?: string;
    signature?: string;
    sourceRoot?: string;
  };
  runtimeVerification?: {
    strictProbeKey: string;
  };
};

export type PlanStep = {
  order: number;
  id: string;
  targetRef: number;
  protocol: string;
  transport: Record<string, unknown>;
  extract?: Array<{ from: string; as: string }>;
};

export type PlanContract = {
  targets: PlanTarget[];
  prerequisites: PlanPrerequisite[];
  steps: PlanStep[];
  expectations: Array<Record<string, unknown>>;
};

export type BuildPreflightArgs = {
  metadata: PlanMetadata;
  contract: PlanContract;
  providedContext: Record<string, unknown>;
  targetCandidateCount: number;
};

