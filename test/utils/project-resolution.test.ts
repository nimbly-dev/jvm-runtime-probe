const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveProjectForInference } = require("../../src/utils/project_resolution.util");

const projects = [
  {
    id: "rhythm-asset-api",
    rootAbs: "C:\\repo\\rhythm-asset-api",
    build: "maven",
    markers: ["pom.xml"],
    probeScope: {
      sourceRoots: [],
      packageSamples: 0,
      candidateBasePackages: [],
    },
  },
  {
    id: "rhythm-search-synonyms-api",
    rootAbs: "C:\\repo\\rhythm-search-synonyms-api",
    build: "maven",
    markers: ["pom.xml"],
    probeScope: {
      sourceRoots: [],
      packageSamples: 0,
      candidateBasePackages: [],
    },
  },
];

test("resolves explicit projectId without cross-project scan", async () => {
  let inferCalled = false;
  const result = await resolveProjectForInference(
    {
      workspaceRootAbs: "C:\\repo",
      projects,
      projectId: "rhythm-search-synonyms-api",
      classHint: "SynonymRuleController",
    },
    {
      inferTargetsFn: async () => {
        inferCalled = true;
        return { scannedJavaFiles: 0, candidates: [] };
      },
    },
  );

  assert.equal(result.kind, "resolved_project");
  assert.equal(result.resolutionMode, "project_id");
  assert.equal(result.projectId, "rhythm-search-synonyms-api");
  assert.equal(result.projectRootAbs, "C:\\repo\\rhythm-search-synonyms-api");
  assert.equal(inferCalled, false);
});

test("returns selector_not_found for unknown serviceHint", async () => {
  const result = await resolveProjectForInference(
    {
      workspaceRootAbs: "C:\\repo",
      projects,
      serviceHint: "missing-service",
      classHint: "SynonymRuleController",
    },
    {
      inferTargetsFn: async () => ({ scannedJavaFiles: 0, candidates: [] }),
    },
  );

  assert.equal(result.kind, "selector_not_found");
  assert.equal(result.resolutionMode, "service_hint");
  assert.equal(result.selectorValue, "missing-service");
  assert.equal(result.availableProjects.length, 2);
});

test("uses single project directly without cross-project scan", async () => {
  let inferCalled = false;
  const result = await resolveProjectForInference(
    {
      workspaceRootAbs: "C:\\repo",
      projects: [projects[1]],
      classHint: "SynonymRuleController",
    },
    {
      inferTargetsFn: async () => {
        inferCalled = true;
        return { scannedJavaFiles: 0, candidates: [] };
      },
    },
  );

  assert.equal(result.kind, "resolved_project");
  assert.equal(result.resolutionMode, "single_project");
  assert.equal(result.projectId, "rhythm-search-synonyms-api");
  assert.equal(inferCalled, false);
});

test("cross-project inference selects unique top project instead of first discovered project", async () => {
  const result = await resolveProjectForInference(
    {
      workspaceRootAbs: "C:\\repo",
      projects,
      classHint: "SynonymRuleController",
      maxCandidates: 8,
    },
    {
      inferTargetsFn: async ({ rootAbs }: { rootAbs: string }) => {
        if (rootAbs.includes("rhythm-asset-api")) {
          return { scannedJavaFiles: 120, candidates: [] };
        }
        return {
          scannedJavaFiles: 85,
          candidates: [
            {
              file: "C:\\repo\\rhythm-search-synonyms-api\\src\\main\\java\\SynonymRuleController.java",
              className: "SynonymRuleController",
              methodName: "search",
              line: 21,
              confidence: 45,
              reasons: ["class exact match"],
            },
          ],
        };
      },
    },
  );

  assert.equal(result.kind, "cross_project_inference");
  assert.equal(result.selectedProjectId, "rhythm-search-synonyms-api");
  assert.equal(result.isAmbiguous, false);
  assert.equal(result.scannedJavaFiles, 205);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].projectId, "rhythm-search-synonyms-api");
});

test("cross-project inference reports ambiguity when top confidence spans multiple projects", async () => {
  const result = await resolveProjectForInference(
    {
      workspaceRootAbs: "C:\\repo",
      projects,
      classHint: "SharedController",
      maxCandidates: 8,
    },
    {
      inferTargetsFn: async ({ rootAbs }: { rootAbs: string }) => ({
        scannedJavaFiles: 10,
        candidates: [
          {
            file: `${rootAbs}\\src\\main\\java\\SharedController.java`,
            className: "SharedController",
            methodName: "lookup",
            line: 11,
            confidence: 45,
            reasons: ["class exact match"],
          },
        ],
      }),
    },
  );

  assert.equal(result.kind, "cross_project_inference");
  assert.equal(result.isAmbiguous, true);
  assert.deepEqual(result.topProjectIds, ["rhythm-asset-api", "rhythm-search-synonyms-api"]);
  assert.equal(result.selectedProjectId, undefined);
});
