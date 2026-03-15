#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
mcp-java-dev-tools installer (bash)

Usage:
  ./scripts/install-integrations.sh [options]

Options:
  --client <codex|kiro|both>      Target client(s). Default: both
  --server-name <name>            MCP server name. Default: mcp-java-dev-tools
  --skill-name <name>             Install only selected skill(s). Repeatable. Default: install all shipped skills
  --probe-base-url <url>          Default: http://127.0.0.1:9193
  --workspace-root <absPath>      Optional MCP_WORKSPACE_ROOT value
  --codex-home <absPath>          Override CODEX_HOME (default: ~/.codex)
  --kiro-config <absPath>         Override Kiro MCP config path
  --kiro-skills-dir <absPath>     Override Kiro skills directory
  --update-skill-if-exists        Replace existing installed skill folder
  --skip-skill                    Install MCP only
  --skip-mcp                      Install skill only
  --no-build                      Do not run build when dist/server.js is missing
  --interactive                   Prompt for values in terminal
  --dry-run                       Print actions without changing files/config
  --help                          Show this help

Behavior:
- Idempotent by default: skips if Skill/MCP already installed.
- Use --update-skill-if-exists to replace existing installed skill folders.
- Retired skill mcp-java-dev-tools-repro-orchestration is removed during skill install/update.
- If no args are provided, interactive mode is enabled automatically.
EOF
}

CLIENT="both"
SERVER_NAME="mcp-java-dev-tools"
SKILL_NAMES_DEFAULT=("mcp-java-dev-tools-line-probe-run" "mcp-java-dev-tools-regression-suite")
SKILL_NAMES=("${SKILL_NAMES_DEFAULT[@]}")
SKILL_NAME_OVERRIDE=0
RETIRED_SKILL_NAME="mcp-java-dev-tools-repro-orchestration"
PROBE_BASE_URL="http://127.0.0.1:9193"
WORKSPACE_ROOT=""
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
KIRO_CONFIG=""
KIRO_SKILLS_DIR=""
SKIP_SKILL=0
SKIP_MCP=0
UPDATE_SKILL_IF_EXISTS=0
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
    --skill-name)
      if [[ "$SKILL_NAME_OVERRIDE" -eq 0 ]]; then
        SKILL_NAMES=()
        SKILL_NAME_OVERRIDE=1
      fi
      SKILL_NAMES+=("${2:-}")
      shift 2
      ;;
    --probe-base-url) PROBE_BASE_URL="${2:-}"; shift 2 ;;
    --workspace-root) WORKSPACE_ROOT="${2:-}"; shift 2 ;;
    --codex-home) CODEX_HOME="${2:-}"; shift 2 ;;
    --kiro-config) KIRO_CONFIG="${2:-}"; shift 2 ;;
    --kiro-skills-dir) KIRO_SKILLS_DIR="${2:-}"; shift 2 ;;
    --update-skill-if-exists) UPDATE_SKILL_IF_EXISTS=1; shift ;;
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
  PROBE_BASE_URL="$(prompt_default "MCP_PROBE_BASE_URL" "$PROBE_BASE_URL")"
  read -r -p "MCP_WORKSPACE_ROOT (optional, empty to skip): " WORKSPACE_ROOT
  if prompt_yes_no "Install Skill?" "y"; then SKIP_SKILL=0; else SKIP_SKILL=1; fi
  if prompt_yes_no "Install MCP?" "y"; then SKIP_MCP=0; else SKIP_MCP=1; fi
  if prompt_yes_no "Update existing skill installs?" "n"; then UPDATE_SKILL_IF_EXISTS=1; fi
  if prompt_yes_no "Dry run only?" "n"; then DRY_RUN=1; fi
fi

if [[ "$CLIENT" != "codex" && "$CLIENT" != "kiro" && "$CLIENT" != "both" ]]; then
  echo "Invalid client: $CLIENT" >&2
  exit 1
fi

dedupe_skill_names() {
  local -A seen=()
  local out=()
  local s
  for s in "${SKILL_NAMES[@]}"; do
    if [[ -z "$s" ]]; then
      continue
    fi
    if [[ -n "${seen[$s]+x}" ]]; then
      continue
    fi
    seen[$s]=1
    out+=("$s")
  done
  SKILL_NAMES=("${out[@]}")
}

