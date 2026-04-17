export type RegressionExecutionIntent = "regression";

export type PreflightStatus =
  | "ready"
  | "needs_user_input"
  | "stale_plan"
  | "blocked_ambiguous"
  | "blocked_invalid";

export type PreflightResult = {
  status: PreflightStatus;
  reasonCode: string;
  missing: string[];
  requiredUserAction: string[];
};

export type PlanMetadata = {
  specVersion: string;
  execution: {
    intent: RegressionExecutionIntent;
    verifyRuntime: boolean;
    pinStrictProbeKey: boolean;
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

