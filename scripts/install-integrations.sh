#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
mcp-jvm-debugger installer (bash)

Usage:
  ./scripts/install-integrations.sh [options]

Options:
  --client <codex|kiro|both>      Target client(s). Default: both
  --server-name <name>            MCP server name. Default: mcp-jvm-debugger
  --skill-name <name>             Skill folder name in ./skills. Default: mcp-jvm-repro-orchestration
  --probe-base-url <url>          Default: http://127.0.0.1:9193
  --probe-status-path <path>      Default: /__probe/status
  --probe-reset-path <path>       Default: /__probe/reset
  --probe-actuate-path <path>     Default: /__probe/actuate
  --workspace-root <absPath>      Optional MCP_WORKSPACE_ROOT value
  --codex-home <absPath>          Override CODEX_HOME (default: ~/.codex)
  --kiro-config <absPath>         Override Kiro MCP config path
  --kiro-skills-dir <absPath>     Override Kiro skills directory
  --skip-skill                    Install MCP only
  --skip-mcp                      Install skill only
  --no-build                      Do not run build when dist/server.js is missing
  --interactive                   Prompt for values in terminal
  --dry-run                       Print actions without changing files/config
  --help                          Show this help

Behavior:
- Idempotent: skips if Skill/MCP already installed.
- If no args are provided, interactive mode is enabled automatically.
EOF
}

CLIENT="both"
SERVER_NAME="mcp-jvm-debugger"
SKILL_NAME="mcp-jvm-repro-orchestration"
PROBE_BASE_URL="http://127.0.0.1:9193"
PROBE_STATUS_PATH="/__probe/status"
PROBE_RESET_PATH="/__probe/reset"
PROBE_ACTUATE_PATH="/__probe/actuate"
WORKSPACE_ROOT=""
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
KIRO_CONFIG=""
KIRO_SKILLS_DIR=""
SKIP_SKILL=0
SKIP_MCP=0
BUILD_IF_MISSING=1
INTERACTIVE=0
DRY_RUN=0

if [[ $# -eq 0 ]]; then
  INTERACTIVE=1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --client) CLIENT="${2:-}"; shift 2 ;;
    --server-name) SERVER_NAME="${2:-}"; shift 2 ;;
    --skill-name) SKILL_NAME="${2:-}"; shift 2 ;;
    --probe-base-url) PROBE_BASE_URL="${2:-}"; shift 2 ;;
    --probe-status-path) PROBE_STATUS_PATH="${2:-}"; shift 2 ;;
    --probe-reset-path) PROBE_RESET_PATH="${2:-}"; shift 2 ;;
    --probe-actuate-path) PROBE_ACTUATE_PATH="${2:-}"; shift 2 ;;
    --workspace-root) WORKSPACE_ROOT="${2:-}"; shift 2 ;;
    --codex-home) CODEX_HOME="${2:-}"; shift 2 ;;
    --kiro-config) KIRO_CONFIG="${2:-}"; shift 2 ;;
    --kiro-skills-dir) KIRO_SKILLS_DIR="${2:-}"; shift 2 ;;
    --skip-skill) SKIP_SKILL=1; shift ;;
    --skip-mcp) SKIP_MCP=1; shift ;;
    --no-build) BUILD_IF_MISSING=0; shift ;;
    --interactive) INTERACTIVE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$CLIENT" != "codex" && "$CLIENT" != "kiro" && "$CLIENT" != "both" ]]; then
  echo "Invalid --client: $CLIENT" >&2
  exit 1
fi

expand_home() {
  local p="$1"
  if [[ "$p" == "~" ]]; then
    printf '%s\n' "$HOME"
    return
  fi
  if [[ "$p" == "~/"* ]]; then
    printf '%s\n' "$HOME/${p#~/}"
    return
  fi
  if [[ "$p" == "~\\"* ]]; then
    printf '%s\n' "$HOME/${p#~\\}"
    return
  fi
  printf '%s\n' "$p"
}

CODEX_HOME="$(expand_home "$CODEX_HOME")"
if [[ -n "$KIRO_CONFIG" ]]; then
  KIRO_CONFIG="$(expand_home "$KIRO_CONFIG")"
fi
if [[ -n "$KIRO_SKILLS_DIR" ]]; then
  KIRO_SKILLS_DIR="$(expand_home "$KIRO_SKILLS_DIR")"
fi
if [[ -n "$WORKSPACE_ROOT" ]]; then
  WORKSPACE_ROOT="$(expand_home "$WORKSPACE_ROOT")"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_JS_PATH="$REPO_ROOT/dist/server.js"
SKILL_SOURCE="$REPO_ROOT/skills/$SKILL_NAME"

prompt_default() {
  local label="$1"
  local default="$2"
  local result
  read -r -p "$label [$default]: " result
  if [[ -z "$result" ]]; then
    printf '%s\n' "$default"
  else
    printf '%s\n' "$result"
  fi
}

