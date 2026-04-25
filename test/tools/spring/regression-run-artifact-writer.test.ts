const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildRunArtifactDirAbs,
  writeRegressionRunArtifacts,
} = require("@tools-regression-execution-plan-spec/regression_run_artifact_writer.util");

function createTestTempDir(prefix: string): string {
  const base = path.join(process.cwd(), "test", ".tmp");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, `${prefix}-`));
}

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("buildRunArtifactDirAbs fails closed for invalid run id", () => {
  assert.throws(
    () => buildRunArtifactDirAbs(process.cwd(), "2026/04/19-01"),
    /run_id_invalid/,
  );
});

test("writeRegressionRunArtifacts persists context/result/evidence under .mcpjvm/runs/<run_id>", async () => {
  const root = createTestTempDir("run-artifacts");
  try {
    const runId = "2026-04-19T08-01-22Z_01";
    const written = await writeRegressionRunArtifacts({
      workspaceRootAbs: root,
      runId,
      planRef: {
        name: "gateway-course-review-aggregate-smoke",
        path: ".mcpjvm/regression/gateway-course-review-aggregate-smoke",
      },
      resolvedContext: {
        tenantId: "tenant-social-001",
        "auth.bearer": "SHOULD_NOT_PERSIST",
        requestBody: {
          title: "Hello World!",
          token: "REMOVE_ME",
        },
      },
      secretContextKeys: ["auth.bearer"],
      executionResult: {
        status: "pass",
        preflight: {
          status: "ready",
          reasonCode: "ok",
          missing: [],
          discoverablePending: [],
          prerequisiteResolution: [],
          requiredUserAction: [],
        },
        startedAt: "2026-04-19T08:01:22.111Z",
        endedAt: "2026-04-19T08:01:25.333Z",
        steps: [{ order: 1, id: "create_tag", status: "pass" }],
      },
      evidence: {
        targetResolution: [
          {
            fqcn: "com.example.gateway.tags.TagController",
            method: "createTag",
            sourceRoot: "services/gateway/src/main/java",
          },
        ],
        authMode: { scheme: "bearer", provided: true },
        discovery: {
          attempted: true,
          status: "resolved",
          reasonCode: "ok",
          outcomes: [
            {
              key: "tenantId",
              source: "datasource",
              outcome: "resolved",
              reasonCode: "ok",
              sourceRef: "public.tenants",
            },
            {
              key: "auth.bearer",
              source: "runtime_context",
              outcome: "resolved",
              reasonCode: "ok",
              sourceRef: "Bearer abcdefghijk",
              token: "REMOVE_ME",
              internalDebug: "should be stripped",
            },
          ],
        },
      },
      now: new Date("2026-04-19T08:01:26.000Z"),
    });

    assert.ok(fs.existsSync(written.contextResolvedPathAbs));
    assert.ok(fs.existsSync(written.executionResultPathAbs));
    assert.ok(fs.existsSync(written.evidencePathAbs));

    const context = readJson(written.contextResolvedPathAbs);
    const result = readJson(written.executionResultPathAbs);
    const evidence = readJson(written.evidencePathAbs);

    assert.equal(written.runDirAbs, path.join(root, ".mcpjvm", "runs", runId));
    assert.equal(context.resolvedAt, "2026-04-19T08:01:26.000Z");
    assert.equal(context.tenantId, "tenant-social-001");
    assert.equal(typeof context["auth.bearer"], "undefined");
    assert.equal(typeof context.requestBody.token, "undefined");
    assert.equal(result.status, "pass");
    assert.equal(result.runId, runId);
    assert.equal(evidence.runId, runId);
    assert.equal(evidence.authMode.scheme, "bearer");
    assert.equal(evidence.discovery.outcomes[0].key, "auth.bearer");
    assert.equal(typeof evidence.discovery.outcomes[0].token, "undefined");
    assert.equal(typeof evidence.discovery.outcomes[0].internalDebug, "undefined");
    assert.equal(evidence.discovery.outcomes[0].sourceRef, "[REDACTED]");
    assert.equal(evidence.discovery.outcomes[1].key, "tenantId");
    assert.equal(evidence.discovery.outcomes[1].sourceRef, "public.tenants");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

