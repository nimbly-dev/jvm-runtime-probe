#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Run a Spring app with MCP Java agent wiring in a new Git Bash window.

Usage:
  ./spring-integration/run-spring-app-with-mcp.sh [options]

Options:
  --project <absPath>       Absolute path to Spring project
  --app-port <port>         Spring server port (default: 8080)
  --jdk21-compat            Add allowJava21=true in javaagent options
  --jdwp-port <port>        Optional JDWP debug port
  --agent-port-start <port> Start scanning probe agent port from this value (default: 9173)
  --help                    Show help
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROJECT_PATH=""
APP_PORT="8080"
JDK21_COMPAT=0
JDK21_COMPAT_EXPLICIT=0
JDWP_PORT=""
AGENT_PORT_START="9173"
AGENT_EXCLUDE="com.nimbly.mcpjavadevtools.agent.**,**.config.**,**Test"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_PATH="${2:-}"; shift 2 ;;
    --app-port) APP_PORT="${2:-}"; shift 2 ;;
    --jdk21-compat) JDK21_COMPAT=1; JDK21_COMPAT_EXPLICIT=1; shift ;;
    --jdwp-port) JDWP_PORT="${2:-}"; shift 2 ;;
    --agent-port-start) AGENT_PORT_START="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

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

prompt_optional() {
  local label="$1"
  local result
  read -r -p "$label: " result
  printf '%s\n' "$result"
}

if [[ -z "$PROJECT_PATH" ]]; then
  PROJECT_PATH="$(prompt_optional "Spring project absolute path")"
fi
APP_PORT="$(prompt_default "Spring app port" "$APP_PORT")"
if [[ "$JDK21_COMPAT_EXPLICIT" -eq 0 ]]; then
  read -r -p "Enable Java 21 compatibility mode? [y/N]: " compat_input
  if [[ "$compat_input" =~ ^[Yy]$ ]]; then
    JDK21_COMPAT=1
  fi
fi
if [[ -z "$JDWP_PORT" ]]; then
  JDWP_PORT="$(prompt_optional "JDWP port (optional, leave empty to skip)")"
fi

