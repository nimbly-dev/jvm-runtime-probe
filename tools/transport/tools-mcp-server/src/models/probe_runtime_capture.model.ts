export type ProbeExecutionPaths = string[];

export type ProbeCapturePreviewPayload =
  | {
      available: true;
      captureId?: string;
      capturedAtEpoch?: number;
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
  capturedAtEpoch?: number;
  executionPaths?: ProbeExecutionPaths;
  [key: string]: unknown;
}
