const assert = require("node:assert/strict");
const test = require("node:test");

const { synthesizeSpringRecipe } = require("@/utils/synthesizers/spring/synthesis.util");

test("spring synthesizer maps AST resolver success into a request recipe", async () => {
  const result = await synthesizeSpringRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      searchRootsAbs: ["C:\\repo\\service"],
      classHint: "HealthController",
      methodHint: "health",
      intentMode: "regression_http_only",
      inferredTargetFileAbs: "C:\\repo\\service\\src\\main\\java\\HealthController.java",
    },
    {
      resolveRequestMappingFn: async () => ({
        status: "ok",
        contractVersion: "0.1.0",
        framework: "spring_mvc",
        requestSource: "spring_mvc",
        requestCandidate: {
          method: "GET",
          path: "/v1/health",
          queryTemplate: "",
          fullUrlHint: "/v1/health",
          rationale: ["ast"],
        },
        matchedTypeFile: "C:\\repo\\service\\src\\main\\java\\HealthController.java",
        matchedRootAbs: "C:\\repo\\service",
        evidence: ["resolvedType=com.example.HealthController"],
        attemptedStrategies: ["java_ast_index_lookup", "java_ast_spring_mvc_resolver"],
      }),
    },
  );

  assert.equal(result.status, "recipe");
  assert.equal(result.synthesizerUsed, "spring");
  assert.equal(result.requestCandidate.method, "GET");
  assert.equal(result.requestSource, "spring_mvc");
  assert.deepEqual(result.attemptedStrategies, [
    "java_ast_index_lookup",
    "java_ast_spring_mvc_resolver",
  ]);
  assert.equal(
    result.evidence.some((entry: string) => entry.startsWith("ast_context_path_hint=")),
    false,
  );
});

test("spring synthesizer consumes optional resolver extensions without changing contract", async () => {
  const result = await synthesizeSpringRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      searchRootsAbs: ["C:\\repo\\service"],
      classHint: "HealthController",
      methodHint: "health",
      intentMode: "regression_http_only",
    },
    {
      resolveRequestMappingFn: async () => ({
        status: "ok",
        contractVersion: "0.1.0",
        framework: "spring_mvc",
        requestSource: "spring_mvc",
        requestCandidate: {
          method: "GET",
          path: "/v1/health",
          queryTemplate: "",
          fullUrlHint: "/v1/health",
          rationale: ["ast"],
        },
        matchedTypeFile: "C:\\repo\\service\\src\\main\\java\\HealthController.java",
        matchedRootAbs: "C:\\repo\\service",
        evidence: ["resolvedType=com.example.HealthController"],
        attemptedStrategies: ["java_ast_index_lookup", "java_ast_spring_mvc_resolver"],
        extensions: {
          contextPathHint: "/api/v1",
          ignoredNonBreakingField: "value",
        },
      }),
    },
  );

  assert.equal(result.status, "recipe");
  assert.equal(result.synthesizerUsed, "spring");
  assert.equal(result.requestCandidate.path, "/v1/health");
  assert.equal(result.evidence.includes("ast_context_path_hint=/api/v1"), true);
});

test("spring synthesizer surfaces AST resolver bootstrap failures distinctly", async () => {
  const result = await synthesizeSpringRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      searchRootsAbs: ["C:\\repo\\service"],
      classHint: "HealthController",
      methodHint: "health",
      intentMode: "regression_http_only",
    },
    {
      resolveRequestMappingFn: async () => ({
        status: "report",
        contractVersion: "0.1.0",
        reasonCode: "ast_resolver_unavailable",
        failedStep: "request_mapping_resolver_bootstrap",
        nextAction: "Build resolver JAR.",
        evidence: ["resolver_jar_missing=true"],
        attemptedStrategies: ["java_ast_resolver_bootstrap"],
      }),
    },
  );

  assert.equal(result.status, "report");
  assert.equal(result.reasonCode, "ast_resolver_unavailable");
  assert.equal(result.failedStep, "request_mapping_resolver_bootstrap");
});

test("spring synthesizer maps generic AST mapping failures to spring entrypoint failures", async () => {
  const result = await synthesizeSpringRecipe(
    {
      rootAbs: "C:\\repo\\service",
      workspaceRootAbs: "C:\\repo",
      searchRootsAbs: ["C:\\repo\\service"],
      classHint: "CatalogController",
      methodHint: "getCatalog",
      lineHint: 41,
      intentMode: "regression_plus_line_probe",
    },
    {
      resolveRequestMappingFn: async () => ({
        status: "report",
        contractVersion: "0.1.0",
        reasonCode: "request_mapping_not_proven",
        failedStep: "request_mapping_resolution",
        nextAction: "Refine hints.",
        evidence: ["resolvedType=com.example.CatalogController"],
        attemptedStrategies: ["java_ast_index_lookup", "java_ast_framework_resolution"],
      }),
    },
  );

  assert.equal(result.status, "report");
  assert.equal(result.reasonCode, "spring_entrypoint_not_proven");
  assert.equal(result.failedStep, "spring_entrypoint_resolution");
  assert.match(result.nextAction, /AST-backed request mapping resolution/);
});
