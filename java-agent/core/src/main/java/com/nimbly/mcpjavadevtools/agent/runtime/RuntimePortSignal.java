package com.nimbly.mcpjavadevtools.agent.runtime;

public final class RuntimePortSignal {
  public final Integer value;
  public final String source;
  public final double confidence;

  RuntimePortSignal(Integer value, String source, double confidence) {
    this.value = value;
    this.source = source == null || source.isBlank() ? "runtime_introspection" : source;
    this.confidence = ProbeSignalDetector.clampConfidence(confidence);
  }
}

