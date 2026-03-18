---
name: happytrails-stop
description: Stop the active HappyTrails session and shut down the server
invocable_by:
  - user
---

# HappyTrails — Stop Session

1. Find the active session directory by reading `<CWD>/.happytrails/.active`.
   If the file does not exist, tell the user there is no active HappyTrails session.

2. The `.active` file contains the log file path. The session directory is the parent
   of that log file (e.g., if `.active` contains `/project/.happytrails/12345/log.jsonl`,
   the session directory is `/project/.happytrails/12345`).

3. Stop the server:

   ```bash
   <SKILL_DIR>/../happytrails/scripts/stop-server.sh <SESSION_DIR>
   ```

4. Do NOT remove the hook from `.claude/settings.json` — it is stable and reusable.

5. Confirm to the user that capture has stopped.
