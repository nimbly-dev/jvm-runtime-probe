# mcp-java-dev-tools

[![node](https://img.shields.io/badge/node-v24.13.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm](https://img.shields.io/badge/npm-11.6.2-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/)
[![JDK](https://img.shields.io/badge/JDK-17%2B-007396?logo=openjdk&logoColor=white)](https://openjdk.org/)
[![Java Agent Target](https://img.shields.io/badge/Java%20Agent%20Target-17-ED8B00?logo=openjdk&logoColor=white)](https://maven.apache.org/)
[![package](https://img.shields.io/badge/package-mcp--java--dev--tools%400.1.0-0A66C2)](https://github.com/nimbly-dev/mcp-java-dev-tools)

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
| JDK | `17+` |
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

## Installation

### Installer

The installer currently supports Codex and Kiro.

```bash
./scripts/install-integrations.sh
```

This installs the default skill set:
- `mcp-java-dev-tools-line-probe-run`
- `mcp-java-dev-tools-regression-suite`

For non-interactive or CI use, use the `./scripts/install-integrations.sh` flags shown above.

### Manual Setup

#### Java Agent Setup

The target JVM must run on **Java 17 or newer**. If you're on Java 21, see [Java 21 compatibility mode](#java-21-compatibility-mode) before continuing.

Add the following as a JVM argument when launching your application, replacing `{desktopName}` and the `include` package with your own:

```text
-javaagent:C:\Users\{desktopName}\repository\mcp-java-dev-tools\java-agent\core\core-probe\target\mcp-java-dev-tools-agent-0.1.0.jar=host=0.0.0.0;port=9191;include=com.{package_to_capture}.**;exclude=com.nimbly.mcpjavadevtools.agent.**,**.config.**,**Test
```

> **Tip:** The `include` filter is optional. By default, the agent instruments all classes within the module it was run from. Setting `include` to your root package (e.g. `com.acme.**`) keeps instrumentation focused and avoids capturing classes you don't care about.

To confirm the agent is instrumenting your classes, check the startup logs for lines like:

```txt
[mcp-probe]: com.yourpackagename.yourclassname
```

If you don't see your classes listed, check your `include` filter.

---

<details>
<summary><strong>IntelliJ IDEA — Step by Step</strong></summary>

1. Open **Run > Edit Configurations...** from the top menu
2. Select the run configuration for your target application (or create one if it doesn't exist)
3. Expand the **Modify options** dropdown and enable **Add VM options** if it isn't already visible
4. In the **VM options** field, paste the full `-javaagent:...` argument from above
5. Click **Apply**, then **OK**
6. Run your application normally — the agent attaches on startup

**Finding the JAR path:** If you're unsure of the absolute path, right-click the agent JAR in the Project panel and choose **Copy Path > Absolute Path**.

> On Windows, use backslashes in the path (`C:\Users\...`). On macOS/Linux, use forward slashes (`/home/...` or `/Users/...`).

</details>

---

<details>
<summary><strong>Eclipse — Step by Step</strong></summary>

1. Go to **Run > Run Configurations...** (or **Debug Configurations...** if you're debugging)
2. Select your application under **Java Application**, or create a new one
3. Open the **Arguments** tab
4. In the **VM arguments** field, paste the full `-javaagent:...` argument from above
5. Click **Apply**, then **Run** (or **Debug**)

**Finding the JAR path:** Navigate to the JAR in your file system, right-click it, and copy the full path. Paste it into the agent argument, replacing the placeholder path.

> On Windows, Eclipse accepts both forward and backslashes in paths, but backslashes are safer. Wrap the path in quotes if it contains spaces: `-javaagent:"C:\path with spaces\agent.jar"=...`

</details>

---

## Runtime Configuration

### Java Agent Options

#### Capture History Buffer Size

Controls how many method captures the agent retains per probe point.

| Method | Value |
|---|---|
| Agent arg | `captureMethodBufferSize=<1..32>` |
| JVM property | `-Dmcp.probe.capture.method.buffer.size=<1..32>` |
| Environment variable | `MCP_PROBE_CAPTURE_METHOD_BUFFER_SIZE=<1..32>` |

Default is `3`. Increase this if you need deeper capture history for a single probe point.

#### Java 21 Compatibility Mode

Required if your target JVM runs on Java 21. Enables ByteBuddy's experimental support for newer JVM internals.

| Method | Value |
|---|---|
| Agent arg | `allowJava21=true` (aliases: `java21Compat=true`, `byteBuddyExperimental=true`) |
| JVM property | `-Dmcp.probe.bytebuddy.experimental=true` (legacy alias: `-Dmcp.probe.allow.java21=true`) |
| Environment variable | `MCP_PROBE_BYTEBUDDY_EXPERIMENTAL=true` (legacy alias: `MCP_PROBE_ALLOW_JAVA21=true`) |

Default is `false`.


### MCP Server Environment Variables

#### Required

| Variable | Purpose |
|---|---|
| `MCP_PROBE_BASE_URL` | URL of the running probe agent |

#### Optional

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

#### Probe Endpoints

These paths are fixed and cannot be overridden.

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
