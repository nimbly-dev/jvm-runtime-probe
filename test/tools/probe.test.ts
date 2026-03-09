const assert = require("node:assert/strict");
const test = require("node:test");

const {
  probeReset,
  probeStatus,
  probeWaitHit,
  probeCaptureGet,
} = require("../../src/tools/core/probe/domain");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function withMockedFetch(
  mockFetch: typeof globalThis.fetch,
  fn: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  if (!originalFetch) throw new Error("global fetch is unavailable in this Node runtime");
  globalThis.fetch = mockFetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function parseProbeText(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  assert.equal(Array.isArray(result.content), true);
  assert.equal(result.content.length > 0, true);
  const first = result.content[0];
  if (!first) throw new Error("missing text content");
  return JSON.parse(first.text);
}

test("probe_get_status returns invalid_line_target for unresolved runtime line", async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls += 1;
    return jsonResponse(200, {
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      hitCount: 0,
      lastHitEpochMs: 0,
      mode: "observe",
      lineResolvable: false,
      lineValidation: "invalid_line_target",
    });
  }, async () => {
    const out = await probeStatus({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
    });
    const parsed = parseProbeText(out);
    assert.equal(parsed.reproStatus, "invalid_line_target");
    assert.equal(parsed.executionHit, "not_hit");
    assert.match(parsed.probeHit, /cannot be resolved to executable bytecode/i);
    assert.equal(parsed.actionCode, "runtime_not_aligned");
    assert.equal(parsed.nextAction, "rebuild_app_artifact_and_restart_jvm_then_rerun_probe");
    assert.equal(out.structuredContent.response.json.lineValidation, "invalid_line_target");
    assert.equal(out.structuredContent.result.actionCode, "runtime_not_aligned");
  });
  assert.equal(calls, 1);
});

test("probe_get_status supports 0.1.0v nested envelope", async () => {
  await withMockedFetch(async () => {
    return jsonResponse(200, {
      contractVersion: "0.1.0v",
      probe: {
        key: "com.example.Catalog#updateAndStageSynonymRule:122",
        hitCount: 1,
        lastHitEpochMs: 1234,
        lineResolvable: true,
        lineValidation: "resolvable",
      },
      capturePreview: {
        available: true,
        captureId: "abc123",
      },
      runtime: {
        mode: "observe",
        actuatorId: "",
        actuateTargetKey: "",
        actuateReturnBoolean: false,
        applicationType: {
          value: "spring-boot",
          source: "classpath:org.springframework.boot.SpringApplication",
          confidence: 0.9,
        },
        appPort: {
          value: 8082,
          source: "system_property:server.port",
          confidence: 0.95,
        },
      },
    });
  }, async () => {
    const out = await probeStatus({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
    });
    const parsed = parseProbeText(out);
    assert.equal(parsed.reproStatus, "status_checked");
    assert.equal(parsed.executionHit, "line_hit");
    assert.equal(out.structuredContent.response.json.contractVersion, "0.1.0v");
    assert.equal(out.structuredContent.response.json.capturePreview.captureId, "abc123");
    assert.equal(
      out.structuredContent.response.json.runtime.applicationType.value,
      "spring-boot",
    );
    assert.equal(out.structuredContent.response.json.runtime.appPort.value, 8082);
  });
});

test("probe_reset returns invalid_line_target semantics when runtime line is unresolved", async () => {
  await withMockedFetch(async () => {
    return jsonResponse(200, {
      ok: true,
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      lineResolvable: false,
      lineValidation: "invalid_line_target",
    });
  }, async () => {
    const out = await probeReset({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      baseUrl: "http://127.0.0.1:9191",
      resetPath: "/__probe/reset",
    });
    const parsed = parseProbeText(out);
    assert.equal(parsed.reproStatus, "invalid_line_target");
    assert.equal(parsed.apiOutcome, "error");
    assert.match(parsed.probeHit, /counter reset requested/i);
    assert.equal(out.structuredContent.result.reason, "invalid_line_target");
    assert.equal(out.structuredContent.result.actionCode, "runtime_not_aligned");
  });
});

