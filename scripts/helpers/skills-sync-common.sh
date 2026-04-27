#!/usr/bin/env bash
set -euo pipefail

DEFAULT_SKILLS=(
  "mcp-java-dev-tools-line-probe-run"
  "mcp-java-dev-tools-regression-suite"
  "mcp-java-dev-tools-regression-plan-crafter"
  "mcp-java-dev-tools-regression-result"
  "mcp-java-dev-tools-issue-report"
)
RETIRED_SKILL_NAME="mcp-java-dev-tools-repro-orchestration"
MANAGED_SKILL_PREFIX="mcp-java-dev-tools-"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CLIENT="codex"
CLIENT_FROM_ARG=0
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
KIRO_SKILLS_DIR=""
SKILL_NAMES=("${DEFAULT_SKILLS[@]}")
SKILL_NAME_OVERRIDE=0
RUN_BUILD_COMPILE=1
RUN_BUILD_JAVA=1

usage_common() {
  cat <<'EOF'
Options:
  --client <codex|kiro>       Target client. Default: codex
  --skill-name <name>         Sync only selected skill(s). Repeatable.
  --codex-home <absPath>      Override CODEX_HOME (default: ~/.codex)
  --kiro-skills-dir <absPath> Override Kiro skills directory (default: ~/.kiro/skills)
  --no-build-compile          Skip `npm run build:compile`
  --no-build-java             Skip `mvn -f java-agent/pom.xml package`
  --help                      Show help
EOF
}

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

detect_kiro_skills_dir() {
  printf '%s\n' "$HOME/.kiro/skills"
}

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

parse_common_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --client)
        CLIENT="${2:-}"
        CLIENT_FROM_ARG=1
        shift 2
        ;;
      --skill-name)
        if [[ "$SKILL_NAME_OVERRIDE" -eq 0 ]]; then
          SKILL_NAMES=()
          SKILL_NAME_OVERRIDE=1
        fi
        SKILL_NAMES+=("${2:-}")
        shift 2
        ;;
      --codex-home) CODEX_HOME="$(expand_home "${2:-}")"; shift 2 ;;
      --kiro-skills-dir) KIRO_SKILLS_DIR="$(expand_home "${2:-}")"; shift 2 ;;
      --no-build-compile) RUN_BUILD_COMPILE=0; shift ;;
      --no-build-java) RUN_BUILD_JAVA=0; shift ;;
      --help|-h) return 99 ;;
      *)
        echo "Unknown argument: $1" >&2
        return 2
        ;;
    esac
  done
  return 0
}

validate_common_config() {
  if [[ "$CLIENT" != "codex" && "$CLIENT" != "kiro" ]]; then
    echo "Invalid --client: $CLIENT" >&2
    exit 1
  fi

  CODEX_HOME="$(expand_home "$CODEX_HOME")"
  if [[ -n "$KIRO_SKILLS_DIR" ]]; then
    KIRO_SKILLS_DIR="$(expand_home "$KIRO_SKILLS_DIR")"
  fi

  dedupe_skill_names
  if [[ "${#SKILL_NAMES[@]}" -eq 0 ]]; then
    echo "No skills selected. Provide --skill-name <name> or omit --skill-name for defaults." >&2
    exit 1
  fi
}

ensure_node_build_deps() {
  local tsc_bin="$REPO_ROOT/node_modules/.bin/tsc"
  local tsc_alias_bin="$REPO_ROOT/node_modules/.bin/tsc-alias"
  if [[ -f "$tsc_bin" && -f "$tsc_alias_bin" ]]; then
    return
  fi
  echo "- Installing Node dependencies for TypeScript compile"
  if [[ -f "$REPO_ROOT/package-lock.json" ]]; then
    (cd "$REPO_ROOT" && npm ci --include=dev)
  else
    (cd "$REPO_ROOT" && npm install --include=dev)
  fi
}

run_build_compile() {
  if [[ "$RUN_BUILD_COMPILE" -eq 0 ]]; then
    echo "- Skipping build compile (--no-build-compile)"
    return
  fi
  ensure_node_build_deps
  echo "- Running npm run build:compile"
  (cd "$REPO_ROOT" && npm run build:compile)
}

run_build_java() {
  if [[ "$RUN_BUILD_JAVA" -eq 0 ]]; then
    echo "- Skipping Java build (--no-build-java)"
    return
  fi
  echo "- Running Maven Java agent build"
  (cd "$REPO_ROOT" && mvn -f java-agent/pom.xml package)
}

