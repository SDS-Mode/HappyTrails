---
name: happytrails
description: Start live browser-based viewer for all agent tool activity — streams every command, read, write, edit, search, and more to an infinite-scroll HTML pane with three switchable view modes
invocable_by:
  - user
---

# HappyTrails — Start Session

1. Check if the PostToolUse hook is already registered in `.claude/settings.json`.
   Look for a hook whose command contains `scripts/hook.js` from this skill.

2. If the hook is NOT registered, add it to `.claude/settings.json`:

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "node <SKILL_DIR>/scripts/hook.js",
               "timeout": 5
             }
           ]
         }
       ]
     }
   }
   ```

   Replace `<SKILL_DIR>` with this skill's base directory.

   **Important:** If you just registered the hook for the first time, tell the user:
   "HappyTrails hook registered. Please restart Claude Code once for the hook to take effect, then run `/happytrails` again."
   Do NOT proceed with server startup — the hook won't work until after restart.

3. If the hook IS already registered, start the server:

   ```bash
   <SKILL_DIR>/scripts/start-server.sh --project-dir <CWD>
   ```

   Save `session_dir` from the JSON response.

4. Tell the user to open the URL in their browser.

5. Inform the user that all tool activity will now appear in the browser.

## Important

- The hook command is stable — it never changes between sessions. Register it once.
- The hook discovers the active log file via `<project>/.happytrails/.active`. When no session is running, the hook exits silently with no overhead.
- Do NOT include `HAPPYTRAILS_LOG` in the hook command — the hook resolves the log path dynamically.
- The server auto-exits after 30 minutes of inactivity
- Session files persist in `<project>/.happytrails/` for later reference
- Add `.happytrails/` to `.gitignore` if not already there
