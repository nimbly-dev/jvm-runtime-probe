package com.nimbly.mcpjavadevtools.agent.capture;

import java.util.List;

public final class CaptureRecordView {
  public final String captureId;
  public final String methodKey;
  public final long capturedAtEpochMs;
  public final String redactionMode;
  public final List<CaptureValueView> args;
  public final CaptureValueView returnValue;
  public final CaptureValueView thrownValue;
  public final boolean truncatedAny;
  public final List<String> executionPaths;

  CaptureRecordView(
      String captureId,
      String methodKey,
      long capturedAtEpochMs,
      String redactionMode,
      List<CaptureValueView> args,
      CaptureValueView returnValue,
      CaptureValueView thrownValue,
      boolean truncatedAny,
      List<String> executionPaths
  ) {
    this.captureId = captureId;
    this.methodKey = methodKey;
    this.capturedAtEpochMs = capturedAtEpochMs;
    this.redactionMode = redactionMode;
    this.args = args;
    this.returnValue = returnValue;
    this.thrownValue = thrownValue;
    this.truncatedAny = truncatedAny;
    this.executionPaths = executionPaths;
  }
}

