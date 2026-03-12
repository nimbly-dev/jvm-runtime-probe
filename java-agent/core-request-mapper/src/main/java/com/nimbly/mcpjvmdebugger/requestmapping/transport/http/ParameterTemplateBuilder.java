package com.nimbly.mcpjvmdebugger.requestmapping.transport.http;

import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.NormalAnnotationExpr;
import com.github.javaparser.ast.expr.SingleMemberAnnotationExpr;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.type.Type;
import com.nimbly.mcpjvmdebugger.requestmapping.ast.ResolvedParameter;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.function.Predicate;

public final class ParameterTemplateBuilder {
    private static final String DEFAULT_QUERY_SAMPLE = "value";
    private static final String DEFAULT_BODY_SAMPLE = "{\"example\":\"value\"}";

    private static final List<NameRule> QUERY_NAME_RULES = List.of(
            new NameRule(ParameterTemplateBuilder::isSortParameter, "priceSale,asc")
    );

    private static final List<TypeRule> QUERY_TYPE_RULES = List.of(
            new TypeRule(type -> containsAny(type, "localdatetime", "offsetdatetime"), "2026-01-01T00:00:00"),
            new TypeRule(type -> containsAny(type, "localdate"), "2026-01-01"),
            new TypeRule(type -> containsAny(type, "instant"), "2026-01-01T00:00:00Z"),
            new TypeRule(type -> containsAny(type, "uuid"), "00000000-0000-0000-0000-000000000001"),
            new TypeRule(type -> containsAny(type, "double", "float", "decimal"), "1000"),
            new TypeRule(type -> containsAny(type, "int", "long", "short"), "1"),
            new TypeRule(type -> containsAny(type, "bool"), "true")
    );

    private static final List<TypeRule> BODY_TYPE_RULES = List.of(
            new TypeRule(type -> containsAny(type, "string"), "\"value\""),
            new TypeRule(type -> containsAny(type, "int", "long", "double", "float"), "1"),
            new TypeRule(type -> containsAny(type, "bool"), "true")
    );

    private ParameterTemplateBuilder() {
    }

    public static String sampleValueForType(Type type) {
        String normalizedType = normalizeType(type);
        for (TypeRule rule : QUERY_TYPE_RULES) {
            if (rule.matches(normalizedType)) {
                return rule.sampleValue();
            }
        }
        return DEFAULT_QUERY_SAMPLE;
    }

    public static String sampleValueForParameter(String parameterName, Type type) {
        String normalizedName = normalizeName(parameterName);
        for (NameRule rule : QUERY_NAME_RULES) {
            if (rule.matches(normalizedName)) {
                return rule.sampleValue();
            }
        }
        return sampleValueForType(type);
    }

    public static String sampleBodyForType(Type type) {
        String normalizedType = normalizeType(type);
        for (TypeRule rule : BODY_TYPE_RULES) {
            if (rule.matches(normalizedType)) {
                return rule.sampleValue();
            }
        }
        return DEFAULT_BODY_SAMPLE;
    }

    public static Optional<ResolvedParameter> resolveParameter(Parameter parameter) {
        for (AnnotationExpr annotation : parameter.getAnnotations()) {
            String name = annotationSimpleName(annotation);
            if (name.equals("RequestParam") || name.equals("QueryParam")) {
                String requestName = resolveNamedParameter(annotation, parameter.getNameAsString());
                return Optional.of(new ResolvedParameter("query", requestName, parameter.getType()));
            }
            if (name.equals("PathVariable") || name.equals("PathParam")) {
                String requestName = resolveNamedParameter(annotation, parameter.getNameAsString());
                return Optional.of(new ResolvedParameter("path", requestName, parameter.getType()));
            }
            if (name.equals("RequestBody")) {
                return Optional.of(new ResolvedParameter("body", parameter.getNameAsString(), parameter.getType()));
            }
            if (name.equals("RequestHeader") || name.equals("HeaderParam")) {
                String requestName = resolveNamedParameter(annotation, parameter.getNameAsString());
                return Optional.of(new ResolvedParameter("header", requestName, parameter.getType()));
            }
        }
        return Optional.empty();
    }

    private static String resolveNamedParameter(AnnotationExpr annotation, String fallback) {
        if (annotation instanceof SingleMemberAnnotationExpr singleMember
                && singleMember.getMemberValue() instanceof StringLiteralExpr stringLiteral) {
            return stringLiteral.getValue();
        }
        if (annotation instanceof NormalAnnotationExpr normalAnnotation) {
            for (String candidate : java.util.List.of("name", "value")) {
                Optional<com.github.javaparser.ast.expr.Expression> value = normalAnnotation.getPairs().stream()
                        .filter(pair -> pair.getNameAsString().equals(candidate))
                        .map(pair -> pair.getValue())
                        .findFirst();
                if (value.isPresent() && value.get() instanceof StringLiteralExpr stringLiteral) {
                    return stringLiteral.getValue();
                }
            }
        }
        return fallback;
    }

    private static String annotationSimpleName(AnnotationExpr annotation) {
        String raw = annotation.getNameAsString();
        int idx = raw.lastIndexOf('.');
        return idx >= 0 ? raw.substring(idx + 1) : raw;
    }

    private static String normalizeType(Type type) {
        return type.asString().toLowerCase(Locale.ROOT);
    }

    private static String normalizeName(String parameterName) {
        return parameterName == null ? "" : parameterName.toLowerCase(Locale.ROOT);
    }

    private static boolean isSortParameter(String normalizedName) {
        return normalizedName.equals("sort")
                || normalizedName.endsWith("sort")
                || normalizedName.contains("orderby")
                || normalizedName.contains("sortby");
    }

    private static boolean containsAny(String raw, String... candidates) {
        for (String candidate : candidates) {
            if (raw.contains(candidate)) {
                return true;
            }
        }
        return false;
    }

    private record TypeRule(Predicate<String> matcher, String sampleValue) {
        private boolean matches(String normalizedType) {
            return matcher.test(normalizedType);
        }
    }

    private record NameRule(Predicate<String> matcher, String sampleValue) {
        private boolean matches(String normalizedName) {
            return matcher.test(normalizedName);
        }
    }
}

