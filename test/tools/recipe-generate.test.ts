const assert = require("node:assert/strict");
const test = require("node:test");

const { generateRecipe } = require("../../src/tools/core/recipe_generate/domain");

const okAuth = {
  required: "unknown",
  status: "ok",
  strategy: "none",
  nextAction: "none",
  notes: [],
};

test("uses request fallback when target is not inferred in regression_api_only mode", async () => {
  const result = await generateRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      classHint: "SynonymRuleController",
      methodHint: "addSynonymRuleStages",
      intentMode: "regression_api_only",
    },
    {
      inferTargetsFn: async () => ({
        scannedJavaFiles: 20,
        candidates: [],
      }),
      synthesizerRegistry: {
        synthesize: async () => ({
          status: "recipe",
          synthesizerUsed: "spring",
          framework: "spring",
          requestCandidate: {
            method: "POST",
            path: "/v1/synonyms-rule",
            queryTemplate: "",
            fullUrlHint: "/v1/synonyms-rule",
            confidence: 0.78,
            rationale: ["fallback"],
          },
          trigger: {
            kind: "http",
            method: "POST",
            path: "/v1/synonyms-rule",
            queryTemplate: "",
            fullUrlHint: "/v1/synonyms-rule",
            headers: {},
          },
          requestSource: "spring_mvc",
          evidence: ["resolver=stub"],
          attemptedStrategies: ["stub_strategy"],
        }),
      },
      resolveAuthForRecipeFn: async () => okAuth,
    },
  );

  assert.equal(result.status, "regression_api_only_ready");
  assert.equal(result.resultType, "recipe");
  assert.equal(result.requestCandidates.length, 1);
  assert.equal(result.failurePhase, undefined);
  assert.equal(result.inferenceDiagnostics.target.matched, false);
  assert.equal(result.inferenceDiagnostics.request.matched, true);
  assert.equal(result.inferenceDiagnostics.request.source, "spring_mvc");
});

test("keeps target_not_inferred for probe mode when strict line target is unavailable", async () => {
  const result = await generateRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      classHint: "SynonymRuleController",
      methodHint: "addSynonymRuleStages",
      lineHint: 88,
      intentMode: "single_line_probe",
    },
    {
      inferTargetsFn: async () => ({
        scannedJavaFiles: 20,
        candidates: [],
      }),
      synthesizerRegistry: {
        synthesize: async () => ({
          status: "recipe",
          synthesizerUsed: "spring",
          framework: "spring",
          requestCandidate: {
            method: "POST",
            path: "/v1/synonyms-rule",
            queryTemplate: "",
            fullUrlHint: "/v1/synonyms-rule",
            confidence: 0.78,
            rationale: ["fallback"],
          },
          trigger: {
            kind: "http",
            method: "POST",
            path: "/v1/synonyms-rule",
            queryTemplate: "",
            fullUrlHint: "/v1/synonyms-rule",
            headers: {},
          },
          requestSource: "spring_mvc",
          evidence: ["resolver=stub"],
          attemptedStrategies: ["stub_strategy"],
        }),
      },
      resolveAuthForRecipeFn: async () => okAuth,
    },
  );

  assert.equal(result.status, "target_not_inferred");
  assert.equal(result.resultType, "report");
  assert.equal(result.failurePhase, "target_inference");
  assert.equal(result.failureReasonCode, "line_target_required_for_probe_mode");
  assert.equal(result.requestCandidates.length, 1);
  assert.equal(result.executionPlan.probeCallPlan.total, 0);
});

test("reports request_inference failure when target is inferred but request candidate is missing", async () => {
  const result = await generateRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      classHint: "SynonymRuleController",
      methodHint: "addSynonymRuleStages",
      intentMode: "regression_api_only",
    },
    {
      inferTargetsFn: async () => ({
        scannedJavaFiles: 20,
        candidates: [
          {
            file: "C:\\repo\\service\\src\\main\\java\\SynonymRuleController.java",
            className: "SynonymRuleController",
            methodName: "addSynonymRuleStages",
            line: 42,
            key: "com.example.SynonymRuleController#addSynonymRuleStages",
            confidence: 87,
            reasons: ["method exact match"],
          },
        ],
      }),
      synthesizerRegistry: {
        synthesize: async () => ({
          status: "report",
          reasonCode: "request_candidate_missing",
          failedStep: "request_synthesis",
          nextAction: "Refine classHint/methodHint/lineHint.",
          evidence: ["resolver=stub"],
          attemptedStrategies: ["stub_strategy"],
          synthesizerUsed: "spring",
        }),
      },
    },
  );

  assert.equal(result.status, "api_request_not_inferred");
  assert.equal(result.resultType, "report");
  assert.equal(result.failurePhase, "request_inference");
  assert.equal(result.failureReasonCode, "request_candidate_missing");
  assert.equal(result.inferenceDiagnostics.target.matched, true);
  assert.equal(result.inferenceDiagnostics.request.matched, false);
});

test("reports auth_resolution when request exists but auth input is still required", async () => {
  const result = await generateRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      classHint: "SynonymRuleController",
      methodHint: "addSynonymRuleStages",
      intentMode: "regression_api_only",
    },
    {
      inferTargetsFn: async () => ({
        scannedJavaFiles: 20,
        candidates: [
          {
            file: "C:\\repo\\service\\src\\main\\java\\SynonymRuleController.java",
            className: "SynonymRuleController",
            methodName: "addSynonymRuleStages",
            line: 42,
            key: "com.example.SynonymRuleController#addSynonymRuleStages",
            confidence: 87,
            reasons: ["method exact match"],
          },
        ],
      }),
      synthesizerRegistry: {
        synthesize: async () => ({
          status: "recipe",
          synthesizerUsed: "spring",
          framework: "spring",
          requestCandidate: {
            method: "POST",
            path: "/v1/synonyms-rule",
            queryTemplate: "",
            fullUrlHint: "/v1/synonyms-rule",
            confidence: 0.82,
            rationale: ["controller mapping"],
          },
          trigger: {
            kind: "http",
            method: "POST",
            path: "/v1/synonyms-rule",
            queryTemplate: "",
            fullUrlHint: "/v1/synonyms-rule",
            headers: {},
          },
          requestSource: "spring_mvc",
          evidence: ["resolver=stub"],
          attemptedStrategies: ["stub_strategy"],
        }),
      },
      resolveAuthForRecipeFn: async () => ({
        required: true,
        status: "needs_user_input",
        strategy: "bearer",
        missing: ["authToken"],
        nextAction: "Provide authToken",
        notes: [],
      }),
    },
  );

  assert.equal(result.status, "execution_input_required");
  assert.equal(result.resultType, "report");
  assert.equal(result.failurePhase, "auth_resolution");
  assert.equal(result.failureReasonCode, "auth_input_required");
});
