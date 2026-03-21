package com.nimbly.mcpjavadevtools.agent.runtime.model;

import com.nimbly.mcpjavadevtools.agent.runtime.RuntimePortSignal;
import com.nimbly.mcpjavadevtools.agent.runtime.RuntimeStringSignal;

public record RuntimeState(
    ActuationState actuation,
    long serverEpoch,
    RuntimeStringSignal applicationType,
    RuntimePortSignal appPort
) {}

