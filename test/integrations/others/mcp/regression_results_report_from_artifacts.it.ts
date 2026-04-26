const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  writeRegressionRunArtifacts,
} = require("@tools-regression-execution-plan-spec/regression_run_artifact_writer.util");
const {
  renderRegressionRunResultsTableFromArtifacts,
} = require("@tools-regression-execution-plan-spec/regression_results_report.util");

function createTestTempDir(prefix: string): string {
  const base = path.join(process.cwd(), "test", ".tmp");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, `${prefix}-`));
}

test("full run artifacts produce deterministic tabular summary", async () => {
  const root = createTestTempDir("regression-results-it");
  try {
    const runId = "2026-04-25T10-01-22Z_01";
    const written = await writeRegressionRunArtifacts({
      workspaceRootAbs: root,
      runId,
      planRef: {
        name: "post-lifecycle-autoprovision",
      },
      resolvedContext: {
        tenantId: "tenant-social-001",
      },
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
        startedAt: "2026-04-25T10:01:22.000Z",
        endedAt: "2026-04-25T10:01:25.000Z",
        steps: [
          {
            order: 1,
            id: "create_post",
            status: "pass",
            httpStatus: 201,
            durationMs: 120,
            httpMethod: "POST",
            path: "/api/v1/posts",
            memoryBytes: 4096,
          },
        ],
      },
      evidence: {
        targetResolution: [
          {
            stepOrder: 1,
            fqcn: "com.example.social.post.app.controller.PostController",
            method: "createPost",
          },
        ],
        probe: {
          status: "verified_line_hit",
        },
      },
      now: new Date("2026-04-25T10:01:25.500Z"),
    });

    const report = await renderRegressionRunResultsTableFromArtifacts({
      runDirAbs: written.runDirAbs,
      memoryMetricDefined: true,
    });

    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].endpoint, "POST /api/v1/posts");
    assert.equal(report.rows[0].status, "pass");
    assert.equal(report.rows[0].httpCode, "201");
    assert.equal(report.rows[0].durationMs, "120");
    assert.equal(report.rows[0].probeCoverage, "verified_line_hit");
    assert.equal(report.rows[0].memoryBytes, "4096");
    assert.match(report.table, /Memory \(bytes\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
