const assert = require("node:assert/strict");
const test = require("node:test");

const { registerRecipeCreateTool } = require("../../src/tools/core/recipe_generate/handler");
const { registerTargetInferTool } = require("../../src/tools/core/target_infer/handler");

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
