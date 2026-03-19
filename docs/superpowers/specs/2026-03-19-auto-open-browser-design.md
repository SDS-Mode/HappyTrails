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
- **Approach:** `child_process.exec` in the listen callback (Approach A — simplest, self-contained)

## Opt-Out Mechanism

New environment variable `HAPPYTRAILS_AUTO_OPEN`:
- Default: `1` (enabled)
- Set to `0` to suppress auto-open
- Follows existing env var naming pattern (`HAPPYTRAILS_PORT`, `HAPPYTRAILS_HOST`, etc.)

`start-server.sh` gains a `--no-open` flag that sets `HAPPYTRAILS_AUTO_OPEN=0` before spawning the server.

## Changes

### `server.cjs`

1. Add `child_process` to the require block at the top of the file
2. Add `AUTO_OPEN` const derived from `process.env.HAPPYTRAILS_AUTO_OPEN` (default `'1'`)
3. In the `server.listen()` callback, after the JSON status line is printed and before `startWatcher()`, add:
   ```js
   if (AUTO_OPEN === '1') {
     require('child_process').exec(`xdg-open ${url}`);
   }
   ```

### `start-server.sh`

Add `--no-open` to the argument parser:
```bash
--no-open) export HAPPYTRAILS_AUTO_OPEN=0; shift ;;
```

### `CLAUDE.md`

Add `HAPPYTRAILS_AUTO_OPEN` to the environment variables table:

| Variable | Used By | Description |
|----------|---------|-------------|
| `HAPPYTRAILS_AUTO_OPEN` | server.cjs | Auto-open browser on start; `1` (default) or `0` to suppress |

## Files Not Changed

- `hook.js` — no involvement in server startup
- `client.html` — browser-side, unaffected
- `SKILL.md` — no change needed; the server handles the open internally
- `hooks.json` — hook declarations unchanged