test("probe_wait_for_hit exits immediately for invalid_line_target", async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls += 1;
    return jsonResponse(200, {
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      hitCount: 0,
      lastHitEpochMs: 0,
      mode: "observe",
      lineResolvable: false,
      lineValidation: "invalid_line_target",
    });
  }, async () => {
    const out = await probeWaitHit({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
      timeoutMs: 250,
      pollIntervalMs: 100,
      maxRetries: 3,
    });
    const parsed = parseProbeText(out);
    assert.equal(parsed.reproStatus, "invalid_line_target");
    assert.equal(parsed.httpCode, 422);
    assert.equal(parsed.actionCode, "runtime_not_aligned");
    assert.equal(parsed.nextAction, "rebuild_app_artifact_and_restart_jvm_then_rerun_probe");
    assert.equal(out.structuredContent.result.reason, "invalid_line_target");
    assert.equal(out.structuredContent.result.actionCode, "runtime_not_aligned");
  });
  assert.equal(calls, 1);
});

test("probe_wait_for_hit returns structured service_unreachable by default", async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls += 1;
    throw new Error("fetch failed");
  }, async () => {
    const out = await probeWaitHit({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
      timeoutMs: 250,
      pollIntervalMs: 100,
      maxRetries: 3,
    });
    const parsed = parseProbeText(out);
    assert.equal(parsed.reproStatus, "probe_unreachable");
    assert.equal(parsed.httpCode, 503);
    assert.equal(parsed.actionCode, "probe_connectivity_issue");
    assert.equal(parsed.nextAction, "verify_probe_base_url_and_agent_reachability_then_rerun");
    assert.equal(out.structuredContent.result.reason, "service_unreachable");
    assert.equal(out.structuredContent.result.unreachableAttempts, 1);
    assert.equal(out.structuredContent.result.unreachableRetryEnabled, false);
  });
  assert.equal(calls, 1);
});

test("probe_wait_for_hit retries unreachable status checks when enabled and can recover", async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls += 1;
    if (calls === 1) throw new Error("fetch failed");
    return jsonResponse(200, {
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      hitCount: 1,
      lastHitEpochMs: Date.now(),
      mode: "observe",
      lineResolvable: true,
      lineValidation: "resolvable",
    });
  }, async () => {
    const out = await probeWaitHit({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
      timeoutMs: 250,
      pollIntervalMs: 100,
      maxRetries: 3,
      unreachableRetryEnabled: true,
      unreachableMaxRetries: 3,
    });
    assert.equal(out.structuredContent.result.hit, true);
    assert.equal(out.structuredContent.result.inline, true);
  });
  assert.equal(calls, 2);
});

test("probe_wait_for_hit returns structured service_unreachable after unreachable retries are exhausted", async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls += 1;
    throw new Error("fetch failed");
  }, async () => {
    const out = await probeWaitHit({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
      timeoutMs: 250,
      pollIntervalMs: 100,
      maxRetries: 3,
      unreachableRetryEnabled: true,
      unreachableMaxRetries: 2,
    });
    const parsed = parseProbeText(out);
    assert.equal(parsed.reproStatus, "probe_unreachable");
    assert.equal(parsed.httpCode, 503);
    assert.equal(parsed.actionCode, "probe_connectivity_issue");
    assert.equal(parsed.nextAction, "verify_probe_base_url_and_agent_reachability_then_rerun");
    assert.equal(out.structuredContent.result.reason, "service_unreachable");
    assert.equal(out.structuredContent.result.unreachableAttempts, 2);
    assert.equal(out.structuredContent.result.unreachableRetryEnabled, true);
  });
  assert.equal(calls, 2);
});

test("probe_wait_for_hit timeout_no_inline_hit returns line-not-executed guidance", async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls += 1;
    return jsonResponse(200, {
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      hitCount: 0,
      lastHitEpochMs: 0,
      mode: "observe",
      lineResolvable: true,
      lineValidation: "resolvable",
    });
  }, async () => {
    const out = await probeWaitHit({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
      timeoutMs: 120,
      pollIntervalMs: 60,
      maxRetries: 1,
    });
    const parsed = parseProbeText(out);
    assert.equal(parsed.httpCode, 408);
    assert.equal(parsed.actionCode, "line_not_executed_in_window");
    assert.equal(parsed.nextAction, "verify_trigger_path_or_branch_then_rerun_probe_wait_for_hit");
    assert.equal(out.structuredContent.result.reason, "timeout_no_inline_hit");
    assert.equal(out.structuredContent.result.actionCode, "line_not_executed_in_window");
  });
  assert.ok(calls >= 2);
});

test("probe_get_status remains backward-compatible when line validation fields are absent", async () => {
  await withMockedFetch(async () => {
    return jsonResponse(200, {
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      hitCount: 0,
      lastHitEpochMs: 0,
      mode: "observe",
    });
  }, async () => {
    const out = await probeStatus({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
    });
    const parsed = parseProbeText(out);
    assert.equal(parsed.reproStatus, "status_checked");
    assert.equal(parsed.executionHit, "not_hit");
  });
});

