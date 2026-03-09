const assert = require("node:assert/strict");
const test = require("node:test");

const { SynthesizerRegistry } = require("../../src/tools/synthesizers/registry/plugin.loader");

test("registry selects the first plugin that can handle the input", async () => {
  const plugin = {
    id: "spring",
    framework: "spring",
    pluginApiVersion: "1.0.0",
    canHandle: async () => true,
    synthesize: async () => ({
      status: "recipe",
      synthesizerUsed: "spring",
      framework: "spring",
      requestCandidate: {
        method: "GET",
        path: "/v1/health",
        queryTemplate: "",
        fullUrlHint: "/v1/health",
        rationale: ["test"],
      },
      trigger: {
        kind: "http",
        method: "GET",
        path: "/v1/health",
        queryTemplate: "",
        fullUrlHint: "/v1/health",
        headers: {},
      },
      evidence: ["plugin_selected=spring"],
      attemptedStrategies: ["spring_annotation_mapping"],
    }),
  };

  const registry = new SynthesizerRegistry([plugin]);
  const result = await registry.synthesize({
    rootAbs: "C:\\repo\\service",
    workspaceRootAbs: "C:\\repo",
    searchRootsAbs: ["C:\\repo\\service"],
    classHint: "HealthController",
    methodHint: "health",
    intentMode: "regression_api_only",
  });

  assert.equal(result.status, "recipe");
  assert.equal(result.synthesizerUsed, "spring");
});

test("registry fails closed when no plugin can handle input", async () => {
  const registry = new SynthesizerRegistry([]);
  const result = await registry.synthesize({
    rootAbs: "C:\\repo\\service",
    workspaceRootAbs: "C:\\repo",
    searchRootsAbs: ["C:\\repo\\service"],
    classHint: "HealthController",
    methodHint: "health",
    intentMode: "regression_api_only",
  });

  assert.equal(result.status, "report");
  assert.equal(result.reasonCode, "synthesizer_not_installed");
  assert.equal(result.failedStep, "plugin_selection");
});

test("registry enforces plugin API compatibility", async () => {
  assert.throws(() => {
    new SynthesizerRegistry([
      {
        id: "bad-plugin",
        framework: "spring",
        pluginApiVersion: "0.0.1",
        canHandle: async () => true,
        synthesize: async () => ({
          status: "report",
          reasonCode: "framework_not_supported",
          failedStep: "test",
          nextAction: "test",
          evidence: [],
          attemptedStrategies: [],
        }),
      },
    ]);
  }, /Incompatible synthesizer plugin/);
});
