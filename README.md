## mcp-jvm-debugger

Local MCP server for machine-verifiable Java code-path hits via runtime `-javaagent` probes.

It complements, not replaces, JDWP:
- JDWP/IntelliJ: pause, inspect stack/variables.
- Probe endpoint: deterministic hit signal for agent loops (`hitCount`, `lastHitEpochMs`).

### Prereqs

- Node.js (tested with Node 24)
- JDK 21+
- Maven (for building the Java agent)

### Build

PowerShell note: use `npm.cmd`.

```powershell
npm.cmd install
npm.cmd run build
mvn -f java-agent\pom.xml -DskipTests package
```

### One-Command Install (Skill + MCP)

Use the installer to configure Codex and/or Kiro. It is idempotent:
- skips MCP install if the server name already exists
- skips skill install if the skill folder already exists

PowerShell examples:

```powershell
# Install for both Codex and Kiro
npm.cmd run install:integrations

# Install only for Codex
npm.cmd run install:integrations -- --client codex

# Install only for Kiro
npm.cmd run install:integrations -- --client kiro
```

Bash/terminal script with interactive input (prompts when run with no args):

```bash
./scripts/install-integrations.sh

# non-interactive
./scripts/install-integrations.sh --client codex
./scripts/install-integrations.sh --client kiro --dry-run
```

Useful options:
- `--probe-base-url http://127.0.0.1:9193`
- `--workspace-root C:\path\to\workspace`
- `--codex-home ~/.codex` (`~` is expanded to your home directory, e.g. `C:\Users\<username>` on Windows)
- `--kiro-config C:\path\to\kiro\mcp.json` (default detection prefers `~/.kiro/mcp.json`)
- `--kiro-skills-dir C:\path\to\kiro\skills` (default: `~/.kiro/skills`)
- `--skip-skill` or `--skip-mcp`
- `--dry-run`

### Install MCP (Codex)

Required envs:
- `MCP_PROBE_BASE_URL`
- Probe paths are static in code:
  - `status`: `/__probe/status`
  - `reset`: `/__probe/reset`
  - `actuate`: `/__probe/actuate`

Optional:
- `MCP_WORKSPACE_ROOT` (not required; if omitted, defaults to MCP server process working directory)

```powershell
codex mcp add mcp-jvm-debugger `
  --env MCP_PROBE_BASE_URL=http://127.0.0.1:9193 `
  -- node C:\Users\Altheo\repository\mcp-jvm-debugger\dist\server.js
```

Remove/re-add:

```powershell
codex mcp remove mcp-jvm-debugger
codex mcp add mcp-jvm-debugger --env MCP_PROBE_BASE_URL=http://127.0.0.1:9193 -- node C:\Users\Altheo\repository\mcp-jvm-debugger\dist\server.js
```

### Install MCP (Anthropic/Kiro-style config)

For clients that use an `mcpServers` JSON block (for example Anthropic/Kiro MCP integrations), add:

```json
{
  "mcpServers": {
    "mcp-jvm-debugger": {
      "command": "node",
      "args": [
        "C:\\Users\\Altheo\\repository\\mcp-jvm-debugger\\dist\\server.js"
      ],
      "env": {
        "MCP_PROBE_BASE_URL": "http://127.0.0.1:9193"
      }
    }
  }
}
```

Optional envs you can add in the same `env` block:
- `MCP_WORKSPACE_ROOT=C:\\Users\\Altheo\\repository\\ph-shoes-project`
- `MCP_PROBE_WAIT_MAX_RETRIES=1`

### Optional Auth Settings

- `MCP_AUTH_LOGIN_DISCOVERY_ENABLED` (default: `true`, only for login endpoint hint extraction)
- `MCP_PROBE_WAIT_MAX_RETRIES` (default: `1`, max: `10`)

Behavior:
- Automatic credential discovery is disabled (no env/`.env` token pickup).
- If auth is required and credentials are not provided as tool inputs, recipe auth is `needs_user_input` and includes missing fields.
- If route/auth requirements cannot be inferred, recipe auth is also `needs_user_input` so the coding agent asks for credentials explicitly.
- If login endpoint is inferable from OpenAPI, recipe includes login hint (`auth.login.path`, `auth.login.body`) to help ask the user for proper creds.

### Tools

- `debug_ping`
- `projects_discover`
- `probe_diagnose`
- `target_infer`
- `recipe_generate`
- `probe_status`
- `probe_reset`
- `probe_wait_hit`
- `probe_actuate`

### Start Service With `-javaagent`

```text
-javaagent:C:\Users\Altheo\repository\mcp-jvm-debugger\java-agent\target\mcp-jvm-probe-agent-0.1.0-all.jar=host=0.0.0.0;port=9191;include=com.nimbly.phshoesbackend.**;exclude=com.nimbly.mcpjvmdebugger.agent.**,**.config.**,**Test
```

Probe endpoints:
1. `GET /__probe/status?key=<key>`
2. `POST /__probe/reset` body: `{ "key": "<key>" }`

### Recipe Output Template

Configure default template via env:
- `MCP_RECIPE_OUTPUT_TEMPLATE`

Default template resource file:
- `resources/default_recipe_output.template.txt`

Template variables:
- `recipe.*`: `recipe.mode`, `recipe.mode_reason`, `recipe.steps`, `recipe.natural_steps`, `recipe.actuated_steps`
- `target.*`: `target.path`, `target.class`, `target.method`, `target.line_hint`
- `http.*`: `http.request`, `http.method`, `http.path`, `http.query`, `http.code`, `http.response`
- `execution`: `execution_hit`, `api_outcome`, `repro_status`
- `auth.*`: `auth.required`, `auth.status`, `auth.strategy`, `auth.next_action`, `auth.headers`, `auth.missing`, `auth.source`, `auth.login.path`, `auth.login.body`
- `probe.*`: `probe.key`, `probe.hit`
- `run.*`: `run.duration`, `run.notes`

Recipe behavior:
- Default output is natural, step-by-step repro when a request path is inferable.
- `outputTemplate` only changes rendering; recipe mode/steps are generated separately.
- If natural repro is unavailable, output switches to `mode=actuated` with reason + enable/verify/cleanup steps.

### Prompt Style (Natural)

No need to include probe/api base in prompt if MCP env is already set.

Examples:
- `Give me reproducible recipe for Specification<CatalogShoe> hasKeyword(String keyword), line 132.`
- `Give me reproducible recipe for JsonNode getOrInit(String userId), line 42 under class AccountSettingsServiceImpl in useraccounts.`
