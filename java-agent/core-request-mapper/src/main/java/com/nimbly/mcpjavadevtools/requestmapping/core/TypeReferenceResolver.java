package com.nimbly.mcpjavadevtools.requestmapping.core;

import com.nimbly.mcpjavadevtools.requestmapping.ast.TypeDescriptor;

import java.util.List;
import java.util.Map;

public final class TypeReferenceResolver {
    private TypeReferenceResolver() {
    }

    public static TypeDescriptor resolve(
            TypeDescriptor owner,
            String reference,
            Map<String, List<TypeDescriptor>> bySimpleName,
            Map<String, List<TypeDescriptor>> byFqcn
    ) {
        if (reference == null || reference.isBlank()) {
            return null;
        }
        if (reference.contains(".")) {
            List<TypeDescriptor> matches = byFqcn.get(reference);
            if (matches == null || matches.size() != 1) {
                return null;
            }
            return matches.get(0);
        }
        for (String imported : owner.getImports()) {
            if (imported.endsWith("." + reference)) {
                List<TypeDescriptor> importedMatches = byFqcn.get(imported);
                if (importedMatches != null && importedMatches.size() == 1) {
                    return importedMatches.get(0);
                }
            }
        }
        if (!owner.getPackageName().isBlank()) {
            List<TypeDescriptor> samePackageMatches = byFqcn.get(owner.getPackageName() + "." + reference);
            if (samePackageMatches != null && samePackageMatches.size() == 1) {
                return samePackageMatches.get(0);
            }
        }
        List<TypeDescriptor> simpleMatches = bySimpleName.get(reference);
        if (simpleMatches == null || simpleMatches.isEmpty()) {
            return null;
        }
        return simpleMatches.size() == 1 ? simpleMatches.get(0) : null;
    }
}


