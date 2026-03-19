# Icon and Tab Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "HappyTrails" header text with a configurable emoji/image icon, add a matching favicon, and set the browser tab title to `{project}_{session-id}` derived from the log file path.

**Architecture:** The server reads a new `HAPPYTRAILS_ICON` env var and derives a tab title from the `LOG_FILE` path. Both values are injected into `client.html` via placeholder replacement at startup and included in WebSocket `history` messages for reconnect. The client renders the icon in the header and as a favicon, and sets `document.title`.

**Tech Stack:** Node.js (server.cjs), vanilla HTML/CSS/JS (client.html)

**Spec:** `docs/superpowers/specs/2026-03-19-icon-and-tab-title-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `skills/happytrails/scripts/server.cjs` | Modify | Add icon/tab-title config, template injection, WebSocket metadata |
| `skills/happytrails/scripts/client.html` | Modify | Add placeholders, icon rendering, favicon, dynamic title |
| `CLAUDE.md` | Modify | Document new `HAPPYTRAILS_ICON` env var |

---

### Task 1: Server — Add icon and tab title configuration

**Files:**
- Modify: `skills/happytrails/scripts/server.cjs:74-80` (Section 2: Configuration)

- [ ] **Step 1: Add HAPPYTRAILS_ICON config and validation**

After line 80 (`const LOCK_FILE = ...`), add:

```javascript
const DEFAULT_ICON = '🥾';
const HAPPYTRAILS_ICON = (function () {
  const val = (process.env.HAPPYTRAILS_ICON || '').trim();
  if (!val) return DEFAULT_ICON;
  if (val.startsWith('data:image/')) return val;
  if (val.length <= 8) return val; // Assume emoji
  return DEFAULT_ICON; // Invalid — too long and not a data URI
})();
```

- [ ] **Step 2: Add tab title derivation function**

After the `HAPPYTRAILS_ICON` block, add:

```javascript
function deriveTabTitle() {
  try {
    const segments = LOG_FILE.split(path.sep);
    const htIndex = segments.indexOf('.happytrails');
    if (htIndex > 0) {
      const project = segments[htIndex - 1];
      const sessionId = path.basename(path.dirname(LOG_FILE));
      if (project && sessionId) return project + '_' + sessionId;
    }
    // Fallback: grandparent_parent
    const sessionId = path.basename(path.dirname(LOG_FILE));
    const project = path.basename(path.dirname(path.dirname(LOG_FILE)));
    if (project && sessionId && project !== '.') return project + '_' + sessionId;
  } catch (_) {}
  return 'HappyTrails';
}

const TAB_TITLE = deriveTabTitle();
```

- [ ] **Step 3: Verify server starts with new config**

Run:
```bash
cd /run/media/system/Dos/Projects/HappyTrails/skills/happytrails/scripts
HAPPYTRAILS_LOG=/tmp/test-ht/log.jsonl HAPPYTRAILS_DIR=/tmp/test-ht node -e "
const path = require('path');
const LOG_FILE = '/run/media/system/Dos/Projects/HappyTrails/.happytrails/123-456/log.jsonl';
const DEFAULT_ICON = '🥾';
const HAPPYTRAILS_ICON = DEFAULT_ICON;
function deriveTabTitle() {
  try {
    const segments = LOG_FILE.split(path.sep);
    const htIndex = segments.indexOf('.happytrails');
    if (htIndex > 0) {
      const project = segments[htIndex - 1];
      const sessionId = path.basename(path.dirname(LOG_FILE));
      if (project && sessionId) return project + '_' + sessionId;
    }
  } catch (_) {}
  return 'HappyTrails';
}
console.log('Icon:', HAPPYTRAILS_ICON);
console.log('Tab title:', deriveTabTitle());
"
```

Expected: `Icon: 🥾` and `Tab title: HappyTrails_123-456`

- [ ] **Step 4: Commit**

```bash
git add -f skills/happytrails/scripts/server.cjs
git commit -m "feat: add icon and tab title configuration to server"
```

---

### Task 2: Server — Template injection into client HTML

**Files:**
- Modify: `skills/happytrails/scripts/server.cjs:150-158` (Section 3: HTML loading)

- [ ] **Step 1: Add safe-escape helper and template injection after HTML load**

After line 158 (the closing `}` of the try/catch that reads `client.html`), add:

```javascript
function safeJsonEmbed(val) {
  return JSON.stringify(val).replace(/</g, '\\u003c');
}

// Inject icon and tab title into client HTML (one-time mutation at startup)
clientHtml = clientHtml
  .replace('<title>HappyTrails</title>', '<title>' + TAB_TITLE.replace(/</g, '&lt;') + '</title>')
  .replace('<!--HAPPYTRAILS_ICON-->', '<script>window.__HT_ICON=' + safeJsonEmbed(HAPPYTRAILS_ICON) + ';window.__HT_TAB_TITLE=' + safeJsonEmbed(TAB_TITLE) + ';</script>');
