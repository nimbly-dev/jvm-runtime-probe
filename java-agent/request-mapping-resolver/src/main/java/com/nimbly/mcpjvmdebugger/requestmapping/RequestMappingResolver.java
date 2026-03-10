package com.nimbly.mcpjvmdebugger.requestmapping;

import com.github.javaparser.ParseProblemException;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.NodeList;
import com.github.javaparser.ast.body.BodyDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.FieldDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.ArrayInitializerExpr;
import com.github.javaparser.ast.expr.BinaryExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.FieldAccessExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.NormalAnnotationExpr;
import com.github.javaparser.ast.expr.SingleMemberAnnotationExpr;
import com.github.javaparser.ast.expr.StringLiteralExpr;
import com.github.javaparser.ast.expr.TextBlockLiteralExpr;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.ast.type.Type;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Stream;

public final class RequestMappingResolver {
    private static final String CONTRACT_VERSION = "0.1.0v";
    private static final Set<String> EXCLUDED_SCAN_DIRS = Set.of(
            ".git",
            "node_modules",
            "out",
            ".idea",
            ".vscode"
    );
    private static final List<FrameworkResolver> FRAMEWORK_RESOLVERS = List.of(
            new SpringMvcResolver(),
            new JaxrsResolver()
    );

    public ResolverResponse resolve(ResolverRequest request) {
        List<String> bootstrapStrategies = List.of(
                "java_ast_index_lookup",
                "java_ast_framework_resolution"
        );
        if (request == null || request.projectRootAbs == null || request.projectRootAbs.isBlank()) {
            return failure(
                    "project_root_invalid",
                    "project_root_validation",
                    "Provide projectRootAbs as an absolute existing project directory path.",
                    List.of("projectRootAbs missing or blank"),
                    bootstrapStrategies
            );
        }

        Path projectRoot = Paths.get(request.projectRootAbs).toAbsolutePath().normalize();
        if (!projectRoot.isAbsolute() || !Files.isDirectory(projectRoot)) {
            return failure(
                    "project_root_invalid",
                    "project_root_validation",
                    "Provide projectRootAbs as an absolute existing project directory path.",
                    List.of("projectRootAbs is not an existing directory", "projectRootAbs=" + projectRoot),
                    bootstrapStrategies
            );
        }

        TypeIndex index = buildTypeIndex(projectRoot);
        if (index.typeCount == 0) {
            return failure(
                    "target_type_not_found",
                    "target_type_resolution",
                    "No Java source types were indexed under the provided project root.",
                    List.of("indexedJavaFiles=0", "projectRootAbs=" + projectRoot),
                    bootstrapStrategies
            );
        }

        TypeDescriptor primaryType = selectPrimaryType(index, request);
        if (primaryType == null) {
            int candidateCount = index.lookupTypes(request.classHint).size();
            String reason = candidateCount > 1 ? "target_type_ambiguous" : "target_type_not_found";
            String nextAction = candidateCount > 1
                    ? "Refine classHint to an exact FQCN and rerun request mapping resolution."
                    : "Refine classHint or provide inferredTargetFileAbs and rerun request mapping resolution.";
            return failure(
                    reason,
                    "target_type_resolution",
                    nextAction,
                    List.of(
                            "classHint=" + safe(request.classHint),
                            "typeCandidates=" + candidateCount,
                            "indexedJavaFiles=" + index.typeCount
                    ),
                    bootstrapStrategies
            );
        }

        MethodDeclaration primaryMethod = findMethod(primaryType, request.methodHint, request.lineHint, -1);
        if (primaryMethod == null) {
            return failure(
                    "target_method_not_found",
                    "target_method_resolution",
                    "Refine methodHint or lineHint and rerun request mapping resolution.",
                    List.of(
                            "classHint=" + safe(request.classHint),
                            "resolvedType=" + primaryType.fqcn,
                            "methodHint=" + safe(request.methodHint)
                    ),
                    bootstrapStrategies
            );
        }

        List<MethodContext> methodContexts = collectMethodContexts(primaryType, primaryMethod, index);
        for (MethodContext context : methodContexts) {
            for (FrameworkResolver resolver : FRAMEWORK_RESOLVERS) {
                Optional<ResolvedMapping> resolved = resolver.resolve(context, index);
                if (resolved.isEmpty()) {
                    continue;
                }
                RequestCandidate requestCandidate = buildRequestCandidate(
                        resolved.get(),
                        context,
                        primaryType.fileAbs
                );
                SuccessResponse response = new SuccessResponse();
                response.status = "ok";
                response.contractVersion = CONTRACT_VERSION;
                response.framework = resolved.get().framework;
                response.requestSource = resolved.get().requestSource;
                response.requestCandidate = requestCandidate;
                response.matchedTypeFile = primaryType.fileAbs.toString();
                response.matchedRootAbs = projectRoot.toString();
                response.evidence = List.of(
                        "resolvedType=" + primaryType.fqcn,
                        "mappingOwner=" + context.owner.fqcn,
                        "methodHint=" + request.methodHint,
                        "framework=" + resolved.get().framework
                );
                response.attemptedStrategies = List.of(
                        "java_ast_index_lookup",
                        resolver.strategyId()
                );
                return response;
            }
        }

        return failure(
                "request_mapping_not_proven",
                "request_mapping_resolution",
                "AST resolver could not prove an HTTP entrypoint for the requested method. Refine classHint/methodHint/lineHint and rerun.",
                List.of(
                        "classHint=" + safe(request.classHint),
                        "resolvedType=" + primaryType.fqcn,
                        "methodHint=" + safe(request.methodHint),
                        "methodContextCount=" + methodContexts.size()
                ),
                bootstrapStrategies
        );
    }

