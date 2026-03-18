---
name: happytrails
description: Live browser-based viewer for all agent tool activity — streams every command, read, write, edit, search, and more to an infinite-scroll HTML pane with three switchable view modes
invocable_by:
  - user
aliases:
  - happytrails-start
  - happytrails-stop
triggers:
  - happytrails
  - happytrails-start
  - happytrails-stop
---

# HappyTrails

Live browser-based visibility into all agent tool activity.

## Starting a Session

1. Run the server:

   ```bash
   <SKILL_DIR>/scripts/start-server.sh --project-dir <CWD>
   ```

   Save `session_dir` and `log_file` from the JSON response.

2. Register the PostToolUse hook by adding this to `.claude/settings.json`:

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "HAPPYTRAILS_LOG=\"<LOG_FILE>\" node <SKILL_DIR>/scripts/hook.js",
               "timeout": 5
             }
           ]
         }
       ]
     }
   }
   ```

   Replace `<LOG_FILE>` with the `log_file` from step 1.
   Replace `<SKILL_DIR>` with this skill's base directory.

3. Tell the user to open the URL in their browser.

4. Inform the user that all tool activity will now appear in the browser.

## Stopping a Session

When the user invokes `/happytrails-stop`:

1. Remove the PostToolUse hook entry from `.claude/settings.json`
2. Run: `<SKILL_DIR>/scripts/stop-server.sh <SESSION_DIR>`
3. Confirm to the user that capture has stopped

## Important

- The hook must be removed on stop — leaving it active without a server causes silent errors
- The server auto-exits after 30 minutes of inactivity
- Session files persist in `<project>/.happytrails/` for later reference
- Add `.happytrails/` to `.gitignore` if not already there
