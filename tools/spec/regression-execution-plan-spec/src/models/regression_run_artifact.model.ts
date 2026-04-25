import type { PreflightResult } from "@tools-regression-execution-plan-spec/models/regression_execution_plan_spec.model";

export type RegressionRunStatus = "pass" | "fail" | "blocked";

export type RegressionPlanReference = {
  name?: string;
  path?: string;
};

export type RegressionRunExecutionResult = {
  status: RegressionRunStatus;
  preflight: PreflightResult;
  startedAt: string | null;
  endedAt: string | null;
  steps: Array<Record<string, unknown>>;
};

export type DiscoveryEvidenceOutcome = {
  key: string;
  source: "datasource" | "runtime_context";
  outcome:
    | "resolved"
    | "unresolved_empty"
    | "unresolved_ambiguous"
    | "blocked_policy"
    | "blocked_runtime_error"
    | "blocked_source_unsupported"
    | "blocked_timeout"
    | "blocked_mutation";
  reasonCode:
    | "ok"
    | "discoverable_prerequisite_policy_disabled"
    | "discovery_empty_result"
    | "discovery_ambiguous_result"
    | "discovery_adapter_failure"
    | "discovery_source_unsupported"
    | "discovery_timeout"
    | "discovery_mutation_blocked";
  candidateCount?: number;
  sourceRef?: string;
};

export type DiscoveryEvidence = {
  attempted: boolean;
  status: "resolved" | "blocked";
  reasonCode:
    | "ok"
    | "discoverable_prerequisite_policy_disabled"
    | "discovery_empty_result"
    | "discovery_ambiguous_result"
    | "discovery_adapter_failure"
    | "discovery_source_unsupported"
    | "discovery_timeout"
    | "discovery_mutation_blocked";
  outcomes: DiscoveryEvidenceOutcome[];
};

export type WriteRegressionRunArtifactsInput = {
  workspaceRootAbs: string;
  runId: string;
  planRef?: RegressionPlanReference;
  resolvedContext: Record<string, unknown>;
  secretContextKeys?: string[];
  executionResult: RegressionRunExecutionResult;
  evidence: {
    targetResolution: Array<Record<string, unknown>>;
    discovery?: DiscoveryEvidence;
    [key: string]: unknown;
  };
  now?: Date;
};

export type RegressionRunArtifactsWriteResult = {
  runDirAbs: string;
  contextResolvedPathAbs: string;
  executionResultPathAbs: string;
  evidencePathAbs: string;
};

