---
name: happytrails
description: Start live browser-based viewer for all agent tool activity — streams every command, read, write, edit, search, and more to an infinite-scroll HTML pane with three switchable view modes
invocable_by:
  - user
---

# HappyTrails — Start Session

1. Start the server:

   ```bash
   <SKILL_DIR>/scripts/start-server.sh --project-dir <CWD> --owner-pid <PPID>
   ```

   Replace `<PPID>` with the PID of the current Claude Code process (typically available as `$PPID` in the bash environment).

   Save `session_dir` from the JSON response.

2. Tell the user to open the URL in their browser.

3. Inform the user that all tool activity will now appear in the browser.

## Important

- The server auto-exits when the owner process (Claude Code) exits, or after 30 minutes of inactivity
- Session files persist in `<project>/.happytrails/` for later reference
