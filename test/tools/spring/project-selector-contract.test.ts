const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { registerRecipeCreateTool } = require("@/tools/core/recipe_generate/handler");
const { registerTargetInferTool } = require("@/tools/core/target_infer/handler");
const recipeGenerateDomain = require("@/tools/core/recipe_generate/domain");

type RegisteredToolHandler = (input: Record<string, unknown>) => Promise<{
  structuredContent: Record<string, unknown>;
}>;

const TARGET_INFER_CONFIG = {
  workspaceRootAbs: "C:\\repo",
  workspaceRootSource: "cwd",
  probeBaseUrl: "http://127.0.0.1:9193",
  probeStatusPath: "/__probe/status",
  probeResetPath: "/__probe/reset",
  probeCapturePath: "/__probe/capture",
  probeLineSelectionMaxScanLines: 120,
  probeWaitMaxRetries: 1,
  probeWaitUnreachableRetryEnabled: false,
  probeWaitUnreachableMaxRetries: 3,
};

async function withMockedFetch(
  mockFetch: typeof globalThis.fetch,
  fn: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  if (!originalFetch) throw new Error("global fetch is unavailable in this Node runtime");
  globalThis.fetch = mockFetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function captureRegisteredHandler(
  registerToolFn: (server: any) => void,
): RegisteredToolHandler {
  let captured: RegisteredToolHandler | undefined;
  const server: any = {
    registerTool: (_name: unknown, _meta: unknown, handler: RegisteredToolHandler) => {
      captured = handler;
    },
  };
  registerToolFn(server);
  assert.equal(typeof captured, "function", "expected tool handler to be registered");
  return captured as RegisteredToolHandler;
}

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "target-infer-contract-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("probe_recipe_create fails closed when legacy selector fields are provided", async () => {
  const handler = captureRegisteredHandler((server: any) =>
    registerRecipeCreateTool(server, {
      probeBaseUrl: "http://127.0.0.1:9193",
      probeStatusPath: "/__probe/status",
      workspaceRootAbs: "C:\\repo",
    }),
  );

  const out = await handler({
    projectRootAbs: "C:\\repo\\service",
    classHint: "CatalogService",
    methodHint: "save",
    intentMode: "regression_http_only",
    workspaceRoot: "C:\\repo",
  });

  assert.equal(out.structuredContent.status, "project_selector_invalid");
  assert.equal(out.structuredContent.resultType, "report");
  assert.equal(out.structuredContent.projectRoot, "C:\\repo\\service");
  assert.equal(out.structuredContent.failedStep, "input_validation");
  assert.equal(Array.isArray(out.structuredContent.attemptedStrategies), true);
  assert.match(out.structuredContent.reason, /workspaceRoot/);
});

test("probe_target_infer fails closed when legacy selector fields are provided", async () => {
  const handler = captureRegisteredHandler((server: any) =>
    registerTargetInferTool(server, {
      config: TARGET_INFER_CONFIG,
    }),
  );

  const out = await handler({
    projectRootAbs: "C:\\repo\\service",
    classHint: "CatalogService",
    methodHint: "save",
    workspaceRoot: "C:\\repo",
  });

  assert.equal(out.structuredContent.status, "project_selector_invalid");
  assert.equal(out.structuredContent.resultType, "report");
  assert.match(out.structuredContent.reason, /workspaceRoot/);
});

test("probe_recipe_create requires explicit projectRootAbs", async () => {
  const handler = captureRegisteredHandler((server: any) =>
    registerRecipeCreateTool(server, {
      probeBaseUrl: "http://127.0.0.1:9193",
      probeStatusPath: "/__probe/status",
      workspaceRootAbs: "C:\\repo",
    }),
  );

  const out = await handler({
    classHint: "CatalogService",
    methodHint: "save",
    intentMode: "regression_http_only",
  });

  assert.equal(out.structuredContent.status, "project_selector_required");
  assert.equal(out.structuredContent.projectRoot, "(project_root_unset)");
  assert.equal(out.structuredContent.resultType, "report");
});

test("probe_target_infer requires explicit projectRootAbs", async () => {
  const handler = captureRegisteredHandler((server: any) =>
    registerTargetInferTool(server, {
      config: TARGET_INFER_CONFIG,
    }),
  );

  const out = await handler({
    classHint: "CatalogService",
    methodHint: "save",
  });

  assert.equal(out.structuredContent.status, "project_selector_required");
});