    private static FailureResponse failure(
            String reasonCode,
            String failedStep,
            String nextAction,
            List<String> evidence,
            List<String> attemptedStrategies
    ) {
        FailureResponse response = new FailureResponse();
        response.status = "report";
        response.contractVersion = CONTRACT_VERSION;
        response.reasonCode = reasonCode;
        response.failedStep = failedStep;
        response.nextAction = nextAction;
        response.evidence = evidence;
        response.attemptedStrategies = attemptedStrategies;
        return response;
    }

    private static String safe(String value) {
        return value == null || value.isBlank() ? "(none)" : value;
    }

    private static TypeIndex buildTypeIndex(Path projectRoot) {
        Map<String, List<TypeDescriptor>> bySimpleName = new HashMap<>();
        Map<String, TypeDescriptor> byFqcn = new HashMap<>();
        int typeCount = 0;

        for (Path moduleRoot : discoverModuleRoots(projectRoot)) {
            for (Path sourceRoot : sourceRootsForModule(moduleRoot)) {
                if (!Files.isDirectory(sourceRoot)) {
                    continue;
                }
                try (Stream<Path> stream = Files.walk(sourceRoot)) {
                    List<Path> javaFiles = stream
                            .filter(Files::isRegularFile)
                            .filter(path -> path.getFileName().toString().endsWith(".java"))
                            .toList();
                    for (Path javaFile : javaFiles) {
                        List<TypeDescriptor> types = parseTypeDescriptors(javaFile);
                        for (TypeDescriptor descriptor : types) {
                            bySimpleName.computeIfAbsent(descriptor.simpleName, ignored -> new ArrayList<>())
                                    .add(descriptor);
                            byFqcn.put(descriptor.fqcn, descriptor);
                            typeCount += 1;
                        }
                    }
                } catch (IOException ignored) {
                    // Skip unreadable source roots; fail closed later if resolution cannot prove a mapping.
                }
            }
        }

        return new TypeIndex(bySimpleName, byFqcn, typeCount);
    }

