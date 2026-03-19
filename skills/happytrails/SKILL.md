---
name: happytrails
description: Start live browser-based viewer for all agent tool activity — streams every command, read, write, edit, search, and more to an infinite-scroll HTML pane with three switchable view modes
invocable_by:
  - user
---

# HappyTrails — Start Session

1. Ensure the hook script is at the stable location:

   ```bash
   mkdir -p ~/.happytrails
   cp <SKILL_DIR>/scripts/hook.js ~/.happytrails/hook.js
   ```

   This always runs — it silently updates the hook to the current version.

2. Check if the PostToolUse hook is already registered in `.claude/settings.json`.
   Look for a hook whose command contains `~/.happytrails/hook.js`.

3. If the hook is NOT registered, add it to `.claude/settings.json`:

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "node ~/.happytrails/hook.js",
               "timeout": 5
             }
           ]
         }
       ]
     }
   }
   ```

   **Important:** If you just registered the hook for the first time, tell the user:
   "HappyTrails hook registered. Please restart Claude Code once for the hook to take effect, then run `/happytrails` again."
   Do NOT proceed with server startup — the hook won't work until after restart.

4. If the hook IS already registered, start the server:

   ```bash
   <SKILL_DIR>/scripts/start-server.sh --project-dir <CWD> --owner-pid <PPID>
   ```

   Replace `<PPID>` with the PID of the current Claude Code process (typically available as `$PPID` in the bash environment).

   Save `session_dir` from the JSON response.

4. Tell the user to open the URL in their browser.

5. Inform the user that all tool activity will now appear in the browser.

## Important

- The hook command points to `~/.happytrails/hook.js` — a stable path that survives plugin updates. Register it once.
- The hook script is copied to `~/.happytrails/hook.js` on every `/happytrails` invocation, keeping it current without re-registering the hook.
- Do NOT use `<SKILL_DIR>` in the hook command — it contains a versioned path that breaks on plugin update.
- The hook discovers the active log file via `<project>/.happytrails/.active`. When no session is running, the hook exits silently with no overhead.
- The server auto-exits when the owner process (Claude Code) exits, or after 30 minutes of inactivity
- Session files persist in `<project>/.happytrails/` for later reference
- Add `.happytrails/` to `.gitignore` if not already there
