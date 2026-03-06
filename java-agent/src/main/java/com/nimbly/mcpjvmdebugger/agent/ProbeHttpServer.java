package com.nimbly.mcpjvmdebugger.agent;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

final class ProbeHttpServer {
  private final HttpServer server;

  private ProbeHttpServer(HttpServer server) {
    this.server = server;
  }

  static ProbeHttpServer start(String host, int port) throws IOException {
    HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 16);
    server.createContext("/__probe/status", new StatusHandler());
    server.createContext("/__probe/reset", new ResetHandler());
    server.createContext("/__probe/actuate", new ActuateHandler());
    server.setExecutor(null);
    server.start();
    return new ProbeHttpServer(server);
  }

  HttpServer rawServer() {
    return server;
  }

  private static final class StatusHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      String method = exchange.getRequestMethod();
      if (!"GET".equalsIgnoreCase(method) && !"POST".equalsIgnoreCase(method)) {
        writeJson(exchange, 405, "{\"error\":\"method_not_allowed\"}");
        return;
      }

      if ("GET".equalsIgnoreCase(method)) {
        String key = queryParam(exchange.getRequestURI(), "key");
        if (key == null || key.isEmpty()) {
          writeJson(exchange, 400, "{\"error\":\"missing_key\"}");
          return;
        }
        long hitCount = ProbeRuntime.getCount(key);
        long lastHitEpochMs = ProbeRuntime.getLastHitEpochMs(key);
        String mode = ProbeRuntime.getMode();
        String actuatorId = ProbeRuntime.getActuatorId();
        String actuateTargetKey = ProbeRuntime.getActuateTargetKey();
        boolean actuateReturnBoolean = ProbeRuntime.getActuateReturnBoolean();
        boolean includeLineValidation = ProbeRuntime.isLineKey(key);
        boolean lineResolvable = includeLineValidation && ProbeRuntime.isLineResolvableKey(key);
        String body =
            "{"
                + "\"key\":\"" + esc(key) + "\","
                + "\"hitCount\":" + hitCount + ","
                + "\"lastHitEpochMs\":" + lastHitEpochMs + ","
                + "\"mode\":\"" + esc(mode) + "\","
                + "\"actuatorId\":\"" + esc(actuatorId) + "\","
                + "\"actuateTargetKey\":\"" + esc(actuateTargetKey) + "\","
                + "\"actuateReturnBoolean\":" + actuateReturnBoolean
                + (includeLineValidation
                ? ",\"lineResolvable\":" + lineResolvable
                + ",\"lineValidation\":\"" + (lineResolvable ? "resolvable" : "invalid_line_target") + "\""
                : "")
                + "}";
        writeJson(exchange, 200, body);
        return;
      }

      String requestBody = readBodyUtf8(exchange.getRequestBody());
      List<String> keys = normalizeDistinctKeys(jsonStringArrayField(requestBody, "keys"));
      if (keys.isEmpty()) {
        writeJson(exchange, 400, "{\"error\":\"missing_keys\"}");
        return;
      }
      List<String> rows = new ArrayList<>();
      for (String key : keys) {
        rows.add(buildStatusRowJson(key));
      }
      String body =
          "{"
              + "\"ok\":true,"
              + "\"count\":" + rows.size() + ","
              + "\"results\":[" + String.join(",", rows) + "]"
              + "}";
      writeJson(exchange, 200, body);
    }
  }

  private static final class ResetHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
        writeJson(exchange, 405, "{\"error\":\"method_not_allowed\"}");
        return;
      }
      String keyFromQuery = queryParam(exchange.getRequestURI(), "key");
      String requestBody = readBodyUtf8(exchange.getRequestBody());
      String keyFromBody = jsonStringField(requestBody, "key");
      List<String> keys = normalizeDistinctKeys(jsonStringArrayField(requestBody, "keys"));
      String className = jsonStringField(requestBody, "className");

      String selectedKey = (keyFromQuery != null && !keyFromQuery.isBlank()) ? keyFromQuery : keyFromBody;
      boolean hasKey = selectedKey != null && !selectedKey.isBlank();
      boolean hasKeys = !keys.isEmpty();
      boolean hasClass = className != null && !className.isBlank();
      int selectorCount = (hasKey ? 1 : 0) + (hasKeys ? 1 : 0) + (hasClass ? 1 : 0);
      if (selectorCount == 0) {
        writeJson(exchange, 400, "{\"error\":\"missing_selector\"}");
        return;
      }
      if (selectorCount > 1) {
        writeJson(exchange, 400, "{\"error\":\"conflicting_selector\"}");
        return;
      }

      if (hasKey) {
        String key = selectedKey.trim();
        boolean includeLineValidation = ProbeRuntime.isLineKey(key);
        boolean lineResolvable = includeLineValidation && ProbeRuntime.isLineResolvableKey(key);
        ProbeRuntime.reset(key);
        String body =
            "{"
                + "\"ok\":true,"
                + "\"key\":\"" + esc(key) + "\""
                + (includeLineValidation
                ? ",\"lineResolvable\":" + lineResolvable
                + ",\"lineValidation\":\"" + (lineResolvable ? "resolvable" : "invalid_line_target") + "\""
                : "")
                + "}";
        writeJson(exchange, 200, body);
        return;
      }

      List<String> resolvedKeys = hasKeys
          ? keys
          : normalizeDistinctKeys(ProbeRuntime.lineKeysForClass(className.trim()));
      List<String> rows = new ArrayList<>();
      for (String key : resolvedKeys) {
        ProbeRuntime.reset(key);
        rows.add(buildResetRowJson(key));
      }
      String body =
          "{"
              + "\"ok\":true,"
              + "\"selector\":\"" + (hasClass ? "className" : "keys") + "\","
              + (hasClass ? "\"className\":\"" + esc(className.trim()) + "\"," : "")
              + "\"count\":" + rows.size() + ","
              + "\"results\":[" + String.join(",", rows) + "]"
              + (hasClass && rows.isEmpty() ? ",\"reason\":\"class_not_found\"" : "")
              + "}";
      writeJson(exchange, 200, body);
    }
  }

  private static final class ActuateHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
        writeJson(exchange, 405, "{\"error\":\"method_not_allowed\"}");
        return;
      }
      String body = readBodyUtf8(exchange.getRequestBody());
      String mode = jsonStringField(body, "mode");
      String actuatorId = jsonStringField(body, "actuatorId");
      String targetKey = jsonStringField(body, "targetKey");
      Boolean returnBoolean = jsonBooleanField(body, "returnBoolean");

      String effectiveMode = (mode == null || mode.isBlank()) ? ProbeRuntime.getMode() : mode;
      String effectiveActuatorId =
          actuatorId == null ? ProbeRuntime.getActuatorId() : actuatorId;
      String effectiveTargetKey =
          targetKey == null ? ProbeRuntime.getActuateTargetKey() : targetKey;
      boolean effectiveReturnBoolean =
          returnBoolean == null ? ProbeRuntime.getActuateReturnBoolean() : returnBoolean;

      ProbeRuntime.configure(
          effectiveMode,
          effectiveActuatorId,
          effectiveTargetKey,
          effectiveReturnBoolean
      );

      String response =
          "{"
              + "\"ok\":true,"
              + "\"mode\":\"" + esc(ProbeRuntime.getMode()) + "\","
              + "\"actuatorId\":\"" + esc(ProbeRuntime.getActuatorId()) + "\","
              + "\"targetKey\":\"" + esc(ProbeRuntime.getActuateTargetKey()) + "\","
              + "\"returnBoolean\":" + ProbeRuntime.getActuateReturnBoolean()
              + "}";
      writeJson(exchange, 200, response);
    }
  }

  private static String queryParam(URI uri, String key) {
    String q = uri.getRawQuery();
    if (q == null || q.isEmpty()) return null;
    Map<String, String> m = parseQuery(q);
    return m.get(key);
  }

  private static Map<String, String> parseQuery(String q) {
    Map<String, String> out = new HashMap<>();
    String[] parts = q.split("&");
    for (String p : parts) {
      int eq = p.indexOf('=');
      if (eq <= 0) continue;
      String k = urlDecode(p.substring(0, eq));
      String v = urlDecode(p.substring(eq + 1));
      out.put(k, v);
    }
    return out;
  }

  private static String readBodyUtf8(InputStream body) throws IOException {
    byte[] bytes = body.readAllBytes();
    if (bytes.length == 0) return "";
    return new String(bytes, StandardCharsets.UTF_8);
  }

  private static String jsonStringField(String json, String field) {
    if (json == null || json.isBlank() || field == null || field.isBlank()) return null;
    int k = json.indexOf("\"" + field + "\"");
    if (k < 0) return null;
    int c = json.indexOf(':', k);
    if (c < 0) return null;
    int q1 = json.indexOf('"', c);
    if (q1 < 0) return null;
    int q2 = json.indexOf('"', q1 + 1);
    if (q2 < 0) return null;
    return json.substring(q1 + 1, q2);
  }

  private static Boolean jsonBooleanField(String json, String field) {
    if (json == null || json.isBlank() || field == null || field.isBlank()) return null;
    int k = json.indexOf("\"" + field + "\"");
    if (k < 0) return null;
    int c = json.indexOf(':', k);
    if (c < 0) return null;
    String tail = json.substring(c + 1).trim();
    if (tail.startsWith("true")) return Boolean.TRUE;
    if (tail.startsWith("false")) return Boolean.FALSE;
    return null;
  }

  private static List<String> jsonStringArrayField(String json, String field) {
    List<String> out = new ArrayList<>();
    if (json == null || json.isBlank() || field == null || field.isBlank()) return out;
    int k = json.indexOf("\"" + field + "\"");
    if (k < 0) return out;
    int c = json.indexOf(':', k);
    if (c < 0) return out;
    int a1 = json.indexOf('[', c);
    if (a1 < 0) return out;
    int a2 = json.indexOf(']', a1 + 1);
    if (a2 < 0) return out;
    String body = json.substring(a1 + 1, a2);
    int cursor = 0;
    while (cursor < body.length()) {
      int q1 = body.indexOf('"', cursor);
      if (q1 < 0) break;
      int q2 = body.indexOf('"', q1 + 1);
      if (q2 < 0) break;
      out.add(body.substring(q1 + 1, q2));
      cursor = q2 + 1;
    }
    return out;
  }

  private static List<String> normalizeDistinctKeys(List<String> keys) {
    LinkedHashSet<String> out = new LinkedHashSet<>();
    for (String raw : keys) {
      if (raw == null) continue;
      String trimmed = raw.trim();
      if (trimmed.isEmpty()) continue;
      out.add(trimmed);
    }
    return new ArrayList<>(out);
  }

  private static String buildStatusRowJson(String key) {
    long hitCount = ProbeRuntime.getCount(key);
    long lastHitEpochMs = ProbeRuntime.getLastHitEpochMs(key);
    String mode = ProbeRuntime.getMode();
    boolean includeLineValidation = ProbeRuntime.isLineKey(key);
    boolean lineResolvable = includeLineValidation && ProbeRuntime.isLineResolvableKey(key);
    return "{"
        + "\"ok\":true,"
        + "\"key\":\"" + esc(key) + "\","
        + "\"hitCount\":" + hitCount + ","
        + "\"lastHitEpochMs\":" + lastHitEpochMs + ","
        + "\"mode\":\"" + esc(mode) + "\""
        + (includeLineValidation
        ? ",\"lineResolvable\":" + lineResolvable
        + ",\"lineValidation\":\"" + (lineResolvable ? "resolvable" : "invalid_line_target") + "\""
        : "")
        + "}";
  }

  private static String buildResetRowJson(String key) {
    boolean includeLineValidation = ProbeRuntime.isLineKey(key);
    boolean lineResolvable = includeLineValidation && ProbeRuntime.isLineResolvableKey(key);
    return "{"
        + "\"ok\":true,"
        + "\"key\":\"" + esc(key) + "\""
        + (includeLineValidation
        ? ",\"lineResolvable\":" + lineResolvable
        + ",\"lineValidation\":\"" + (lineResolvable ? "resolvable" : "invalid_line_target") + "\""
        : "")
        + "}";
  }

  private static String urlDecode(String s) {
    return URLDecoder.decode(s, StandardCharsets.UTF_8);
  }

  private static String esc(String s) {
    return s.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static void writeJson(HttpExchange exchange, int statusCode, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("content-type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(statusCode, bytes.length);
    try (OutputStream os = exchange.getResponseBody()) {
      os.write(bytes);
    }
  }
}
