#!/usr/bin/env bash
# Start the HappyTrails server and output connection info
# Usage: start-server.sh [--project-dir <path>] [--host <bind-host>] [--url-host <display-host>] [--owner-pid <pid>] [--foreground] [--background]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PROJECT_DIR=""
FOREGROUND="false"
FORCE_BACKGROUND="false"
BIND_HOST="127.0.0.1"
URL_HOST=""
EXPLICIT_OWNER_PID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --host) BIND_HOST="$2"; shift 2 ;;
    --url-host) URL_HOST="$2"; shift 2 ;;
    --owner-pid) EXPLICIT_OWNER_PID="$2"; shift 2 ;;
    --foreground|--no-daemon) FOREGROUND="true"; shift ;;
    --background|--daemon) FORCE_BACKGROUND="true"; shift ;;
    *) echo "{\"error\": \"Unknown argument: $1\"}"; exit 1 ;;
  esac
done

if [[ -z "$URL_HOST" ]]; then
  if [[ "$BIND_HOST" == "127.0.0.1" || "$BIND_HOST" == "localhost" ]]; then
    URL_HOST="localhost"
  else
    URL_HOST="$BIND_HOST"
  fi
fi

if [[ -n "${CODEX_CI:-}" && "$FOREGROUND" != "true" && "$FORCE_BACKGROUND" != "true" ]]; then
  FOREGROUND="true"
fi
if [[ "$FOREGROUND" != "true" && "$FORCE_BACKGROUND" != "true" ]]; then
  case "${OSTYPE:-}" in
    msys*|cygwin*|mingw*) FOREGROUND="true" ;;
  esac
  if [[ -n "${MSYSTEM:-}" ]]; then FOREGROUND="true"; fi
fi

SESSION_ID="$$-$(date +%s)"
if [[ -n "$PROJECT_DIR" ]]; then
  SESSION_DIR="${PROJECT_DIR}/.happytrails/${SESSION_ID}"
else
  SESSION_DIR="/tmp/happytrails-${SESSION_ID}"
fi

LOG_FILE="${SESSION_DIR}/log.jsonl"
PID_FILE="${SESSION_DIR}/.server.pid"
SERVER_LOG="${SESSION_DIR}/.server.log"

ACTIVE_FILE="${PROJECT_DIR:+${PROJECT_DIR}/.happytrails/.active}"

mkdir -p "$SESSION_DIR"

if [[ -f "$PID_FILE" ]]; then
  old_pid=$(cat "$PID_FILE")
  kill "$old_pid" 2>/dev/null
  rm -f "$PID_FILE"
fi

cd "$SCRIPT_DIR"

if [[ -n "$EXPLICIT_OWNER_PID" ]]; then
  OWNER_PID="$EXPLICIT_OWNER_PID"
else
  OWNER_PID="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')"
  if [[ -z "$OWNER_PID" || "$OWNER_PID" == "1" ]]; then
    OWNER_PID="$PPID"
  fi
fi
case "${OSTYPE:-}" in
  msys*|cygwin*|mingw*) OWNER_PID="" ;;
esac

if [[ "$FOREGROUND" == "true" ]]; then
  echo "$$" > "$PID_FILE"
  [[ -n "$ACTIVE_FILE" ]] && echo "$LOG_FILE" > "$ACTIVE_FILE"
  env HAPPYTRAILS_DIR="$SESSION_DIR" HAPPYTRAILS_LOG="$LOG_FILE" HAPPYTRAILS_HOST="$BIND_HOST" HAPPYTRAILS_URL_HOST="$URL_HOST" HAPPYTRAILS_OWNER_PID="$OWNER_PID" node server.cjs
  [[ -n "$ACTIVE_FILE" ]] && rm -f "$ACTIVE_FILE"
  exit $?
fi

nohup env HAPPYTRAILS_DIR="$SESSION_DIR" HAPPYTRAILS_LOG="$LOG_FILE" HAPPYTRAILS_HOST="$BIND_HOST" HAPPYTRAILS_URL_HOST="$URL_HOST" HAPPYTRAILS_OWNER_PID="$OWNER_PID" node server.cjs > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null
echo "$SERVER_PID" > "$PID_FILE"

for i in {1..50}; do
  if grep -q "server-started" "$SERVER_LOG" 2>/dev/null; then
    alive="true"
    for _ in {1..20}; do
      if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        alive="false"
        break
      fi
      sleep 0.1
    done
    if [[ "$alive" != "true" ]]; then
      echo "{\"error\": \"Server started but was killed. Retry with: $SCRIPT_DIR/start-server.sh${PROJECT_DIR:+ --project-dir $PROJECT_DIR} --host $BIND_HOST --url-host $URL_HOST --foreground\"}"
      exit 1
    fi
    [[ -n "$ACTIVE_FILE" ]] && echo "$LOG_FILE" > "$ACTIVE_FILE"
    grep "server-started" "$SERVER_LOG" | head -1
    exit 0
  fi
  sleep 0.1
done

echo '{"error": "Server failed to start within 5 seconds"}'
exit 1
