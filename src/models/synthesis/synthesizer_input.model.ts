export type SynthesizerIntentMode =
  | "regression_http_only"
  | "single_line_probe"
  | "regression_plus_line_probe";

export type SynthesizerInput = {
  rootAbs: string;
  workspaceRootAbs: string;
  searchRootsAbs: string[];
  classHint: string;
  methodHint: string;
  intentMode: SynthesizerIntentMode;
  lineHint?: number;
  inferredTargetFileAbs?: string;
};
