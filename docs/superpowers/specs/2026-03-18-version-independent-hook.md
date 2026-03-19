# Version-Independent Hook Path Spec

## Problem

The PostToolUse hook command registered in `.claude/settings.json` contains a hardcoded path to the versioned plugin cache:

```
node /home/user/.claude/plugins/cache/happytrails-marketplace/happytrails/1.1.0/skills/happytrails/scripts/hook.js
```

When the plugin updates (e.g., 1.1.0 → 1.2.0), the cache path changes to `.../1.2.0/...`. The old path either breaks (directory removed) or points to stale code (directory kept). Either way, the hook silently stops working until manually re-registered — which also requires a Claude Code restart.

This undermines the "register once, works forever" design from the stable hook work.

## Requirements

1. The hook command in `.claude/settings.json` must not contain a version number or any path segment that changes on plugin update.
2. The hook must resolve to the current version's `hook.js` at runtime without requiring hook re-registration or restart.
3. The solution must work on Linux, macOS, and Windows.
4. The hook must remain fast — no expensive resolution on every tool call.

## Design

### Copy `hook.js` to a stable location

On `/happytrails` start, copy `hook.js` from the skill directory to a well-known, version-independent path. The hook command points to this stable copy.

**Stable path:** `~/.happytrails/hook.js`

**Hook command:** `node ~/.happytrails/hook.js`

This path never changes. On each `/happytrails` invocation, the skill copies the current version's `hook.js` to this location, keeping it up to date without re-registering the hook or restarting Claude Code.

### Why copy, not symlink

- Symlinks have inconsistent behavior on Windows (require admin or developer mode)
- A copy is atomic and portable
- `hook.js` is small (~1KB) — copy overhead is negligible

### Lifecycle

**First `/happytrails` invocation (hook not registered):**
1. Create `~/.happytrails/` directory if it doesn't exist
2. Copy `<SKILL_DIR>/scripts/hook.js` to `~/.happytrails/hook.js`
3. Register hook with command `node ~/.happytrails/hook.js`
4. Tell user to restart for hook to take effect

**Subsequent `/happytrails` invocations (hook already registered):**
1. Copy `<SKILL_DIR>/scripts/hook.js` to `~/.happytrails/hook.js` (updates to current version)
2. Start the server as normal
3. No restart needed — the hook path hasn't changed, and the file contents are updated in place

**Plugin update (user runs `claude plugins update`):**
- The cached plugin path changes (e.g., 1.1.0 → 1.2.0)
- The hook command in settings.json still points to `~/.happytrails/hook.js` — unaffected
- Next `/happytrails` invocation copies the new version's `hook.js` to the stable path
- Between the update and the next invocation, the old copy continues to work (hook.js is backward-compatible by design)

### `start-server.sh` changes

`start-server.sh` does NOT handle the copy — that's the SKILL.md's responsibility (the agent does it). However, `start-server.sh` should also accept `~/.happytrails/` as a valid location for the `.active` file discovery, since hooks running from `~/.happytrails/hook.js` won't have `<SKILL_DIR>` context.

No changes needed to `start-server.sh` — the hook resolves `.active` via `cwd` from stdin, not from its own location.

### `hook.js` changes

None. `hook.js` already resolves the log file via `<cwd>/.happytrails/.active` from stdin data. It doesn't depend on its own filesystem location.

## Files Changed

| File | Change |
|------|--------|
| `skills/happytrails/SKILL.md` | Update hook registration to copy hook.js to `~/.happytrails/hook.js` first, then register with stable path. On subsequent starts, always copy (silent update). |
| `skills/happytrails-stop/SKILL.md` | No changes — stop doesn't touch the hook. |
| `skills/happytrails/scripts/hook.js` | No changes — already location-independent. |
| `skills/happytrails/scripts/start-server.sh` | No changes. |
| `skills/happytrails/scripts/server.cjs` | No changes. |

## SKILL.md Changes (Detail)

### Start session flow (updated)

```
1. Create ~/.happytrails/ directory if it doesn't exist:
   mkdir -p ~/.happytrails

2. Copy hook.js to the stable location:
   cp <SKILL_DIR>/scripts/hook.js ~/.happytrails/hook.js

3. Check if the PostToolUse hook is already registered in .claude/settings.json.
   Look for a hook whose command contains ~/.happytrails/hook.js.

4. If NOT registered, add it with command:
   node ~/.happytrails/hook.js
   (Tell user to restart)

5. If already registered, start the server as normal.
```

The key change: step 2 always runs, even if the hook is already registered. This silently updates the hook script to the current version without changing the registered command.

## Out of Scope

- Automatic hook registration on plugin install (Claude Code doesn't support install hooks)
- Migrating existing hooks from versioned paths to the stable path (agent handles this on next `/happytrails` invocation by detecting the old path pattern and re-registering)
- Copying `start-server.sh` or `server.cjs` to stable paths (these are invoked by the agent, which always has the current `<SKILL_DIR>`)

## Testing

1. Register hook with stable path, update plugin version, verify hook still works without re-registration
2. Verify `~/.happytrails/hook.js` is updated on each `/happytrails` invocation
3. Verify hook works correctly from the stable path (log file discovery via `.active`)
4. Verify first-time setup creates `~/.happytrails/` and copies hook.js
