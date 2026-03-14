# mcp-jvm-debugger

[![node](https://img.shields.io/badge/node-v24.13.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm](https://img.shields.io/badge/npm-11.6.2-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/)
[![JDK](https://img.shields.io/badge/JDK-21%2B-007396?logo=openjdk&logoColor=white)](https://openjdk.org/)
[![Java Agent Target](https://img.shields.io/badge/Java%20Agent%20Target-17-ED8B00?logo=openjdk&logoColor=white)](https://maven.apache.org/)
[![package](https://img.shields.io/badge/package-mcp--jvm--debugger%400.1.0-0A66C2)](https://github.com/nimbly-dev/mcp-jvm-debugger)

**Java MCP Dev Tool** connects agentic coding tools to live Java runtime data through a lightweight sidecar agent.  
It attaches to a running service and exposes bytecode/runtime signals that static analysis alone cannot see,
with that, it enables targeted regression checks, line-level/runtime-path inspection, and more reliable debugging decisions.  

The Java Agent is built with **ByteBuddy**, it complements `JDWP` rather than replacing it.

Operator workflows and end-to-end execution flows are documented in [docs/how-it-works/README.md](./docs/how-it-works/README.md).

---

## Requirements

- Node.js `v24.13.0` (tested)
- npm `11.6.2` (tested)
- JDK `21+`
- Maven

---

## Build

```powershell
npm.cmd install
npm.cmd run build
mvn -f java-agent\pom.xml package
```

---

## Java Agent

```text
-javaagent:C:\Users\{desktopName}\repository\mcp-jvm-debugger\java-agent\core\target\mcp-jvm-probe-agent-0.1.0.jar=host=0.0.0.0;port=9191;include=com.{your_workspace_root_package}.**;exclude=com.nimbly.mcpjvmdebugger.agent.**,**.config.**,**Test
```

Optional Java agent capture history tuning:

- Agent arg: `captureMethodBufferSize=<1..32>` (default `3`)
- JVM property: `-Dmcp.probe.capture.method.buffer.size=<1..32>`
- Environment variable: `MCP_PROBE_CAPTURE_METHOD_BUFFER_SIZE=<1..32>`

---

## Install MCP

<details>
<summary><strong>Codex</strong></summary>

```powershell
codex.cmd mcp add mcp-jvm-debugger --env MCP_PROBE_BASE_URL=http://127.0.0.1:9193 -- node C:\Users\{desktopName}\repository\mcp-jvm-debugger\dist\server.js
```

Optional env:

- `MCP_WORKSPACE_ROOT`

Reinstall:

```powershell
codex.cmd mcp remove mcp-jvm-debugger
codex.cmd mcp add mcp-jvm-debugger --env MCP_PROBE_BASE_URL=http://127.0.0.1:9193 -- node C:\Users\{desktopName}\repository\mcp-jvm-debugger\dist\server.js
```

</details>

<details>
<summary><strong>Kiro / mcpServers JSON</strong></summary>

Example (`~/.kiro/mcp.json`):

```json
{
  "mcpServers": {
    "mcp-jvm-debugger": {
      "command": "node",
      "args": ["C:\\Users\\{desktopName}\\repository\\mcp-jvm-debugger\\dist\\server.js"],
      "env": {
        "MCP_PROBE_BASE_URL": "http://127.0.0.1:9193"
      }
    }
  }
}
```

Optional env:

- `MCP_WORKSPACE_ROOT`

</details>

---

## Installer Script

```bash
./scripts/install-integrations.sh
```

Default skill install set:

- `mcp-jvm-line-probe-run`
- `mcp-jvm-regression-suite`

Non-interactive:

```bash
./scripts/install-integrations.sh --client codex --probe-base-url http://127.0.0.1:9193
./scripts/install-integrations.sh --client kiro --dry-run
./scripts/install-integrations.sh --client both --update-skill-if-exists
./scripts/install-integrations.sh --client codex --skill-name mcp-jvm-line-probe-run
./scripts/install-integrations.sh --client codex --skill-name mcp-jvm-line-probe-run --skill-name mcp-jvm-regression-suite
```

Installer migration behavior:

- Retired skill `mcp-jvm-repro-orchestration` is removed from installed skill roots during skill install/update.

---

## Runtime Config

Required:

- `MCP_PROBE_BASE_URL`

Optional:

- `MCP_WORKSPACE_ROOT`
- `MCP_JAVA_REQUEST_MAPPING_RESOLVER_JAR`
- `MCP_JAVA_REQUEST_MAPPING_RESOLVER_CLASSPATH`
- `MCP_JAVA_BIN`
- `MCP_PROBE_LINE_SELECTION_MAX_SCAN_LINES` (default `120`, min `10`, max `2000`)
- `MCP_PROBE_WAIT_MAX_RETRIES` (default `1`, max `10`)
- `MCP_PROBE_WAIT_UNREACHABLE_RETRY_ENABLED` (default `false`)
- `MCP_PROBE_WAIT_UNREACHABLE_MAX_RETRIES` (default `3`, max `10`)
- `MCP_PROBE_INCLUDE_EXECUTION_PATHS` (default `false`; set `true` to include executionPaths arrays in probe payloads)

Probe endpoint paths are fixed and non-overridable:

- status: `"/__probe/status"`
- reset: `"/__probe/reset"`
- capture: `"/__probe/capture"`

## Skills

Shipped skills:

- `mcp-jvm-line-probe-run`
- `mcp-jvm-regression-suite`

---

## MCP Tools

- `debug_check`
- `project_context_validate`
- `probe_check`
- `probe_target_infer`
- `probe_recipe_create`
- `probe_get_status`
- `probe_get_capture`
- `probe_reset`
- `probe_wait_for_hit`
- `probe_enable`

## Synthesis Notes

- `probe_recipe_create` request synthesis is code-first via synthesizer plugins and a generic JVM AST request-mapping resolver (no OpenAPI route fallback).
- `probe_recipe_create` requires `classHint` as exact FQCN (for example `com.acme.catalog.web.controller.ProductController`).
- Runtime synthesis candidate scope is runtime-only (`src/main/java` + generated-main roots); `src/test/java` is excluded.
- The AST resolver exposes a framework-agnostic contract over `stdin/stdout`; Spring MVC support is currently provided via a mapper plugin.
- OpenAPI files are still used for auth hinting when available.
- When `resultType=report`, `executionPlan.steps` are compact action codes (for example `resolve_auth`, `request_candidate_missing`) instead of verbose instruction text.
- Orchestration decisions must use deterministic fields (`resultType`, `status`, `reasonCode`, `failedStep`); confidence/heuristic scoring is not part of the public contract.
- Preferred operator inputs for fewer ambiguities: explicit API/probe base URL, context path, and app port.

