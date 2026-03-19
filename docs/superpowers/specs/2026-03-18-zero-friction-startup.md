# Zero-Friction Startup Spec

## Problem

The first `/happytrails` invocation cannot start a session. Instead, it registers a PostToolUse hook in `settings.json` and tells the user to restart Claude Code and run `/happytrails` again. This is the single largest friction point in the product — two manual steps before anything works.

The root cause is that hooks registered in `settings.json` require a Claude Code restart to take effect. The current architecture works around this with a copy-to-stable-path mechanism (`~/.happytrails/hook.js`) that avoids re-registration on version updates, but cannot avoid the first-time restart.

## Solution

Use plugin-level hook declaration (`hooks/hooks.json`) instead of agent-driven `settings.json` registration. Plugin hooks are loaded when the plugin is enabled — no restart needed beyond initial plugin install. This eliminates the restart tax entirely.

Additionally, simplify SKILL.md and add duplicate session detection and automatic `.gitignore` management to reduce other sources of friction.

## Design

### 1. Plugin-level hook registration

Ship a `hooks/hooks.json` file in the plugin root:

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

### 2. SKILL.md simplification

The current SKILL.md has 7 steps with branching logic (check hook, copy hook, register or start, restart gate). The new SKILL.md reduces to 3 linear steps:

1. Check for an existing active session — read `<CWD>/.happytrails/.active`. If it exists and the server is still running, stop it first.
2. Start the server:
   ```bash
   <SKILL_DIR>/scripts/start-server.sh --project-dir <CWD> --owner-pid <PPID>
   ```
3. Tell the user to open the URL.

No hook registration. No copy step. No restart gate. No branching.

The "Important" notes section is reduced to:
- The server auto-exits when Claude Code exits, or after 30 minutes of inactivity
- Session files persist in `<project>/.happytrails/` for later reference

### 3. Duplicate session detection

Add detection to `start-server.sh` so running `/happytrails` twice doesn't orphan a server.

On startup, before creating a new session:
1. Check if `<project>/.happytrails/.active` exists
2. If it does, read the log path to derive the session directory
3. Check if that session's `.server.pid` process is still running
4. If running, stop it (same logic as `stop-server.sh`: SIGTERM, poll, SIGKILL fallback)
5. Remove the stale `.active` file
6. Proceed with new session startup

This lives in `start-server.sh` — deterministic shell logic, not agent-interpreted.

### 4. Automatic `.gitignore` management

Add a check to `start-server.sh` after creating the session directory:
- If `<project>/.gitignore` exists but doesn't contain `.happytrails/`, append it
- If `<project>/.gitignore` doesn't exist, create it with `.happytrails/` as the sole entry

This removes the manual "add to .gitignore" note from SKILL.md.

### 5. Remove dead code

With plugin hooks handling registration, the following are removed:

- **`~/.happytrails/` directory and copy mechanism** — SKILL.md no longer creates this directory or copies `hook.js` to it
- **Hook registration logic in SKILL.md** — the check-settings, copy, register, restart-gate flow
- **All "Important" notes** about stable paths, hook copying, and version-independent registration

### 6. Migration: remove stale settings.json hook

Existing users will have a `node ~/.happytrails/hook.js` entry in their global `settings.json` from prior versions. With the new plugin hook, this would cause double-firing.

This is a one-time migration concern, not a permanent part of SKILL.md. Handle it via:
- Release notes instructing users to remove the old hook entry from `~/.claude/settings.json`
- Optionally, a one-time migration script shipped with the release

After the current user population has upgraded, this concern is retired.

## Files Changed

| File | Change |
|------|--------|
| `hooks/hooks.json` | **New** — plugin-level PostToolUse hook declaration |
| `skills/happytrails/SKILL.md` | **Rewrite** — remove all hook logic, reduce to 3 linear steps |
| `skills/happytrails/scripts/start-server.sh` | **Modify** — add duplicate session detection, add `.gitignore` management |
| `docs/future-features.md` | **Modify** — add auto-open browser, session cleanup, stop skill path fix |

No changes to `hook.js`, `server.cjs`, `client.html`, `stop-server.sh`, or `happytrails-stop/SKILL.md`.

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
6. Verify old `settings.json` hook entry causes double-firing (validates need for migration note)
