package com.nimbly.mcpjvmdebugger.requestmapping.extractor;

import com.nimbly.mcpjvmdebugger.requestmapping.extractor.spring.SpringMappingExtractor;

import java.util.List;

public final class ExtractorRegistry {
    private final List<MappingExtractor> extractors;

    public ExtractorRegistry(List<MappingExtractor> extractors) {
        this.extractors = List.copyOf(extractors);
    }

    public List<MappingExtractor> listExtractors() {
        return extractors;
    }

    public static ExtractorRegistry springOnlyDefault() {
        return new ExtractorRegistry(List.of(new SpringMappingExtractor()));
    }
}

