package com.nimbly.mcpjvmdebugger.requestmapping.extractor.spring;

import com.nimbly.mcpjvmdebugger.requestmapping.ast.MethodContext;
import com.nimbly.mcpjvmdebugger.requestmapping.core.TypeIndex;
import com.nimbly.mcpjvmdebugger.requestmapping.extractor.MappingExtractor;
import com.nimbly.mcpjvmdebugger.requestmapping.resolution.ResolvedMapping;
import com.nimbly.mcpjvmdebugger.requestmapping.transport.http.PathMaterializer;

import java.util.Optional;

public final class SpringMappingExtractor implements MappingExtractor {
    private final PathMaterializer materializer = new PathMaterializer();

    @Override
    public String strategyId() {
        return "java_ast_spring_mvc_resolver";
    }

    @Override
    public Optional<ResolvedMapping> resolve(MethodContext context, TypeIndex index) {
        Optional<SpringMappingMerger.SpringMethodMapping> methodMapping =
                SpringMappingMerger.resolveMethodMapping(context, index);
        if (methodMapping.isEmpty()) {
            return Optional.empty();
        }

        String classPath = SpringMappingMerger.resolveClassPath(context, index);
        SpringMappingMerger.SpringMethodMapping mapping = methodMapping.get();
        return Optional.of(materializer.materialize(
                "spring_mvc",
                mapping.httpMethod(),
                classPath,
                mapping.methodPath(),
                context
        ));
    }
}

