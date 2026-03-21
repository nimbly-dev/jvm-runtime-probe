import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildLineKey,
  findLineNumberBySnippet,
  postAppProjectRootAbs,
  postControllerFqcn,
  postControllerSourceFileAbs,
  socialPlatformRootAbs,
  startMcpClient,
  startPostAppWithAgent,
} from "../support/spring/social-platform-post.fixture";

let runtime: Awaited<ReturnType<typeof startPostAppWithAgent>> | undefined;
let mcp: Awaited<ReturnType<typeof startMcpClient>> | undefined;

async function callTool(name: string, args: Record<string, unknown>) {
  if (!mcp) throw new Error("MCP client was not started");
  return (await mcp.client.callTool({
    name,
    arguments: args,
  })) as any;
}

async function executeUpdatePost(): Promise<any> {
  if (!runtime) throw new Error("post-app runtime was not started");
  const response = await fetch(`${runtime.apiBaseUrl}/api/v1/posts/101`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer alice-token",
      "x-run-as-tenant": "fixture-tenant",
      "x-run-as-user": "alice",
    },
    body: JSON.stringify({
      content: "Updated from the MCP integration test flow.",
      visibility: "PUBLIC",
      tags: ["fixture", "mcp"],
    }),
  });

  if (response.status !== 200) {
    assert.fail(await response.text());
  }
  return await response.json();
}

