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
  private static final String CONTRACT_VERSION = ContractVersion.value();

  private final HttpServer server;

  private ProbeHttpServer(HttpServer server) {
    this.server = server;
  }

  static ProbeHttpServer start(String host, int port) throws IOException {
    HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 16);
    server.createContext("/__probe/status", new StatusHandler());
    server.createContext("/__probe/reset", new ResetHandler());
    server.createContext("/__probe/actuate", new ActuateHandler());
    server.createContext("/__probe/capture", new CaptureHandler());
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
        writeJson(exchange, 200, buildStatusEnvelopeJson(key));
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
        rows.add("{\"ok\":true," + buildStatusBodyJson(key) + "}");
      }
      String body =
          "{"
              + "\"contractVersion\":\"" + esc(CONTRACT_VERSION) + "\","
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
                + "\"contractVersion\":\"" + esc(CONTRACT_VERSION) + "\","
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
              + "\"contractVersion\":\"" + esc(CONTRACT_VERSION) + "\","
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
              + "\"contractVersion\":\"" + esc(CONTRACT_VERSION) + "\","
              + "\"ok\":true,"
              + "\"mode\":\"" + esc(ProbeRuntime.getMode()) + "\","
              + "\"actuatorId\":\"" + esc(ProbeRuntime.getActuatorId()) + "\","
              + "\"targetKey\":\"" + esc(ProbeRuntime.getActuateTargetKey()) + "\","
              + "\"returnBoolean\":" + ProbeRuntime.getActuateReturnBoolean()
              + "}";
      writeJson(exchange, 200, response);
    }
  }

  private static final class CaptureHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
        writeJson(exchange, 405, "{\"error\":\"method_not_allowed\"}");
        return;
      }
      String captureId = queryParam(exchange.getRequestURI(), "captureId");
      if (captureId == null || captureId.isBlank()) {
        writeJson(exchange, 400, "{\"error\":\"missing_capture_id\"}");
        return;
      }
      ProbeRuntime.CaptureRecordView capture = ProbeRuntime.getCaptureById(captureId.trim());
      if (capture == null) {
        writeJson(
            exchange,
            404,
            "{"
                + "\"contractVersion\":\"" + esc(CONTRACT_VERSION) + "\","
                + "\"error\":\"capture_not_found\","
                + "\"captureId\":\"" + esc(captureId.trim()) + "\""
                + "}"
        );
        return;
      }
      String body =
          "{"
              + "\"contractVersion\":\"" + esc(CONTRACT_VERSION) + "\","
              + "\"capture\":" + buildCaptureRecordJson(capture)
              + "}";
      writeJson(exchange, 200, body);
    }
  }

  private static String buildStatusEnvelopeJson(String key) {
    return "{"
        + "\"contractVersion\":\"" + esc(CONTRACT_VERSION) + "\","
        + buildStatusBodyJson(key)
        + "}";
  }

  private static String buildStatusBodyJson(String key) {
    long hitCount = ProbeRuntime.getCount(key);
    long lastHitEpochMs = ProbeRuntime.getLastHitEpochMs(key);
    long serverEpochMs = ProbeRuntime.currentEpochMs();
    boolean includeLineValidation = ProbeRuntime.isLineKey(key);
    boolean lineResolvable = includeLineValidation && ProbeRuntime.isLineResolvableKey(key);

    ProbeRuntime.CapturePreviewView capturePreview = ProbeRuntime.getCapturePreviewForKey(key);
    ProbeRuntime.RuntimeStringSignal applicationType = ProbeRuntime.getApplicationTypeSignal();
    ProbeRuntime.RuntimePortSignal appPort = ProbeRuntime.getAppPortSignal();

    String probeJson =
        "{"
            + "\"key\":\"" + esc(key) + "\","
            + "\"hitCount\":" + hitCount + ","
            + "\"lastHitEpochMs\":" + lastHitEpochMs
            + (includeLineValidation
            ? ",\"lineResolvable\":" + lineResolvable
            + ",\"lineValidation\":\"" + (lineResolvable ? "resolvable" : "invalid_line_target") + "\""
            : "")
            + "}";

    String runtimeJson =
        "{"
            + "\"mode\":\"" + esc(ProbeRuntime.getMode()) + "\","
            + "\"actuatorId\":\"" + esc(ProbeRuntime.getActuatorId()) + "\","
            + "\"actuateTargetKey\":\"" + esc(ProbeRuntime.getActuateTargetKey()) + "\","
            + "\"actuateReturnBoolean\":" + ProbeRuntime.getActuateReturnBoolean() + ","
            + "\"serverEpochMs\":" + serverEpochMs + ","
            + "\"applicationType\":" + buildRuntimeStringSignalJson(applicationType) + ","
            + "\"appPort\":" + buildRuntimePortSignalJson(appPort)
            + "}";

    return "\"probe\":" + probeJson + ","
        + "\"capturePreview\":" + buildCapturePreviewJson(capturePreview) + ","
        + "\"runtime\":" + runtimeJson;
  }

  private static String buildCapturePreviewJson(ProbeRuntime.CapturePreviewView preview) {
    if (preview == null || !preview.available) {
      String redactionMode = preview == null ? ProbeRuntime.getCaptureRedactionMode() : preview.redactionMode;
      return "{"
          + "\"available\":false,"
          + "\"redactionMode\":\"" + esc(redactionMode) + "\""
          + "}";
    }

    return "{"
        + "\"available\":true,"
        + "\"captureId\":\"" + esc(preview.captureId) + "\","
        + "\"methodKey\":\"" + esc(preview.methodKey) + "\","
        + "\"capturedAtEpochMs\":" + preview.capturedAtEpochMs + ","
        + "\"redactionMode\":\"" + esc(preview.redactionMode) + "\","
        + "\"argsPreview\":" + buildCaptureValuesJson(preview.argsPreview) + ","
        + "\"returnPreview\":" + buildNullableCaptureValueJson(preview.returnPreview) + ","
        + "\"thrownPreview\":" + buildNullableCaptureValueJson(preview.thrownPreview) + ","
        + "\"truncatedAny\":" + preview.truncatedAny + ","
        + "\"executionPaths\":" + buildStringArrayJson(preview.executionPaths)
        + "}";
  }

  private static String buildCaptureRecordJson(ProbeRuntime.CaptureRecordView capture) {
    return "{"
        + "\"captureId\":\"" + esc(capture.captureId) + "\","
        + "\"methodKey\":\"" + esc(capture.methodKey) + "\","
        + "\"capturedAtEpochMs\":" + capture.capturedAtEpochMs + ","
        + "\"redactionMode\":\"" + esc(capture.redactionMode) + "\","
        + "\"args\":" + buildCaptureValuesJson(capture.args) + ","
        + "\"returnValue\":" + buildNullableCaptureValueJson(capture.returnValue) + ","
        + "\"thrownValue\":" + buildNullableCaptureValueJson(capture.thrownValue) + ","
        + "\"truncatedAny\":" + capture.truncatedAny + ","
        + "\"executionPaths\":" + buildStringArrayJson(capture.executionPaths)
        + "}";
  }

  private static String buildRuntimeStringSignalJson(ProbeRuntime.RuntimeStringSignal signal) {
    if (signal == null) {
      return "{"
          + "\"value\":\"unknown\","
          + "\"source\":\"runtime_introspection\","
          + "\"confidence\":0.0"
          + "}";
    }
    return "{"
        + "\"value\":\"" + esc(signal.value) + "\","
        + "\"source\":\"" + esc(signal.source) + "\","
        + "\"confidence\":" + signal.confidence
        + "}";
  }

  private static String buildRuntimePortSignalJson(ProbeRuntime.RuntimePortSignal signal) {
    if (signal == null) {
      return "{"
          + "\"value\":null,"
          + "\"source\":\"runtime_introspection\","
          + "\"confidence\":0.0"
          + "}";
    }
    return "{"
        + "\"value\":" + (signal.value == null ? "null" : String.valueOf(signal.value)) + ","
        + "\"source\":\"" + esc(signal.source) + "\","
        + "\"confidence\":" + signal.confidence
        + "}";
  }

  private static String buildCaptureValuesJson(List<ProbeRuntime.CaptureValueView> values) {
    if (values == null || values.isEmpty()) return "[]";
    List<String> rows = new ArrayList<>();
    for (int i = 0; i < values.size(); i++) {
      rows.add("{"
          + "\"index\":" + i + ","
          + buildCaptureValueBodyJson(values.get(i))
          + "}");
    }
    return "[" + String.join(",", rows) + "]";
  }

  private static String buildStringArrayJson(List<String> values) {
    if (values == null || values.isEmpty()) return "[]";
    List<String> rows = new ArrayList<>();
    for (String value : values) {
      rows.add("\"" + esc(value) + "\"");
    }
    return "[" + String.join(",", rows) + "]";
  }

  private static String buildNullableCaptureValueJson(ProbeRuntime.CaptureValueView value) {
    if (value == null) return "null";
    return "{" + buildCaptureValueBodyJson(value) + "}";
  }

  private static String buildCaptureValueBodyJson(ProbeRuntime.CaptureValueView value) {
    return "\"value\":\"" + esc(value.value) + "\","
        + "\"truncated\":" + value.truncated + ","
        + "\"originalLength\":" + value.originalLength + ","
        + "\"redacted\":" + value.redacted;
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
    return ProbeRuntime.escJson(s == null ? "" : s);
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
