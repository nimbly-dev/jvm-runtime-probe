package com.nimbly.mcpjvmdebugger.agent;

import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

public final class ProbeRuntime {
  private static final ConcurrentHashMap<String, AtomicLong> COUNTS = new ConcurrentHashMap<>();
  private static final ConcurrentHashMap<String, AtomicLong> LAST_HIT_EPOCH_MS = new ConcurrentHashMap<>();
  private static final ConcurrentHashMap<String, LineTable> RESOLVABLE_LINES_BY_METHOD =
      new ConcurrentHashMap<>();

  private static final Object CAPTURE_LOCK = new Object();
  private static final LinkedHashMap<String, Deque<CaptureEntry>> CAPTURE_BY_METHOD_KEY =
      new LinkedHashMap<>(16, 0.75f, true);
  private static final LinkedHashMap<String, CaptureEntry> CAPTURE_BY_ID = new LinkedHashMap<>();
  private static final AtomicLong CAPTURE_SEQ = new AtomicLong(0L);

  private static final Pattern SENSITIVE_NAME_PATTERN =
      Pattern.compile("(?i).*(password|passwd|pwd|secret|token|authorization|cookie|api[-_]?key|session).*", Pattern.CASE_INSENSITIVE);
  private static final Pattern SECRET_VALUE_PATTERN =
      Pattern.compile("(?i)^(bearer\\s+.+|basic\\s+.+|[A-Za-z0-9_-]{24,}\\.[A-Za-z0-9_-]{24,}\\.[A-Za-z0-9_-]{24,})$");

  private static volatile String MODE = "observe";
  private static volatile String ACTUATOR_ID = "";
  private static volatile String ACTUATE_TARGET_KEY = "";
  private static volatile boolean ACTUATE_RETURN_BOOLEAN = false;

  private static volatile boolean CAPTURE_ENABLED = true;
  private static volatile int CAPTURE_MAX_KEYS = 1000;
  private static volatile int CAPTURE_MAX_ARGS = 32;
  private static volatile int CAPTURE_METHOD_BUFFER_SIZE = 3;
  private static volatile int CAPTURE_PREVIEW_MAX_CHARS = 1024;
  private static volatile int CAPTURE_STORED_MAX_CHARS = 16384;
  private static volatile String CAPTURE_REDACTION_MODE = "basic";
  private static volatile RuntimeStringSignal APPLICATION_TYPE_SIGNAL =
      new RuntimeStringSignal("unknown", "runtime_introspection", 0.1);

  private ProbeRuntime() {}

  static void configure(
      String mode,
      String actuatorId,
      String actuateTargetKey,
      boolean actuateReturnBoolean
  ) {
    String m = (mode == null || mode.isBlank()) ? "observe" : mode.trim().toLowerCase();
    if (!"actuate".equals(m)) {
      MODE = "observe";
      ACTUATOR_ID = "";
      ACTUATE_TARGET_KEY = "";
      ACTUATE_RETURN_BOOLEAN = false;
      return;
    }

    MODE = "actuate";
    ACTUATOR_ID = (actuatorId == null) ? "" : actuatorId.trim();
    ACTUATE_TARGET_KEY = (actuateTargetKey == null) ? "" : actuateTargetKey.trim();
    ACTUATE_RETURN_BOOLEAN = actuateReturnBoolean;
  }

