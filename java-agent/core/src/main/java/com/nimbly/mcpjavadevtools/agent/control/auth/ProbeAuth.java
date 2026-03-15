package com.nimbly.mcpjavadevtools.agent.control.auth;

import com.sun.net.httpserver.HttpExchange;

public final class ProbeAuth {
  private ProbeAuth() {}

  public static boolean authorizeObserve(HttpExchange exchange) {
    return authorize(exchange, resolveObserveToken());
  }

  public static boolean authorizeActuate(HttpExchange exchange) {
    String token = resolveActuateToken();
    if (token == null || token.isBlank()) {
      token = resolveObserveToken();
    }
    return authorize(exchange, token);
  }

  private static String resolveObserveToken() {
    String fromProp = System.getProperty("mcp.probe.auth.observe.token");
    if (fromProp != null && !fromProp.isBlank()) return fromProp.trim();
    String fromEnv = System.getenv("MCP_PROBE_AUTH_OBSERVE_TOKEN");
    if (fromEnv != null && !fromEnv.isBlank()) return fromEnv.trim();
    return "";
  }

  private static String resolveActuateToken() {
    String fromProp = System.getProperty("mcp.probe.auth.actuate.token");
    if (fromProp != null && !fromProp.isBlank()) return fromProp.trim();
    String fromEnv = System.getenv("MCP_PROBE_AUTH_ACTUATE_TOKEN");
    if (fromEnv != null && !fromEnv.isBlank()) return fromEnv.trim();
    return "";
  }

  private static boolean authorize(HttpExchange exchange, String expectedToken) {
    if (expectedToken == null || expectedToken.isBlank()) return true;

    String header = exchange.getRequestHeaders().getFirst("Authorization");
    if (header == null || header.isBlank()) return false;
    String presented = header.trim();
    if (presented.regionMatches(true, 0, "Bearer ", 0, 7)) {
      presented = presented.substring(7).trim();
    }
    return expectedToken.equals(presented);
  }
}

