# mcp-java-dev-tools

[![node](https://img.shields.io/badge/node-v24.13.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm](https://img.shields.io/badge/npm-11.6.2-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/)
[![JDK](https://img.shields.io/badge/JDK-21%2B-007396?logo=openjdk&logoColor=white)](https://openjdk.org/)
[![Java Agent Target](https://img.shields.io/badge/Java%20Agent%20Target-17-ED8B00?logo=openjdk&logoColor=white)](https://maven.apache.org/)
[![package](https://img.shields.io/badge/package-mcp--jvm--debugger%400.1.0-0A66C2)](https://github.com/nimbly-dev/mcp-java-dev-tools)

**MCP Java Dev Tools** bridges agentic coding tools and live Java runtime behavior through a lightweight sidecar agent.

Static analysis only gets you so far. By attaching directly to a running JVM, this tool surfaces bytecode-level runtime signals that static analysis alone can't see — enabling probe-verified inspection, targeted regression checks, runtime-path validation, and deterministic debugging workflows.

The runtime agent is built with ByteBuddy and works alongside JDWP rather than replacing it. On top of the probe layer, the system adds framework-aware data synthesis and strict, fail-closed tool contracts — so agent orchestrators can make decisions grounded in actual runtime proof, not inference.

For operator workflows and end-to-end execution flows, see [docs/how-it-works/README.md](./docs/how-it-works/README.md).

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | `v24.13.0` (tested) |
| npm | `11.6.2` (tested) |
| JDK | `21+` |
| Maven | any recent |

---

## Build

```powershell
npm.cmd install
npm.cmd run build
mvn -f java-agent\pom.xml package
```

This produces two artifacts:
- **MCP server** → `dist/server.js`
- **Java agent bundle** → `java-agent/core/core-probe/target/mcp-java-dev-tools-agent-0.1.0-all.jar`

---

## Attaching the Java Agent

```text
-javaagent:C:\Users\{desktopName}\repository\mcp-java-dev-tools\java-agent\core\core-probe\target\mcp-java-dev-tools-agent-0.1.0.jar=host=0.0.0.0;port=9191;include=com.{your_workspace_root_package}.**;exclude=com.nimbly.mcpjavadevtools.agent.**,**.config.**,**Test
```

**Tuning capture history buffer size** (all three are equivalent):

| Method | Value |
|---|---|
| Agent arg | `captureMethodBufferSize=<1..32>` |
| JVM property | `-Dmcp.probe.capture.method.buffer.size=<1..32>` |
| Environment variable | `MCP_PROBE_CAPTURE_METHOD_BUFFER_SIZE=<1..32>` |

Default is `3`.

**Java 21 compatibility mode**:

| Method | Value |
|---|---|
| Agent arg | `allowJava21=true` (aliases: `java21Compat=true`, `byteBuddyExperimental=true`) |
| JVM property | `-Dmcp.probe.bytebuddy.experimental=true` (legacy alias: `-Dmcp.probe.allow.java21=true`) |
| Environment variable | `MCP_PROBE_BYTEBUDDY_EXPERIMENTAL=true` (legacy alias: `MCP_PROBE_ALLOW_JAVA21=true`) |

Default is `false`.

---

## Installing the MCP Server

<details>
<summary><strong>Codex</strong></summary>

```powershell
codex.cmd mcp add mcp-java-dev-tools --env MCP_PROBE_BASE_URL=http://127.0.0.1:9193 -- node C:\Users\{desktopName}\repository\mcp-java-dev-tools\dist\server.js
```

Optional: set `MCP_WORKSPACE_ROOT` if needed for your project layout.

To reinstall:

```powershell
codex.cmd mcp remove mcp-java-dev-tools
codex.cmd mcp add mcp-java-dev-tools --env MCP_PROBE_BASE_URL=http://127.0.0.1:9193 -- node C:\Users\{desktopName}\repository\mcp-java-dev-tools\dist\server.js
```

</details>

<details>
<summary><strong>Kiro / mcpServers JSON</strong></summary>

Add this to `~/.kiro/mcp.json`:

```json
{
  "mcpServers": {
    "mcp-java-dev-tools": {
      "command": "node",
      "args": ["C:\\Users\\{desktopName}\\repository\\mcp-java-dev-tools\\dist\\server.js"],
      "env": {
        "MCP_PROBE_BASE_URL": "http://127.0.0.1:9193"
      }
    }
  }
}
```

Optional: set `MCP_WORKSPACE_ROOT` if needed.

</details>

---

## Installer Script

The quickest way to get set up is the installer script:

```bash
./scripts/install-integrations.sh
```

This installs the default skill set:
- `mcp-java-dev-tools-line-probe-run`
- `mcp-java-dev-tools-regression-suite`

For non-interactive or CI use, the script accepts flags:

```bash
./scripts/install-integrations.sh --client codex --probe-base-url http://127.0.0.1:9193
./scripts/install-integrations.sh --client kiro --dev-mode --dry-run
./scripts/install-integrations.sh --client both --update-skill-if-exists
./scripts/install-integrations.sh --client codex --skill-name mcp-java-dev-tools-line-probe-run
./scripts/install-integrations.sh --client codex --skill-name mcp-java-dev-tools-line-probe-run --skill-name mcp-java-dev-tools-regression-suite
```

---

## Runtime Configuration

One environment variable is required; the rest are optional tuning knobs.

**Required:**

| Variable | Purpose |
|---|---|
| `MCP_PROBE_BASE_URL` | URL of the running probe agent |

**Optional:**

| Variable | Default | Notes |
|---|---|---|
| `MCP_WORKSPACE_ROOT` | — | Project root hint for path resolution |
| `MCP_JAVA_REQUEST_MAPPING_RESOLVER_JAR` | — | |
| `MCP_JAVA_REQUEST_MAPPING_RESOLVER_CLASSPATH` | — | |
| `MCP_JAVA_BIN` | — | |
| `MCP_PROBE_LINE_SELECTION_MAX_SCAN_LINES` | `120` | Range: 10–2000 |
| `MCP_PROBE_WAIT_MAX_RETRIES` | `1` | Max: 10 |
| `MCP_PROBE_WAIT_UNREACHABLE_RETRY_ENABLED` | `false` | |
| `MCP_PROBE_WAIT_UNREACHABLE_MAX_RETRIES` | `3` | Max: 10 |
| `MCP_PROBE_INCLUDE_EXECUTION_PATHS` | `false` | Set `true` to include `executionPaths` arrays in probe payloads |

Probe endpoint paths are fixed:

| Endpoint | Path |
|---|---|
| Status | `/__probe/status` |
| Reset | `/__probe/reset` |
| Capture | `/__probe/capture` |

---

## Skills

| Skill | Purpose |
|---|---|
| `mcp-java-dev-tools-line-probe-run` | Line-level probe execution |
| `mcp-java-dev-tools-regression-suite` | Regression check orchestration |

---

## MCP Tools

| Tool | |
|---|---|
| `debug_check` | |
| `project_context_validate` | |
| `probe_check` | |
| `probe_target_infer` | |
| `probe_recipe_create` | |
| `probe_get_status` | |
| `probe_get_capture` | |
| `probe_reset` | |
| `probe_wait_for_hit` | |
| `probe_enable` | |
