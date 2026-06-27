#!/usr/bin/env bash
# Start the HappyTrails server and output connection info
# Usage: start-server.sh [--project-dir <path>] [--host <bind-host>] [--url-host <display-host>] [--owner-pid <pid>] [--transcript-path <path>] [--foreground] [--background]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PROJECT_DIR=""
FOREGROUND="false"
FORCE_BACKGROUND="false"
BIND_HOST="127.0.0.1"
URL_HOST=""
EXPLICIT_OWNER_PID=""
TRANSCRIPT_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --host) BIND_HOST="$2"; shift 2 ;;
    --url-host) URL_HOST="$2"; shift 2 ;;
    --owner-pid) EXPLICIT_OWNER_PID="$2"; shift 2 ;;
    --transcript-path) TRANSCRIPT_PATH="$2"; shift 2 ;;
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

# True if $1 is shaped like a HappyTrails session dir: either
# <project>/.happytrails/<pid>-<epoch> or /tmp/happytrails-<pid>-<epoch>.
# Gates rm -rf so a tampered .active pointer (or stray arg) can't redirect
# deletion at an arbitrary path.
ht_is_session_dir() {
  local d="$1"
  [[ -n "$d" ]] || return 1
  local base; base="$(basename "$d")"
  [[ "$base" == *-[0-9]* ]] || return 1
  case "$d/" in
    /tmp/happytrails-*/) return 0 ;;
  esac
  local parent; parent="$(dirname "$d")"
  [[ "$(basename "$parent")" == ".happytrails" ]]
}

# --- Duplicate session detection ---
# If an active session exists, stop its server before starting a new one
if [[ -n "$ACTIVE_FILE" && -f "$ACTIVE_FILE" ]]; then
  OLD_LOG="$(cat "$ACTIVE_FILE" 2>/dev/null)"
  if [[ -n "$OLD_LOG" ]]; then
    OLD_SESSION_DIR="$(dirname "$OLD_LOG")"
    OLD_PID_FILE="${OLD_SESSION_DIR}/.server.pid"
    if [[ -f "$OLD_PID_FILE" ]]; then
      old_pid=$(cat "$OLD_PID_FILE")
      if kill -0 "$old_pid" 2>/dev/null; then
        # Verify it's actually a node process (PID may have been recycled)
        old_comm=$(ps -o comm= -p "$old_pid" 2>/dev/null | tr -d ' ')
        if [[ -n "$old_comm" && "$old_comm" != node* ]]; then
          # PID recycled to non-node process — skip kill, clean up stale files
          :
        else
          # Either it's node (correct) or ps failed (can't tell — proceed with kill)
          kill "$old_pid" 2>/dev/null
          for i in {1..20}; do
            if ! kill -0 "$old_pid" 2>/dev/null; then break; fi
            sleep 0.1
          done
          if kill -0 "$old_pid" 2>/dev/null; then
            kill -9 "$old_pid" 2>/dev/null || true
            sleep 0.1
          fi
        fi
      fi
      rm -f "$OLD_PID_FILE"
    fi
    # Remove the orphaned old session dir so its log (captured commands, file
    # contents, secrets) doesn't accumulate on disk across sessions.
    if ht_is_session_dir "$OLD_SESSION_DIR" && [[ "$OLD_SESSION_DIR" != "$SESSION_DIR" ]]; then
      rm -rf "$OLD_SESSION_DIR" 2>/dev/null || true
    fi
  fi
  rm -f "$ACTIVE_FILE"
fi

mkdir -p "$SESSION_DIR"
# Lock the session dir to the owner so other local users can't read captured
# activity (commands, file contents, secrets) — important for the /tmp default,
# whose parent is world-listable.
chmod 700 "$SESSION_DIR" 2>/dev/null || true

