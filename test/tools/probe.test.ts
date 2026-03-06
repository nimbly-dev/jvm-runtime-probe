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

test("probe_status supports keys[] batch with partial success semantics", async () => {
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

test("probe_reset supports keys[] batch with partial success semantics", async () => {
  let calls = 0;
  let postedBody: any = null;
  const lineKey = "com.example.Catalog#updateAndStageSynonymRule:122";
  const nonLineKey = "com.example.Catalog#updateAndStageSynonymRule";

  await withMockedFetch(async (_input, init) => {
    calls += 1;
    postedBody = init?.body ? JSON.parse(String(init.body)) : null;
    return jsonResponse(200, {
      ok: true,
      selector: "keys",
      count: 1,
      results: [
        {
          ok: true,
          key: lineKey,
          lineResolvable: true,
          lineValidation: "resolvable",
        },
      ],
    });
  }, async () => {
    const out = await probeReset({
      keys: [lineKey, nonLineKey, lineKey],
      baseUrl: "http://127.0.0.1:9191",
      resetPath: "/__probe/reset",
    });
    const parsed = parseProbeText(out);
    const summary = parsed.summary as Record<string, unknown>;
    assert.equal(parsed.mode, "probe_batch");
    assert.equal(parsed.operation, "reset");
    assert.equal(summary.total, 2);
    assert.equal(summary.ok, 1);
    assert.equal(summary.failed, 1);
  });

  assert.equal(calls, 1);
  assert.deepEqual(postedBody, { keys: [lineKey] });
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

test("probe_status rejects conflicting or missing selectors", async () => {
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
