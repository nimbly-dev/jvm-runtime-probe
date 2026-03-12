package com.nimbly.mcpjvmdebugger.requestmapping.transport.http;

import com.github.javaparser.ast.body.Parameter;
import com.nimbly.mcpjvmdebugger.requestmapping.ast.MethodContext;
import com.nimbly.mcpjvmdebugger.requestmapping.ast.ResolvedParameter;
import com.nimbly.mcpjvmdebugger.requestmapping.resolution.ResolvedMapping;
import com.nimbly.mcpjvmdebugger.requestmapping.transport.TransportMaterializer;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

public final class PathMaterializer implements TransportMaterializer {
    @Override
    public ResolvedMapping materialize(
            String framework,
            String httpMethod,
            String classPath,
            String methodPath,
            MethodContext context
    ) {
        String resolvedPath = joinPaths(classPath, methodPath);
        List<String> queryParts = new ArrayList<>();
        List<String> pathParameters = new ArrayList<>();
        String bodyTemplate = null;

        for (Parameter parameter : context.method().getParameters()) {
            Optional<ResolvedParameter> resolvedParameter = ParameterTemplateBuilder.resolveParameter(parameter);
            if (resolvedParameter.isEmpty()) {
                continue;
            }
            ResolvedParameter param = resolvedParameter.get();
            if (param.getKind().equals("query")) {
                queryParts.add(param.getName() + "=" + ParameterTemplateBuilder.sampleValueForType(param.getType()));
            } else if (param.getKind().equals("path")) {
                String value = ParameterTemplateBuilder.sampleValueForType(param.getType());
                resolvedPath = resolvedPath
                        .replace("{" + param.getName() + "}", value)
                        .replace(":" + param.getName(), value);
                pathParameters.add(param.getName() + "=" + value);
            } else if (param.getKind().equals("body")) {
                bodyTemplate = ParameterTemplateBuilder.sampleBodyForType(param.getType());
            }
        }

        ResolvedMapping mapping = new ResolvedMapping();
        mapping.setFramework(framework);
        mapping.setRequestSource(framework);
        mapping.setHttpMethod(httpMethod);
        mapping.setMaterializedPath(resolvedPath);
        mapping.setQueryTemplate(String.join("&", queryParts));
        mapping.setBodyTemplate(bodyTemplate);
        mapping.setMappingOwnerFile(context.owner().getFileAbs());
        mapping.setPathParameters(pathParameters);
        return mapping;
    }

    public static String joinPaths(String classPath, String methodPath) {
        String base = normalizePath(classPath);
        String sub = methodPath == null ? "" : methodPath.trim();
        if (sub.isBlank()) {
            return base;
        }
        String normalizedSub = sub.startsWith("/") ? sub : "/" + sub;
        String joined = (base.equals("/") ? "" : base) + normalizedSub;
        return joined.isBlank() ? "/" : joined;
    }

    public static String normalizePath(String raw) {
        if (raw == null || raw.isBlank()) {
            return "/";
        }
        String trimmed = raw.trim();
        return trimmed.startsWith("/") ? trimmed : "/" + trimmed;
    }
}

