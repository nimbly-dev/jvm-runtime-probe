export type SynthesizerFailureReasonCode =
  | "synthesizer_not_installed"
  | "framework_not_supported"
  | "spring_entrypoint_not_proven"
  | "spring_mapping_not_proven"
  | "request_candidate_missing";

export type SynthesizerFailure = {
  status: "report";
  reasonCode: SynthesizerFailureReasonCode;
  failedStep: string;
  nextAction: string;
  evidence: string[];
  attemptedStrategies: string[];
  synthesizerUsed?: string;
};
