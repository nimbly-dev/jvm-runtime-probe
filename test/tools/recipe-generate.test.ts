const assert = require("node:assert/strict");
const test = require("node:test");

const { generateRecipe } = require("@/tools/core/recipe_generate/domain");

const okAuth = {
  required: "unknown",
  status: "ok",
  strategy: "none",
  nextAction: "none",
  notes: [],
};

test("fails closed when target is not inferred in regression_api_only mode", async () => {
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
  assert.equal(result.requestCandidates.length, 0);
  assert.equal(result.failurePhase, "target_inference");
  assert.equal(result.reasonCode, "target_candidate_missing");
  assert.equal(result.failedStep, "target_inference");
  assert.equal(result.inferenceDiagnostics.target.matched, false);
  assert.equal(result.inferenceDiagnostics.request.attempted, true);
  assert.equal(result.inferenceDiagnostics.request.matched, false);
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
  assert.equal(result.failureReasonCode, "target_candidate_missing");
  assert.equal(result.requestCandidates.length, 0);
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

test("reports request_confirmation_required when unresolved confirmation blocks execution", async () => {
  const result = await generateRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      classHint: "CatalogController",
      methodHint: "listCatalogShoes",
      intentMode: "regression_api_only",
    },
    {
      inferTargetsFn: async () => ({
        scannedJavaFiles: 20,
        candidates: [
          {
            file: "C:\\repo\\service\\src\\main\\java\\CatalogController.java",
            className: "CatalogController",
            methodName: "listCatalogShoes",
            line: 42,
            key: "com.example.CatalogController#listCatalogShoes",
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
            method: "GET",
            path: "/catalog/shoes",
            queryTemplate: "",
            fullUrlHint: "/catalog/shoes",
            needsConfirmation: ["Confirm endpoint path in current environment."],
            rationale: ["controller mapping"],
          },
          trigger: {
            kind: "http",
            method: "GET",
            path: "/catalog/shoes",
            queryTemplate: "",
            fullUrlHint: "/catalog/shoes",
            headers: {},
          },
          evidence: ["resolver=stub"],
          attemptedStrategies: ["stub_strategy"],
        }),
      },
      resolveAuthForRecipeFn: async () => okAuth,
    },
  );

  assert.equal(result.status, "execution_input_required");
  assert.equal(result.resultType, "report");
  assert.equal(result.failurePhase, "request_inference");
  assert.equal(result.failureReasonCode, "request_confirmation_required");
  assert.equal(result.reasonCode, "request_confirmation_required");
  assert.equal(result.failedStep, "request_confirmation");
});

test("keeps deterministic spring request ready even when informational confirmation note is present", async () => {
  const result = await generateRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      classHint: "CatalogController",
      methodHint: "listCatalogShoes",
      intentMode: "regression_api_only",
    },
    {
      inferTargetsFn: async () => ({
        scannedJavaFiles: 20,
        candidates: [
          {
            file: "C:\\repo\\service\\src\\main\\java\\CatalogController.java",
            className: "CatalogController",
            methodName: "listCatalogShoes",
            line: 42,
            key: "com.example.CatalogController#listCatalogShoes",
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
            method: "GET",
            path: "/catalog/shoes",
            queryTemplate: "",
            fullUrlHint: "/catalog/shoes",
            needsConfirmation: ["Best-effort candidate from controller declaration; confirm mapping/auth before execution."],
            rationale: ["controller mapping"],
          },
          trigger: {
            kind: "http",
            method: "GET",
            path: "/catalog/shoes",
            queryTemplate: "",
            fullUrlHint: "/catalog/shoes",
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

  assert.equal(result.resultType, "recipe");
  assert.equal(result.status, "regression_api_only_ready");
  assert.equal(result.executionReadiness, "ready");
});

test("applies apiBasePath prefix to synthesized request candidate and trigger", async () => {
  const result = await generateRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      classHint: "CatalogController",
      methodHint: "listCatalogShoes",
      apiBasePath: "/api/v1",
      intentMode: "regression_api_only",
    },
    {
      inferTargetsFn: async () => ({
        scannedJavaFiles: 20,
        candidates: [
          {
            file: "C:\\repo\\service\\src\\main\\java\\CatalogController.java",
            className: "CatalogController",
            methodName: "listCatalogShoes",
            line: 42,
            key: "com.example.CatalogController#listCatalogShoes",
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
            method: "GET",
            path: "/catalog/shoes",
            queryTemplate: "page=1",
            fullUrlHint: "/catalog/shoes?page=1",
            rationale: ["controller mapping"],
          },
          trigger: {
            kind: "http",
            method: "GET",
            path: "/catalog/shoes",
            queryTemplate: "page=1",
            fullUrlHint: "/catalog/shoes?page=1",
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

  assert.equal(result.resultType, "recipe");
  assert.equal(result.requestCandidates[0].path, "/api/v1/catalog/shoes");
  assert.equal(result.requestCandidates[0].fullUrlHint, "/api/v1/catalog/shoes?page=1");
  assert.equal(result.trigger.path, "/api/v1/catalog/shoes");
  assert.equal(result.trigger.fullUrlHint, "/api/v1/catalog/shoes?page=1");
});

test("does not double-prefix apiBasePath when synthesized path already includes it", async () => {
  const result = await generateRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      classHint: "CatalogController",
      methodHint: "listCatalogShoes",
      apiBasePath: "/api/v1",
      intentMode: "regression_api_only",
    },
    {
      inferTargetsFn: async () => ({
        scannedJavaFiles: 20,
        candidates: [
          {
            file: "C:\\repo\\service\\src\\main\\java\\CatalogController.java",
            className: "CatalogController",
            methodName: "listCatalogShoes",
            line: 42,
            key: "com.example.CatalogController#listCatalogShoes",
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
            method: "GET",
            path: "/api/v1/catalog/shoes",
            queryTemplate: "",
            fullUrlHint: "/api/v1/catalog/shoes",
            rationale: ["controller mapping"],
          },
          trigger: {
            kind: "http",
            method: "GET",
            path: "/api/v1/catalog/shoes",
            queryTemplate: "",
            fullUrlHint: "/api/v1/catalog/shoes",
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

  assert.equal(result.resultType, "recipe");
  assert.equal(result.requestCandidates[0].path, "/api/v1/catalog/shoes");
  assert.equal(result.trigger.path, "/api/v1/catalog/shoes");
});

test("emits non-blocking context path hint when apiBasePath is not provided", async () => {
  const result = await generateRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      classHint: "CatalogController",
      methodHint: "listCatalogShoes",
      intentMode: "regression_api_only",
    },
    {
      inferTargetsFn: async () => ({
        scannedJavaFiles: 20,
        candidates: [
          {
            file: "C:\\repo\\service\\src\\main\\java\\CatalogController.java",
            className: "CatalogController",
            methodName: "listCatalogShoes",
            line: 42,
            key: "com.example.CatalogController#listCatalogShoes",
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
            method: "GET",
            path: "/catalog/shoes",
            queryTemplate: "",
            fullUrlHint: "/catalog/shoes",
            rationale: ["controller mapping"],
          },
          trigger: {
            kind: "http",
            method: "GET",
            path: "/catalog/shoes",
            queryTemplate: "",
            fullUrlHint: "/catalog/shoes",
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

  assert.equal(result.resultType, "recipe");
  assert.equal(result.executionReadiness, "ready");
  assert.equal(
    result.notes.some((note: string) => note.startsWith("context_path_hint=")),
    true,
  );
});
