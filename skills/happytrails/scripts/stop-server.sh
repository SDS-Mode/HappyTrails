#!/usr/bin/env bash
# Stop the HappyTrails server and clean up
# Usage: stop-server.sh <session_dir> [--project-dir <path>]

SESSION_DIR=""
PROJECT_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    *) SESSION_DIR="$1"; shift ;;
  esac
done

if [[ -z "$SESSION_DIR" ]]; then
  echo '{"error": "Usage: stop-server.sh <session_dir> [--project-dir <path>]"}'
  exit 1
fi

# True if $1 is shaped like a HappyTrails session dir: either
# <project>/.happytrails/<pid>-<epoch> or /tmp/happytrails-<pid>-<epoch>.
# Gates rm -rf so a stray arg can't redirect deletion at an arbitrary path.
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

PID_FILE="${SESSION_DIR}/.server.pid"
if [[ -f "$PID_FILE" ]]; then
  pid=$(cat "$PID_FILE")
  kill "$pid" 2>/dev/null || true
  for i in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.1
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo '{"status": "failed", "error": "process still running"}'
    exit 1
  fi
  rm -f "$PID_FILE" "${SESSION_DIR}/.server.log"

  # Remove .active pointer so hook stops writing
  if [[ -n "$PROJECT_DIR" ]]; then
    rm -f "${PROJECT_DIR}/.happytrails/.active"
  else
    # Infer project dir: session_dir is <project>/.happytrails/<session-id>
    PARENT_DIR="$(dirname "$SESSION_DIR")"
    if [[ "$(basename "$PARENT_DIR")" == ".happytrails" ]]; then
      rm -f "${PARENT_DIR}/.active"
    fi
  fi

  # Remove the whole session dir (project-local too, not just /tmp) so its log
  # (captured commands, file contents, secrets) doesn't linger after stop.
  # Guarded so a stray arg can't direct rm -rf at an arbitrary path.
  if ht_is_session_dir "$SESSION_DIR"; then
    rm -rf "$SESSION_DIR" 2>/dev/null || true
  fi
  echo '{"status": "stopped"}'
else
  echo '{"status": "not_running"}'
fi
