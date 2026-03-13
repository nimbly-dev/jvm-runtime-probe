export type ProbeExecutionPaths = string[];

export type ProbeCapturePreviewPayload =
  | {
      available: true;
      captureId?: string;
      capturedAtEpochMs?: number;
      executionPaths?: ProbeExecutionPaths;
      [key: string]: unknown;
    }
  | {
      available?: false;
      [key: string]: unknown;
    };

export interface ProbeCaptureRecordPayload {
  captureId?: string;
  methodKey?: string;
  capturedAtEpochMs?: number;
  executionPaths?: ProbeExecutionPaths;
  [key: string]: unknown;
}
