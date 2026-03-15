package com.nimbly.mcpjavadevtools.requestmapping.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

public final class SourceRootsScanner {
    private static final Set<String> EXCLUDED_SCAN_DIRS = Set.of(
            ".git",
            "node_modules",
            "out",
            ".idea",
            ".vscode"
    );

    private SourceRootsScanner() {
    }

    public static List<Path> discoverModuleRoots(Path projectRoot) {
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
                                name.equals("pom.xml")
                                        || name.equals("build.gradle")
                                        || name.equals("build.gradle.kts"));
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
                // Ignore unreadable directories.
            }
        }

        return new ArrayList<>(found);
    }

    public static List<Path> sourceRootsForModule(Path moduleRoot) {
        return List.of(
                moduleRoot.resolve("src/main/java"),
                moduleRoot.resolve("target/generated-sources/openapi/src/main/java"),
                moduleRoot.resolve("target/generated-sources/src/main/java"),
                moduleRoot.resolve("build/generated/sources/annotationProcessor/java/main")
        );
    }
}


