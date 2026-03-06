const assert = require("node:assert/strict");
const test = require("node:test");

const { probeReset, probeStatus, probeWaitHit } = require("../../src/tools/probe");

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

test("probe_status returns invalid_line_target for unresolved runtime line", async () => {
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
    assert.equal(out.structuredContent.response.json.lineValidation, "invalid_line_target");
  });
  assert.equal(calls, 1);
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
    assert.equal(parsed.apiOutcome, "ok");
    assert.match(parsed.probeHit, /counter reset requested/i);
  });
});

test("probe_wait_hit exits immediately for invalid_line_target", async () => {
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
    assert.equal(out.structuredContent.result.reason, "invalid_line_target");
  });
  assert.equal(calls, 1);
});

test("probe_status remains backward-compatible when line validation fields are absent", async () => {
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
