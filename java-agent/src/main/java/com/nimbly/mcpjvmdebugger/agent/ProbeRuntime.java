package com.nimbly.mcpjvmdebugger.agent;

import java.util.Arrays;
import java.util.ArrayList;
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

  public static void hit(String key) {
    if (key == null || key.isEmpty()) return;
    COUNTS.computeIfAbsent(key, k -> new AtomicLong()).incrementAndGet();
    LAST_HIT_EPOCH_MS.computeIfAbsent(key, k -> new AtomicLong()).set(System.currentTimeMillis());
  }

  public static void hitByClassMethod(String dottedClassName, String methodName) {
    if (dottedClassName == null || methodName == null) return;
    hit(dottedClassName + "#" + methodName);
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

  static String getActuatorId() {
    return ACTUATOR_ID;
  }

  static String getActuateTargetKey() {
    return ACTUATE_TARGET_KEY;
  }

  public static boolean getActuateReturnBoolean() {
    return ACTUATE_RETURN_BOOLEAN;
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