  static void configureCapture(
      boolean captureEnabled,
      int captureMaxKeys,
      int captureMaxArgs,
      int captureMethodBufferSize,
      int capturePreviewMaxChars,
      int captureStoredMaxChars,
      String captureRedactionMode
  ) {
    CAPTURE_ENABLED = captureEnabled;
    CAPTURE_MAX_KEYS = clamp(captureMaxKeys, 10, 20_000, 1000);
    CAPTURE_MAX_ARGS = clamp(captureMaxArgs, 1, 512, 32);
    CAPTURE_METHOD_BUFFER_SIZE = clamp(captureMethodBufferSize, 1, 32, 3);
    CAPTURE_PREVIEW_MAX_CHARS = clamp(capturePreviewMaxChars, 64, 65_536, 1024);
    CAPTURE_STORED_MAX_CHARS = clamp(captureStoredMaxChars, 256, 524_288, 16_384);
    if (CAPTURE_STORED_MAX_CHARS < CAPTURE_PREVIEW_MAX_CHARS) {
      CAPTURE_STORED_MAX_CHARS = CAPTURE_PREVIEW_MAX_CHARS;
    }
    CAPTURE_REDACTION_MODE = "off".equalsIgnoreCase(captureRedactionMode) ? "off" : "basic";
  }

  public static void hit(String key) {
    if (key == null || key.isEmpty()) return;
    COUNTS.computeIfAbsent(key, k -> new AtomicLong()).incrementAndGet();
    LAST_HIT_EPOCH_MS.computeIfAbsent(key, k -> new AtomicLong()).set(currentEpochMs());
  }

  public static void captureByClassMethod(
      String dottedClassName,
      String methodName,
      Object[] allArguments,
      Object returnValue,
      Throwable thrown
  ) {
    if (!CAPTURE_ENABLED) return;
    if (dottedClassName == null || dottedClassName.isBlank()) return;
    if (methodName == null || methodName.isBlank()) return;

    String methodKey = dottedClassName + "#" + methodName;
    String captureId = Long.toHexString(CAPTURE_SEQ.incrementAndGet());
    long capturedAtEpochMs = currentEpochMs();

    List<CaptureValue> capturedArgs = serializeArguments(allArguments);
    CaptureValue capturedReturn = serializeSingleValue(returnValue, null);
    CaptureValue capturedThrown = thrown == null ? null : serializeSingleValue(thrown, null);

    CaptureEntry entry = new CaptureEntry(
        captureId,
        methodKey,
        capturedAtEpochMs,
        capturedArgs,
        capturedReturn,
        capturedThrown,
        CAPTURE_REDACTION_MODE
    );

    synchronized (CAPTURE_LOCK) {
      Deque<CaptureEntry> methodCaptures = CAPTURE_BY_METHOD_KEY.get(methodKey);
      if (methodCaptures == null) {
        methodCaptures = new ArrayDeque<>();
        CAPTURE_BY_METHOD_KEY.put(methodKey, methodCaptures);
      }
      methodCaptures.addLast(entry);
      CAPTURE_BY_ID.put(captureId, entry);
      while (methodCaptures.size() > CAPTURE_METHOD_BUFFER_SIZE) {
        CaptureEntry removed = methodCaptures.removeFirst();
        CAPTURE_BY_ID.remove(removed.captureId);
      }
      evictCapturesIfNeeded();
    }
  }

  public static void hitLineByClassMethod(String dottedClassName, String methodName, int lineNumber) {
    if (dottedClassName == null || methodName == null) return;
    if (lineNumber <= 0) return;
    hit(dottedClassName + "#" + methodName + ":" + lineNumber);
  }

  public static void registerResolvableLine(
      String dottedClassName,
      String methodName,
      int lineNumber
  ) {
    if (dottedClassName == null || dottedClassName.isBlank()) return;
    if (methodName == null || methodName.isBlank()) return;
    if (lineNumber <= 0) return;
    String methodKey = dottedClassName + "#" + methodName;
    RESOLVABLE_LINES_BY_METHOD
        .computeIfAbsent(methodKey, k -> new LineTable())
        .add(lineNumber);
  }

  static boolean isLineKey(String key) {
    return parseLineKey(key) != null;
  }

  static boolean isLineResolvableKey(String key) {
    ParsedLineKey parsed = parseLineKey(key);
    if (parsed == null) return false;
    LineTable table = RESOLVABLE_LINES_BY_METHOD.get(parsed.methodKey);
    if (table == null) return false;
    return table.contains(parsed.lineNumber);
  }