```

- [ ] **Step 2: Verify injection works**

Run:
```bash
cd /run/media/system/Dos/Projects/HappyTrails/skills/happytrails/scripts
node -e "
function safeJsonEmbed(val) {
  return JSON.stringify(val).replace(/</g, '\\\\u003c');
}
const icon = '🥾';
const title = 'HappyTrails_123-456';
const tag = '<script>window.__HT_ICON=' + safeJsonEmbed(icon) + ';window.__HT_TAB_TITLE=' + safeJsonEmbed(title) + ';</script>';
console.log(tag);
"
```

Expected: `<script>window.__HT_ICON="🥾";window.__HT_TAB_TITLE="HappyTrails_123-456";</script>`

- [ ] **Step 3: Commit**

```bash
git add -f skills/happytrails/scripts/server.cjs
git commit -m "feat: add template injection for icon and tab title"
```

---

### Task 3: Server — Add icon and tab title to WebSocket and server-info

**Files:**
- Modify: `skills/happytrails/scripts/server.cjs:234-235` (WebSocket history send)
- Modify: `skills/happytrails/scripts/server.cjs:396-406` (writeServerInfo)

- [ ] **Step 1: Add icon and tab_title to WebSocket history message**

Change line 235 from:

```javascript
  sendToSocket(socket, { type: 'history', entries: history });
```

to:

```javascript
  sendToSocket(socket, { type: 'history', entries: history, icon: HAPPYTRAILS_ICON, tab_title: TAB_TITLE });
```

- [ ] **Step 2: Add icon and tab_title to server-info**

In `writeServerInfo()`, change the `info` object (lines 398-406) from:

```javascript
  const info = {
    type: 'happytrails-server',
    port,
    host: HOST,
    url_host: URL_HOST,
    url,
    session_dir: SESSION_DIR,
    log_file: LOG_FILE,
  };
```

to:

```javascript
  const info = {
    type: 'happytrails-server',
    port,
    host: HOST,
    url_host: URL_HOST,
    url,
    session_dir: SESSION_DIR,
    log_file: LOG_FILE,
    icon: HAPPYTRAILS_ICON,
    tab_title: TAB_TITLE,
  };
```

- [ ] **Step 3: Commit**

```bash
git add -f skills/happytrails/scripts/server.cjs
git commit -m "feat: include icon and tab_title in WebSocket history and server-info"
```

---

### Task 4: Client — Add placeholder and header icon rendering

**Files:**
- Modify: `skills/happytrails/scripts/client.html:6` (title tag)
- Modify: `skills/happytrails/scripts/client.html:624-631` (head close and header)
- Modify: `skills/happytrails/scripts/client.html:66-72` (h1 CSS)

- [ ] **Step 1: Add injection placeholder in the head**

Change line 6 from:

```html
  <title>HappyTrails</title>
```

to:

```html
  <title>HappyTrails</title>
  <!--HAPPYTRAILS_ICON-->
```

- [ ] **Step 2: Replace header h1 with icon element and spacer**

Change lines 627-631 from:

```html
  <div id="header">
    <h1>HappyTrails</h1>
    <div id="status-dot" title="Disconnected"></div>
    <button id="menu-btn" title="Menu">⋯</button>
  </div>
```

to:

```html
  <div id="header">
    <span id="header-icon" style="font-size:20px;line-height:1;flex-shrink:0;">🥾</span>
    <div style="flex:1"></div>
    <div id="status-dot" title="Disconnected"></div>
    <button id="menu-btn" title="Menu">⋯</button>
  </div>
```

The `🥾` here is the static fallback; the JS will overwrite it from injected values.

- [ ] **Step 3: Remove the `#header h1` CSS rule**

Replace lines 66-72:

```css
    #header h1 {
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--text-primary);
      flex: 1;
    }
```

with:

```css
    #header-icon img {
      width: 20px;
      height: 20px;
      vertical-align: middle;
    }
```

This styles data URI icons rendered as `<img>` tags inside the icon span.

- [ ] **Step 4: Verify the page loads and shows the boot icon in the header**

