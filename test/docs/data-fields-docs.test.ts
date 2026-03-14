const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_PATH = path.join(REPO_ROOT, "src", "server.ts");
const DOC_PATH = path.join(REPO_ROOT, "docs", "data-fields", "README.md");

function readRegisteredTools() {
  const source = fs.readFileSync(SERVER_PATH, "utf8");
  const matches = [...source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)];
  return matches.map((m) => m[1]);
}

test("docs/data-fields/README.md includes section for every registered tool", () => {
  const doc = fs.readFileSync(DOC_PATH, "utf8");
  const tools = readRegisteredTools();
  for (const tool of tools) {
    assert.match(doc, new RegExp(`##\\s+${tool}(?:\\r?\\n|$)`));
  }
});

test("data-fields tables include boolean required column values", () => {
  const doc = fs.readFileSync(DOC_PATH, "utf8");
  const lines = doc.split(/\r?\n/);
  let rowsChecked = 0;
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    if (/^\|\s*---/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell: string) => cell.trim());
    if (cells.length < 5) continue;
    if (cells[0] === "fieldName") continue;
    const required = cells[3];
    assert.match(required, /^(true|false)$/);
    rowsChecked += 1;
  }
  assert.ok(rowsChecked > 0, "expected at least one documented data row");
});

test("data-fields docs reflect deterministic contract without confidence/downgrade fields", () => {
  const doc = fs.readFileSync(DOC_PATH, "utf8");
  assert.doesNotMatch(doc, /applicationType\.confidence/);
  assert.doesNotMatch(doc, /appPort\.confidence/);
  assert.doesNotMatch(doc, /downgradedFrom/);
  assert.doesNotMatch(doc, /regression_http_only_downgraded_line_target_missing/);
  assert.match(doc, /deterministic fields/i);
  assert.match(doc, /hints\.apiBasePath/);
  assert.match(doc, /context_path_hint=/);
});
