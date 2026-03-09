const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { synthesizeSpringRecipe } = require("../../src/utils/synthesizers/spring/synthesis.util");

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spring-synthesizer-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("spring synthesizer builds deterministic request candidate from annotations", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "pom.xml"),
      "<project><artifactId>demo</artifactId><dependencies><dependency><groupId>org.springframework</groupId></dependency></dependencies></project>",
      "utf8",
    );
    const javaFile = path.join(dir, "src", "main", "java", "com", "example", "HealthController.java");
    await fs.mkdir(path.dirname(javaFile), { recursive: true });
    await fs.writeFile(
      javaFile,
      [
        "package com.example;",
        "import org.springframework.web.bind.annotation.GetMapping;",
        "import org.springframework.web.bind.annotation.RequestMapping;",
        "import org.springframework.web.bind.annotation.RestController;",
        "@RestController",
        '@RequestMapping("/v1/health")',
        "public class HealthController {",
        "  @GetMapping",
        "  public String health() { return \"ok\"; }",
        "}",
      ].join("\n"),
      "utf8",
    );

    const result = await synthesizeSpringRecipe({
      rootAbs: dir,
      workspaceRootAbs: dir,
      searchRootsAbs: [dir],
      classHint: "HealthController",
      methodHint: "health",
      intentMode: "regression_api_only",
    });

    assert.equal(result.status, "recipe");
    assert.equal(result.synthesizerUsed, "spring");
    assert.equal(result.requestCandidate.method, "GET");
    assert.equal(result.trigger.kind, "http");
  });
});

test("spring synthesizer fails closed when entrypoint is not proven", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "pom.xml"),
      "<project><artifactId>demo</artifactId><dependencies><dependency><groupId>org.springframework</groupId></dependency></dependencies></project>",
      "utf8",
    );
    const javaFile = path.join(dir, "src", "main", "java", "com", "example", "ServiceOnly.java");
    await fs.mkdir(path.dirname(javaFile), { recursive: true });
    await fs.writeFile(
      javaFile,
      [
        "package com.example;",
        "public class ServiceOnly {",
        "  public boolean finalPriceLte() { return true; }",
        "}",
      ].join("\n"),
      "utf8",
    );

    const result = await synthesizeSpringRecipe({
      rootAbs: dir,
      workspaceRootAbs: dir,
      searchRootsAbs: [dir],
      classHint: "ServiceOnly",
      methodHint: "finalPriceLte",
      intentMode: "single_line_probe",
      lineHint: 12,
    });

    assert.equal(result.status, "report");
    assert.equal(result.reasonCode, "spring_entrypoint_not_proven");
    assert.equal(result.failedStep, "spring_entrypoint_resolution");
  });
});