dedupe_skill_names
if [[ "$SKIP_SKILL" -eq 0 && "${#SKILL_NAMES[@]}" -eq 0 ]]; then
  echo "No skills selected. Provide --skill-name <name> or omit --skill-name to install defaults." >&2
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

replace_skill_dir() {
  local dest_dir="$1"
  local guard_root="$2"

  if [[ -z "$dest_dir" || "$dest_dir" == "/" ]]; then
    echo "Refusing to replace unsafe destination: '$dest_dir'" >&2
    exit 1
  fi
  case "$dest_dir" in
    "$guard_root"/*) ;;
    *)
      echo "Refusing to replace destination outside expected skills root: $dest_dir" >&2
      echo "Expected root prefix: $guard_root" >&2
      exit 1
      ;;
  esac
  rm -rf "$dest_dir"
}

install_or_update_skill() {
  local source_dir="$1"
  local dest_dir="$2"
  local label="$3"
  local guard_root="$4"

  if [[ ! -d "$source_dir" ]]; then
    echo "$label source not found: $source_dir" >&2
    exit 1
  fi
  if [[ -d "$dest_dir" ]]; then
    if [[ "$UPDATE_SKILL_IF_EXISTS" -eq 0 ]]; then
      echo "- $label: already installed, skipping ($dest_dir)"
      return
    fi
    echo "- $label: updating existing install at $dest_dir"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      replace_skill_dir "$dest_dir" "$guard_root"
    fi
  fi
  echo "- $label: installing to $dest_dir"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    mkdir -p "$(dirname "$dest_dir")"
    cp -R "$source_dir" "$dest_dir"
  fi
}

remove_retired_skill_if_present() {
  local skills_root="$1"
  local retired_name="$2"
  local label="$3"
  local retired_dir="$skills_root/$retired_name"

  if [[ ! -d "$retired_dir" ]]; then
    echo "- $label: retired skill not present, skipping ($retired_dir)"
    return
  fi

  echo "- $label: removing retired skill $retired_dir"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    replace_skill_dir "$retired_dir" "$skills_root"
  fi
}

detect_kiro_config_path() {
  local candidates=()
  candidates+=("$HOME/.kiro/mcp.json")
  if [[ "$OSTYPE" == "darwin"* ]]; then
    candidates+=("$HOME/Library/Application Support/Kiro/User/mcp.json")
    candidates+=("$HOME/Library/Application Support/Kiro/User/settings.json")
  elif [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* ]]; then
    local appdata="${APPDATA:-$HOME/AppData/Roaming}"
    candidates+=("$appdata/Kiro/User/mcp.json")
    candidates+=("$appdata/Kiro/User/settings.json")
  else
    candidates+=("$HOME/.config/Kiro/User/mcp.json")
    candidates+=("$HOME/.config/Kiro/User/settings.json")
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
  printf '%s\n' "$HOME/.kiro/skills"
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

  node - "$config_path" "$server_name" "$server_js" "$PROBE_BASE_URL" "$WORKSPACE_ROOT" <<'NODE'
const fs = require("node:fs");

const [
  configPath,
  serverName,
  serverJs,
  probeBaseUrl,
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
    remove_retired_skill_if_present "$CODEX_HOME/skills" "$RETIRED_SKILL_NAME" "Codex skills"
    for skill_name in "${SKILL_NAMES[@]}"; do
      install_or_update_skill \
        "$REPO_ROOT/skills/$skill_name" \
        "$CODEX_HOME/skills/$skill_name" \
        "Codex skill ($skill_name)" \
        "$CODEX_HOME/skills"
    done
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
    remove_retired_skill_if_present "$KIRO_SKILLS_DIR" "$RETIRED_SKILL_NAME" "Kiro skills"
    for skill_name in "${SKILL_NAMES[@]}"; do
      install_or_update_skill \
        "$REPO_ROOT/skills/$skill_name" \
        "$KIRO_SKILLS_DIR/$skill_name" \
        "Kiro skill ($skill_name)" \
        "$KIRO_SKILLS_DIR"
    done
  fi
  if [[ "$SKIP_MCP" -eq 0 ]]; then
    install_kiro_mcp_if_missing "$KIRO_CONFIG" "$SERVER_NAME" "$SERVER_JS_PATH"
  fi
fi

echo "Done."
