package com.nimbly.mcpjavadevtools.requestmapping.transport;

import com.nimbly.mcpjavadevtools.requestmapping.ast.MethodContext;
import com.nimbly.mcpjavadevtools.requestmapping.resolution.ResolvedMapping;

public interface TransportMaterializer {
    ResolvedMapping materialize(
            String framework,
            String httpMethod,
            String classPath,
            String methodPath,
            MethodContext context
    );
}