# --- TTL sweep: reap session dirs left by sessions that died without being
# stopped (owner-process exit, idle timeout). Bounds sensitive-data buildup
# over weeks of use. Only project-local dirs accumulate this way; /tmp is
# reaped by the OS. KEEP_DAYS is configurable (default 7).
if [[ -n "$PROJECT_DIR" ]]; then
  HT_ROOT="${PROJECT_DIR}/.happytrails"
  KEEP_DAYS="${HAPPYTRAILS_KEEP_DAYS:-7}"
  if [[ -d "$HT_ROOT" && "$KEEP_DAYS" =~ ^[0-9]+$ ]]; then
    while IFS= read -r -d '' stale; do
      [[ "$stale" == "$SESSION_DIR" ]] && continue
      if ht_is_session_dir "$stale"; then
        rm -rf "$stale" 2>/dev/null || true
      fi
    done < <(find "$HT_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime "+$KEEP_DAYS" -print0 2>/dev/null)
  fi
fi

# --- Automatic .gitignore management ---
# Keep captured session data out of git — but only inside an actual git repo, so
# we never create a .gitignore in a gitless project (which would be surprising).
if [[ -n "$PROJECT_DIR" ]] && git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GITIGNORE="${PROJECT_DIR}/.gitignore"
  if [[ -f "$GITIGNORE" ]]; then
    if ! grep -qxF '.happytrails/' "$GITIGNORE"; then
      echo '.happytrails/' >> "$GITIGNORE"
    fi
  else
    echo '.happytrails/' > "$GITIGNORE"
  fi
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
  msys*|cygwin*|mingw*)
    OWNER_PID=""
    # Write launcher's PPID to lock file for Windows fallback detection
    # The server polls this PID since process.kill(pid,0) works on Windows Node.js
    LOCK_FILE="${SESSION_DIR}/.owner.lock"
    echo "$PPID" > "$LOCK_FILE"
    ;;
esac

if [[ -n "$TRANSCRIPT_PATH" ]]; then
  HT_SOURCE="transcript"
else
  HT_SOURCE="hook"
fi

if [[ "$FOREGROUND" == "true" ]]; then
  echo "$$" > "$PID_FILE"
  [[ -n "$ACTIVE_FILE" && -z "$TRANSCRIPT_PATH" ]] && echo "$LOG_FILE" > "$ACTIVE_FILE"
  env HAPPYTRAILS_DIR="$SESSION_DIR" HAPPYTRAILS_LOG="$LOG_FILE" HAPPYTRAILS_HOST="$BIND_HOST" HAPPYTRAILS_URL_HOST="$URL_HOST" HAPPYTRAILS_OWNER_PID="$OWNER_PID" HAPPYTRAILS_LOCK_FILE="${LOCK_FILE:-}" HAPPYTRAILS_SOURCE="$HT_SOURCE" HAPPYTRAILS_TRANSCRIPT_PATH="${TRANSCRIPT_PATH:-}" node server.cjs
  [[ -n "$ACTIVE_FILE" ]] && rm -f "$ACTIVE_FILE"
  exit $?
fi

nohup env HAPPYTRAILS_DIR="$SESSION_DIR" HAPPYTRAILS_LOG="$LOG_FILE" HAPPYTRAILS_HOST="$BIND_HOST" HAPPYTRAILS_URL_HOST="$URL_HOST" HAPPYTRAILS_OWNER_PID="$OWNER_PID" HAPPYTRAILS_LOCK_FILE="${LOCK_FILE:-}" HAPPYTRAILS_SOURCE="$HT_SOURCE" HAPPYTRAILS_TRANSCRIPT_PATH="${TRANSCRIPT_PATH:-}" node server.cjs > "$SERVER_LOG" 2>&1 &
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
    [[ -n "$ACTIVE_FILE" && -z "$TRANSCRIPT_PATH" ]] && echo "$LOG_FILE" > "$ACTIVE_FILE"
    grep "server-started" "$SERVER_LOG" | head -1
    exit 0
  fi
  sleep 0.1
done

echo '{"error": "Server failed to start within 5 seconds"}'
exit 1