prompt_yes_no() {
  local label="$1"
  local default="$2" # y or n
  local result
  if [[ "$default" == "y" ]]; then
    read -r -p "$label [Y/n]: " result
    [[ -z "$result" || "$result" =~ ^[Yy]$ ]] && return 0
    return 1
  fi
  read -r -p "$label [y/N]: " result
  [[ "$result" =~ ^[Yy]$ ]] && return 0
  return 1
}

if [[ "$INTERACTIVE" -eq 1 ]]; then
  echo "Interactive install configuration:"
  CLIENT="$(prompt_default "Client (codex|kiro|both)" "$CLIENT")"
  SERVER_NAME="$(prompt_default "MCP server name" "$SERVER_NAME")"
  SKILL_NAME="$(prompt_default "Skill name (folder under ./skills)" "$SKILL_NAME")"
  PROBE_BASE_URL="$(prompt_default "MCP_PROBE_BASE_URL" "$PROBE_BASE_URL")"
  PROBE_STATUS_PATH="$(prompt_default "MCP_PROBE_STATUS_PATH" "$PROBE_STATUS_PATH")"
  PROBE_RESET_PATH="$(prompt_default "MCP_PROBE_RESET_PATH" "$PROBE_RESET_PATH")"
  PROBE_ACTUATE_PATH="$(prompt_default "MCP_PROBE_ACTUATE_PATH" "$PROBE_ACTUATE_PATH")"
  read -r -p "MCP_WORKSPACE_ROOT (optional, empty to skip): " WORKSPACE_ROOT
  if prompt_yes_no "Install Skill?" "y"; then SKIP_SKILL=0; else SKIP_SKILL=1; fi
  if prompt_yes_no "Install MCP?" "y"; then SKIP_MCP=0; else SKIP_MCP=1; fi
  if prompt_yes_no "Dry run only?" "n"; then DRY_RUN=1; fi
fi

if [[ "$CLIENT" != "codex" && "$CLIENT" != "kiro" && "$CLIENT" != "both" ]]; then
  echo "Invalid client: $CLIENT" >&2
  exit 1
fi

if [[ "$SKIP_SKILL" -eq 1 && "$SKIP_MCP" -eq 1 ]]; then
  echo "Nothing to do: both --skip-skill and --skip-mcp are set."
  exit 0
fi

echo "Installing integrations (client=$CLIENT, dryRun=$DRY_RUN)"

ensure_build() {
  if [[ -f "$SERVER_JS_PATH" ]]; then
    return
  fi
  if [[ "$BUILD_IF_MISSING" -eq 0 ]]; then
    echo "Missing $SERVER_JS_PATH. Run npm run build first or remove --no-build." >&2
    exit 1
  fi
  echo "- dist/server.js not found. Running npm run build"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    (cd "$REPO_ROOT" && npm run build)
  fi
}

install_skill_if_missing() {
  local source_dir="$1"
  local dest_dir="$2"
  local label="$3"

  if [[ ! -d "$source_dir" ]]; then
    echo "$label source not found: $source_dir" >&2
    exit 1
  fi
  if [[ -d "$dest_dir" ]]; then
    echo "- $label: already installed, skipping ($dest_dir)"
    return
  fi
  echo "- $label: installing to $dest_dir"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    mkdir -p "$(dirname "$dest_dir")"
    cp -R "$source_dir" "$dest_dir"
  fi
}

detect_kiro_config_path() {
  local candidates=()
  if [[ "$OSTYPE" == "darwin"* ]]; then
    candidates+=("$HOME/Library/Application Support/Kiro/User/mcp.json")
    candidates+=("$HOME/Library/Application Support/Kiro/User/settings.json")
    candidates+=("$HOME/.kiro/mcp.json")
  elif [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* ]]; then
    local appdata="${APPDATA:-$HOME/AppData/Roaming}"
    candidates+=("$appdata/Kiro/User/mcp.json")
    candidates+=("$appdata/Kiro/User/settings.json")
    candidates+=("$HOME/.kiro/mcp.json")
  else
    candidates+=("$HOME/.config/Kiro/User/mcp.json")
    candidates+=("$HOME/.config/Kiro/User/settings.json")
    candidates+=("$HOME/.kiro/mcp.json")
  fi

  local c
  for c in "${candidates[@]}"; do
    if [[ -f "$c" ]]; then
      printf '%s\n' "$c"
      return
    fi
  done
  printf '%s\n' "${candidates[0]}"
}

detect_kiro_skills_dir() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    printf '%s\n' "$HOME/Library/Application Support/Kiro/User/skills"
  elif [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* ]]; then
    local appdata="${APPDATA:-$HOME/AppData/Roaming}"
    printf '%s\n' "$appdata/Kiro/User/skills"
  else
    printf '%s\n' "$HOME/.config/Kiro/User/skills"
  fi
}

