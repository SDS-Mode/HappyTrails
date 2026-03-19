# Zero-Friction Startup Spec

## Problem

The first `/happytrails` invocation cannot start a session. Instead, it registers a PostToolUse hook in `settings.json` and tells the user to restart Claude Code and run `/happytrails` again. This is the single largest friction point in the product — two manual steps before anything works.

The root cause is that hooks registered in `settings.json` require a Claude Code restart to take effect. The current architecture works around this with a copy-to-stable-path mechanism (`~/.happytrails/hook.js`) that avoids re-registration on version updates, but cannot avoid the first-time restart.

## Solution

Use plugin-level hook declaration (`hooks/hooks.json`) instead of agent-driven `settings.json` registration. Plugin hooks are loaded when the plugin is enabled — no restart needed beyond initial plugin install. This eliminates the restart tax entirely.

Additionally, simplify SKILL.md and add duplicate session detection and automatic `.gitignore` management to reduce other sources of friction.

## Design

### Precondition: stdin schema parity

This design assumes plugin-declared hooks receive the same stdin JSON schema as `settings.json` hooks — specifically that `data.cwd` is present, since `hook.js` uses it to locate `.active`. This assumption is based on the superpowers plugin using the same hook mechanism successfully. It must be verified before implementation by testing a plugin hook and inspecting the stdin payload.

### 1. Plugin-level hook registration

Ship a `hooks/hooks.json` file at `<repo-root>/hooks/hooks.json` — the same convention used by the superpowers plugin (`claude-plugins-official/superpowers/<version>/hooks/hooks.json`):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/happytrails/scripts/hook.js\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` is resolved by Claude Code at runtime to the current version's plugin directory. This eliminates both the version-path problem and the need for the `~/.happytrails/hook.js` copy mechanism.

The hook fires on every tool call across all projects. When no HappyTrails session is active, `hook.js` finds no `.active` file and exits immediately — zero overhead.

The 5-second timeout is inherited from the current `settings.json` configuration. This is generous for an append-only write but matches existing behavior.

### 2. SKILL.md simplification

The current SKILL.md has 7 steps with branching logic (check hook, copy hook, register or start, restart gate). The new SKILL.md reduces to 2 linear steps:

1. Start the server:
   ```bash
   <SKILL_DIR>/scripts/start-server.sh --project-dir <CWD> --owner-pid <PPID>
   ```
2. Tell the user to open the URL.

No hook registration. No copy step. No restart gate. No branching. Duplicate session detection is handled by `start-server.sh` (section 3), not by the agent.

The "Important" notes section is reduced to:
- The server auto-exits when Claude Code exits, or after 30 minutes of inactivity
- Session files persist in `<project>/.happytrails/` for later reference

### 3. Duplicate session detection

Add detection to `start-server.sh` so running `/happytrails` twice doesn't orphan a server. `start-server.sh` is the sole owner of this logic — SKILL.md does not check for active sessions.

On startup, before creating a new session:
1. Check if `<project>/.happytrails/.active` exists
2. If it does, read the log path to derive the session directory
3. Check if that session's `.server.pid` process is still running
4. If running, stop it (same logic as `stop-server.sh`: SIGTERM, poll, SIGKILL fallback). If the PID file exists but the process is no longer running, treat it as a stale PID file and clean up without sending signals.
5. Remove the stale `.active` file
6. Proceed with new session startup

This lives in `start-server.sh` — deterministic shell logic, not agent-interpreted.

### 4. Automatic `.gitignore` management

Add a check to `start-server.sh` after creating the session directory:
- If `<project>/.gitignore` exists but doesn't contain an exact line `.happytrails/`, append it. Other variants (`.happytrails`, `/.happytrails/`, `.happytrails/*`) are the user's responsibility — exact line match for `.happytrails/` is sufficient.
- If `<project>/.gitignore` doesn't exist, create it with `.happytrails/` as the sole entry.

This removes the manual "add to .gitignore" note from SKILL.md.

### 5. Remove dead code

With plugin hooks handling registration, the following are removed:

- **`~/.happytrails/` directory and copy mechanism** — SKILL.md no longer creates this directory or copies `hook.js` to it. Existing `~/.happytrails/` directories on user machines are left as harmless orphaned files — no active cleanup.
- **Hook registration logic in SKILL.md** — the check-settings, copy, register, restart-gate flow
- **All "Important" notes** about stable paths, hook copying, and version-independent registration

### 6. Migration: deduplicate hook firing

Existing users will have a `node ~/.happytrails/hook.js` entry in their global `settings.json` from prior versions. With the new plugin hook, both hooks fire on every tool call, producing duplicate log entries.

To handle this automatically, add a deduplication guard to `hook.js`: before appending, compare the current entry's `tool` name and a hash of `tool_input` against the last line in the log file. Both hook invocations receive identical stdin from Claude Code for the same tool event, so these fields are deterministic — no timestamp tolerance needed. If they match, skip the write. This is cheap (read last line of file, compare two fields) and handles the double-firing case silently regardless of whether the user reads release notes.

Release notes should still instruct users to remove the old hook entry from `~/.claude/settings.json` for cleanliness, but the dedup guard ensures correctness without user action.

This adds `hook.js` to the changed files list. The dedup guard is a permanent, low-cost safety net — not a temporary migration shim.

Note: the `.active` file is now the sole discovery path for the hook. The `HAPPYTRAILS_LOG` env var fallback (previously set via `settings.json` hook configuration) is no longer relevant since plugin hooks don't set environment variables. `hook.js` still supports the env var as a fallback but it will not be set in practice.

## Files Changed

| File | Change |
|------|--------|
| `hooks/hooks.json` | **New** — plugin-level PostToolUse hook declaration |
| `skills/happytrails/SKILL.md` | **Rewrite** — remove all hook logic, reduce to 2 linear steps |
| `skills/happytrails/scripts/hook.js` | **Modify** — add deduplication guard for migration double-firing |
| `skills/happytrails/scripts/start-server.sh` | **Modify** — add duplicate session detection, add `.gitignore` management |
| `skills/happytrails-stop/SKILL.md` | **Modify** — remove stale reference to `settings.json` hook |
| `docs/future-features.md` | **Modify** — add auto-open browser, session cleanup, stop skill path fix |

No changes to `server.cjs`, `client.html`, or `stop-server.sh`.

## Out of Scope

These items are documented in `docs/future-features.md` for a future spec:

- **Auto-open browser** — automatically open the URL after server start
- **Session directory cleanup** — prune old `.happytrails/<session-id>/` directories by age or count
- **Stop skill path fix** — `happytrails-stop` uses a fragile relative path (`<SKILL_DIR>/../happytrails/scripts/stop-server.sh`) that should be made more robust

## Testing

1. Fresh install: run `/happytrails` — server starts immediately, no restart prompt
2. Second `/happytrails` in same project: old session is stopped, new session starts cleanly
3. Plugin version update: run `/happytrails` after update — hook resolves to new version automatically
4. `.gitignore`: verify `.happytrails/` is added on first session start, not duplicated on subsequent starts
5. No active session: verify `hook.js` exits silently when no `.active` file exists (zero overhead)
6. Migration: install new version with existing `settings.json` hook entry — verify no duplicate log entries (dedup guard works)
7. Migration: remove old `settings.json` hook entry — verify single clean log entries continue
8. Verify `hook.js` still works correctly when `cwd` is provided in stdin JSON (plugin hooks use the same stdin schema as settings.json hooks)
