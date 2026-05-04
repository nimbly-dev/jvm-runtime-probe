import type { PreflightResult, PreflightStatus } from "@tools-regression-execution-plan-spec/models/regression_execution_plan_spec.model";

export type ReplayReferenceKind = "run_id" | "plan_path" | "plan_name" | "latest";

export type ReplayInvocationInput = {
  runId?: string;
  planPath?: string;
  planName?: string;
  latest?: boolean;
};

export type ReplayReference = {
  kind: ReplayReferenceKind;
  value?: string;
};

export type ReplayInvocationResolution =
  | {
      status: "resolved";
      reasonCode: "ok";
      selected: ReplayReference;
      ignored: ReplayReferenceKind[];
      requiredUserAction: [];
    }
  | {
      status: "blocked_invalid";
      reasonCode: "replay_reference_missing" | "invalid_run_id" | "invalid_plan_name" | "invalid_plan_path";
      selected: null;
      ignored: ReplayReferenceKind[];
      requiredUserAction: string[];
    };

export type ReplayUserFacingStatus = "ready_to_execute" | "blocked";

export type ReplayUserMessage = {
  status: ReplayUserFacingStatus;
  reasonCode: PreflightResult["reasonCode"];
  preflightStatus: PreflightStatus;
  summary: string;
  missing: string[];
  checks: string[];
  nextAction?: string;
  nextActions: string[];
};