replace_skill_dir() {
  local dest_dir="$1"
  local guard_root="$2"
  if [[ -z "$dest_dir" || "$dest_dir" == "/" ]]; then
    echo "Refusing unsafe destination: '$dest_dir'" >&2
    exit 1
  fi
  case "$dest_dir" in
    "$guard_root"/*) ;;
    *)
      echo "Refusing destination outside skills root: $dest_dir" >&2
      echo "Expected root: $guard_root" >&2
      exit 1
      ;;
  esac
  rm -rf "$dest_dir"
}

sync_one_skill() {
  local source_dir="$1"
  local dest_dir="$2"
  local label="$3"
  local guard_root="$4"

  if [[ ! -d "$source_dir" ]]; then
    echo "$label source not found: $source_dir" >&2
    exit 1
  fi

  if [[ -d "$dest_dir" ]]; then
    echo "- $label: replacing existing folder"
    replace_skill_dir "$dest_dir" "$guard_root"
  else
    echo "- $label: installing new folder"
  fi

  mkdir -p "$(dirname "$dest_dir")"
  cp -R "$source_dir" "$dest_dir"
}

remove_retired_skill_if_present() {
  local skills_root="$1"
  local retired_dir="$skills_root/$RETIRED_SKILL_NAME"
  if [[ ! -d "$retired_dir" ]]; then
    return
  fi
  echo "- Removing retired skill: $retired_dir"
  replace_skill_dir "$retired_dir" "$skills_root"
}

sync_client_skills() {
  local skills_root="$1"
  local client_label="$2"

  remove_retired_skill_if_present "$skills_root"

  local skill_name
  for skill_name in "${SKILL_NAMES[@]}"; do
    sync_one_skill \
      "$REPO_ROOT/skills/$skill_name" \
      "$skills_root/$skill_name" \
      "$client_label skill ($skill_name)" \
      "$skills_root"
  done
}

run_skill_sync() {
  local mode_label="$1"
  validate_common_config

  echo "$mode_label started (client=$CLIENT)"
  echo "- Note: this flow syncs skills only. MCP config installation is not performed."

  run_build_compile
  run_build_java

  if [[ "$CLIENT" == "codex" ]]; then
    sync_client_skills "$CODEX_HOME/skills" "Codex"
  else
    if [[ -z "$KIRO_SKILLS_DIR" ]]; then
      KIRO_SKILLS_DIR="$(detect_kiro_skills_dir)"
    fi
    sync_client_skills "$KIRO_SKILLS_DIR" "Kiro"
  fi

  echo "$mode_label completed."
}

prompt_client_if_not_set() {
  if [[ "$CLIENT_FROM_ARG" -eq 1 ]]; then
    return
  fi
  local input=""
  while true; do
    read -r -p "Target orchestrator client (codex|kiro) [${CLIENT}]: " input
    if [[ -z "$input" ]]; then
      break
    fi
    if [[ "$input" == "codex" || "$input" == "kiro" ]]; then
      CLIENT="$input"
      break
    fi
    echo "Invalid value. Enter codex or kiro."
  done
}

resolve_target_skills_root() {
  if [[ "$CLIENT" == "codex" ]]; then
    printf '%s\n' "$CODEX_HOME/skills"
    return
  fi
  if [[ -z "$KIRO_SKILLS_DIR" ]]; then
    KIRO_SKILLS_DIR="$(detect_kiro_skills_dir)"
  fi
  printf '%s\n' "$KIRO_SKILLS_DIR"
}

prompt_yes_no_default_no() {
  local message="$1"
  local input=""
  while true; do
    read -r -p "$message [y/N]: " input
    if [[ -z "$input" ]]; then
      return 1
    fi
    if [[ "$input" =~ ^[Yy]$ ]]; then
      return 0
    fi
    if [[ "$input" =~ ^[Nn]$ ]]; then
      return 1
    fi
    echo "Please answer y or n."
  done
}

prompt_delete_stale_managed_skills() {
  local skills_root
  skills_root="$(resolve_target_skills_root)"
  if [[ ! -d "$skills_root" ]]; then
    echo "- Skills root not found yet ($skills_root); stale cleanup skipped."
    return
  fi

  local -A repo_managed=()
  local -a repo_skill_dirs=()
  local -a target_skill_dirs=()
  local -a stale_dirs=()
  local d name

  shopt -s nullglob
  repo_skill_dirs=("$REPO_ROOT"/skills/"$MANAGED_SKILL_PREFIX"*)
  for d in "${repo_skill_dirs[@]}"; do
    [[ -d "$d" ]] || continue
    name="$(basename "$d")"
    repo_managed["$name"]=1
  done

  target_skill_dirs=("$skills_root"/"$MANAGED_SKILL_PREFIX"*)
  shopt -u nullglob
  for d in "${target_skill_dirs[@]}"; do
    [[ -d "$d" ]] || continue
    name="$(basename "$d")"
    if [[ -z "${repo_managed[$name]+x}" ]]; then
      stale_dirs+=("$d")
    fi
  done

  if [[ "${#stale_dirs[@]}" -eq 0 ]]; then
    echo "- No stale managed skills detected under $skills_root"
    return
  fi

  echo "- Detected stale managed skills to delete (prefix: $MANAGED_SKILL_PREFIX):"
  for d in "${stale_dirs[@]}"; do
    echo "  - $d"
  done

  if ! prompt_yes_no_default_no "Delete the stale managed skills listed above?"; then
    echo "- Stale managed skill cleanup skipped by user."
    return
  fi

  for d in "${stale_dirs[@]}"; do
    echo "- Deleting stale managed skill: $d"
    replace_skill_dir "$d" "$skills_root"
  done
}

read_package_version() {
  local version
  version="$(node -p "require('./package.json').version" 2>/dev/null || true)"
  if [[ -n "$version" ]]; then
    printf '%s\n' "$version"
    return
  fi
  printf '%s\n' "unknown"
}

print_jar_upgrade_note() {
  local version="$1"
  cat <<EOF
Note:
- Latest MCP Java Dev Tools version: $version
- Update your target application's javaagent jar to this latest version.
- Example: replace older jar (e.g. 0.1.3) with latest version $version.
EOF
}
