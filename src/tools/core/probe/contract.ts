import {
  ProbeActuateInputSchema,
  ProbeCaptureGetInputSchema,
  ProbeResetInputSchema,
  ProbeStatusInputSchema,
  ProbeWaitHitInputSchema,
} from "@/models/inputs";

export const PROBE_TOOLS = {
  enable: {
    name: "probe_enable",
    description:
      "Dynamically arm/disarm line-branch actuation without JVM restart. In actuate mode, targetKey must be fully.qualified.Class#method:line and returnBoolean controls branch decision (true=taken, false=fallthrough). Use mode=observe to disarm.",
    inputSchema: ProbeActuateInputSchema,
  },
  getCapture: {
    name: "probe_get_capture",
    description:
      "Fetch full runtime capture payload by captureId emitted by probe_get_status capturePreview.",
    inputSchema: ProbeCaptureGetInputSchema,
  },
  getStatus: {
    name: "probe_get_status",
    description:
      "Query line-level probe status for one key (`key`) or many keys (`keys`). Keys must be fully.qualified.Class#method:line in strict line mode.",
    inputSchema: ProbeStatusInputSchema,
  },
  reset: {
    name: "probe_reset",
    description:
      "Reset probe counter/state for one key (`key`), many keys (`keys`), or all known line keys for a class (`className`).",
    inputSchema: ProbeResetInputSchema,
  },
  waitForHit: {
    name: "probe_wait_for_hit",
    description:
      "Poll probe_get_status until an inline line hit is observed for key fully.qualified.Class#method:line. Method-only keys are rejected in strict line mode.",
    inputSchema: ProbeWaitHitInputSchema,
  },
} as const;
