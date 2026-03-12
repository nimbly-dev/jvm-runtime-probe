package com.nimbly.mcpjvmdebugger.requestmapping.extractor;

import com.nimbly.mcpjvmdebugger.requestmapping.ast.MethodContext;
import com.nimbly.mcpjvmdebugger.requestmapping.core.TypeIndex;
import com.nimbly.mcpjvmdebugger.requestmapping.resolution.ResolvedMapping;

import java.util.Optional;

public interface MappingExtractor {
    String strategyId();

    Optional<ResolvedMapping> resolve(MethodContext context, TypeIndex index);
}

