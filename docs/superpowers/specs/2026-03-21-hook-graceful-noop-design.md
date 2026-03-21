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
```

**Design rationale:**

- **`set -u` without `-e` or `pipefail`**: `-u` catches typos in variable names. `-e` (errexit) is intentionally omitted because `[[ ]] && exec` on older bash (3.2, macOS default) can trigger unexpected non-zero exits. `-o pipefail` is omitted because there are no pipelines. The `trap 'exit 0' ERR` provides defense-in-depth: any unexpected failure exits 0 rather than producing a visible error in Claude Code.
- **`SCRIPT_DIR` computed inside conditionals**: The `$(cd ... && pwd)` subshell is the most expensive bash operation (~3ms). Moving it after the checks means the no-op path never pays this cost — just two `test` builtins (~1ms total including bash startup).
- **Check order matches hook.js**: `.active` file first, `HAPPYTRAILS_LOG` second. This matches the priority order in `hook.js` (lines 27-36) and prevents a stale env var from defeating the guard.
- **`exec node` replaces the bash process**: stdin is inherited automatically — no explicit forwarding needed. If `exec` fails (node not found, hook.js missing), the ERR trap catches it and exits 0.

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

hook.js stays as-is. When the guard forwards to it via `exec node`, it receives stdin and operates exactly as before. The dedup guard in hook.js (lines 53-74) remains necessary for the migration period where both settings.json and plugin hooks may be active simultaneously.

## Failure Modes

**Guard script not found** (`CLAUDE_PLUGIN_ROOT` doesn't resolve): Bash fails, ERR trap fires, exits 0. Claude Code sees a clean exit. This is a pre-existing plugin installation issue.

**`exec node` fails** (node not found, hook.js missing): ERR trap fires, exits 0. No worse than today's direct invocation — just quieter since the trap prevents a non-zero exit code.

**Guard hangs**: Not possible — two `test` calls and an `exit`. No stdin reads, no network, no subprocesses (unless forwarding to Node).

**`PWD` doesn't point to project root**: Guard doesn't find `.active`, falls through to env var check. If both miss, exits 0. This is a false-negative — a session may be active but the guard can't see it. Acceptable: one missed log entry, not an error. See Assumptions section.

**Stale `.active` file** (session ended but file not removed, e.g., SIGKILL): Guard forwards to Node unnecessarily. hook.js reads the stale path, `appendFileSync` may fail (swallowed by catch), exits 0. The no-op optimization is defeated but no error is produced. This is an existing condition — `start-server.sh` line 136 only cleans up on normal exit.

**Empty `.active` file** (truncated by race or disk-full): Guard sees `-f` as true, forwards to Node. hook.js reads empty string, falls through to env var (unset), exits 0 silently. Benign.

**Race condition during session startup**: If `start-server.sh` is running but hasn't yet written `.active`, a simultaneous tool call will no-op. Note: the guard and hook.js use different mechanisms to find `.active` — the guard uses `PWD`, hook.js uses `data.cwd` from stdin. The end result is the same (no log entry during the ~100ms startup window), but they are not literally the same check.

**Concurrent hook invocations**: Multiple tool calls in parallel each spawn their own guard instance. All may forward to Node simultaneously. This is safe because `hook.js` uses `appendFileSync`, which is atomic for small writes at the OS level.

**Subagent invocations**: When Claude Code spawns subagents, hook invocations for subagent tool calls should have the same `PWD` as the parent. If they don't, the guard false-negatives for subagent calls. This must be verified empirically alongside the PWD assumption.

**Timeout budget**: The 5s timeout in hooks.json only matters when Node is spawned. The guard's bash-only no-op path completes in under 5ms (bash startup + two builtins, no subshell).

## Testing

Four manual scenarios:

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

**Timing verification:**

```bash
unset HAPPYTRAILS_LOG
rm -f .happytrails/.active
time (echo '{}' | bash scripts/hook-guard.sh)
# Expect real < 10ms
```

**PWD verification** (run during a live Claude Code session):

```bash
# Add temporary logging to hook-guard.sh during implementation:
# echo "PWD=$PWD" >> /tmp/hook-guard-debug.log
# Then check that PWD matches the project root after a few tool calls.
```

## Assumptions

**`.active` file format**: The `.active` file contains the absolute path to the session's `log.jsonl`. It is created by `start-server.sh` and removed by `stop-server.sh` or server shutdown. The guard only checks for the file's existence (`-f`); `hook.js` reads its content to discover the log path.

**PWD assumption**: The guard relies on Claude Code setting `PWD` to the project root when invoking plugin hooks. This must be verified empirically during implementation. If the assumption is wrong, the `.active` check will never match and the guard will always no-op — effectively disabling hook logging. In that case, the implementation must find an alternative way to discover the project directory without reading stdin (e.g., a stable env var set during session start, or a well-known path). Note: `PWD` (shell environment) and `data.cwd` (stdin JSON field used by hook.js) come from different sources and could diverge in future Claude Code updates.

**HAPPYTRAILS_LOG is rarely set**: This env var is only set in the server process environment by `start-server.sh`. Claude Code spawns a fresh process for each hook invocation, so `HAPPYTRAILS_LOG` is not normally available. The guard's env var check exists as a belt-and-suspenders path for manual testing and custom wrapper scripts, not as a primary discovery mechanism. A stale `HAPPYTRAILS_LOG` in a user's shell profile would cause the guard to always forward to Node, defeating the optimization.

**`.happytrails/` trust boundary**: The `.happytrails/` directory is assumed to be under the same trust boundary as the project root. The guard does not defend against symlink attacks on `.active` because an attacker with write access to the project directory could modify the hook script itself.

**Bash availability**: The guard requires bash. This is universally available on Linux and macOS. On Windows (MSYS/Cygwin), bash is available if Git Bash or MSYS2 is installed, which is typical for Claude Code users. If bash is not available, the hook command will fail — the same way it would fail today if node were unavailable. This is a known limitation, not a regression.

## Scope

- One new file: `scripts/hook-guard.sh`
- One edit: `hooks/hooks.json` command field
- Update: `CLAUDE.md` architecture diagram and key files to reflect `hook-guard.sh` as the hook entry point
- No changes to hook.js, server.cjs, client.html, or SKILL.md

### Out of scope

**Version-independent hook path** (`~/.happytrails/hook.js`): The [version-independent hook spec](2026-03-18-version-independent-hook.md) copies `hook.js` to a stable path for the settings.json hook. That path bypasses this guard entirely — users with the settings.json hook still pay full Node.js startup cost. Extending the guard to that path (e.g., copying `hook-guard.sh` to `~/.happytrails/` and updating the registered command) is a follow-up task, not part of this spec.

**`update-plugin.sh`**: The new `hook-guard.sh` lives under `skills/happytrails/scripts/`, which is already included in the plugin sync. No changes to the update script are needed.