append_codex_mcp_if_missing() {
  local config_path="$1"
  local server_name="$2"
  local server_js="$3"

  if [[ -f "$config_path" ]] && grep -Fq "[mcp_servers.$server_name]" "$config_path"; then
    echo "- Codex MCP: '$server_name' already configured, skipping ($config_path)"
    return
  fi

  echo "- Codex MCP: adding '$server_name' to $config_path"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return
  fi

  mkdir -p "$(dirname "$config_path")"
  touch "$config_path"
  if [[ -s "$config_path" ]]; then
    printf '\n' >> "$config_path"
  fi

  {
    printf '[mcp_servers.%s]\n' "$server_name"
    printf 'command = "node"\n'
    printf "args = ['%s']\n\n" "$server_js"
    printf '[mcp_servers.%s.env]\n' "$server_name"
    printf 'MCP_PROBE_BASE_URL = "%s"\n' "$PROBE_BASE_URL"
    printf 'MCP_PROBE_STATUS_PATH = "%s"\n' "$PROBE_STATUS_PATH"
    printf 'MCP_PROBE_RESET_PATH = "%s"\n' "$PROBE_RESET_PATH"
    printf 'MCP_PROBE_ACTUATE_PATH = "%s"\n' "$PROBE_ACTUATE_PATH"
    if [[ -n "$WORKSPACE_ROOT" ]]; then
      printf "MCP_WORKSPACE_ROOT = '%s'\n" "$WORKSPACE_ROOT"
    fi
    printf '\n'
  } >> "$config_path"
}

install_kiro_mcp_if_missing() {
  local config_path="$1"
  local server_name="$2"
  local server_js="$3"

  echo "- Kiro MCP: ensuring '$server_name' in $config_path"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return
  fi

  mkdir -p "$(dirname "$config_path")"
  if [[ ! -f "$config_path" ]]; then
    printf '{}\n' > "$config_path"
  fi

  node - "$config_path" "$server_name" "$server_js" "$PROBE_BASE_URL" "$PROBE_STATUS_PATH" "$PROBE_RESET_PATH" "$PROBE_ACTUATE_PATH" "$WORKSPACE_ROOT" <<'NODE'
const fs = require("node:fs");

const [
  configPath,
  serverName,
  serverJs,
  probeBaseUrl,
  probeStatusPath,
  probeResetPath,
  probeActuatePath,
  workspaceRoot,
] = process.argv.slice(2);

let doc = {};
if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, "utf8").trim();
  if (raw) doc = JSON.parse(raw);
}
if (!doc || Array.isArray(doc) || typeof doc !== "object") {
  throw new Error(`Kiro config root must be a JSON object: ${configPath}`);
}
if (!doc.mcpServers || typeof doc.mcpServers !== "object" || Array.isArray(doc.mcpServers)) {
  doc.mcpServers = {};
}

if (doc.mcpServers[serverName]) {
  console.log(`- Kiro MCP: '${serverName}' already configured, skipping (${configPath})`);
  process.exit(0);
}

const env = {
  MCP_PROBE_BASE_URL: probeBaseUrl,
  MCP_PROBE_STATUS_PATH: probeStatusPath,
  MCP_PROBE_RESET_PATH: probeResetPath,
  MCP_PROBE_ACTUATE_PATH: probeActuatePath,
};
if (workspaceRoot) {
  env.MCP_WORKSPACE_ROOT = workspaceRoot;
}

doc.mcpServers[serverName] = {
  command: "node",
  args: [serverJs],
  env,
};

fs.writeFileSync(configPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
console.log(`- Kiro MCP: added '${serverName}'`);
NODE
}

if [[ "$SKIP_MCP" -eq 0 ]]; then
  ensure_build
fi

if [[ "$CLIENT" == "codex" || "$CLIENT" == "both" ]]; then
  if [[ "$SKIP_SKILL" -eq 0 ]]; then
    install_skill_if_missing "$SKILL_SOURCE" "$CODEX_HOME/skills/$SKILL_NAME" "Codex skill"
  fi
  if [[ "$SKIP_MCP" -eq 0 ]]; then
    append_codex_mcp_if_missing "$CODEX_HOME/config.toml" "$SERVER_NAME" "$SERVER_JS_PATH"
  fi
fi

if [[ "$CLIENT" == "kiro" || "$CLIENT" == "both" ]]; then
  if [[ -z "$KIRO_SKILLS_DIR" ]]; then
    KIRO_SKILLS_DIR="$(detect_kiro_skills_dir)"
  fi
  if [[ -z "$KIRO_CONFIG" ]]; then
    KIRO_CONFIG="$(detect_kiro_config_path)"
  fi
  if [[ "$SKIP_SKILL" -eq 0 ]]; then
    install_skill_if_missing "$SKILL_SOURCE" "$KIRO_SKILLS_DIR/$SKILL_NAME" "Kiro skill"
  fi
  if [[ "$SKIP_MCP" -eq 0 ]]; then
    install_kiro_mcp_if_missing "$KIRO_CONFIG" "$SERVER_NAME" "$SERVER_JS_PATH"
  fi
fi

echo "Done."
