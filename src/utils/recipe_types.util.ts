import type { IntentMode } from "./recipe_constants.util";

export type RecipeCandidate = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  queryTemplate: string;
  fullUrlHint: string;
  bodyTemplate?: string;
  confidence?: number;
  assumptions?: string[];
  needsConfirmation?: string[];
  rationale: string[];
};

export type RequestInferenceSource =
  | "spring_mvc"
  | "jaxrs"
  | "openapi"
  | "controller_declaration_fallback";

export type InferenceFailurePhase = "target_inference" | "request_inference" | "auth_resolution";

export type InferenceDiagnostics = {
  target: {
    attempted: true;
    matched: boolean;
    candidateCount: number;
    topConfidence?: number;
  };
  request: {
    attempted: true;
    matched: boolean;
    source?: RequestInferenceSource;
  };
};

export type RecipeExecutionStep = {
  phase: "prepare" | "execute" | "verify" | "cleanup";
  title: string;
  instruction: string;
};

export type ProbeCallPlan = {
  total: number;
  verificationMethod: "probe_wait_hit";
  actuated: boolean;
  byTool: {
    probe_reset: number;
    probe_wait_hit: number;
    probe_status: number;
    probe_actuate: number;
  };
};

export type MissingExecutionInput = {
  category: "auth" | "request" | "probe" | "actuation" | "confirmation";
  field: string;
  reason: string;
  suggestedAction: string;
};

export type ExecutionReadiness = "ready" | "needs_user_input";

export type RecipeExecutionPlan = {
  selectedMode: IntentMode;
  routingReason: string;
  steps: RecipeExecutionStep[];
  probeCallPlan: ProbeCallPlan;
};