async function executeUpdatePostAs(args: { token: string; runAsUser: string; content: string }) {
  if (!runtime) throw new Error("post-app runtime was not started");
  return await fetch(`${runtime.apiBaseUrl}/api/v1/posts/101`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.token}`,
      "x-run-as-tenant": "fixture-tenant",
      "x-run-as-user": args.runAsUser,
    },
    body: JSON.stringify({
      content: args.content,
      visibility: "PUBLIC",
      tags: ["fixture", "mcp", "actuate"],
    }),
  });
}

const postServiceFqcn = "com.example.social.post.app.service.PostService";
const postServiceSourceAbs = path.join(
  postAppProjectRootAbs,
  "src",
  "main",
  "java",
  "com",
  "example",
  "social",
  "post",
  "app",
  "service",
  "PostService.java",
);

async function resolveFixtureActuationKey(): Promise<string> {
  const fixtureGateLine = await findLineNumberBySnippet(
    postServiceSourceAbs,
    "if (fixtureActuationGate) {",
  );
  return buildLineKey({
    fqcn: postServiceFqcn,
    methodName: "updatePost",
    line: fixtureGateLine,
  });
}

test.before(async () => {
  runtime = await startPostAppWithAgent();
  mcp = await startMcpClient({
    workspaceRootAbs: socialPlatformRootAbs,
    probeBaseUrl: runtime.probeBaseUrl,
  });
});

test.after(async () => {
  await mcp?.close();
  await runtime?.stop();
});

test("mcp IT: happy-path covers regression, probe status, capture, class inventory, and batch probe operations", async () => {
  if (!runtime) throw new Error("post-app runtime was not started");

  const debug = await callTool("debug_check", {});
  assert.equal(debug.structuredContent.ok, true);

  const project = await callTool("project_context_validate", {
    projectRootAbs: postAppProjectRootAbs,
  });
  assert.equal(project.structuredContent.status, "ok");
  assert.equal(project.structuredContent.hasBuildMarker, true);
  assert.equal(project.structuredContent.hasJavaSourceRoot, true);

  const publicRecipe = await callTool("probe_recipe_create", {
    projectRootAbs: postAppProjectRootAbs,
    classHint: postControllerFqcn,
    methodHint: "listPosts",
    intentMode: "regression_http_only",
  });
  assert.equal(publicRecipe.structuredContent.resultType, "recipe");
  assert.equal(publicRecipe.structuredContent.status, "regression_http_only_ready");
  assert.equal(publicRecipe.structuredContent.requestCandidates[0].method, "GET");
  assert.equal(publicRecipe.structuredContent.requestCandidates[0].path, "/api/v1/posts");

  const publicResponse = await fetch(`${runtime.apiBaseUrl}/api/v1/posts?page=0&size=2`);
  assert.equal(publicResponse.status, 200);
  const publicPayload = await publicResponse.json();
  assert.equal(Array.isArray(publicPayload.content), true);
  assert.equal(publicPayload.content.length > 0, true);

  const check = await callTool("probe_check", {
    baseUrl: runtime.probeBaseUrl,
    timeoutMs: 5_000,
  });
  assert.equal(check.structuredContent.checks.reset.ok, true);
  assert.equal(check.structuredContent.checks.status.ok, true);
  assert.equal(check.structuredContent.checks.status.keyDecodingOk, true);

  const classMethods = await callTool("probe_target_infer", {
    projectRootAbs: postAppProjectRootAbs,
    discoveryMode: "class_methods",
    classHint: postControllerFqcn,
  });
  assert.equal(classMethods.structuredContent.resultType, "class_methods");
  assert.equal(classMethods.structuredContent.status, "ok");
  const updateMethod = classMethods.structuredContent.methods.find(
    (method: any) => method.methodName === "updatePost",
  );
  assert.ok(updateMethod);
  assert.equal(updateMethod.lineSelectionStatus, "validated");
  assert.equal(typeof updateMethod.firstExecutableLine, "number");
  assert.equal(updateMethod.firstExecutableLine > updateMethod.startLine, true);

  const inferred = await callTool("probe_target_infer", {
    projectRootAbs: postAppProjectRootAbs,
    classHint: postControllerFqcn,
    methodHint: "updatePost",
  });
  assert.equal(inferred.structuredContent.status, "ok");
  assert.equal(inferred.structuredContent.resultType, "ranked_candidates");
  assert.equal(inferred.structuredContent.candidates.length, 1);

  const candidate = inferred.structuredContent.candidates[0];
  assert.equal(candidate.lineSelectionStatus, "validated");
  assert.equal(typeof candidate.line, "number");
  const key = buildLineKey({
    fqcn: candidate.fqcn,
    methodName: candidate.methodName,
    line: candidate.line,
  });

  const recipe = await callTool("probe_recipe_create", {
    projectRootAbs: postAppProjectRootAbs,
    classHint: postControllerFqcn,
    methodHint: "updatePost",
    lineHint: candidate.line,
    intentMode: "regression_plus_line_probe",
    authToken: "alice-token",
  });
  assert.equal(recipe.structuredContent.resultType, "recipe");
  assert.equal(recipe.structuredContent.status, "regression_plus_line_probe_ready");
  assert.equal(recipe.structuredContent.synthesizerUsed, "spring");
  assert.equal(recipe.structuredContent.auth.status, "not_required");
  assert.equal(recipe.structuredContent.requestCandidates[0].method, "PUT");
  assert.equal(recipe.structuredContent.requestCandidates[0].path, "/api/v1/posts/1");
  assert.equal(recipe.structuredContent.trigger.path, "/api/v1/posts/1");

  const observe = await callTool("probe_enable", {
    baseUrl: runtime.probeBaseUrl,
    mode: "observe",
    actuatorId: "social-platform-it",
  });
  assert.equal(observe.structuredContent.response.status, 200);
  assert.equal(observe.structuredContent.response.json.mode, "observe");

  await callTool("probe_reset", {
    key,
    baseUrl: runtime.probeBaseUrl,
  });

  const resetBatch = await callTool("probe_reset", {
    keys: [key, `${candidate.fqcn}#${candidate.methodName}`],
    baseUrl: runtime.probeBaseUrl,
  });
  assert.equal(resetBatch.structuredContent.mode, "probe_batch");
  assert.equal(resetBatch.structuredContent.operation, "reset");
  assert.equal(resetBatch.structuredContent.summary.total, 2);
  assert.equal(resetBatch.structuredContent.summary.failed, 1);

  const updated = await executeUpdatePost();
  assert.equal(updated.id, 101);
  assert.equal(updated.authorUsername, "alice");

  const waited = await callTool("probe_wait_for_hit", {
    key,
    baseUrl: runtime.probeBaseUrl,
    timeoutMs: 10_000,
    pollIntervalMs: 250,
    maxRetries: 2,
  });
  assert.equal(waited.structuredContent.result.hit, true);
  assert.equal(waited.structuredContent.result.inline, true);

  const statusBatch = await callTool("probe_get_status", {
    keys: [key, `${candidate.fqcn}#${candidate.methodName}`],
    baseUrl: runtime.probeBaseUrl,
  });
  assert.equal(statusBatch.structuredContent.mode, "probe_batch");
  assert.equal(statusBatch.structuredContent.operation, "status");
  assert.equal(statusBatch.structuredContent.summary.total, 2);
  assert.equal(statusBatch.structuredContent.summary.ok, 1);
  assert.equal(statusBatch.structuredContent.summary.failed, 1);

  const status = await callTool("probe_get_status", {
    key,
    baseUrl: runtime.probeBaseUrl,
  });
  assert.equal(status.structuredContent.response.json.lineValidation, "resolvable");
  assert.equal(status.structuredContent.response.json.hitCount >= 1, true);
  assert.equal(status.structuredContent.response.json.capturePreview.available, true);
  const captureId = status.structuredContent.response.json.capturePreview.captureId;
  assert.equal(typeof captureId, "string");

  const capture = await callTool("probe_get_capture", {
    captureId,
    baseUrl: runtime.probeBaseUrl,
  });
  assert.equal(capture.structuredContent.result.found, true);
  assert.equal(capture.structuredContent.result.capture.captureId, captureId);
  assert.equal(capture.structuredContent.result.capture.argsCount >= 1, true);
  assert.equal(capture.structuredContent.result.capture.hasReturnValue, true);

  const resetClass = await callTool("probe_reset", {
    className: postControllerFqcn,
    baseUrl: runtime.probeBaseUrl,
  });
  assert.equal(resetClass.structuredContent.mode, "probe_batch");
  assert.equal(resetClass.structuredContent.operation, "reset");
  assert.equal(resetClass.structuredContent.summary.total >= 1, true);
});