    private static List<Path> discoverModuleRoots(Path projectRoot) {
        Set<Path> found = new LinkedHashSet<>();
        Deque<Path> queue = new ArrayDeque<>();
        queue.add(projectRoot);
        found.add(projectRoot);

        while (!queue.isEmpty()) {
            Path current = queue.removeFirst();
            try (Stream<Path> stream = Files.list(current)) {
                List<Path> children = stream.toList();
                boolean hasBuildMarker = children.stream()
                        .filter(Files::isRegularFile)
                        .map(path -> path.getFileName().toString())
                        .anyMatch(name ->
                                name.equals("pom.xml") || name.equals("build.gradle") || name.equals("build.gradle.kts"));
                if (hasBuildMarker) {
                    found.add(current);
                }
                for (Path child : children) {
                    if (!Files.isDirectory(child)) {
                        continue;
                    }
                    String name = child.getFileName().toString();
                    if (EXCLUDED_SCAN_DIRS.contains(name) || name.equals("target") || name.equals("build")) {
                        continue;
                    }
                    queue.addLast(child);
                }
            } catch (IOException ignored) {
                // ignore unreadable directories
            }
        }

        return new ArrayList<>(found);
    }

    private static List<Path> sourceRootsForModule(Path moduleRoot) {
        return List.of(
                moduleRoot.resolve("src/main/java"),
                moduleRoot.resolve("src/test/java"),
                moduleRoot.resolve("target/generated-sources/openapi/src/main/java"),
                moduleRoot.resolve("target/generated-sources/src/main/java"),
                moduleRoot.resolve("build/generated/sources/annotationProcessor/java/main")
        );
    }

    private static List<TypeDescriptor> parseTypeDescriptors(Path javaFile) {
        try {
            CompilationUnit compilationUnit = StaticJavaParser.parse(javaFile);
            String packageName = compilationUnit.getPackageDeclaration()
                    .map(declaration -> declaration.getNameAsString())
                    .orElse("");
            List<String> imports = compilationUnit.getImports().stream()
                    .map(importDeclaration -> importDeclaration.getNameAsString())
                    .toList();
            List<TypeDescriptor> out = new ArrayList<>();
            for (TypeDeclaration<?> type : compilationUnit.getTypes()) {
                String simpleName = type.getNameAsString();
                String fqcn = packageName.isBlank() ? simpleName : packageName + "." + simpleName;
                out.add(new TypeDescriptor(
                        javaFile.toAbsolutePath().normalize(),
                        type,
                        packageName,
                        simpleName,
                        fqcn,
                        imports
                ));
            }
            return out;
        } catch (IOException | ParseProblemException ignored) {
            return List.of();
        }
    }

    private static TypeDescriptor selectPrimaryType(TypeIndex index, ResolverRequest request) {
        if (request.inferredTargetFileAbs != null && !request.inferredTargetFileAbs.isBlank()) {
            Path inferredFile = Paths.get(request.inferredTargetFileAbs).toAbsolutePath().normalize();
            List<TypeDescriptor> descriptors = parseTypeDescriptors(inferredFile);
            if (!descriptors.isEmpty()) {
                if (request.classHint != null && request.classHint.contains(".")) {
                    for (TypeDescriptor descriptor : descriptors) {
                        if (descriptor.fqcn.equals(request.classHint)) {
                            return descriptor;
                        }
                    }
                }
                return descriptors.get(0);
            }
        }

        List<TypeDescriptor> candidates = index.lookupTypes(request.classHint);
        if (candidates.size() == 1) {
            return candidates.get(0);
        }
        return null;
    }

    private static MethodDeclaration findMethod(
            TypeDescriptor descriptor,
            String methodHint,
            Integer lineHint,
            int parameterCount
    ) {
        List<MethodDeclaration> matches = descriptor.typeDeclaration.getMethodsByName(methodHint);
        if (parameterCount >= 0) {
            matches = matches.stream()
                    .filter(method -> method.getParameters().size() == parameterCount)
                    .toList();
        }
        if (matches.isEmpty()) {
            return null;
        }
        if (lineHint == null) {
            return matches.get(0);
        }
        return matches.stream()
                .min(Comparator.comparingInt(method ->
                        Math.abs(method.getBegin().map(position -> position.line).orElse(lineHint) - lineHint)))
                .orElse(matches.get(0));
    }

