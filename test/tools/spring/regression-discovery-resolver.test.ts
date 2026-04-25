const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildReplayPreflightWithDiscovery,
  resolveDiscoverablePrerequisites,
} = require("@tools-regression-execution-plan-spec/regression_discovery_resolver.util");

function baseMetadata(overrides = {}) {
  return {
    specVersion: "1.0.0",
    execution: {
      intent: "regression",
      verifyRuntime: true,
      pinStrictProbeKey: false,
      discoveryPolicy: "allow_discoverable_prerequisites",
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
        },
      },
    ],
    prerequisites: [
      {
        key: "tenantId",
        required: true,
        secret: false,
        provisioning: "discoverable",
        discoverySource: "datasource",
      },
      {
        key: "region",
        required: false,
        secret: false,
        provisioning: "discoverable",
        discoverySource: "runtime_context",
        default: "ap-southeast-1",
      },
      {
        key: "auth.bearer",
        required: true,
        secret: true,
        provisioning: "user_input",
      },
    ],
    steps: [
      {
        order: 1,
        id: "create_post",
        targetRef: 0,
        protocol: "http",
        transport: {
          http: { method: "POST", pathTemplate: "/api/v1/posts" },
        },
      },
    ],
    expectations: [{ type: "outcome_status", equals: "pass" }],
    ...overrides,
  };
}

test("resolveDiscoverablePrerequisites resolves discoverable context with datasource adapter", async () => {
  const result = await resolveDiscoverablePrerequisites({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token" },
    adapters: {
      datasource: async () => ({
        accessMode: "read",
        outcome: "resolved",
        value: "tenant-social-001",
        sourceRef: "table:tenants",
      }),
    },
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.reasonCode, "ok");
  assert.equal(result.discoveredContext.tenantId, "tenant-social-001");
});

test("resolveDiscoverablePrerequisites blocks with policy-disabled reason", async () => {
  const result = await resolveDiscoverablePrerequisites({
    metadata: baseMetadata({ discoveryPolicy: "disabled" }),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token" },
    adapters: {
      datasource: async () => ({ accessMode: "read", outcome: "resolved", value: "tenant-social-001" }),
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "discoverable_prerequisite_policy_disabled");
});

test("resolveDiscoverablePrerequisites blocks on ambiguous datasource result", async () => {
  const result = await resolveDiscoverablePrerequisites({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token" },
    adapters: {
      datasource: async () => ({ accessMode: "read", outcome: "unresolved_ambiguous", candidateCount: 3 }),
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "discovery_ambiguous_result");
});

test("resolveDiscoverablePrerequisites blocks on empty datasource result", async () => {
  const result = await resolveDiscoverablePrerequisites({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token" },
    adapters: {
      datasource: async () => ({ accessMode: "read", outcome: "unresolved_empty", candidateCount: 0 }),
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "discovery_empty_result");
});

test("resolveDiscoverablePrerequisites blocks on unsupported discovery source adapter", async () => {
  const contract = baseContract({
    prerequisites: [
      {
        key: "tenantId",
        required: true,
        secret: false,
        provisioning: "discoverable",
        discoverySource: "runtime_context",
      },
      { key: "auth.bearer", required: true, secret: true, provisioning: "user_input" },
    ],
  });
  const result = await resolveDiscoverablePrerequisites({
    metadata: baseMetadata(),
    contract,
    providedContext: { "auth.bearer": "runtime-token" },
    adapters: {},
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "discovery_source_unsupported");
});

test("resolveDiscoverablePrerequisites blocks on timeout", async () => {
  const result = await resolveDiscoverablePrerequisites({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token" },
    timeoutMs: 20,
    adapters: {
      datasource: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { accessMode: "read", outcome: "resolved", value: "tenant-social-001" };
      },
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "discovery_timeout");
});

test("resolveDiscoverablePrerequisites blocks on adapter runtime failure", async () => {
  const result = await resolveDiscoverablePrerequisites({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token" },
    adapters: {
      datasource: async () => {
        throw new Error("db_connection_refused");
      },
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "discovery_adapter_failure");
});

test("buildReplayPreflightWithDiscovery merges discovered context and becomes ready", async () => {
  const result = await buildReplayPreflightWithDiscovery({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token" },
    targetCandidateCount: 1,
    adapters: {
      datasource: async () => ({ accessMode: "read", outcome: "resolved", value: "tenant-social-001" }),
    },
  });
  assert.equal(result.preflight.status, "ready");
  assert.equal(result.resolvedContext.tenantId, "tenant-social-001");
});

test("buildReplayPreflightWithDiscovery enforces precedence user > discovered > default", async () => {
  const result = await buildReplayPreflightWithDiscovery({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token", tenantId: "tenant-manual-007" },
    targetCandidateCount: 1,
    adapters: {
      datasource: async () => ({ accessMode: "read", outcome: "resolved", value: "tenant-social-001" }),
    },
  });
  assert.equal(result.preflight.status, "ready");
  assert.equal(result.resolvedContext.tenantId, "tenant-manual-007");
});

test("buildReplayPreflightWithDiscovery returns blocked_ambiguous preflight on ambiguous discovery", async () => {
  const result = await buildReplayPreflightWithDiscovery({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token" },
    targetCandidateCount: 1,
    adapters: {
      datasource: async () => ({ accessMode: "read", outcome: "unresolved_ambiguous", candidateCount: 2 }),
    },
  });
  assert.equal(result.preflight.status, "blocked_ambiguous");
  assert.equal(result.preflight.reasonCode, "discovery_ambiguous_result");
});

test("resolveDiscoverablePrerequisites blocks when adapter attempts write/mutation mode", async () => {
  const result = await resolveDiscoverablePrerequisites({
    metadata: baseMetadata(),
    contract: baseContract(),
    providedContext: { "auth.bearer": "runtime-token" },
    adapters: {
      datasource: async () => ({
        accessMode: "write",
        outcome: "resolved",
        value: "tenant-social-001",
      }),
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "discovery_mutation_blocked");
});
