---
name: happytrails-stop
description: Stop the active HappyTrails session and shut down the server
invocable_by:
  - user
---

# HappyTrails — Stop Session

1. Read `<CWD>/.happytrails/.active` to get the log file path.
   If the file does not exist, tell the user there is no active HappyTrails session.

2. Derive the session directory as the parent of the log file path
   (e.g., if `.active` contains `/project/.happytrails/12345/log.jsonl`,
   the session directory is `/project/.happytrails/12345`).

3. Read `<SESSION_DIR>/.server.pid` to get the server process ID.
   If the file does not exist, or the PID is not running (`kill -0 <PID>` fails),
   tell the user the server is already stopped and remove the stale `.active` file:

   ```bash
   rm -f <CWD>/.happytrails/.active
   ```

4. Send SIGTERM to stop the server (it handles cleanup automatically):

   ```bash
   kill <PID>
   ```

5. Do NOT remove the hook — it is managed by the plugin and reused across sessions.

6. Confirm to the user that capture has stopped.