test("probe_recipe_create fails closed when classHint is not an FQCN", async () => {
  const handler = captureRegisteredHandler((server: any) =>
    registerRecipeCreateTool(server, {
      probeBaseUrl: "http://127.0.0.1:9193",
      probeStatusPath: "/__probe/status",
      workspaceRootAbs: "C:\\repo",
    }),
  );

  const out = await handler({
    projectRootAbs: path.resolve(__dirname, "..", ".."),
    classHint: "CatalogService",
    methodHint: "save",
    intentMode: "regression_http_only",
  });

  assert.equal(out.structuredContent.status, "class_hint_not_fqcn");
  assert.equal(out.structuredContent.projectRoot, path.resolve(__dirname, "..", ".."));
  assert.equal(typeof out.structuredContent.hints, "object");
  assert.equal(out.structuredContent.reasonCode, "class_hint_not_fqcn");
  assert.equal(out.structuredContent.failedStep, "input_validation");
  assert.equal(Array.isArray(out.structuredContent.evidence), true);
  assert.equal(Array.isArray(out.structuredContent.attemptedStrategies), true);
  assert.match(out.structuredContent.nextAction, /Provide exact FQCN/i);
});

test("probe_recipe_create passes configured workspace root into generateRecipe", async () => {
  await withTempDir(async (dir: string) => {
    const workspaceRootAbs = path.join(dir, "..", "workspace-root");
    let capturedArgs: Record<string, unknown> | undefined;
    const originalGenerateRecipe = recipeGenerateDomain.generateRecipe;
    recipeGenerateDomain.generateRecipe = async (args: Record<string, unknown>) => {
      capturedArgs = args;
      return {
        requestCandidates: [],
        executionPlan: {
          selectedMode: "regression_http_only",
          routingReason: "regression_http_only_no_probe",
          steps: [],
          probeCallPlan: {
            total: 0,
            verificationMethod: "probe_wait_for_hit",
            actuated: false,
            byTool: {
              probe_reset: 0,
              probe_wait_for_hit: 0,
              probe_get_status: 0,
              probe_enable: 0,
            },
          },
        },
        resultType: "report",
        status: "api_request_not_inferred",
        selectedMode: "regression_http_only",
        lineTargetProvided: false,
        probeIntentRequested: false,
        executionReadiness: "needs_user_input",
        missingInputs: [],
        attemptedStrategies: [],
        evidence: [],
        inferenceDiagnostics: {
          target: { attempted: true, matched: false, candidateCount: 0 },
          request: { attempted: true, matched: false },
        },
        auth: {
          required: "unknown",
          status: "unknown",
          strategy: "unknown",
          nextAction: "none",
          notes: [],
        },
        notes: [],
      };
    };

    try {
      const handler = captureRegisteredHandler((server: any) =>
        registerRecipeCreateTool(server, {
          probeBaseUrl: "http://127.0.0.1:9193",
          probeStatusPath: "/__probe/status",
          workspaceRootAbs,
        }),
      );

      await handler({
        projectRootAbs: dir,
        classHint: "com.example.CatalogController",
        methodHint: "listCatalogShoes",
        intentMode: "regression_http_only",
      });
    } finally {
      recipeGenerateDomain.generateRecipe = originalGenerateRecipe;
    }

    assert.equal(capturedArgs?.rootAbs, dir);
    assert.equal(capturedArgs?.workspaceRootAbs, workspaceRootAbs);
  });
});

test("probe_target_infer ranked_candidates requires exact classHint", async () => {
  const handler = captureRegisteredHandler((server: any) =>
    registerTargetInferTool(server, {
      config: TARGET_INFER_CONFIG,
    }),
  );

  const out = await handler({
    projectRootAbs: path.resolve(__dirname, "..", ".."),
    methodHint: "save",
  });

  assert.equal(out.structuredContent.resultType, "report");
  assert.equal(out.structuredContent.status, "class_hint_required");
  assert.equal(out.structuredContent.failedStep, "input_validation");
});

