package com.nimbly.mcpjavadevtools.agent.runtime;

final class ProbeSignalDetector {
  private static volatile RuntimeStringSignal applicationTypeSignal =
      new RuntimeStringSignal("unknown", "runtime_introspection", 0.1);

  private ProbeSignalDetector() {}

  static RuntimeStringSignal getApplicationTypeSignal() {
    RuntimeStringSignal detected = detectApplicationType();
    if (!isUnknownApplicationType(detected)) {
      applicationTypeSignal = detected;
      return detected;
    }
    RuntimeStringSignal cached = applicationTypeSignal;
    if (!isUnknownApplicationType(cached)) {
      return cached;
    }
    applicationTypeSignal = detected;
    return detected;
  }

  static RuntimePortSignal getAppPortSignal() {
    return detectAppPort();
  }

  static double clampConfidence(double value) {
    if (Double.isNaN(value) || Double.isInfinite(value)) return 0.0;
    if (value < 0.0) return 0.0;
    if (value > 1.0) return 1.0;
    return value;
  }

  private static RuntimeStringSignal detectApplicationType() {
    String command = System.getProperty("sun.java.command");
    if (command != null) {
      String commandLower = command.toLowerCase();
      if (commandLower.contains("org.springframework.boot.loader")) {
        return new RuntimeStringSignal("spring-boot", "system_property:sun.java.command", 0.95);
      }
      if (commandLower.contains("io.quarkus")) {
        return new RuntimeStringSignal("quarkus", "system_property:sun.java.command", 0.92);
      }
      if (commandLower.contains("io.micronaut")) {
        return new RuntimeStringSignal("micronaut", "system_property:sun.java.command", 0.92);
      }
    }

    if (classPresent("org.springframework.boot.SpringApplication")) {
      return new RuntimeStringSignal(
          "spring-boot",
          "classpath:org.springframework.boot.SpringApplication",
          0.9
      );
    }
    if (classPresent("io.quarkus.runtime.Quarkus")) {
      return new RuntimeStringSignal("quarkus", "classpath:io.quarkus.runtime.Quarkus", 0.9);
    }
    if (classPresent("io.micronaut.runtime.Micronaut")) {
      return new RuntimeStringSignal(
          "micronaut",
          "classpath:io.micronaut.runtime.Micronaut",
          0.9
      );
    }
    if (classPresent("jakarta.servlet.Servlet") || classPresent("javax.servlet.Servlet")) {
      return new RuntimeStringSignal("servlet", "classpath:servlet.api", 0.55);
    }
    return new RuntimeStringSignal("unknown", "runtime_introspection", 0.1);
  }

  private static RuntimePortSignal detectAppPort() {
    String[] propertyKeys = new String[] {
        "server.port",
        "local.server.port",
        "management.server.port",
        "micronaut.server.port",
        "quarkus.http.port",
        "jetty.http.port",
        "server.netty.port"
    };
    for (String key : propertyKeys) {
      Integer port = parsePort(System.getProperty(key));
      if (port != null) {
        return new RuntimePortSignal(port, "system_property:" + key, 0.95);
      }
    }

    String[] envKeys = new String[] {
        "SERVER_PORT",
        "PORT",
        "MICRONAUT_SERVER_PORT",
        "QUARKUS_HTTP_PORT"
    };
    for (String key : envKeys) {
      Integer port = parsePort(System.getenv(key));
      if (port != null) {
        return new RuntimePortSignal(port, "env:" + key, "SERVER_PORT".equals(key) ? 0.88 : 0.8);
      }
    }

    Integer fromCommand = parsePortFromCommand(System.getProperty("sun.java.command"));
    if (fromCommand != null) {
      return new RuntimePortSignal(fromCommand, "system_property:sun.java.command", 0.7);
    }
    Integer fromJavaToolOptions = parsePortFromCommand(System.getenv("JAVA_TOOL_OPTIONS"));
    if (fromJavaToolOptions != null) {
      return new RuntimePortSignal(fromJavaToolOptions, "env:JAVA_TOOL_OPTIONS", 0.68);
    }
    return new RuntimePortSignal(null, "runtime_introspection", 0.0);
  }

  private static boolean isUnknownApplicationType(RuntimeStringSignal signal) {
    if (signal == null) return true;
    return "unknown".equalsIgnoreCase(signal.value);
  }

  private static boolean classPresent(String className) {
    ClassLoader context = Thread.currentThread().getContextClassLoader();
    if (context != null) {
      try {
        Class.forName(className, false, context);
        return true;
      } catch (Throwable ignored) {
      }
    }
    ClassLoader system = ClassLoader.getSystemClassLoader();
    if (system != null) {
      try {
        Class.forName(className, false, system);
        return true;
      } catch (Throwable ignored) {
      }
    }
    try {
      Class.forName(className, false, ProbeRuntime.class.getClassLoader());
      return true;
    } catch (Throwable ignored) {
      return false;
    }
  }

  private static Integer parsePort(String raw) {
    if (raw == null) return null;
    String trimmed = raw.trim();
    if (trimmed.isEmpty()) return null;
    int value;
    try {
      value = Integer.parseInt(trimmed);
    } catch (NumberFormatException ignored) {
      return null;
    }
    if (value < 1 || value > 65535) return null;
    return value;
  }

  private static Integer parsePortFromCommand(String command) {
    if (command == null || command.isBlank()) return null;
    String[] tokens = command.split("\\s+");
    for (String token : tokens) {
      if (token.startsWith("--server.port=")) {
        Integer parsed = parsePort(token.substring("--server.port=".length()));
        if (parsed != null) return parsed;
      }
      if (token.startsWith("-Dserver.port=")) {
        Integer parsed = parsePort(token.substring("-Dserver.port=".length()));
        if (parsed != null) return parsed;
      }
      if (token.startsWith("server.port=")) {
        Integer parsed = parsePort(token.substring("server.port=".length()));
        if (parsed != null) return parsed;
      }
    }
    return null;
  }
}

