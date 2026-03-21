#!/usr/bin/env bash
set -u
trap 'exit 0' ERR

# Fast-path no-op: exit before spawning Node if no active session.
# Primary check: .happytrails/.active file in the project directory.
# Fallback: HAPPYTRAILS_LOG env var (manual/advanced usage only —
# not set during normal hook invocations since Claude Code spawns
# a fresh process for each hook call).
#
# The ERR trap ensures the guard always exits 0, even if dirname,
# cd, or exec fails unexpectedly. This matches hook.js's philosophy:
# silently fail, never block the agent.

# Primary check: .active file in project root.
# Assumption: Claude Code sets PWD to the project root when invoking
# plugin hooks. If this assumption breaks, the guard false-negatives
# (no-ops when a session is active). hook.js has a secondary .active
# lookup via stdin's data.cwd field, so the worst case is a missed
# log entry — not an error. See "PWD assumption" in Assumptions section.
if [[ -f "${PWD}/.happytrails/.active" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  exec node "${SCRIPT_DIR}/hook.js"
fi

# Env var fallback — only effective when explicitly exported by the
# caller (e.g., manual testing, custom wrapper scripts). Checked
# second to match hook.js priority order (.active first, env var second).
# A stale HAPPYTRAILS_LOG in a shell profile would defeat the guard,
# so .active is the authoritative signal.
if [[ -n "${HAPPYTRAILS_LOG:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  exec node "${SCRIPT_DIR}/hook.js"
fi

exit 0
