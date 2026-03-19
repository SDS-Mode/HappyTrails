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
  - Accepts a `data:image/` URI for custom images (e.g. `data:image/svg+xml;base64,...` or `data:image/png;base64,...`)
  - Validation: data URIs must start with `data:image/`; anything else that isn't a short string (≤8 chars, assumed emoji) falls back to default
- The server passes the icon value to the client via two mechanisms:
  1. Template injection into `client.html` at startup (available immediately on page load)
  2. A new `icon` field in the WebSocket `history` message (available on reconnect)

### Favicon

- For emoji icons: generate an SVG data URI with a `<text>` element containing the emoji, set as `<link rel="icon">` href. Example: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🥾</text></svg>`. This approach has better cross-browser emoji rendering than canvas-based drawing.
- For `data:image/` URI icons: set the `<link rel="icon">` href directly to the provided data URI
- No static `.ico` file — everything is generated at runtime
- Favicon updates dynamically if the icon value changes (e.g. on WebSocket reconnect with a different server)

### Header Change

- Remove `<h1>HappyTrails</h1>` from the header
- Replace with the icon rendered at ~20px:
  - Emoji: a `<span>` element with appropriate font size
  - Data URI: an `<img>` element with width/height constraints
- Insert a spacer `<div style="flex:1"></div>` between the icon element and the status dot to preserve the existing right-aligned layout (the current `<h1>` has `flex: 1` which pushes the status dot and menu button to the right)
- The status dot and menu button remain in their current positions

### Tab Title

- Format: `{project}_{session-id}` (e.g. `HappyTrails_1418887-1773896600`)
- Derived from `LOG_FILE` path by the server. Worked example:
  ```
  LOG_FILE = /run/media/system/Dos/Projects/HappyTrails/.happytrails/1418887-1773896600/log.jsonl

  1. Find ".happytrails/" in the path
  2. Project name = parent of .happytrails/ = "HappyTrails"
  3. Session ID = path.basename(path.dirname(LOG_FILE)) = "1418887-1773896600"
  4. Tab title = "HappyTrails_1418887-1773896600"
  ```
- Implementation: locate `.happytrails/` segment in the LOG_FILE path, take the directory immediately before it as the project name. Session ID is always the direct parent of `log.jsonl`.
- Passed to the client via:
  1. Template injection into the `<title>` tag at startup
  2. A new `tab_title` field in the WebSocket `history` message
- Client sets `document.title` from this value
- Fallback: `HappyTrails` if path parsing fails or values are empty

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HAPPYTRAILS_ICON` | `🥾` | Emoji character or `data:image/` URI for the header icon and favicon |

This follows the existing pattern where all HappyTrails configuration is done via environment variables.

## Files Changed

| File | Changes |
|------|---------|
| `skills/happytrails/scripts/server.cjs` | Read `HAPPYTRAILS_ICON` env var, derive `tab_title` from `LOG_FILE` path, inject both into HTML via template replacement at startup, include both in WebSocket `history` message and `.server-info` |
| `skills/happytrails/scripts/client.html` | Replace `<h1>HappyTrails</h1>` with icon element + spacer div, add favicon generation logic, set `document.title` from injected/WebSocket values, handle both emoji and data URI icon formats |
| `CLAUDE.md` | Add `HAPPYTRAILS_ICON` to environment variables table |

## Template Injection Strategy

The server currently reads `client.html` once at startup and stores it in `clientHtml`. To inject values:

1. Add placeholder tokens in the HTML: `<!--HAPPYTRAILS_ICON-->` and `<!--HAPPYTRAILS_TAB_TITLE-->`
2. After reading the file at startup, replace these tokens in the `clientHtml` string — this is a one-time mutation, not per-request
3. Values are embedded in a `<script>` block as `window.__HT_ICON = <safe(icon)>` and `window.__HT_TAB_TITLE = <safe(tabTitle)>` — where `safe(val)` is `JSON.stringify(val).replace(/</g, '\\u003c')` to escape both JSON-special characters and `</script>` sequences that could break the HTML parser
4. Client JS reads these globals on init, with fallbacks for direct file access (development)
5. Since `clientHtml` is mutated once before the server starts listening, `Buffer.byteLength(clientHtml)` in `handleHttp()` computes the correct Content-Length automatically

## Edge Cases

- **No log file path**: tab title falls back to `HappyTrails`
- **Log file in unexpected location** (no `.happytrails/` in path): use the direct parent as session ID, grandparent as project name
- **Empty or invalid `HAPPYTRAILS_ICON`**: fall back to `🥾`. Invalid means: data URIs that don't start with `data:image/`, or strings longer than 8 characters that aren't data URIs
- **Multi-codepoint emoji**: works naturally since both `<span>` rendering and SVG `<text>` handle multi-codepoint sequences
- **Data URI with special characters**: passed through as-is; the `<img>` src attribute handles standard data URIs natively
- **Injected values containing `</script>`**: handled by `JSON.stringify()` escaping during template injection
