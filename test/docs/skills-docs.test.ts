const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_ROOT = path.join(REPO_ROOT, "skills");
const LINE_PROBE_SKILL = path.join(SKILLS_ROOT, "mcp-jvm-line-probe-run", "SKILL.md");
const REGRESSION_SKILL = path.join(SKILLS_ROOT, "mcp-jvm-regression-suite", "SKILL.md");
const RETIRED_SKILL = path.join(SKILLS_ROOT, "mcp-jvm-repro-orchestration", "SKILL.md");

test("retired repro skill is removed from repo skills", () => {
  assert.equal(fs.existsSync(RETIRED_SKILL), false);
});

test("new skills include mandatory MCP-first and Repro Steps contract", () => {
  for (const skillPath of [LINE_PROBE_SKILL, REGRESSION_SKILL]) {
    assert.equal(fs.existsSync(skillPath), true, `missing skill file: ${skillPath}`);
    const text = fs.readFileSync(skillPath, "utf8");
    assert.match(text, /toolchain_unavailable/);
    assert.match(text, /Repro Steps/);
    assert.match(text, /project_list/);
    assert.match(text, /probe_recipe_create/);
  }
});

