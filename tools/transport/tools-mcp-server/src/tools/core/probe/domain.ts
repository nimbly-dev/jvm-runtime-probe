import { probeActuate as probeActuateUtil } from "@/utils/probe/probe_actuate.util";
import { probeCaptureGet as probeCaptureGetUtil } from "@/utils/probe/probe_capture_get.util";
import { probeReset as probeResetUtil } from "@/utils/probe/probe_reset.util";
import { resolveProbeBaseUrl } from "@/utils/probe/probe_route_resolver.util";
import { probeStatus as probeStatusUtil } from "@/utils/probe/probe_status.util";
import { probeWaitHit as probeWaitHitUtil } from "@/utils/probe/probe_wait_hit.util";
import type { ProbeRegistry } from "@/config/probe-registry";

export type ProbeDomainConfig = {
  probeBaseUrl: string;
  probeStatusPath: string;
  probeResetPath: string;
  probeActuatePath: string;
  probeCapturePath: string;
  probeWaitMaxRetries: number;
  probeWaitUnreachableRetryEnabled: boolean;
  probeWaitUnreachableMaxRetries: number;
  getProbeRegistry?: () => ProbeRegistry | undefined;
};

export type ProbeEnableInput = {
  baseUrl?: string | undefined;
  probeId?: string | undefined;
  action: "arm" | "disarm";
  sessionId: string;
  actuatorId?: string | undefined;
  targetKey?: string | undefined;
  returnBoolean?: boolean | undefined;
  ttlMs?: number | undefined;
  timeoutMs?: number | undefined;
};

export type ProbeGetCaptureInput = {
  captureId: string;
  baseUrl?: string | undefined;
  probeId?: string | undefined;
  timeoutMs?: number | undefined;
};

export type ProbeGetStatusInput = {
  key?: string | undefined;
  keys?: string[] | undefined;
  lineHint?: number | undefined;
  baseUrl?: string | undefined;
  probeId?: string | undefined;
  timeoutMs?: number | undefined;
};

export type ProbeResetInput = {
  key?: string | undefined;
  keys?: string[] | undefined;
  className?: string | undefined;
  lineHint?: number | undefined;
  baseUrl?: string | undefined;
  probeId?: string | undefined;
  timeoutMs?: number | undefined;
};

export type ProbeWaitForHitInput = {
  key: string;
  lineHint?: number | undefined;
  baseUrl?: string | undefined;
  probeId?: string | undefined;
  timeoutMs?: number | undefined;
  pollIntervalMs?: number | undefined;
  maxRetries?: number | undefined;
};

export function createProbeDomain(cfg: ProbeDomainConfig) {
  return {
    enable: async (input: ProbeEnableInput) => {
      const base = resolveProbeBaseUrl({
        toolName: "probe_enable",
        defaultBaseUrl: cfg.probeBaseUrl,
        ...(typeof input.probeId === "string" ? { probeId: input.probeId } : {}),
        ...(typeof input.baseUrl === "string" ? { baseUrl: input.baseUrl } : {}),
        ...(cfg.getProbeRegistry?.() ? { probeRegistry: cfg.getProbeRegistry?.() } : {}),
      });
      if (!base.ok) return base.response;
      const args: Parameters<typeof probeActuateUtil>[0] = {
        baseUrl: base.baseUrl,
        actuatePath: cfg.probeActuatePath,
        action: input.action,
        sessionId: input.sessionId,
      };
      if (typeof input.actuatorId === "string") args.actuatorId = input.actuatorId;
      if (typeof input.targetKey === "string") args.targetKey = input.targetKey;
      if (typeof input.returnBoolean === "boolean") args.returnBoolean = input.returnBoolean;
      if (typeof input.ttlMs === "number") args.ttlMs = input.ttlMs;
      if (typeof input.timeoutMs === "number") args.timeoutMs = input.timeoutMs;
      return await probeActuateUtil(args);
    },
    getCapture: async (input: ProbeGetCaptureInput) => {
      const base = resolveProbeBaseUrl({
        toolName: "probe_get_capture",
        defaultBaseUrl: cfg.probeBaseUrl,
        ...(typeof input.probeId === "string" ? { probeId: input.probeId } : {}),
        ...(typeof input.baseUrl === "string" ? { baseUrl: input.baseUrl } : {}),
        ...(cfg.getProbeRegistry?.() ? { probeRegistry: cfg.getProbeRegistry?.() } : {}),
      });
      if (!base.ok) return base.response;
      const args: Parameters<typeof probeCaptureGetUtil>[0] = {
        captureId: input.captureId,
        baseUrl: base.baseUrl,
        capturePath: cfg.probeCapturePath,
      };
      if (typeof input.timeoutMs === "number") args.timeoutMs = input.timeoutMs;
      return await probeCaptureGetUtil(args);
    },
    getStatus: async (input: ProbeGetStatusInput) => {
      const base = resolveProbeBaseUrl({
        toolName: "probe_get_status",
        defaultBaseUrl: cfg.probeBaseUrl,
        ...(typeof input.probeId === "string" ? { probeId: input.probeId } : {}),
        ...(typeof input.baseUrl === "string" ? { baseUrl: input.baseUrl } : {}),
        ...(cfg.getProbeRegistry?.() ? { probeRegistry: cfg.getProbeRegistry?.() } : {}),
      });
      if (!base.ok) return base.response;
      const args: Parameters<typeof probeStatusUtil>[0] = {
        baseUrl: base.baseUrl,
        statusPath: cfg.probeStatusPath,
      };
      if (typeof input.key === "string") args.key = input.key;
      if (Array.isArray(input.keys)) args.keys = input.keys;
      if (typeof input.lineHint === "number") args.lineHint = input.lineHint;
      if (typeof input.timeoutMs === "number") args.timeoutMs = input.timeoutMs;
      return await probeStatusUtil(args);
    },
    reset: async (input: ProbeResetInput) => {
      const base = resolveProbeBaseUrl({
        toolName: "probe_reset",
        defaultBaseUrl: cfg.probeBaseUrl,
        ...(typeof input.probeId === "string" ? { probeId: input.probeId } : {}),
        ...(typeof input.baseUrl === "string" ? { baseUrl: input.baseUrl } : {}),
        ...(cfg.getProbeRegistry?.() ? { probeRegistry: cfg.getProbeRegistry?.() } : {}),
      });
      if (!base.ok) return base.response;
      const args: Parameters<typeof probeResetUtil>[0] = {
        baseUrl: base.baseUrl,
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
      const base = resolveProbeBaseUrl({
        toolName: "probe_wait_for_hit",
        defaultBaseUrl: cfg.probeBaseUrl,
        ...(typeof input.probeId === "string" ? { probeId: input.probeId } : {}),
        ...(typeof input.baseUrl === "string" ? { baseUrl: input.baseUrl } : {}),
        ...(cfg.getProbeRegistry?.() ? { probeRegistry: cfg.getProbeRegistry?.() } : {}),
      });
      if (!base.ok) return base.response;
      const args: Parameters<typeof probeWaitHitUtil>[0] = {
        key: input.key,
        baseUrl: base.baseUrl,
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
