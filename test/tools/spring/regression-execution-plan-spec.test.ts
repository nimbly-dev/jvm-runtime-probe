const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyStepExtract,
  buildReplayPreflight,
  buildTimestampRunId,
  resolvePrerequisiteContext,
  resolveStepTransport,
} = require("@tools-regression-execution-plan-spec/regression_execution_plan_spec.util");

function baseMetadata(overrides = {}) {
  return {
    specVersion: "1.0.0",
    execution: {
      intent: "regression",
      verifyRuntime: true,
      pinStrictProbeKey: false,
      ...overrides,
    },
  };
}

function baseContract(overrides = {}) {
  return {
    targets: [
      {
        type: "class_method",
        selectors: {
          fqcn: "com.example.social.post.app.controller.PostController",
          method: "createPost",
          signature: "(com.example.social.post.api.CreatePostRequest)",
          sourceRoot: "test/fixtures/spring-apps/social-platform/post-service/post-app",
        },
      },
    ],
    prerequisites: [
      { key: "tenantId", required: true, secret: false, default: "tenant-social-001" },
      { key: "auth.bearer", required: true, secret: true },
    ],
    steps: [
      {
        order: 1,
        id: "create_post",
        targetRef: 0,
        protocol: "http",
        transport: {
          http: {
            method: "POST",
            pathTemplate: "/api/v1/posts",
            query: { tenantId: "${tenantId}" },
            body: { title: "Hello World!" },
          },
        },
        extract: [{ from: "response.body.id", as: "postId" }],
      },
    ],
    expectations: [{ type: "outcome_status", equals: "pass" }],
    ...overrides,
  };
}

test("preflight ready when prerequisites are satisfied by defaults and runtime inputs", () => {
  const result = buildReplayPreflight({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "provided-at-runtime" },
    targetCandidateCount: 1,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.reasonCode, "ok");
  assert.deepEqual(result.missing, []);
});

test("preflight needs_user_input when required prerequisite has no value and no default", () => {
  const contract = baseContract({
    prerequisites: [
      { key: "tenantId", required: true, secret: false },
      { key: "auth.bearer", required: true, secret: true },
    ],
  });
  const result = buildReplayPreflight({
    metadata: baseMetadata(),
    contract,
    providedContext: {},
    targetCandidateCount: 1,
  });
  assert.equal(result.status, "needs_user_input");
  assert.equal(result.reasonCode, "missing_prerequisites");
  assert.deepEqual(result.missing, ["tenantId", "auth.bearer"]);
});

test("preflight blocked_invalid when transport protocol key does not match step protocol", () => {
  const contract = baseContract({
    steps: [
      {
        order: 1,
        id: "create_post",
        targetRef: 0,
        protocol: "http",
        transport: {
          grpc: {
            service: "PostService",
            method: "CreatePost",
          },
        },
      },
    ],
  });
  const result = buildReplayPreflight({
    metadata: baseMetadata(),
    contract,
    providedContext: { "auth.bearer": "ok" },
    targetCandidateCount: 1,
  });
  assert.equal(result.status, "blocked_invalid");
  assert.equal(result.reasonCode, "transport_protocol_mismatch");
});

test("preflight blocked_ambiguous when multiple target candidates remain", () => {
  const result = buildReplayPreflight({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "ok" },
    targetCandidateCount: 2,
  });
  assert.equal(result.status, "blocked_ambiguous");
  assert.equal(result.reasonCode, "target_ambiguous");
});

test("preflight stale_plan when pinStrictProbeKey is enabled but strict key is invalid", () => {
  const metadata = baseMetadata({ pinStrictProbeKey: true });
  const contract = baseContract({
    targets: [
      {
        type: "class_method",
        selectors: { fqcn: "com.example.PostController", method: "createPost" },
        runtimeVerification: { strictProbeKey: "invalid" },
      },
    ],
  });
  const result = buildReplayPreflight({
    metadata,
    contract,
    providedContext: { "auth.bearer": "ok" },
    targetCandidateCount: 1,
  });
  assert.equal(result.status, "stale_plan");
  assert.equal(result.reasonCode, "strict_probe_key_invalid");
});

test("resolvePrerequisiteContext prefers provided values and falls back to defaults", () => {
  const resolved = resolvePrerequisiteContext(
    [
      { key: "tenantId", required: true, secret: false, default: "tenant-social-001" },
      { key: "region", required: true, secret: false, default: "ap-southeast-1" },
      { key: "auth.bearer", required: true, secret: true },
    ],
    { tenantId: "tenant-override", "auth.bearer": "runtime-token" },
  );
  assert.equal(resolved.tenantId, "tenant-override");
  assert.equal(resolved.region, "ap-southeast-1");
  assert.equal(resolved["auth.bearer"], "runtime-token");
});

test("resolveStepTransport replaces context placeholders deterministically", () => {
  const step = {
    order: 1,
    id: "create_post",
    targetRef: 0,
    protocol: "http",
    transport: {
      http: {
        method: "POST",
        pathTemplate: "/api/v1/posts/${postId}",
        query: {
          tenantId: "${tenantId}",
        },
      },
    },
  };
  const resolved = resolveStepTransport(step, { tenantId: "tenant-social-001", postId: "post-22" });
  assert.equal(resolved.http.pathTemplate, "/api/v1/posts/post-22");
  assert.equal(resolved.http.query.tenantId, "tenant-social-001");
});

test("applyStepExtract writes extracted values into next-step context", () => {
  const initial = { tenantId: "tenant-social-001" };
  const output = {
    response: {
      body: {
        id: "post-998",
      },
    },
  };
  const next = applyStepExtract(output, [{ from: "response.body.id", as: "postId" }], initial);
  assert.equal(next.tenantId, "tenant-social-001");
  assert.equal(next.postId, "post-998");
});

test("buildTimestampRunId produces sortable timestamp-based run id", () => {
  const runId = buildTimestampRunId(new Date("2026-04-17T09:42:11.987Z"), 1);
  assert.equal(runId, "2026-04-17T09-42-11Z_01");
});