normalize_project_path() {
  local input_path="$1"
  if [[ "$input_path" =~ ^[A-Za-z]:\\ ]]; then
    if command -v cygpath >/dev/null 2>&1; then
      cygpath -u "$input_path"
      return
    fi
  fi
  if [[ "$input_path" == /* ]]; then
    echo "$input_path"
    return
  fi
  echo ""
}

PROJECT_PATH="$(normalize_project_path "$PROJECT_PATH")"
if [[ -z "$PROJECT_PATH" ]]; then
  echo "project path must be an absolute path (Unix or Windows)." >&2
  exit 1
fi
if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "project path does not exist: $PROJECT_PATH" >&2
  exit 1
fi
if [[ ! "$APP_PORT" =~ ^[0-9]+$ ]]; then
  echo "app port must be numeric: $APP_PORT" >&2
  exit 1
fi
if [[ -n "$JDWP_PORT" && ! "$JDWP_PORT" =~ ^[0-9]+$ ]]; then
  echo "jdwp port must be numeric: $JDWP_PORT" >&2
  exit 1
fi
if [[ ! "$AGENT_PORT_START" =~ ^[0-9]+$ ]]; then
  echo "agent-port-start must be numeric: $AGENT_PORT_START" >&2
  exit 1
fi

PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"

infer_base_package() {
  local project_root="$1"
  local java_root="$project_root/src/main/java"
  if [[ ! -d "$java_root" ]]; then
    echo ""
    return
  fi

  local first_java rel_path rel_dir
  first_java="$(find "$java_root" -type f -name "*.java" | LC_ALL=C sort | head -n1 || true)"
  if [[ -z "$first_java" ]]; then
    echo ""
    return
  fi

  rel_path="${first_java#$java_root/}"
  rel_dir="$(dirname "$rel_path")"
  if [[ -z "$rel_dir" || "$rel_dir" == "." ]]; then
    echo ""
    return
  fi
  echo "${rel_dir//\//.}"
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | grep -q ":$port "
    return
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | tail -n +2 | awk '{print $4}' | grep -Eq "[:.]$port$"
    return
  fi
  netstat -an 2>/dev/null | grep -Eq "[:.]$port[[:space:]]"
}

find_free_port() {
  local start="$1"
  local p="$start"
  while port_in_use "$p"; do
    p=$((p + 1))
  done
  echo "$p"
}

find_agent_jar() {
  local jar
  jar="$(ls -1 "$REPO_ROOT"/java-agent/core/core-probe/target/mcp-java-dev-tools-agent-*-all.jar 2>/dev/null | LC_ALL=C sort | tail -n1 || true)"
  echo "$jar"
}

select_run_command() {
  local project_root="$1"
  if [[ -x "$project_root/mvnw" ]]; then
    echo "./mvnw -q spring-boot:run -Dspring-boot.run.arguments=--server.port=$APP_PORT"
    return
  fi
  if [[ -f "$project_root/pom.xml" ]]; then
    echo "mvn -q spring-boot:run -Dspring-boot.run.arguments=--server.port=$APP_PORT"
    return
  fi
  if [[ -x "$project_root/gradlew" ]]; then
    echo "./gradlew -q bootRun --args='--server.port=$APP_PORT'"
    return
  fi
  if [[ -f "$project_root/build.gradle" || -f "$project_root/build.gradle.kts" ]]; then
    echo "gradle -q bootRun --args='--server.port=$APP_PORT'"
    return
  fi
  echo ""
}

find_git_bash_exe() {
  local candidates=(
    "/c/Program Files/Git/git-bash.exe"
    "/c/Program Files (x86)/Git/git-bash.exe"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -f "$c" ]]; then
      echo "$c"
      return
    fi
  done
  echo ""
}

BASE_PACKAGE="$(infer_base_package "$PROJECT_PATH")"
if [[ -z "$BASE_PACKAGE" ]]; then
  echo "Could not infer base package from $PROJECT_PATH/src/main/java. Provide a standard package layout first." >&2
  exit 1
fi

AGENT_PORT="$(find_free_port "$AGENT_PORT_START")"
AGENT_JAR="$(find_agent_jar)"
if [[ -z "$AGENT_JAR" ]]; then
  echo "Java agent jar not found. Run ./scripts/install.sh or ./scripts/update.sh first." >&2
  exit 1
fi

RUN_COMMAND="$(select_run_command "$PROJECT_PATH")"
if [[ -z "$RUN_COMMAND" ]]; then
  echo "No Spring run command detected (expected mvnw/maven or gradlew/gradle)." >&2
  exit 1
fi

AGENT_OPTS="host=127.0.0.1;port=$AGENT_PORT;include=$BASE_PACKAGE.**;exclude=$AGENT_EXCLUDE"
if [[ "$JDK21_COMPAT" -eq 1 ]]; then
  AGENT_OPTS="$AGENT_OPTS;allowJava21=true"
fi

JAVA_AGENT_ARG="-javaagent:$AGENT_JAR=$AGENT_OPTS"
JDWP_ARG=""
if [[ -n "$JDWP_PORT" ]]; then
  JDWP_ARG="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:$JDWP_PORT"
fi

LAUNCH_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/mcp-spring-run-XXXXXX.sh")"
cat >"$LAUNCH_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$PROJECT_PATH"
export JAVA_TOOL_OPTIONS="\${JAVA_TOOL_OPTIONS:-} $JAVA_AGENT_ARG $JDWP_ARG"
echo "MCP probe base URL: http://127.0.0.1:$AGENT_PORT"
echo "Inferred include base package: $BASE_PACKAGE.**"
echo "Spring app port: $APP_PORT"
if [[ -n "$JDWP_PORT" ]]; then
  echo "JDWP debug port: $JDWP_PORT"
fi
echo "Executing: $RUN_COMMAND"
eval "$RUN_COMMAND"
EOF
chmod +x "$LAUNCH_SCRIPT"

GIT_BASH_EXE="$(find_git_bash_exe)"

echo "Prepared Spring run launch:"
echo "- project: $PROJECT_PATH"
echo "- spring port: $APP_PORT"
echo "- probe port: $AGENT_PORT"
echo "- include: $BASE_PACKAGE.**"
if [[ -n "$JDWP_PORT" ]]; then
  echo "- jdwp: $JDWP_PORT"
else
  echo "- jdwp: (disabled)"
fi

if [[ -n "$GIT_BASH_EXE" && -x "$(command -v powershell.exe || true)" ]]; then
  GIT_BASH_WIN="$(cygpath -w "$GIT_BASH_EXE" 2>/dev/null || echo "$GIT_BASH_EXE")"
  LAUNCH_UNIX="${LAUNCH_SCRIPT//\\/\/}"
  powershell.exe -NoProfile -Command "Start-Process -WindowStyle Normal -FilePath '$GIT_BASH_WIN' -ArgumentList @('-lc','bash \"$LAUNCH_UNIX\"')" >/dev/null
  echo "Spawned new Git Bash window."
  exit 0
fi

echo "Could not open a new Git Bash window automatically; running in current shell."
bash "$LAUNCH_SCRIPT"
