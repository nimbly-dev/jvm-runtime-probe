import { probeActuate as probeActuateUtil } from "@/utils/probe/probe_actuate.util";
import { probeCaptureGet as probeCaptureGetUtil } from "@/utils/probe/probe_capture_get.util";
import { probeReset as probeResetUtil } from "@/utils/probe/probe_reset.util";
import { probeStatus as probeStatusUtil } from "@/utils/probe/probe_status.util";
import { probeWaitHit as probeWaitHitUtil } from "@/utils/probe/probe_wait_hit.util";

export type ProbeDomainConfig = {
  probeBaseUrl: string;
  probeStatusPath: string;
  probeResetPath: string;
  probeActuatePath: string;
  probeCapturePath: string;
  probeWaitMaxRetries: number;
  probeWaitUnreachableRetryEnabled: boolean;
  probeWaitUnreachableMaxRetries: number;
};

export type ProbeEnableInput = {
  baseUrl?: string | undefined;
  mode?: "observe" | "actuate" | undefined;
  actuatorId?: string | undefined;
  targetKey?: string | undefined;
  returnBoolean?: boolean | undefined;
  timeoutMs?: number | undefined;
};

export type ProbeGetCaptureInput = {
  captureId: string;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
};

export type ProbeGetStatusInput = {
  key?: string | undefined;
  keys?: string[] | undefined;
  lineHint?: number | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
};

export type ProbeResetInput = {
  key?: string | undefined;
  keys?: string[] | undefined;
  className?: string | undefined;
  lineHint?: number | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
};

export type ProbeWaitForHitInput = {
  key: string;
  lineHint?: number | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  pollIntervalMs?: number | undefined;
  maxRetries?: number | undefined;
};

export function createProbeDomain(cfg: ProbeDomainConfig) {
  return {
    enable: async (input: ProbeEnableInput) => {
      const args: Parameters<typeof probeActuateUtil>[0] = {
        baseUrl: input.baseUrl ?? cfg.probeBaseUrl,
        actuatePath: cfg.probeActuatePath,
      };
      if (typeof input.mode === "string") args.mode = input.mode;
      if (typeof input.actuatorId === "string") args.actuatorId = input.actuatorId;
      if (typeof input.targetKey === "string") args.targetKey = input.targetKey;
      if (typeof input.returnBoolean === "boolean") args.returnBoolean = input.returnBoolean;
      if (typeof input.timeoutMs === "number") args.timeoutMs = input.timeoutMs;
      return await probeActuateUtil(args);
    },
    getCapture: async (input: ProbeGetCaptureInput) => {
      const args: Parameters<typeof probeCaptureGetUtil>[0] = {
        captureId: input.captureId,
        baseUrl: input.baseUrl ?? cfg.probeBaseUrl,
        capturePath: cfg.probeCapturePath,
      };
      if (typeof input.timeoutMs === "number") args.timeoutMs = input.timeoutMs;
      return await probeCaptureGetUtil(args);
    },
    getStatus: async (input: ProbeGetStatusInput) => {
      const args: Parameters<typeof probeStatusUtil>[0] = {
        baseUrl: input.baseUrl ?? cfg.probeBaseUrl,
        statusPath: cfg.probeStatusPath,
      };
      if (typeof input.key === "string") args.key = input.key;
      if (Array.isArray(input.keys)) args.keys = input.keys;
      if (typeof input.lineHint === "number") args.lineHint = input.lineHint;
      if (typeof input.timeoutMs === "number") args.timeoutMs = input.timeoutMs;
      return await probeStatusUtil(args);
    },
    reset: async (input: ProbeResetInput) => {
      const args: Parameters<typeof probeResetUtil>[0] = {
        baseUrl: input.baseUrl ?? cfg.probeBaseUrl,
        resetPath: cfg.probeResetPath,
      };
      if (typeof input.key === "string") args.key = input.key;
      if (Array.isArray(input.keys)) args.keys = input.keys;
      if (typeof input.className === "string") args.className = input.className;
      if (typeof input.lineHint === "number") args.lineHint = input.lineHint;
      if (typeof input.timeoutMs === "number") args.timeoutMs = input.timeoutMs;
      return await probeResetUtil(args);
    },
    waitForHit: async (input: ProbeWaitForHitInput) => {
      const args: Parameters<typeof probeWaitHitUtil>[0] = {
        key: input.key,
        baseUrl: input.baseUrl ?? cfg.probeBaseUrl,
        statusPath: cfg.probeStatusPath,
      };
      if (typeof input.lineHint === "number") args.lineHint = input.lineHint;
      if (typeof input.timeoutMs === "number") args.timeoutMs = input.timeoutMs;
      if (typeof input.pollIntervalMs === "number") args.pollIntervalMs = input.pollIntervalMs;
      args.maxRetries = typeof input.maxRetries === "number" ? input.maxRetries : cfg.probeWaitMaxRetries;
      args.unreachableRetryEnabled = cfg.probeWaitUnreachableRetryEnabled;
      args.unreachableMaxRetries = cfg.probeWaitUnreachableMaxRetries;
      return await probeWaitHitUtil(args);
    },
  };
}

// Direct domain exports are kept for unit tests and utility-level callers.
export async function probeStatus(args: Parameters<typeof probeStatusUtil>[0]) {
  return await probeStatusUtil(args);
}

export async function probeCaptureGet(args: Parameters<typeof probeCaptureGetUtil>[0]) {
  return await probeCaptureGetUtil(args);
}

export async function probeReset(args: Parameters<typeof probeResetUtil>[0]) {
  return await probeResetUtil(args);
}

export async function probeWaitHit(args: Parameters<typeof probeWaitHitUtil>[0]) {
  return await probeWaitHitUtil(args);
}

export async function probeActuate(args: Parameters<typeof probeActuateUtil>[0]) {
  return await probeActuateUtil(args);
}