test("mcp IT: actuate forces deterministic fixture branch outcomes for the same update request", async () => {
  if (!runtime) throw new Error("post-app runtime was not started");

  const key = await resolveFixtureActuationKey();

  await callTool("probe_enable", {
    baseUrl: runtime.probeBaseUrl,
    mode: "observe",
    actuatorId: "social-platform-it",
  });

  try {
    await callTool("probe_enable", {
      baseUrl: runtime.probeBaseUrl,
      mode: "actuate",
      targetKey: key,
      returnBoolean: false,
      actuatorId: "social-platform-it",
    });
    await callTool("probe_reset", {
      key,
      baseUrl: runtime.probeBaseUrl,
    });

    const deniedResponse = await executeUpdatePostAs({
      token: "alice-token",
      runAsUser: "alice",
      content: "Fixture actuation gate forced fallthrough.",
    });
    assert.equal(deniedResponse.status, 409);
    const deniedText = await deniedResponse.text();
    assert.match(deniedText, /"status"\s*:\s*409/i);

    const deniedWait = await callTool("probe_wait_for_hit", {
      key,
      baseUrl: runtime.probeBaseUrl,
      timeoutMs: 10_000,
      pollIntervalMs: 250,
      maxRetries: 2,
    });
    assert.equal(deniedWait.structuredContent.result.hit, true);

    await callTool("probe_enable", {
      baseUrl: runtime.probeBaseUrl,
      mode: "actuate",
      targetKey: key,
      returnBoolean: true,
      actuatorId: "social-platform-it",
    });
    await callTool("probe_reset", {
      key,
      baseUrl: runtime.probeBaseUrl,
    });

    const allowedResponse = await executeUpdatePostAs({
      token: "alice-token",
      runAsUser: "alice",
      content: "Fixture actuation gate forced taken-jump.",
    });
    if (allowedResponse.status !== 200) {
      assert.fail(await allowedResponse.text());
    }
    const allowedPayload = await allowedResponse.json();
    assert.equal(allowedPayload.id, 101);
    assert.equal(allowedPayload.authorUsername, "alice");

    const allowedWait = await callTool("probe_wait_for_hit", {
      key,
      baseUrl: runtime.probeBaseUrl,
      timeoutMs: 10_000,
      pollIntervalMs: 250,
      maxRetries: 2,
    });
    assert.equal(allowedWait.structuredContent.result.hit, true);
    assert.equal(allowedWait.structuredContent.result.inline, true);
  } finally {
    await callTool("probe_enable", {
      baseUrl: runtime.probeBaseUrl,
      mode: "observe",
      actuatorId: "social-platform-it",
    });
  }
});

test("mcp IT: actuate with unresolved strict line target fails closed during reset/wait and returns to observe", async () => {
  if (!runtime) throw new Error("post-app runtime was not started");

  const declarationLine = await findLineNumberBySnippet(
    postControllerSourceFileAbs,
    "public PostDetailResponse updatePost(",
  );
  const invalidLineKey = buildLineKey({
    fqcn: postControllerFqcn,
    methodName: "updatePost",
    line: declarationLine,
  });

  await callTool("probe_enable", {
    baseUrl: runtime.probeBaseUrl,
    mode: "actuate",
    targetKey: invalidLineKey,
    returnBoolean: true,
    actuatorId: "social-platform-it",
  });

  const invalidReset = await callTool("probe_reset", {
    key: invalidLineKey,
    baseUrl: runtime.probeBaseUrl,
  });
  assert.equal(invalidReset.structuredContent.result.reason, "invalid_line_target");

  const invalidWait = await callTool("probe_wait_for_hit", {
    key: invalidLineKey,
    baseUrl: runtime.probeBaseUrl,
    timeoutMs: 2_000,
    pollIntervalMs: 200,
    maxRetries: 1,
  });
  assert.equal(invalidWait.structuredContent.result.reason, "invalid_line_target");
  assert.equal(invalidWait.structuredContent.result.actionCode, "runtime_not_aligned");

  await callTool("probe_enable", {
    baseUrl: runtime.probeBaseUrl,
    mode: "observe",
    actuatorId: "social-platform-it",
  });

  const check = await callTool("probe_check", {
    baseUrl: runtime.probeBaseUrl,
    timeoutMs: 5_000,
  });
  assert.equal(check.structuredContent.checks.status.json.runtime.mode, "observe");
});

