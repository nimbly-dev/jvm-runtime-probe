import { TargetInferInputSchema } from "../../../models/inputs";

export const TARGET_INFER_TOOL = {
  name: "probe_target_infer",
  description:
    "Infer runtime probe keys (ranked_candidates mode) or return deterministic class method inventory with line spans (class_methods mode).",
  inputSchema: TargetInferInputSchema,
} as const;
