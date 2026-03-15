package com.nimbly.mcpjavadevtools.requestmapping.extractor;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.ServiceLoader;

public final class ExtractorRegistry {
    private final List<MappingExtractor> extractors;

    public ExtractorRegistry(List<MappingExtractor> extractors) {
        this.extractors = List.copyOf(extractors);
    }

    public List<MappingExtractor> listExtractors() {
        return extractors;
    }

    public static ExtractorRegistry serviceLoaderDefault() {
        ServiceLoader<MappingExtractor> loader = ServiceLoader.load(MappingExtractor.class);
        List<MappingExtractor> discovered = new ArrayList<>();
        for (MappingExtractor extractor : loader) {
            discovered.add(extractor);
        }
        discovered.sort(Comparator.comparing(MappingExtractor::strategyId));
        return new ExtractorRegistry(discovered);
    }
}