test("mcp IT: actuate without returnBoolean keeps default false branch decision", async () => {
  if (!runtime) throw new Error("post-app runtime was not started");

  const key = await resolveFixtureActuationKey();

  await callTool("probe_enable", {
    baseUrl: runtime.probeBaseUrl,
    mode: "observe",
    actuatorId: "social-platform-it",
  });

  const armed = await callTool("probe_enable", {
    baseUrl: runtime.probeBaseUrl,
    mode: "actuate",
    targetKey: key,
    actuatorId: "social-platform-it",
  });
  assert.equal(armed.structuredContent.response.status, 200);
  assert.equal(armed.structuredContent.response.json.returnBoolean, false);

  await callTool("probe_reset", {
    key,
    baseUrl: runtime.probeBaseUrl,
  });
  const response = await executeUpdatePostAs({
    token: "alice-token",
    runAsUser: "alice",
    content: "Actuate without explicit returnBoolean.",
  });
  assert.equal(response.status, 409);

  await callTool("probe_enable", {
    baseUrl: runtime.probeBaseUrl,
    mode: "observe",
    actuatorId: "social-platform-it",
  });
});

test("mcp IT: fail-closed paths cover invalid project roots, bad recipe hints, invalid strict lines, and invalid actuation keys", async () => {
  if (!runtime) throw new Error("post-app runtime was not started");

  const invalidProject = await callTool("project_context_validate", {
    projectRootAbs: path.join(postAppProjectRootAbs, "missing-project"),
  });
  assert.equal(invalidProject.structuredContent.status, "project_selector_invalid");
  assert.equal(invalidProject.structuredContent.reason, "projectRootAbs does not exist");

  const invalidRecipe = await callTool("probe_recipe_create", {
    projectRootAbs: postAppProjectRootAbs,
    classHint: "PostController",
    methodHint: "updatePost",
    intentMode: "regression_http_only",
  });
  assert.equal(invalidRecipe.structuredContent.status, "class_hint_not_fqcn");
  assert.equal(invalidRecipe.structuredContent.reasonCode, "class_hint_not_fqcn");

  const declarationLine = await findLineNumberBySnippet(
    postControllerSourceFileAbs,
    "public PostDetailResponse updatePost(",
  );
  const invalidLineKey = buildLineKey({
    fqcn: postControllerFqcn,
    methodName: "updatePost",
    line: declarationLine,
  });

  const invalidStatus = await callTool("probe_get_status", {
    key: invalidLineKey,
    baseUrl: runtime.probeBaseUrl,
  });
  assert.equal(invalidStatus.structuredContent.response.json.lineValidation, "invalid_line_target");
  assert.equal(invalidStatus.structuredContent.result.reason, "invalid_line_target");

  const invalidWait = await callTool("probe_wait_for_hit", {
    key: invalidLineKey,
    baseUrl: runtime.probeBaseUrl,
    timeoutMs: 2_000,
    pollIntervalMs: 200,
    maxRetries: 1,
  });
  assert.equal(invalidWait.structuredContent.result.reason, "invalid_line_target");
  assert.equal(invalidWait.structuredContent.result.actionCode, "runtime_not_aligned");

  const invalidEnable = await callTool("probe_enable", {
    baseUrl: runtime.probeBaseUrl,
    mode: "actuate",
    targetKey: `${postControllerFqcn}#updatePost`,
    returnBoolean: true,
  });
  assert.equal(invalidEnable.structuredContent.result.actuated, false);
  assert.equal(invalidEnable.structuredContent.result.reason, "line_key_required");

  const missingCapture = await callTool("probe_get_capture", {
    captureId: "missing-capture-id",
    baseUrl: runtime.probeBaseUrl,
  });
  assert.equal(missingCapture.structuredContent.result.found, false);
  assert.equal(missingCapture.structuredContent.result.reason, "capture_not_found");
});
