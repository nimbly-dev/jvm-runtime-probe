package com.nimbly.mcpjavadevtools.agent.runtime;

public final class RuntimeStringSignal {
  public final String value;
  public final String source;
  public final double confidence;

  RuntimeStringSignal(String value, String source, double confidence) {
    this.value = value == null || value.isBlank() ? "unknown" : value;
    this.source = source == null || source.isBlank() ? "runtime_introspection" : source;
    this.confidence = ProbeSignalDetector.clampConfidence(confidence);
  }
}

