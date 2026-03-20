---
name: happytrails
description: Start live browser-based viewer for all agent tool activity — streams every command, read, write, edit, search, and more to an infinite-scroll HTML pane with three switchable view modes
invocable_by:
  - user
---

# HappyTrails — Start Session

Check if the user provided an argument:
- If the argument is `transcript`, follow the **Transcript Mode** instructions below
- Otherwise (no argument, or any other argument), follow the **Hook Mode** instructions

## Hook Mode (default)

1. Start the server:

   ```bash
   <SKILL_DIR>/scripts/start-server.sh --project-dir <CWD> --owner-pid <PPID>
   ```

   Replace `<PPID>` with the PID of the current Claude Code process (typically available as `$PPID` in the bash environment).

   Save `session_dir` from the JSON response.

2. Tell the user to open the URL in their browser.

3. Inform the user that all tool activity will now appear in the browser.

## Transcript Mode

Use this mode when PostToolUse hooks are not available, or for lower-friction setup on compatible harnesses.

1. Determine the transcript path for the current session. The transcript file is located at:

   ```
   ~/.claude/projects/<project-dir-hash>/<session-id>.jsonl
   ```

   The project directory hash and session ID are part of the current Claude Code context. You can find the transcript path by listing recent files:

   ```bash
   ls -t ~/.claude/projects/-$(echo -n "<CWD>" | tr '/' '-')/*.jsonl | head -1
   ```

   Note: Claude Code hashes project directories by replacing `/` with `-` and prefixing with `-`. Verify the actual directory name by listing `~/.claude/projects/` if the constructed path doesn't match.

   If the transcript file cannot be found, inform the user and fall back to Hook Mode.

2. Start the server with the transcript path:

   ```bash
   <SKILL_DIR>/scripts/start-server.sh --project-dir <CWD> --owner-pid <PPID> --transcript-path <TRANSCRIPT_PATH>
   ```

   Save `session_dir` from the JSON response.

3. Tell the user to open the URL in their browser.

4. Inform the user that all tool activity will now appear in the browser. Note that in transcript mode, agent grouping and inline stats are not available.

## Important

- The server auto-exits when the owner process (Claude Code) exits, or after 30 minutes of inactivity
- Session files persist in `<project>/.happytrails/` for later reference
