# mcp-jvm-debugger

[![node](https://img.shields.io/badge/node-v24.13.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm](https://img.shields.io/badge/npm-11.6.2-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/)
[![JDK](https://img.shields.io/badge/JDK-21%2B-007396?logo=openjdk&logoColor=white)](https://openjdk.org/)
[![Java Agent Target](https://img.shields.io/badge/Java%20Agent%20Target-17-ED8B00?logo=openjdk&logoColor=white)](https://maven.apache.org/)
[![package](https://img.shields.io/badge/package-mcp--jvm--debugger%400.1.0-0A66C2)](https://github.com/nimbly-dev/mcp-jvm-debugger)

Coding agents execute the debugging workflow; this project supplies live runtime probe data from a ByteBuddy Java agent through MCP tools so agents can generate reproducible steps and line-hit verification.

This is **not** a JDWP replacement.

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
mvn -f java-agent\pom.xml -DskipTests package
```

---

## Java Agent

```text
-javaagent:C:\Users\Altheo\repository\mcp-jvm-debugger\java-agent\target\mcp-jvm-probe-agent-0.1.0-all.jar=host=0.0.0.0;port=9191;include=com.nimbly.phshoesbackend.**;exclude=com.nimbly.mcpjvmdebugger.agent.**,**.config.**,**Test
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
- `MCP_PROBE_WAIT_MAX_RETRIES` (default `1`, max `10`)
- `MCP_PROBE_WAIT_UNREACHABLE_RETRY_ENABLED` (default `false`)
- `MCP_PROBE_WAIT_UNREACHABLE_MAX_RETRIES` (default `3`, max `10`)

Probe endpoint paths are fixed and non-overridable:

- status: `"/__probe/status"`
- reset: `"/__probe/reset"`
- capture: `"/__probe/capture"`

## Skills

Shipped skills:

- `mcp-jvm-line-probe-run`
- `mcp-jvm-regression-suite`

Behavior:

- Skills are MCP-first and must use `mcp-jvm-debugger` tools.
- If MCP toolchain is unavailable, skills must stop with `toolchain_unavailable` (no raw HTTP fallback).
- Both skills must emit explicit `Repro Steps` in run summaries.

## Dynamic Probe Route Resolution (Skill)

For multi-service runtimes, the shipped skills resolve probe/API targets dynamically at execution time.

- Discovery is runtime-first (no static host/port assumptions in probe-capable flows).
- Java agent status includes runtime metadata hints:
  - `runtime.applicationType { value, source, confidence }`
  - `runtime.appPort { value|null, source, confidence }`
- Metadata is advisory. Final route selection must still pass probe/API reachability and strict line-target alignment checks.
- Resolution is fail-closed:
  - `probe_route_not_found` when no valid route exists
  - `probe_route_ambiguous` when multiple routes remain valid
  - summaries must include `attemptedCandidates`, `validationResults`, `nextAction`, and `Repro Steps`.

---

## MCP Tools

- `debug_check`
- `project_list`
- `probe_check`
- `probe_target_infer`
- `probe_recipe_create`
- `probe_get_status`
- `probe_get_capture`
- `probe_reset`
- `probe_wait_for_hit`
- `probe_enable`

