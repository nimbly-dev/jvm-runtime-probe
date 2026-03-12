package com.nimbly.mcpjvmdebugger.requestmapping.api;

import java.util.List;
import java.util.Map;

public final class FailureResponse extends ResolverResponse {
    public String reasonCode;
    public String failedStep;
    public String nextAction;
    public List<String> evidence;
    public List<String> attemptedStrategies;
    public String framework;
    public Map<String, Object> extensions;
}

