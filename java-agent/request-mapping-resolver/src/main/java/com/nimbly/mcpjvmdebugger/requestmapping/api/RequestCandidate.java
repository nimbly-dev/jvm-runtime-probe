package com.nimbly.mcpjvmdebugger.requestmapping.api;

import java.util.List;

public final class RequestCandidate {
    public String method;
    public String path;
    public String queryTemplate;
    public String fullUrlHint;
    public String bodyTemplate;
    public List<String> rationale;
}

