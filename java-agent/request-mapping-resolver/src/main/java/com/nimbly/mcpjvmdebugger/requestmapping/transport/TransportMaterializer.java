package com.nimbly.mcpjvmdebugger.requestmapping.transport;

import com.nimbly.mcpjvmdebugger.requestmapping.ast.MethodContext;
import com.nimbly.mcpjvmdebugger.requestmapping.resolution.ResolvedMapping;

public interface TransportMaterializer {
    ResolvedMapping materialize(
            String framework,
            String httpMethod,
            String classPath,
            String methodPath,
            MethodContext context
    );
}

