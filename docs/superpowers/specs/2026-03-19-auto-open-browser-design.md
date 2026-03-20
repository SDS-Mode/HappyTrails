# Auto-Open Browser Design

**Date:** 2026-03-19
**Status:** Approved
**Feature:** Automatically open the HappyTrails URL in the default browser when the server starts

## Summary

When the HappyTrails server starts listening, it automatically opens the URL in the user's default browser using `xdg-open`. This eliminates the manual copy/click step. The behavior is on by default and can be suppressed via env var or CLI flag.

## Decisions

- **Default on** — auto-open happens every time unless explicitly suppressed
- **Linux only** — uses `xdg-open`; no macOS/Windows support for now
- **Lives in `server.cjs`** — the Node server opens the browser once it's listening
- **Fire-and-forget** — no error handling; if `xdg-open` fails, the URL is still printed to stdout as today
- **Approach:** `child_process.execFile` in the listen callback (avoids shell injection)
- **Double-open on restart is acceptable** — if a user restarts the server, a second tab opens; this matches the behavior of most dev tools

## Opt-Out Mechanism

New environment variable `HAPPYTRAILS_AUTO_OPEN`:
- Default: `1` (enabled)
- Set to `0` to suppress auto-open
- Follows existing env var naming pattern (`HAPPYTRAILS_PORT`, `HAPPYTRAILS_HOST`, etc.)

`start-server.sh` gains a `--no-open` flag that sets `HAPPYTRAILS_AUTO_OPEN=0` before spawning the server.

## Changes

### `server.cjs`

1. Add `AUTO_OPEN` const derived from `process.env.HAPPYTRAILS_AUTO_OPEN` (default `'1'`), alongside the other env var constants
2. In the `server.listen()` callback, **after** `startWatcher()` (so the server is fully ready before the browser connects), add:
   ```js
   if (AUTO_OPEN === '1') {
     const { execFile } = require('child_process');
     execFile('xdg-open', [url], { stdio: 'ignore' });
   }
   ```
   Uses `execFile` (not `exec`) to avoid shell interpolation of the URL. Consistent with the existing inline `require('child_process')` pattern in `getProcessStartTime()`.

### `start-server.sh`

1. Add `--no-open` to the argument parser:
   ```bash
   --no-open) export HAPPYTRAILS_AUTO_OPEN=0; shift ;;
   ```
2. Add `HAPPYTRAILS_AUTO_OPEN` to both `env` invocations (foreground line 120 and background line 125) so the variable reaches the Node process:
   ```bash
   env ... HAPPYTRAILS_AUTO_OPEN="${HAPPYTRAILS_AUTO_OPEN:-1}" node server.cjs
   ```

### `CLAUDE.md`

Add `HAPPYTRAILS_AUTO_OPEN` to the environment variables table:

| Variable | Used By | Description |
|----------|---------|-------------|
| `HAPPYTRAILS_AUTO_OPEN` | server.cjs | Auto-open browser on start; `1` (default) or `0` to suppress |

## Nohup / Background Mode

When launched in background mode (the default), `xdg-open` runs inside the `nohup` process with no controlling terminal. On Linux, `xdg-open` communicates with the desktop via D-Bus and does not require a TTY, so this works correctly. Any `xdg-open` errors are captured in the server log file alongside other server output.

## Files Not Changed

- `hook.js` — no involvement in server startup
- `client.html` — browser-side, unaffected
- `SKILL.md` — no change needed; the server handles the open internally. The `--no-open` flag is for programmatic use, not skill invocation.
- `hooks.json` — hook declarations unchanged
