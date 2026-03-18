# Test Layout

Centralized test assets live under the top-level `test` tree.

## Structure

```text
test/
|- fixtures/
|  \- spring-apps/
|     \- catalog-app/
\- integration/
   \- mcp/
```

## Intent

- `fixtures/spring-apps` contains real Spring fixture projects used only for integration testing.
- `integration/mcp` contains cross-module MCP integration tests that exercise:
  - TS orchestration
  - Java request-mapping synthesis
  - Java agent instrumentation
  - probe runtime behavior

These tests are intentionally outside `/java-agent` and `/tools` because they validate the integrated toolchain rather than a single module in isolation.