test("probe_get_status supports keys[] batch with partial success semantics", async () => {
  let calls = 0;
  let postedBody: any = null;
  const lineKey = "com.example.Catalog#updateAndStageSynonymRule:122";
  const nonLineKey = "com.example.Catalog#updateAndStageSynonymRule";

  await withMockedFetch(async (_input, init) => {
    calls += 1;
    postedBody = init?.body ? JSON.parse(String(init.body)) : null;
    return jsonResponse(200, {
      ok: true,
      count: 1,
      results: [
        {
          ok: true,
          key: lineKey,
          hitCount: 2,
          lastHitEpochMs: 1234567,
          mode: "observe",
          lineResolvable: true,
          lineValidation: "resolvable",
        },
      ],
    });
  }, async () => {
    const out = await probeStatus({
      keys: [lineKey, nonLineKey],
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
    });
    const parsed = parseProbeText(out);
    const summary = parsed.summary as Record<string, unknown>;
    assert.equal(parsed.mode, "probe_batch");
    assert.equal(parsed.operation, "status");
    assert.equal(summary.total, 2);
    assert.equal(summary.ok, 1);
    assert.equal(summary.failed, 1);
  });

  assert.equal(calls, 1);
  assert.deepEqual(postedBody, { keys: [lineKey] });
});

test("probe_get_status supports 0.1.0v batch rows with nested probe payload", async () => {
  const lineKey = "com.example.Catalog#updateAndStageSynonymRule:122";
  await withMockedFetch(async () => {
    return jsonResponse(200, {
      contractVersion: "0.1.0v",
      ok: true,
      count: 1,
      results: [
        {
          ok: true,
          probe: {
            key: lineKey,
            hitCount: 3,
            lastHitEpochMs: 2222,
            lineResolvable: true,
            lineValidation: "resolvable",
          },
          capturePreview: {
            available: true,
            captureId: "cap-1",
          },
          runtime: {
            mode: "observe",
            actuatorId: "",
            actuateTargetKey: "",
            actuateReturnBoolean: false,
            applicationType: {
              value: "spring-boot",
              source: "classpath:org.springframework.boot.SpringApplication",
              confidence: 0.9,
            },
            appPort: {
              value: 8082,
              source: "system_property:server.port",
              confidence: 0.95,
            },
          },
        },
      ],
    });
  }, async () => {
    const out = await probeStatus({
      keys: [lineKey],
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
    });
    const parsed = parseProbeText(out);
    const results = parsed.results as Array<Record<string, unknown>>;
    const first = results[0];
    if (!first) throw new Error("expected first batch row");
    assert.equal(first.probeHit, "hitCount=3, lastHitEpochMs=2222");
    assert.equal(first.runtimeMode, "observe");
    assert.equal((first as any).capturePreview.captureId, "cap-1");
    const responseRows = (out.structuredContent.response.json as any).results;
    assert.equal(responseRows[0].runtime.applicationType.value, "spring-boot");
    assert.equal(responseRows[0].runtime.appPort.value, 8082);
  });
});

test("probe_get_capture returns capture payload when available", async () => {
  await withMockedFetch(async () => {
    return jsonResponse(200, {
      contractVersion: "0.1.0v",
      capture: {
        captureId: "abc123",
        methodKey: "com.example.Catalog#updateAndStageSynonymRule",
        capturedAtEpochMs: 1000,
        redactionMode: "basic",
        args: [{ index: 0, value: "{\"sku\":\"A1\"}", truncated: false, originalLength: 12, redacted: false }],
        returnValue: { value: "{\"ok\":true}", truncated: false, originalLength: 11, redacted: false },
        thrownValue: null,
        truncatedAny: false,
      },
    });
  }, async () => {
    const out = await probeCaptureGet({
      captureId: "abc123",
      baseUrl: "http://127.0.0.1:9191",
      capturePath: "/__probe/capture",
    });
    assert.equal(out.structuredContent.result.found, true);
    assert.equal(out.structuredContent.result.capture.captureId, "abc123");
  });
});

test("probe_get_capture returns not found state when capture is missing", async () => {
  await withMockedFetch(async () => {
    return jsonResponse(404, {
      contractVersion: "0.1.0v",
      error: "capture_not_found",
      captureId: "missing",
    });
  }, async () => {
    const out = await probeCaptureGet({
      captureId: "missing",
      baseUrl: "http://127.0.0.1:9191",
      capturePath: "/__probe/capture",
    });
    assert.equal(out.structuredContent.result.found, false);
    assert.equal(out.structuredContent.result.reason, "capture_not_found");
  });
});

