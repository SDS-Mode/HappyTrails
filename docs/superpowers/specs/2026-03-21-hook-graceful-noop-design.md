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
# Fast-path no-op: exit before spawning Node if no active session.
# Checks two signals:
#   1. HAPPYTRAILS_LOG env var (set when session is running via env)
#   2. .happytrails/.active file in the project directory

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Fast checks — no Node, no stdin read
[[ -n "${HAPPYTRAILS_LOG:-}" ]] && exec node "${SCRIPT_DIR}/hook.js"

# Derive project dir: Claude Code sets PWD to the project root when
# invoking hooks. Check for .active without reading stdin.
[[ -f "${PWD}/.happytrails/.active" ]] && exec node "${SCRIPT_DIR}/hook.js"

exit 0
```

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

**`PWD` doesn't point to project root**: Guard doesn't find `.active`, exits 0. If `HAPPYTRAILS_LOG` is also unset, the hook no-ops correctly — if we can't find an active session, there's nothing to do.

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
HAPPYTRAILS_LOG=/tmp/test.jsonl echo '{"tool_name":"Bash"}' | bash scripts/hook-guard.sh
# Verify entry appended to /tmp/test.jsonl
```

## Scope

- One new file: `scripts/hook-guard.sh`
- One edit: `hooks/hooks.json` command field
- No changes to hook.js, server.cjs, client.html, or SKILL.md
