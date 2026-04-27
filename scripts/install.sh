#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/skills-sync-common.sh"

usage() {
  cat <<'EOF'
mcp-java-dev-tools install.sh

Builds TypeScript + Java agent and syncs local shipped skills into Codex/Kiro skill folders.
This script does not install MCP config entries.

Usage:
  ./scripts/install.sh [options]

EOF
  usage_common
}

if ! parse_common_args "$@"; then
  code=$?
  if [[ "$code" -eq 99 ]]; then
    usage
    exit 0
  fi
  usage
  exit "$code"
fi

prompt_client_if_not_set
run_skill_sync "Install"