  static long getCount(String key) {
    AtomicLong v = COUNTS.get(key);
    return v == null ? 0L : v.get();
  }

  static long getLastHitEpochMs(String key) {
    AtomicLong v = LAST_HIT_EPOCH_MS.get(key);
    return v == null ? 0L : v.get();
  }

  static String getMode() {
    return MODE;
  }

  static RuntimeStringSignal getApplicationTypeSignal() {
    RuntimeStringSignal detected = detectApplicationType();
    if (!isUnknownApplicationType(detected)) {
      APPLICATION_TYPE_SIGNAL = detected;
      return detected;
    }
    RuntimeStringSignal cached = APPLICATION_TYPE_SIGNAL;
    if (!isUnknownApplicationType(cached)) {
      return cached;
    }
    APPLICATION_TYPE_SIGNAL = detected;
    return detected;
  }

  static RuntimePortSignal getAppPortSignal() {
    return detectAppPort();
  }

  static long currentEpochMs() {
    return Instant.now().toEpochMilli();
  }

  static String getActuatorId() {
    return ACTUATOR_ID;
  }

  static String getActuateTargetKey() {
    return ACTUATE_TARGET_KEY;
  }

  public static boolean getActuateReturnBoolean() {
    return ACTUATE_RETURN_BOOLEAN;
  }

  static boolean isCaptureEnabled() {
    return CAPTURE_ENABLED;
  }

  static String getCaptureRedactionMode() {
    return CAPTURE_REDACTION_MODE;
  }

  static CapturePreviewView getCapturePreviewForKey(String key) {
    String methodKey = toMethodKey(key);
    if (methodKey == null) return CapturePreviewView.unavailable(CAPTURE_REDACTION_MODE);
    synchronized (CAPTURE_LOCK) {
      Deque<CaptureEntry> captures = CAPTURE_BY_METHOD_KEY.get(methodKey);
      if (captures == null || captures.isEmpty()) {
        return CapturePreviewView.unavailable(CAPTURE_REDACTION_MODE);
      }
      CaptureEntry entry = captures.peekLast();
      if (entry == null) return CapturePreviewView.unavailable(CAPTURE_REDACTION_MODE);
      return entry.toPreview(CAPTURE_PREVIEW_MAX_CHARS);
    }
  }

  static CaptureRecordView getCaptureById(String captureId) {
    if (captureId == null || captureId.isBlank()) return null;
    synchronized (CAPTURE_LOCK) {
      CaptureEntry entry = CAPTURE_BY_ID.get(captureId.trim());
      if (entry == null) return null;
      return entry.toRecord();
    }
  }

  public static int branchDecisionByClassMethodLine(
      String dottedClassName,
      String methodName,
      int lineNumber
  ) {
    if (!"actuate".equals(MODE)) return -1;
    if (ACTUATE_TARGET_KEY == null || ACTUATE_TARGET_KEY.isBlank()) return -1;
    if (dottedClassName == null || dottedClassName.isBlank() || methodName == null || methodName.isBlank()) return -1;
    if (lineNumber <= 0) return -1;

    String key = dottedClassName + "#" + methodName + ":" + lineNumber;
    if (!ACTUATE_TARGET_KEY.equals(key)) return -1;

    // 1 = force jump/taken, 0 = force fallthrough/not-taken
    return ACTUATE_RETURN_BOOLEAN ? 1 : 0;
  }

  static void reset(String key) {
    if (key == null || key.isEmpty()) return;
    COUNTS.computeIfAbsent(key, k -> new AtomicLong()).set(0L);
    LAST_HIT_EPOCH_MS.computeIfAbsent(key, k -> new AtomicLong()).set(0L);
    String methodKey = toMethodKey(key);
    if (methodKey != null) {
      synchronized (CAPTURE_LOCK) {
        Deque<CaptureEntry> removed = CAPTURE_BY_METHOD_KEY.remove(methodKey);
        if (removed != null) {
          for (CaptureEntry capture : removed) {
            CAPTURE_BY_ID.remove(capture.captureId);
          }
        }
      }
    }
  }

