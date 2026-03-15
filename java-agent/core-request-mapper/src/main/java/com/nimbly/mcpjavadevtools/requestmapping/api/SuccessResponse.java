package com.nimbly.mcpjavadevtools.requestmapping.api;

import java.util.List;
import java.util.Map;

public final class SuccessResponse extends ResolverResponse {
    public String framework;
    public String requestSource;
    public RequestCandidate requestCandidate;
    public String matchedTypeFile;
    public String matchedRootAbs;
    public List<String> evidence;
    public List<String> attemptedStrategies;
    public Map<String, Object> extensions;
}


