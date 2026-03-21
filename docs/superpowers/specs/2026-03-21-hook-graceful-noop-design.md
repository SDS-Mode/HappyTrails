# Hook Graceful No-Op Spec

## Problem

The HappyTrails PostToolUse hook runs on every tool call via the plugin's `hooks.json`. When HappyTrails has no active session, the hook spawns a Node.js process, reads all of stdin, parses JSON, checks for an active session, and only then exits. This causes two problems:

1. **Visible hook errors** — Claude Code sometimes reports hook failures or timeouts in the session output, creating noise for the user.
2. **Unnecessary overhead** — Every tool call pays ~30-50ms of Node.js startup plus stdin I/O even when HappyTrails isn't in use.

## Requirements

1. When no HappyTrails session is active, the hook must exit with code 0 without spawning Node.js or reading stdin.
2. When a session is active, behavior must be identical to today — stdin forwarded to hook.js, entry appended to log.
3. The guard must not introduce new failure modes that produce visible errors in Claude Code.
4. The guard must complete in under 10ms on the no-op path.

## Design

### Bash guard wrapper

A new file `skills/happytrails/scripts/hook-guard.sh` acts as the hook entry point. It performs two fast filesystem/env checks and only spawns Node when there is work to do.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Fast-path no-op: exit before spawning Node if no active session.
# Primary check: .happytrails/.active file in the project directory.
# Fallback: HAPPYTRAILS_LOG env var (manual/advanced usage only —
# not set during normal hook invocations since Claude Code spawns
# a fresh process for each hook call).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Env var fallback — only effective when explicitly exported by the
# caller (e.g., manual testing, custom wrapper scripts).
[[ -n "${HAPPYTRAILS_LOG:-}" ]] && exec node "${SCRIPT_DIR}/hook.js"

# Primary check: .active file in project root.
# Assumption: Claude Code sets PWD to the project root when invoking
# plugin hooks. If this assumption breaks, the guard false-negatives
# (no-ops when a session is active). hook.js has a secondary .active
# lookup via stdin's cwd field, so the worst case is a missed log
# entry — not an error. See "PWD assumption" in Assumptions section.
[[ -f "${PWD}/.happytrails/.active" ]] && exec node "${SCRIPT_DIR}/hook.js"

exit 0
```

Note: `exec node` replaces the bash process with Node, so stdin is inherited automatically — no explicit forwarding needed.

### hooks.json change

The hook command changes from:

```json
"command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/happytrails/scripts/hook.js\""
```

to:

```json
"command": "bash \"${CLAUDE_PLUGIN_ROOT}/skills/happytrails/scripts/hook-guard.sh\""
```

### No changes to hook.js

hook.js stays as-is. When the guard forwards to it via `exec node`, it receives stdin and operates exactly as before.

## Failure Modes

**Guard script not found** (`CLAUDE_PLUGIN_ROOT` doesn't resolve): Bash fails with non-zero exit. This is a pre-existing plugin installation issue — the guard doesn't make it worse.

**Node fails to start** (when guard does forward): Same as today. hook.js wraps everything in try/catch and exits 0 on any error.

**Guard hangs**: Not possible — two `test` calls and an `exit`. No stdin reads, no network, no subprocesses (unless forwarding to Node).

**`PWD` doesn't point to project root**: Guard doesn't find `.active`, exits 0. This is a false-negative — a session may be active but the guard can't see it. This is acceptable: the tool call is silently dropped (one missed log entry), not an error. See Assumptions section.

**Race condition during session startup**: If `start-server.sh` is running but hasn't yet written `.active`, a simultaneous tool call will no-op. This is an existing race in hook.js (which checks the same `.active` file) — not a regression. The window is narrow (~100ms during server startup).

**Timeout budget**: The 5s timeout in hooks.json only matters when Node is spawned. The guard's bash-only path completes in under 5ms.

## Testing

Three manual scenarios:

**No active session (the main fix):**

```bash
unset HAPPYTRAILS_LOG
rm -f .happytrails/.active
echo '{"tool_name":"Bash"}' | bash scripts/hook-guard.sh
echo $?  # expect 0
```

**Active session via .active file:**

```bash
bash scripts/start-server.sh --project-dir "$PWD"
echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' | bash scripts/hook-guard.sh
# Verify entry appended to log.jsonl
```

**Active session via HAPPYTRAILS_LOG env var:**

```bash
rm -f .happytrails/.active
echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' | HAPPYTRAILS_LOG=/tmp/test.jsonl bash scripts/hook-guard.sh
# Verify entry appended to /tmp/test.jsonl
```

## Assumptions

**`.active` file format**: The `.active` file contains the absolute path to the session's `log.jsonl`. It is created by `start-server.sh` and removed by `stop-server.sh` or server shutdown. The guard only checks for the file's existence (`-f`); `hook.js` reads its content to discover the log path.

**PWD assumption**: The guard relies on Claude Code setting `PWD` to the project root when invoking plugin hooks. This must be verified empirically during implementation. If the assumption is wrong, the `.active` check will never match and the guard will always no-op — effectively disabling hook logging. In that case, the implementation must find an alternative way to discover the project directory without reading stdin (e.g., a stable env var set during session start, or a well-known path).

**HAPPYTRAILS_LOG is rarely set**: This env var is only set in the server process environment by `start-server.sh`. Claude Code spawns a fresh process for each hook invocation, so `HAPPYTRAILS_LOG` is not normally available. The guard's env var check exists as a belt-and-suspenders path for manual testing and custom wrapper scripts, not as a primary discovery mechanism.

## Scope

- One new file: `scripts/hook-guard.sh`
- One edit: `hooks/hooks.json` command field
- Update: `CLAUDE.md` architecture diagram and key files to reflect `hook-guard.sh` as the hook entry point
- No changes to hook.js, server.cjs, client.html, or SKILL.md
