const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MODELS_ROOT = path.join(REPO_ROOT, "src", "models");

function walkTsFiles(rootDir: string): string[] {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.isFile() && abs.endsWith(".ts")) out.push(abs);
    }
  }
  return out;
}

test("models layer does not import from non-model local modules", () => {
  const modelFiles = walkTsFiles(MODELS_ROOT);
  for (const fileAbs of modelFiles) {
    const text = fs.readFileSync(fileAbs, "utf8");
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const specifier of imports) {
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(fileAbs), specifier);
      const normalized = path.normalize(resolved);
      assert.equal(
        normalized.startsWith(path.normalize(MODELS_ROOT)),
        true,
        `Model import boundary violated: ${fileAbs} imports ${specifier}`,
      );
    }
  }
});
