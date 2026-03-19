# Icon and Tab Title Design

## Summary

Replace the "HappyTrails" text in the page header with a configurable icon, add a matching browser tab favicon, and set the browser tab title to a project/session identifier derived from the log file path.

## Current State

- Header displays `<h1>HappyTrails</h1>` as static text
- Browser tab title is hardcoded to "HappyTrails"
- No favicon is set (browser shows default blank/globe icon)
- No icon configuration exists

## Design

### Icon System

- Default icon: `🥾` (hiking boot emoji), hardcoded as fallback
- `HAPPYTRAILS_ICON` environment variable overrides the default
  - Accepts an emoji character (e.g. `🧭`, `👣`)
  - Accepts a `data:` URI for custom images (e.g. `data:image/svg+xml;base64,...` or `data:image/png;base64,...`)
- The server passes the icon value to the client via two mechanisms:
  1. Template injection into `client.html` before serving (available immediately on page load)
  2. A new `icon` field in the WebSocket `history` message (available on reconnect)

### Favicon

- For emoji icons: a small inline `<canvas>` element draws the emoji character and converts it to a data URI, which is set as `<link rel="icon" href="...">`
- For `data:` URI icons: the href is set directly on the `<link rel="icon">` element
- No static `.ico` file — everything is generated at runtime
- Favicon updates dynamically if the icon value changes (e.g. on WebSocket reconnect with a different server)

### Header Change

- Remove `<h1>HappyTrails</h1>` from the header
- Replace with the icon rendered at ~20px:
  - Emoji: a `<span>` element with appropriate font size
  - Data URI: an `<img>` element with width/height constraints
- The status dot and menu button remain in their current positions
- The icon occupies the left side of the header where the h1 was; `flex: 1` moves to a spacer or is removed since the icon is compact

### Tab Title

- Format: `{project}_{session-id}` (e.g. `HappyTrails_1418887-1773896600`)
- Derived from `LOG_FILE` path by the server:
  - Session ID: `path.basename(path.dirname(LOG_FILE))` — the direct parent directory
  - Project name: derived from the grandparent of the `.happytrails/` directory in the path
- Passed to the client via:
  1. Template injection into the `<title>` tag
  2. A new `tab_title` field in the WebSocket `history` message
- Client sets `document.title` from this value
- Fallback: `HappyTrails` if path parsing fails or values are empty

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HAPPYTRAILS_ICON` | `🥾` | Emoji character or `data:` URI for the header icon and favicon |

This follows the existing pattern where all HappyTrails configuration is done via environment variables.

## Files Changed

| File | Changes |
|------|---------|
| `skills/happytrails/scripts/server.cjs` | Read `HAPPYTRAILS_ICON` env var, derive `tab_title` from `LOG_FILE` path, inject both into HTML via template replacement, include both in WebSocket `history` message |
| `skills/happytrails/scripts/client.html` | Replace `<h1>HappyTrails</h1>` with icon element, add favicon generation logic, set `document.title` from injected/WebSocket values, handle both emoji and data URI icon formats |
| `CLAUDE.md` | Add `HAPPYTRAILS_ICON` to environment variables table |

## Template Injection Strategy

The server currently reads `client.html` once at startup and serves it verbatim. To inject values:

1. Add placeholder tokens in the HTML: `<!--HAPPYTRAILS_ICON-->` and `<!--HAPPYTRAILS_TAB_TITLE-->`
2. Server replaces these tokens when building the response in `handleHttp()`
3. Values are embedded in a `<script>` block as `window.__HT_ICON` and `window.__HT_TAB_TITLE`
4. Client JS reads these globals on init, with fallbacks for direct file access (development)

This avoids modifying the HTML string on every request — the replacement is done once at startup since the values don't change per-session.

## Edge Cases

- **No log file path**: tab title falls back to `HappyTrails`
- **Log file in unexpected location** (no `.happytrails/` in path): use the direct parent as session ID, grandparent as project name
- **Empty or invalid `HAPPYTRAILS_ICON`**: fall back to `🥾`
- **Multi-codepoint emoji**: works naturally since both `<span>` rendering and canvas drawing handle multi-codepoint sequences
- **Data URI with special characters**: passed through as-is; the `<img>` src attribute handles standard data URIs natively