Open client.html directly in a browser (file://) and confirm:
- The hiking boot emoji appears in the top-left of the header
- The status dot and menu button are pushed to the right by the spacer div
- No "HappyTrails" text in the header

- [ ] **Step 5: Commit**

```bash
git add -f skills/happytrails/scripts/client.html
git commit -m "feat: replace header text with icon element and spacer"
```

---

### Task 5: Client — Add favicon and dynamic title logic

**Files:**
- Modify: `skills/happytrails/scripts/client.html:675-678` (script init section)
- Modify: `skills/happytrails/scripts/client.html:1369-1381` (WebSocket history handler)
- Modify: `skills/happytrails/scripts/client.html:1396-1398` (Init section)

- [ ] **Step 1: Add icon/title application functions after the `'use strict';` line**

After line 677 (`'use strict';`), before the State section, add:

```javascript
      // ── Icon & Title ────────────────────────────────────────────────────
      function applyIcon(icon) {
        var el = document.getElementById('header-icon');
        if (!el) return;
        if (icon && icon.indexOf('data:image/') === 0) {
          el.textContent = '';
          var img = document.createElement('img');
          img.src = icon;
          img.alt = 'HappyTrails';
          el.appendChild(img);
        } else {
          el.textContent = icon || '🥾';
        }
        // Set favicon
        var link = document.querySelector('link[rel="icon"]');
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        if (icon && icon.indexOf('data:image/') === 0) {
          link.href = icon;
        } else {
          var emoji = icon || '🥾';
          link.href = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">' + emoji + '</text></svg>');
        }
      }

      function applyTitle(title) {
        if (title) document.title = title;
      }
```

- [ ] **Step 2: Update WebSocket history handler to apply icon and title**

Change the `history` block (lines 1369-1381) from:

```javascript
          } else if (msg.type === 'history') {
            // Clear existing state to avoid duplicates on reconnect
            entries.length = 0;
            knownToolTypes.clear();
            activeToolTypes.clear();
            const hist = msg.entries || [];
            hist.forEach(function (e) {
              entries.push(e);
              trackToolType(e);
            });
            updateToolTypeDropdown();
            renderAll();
          }
```

to:

```javascript
          } else if (msg.type === 'history') {
            // Clear existing state to avoid duplicates on reconnect
            entries.length = 0;
            knownToolTypes.clear();
            activeToolTypes.clear();
            const hist = msg.entries || [];
            hist.forEach(function (e) {
              entries.push(e);
              trackToolType(e);
            });
            updateToolTypeDropdown();
            renderAll();
            // Apply icon and title from server (takes precedence over injected values)
            if (msg.icon) applyIcon(msg.icon);
            if (msg.tab_title) applyTitle(msg.tab_title);
          }
```

- [ ] **Step 3: Apply injected values on init**

Change the Init section (lines 1396-1398) from:

```javascript
      // ── Init ───────────────────────────────────────────────────────────────
      renderAll();
      connect();
```

to:

```javascript
      // ── Init ───────────────────────────────────────────────────────────────
      if (window.__HT_ICON) applyIcon(window.__HT_ICON);
      if (window.__HT_TAB_TITLE) applyTitle(window.__HT_TAB_TITLE);
      renderAll();
      connect();
```

- [ ] **Step 4: Commit**

```bash
git add -f skills/happytrails/scripts/client.html
git commit -m "feat: add favicon generation and dynamic tab title"
```

---

### Task 6: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md:39-48` (Environment Variables table)

- [ ] **Step 1: Add HAPPYTRAILS_ICON to the env var table**

Add a new row to the Environment Variables table after the `HAPPYTRAILS_OWNER_PID` row:

```markdown
| `HAPPYTRAILS_ICON` | server.cjs | Header icon and favicon; emoji char or `data:image/` URI (default: 🥾) |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add HAPPYTRAILS_ICON to environment variables table"
```

---

### Task 7: Integration test — full start/stop cycle

- [ ] **Step 1: Start a fresh HappyTrails server and verify all changes**

```bash
cd /run/media/system/Dos/Projects/HappyTrails
skills/happytrails/scripts/start-server.sh --project-dir /run/media/system/Dos/Projects/HappyTrails
```

Open the returned URL in a browser and verify:
- Header shows 🥾 icon (no "HappyTrails" text)
- Browser tab icon shows the hiking boot emoji
- Browser tab title shows `HappyTrails_{session-id}` format
- Status dot and menu button are right-aligned

- [ ] **Step 2: Test with custom emoji icon**

```bash
HAPPYTRAILS_ICON=🧭 skills/happytrails/scripts/start-server.sh --project-dir /run/media/system/Dos/Projects/HappyTrails
```

Verify the compass emoji appears in both header and tab icon.

- [ ] **Step 3: Verify server-info includes new fields**

```bash
cat /run/media/system/Dos/Projects/HappyTrails/.happytrails/<session-dir>/.server-info | grep -E '"icon"|"tab_title"'
```

Expected: both fields present in the JSON.

- [ ] **Step 4: Simulate a tool call to verify nothing is broken**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_result":{"stdout":"hello\n","exit_code":0}}' \
  | HAPPYTRAILS_LOG=<log_file> node skills/happytrails/scripts/hook.js
```

Verify the entry appears in the browser.

- [ ] **Step 5: Stop the server**

```bash
skills/happytrails/scripts/stop-server.sh <session_dir>
```
