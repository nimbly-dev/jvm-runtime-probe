import { LAST_RESET_EPOCH_BY_KEY } from "@/utils/probe/constants.util";

export type ProbeWaitWindow = {
  waitStartMs: number;
  triggerWindowStartMs: number;
};

export function resolveProbeWaitWindow(resolvedKey: string): ProbeWaitWindow {
  const waitStartMs = Date.now();
  const lastResetEpoch = LAST_RESET_EPOCH_BY_KEY.get(resolvedKey);
  if (typeof lastResetEpoch === "number") {
    // Consume reset epoch once per wait call to avoid stale cross-run windows.
    LAST_RESET_EPOCH_BY_KEY.delete(resolvedKey);
  }
  // Use reset->wait trigger window for hit classification to avoid reset/request/wait races.
  const triggerWindowStartMs =
    typeof lastResetEpoch === "number" ? Math.min(lastResetEpoch, waitStartMs) : waitStartMs;
  return {
    waitStartMs,
    triggerWindowStartMs,
  };
}

export function hasBaselineInlineHit(args: {
  baselineHitCount: number;
  baselineLastHitMs: number;
  triggerWindowStartMs: number;
}): boolean {
  return (
    args.baselineHitCount > 0 &&
    args.baselineLastHitMs > 0 &&
    args.baselineLastHitMs >= args.triggerWindowStartMs
  );
}

export function isInlineByTime(lastHitMs: number | null, triggerWindowStartMs: number): boolean {
  return lastHitMs !== null && lastHitMs >= triggerWindowStartMs;
}
