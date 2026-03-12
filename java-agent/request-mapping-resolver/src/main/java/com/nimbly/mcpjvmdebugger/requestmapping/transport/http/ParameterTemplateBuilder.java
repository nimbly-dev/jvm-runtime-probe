package com.nimbly.mcpjvmdebugger.requestmapping.transport.http;

import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.NormalAnnotationExpr;
import com.github.javaparser.ast.expr.SingleMemberAnnotationExpr;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.type.Type;
import com.nimbly.mcpjvmdebugger.requestmapping.ast.ResolvedParameter;

import java.util.Locale;
import java.util.Optional;

public final class ParameterTemplateBuilder {
    private ParameterTemplateBuilder() {
    }

    public static String sampleValueForType(Type type) {
        String raw = type.asString().toLowerCase(Locale.ROOT);
        if (raw.contains("double") || raw.contains("float") || raw.contains("decimal")) {
            return "1000";
        }
        if (raw.contains("int") || raw.contains("long") || raw.contains("short")) {
            return "1";
        }
        if (raw.contains("bool")) {
            return "true";
        }
        return "value";
    }

    public static String sampleBodyForType(Type type) {
        String raw = type.asString().toLowerCase(Locale.ROOT);
        if (raw.contains("string")) {
            return "\"value\"";
        }
        if (raw.contains("int") || raw.contains("long") || raw.contains("double") || raw.contains("float")) {
            return "1";
        }
        if (raw.contains("bool")) {
            return "true";
        }
        return "{\"example\":\"value\"}";
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
}

