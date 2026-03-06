const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { findControllerRequestCandidate } = require("../../src/utils/recipe_candidate_infer.util");

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recipe-candidate-infer-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("infers Spring MVC declaration fallback for methodHint-only search", async () => {
  await withTempDir(async (dir: string) => {
    const javaFile = path.join(dir, "src", "main", "java", "SynonymRuleController.java");
    await fs.mkdir(path.dirname(javaFile), { recursive: true });
    await fs.writeFile(
      javaFile,
      [
        "package com.example;",
        "",
        "import org.springframework.web.bind.annotation.PathVariable;",
        "import org.springframework.web.bind.annotation.PostMapping;",
        "import org.springframework.web.bind.annotation.RequestMapping;",
        "import org.springframework.web.bind.annotation.RequestParam;",
        "import org.springframework.web.bind.annotation.RestController;",
        "",
        "@RestController",
        '@RequestMapping("/v1/synonyms-rule")',
        "public class SynonymRuleController {",
        "  @PostMapping(\"/{ruleId}/stages\")",
        "  public String addSynonymRuleStages(",
        '      @PathVariable("ruleId") String ruleId,',
        '      @RequestParam("dryRun") boolean dryRun',
        "  ) {",
        "    return \"ok\";",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const match = await findControllerRequestCandidate({
      searchRootsAbs: [dir],
      methodHint: "addSynonymRuleStages",
    });

    assert.ok(match.recipe);
    assert.equal(match.recipe.method, "POST");
    assert.equal(match.recipe.path, "/v1/synonyms-rule/value/stages");
    assert.match(match.recipe.queryTemplate, /dryRun=true/);
    assert.equal(match.requestSource, "controller_declaration_fallback");
  });
});

test("infers JAX-RS declaration fallback with path and query parameters", async () => {
  await withTempDir(async (dir: string) => {
    const javaFile = path.join(dir, "src", "main", "java", "SynonymRuleController.java");
    await fs.mkdir(path.dirname(javaFile), { recursive: true });
    await fs.writeFile(
      javaFile,
      [
        "package com.example;",
        "",
        "import jakarta.ws.rs.GET;",
        "import jakarta.ws.rs.POST;",
        "import jakarta.ws.rs.Path;",
        "import jakarta.ws.rs.PathParam;",
        "import jakarta.ws.rs.QueryParam;",
        "import jakarta.ws.rs.core.Response;",
        "",
        '@Path("/v1/synonyms-rule")',
        "public class SynonymRuleController {",
        "  @POST",
        '  @Path("/{ruleId}/stages")',
        "  public Response addSynonymRuleStages(",
        '      @PathParam("ruleId") String ruleId,',
        '      @QueryParam("dryRun") boolean dryRun',
        "  ) {",
        "    return Response.ok().build();",
        "  }",
        "",
        "  @GET",
        "  public Response health() {",
        "    return Response.ok().build();",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const match = await findControllerRequestCandidate({
      searchRootsAbs: [dir],
      methodHint: "addSynonymRuleStages",
    });

    assert.ok(match.recipe);
    assert.equal(match.recipe.method, "POST");
    assert.equal(match.recipe.path, "/v1/synonyms-rule/value/stages");
    assert.match(match.recipe.queryTemplate, /dryRun=true/);
    assert.equal(match.requestSource, "controller_declaration_fallback");
  });
});
