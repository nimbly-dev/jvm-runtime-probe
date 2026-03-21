import assert from "node:assert/strict";
import test from "node:test";

import { probeCaptureGet, probeReset, probeStatus, probeWaitHit } from "@/tools/core/probe/domain";
import {
  buildLineKey,
  findLineNumberBySnippet,
  postControllerFqcn,
  postControllerSourceFileAbs,
  startPostAppWithAgent,
} from "../support/spring/social-platform-post.fixture";

let runtime: Awaited<ReturnType<typeof startPostAppWithAgent>> | undefined;

test.before(async () => {
  runtime = await startPostAppWithAgent();
});

test.after(async () => {
  await runtime?.stop();
});

test("java-agent IT: protected createPost route hits strict controller line", async () => {
  if (!runtime) throw new Error("post-app runtime was not started");

  const line = await findLineNumberBySnippet(
    postControllerSourceFileAbs,
    "return postService.createPost(request, authentication.getName());",
  );
  const key = buildLineKey({
    fqcn: postControllerFqcn,
    methodName: "createPost",
    line,
  });

  await probeReset({
    key,
    baseUrl: runtime.probeBaseUrl,
    resetPath: "/__probe/reset",
  });

  const response = await fetch(`${runtime.apiBaseUrl}/api/v1/posts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer alice-token",
      "x-run-as-tenant": "fixture-tenant",
      "x-run-as-user": "alice",
    },
    body: JSON.stringify({
      content: "Creating a probe-backed fixture post.",
      visibility: "PUBLIC",
      tags: ["fixture", "probe"],
    }),
  });

  if (response.status !== 201) {
    assert.fail(await response.text());
  }
  const created = await response.json();
  assert.equal(created.authorUsername, "alice");
  assert.equal(created.visibility, "PUBLIC");

  const wait = await probeWaitHit({
    key,
    baseUrl: runtime.probeBaseUrl,
    statusPath: "/__probe/status",
    timeoutMs: 10_000,
    pollIntervalMs: 250,
    maxRetries: 2,
  });
  const waitStructured = wait.structuredContent as any;
  assert.equal(waitStructured.result.hit, true);
  assert.equal(waitStructured.result.inline, true);

  const status = await probeStatus({
    key,
    baseUrl: runtime.probeBaseUrl,
    statusPath: "/__probe/status",
  });
  const statusStructured = status.structuredContent as any;
  assert.equal(statusStructured.response.json.lineValidation, "resolvable");
  assert.equal(statusStructured.response.json.hitCount >= 1, true);

  const capturePreview = statusStructured.response.json.capturePreview;
  assert.equal(capturePreview?.available, true);
  assert.equal(typeof capturePreview?.captureId, "string");

  const capture = await probeCaptureGet({
    captureId: capturePreview.captureId,
    baseUrl: runtime.probeBaseUrl,
    capturePath: "/__probe/capture",
  });
  const captureStructured = capture.structuredContent as any;
  assert.equal(captureStructured.result.found, true);
  assert.equal(captureStructured.result.capture.captureId, capturePreview.captureId);
  assert.equal(captureStructured.result.capture.argsCount >= 1, true);
  assert.equal(captureStructured.result.capture.hasReturnValue, true);
});

test("java-agent IT: declaration-line strict key fails closed as invalid_line_target", async () => {
  if (!runtime) throw new Error("post-app runtime was not started");

  const declarationLine = await findLineNumberBySnippet(
    postControllerSourceFileAbs,
    "public PostDetailResponse updatePost(",
  );
  const invalidKey = buildLineKey({
    fqcn: postControllerFqcn,
    methodName: "updatePost",
    line: declarationLine,
  });

  const status = await probeStatus({
    key: invalidKey,
    baseUrl: runtime.probeBaseUrl,
    statusPath: "/__probe/status",
  });
  const statusStructured = status.structuredContent as any;
  assert.equal(statusStructured.response.json.lineValidation, "invalid_line_target");
  assert.equal(statusStructured.result.reason, "invalid_line_target");

  const waited = await probeWaitHit({
    key: invalidKey,
    baseUrl: runtime.probeBaseUrl,
    statusPath: "/__probe/status",
    timeoutMs: 2_000,
    pollIntervalMs: 200,
    maxRetries: 1,
  });
  const waitedStructured = waited.structuredContent as any;
  assert.equal(waitedStructured.result.reason, "invalid_line_target");
  assert.equal(waitedStructured.result.actionCode, "runtime_not_aligned");
});

test("java-agent IT: actuate endpoint rejects unauthorized requests when token is configured", async () => {
  const securedRuntime = await startPostAppWithAgent({ actuateAuthToken: "fixture-actuate-secret" });
  try {
    const unauthorized = await fetch(`${securedRuntime.probeBaseUrl}/__probe/actuate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "actuate",
        targetKey: "com.example.social.post.app.service.PostService#updatePost:1",
        returnBoolean: true,
      }),
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${securedRuntime.probeBaseUrl}/__probe/actuate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer fixture-actuate-secret",
      },
      body: JSON.stringify({
        mode: "observe",
      }),
    });
    assert.equal(authorized.status, 200);
  } finally {
    await securedRuntime.stop();
  }
});
