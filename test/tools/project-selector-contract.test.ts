const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { registerRecipeCreateTool } = require("@/tools/core/recipe_generate/handler");
const { registerTargetInferTool } = require("@/tools/core/target_infer/handler");

type RegisteredToolHandler = (input: Record<string, unknown>) => Promise<{
  structuredContent: Record<string, unknown>;
}>;

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
    }),
  );

  const out = await handler({
    projectRootAbs: "C:\\repo\\service",
    classHint: "CatalogService",
    methodHint: "save",
    intentMode: "regression_api_only",
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
      config: {},
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
    }),
  );

  const out = await handler({
    classHint: "CatalogService",
    methodHint: "save",
    intentMode: "regression_api_only",
  });

  assert.equal(out.structuredContent.status, "project_selector_required");
  assert.equal(out.structuredContent.projectRoot, "(project_root_unset)");
  assert.equal(out.structuredContent.resultType, "report");
});

test("probe_target_infer requires explicit projectRootAbs", async () => {
  const handler = captureRegisteredHandler((server: any) =>
    registerTargetInferTool(server, {
      config: {},
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
    }),
  );

  const out = await handler({
    projectRootAbs: path.resolve(__dirname, "..", ".."),
    classHint: "CatalogService",
    methodHint: "save",
    intentMode: "regression_api_only",
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

test("probe_target_infer ranked_candidates requires exact classHint", async () => {
  const handler = captureRegisteredHandler((server: any) =>
    registerTargetInferTool(server, {
      config: {},
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
        config: {},
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
  });
});
