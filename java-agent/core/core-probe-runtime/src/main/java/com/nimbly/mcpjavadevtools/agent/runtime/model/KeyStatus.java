package com.nimbly.mcpjavadevtools.agent.runtime.model;

public record KeyStatus(
    String key,
    long hitCount,
    long lastHitEpoch,
    Boolean lineResolvable,
    String lineValidation
) {}