  static List<String> lineKeysForClass(String dottedClassName) {
    if (dottedClassName == null || dottedClassName.isBlank()) return Collections.emptyList();
    String classPrefix = dottedClassName.trim() + "#";
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, LineTable> entry : RESOLVABLE_LINES_BY_METHOD.entrySet()) {
      String methodKey = entry.getKey();
      if (!methodKey.startsWith(classPrefix)) continue;
      int[] lines = entry.getValue().snapshot();
      for (int line : lines) {
        out.add(methodKey + ":" + line);
      }
    }
    Collections.sort(out);
    return out;
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

  private static List<CaptureValue> serializeArguments(Object[] allArguments) {
    if (allArguments == null || allArguments.length == 0) return Collections.emptyList();
    int max = Math.min(allArguments.length, CAPTURE_MAX_ARGS);
    List<CaptureValue> out = new ArrayList<>();
    for (int i = 0; i < max; i++) {
      out.add(serializeSingleValue(allArguments[i], null));
    }
    if (allArguments.length > max) {
      out.add(CaptureValue.synthetic(
          quoteJson("<args_truncated:" + allArguments.length + " total, kept " + max + ">"),
          true,
          true,
          false
      ));
    }
    return out;
  }

  private static CaptureValue serializeSingleValue(Object value, String keyHint) {
    ValueNormalization normalized = normalizeValue(
        value,
        CAPTURE_REDACTION_MODE,
        keyHint,
        4,
        24,
        24,
        new IdentityHashMap<>()
    );
    return CaptureValue.fromNormalized(normalized.value, normalized.redacted, CAPTURE_STORED_MAX_CHARS);
  }