test("probe_reset supports keys[] batch with partial success semantics", async () => {
  let calls = 0;
  let postedBody: any = null;
  const validLineKey = "com.example.Catalog#updateAndStageSynonymRule:122";
  const invalidLineKey = "com.example.Catalog#updateAndStageSynonymRule:123";
  const nonLineKey = "com.example.Catalog#updateAndStageSynonymRule";

  await withMockedFetch(async (_input, init) => {
    calls += 1;
    postedBody = init?.body ? JSON.parse(String(init.body)) : null;
    return jsonResponse(200, {
      ok: true,
      selector: "keys",
      count: 2,
      results: [
        {
          ok: true,
          key: validLineKey,
          lineResolvable: true,
          lineValidation: "resolvable",
        },
        {
          ok: true,
          key: invalidLineKey,
          lineResolvable: false,
          lineValidation: "invalid_line_target",
        },
      ],
    });
  }, async () => {
    const out = await probeReset({
      keys: [validLineKey, invalidLineKey, nonLineKey, validLineKey],
      baseUrl: "http://127.0.0.1:9191",
      resetPath: "/__probe/reset",
    });
    const parsed = parseProbeText(out);
    const summary = parsed.summary as Record<string, unknown>;
    assert.equal(parsed.mode, "probe_batch");
    assert.equal(parsed.operation, "reset");
    assert.equal(summary.total, 3);
    assert.equal(summary.ok, 1);
    assert.equal(summary.failed, 2);
    const results = parsed.results as Array<Record<string, unknown>>;
    const invalidRow = results.find((row) => row.key === invalidLineKey);
    if (!invalidRow) throw new Error("expected invalid line row in batch response");
    assert.equal(invalidRow.apiOutcome, "error");
    assert.equal(invalidRow.reproStatus, "invalid_line_target");
  });

  assert.equal(calls, 1);
  assert.deepEqual(postedBody, { keys: [validLineKey, invalidLineKey] });
});

test("probe_reset supports className selector and class_not_found no-op response", async () => {
  let calls = 0;
  await withMockedFetch(async () => {
    calls += 1;
    return jsonResponse(200, {
      ok: true,
      selector: "className",
      className: "com.example.Catalog",
      count: 0,
      reason: "class_not_found",
      results: [],
    });
  }, async () => {
    const out = await probeReset({
      className: "com.example.Catalog",
      baseUrl: "http://127.0.0.1:9191",
      resetPath: "/__probe/reset",
    });
    const parsed = parseProbeText(out);
    const summary = parsed.summary as Record<string, unknown>;
    const response = parsed.response as Record<string, unknown>;
    const responseJson = response.json as Record<string, unknown>;
    assert.equal(parsed.mode, "probe_batch");
    assert.equal(parsed.operation, "reset");
    assert.equal(summary.total, 0);
    assert.equal(responseJson.reason, "class_not_found");
  });
  assert.equal(calls, 1);
});

test("probe_get_status rejects conflicting or missing selectors", async () => {
  await assert.rejects(
    probeStatus({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      keys: ["com.example.Catalog#updateAndStageSynonymRule:123"],
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
    }),
    /conflicting selectors/i,
  );

  await assert.rejects(
    probeStatus({
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
    } as any),
    /requires exactly one selector/i,
  );

  await assert.rejects(
    probeStatus({
      keys: ["com.example.Catalog#updateAndStageSynonymRule:123"],
      lineHint: 123,
      baseUrl: "http://127.0.0.1:9191",
      statusPath: "/__probe/status",
    }),
    /does not allow lineHint with keys\[\]/i,
  );
});

test("probe_reset rejects conflicting or missing selectors", async () => {
  await assert.rejects(
    probeReset({
      key: "com.example.Catalog#updateAndStageSynonymRule:122",
      className: "com.example.Catalog",
      baseUrl: "http://127.0.0.1:9191",
      resetPath: "/__probe/reset",
    }),
    /conflicting selectors/i,
  );

  await assert.rejects(
    probeReset({
      baseUrl: "http://127.0.0.1:9191",
      resetPath: "/__probe/reset",
    } as any),
    /requires exactly one selector/i,
  );

  await assert.rejects(
    probeReset({
      className: "com.example.Catalog",
      lineHint: 88,
      baseUrl: "http://127.0.0.1:9191",
      resetPath: "/__probe/reset",
    }),
    /does not allow lineHint with keys\[\] or className/i,
  );
});

