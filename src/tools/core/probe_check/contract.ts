import { ProbeDiagnoseInputSchema } from "@/models/inputs";

export const PROBE_CHECK_TOOL = {
  name: "probe_check",
  description:
    "Diagnose probe wiring quickly: reset/status reachability, key decoding health, and actionable next steps.",
  inputSchema: ProbeDiagnoseInputSchema,
} as const;