  private static ValueNormalization normalizeValue(
      Object value,
      String redactionMode,
      String keyHint,
      int depth,
      int maxItems,
      int maxFields,
      IdentityHashMap<Object, Boolean> seen
  ) {
    if (shouldRedactByName(redactionMode, keyHint)) {
      return new ValueNormalization(quoteJson("<redacted>"), true);
    }
    if (value == null) return new ValueNormalization("null", false);

    Class<?> cls = value.getClass();
    if (depth <= 0) {
      return new ValueNormalization(quoteJson("<max_depth:" + cls.getName() + ">"), false);
    }

    if (value instanceof CharSequence) {
      String text = value.toString();
      if (shouldRedactByValue(redactionMode, text)) {
        return new ValueNormalization(quoteJson("<redacted>"), true);
      }
      return new ValueNormalization(quoteJson(text), false);
    }
    if (value instanceof Number || value instanceof Boolean) {
      return new ValueNormalization(String.valueOf(value), false);
    }
    if (value instanceof Character) {
      return new ValueNormalization(quoteJson(String.valueOf(value)), false);
    }
    if (value instanceof Enum<?>) {
      return new ValueNormalization(quoteJson(((Enum<?>) value).name()), false);
    }
    if (value instanceof Class<?>) {
      return new ValueNormalization(quoteJson(((Class<?>) value).getName()), false);
    }

    if (seen.containsKey(value)) {
      return new ValueNormalization(quoteJson("<cycle:" + cls.getName() + ">"), false);
    }
    seen.put(value, Boolean.TRUE);

    try {
      if (cls.isArray()) {
        int len = Array.getLength(value);
        List<String> items = new ArrayList<>();
        boolean redacted = false;
        int limit = Math.min(len, maxItems);
        for (int i = 0; i < limit; i++) {
          ValueNormalization child = normalizeValue(Array.get(value, i), redactionMode, null, depth - 1, maxItems, maxFields, seen);
          items.add(child.value);
          redacted = redacted || child.redacted;
        }
        if (len > limit) {
          items.add(quoteJson("<items_truncated:" + len + " total, kept " + limit + ">"));
        }
        return new ValueNormalization("[" + String.join(",", items) + "]", redacted);
      }

      if (value instanceof Iterable<?>) {
        List<String> items = new ArrayList<>();
        boolean redacted = false;
        int idx = 0;
        for (Object item : (Iterable<?>) value) {
          if (idx >= maxItems) {
            items.add(quoteJson("<items_truncated:kept " + maxItems + ">"));
            break;
          }
          ValueNormalization child = normalizeValue(item, redactionMode, null, depth - 1, maxItems, maxFields, seen);
          items.add(child.value);
          redacted = redacted || child.redacted;
          idx++;
        }
        return new ValueNormalization("[" + String.join(",", items) + "]", redacted);
      }

      if (value instanceof Map<?, ?>) {
        List<Map.Entry<?, ?>> entries = new ArrayList<>(((Map<?, ?>) value).entrySet());
        entries.sort(Comparator.comparing(e -> String.valueOf(e.getKey())));
        List<String> out = new ArrayList<>();
        boolean redacted = false;
        int limit = Math.min(entries.size(), maxItems);
        for (int i = 0; i < limit; i++) {
          Map.Entry<?, ?> e = entries.get(i);
          String name = String.valueOf(e.getKey());
          ValueNormalization child = normalizeValue(e.getValue(), redactionMode, name, depth - 1, maxItems, maxFields, seen);
          out.add(quoteJson(name) + ":" + child.value);
          redacted = redacted || child.redacted;
        }
        if (entries.size() > limit) {
          out.add(quoteJson("<entries_truncated>") + ":" + quoteJson(String.valueOf(entries.size())));
        }
        return new ValueNormalization("{" + String.join(",", out) + "}", redacted);
      }

      if (value instanceof Throwable) {
        Throwable t = (Throwable) value;
        String message = t.getMessage() == null ? "" : t.getMessage();
        if (shouldRedactByValue(redactionMode, message)) {
          message = "<redacted>";
        }
        String payload = "{"
            + quoteJson("type") + ":" + quoteJson(t.getClass().getName()) + ","
            + quoteJson("message") + ":" + quoteJson(message)
            + "}";
        return new ValueNormalization(payload, shouldRedactByValue(redactionMode, message));
      }

      List<Field> fields = collectInstanceFields(cls);
      fields.sort(Comparator.comparing(Field::getName));
      int limit = Math.min(fields.size(), maxFields);
      List<String> out = new ArrayList<>();
      boolean redacted = false;
      for (int i = 0; i < limit; i++) {
        Field f = fields.get(i);
        String name = f.getName();
        try {
          f.setAccessible(true);
          Object fieldValue = f.get(value);
          ValueNormalization child = normalizeValue(fieldValue, redactionMode, name, depth - 1, maxItems, maxFields, seen);
          out.add(quoteJson(name) + ":" + child.value);
          redacted = redacted || child.redacted;
        } catch (Throwable err) {
          out.add(quoteJson(name) + ":" + quoteJson("<inaccessible:" + err.getClass().getSimpleName() + ">"));
        }
      }
      if (fields.size() > limit) {
        out.add(quoteJson("<fields_truncated>") + ":" + quoteJson(String.valueOf(fields.size())));
      }
      String payload = "{" + quoteJson("@type") + ":" + quoteJson(cls.getName())
          + (out.isEmpty() ? "" : "," + String.join(",", out))
          + "}";
      return new ValueNormalization(payload, redacted);
    } finally {
      seen.remove(value);
    }
  }

  private static List<Field> collectInstanceFields(Class<?> cls) {
    List<Field> out = new ArrayList<>();
    Class<?> cursor = cls;
    int depth = 0;
    while (cursor != null && cursor != Object.class && depth < 6) {
      Field[] fields = cursor.getDeclaredFields();
      for (Field field : fields) {
        int mod = field.getModifiers();
        if (Modifier.isStatic(mod)) continue;
        out.add(field);
      }
      cursor = cursor.getSuperclass();
      depth++;
    }
    return out;
  }