    private static List<MethodContext> collectMethodContexts(
            TypeDescriptor primaryType,
            MethodDeclaration primaryMethod,
            TypeIndex index
    ) {
        List<MethodContext> out = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        Deque<MethodContext> queue = new ArrayDeque<>();
        queue.add(new MethodContext(primaryType, primaryMethod));

        while (!queue.isEmpty()) {
            MethodContext current = queue.removeFirst();
            String visitKey = current.owner.fqcn + "#" + current.method.getNameAsString()
                    + ":" + current.method.getParameters().size();
            if (!visited.add(visitKey)) {
                continue;
            }
            out.add(current);
            if (!(current.owner.typeDeclaration instanceof ClassOrInterfaceDeclaration declaration)) {
                continue;
            }

            List<ClassOrInterfaceType> parentTypes = new ArrayList<>();
            parentTypes.addAll(declaration.getExtendedTypes());
            parentTypes.addAll(declaration.getImplementedTypes());

            for (ClassOrInterfaceType parentType : parentTypes) {
                TypeDescriptor resolvedParent = index.resolveTypeReference(current.owner, parentType.getNameAsString());
                if (resolvedParent == null) {
                    continue;
                }
                MethodDeclaration resolvedMethod = findMethod(
                        resolvedParent,
                        current.method.getNameAsString(),
                        null,
                        current.method.getParameters().size()
                );
                if (resolvedMethod != null) {
                    queue.addLast(new MethodContext(resolvedParent, resolvedMethod));
                }
            }
        }

        return out;
    }

    private static RequestCandidate buildRequestCandidate(
            ResolvedMapping mapping,
            MethodContext context,
            Path primaryFile
    ) {
        RequestCandidate candidate = new RequestCandidate();
        candidate.method = mapping.httpMethod;
        candidate.path = mapping.materializedPath;
        candidate.queryTemplate = mapping.queryTemplate;
        candidate.fullUrlHint = mapping.queryTemplate.isBlank()
                ? mapping.materializedPath
                : mapping.materializedPath + "?" + mapping.queryTemplate;
        candidate.confidence = mapping.mappingOwnerFile.equals(primaryFile) ? 0.92 : 0.88;
        if (mapping.bodyTemplate != null && !mapping.bodyTemplate.isBlank()) {
            candidate.bodyTemplate = mapping.bodyTemplate;
        }
        candidate.rationale = new ArrayList<>(List.of(
                "Resolved HTTP mapping from Java AST.",
                "Mapping owner: " + context.owner.fqcn,
                "Framework resolver: " + mapping.framework
        ));
        if (!mapping.pathParameters.isEmpty()) {
            candidate.rationale.add("Materialized path params: " + String.join(", ", mapping.pathParameters));
        }
        return candidate;
    }

    private static String annotationSimpleName(AnnotationExpr annotation) {
        String raw = annotation.getNameAsString();
        int idx = raw.lastIndexOf('.');
        return idx >= 0 ? raw.substring(idx + 1) : raw;
    }

    private static String resolvePathValue(
            AnnotationExpr annotation,
            TypeDescriptor owner,
            TypeIndex index
    ) {
        if (annotation instanceof SingleMemberAnnotationExpr singleMember) {
            return resolveStringExpression(singleMember.getMemberValue(), owner, index);
        }
        if (annotation instanceof NormalAnnotationExpr normalAnnotation) {
            for (String candidate : List.of("path", "value")) {
                Optional<Expression> value = normalAnnotation.getPairs().stream()
                        .filter(pair -> pair.getNameAsString().equals(candidate))
                        .map(pair -> pair.getValue())
                        .findFirst();
                if (value.isPresent()) {
                    return resolveStringExpression(value.get(), owner, index);
                }
            }
        }
        return "";
    }