test("probe_target_infer ranked success emits explicit resultType and status", async () => {
  await withTempDir(async (dir: string) => {
    const handler = captureRegisteredHandler((server: any) =>
      registerTargetInferTool(server, {
        config: TARGET_INFER_CONFIG,
      }),
    );
    const javaFile = path.join(dir, "src", "main", "java", "com", "example", "CatalogService.java");
    await fs.mkdir(path.dirname(javaFile), { recursive: true });
    await fs.writeFile(
      javaFile,
      [
        "package com.example;",
        "public class CatalogService {",
        "  public boolean save() {",
        "    return true;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    let calls = 0;
    await withMockedFetch(async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          key: "com.example.CatalogService#save:3",
          hitCount: 0,
          lastHitEpoch: 0,
          lineResolvable: calls === 1 ? false : true,
          lineValidation: calls === 1 ? "invalid_line_target" : "resolvable",
        }),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }, async () => {
      const out = await handler({
        projectRootAbs: dir,
        classHint: "com.example.CatalogService",
        methodHint: "save",
      });

      assert.equal(out.structuredContent.resultType, "ranked_candidates");
      assert.equal(out.structuredContent.status, "ok");
      const candidates = out.structuredContent.candidates as unknown[];
      assert.equal(Array.isArray(candidates), true);
      assert.equal(candidates.length, 1);
      assert.equal((candidates[0] as any).firstExecutableLine, 4);
      assert.equal((candidates[0] as any).lineSelectionStatus, "validated");
      assert.equal((candidates[0] as any).lineSelectionSource, "runtime_probe_validation");
    });
  });
});

test("probe_target_infer fails closed when runtime probe is unreachable", async () => {
  await withTempDir(async (dir: string) => {
    const handler = captureRegisteredHandler((server: any) =>
      registerTargetInferTool(server, {
        config: TARGET_INFER_CONFIG,
      }),
    );
    const javaFile = path.join(dir, "src", "main", "java", "com", "example", "CatalogService.java");
    await fs.mkdir(path.dirname(javaFile), { recursive: true });
    await fs.writeFile(
      javaFile,
      [
        "package com.example;",
        "public class CatalogService {",
        "  public boolean save() {",
        "    return true;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await withMockedFetch(async () => {
      throw new Error("fetch failed");
    }, async () => {
      const out = await handler({
        projectRootAbs: dir,
        classHint: "com.example.CatalogService",
        methodHint: "save",
      });

      assert.equal(out.structuredContent.resultType, "report");
      assert.equal(out.structuredContent.status, "runtime_unreachable");
      assert.equal(out.structuredContent.reasonCode, "runtime_unreachable");
      assert.equal(out.structuredContent.failedStep, "line_validation");
    });
  });
});

test("probe_target_infer class_methods returns unresolved line selection when no line is resolvable", async () => {
  await withTempDir(async (dir: string) => {
    const handler = captureRegisteredHandler((server: any) =>
      registerTargetInferTool(server, {
        config: TARGET_INFER_CONFIG,
      }),
    );
    const javaFile = path.join(
      dir,
      "src",
      "main",
      "java",
      "com",
      "example",
      "CatalogService.java",
    );
    await fs.mkdir(path.dirname(javaFile), { recursive: true });
    await fs.writeFile(
      javaFile,
      [
        "package com.example;",
        "public class CatalogService {",
        "  public boolean save() {",
        "    return true;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await withMockedFetch(async () => {
      return new Response(
        JSON.stringify({
          key: "com.example.CatalogService#save:3",
          hitCount: 0,
          lastHitEpoch: 0,
          lineResolvable: false,
          lineValidation: "invalid_line_target",
        }),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }, async () => {
      const out = await handler({
        projectRootAbs: dir,
        discoveryMode: "class_methods",
        classHint: "com.example.CatalogService",
      });

      assert.equal(out.structuredContent.resultType, "class_methods");
      assert.equal(out.structuredContent.status, "ok");
      const methods = out.structuredContent.methods as Array<Record<string, unknown>>;
      assert.equal(Array.isArray(methods), true);
      assert.equal(methods.length, 1);
      assert.equal(methods[0]?.firstExecutableLine, null);
      assert.equal(methods[0]?.lineSelectionStatus, "unresolved");
      assert.equal(methods[0]?.lineSelectionSource, undefined);
    });
  });
});