  private static boolean shouldRedactByName(String redactionMode, String keyHint) {
    if (!"basic".equals(redactionMode)) return false;
    if (keyHint == null || keyHint.isBlank()) return false;
    return SENSITIVE_NAME_PATTERN.matcher(keyHint).matches();
  }

  private static boolean shouldRedactByValue(String redactionMode, String value) {
    if (!"basic".equals(redactionMode)) return false;
    if (value == null || value.isBlank()) return false;
    String normalized = value.trim();
    if (normalized.length() >= 64 && normalized.indexOf(' ') < 0) {
      return true;
    }
    return SECRET_VALUE_PATTERN.matcher(normalized).matches();
  }

  private static String quoteJson(String raw) {
    return "\"" + escJson(raw == null ? "" : raw) + "\"";
  }

  static String escJson(String s) {
    if (s == null) return "";
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      switch (ch) {
        case '\\':
          out.append("\\\\");
          break;
        case '"':
          out.append("\\\"");
          break;
        case '\n':
          out.append("\\n");
          break;
        case '\r':
          out.append("\\r");
          break;
        case '\t':
          out.append("\\t");
          break;
        default:
          if (ch < 32) {
            out.append(String.format("\\u%04x", (int) ch));
          } else {
            out.append(ch);
          }
      }
    }
    return out.toString();
  }

  private static void evictCapturesIfNeeded() {
    while (CAPTURE_BY_METHOD_KEY.size() > CAPTURE_MAX_KEYS) {
      Map.Entry<String, Deque<CaptureEntry>> eldest = CAPTURE_BY_METHOD_KEY.entrySet().iterator().next();
      Deque<CaptureEntry> removed = CAPTURE_BY_METHOD_KEY.remove(eldest.getKey());
      if (removed != null) {
        for (CaptureEntry capture : removed) {
          CAPTURE_BY_ID.remove(capture.captureId);
        }
      }
    }
  }

  private static int clamp(int value, int min, int max, int defaultValue) {
    if (value < min || value > max) return defaultValue;
    return value;
  }

  private static ParsedLineKey parseLineKey(String key) {
    if (key == null || key.isBlank()) return null;
    int hash = key.lastIndexOf('#');
    int colon = key.lastIndexOf(':');
    if (hash <= 0 || colon <= hash + 1 || colon == key.length() - 1) return null;
    String methodKey = key.substring(0, colon);
    String linePart = key.substring(colon + 1);
    int lineNumber;
    try {
      lineNumber = Integer.parseInt(linePart);
    } catch (NumberFormatException ignored) {
      return null;
    }
    if (lineNumber <= 0) return null;
    return new ParsedLineKey(methodKey, lineNumber);
  }

  private static String toMethodKey(String key) {
    if (key == null || key.isBlank()) return null;
    ParsedLineKey parsed = parseLineKey(key);
    if (parsed != null) return parsed.methodKey;
    String trimmed = key.trim();
    return trimmed.contains("#") ? trimmed : null;
  }

  static final class CaptureValueView {
    final String value;
    final boolean truncated;
    final int originalLength;
    final boolean redacted;

    CaptureValueView(String value, boolean truncated, int originalLength, boolean redacted) {
      this.value = value;
      this.truncated = truncated;
      this.originalLength = originalLength;
      this.redacted = redacted;
    }
  }

  static final class CapturePreviewView {
    final boolean available;
    final String captureId;
    final String methodKey;
    final long capturedAtEpochMs;
    final String redactionMode;
    final List<CaptureValueView> argsPreview;
    final CaptureValueView returnPreview;
    final CaptureValueView thrownPreview;
    final boolean truncatedAny;

    private CapturePreviewView(
        boolean available,
        String captureId,
        String methodKey,
        long capturedAtEpochMs,
        String redactionMode,
        List<CaptureValueView> argsPreview,
        CaptureValueView returnPreview,
        CaptureValueView thrownPreview,
        boolean truncatedAny
    ) {
      this.available = available;
      this.captureId = captureId;
      this.methodKey = methodKey;
      this.capturedAtEpochMs = capturedAtEpochMs;
      this.redactionMode = redactionMode;
      this.argsPreview = argsPreview;
      this.returnPreview = returnPreview;
      this.thrownPreview = thrownPreview;
      this.truncatedAny = truncatedAny;
    }

    static CapturePreviewView unavailable(String redactionMode) {
      return new CapturePreviewView(
          false,
          null,
          null,
          0L,
          redactionMode,
          Collections.emptyList(),
          null,
          null,
          false
      );
    }
  }

  static final class CaptureRecordView {
    final String captureId;
    final String methodKey;
    final long capturedAtEpochMs;
    final String redactionMode;
    final List<CaptureValueView> args;
    final CaptureValueView returnValue;
    final CaptureValueView thrownValue;
    final boolean truncatedAny;

    CaptureRecordView(
        String captureId,
        String methodKey,
        long capturedAtEpochMs,
        String redactionMode,
        List<CaptureValueView> args,
        CaptureValueView returnValue,
        CaptureValueView thrownValue,
        boolean truncatedAny
    ) {
      this.captureId = captureId;
      this.methodKey = methodKey;
      this.capturedAtEpochMs = capturedAtEpochMs;
      this.redactionMode = redactionMode;
      this.args = args;
      this.returnValue = returnValue;
      this.thrownValue = thrownValue;
      this.truncatedAny = truncatedAny;
    }
  }

  private static final class CaptureEntry {
    private final String captureId;
    private final String methodKey;
    private final long capturedAtEpochMs;
    private final List<CaptureValue> args;
    private final CaptureValue returnValue;
    private final CaptureValue thrownValue;
    private final String redactionMode;

    private CaptureEntry(
        String captureId,
        String methodKey,
        long capturedAtEpochMs,
        List<CaptureValue> args,
        CaptureValue returnValue,
        CaptureValue thrownValue,
        String redactionMode
    ) {
      this.captureId = captureId;
      this.methodKey = methodKey;
      this.capturedAtEpochMs = capturedAtEpochMs;
      this.args = args;
      this.returnValue = returnValue;
      this.thrownValue = thrownValue;
      this.redactionMode = redactionMode;
    }

    private CapturePreviewView toPreview(int previewMaxChars) {
      List<CaptureValueView> previewArgs = new ArrayList<>();
      boolean truncatedAny = false;
      for (CaptureValue value : args) {
        CaptureValueView view = value.toView(previewMaxChars);
        previewArgs.add(view);
        truncatedAny = truncatedAny || view.truncated;
      }
      CaptureValueView returnPreview = returnValue == null ? null : returnValue.toView(previewMaxChars);
      CaptureValueView thrownPreview = thrownValue == null ? null : thrownValue.toView(previewMaxChars);
      truncatedAny = truncatedAny
          || (returnPreview != null && returnPreview.truncated)
          || (thrownPreview != null && thrownPreview.truncated);
      return new CapturePreviewView(
          true,
          captureId,
          methodKey,
          capturedAtEpochMs,
          redactionMode,
          previewArgs,
          returnPreview,
          thrownPreview,
          truncatedAny
      );
    }

    private CaptureRecordView toRecord() {
      List<CaptureValueView> outArgs = new ArrayList<>();
      boolean truncatedAny = false;
      for (CaptureValue value : args) {
        CaptureValueView view = value.toView(Integer.MAX_VALUE);
        outArgs.add(view);
        truncatedAny = truncatedAny || view.truncated;
      }
      CaptureValueView outReturn = returnValue == null ? null : returnValue.toView(Integer.MAX_VALUE);
      CaptureValueView outThrown = thrownValue == null ? null : thrownValue.toView(Integer.MAX_VALUE);
      truncatedAny = truncatedAny
          || (outReturn != null && outReturn.truncated)
          || (outThrown != null && outThrown.truncated);
      return new CaptureRecordView(
          captureId,
          methodKey,
          capturedAtEpochMs,
          redactionMode,
          outArgs,
          outReturn,
          outThrown,
          truncatedAny
      );
    }
  }

  private static final class CaptureValue {
    private final String storedValue;
    private final boolean storedTruncated;
    private final int originalLength;
    private final boolean redacted;

    private CaptureValue(String storedValue, boolean storedTruncated, int originalLength, boolean redacted) {
      this.storedValue = storedValue;
      this.storedTruncated = storedTruncated;
      this.originalLength = originalLength;
      this.redacted = redacted;
    }

    static CaptureValue fromNormalized(String value, boolean redacted, int maxChars) {
      if (value == null) value = "null";
      int originalLength = value.length();
      boolean truncated = originalLength > maxChars;
      String stored = truncated ? value.substring(0, maxChars) + "...(truncated)" : value;
      return new CaptureValue(stored, truncated, originalLength, redacted);
    }

    static CaptureValue synthetic(String value, boolean truncated, boolean forceOriginalLength, boolean redacted) {
      int originalLength = forceOriginalLength ? value.length() : value.length();
      return new CaptureValue(value, truncated, originalLength, redacted);
    }

    CaptureValueView toView(int maxChars) {
      if (storedValue == null) {
        return new CaptureValueView("null", storedTruncated, originalLength, redacted);
      }
      if (maxChars >= storedValue.length()) {
        return new CaptureValueView(storedValue, storedTruncated, originalLength, redacted);
      }
      String preview = storedValue.substring(0, maxChars) + "...(preview_truncated)";
      return new CaptureValueView(preview, true, originalLength, redacted);
    }
  }

  private static final class ValueNormalization {
    private final String value;
    private final boolean redacted;

    private ValueNormalization(String value, boolean redacted) {
      this.value = value;
      this.redacted = redacted;
    }
  }

  private static final class ParsedLineKey {
    private final String methodKey;
    private final int lineNumber;

    private ParsedLineKey(String methodKey, int lineNumber) {
      this.methodKey = methodKey;
      this.lineNumber = lineNumber;
    }
  }

  private static final class LineTable {
    private volatile int[] lines = new int[0];

    synchronized void add(int line) {
      int[] current = lines;
      int idx = Arrays.binarySearch(current, line);
      if (idx >= 0) return;
      int insertAt = -idx - 1;
      int[] next = new int[current.length + 1];
      System.arraycopy(current, 0, next, 0, insertAt);
      next[insertAt] = line;
      System.arraycopy(current, insertAt, next, insertAt + 1, current.length - insertAt);
      lines = next;
    }

    boolean contains(int line) {
      return Arrays.binarySearch(lines, line) >= 0;
    }

    int[] snapshot() {
      return Arrays.copyOf(lines, lines.length);
    }
  }

  static final class RuntimeStringSignal {
    final String value;
    final String source;
    final double confidence;

    RuntimeStringSignal(String value, String source, double confidence) {
      this.value = value == null || value.isBlank() ? "unknown" : value;
      this.source = source == null || source.isBlank() ? "runtime_introspection" : source;
      this.confidence = clampConfidence(confidence);
    }
  }

  static final class RuntimePortSignal {
    final Integer value;
    final String source;
    final double confidence;

    RuntimePortSignal(Integer value, String source, double confidence) {
      this.value = value;
      this.source = source == null || source.isBlank() ? "runtime_introspection" : source;
      this.confidence = clampConfidence(confidence);
    }
  }

  private static double clampConfidence(double value) {
    if (Double.isNaN(value) || Double.isInfinite(value)) return 0.0;
    if (value < 0.0) return 0.0;
    if (value > 1.0) return 1.0;
    return value;
  }
}