    private static String resolveStringExpression(
            Expression expression,
            TypeDescriptor owner,
            TypeIndex index
    ) {
        if (expression instanceof StringLiteralExpr stringLiteral) {
            return stringLiteral.getValue();
        }
        if (expression instanceof TextBlockLiteralExpr textBlockLiteral) {
            return textBlockLiteral.getValue();
        }
        if (expression instanceof NameExpr nameExpr) {
            return owner.stringConstants.getOrDefault(nameExpr.getNameAsString(), "");
        }
        if (expression instanceof FieldAccessExpr fieldAccessExpr) {
            String scope = fieldAccessExpr.getScope().toString();
            String fieldName = fieldAccessExpr.getNameAsString();
            TypeDescriptor target = index.resolveTypeReference(owner, scope);
            if (target != null) {
                return target.stringConstants.getOrDefault(fieldName, "");
            }
        }
        if (expression instanceof BinaryExpr binaryExpr && binaryExpr.getOperator() == BinaryExpr.Operator.PLUS) {
            return resolveStringExpression(binaryExpr.getLeft(), owner, index)
                    + resolveStringExpression(binaryExpr.getRight(), owner, index);
        }
        if (expression instanceof ArrayInitializerExpr arrayInitializerExpr) {
            NodeList<Expression> values = arrayInitializerExpr.getValues();
            if (!values.isEmpty()) {
                return resolveStringExpression(values.get(0), owner, index);
            }
        }
        return "";
    }

    private static String joinPaths(String classPath, String methodPath) {
        String base = normalizePath(classPath);
        String sub = methodPath == null ? "" : methodPath.trim();
        if (sub.isBlank()) {
            return base;
        }
        String normalizedSub = sub.startsWith("/") ? sub : "/" + sub;
        String joined = (base.equals("/") ? "" : base) + normalizedSub;
        return joined.isBlank() ? "/" : joined;
    }

    private static String normalizePath(String raw) {
        if (raw == null || raw.isBlank()) {
            return "/";
        }
        String trimmed = raw.trim();
        return trimmed.startsWith("/") ? trimmed : "/" + trimmed;
    }

