const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  projectContextValidateDomain,
} = require("@/tools/core/project_context_validate/domain");

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "project-context-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("project_context_validate succeeds for absolute existing project directory", async () => {
  await withTempDir(async (dir: string) => {
    await fs.writeFile(path.join(dir, "pom.xml"), "<project/>", "utf8");
    await fs.mkdir(path.join(dir, "src", "main", "java"), { recursive: true });

    const out = await projectContextValidateDomain({ projectRootAbs: dir });
    assert.equal(out.structuredContent.status, "ok");
    assert.equal(out.structuredContent.projectRootAbs, dir);
    assert.equal(out.structuredContent.hasBuildMarker, true);
    assert.equal(out.structuredContent.hasJavaSourceRoot, true);
  });
});

test("project_context_validate fails for non-absolute selector", async () => {
  const out = await projectContextValidateDomain({ projectRootAbs: "relative/path" });
  assert.equal(out.structuredContent.status, "project_selector_invalid");
  assert.equal(out.structuredContent.reason, "projectRootAbs must be absolute");
});

test("project_context_validate fails for non-existent selector", async () => {
  const out = await projectContextValidateDomain({
    projectRootAbs: "C:\\definitely\\missing\\project",
  });
  assert.equal(out.structuredContent.status, "project_selector_invalid");
  assert.equal(out.structuredContent.reason, "projectRootAbs does not exist");
});
