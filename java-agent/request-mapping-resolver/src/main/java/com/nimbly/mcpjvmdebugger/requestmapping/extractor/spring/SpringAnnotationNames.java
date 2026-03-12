package com.nimbly.mcpjvmdebugger.requestmapping.extractor.spring;

import java.util.Map;

public final class SpringAnnotationNames {
    private SpringAnnotationNames() {
    }

    public static final String REQUEST_MAPPING = "RequestMapping";
    public static final Map<String, String> COMPOSED_MAPPINGS = Map.of(
            "GetMapping", "GET",
            "PostMapping", "POST",
            "PutMapping", "PUT",
            "PatchMapping", "PATCH",
            "DeleteMapping", "DELETE"
    );

    public static String simpleName(String rawName) {
        int idx = rawName.lastIndexOf('.');
        return idx >= 0 ? rawName.substring(idx + 1) : rawName;
    }
}