    private static String sampleValueForType(Type type) {
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

    private static String sampleBodyForType(Type type) {
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

    private static Optional<ResolvedParameter> resolveParameter(Parameter parameter) {
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
            for (String candidate : List.of("name", "value")) {
                Optional<Expression> value = normalAnnotation.getPairs().stream()
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

    private interface FrameworkResolver {
        String strategyId();

        Optional<ResolvedMapping> resolve(MethodContext context, TypeIndex index);
    }

    private static final class SpringMvcResolver implements FrameworkResolver {
        @Override
        public String strategyId() {
            return "java_ast_spring_mvc_resolver";
        }

        @Override
        public Optional<ResolvedMapping> resolve(MethodContext context, TypeIndex index) {
            String classPath = "";
            for (AnnotationExpr annotation : context.owner.typeDeclaration.getAnnotations()) {
                if (annotationSimpleName(annotation).equals("RequestMapping")) {
                    classPath = resolvePathValue(annotation, context.owner, index);
                }
            }

            String httpMethod = null;
            String methodPath = "";
            for (AnnotationExpr annotation : context.method.getAnnotations()) {
                String simpleName = annotationSimpleName(annotation);
                switch (simpleName) {
                    case "GetMapping" -> {
                        httpMethod = "GET";
                        methodPath = resolvePathValue(annotation, context.owner, index);
                    }
                    case "PostMapping" -> {
                        httpMethod = "POST";
                        methodPath = resolvePathValue(annotation, context.owner, index);
                    }
                    case "PutMapping" -> {
                        httpMethod = "PUT";
                        methodPath = resolvePathValue(annotation, context.owner, index);
                    }
                    case "PatchMapping" -> {
                        httpMethod = "PATCH";
                        methodPath = resolvePathValue(annotation, context.owner, index);
                    }
                    case "DeleteMapping" -> {
                        httpMethod = "DELETE";
                        methodPath = resolvePathValue(annotation, context.owner, index);
                    }
                    case "RequestMapping" -> {
                        methodPath = resolvePathValue(annotation, context.owner, index);
                        if (annotation instanceof NormalAnnotationExpr normalAnnotation) {
                            for (var pair : normalAnnotation.getPairs()) {
                                if (!pair.getNameAsString().equals("method")) {
                                    continue;
                                }
                                String raw = pair.getValue().toString();
                                int idx = raw.lastIndexOf('.');
                                httpMethod = idx >= 0 ? raw.substring(idx + 1) : raw;
                            }
                        }
                    }
                    default -> {
                    }
                }
            }
            if (httpMethod == null || httpMethod.isBlank()) {
                return Optional.empty();
            }
            return Optional.of(materialize("spring_mvc", httpMethod, classPath, methodPath, context));
        }
    }

    private static final class JaxrsResolver implements FrameworkResolver {
        @Override
        public String strategyId() {
            return "java_ast_jaxrs_resolver";
        }

        @Override
        public Optional<ResolvedMapping> resolve(MethodContext context, TypeIndex index) {
            String classPath = "";
            for (AnnotationExpr annotation : context.owner.typeDeclaration.getAnnotations()) {
                if (annotationSimpleName(annotation).equals("Path")) {
                    classPath = resolvePathValue(annotation, context.owner, index);
                }
            }

            String httpMethod = null;
            String methodPath = "";
            for (AnnotationExpr annotation : context.method.getAnnotations()) {
                String simpleName = annotationSimpleName(annotation);
                switch (simpleName) {
                    case "GET", "POST", "PUT", "PATCH", "DELETE" -> httpMethod = simpleName;
                    case "Path" -> methodPath = resolvePathValue(annotation, context.owner, index);
                    default -> {
                    }
                }
            }
            if (httpMethod == null || httpMethod.isBlank()) {
                return Optional.empty();
            }
            return Optional.of(materialize("jaxrs", httpMethod, classPath, methodPath, context));
        }
    }

    private static ResolvedMapping materialize(
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

        for (Parameter parameter : context.method.getParameters()) {
            Optional<ResolvedParameter> resolvedParameter = resolveParameter(parameter);
            if (resolvedParameter.isEmpty()) {
                continue;
            }
            ResolvedParameter param = resolvedParameter.get();
            if (param.kind.equals("query")) {
                queryParts.add(param.name + "=" + sampleValueForType(param.type));
            } else if (param.kind.equals("path")) {
                String value = sampleValueForType(param.type);
                resolvedPath = resolvedPath
                        .replace("{" + param.name + "}", value)
                        .replace(":" + param.name, value);
                pathParameters.add(param.name + "=" + value);
            } else if (param.kind.equals("body")) {
                bodyTemplate = sampleBodyForType(param.type);
            }
        }

        ResolvedMapping mapping = new ResolvedMapping();
        mapping.framework = framework;
        mapping.requestSource = framework;
        mapping.httpMethod = httpMethod;
        mapping.materializedPath = resolvedPath;
        mapping.queryTemplate = String.join("&", queryParts);
        mapping.bodyTemplate = bodyTemplate;
        mapping.mappingOwnerFile = context.owner.fileAbs;
        mapping.pathParameters = pathParameters;
        return mapping;
    }

    public static final class ResolverRequest {
        public String projectRootAbs;
        public String classHint;
        public String methodHint;
        public Integer lineHint;
        public String inferredTargetFileAbs;
    }

    public abstract static class ResolverResponse {
        public String status;
        public String contractVersion;
    }

    public static final class SuccessResponse extends ResolverResponse {
        public String framework;
        public String requestSource;
        public RequestCandidate requestCandidate;
        public String matchedTypeFile;
        public String matchedRootAbs;
        public List<String> evidence;
        public List<String> attemptedStrategies;
        public Map<String, Object> extensions;
    }

    public static final class FailureResponse extends ResolverResponse {
        public String reasonCode;
        public String failedStep;
        public String nextAction;
        public List<String> evidence;
        public List<String> attemptedStrategies;
        public String framework;
        public Map<String, Object> extensions;
    }

    public static final class RequestCandidate {
        public String method;
        public String path;
        public String queryTemplate;
        public String fullUrlHint;
        public String bodyTemplate;
        public double confidence;
        public List<String> rationale;
    }

    private static final class TypeIndex {
        private final Map<String, List<TypeDescriptor>> bySimpleName;
        private final Map<String, TypeDescriptor> byFqcn;
        private final int typeCount;

        private TypeIndex(
                Map<String, List<TypeDescriptor>> bySimpleName,
                Map<String, TypeDescriptor> byFqcn,
                int typeCount
        ) {
            this.bySimpleName = bySimpleName;
            this.byFqcn = byFqcn;
            this.typeCount = typeCount;
        }

        private List<TypeDescriptor> lookupTypes(String classHint) {
            if (classHint == null || classHint.isBlank()) {
                return List.of();
            }
            if (classHint.contains(".")) {
                TypeDescriptor exact = byFqcn.get(classHint);
                return exact == null ? List.of() : List.of(exact);
            }
            return bySimpleName.getOrDefault(classHint, List.of());
        }

        private TypeDescriptor resolveTypeReference(TypeDescriptor owner, String reference) {
            if (reference == null || reference.isBlank()) {
                return null;
            }
            if (reference.contains(".")) {
                return byFqcn.get(reference);
            }
            for (String imported : owner.imports) {
                if (imported.endsWith("." + reference)) {
                    TypeDescriptor resolved = byFqcn.get(imported);
                    if (resolved != null) {
                        return resolved;
                    }
                }
            }
            if (!owner.packageName.isBlank()) {
                TypeDescriptor samePackage = byFqcn.get(owner.packageName + "." + reference);
                if (samePackage != null) {
                    return samePackage;
                }
            }
            List<TypeDescriptor> simpleMatches = bySimpleName.get(reference);
            if (simpleMatches == null || simpleMatches.isEmpty()) {
                return null;
            }
            return simpleMatches.size() == 1 ? simpleMatches.get(0) : null;
        }
    }

    private static final class TypeDescriptor {
        private final Path fileAbs;
        private final TypeDeclaration<?> typeDeclaration;
        private final String packageName;
        private final String simpleName;
        private final String fqcn;
        private final List<String> imports;
        private final Map<String, String> stringConstants;

        private TypeDescriptor(
                Path fileAbs,
                TypeDeclaration<?> typeDeclaration,
                String packageName,
                String simpleName,
                String fqcn,
                List<String> imports
        ) {
            this.fileAbs = fileAbs;
            this.typeDeclaration = typeDeclaration;
            this.packageName = packageName;
            this.simpleName = simpleName;
            this.fqcn = fqcn;
            this.imports = imports;
            this.stringConstants = collectStringConstants(typeDeclaration);
        }

        private static Map<String, String> collectStringConstants(TypeDeclaration<?> declaration) {
            Map<String, String> out = new LinkedHashMap<>();
            for (BodyDeclaration<?> member : declaration.getMembers()) {
                if (!(member instanceof FieldDeclaration fieldDeclaration) || !fieldDeclaration.isStatic()) {
                    continue;
                }
                fieldDeclaration.getVariables().forEach(variable -> variable.getInitializer()
                        .filter(StringLiteralExpr.class::isInstance)
                        .map(StringLiteralExpr.class::cast)
                        .ifPresent(literal -> out.put(variable.getNameAsString(), literal.getValue())));
            }
            return out;
        }
    }

    private record MethodContext(TypeDescriptor owner, MethodDeclaration method) {
    }

    private static final class ResolvedParameter {
        private final String kind;
        private final String name;
        private final Type type;

        private ResolvedParameter(String kind, String name, Type type) {
            this.kind = kind;
            this.name = name;
            this.type = type;
        }
    }

    private static final class ResolvedMapping {
        private String framework;
        private String requestSource;
        private String httpMethod;
        private String materializedPath;
        private String queryTemplate;
        private String bodyTemplate;
        private Path mappingOwnerFile;
        private List<String> pathParameters = List.of();
    }
}
