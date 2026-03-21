package com.nimbly.mcpjavadevtools.agent.runtime;

import com.nimbly.mcpjavadevtools.agent.capture.ProbeCaptureStore;
import com.nimbly.mcpjavadevtools.agent.runtime.model.ActuationState;
import com.nimbly.mcpjavadevtools.agent.runtime.model.KeyStatus;
import com.nimbly.mcpjavadevtools.agent.runtime.model.RuntimeState;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

public final class ProbeRuntime {
  private static final ConcurrentHashMap<String, AtomicLong> COUNTS = new ConcurrentHashMap<>();
  private static final ConcurrentHashMap<String, AtomicLong> LAST_HIT_EPOCH_MS = new ConcurrentHashMap<>();
  private static final ConcurrentHashMap<String, LineTable> RESOLVABLE_LINES_BY_METHOD =
      new ConcurrentHashMap<>();

  private static volatile String MODE = "observe";
  private static volatile String ACTUATOR_ID = "";
  private static volatile String ACTUATE_TARGET_KEY = "";
  private static volatile boolean ACTUATE_RETURN_BOOLEAN = false;

  private ProbeRuntime() {}

  public static void configure(
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

  public static void configureCapture(
      boolean captureEnabled,
      int captureMaxKeys,
      int captureMaxArgs,
      int captureMethodBufferSize,
      int capturePreviewMaxChars,
      int captureStoredMaxChars,
      String captureRedactionMode
  ) {
    ProbeCaptureStore.configureCapture(
        captureEnabled,
        captureMaxKeys,
        captureMaxArgs,
        captureMethodBufferSize,
        capturePreviewMaxChars,
        captureStoredMaxChars,
        captureRedactionMode
    );
  }

  public static void configureExecutionPathScope(List<String> includePatterns, List<String> excludePatterns) {
    ProbeCaptureStore.configureExecutionPathScope(includePatterns, excludePatterns);
  }

  public static void hit(String key) {
    if (key == null || key.isEmpty()) return;
    COUNTS.computeIfAbsent(key, k -> new AtomicLong()).incrementAndGet();
    LAST_HIT_EPOCH_MS.computeIfAbsent(key, k -> new AtomicLong()).set(System.currentTimeMillis());
  }

  public static void captureByClassMethod(
      String dottedClassName,
      String methodName,
      Object[] allArguments,
      Object returnValue,
      Throwable thrown
  ) {
    ProbeCaptureStore.captureByClassMethod(dottedClassName, methodName, allArguments, returnValue, thrown);
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
    RESOLVABLE_LINES_BY_METHOD.computeIfAbsent(methodKey, k -> new LineTable()).add(lineNumber);
  }

  public static boolean isLineKey(String key) {
    return parseLineKey(key) != null;
  }

  public static boolean isLineResolvableKey(String key) {
    ParsedLineKey parsed = parseLineKey(key);
    if (parsed == null) return false;
    LineTable table = RESOLVABLE_LINES_BY_METHOD.get(parsed.methodKey);
    if (table == null) return false;
    return table.contains(parsed.lineNumber);
  }

  public static KeyStatus keyStatus(String key) {
    boolean includeLineValidation = isLineKey(key);
    boolean lineResolvable = includeLineValidation && isLineResolvableKey(key);
    return new KeyStatus(
        key,
        countForKey(key),
        lastHitEpochForKey(key),
        includeLineValidation ? lineResolvable : null,
        includeLineValidation ? (lineResolvable ? "resolvable" : "invalid_line_target") : null
    );
  }

  public static ActuationState actuationState() {
    return new ActuationState(MODE, ACTUATOR_ID, ACTUATE_TARGET_KEY, ACTUATE_RETURN_BOOLEAN);
  }

  public static RuntimeState runtimeState() {
    return new RuntimeState(
        actuationState(),
        System.currentTimeMillis(),
        ProbeSignalDetector.getApplicationTypeSignal(),
        ProbeSignalDetector.getAppPortSignal()
    );
  }

  public static long countForKey(String key) {
    AtomicLong v = COUNTS.get(key);
    return v == null ? 0L : v.get();
  }

  public static long lastHitEpochForKey(String key) {
    AtomicLong v = LAST_HIT_EPOCH_MS.get(key);
    return v == null ? 0L : v.get();
  }

  public static int branchDecisionByClassMethodLine(
      String dottedClassName,
      String methodName,
      int lineNumber
  ) {
    if (!"actuate".equals(MODE)) return -1;
    if (ACTUATE_TARGET_KEY == null || ACTUATE_TARGET_KEY.isBlank()) return -1;
    if (dottedClassName == null || dottedClassName.isBlank() || methodName == null || methodName.isBlank()) {
      return -1;
    }
    if (lineNumber <= 0) return -1;

    String key = dottedClassName + "#" + methodName + ":" + lineNumber;
    if (!ACTUATE_TARGET_KEY.equals(key)) return -1;

    // 1 = force jump/taken, 0 = force fallthrough/not-taken
    return ACTUATE_RETURN_BOOLEAN ? 1 : 0;
  }

  public static void reset(String key) {
    if (key == null || key.isEmpty()) return;
    COUNTS.computeIfAbsent(key, k -> new AtomicLong()).set(0L);
    LAST_HIT_EPOCH_MS.computeIfAbsent(key, k -> new AtomicLong()).set(0L);
    ProbeCaptureStore.resetByKey(key);
  }

  public static List<String> lineKeysForClass(String dottedClassName) {
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

  public static String escJson(String s) {
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
}

