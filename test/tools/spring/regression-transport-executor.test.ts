const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createHttpCurlTransportAdapter,
  createTransportRegistry,
  executeTransportWithRegistry,
} = require("@tools-regression-execution-plan-spec/regression_transport_executor.util");

test("http curl adapter returns pass for 2xx response", async () => {
  const adapter = createHttpCurlTransportAdapter(async () => ({
    code: 0,
    stdout: '{"ok":true}\n__MCP_HTTP_CODE__:200',
    stderr: "",
  }));

  const result = await adapter.execute({
    protocol: "http",
    payload: { method: "GET", url: "http://localhost:9001/api/courses" },
  });

  assert.equal(result.status, "pass");
  assert.equal(result.statusCode, 200);
  assert.match(result.bodyPreview, /"ok":true/);
  assert.equal(typeof result.durationMs, "number");
  assert.equal(result.durationMs >= 1, true);
});

test("http curl adapter returns fail_http for non-2xx response", async () => {
  const adapter = createHttpCurlTransportAdapter(async () => ({
    code: 0,
    stdout: '{"error":"unauthorized"}\n__MCP_HTTP_CODE__:401',
    stderr: "",
  }));

  const result = await adapter.execute({
    protocol: "http",
    payload: { method: "GET", url: "http://localhost:9001/api/courses" },
  });

  assert.equal(result.status, "fail_http");
  assert.equal(result.statusCode, 401);
});

test("http curl adapter fails closed for invalid payload", async () => {
  const adapter = createHttpCurlTransportAdapter(async () => ({
    code: 0,
    stdout: "",
    stderr: "",
  }));
  const result = await adapter.execute({
    protocol: "http",
    payload: { method: "GET" },
  });
  assert.equal(result.status, "blocked_invalid");
  assert.equal(result.reasonCode, "http_payload_invalid");
});

test("registry executor fails closed when protocol is unsupported", async () => {
  const registry = createTransportRegistry([]);
  const result = await executeTransportWithRegistry({
    protocol: "grpc",
    payload: {},
    registry,
  });
  assert.equal(result.status, "blocked_invalid");
  assert.equal(result.reasonCode, "transport_not_supported");
});

