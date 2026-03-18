# HappyTrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Claude Code skill that streams all agent tool activity to a live browser pane with three switchable view modes.

**Architecture:** PostToolUse hook appends structured JSON lines to a log file. A Node.js HTTP/WebSocket server watches that file and broadcasts new entries to browser clients. The browser renders entries in one of three view modes (Full Verbose, Structured Cards, Raw Terminal) selected via a radio switcher.

**Tech Stack:** Node.js (no npm dependencies), Claude Code hooks API, WebSocket RFC 6455, vanilla HTML/CSS/JS

**Spec:** `docs/superpowers/specs/2026-03-18-happytrails-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `scripts/` directory
- Create: `.gitignore`
- Create: `docs/future-features.md`

- [ ] **Step 1: Create .gitignore**

```
node_modules/
.happytrails/
.superpowers/
*.log
```

- [ ] **Step 2: Create future-features.md**

Write the future features roadmap from the spec (search, filtering, export, selective export, file streaming, persistent hooks). Include enough detail that a future developer understands the intent without reading the full spec.

- [ ] **Step 3: Create scripts directory**

```bash
mkdir -p scripts
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore docs/future-features.md
git commit -m "chore: scaffold project structure and future features roadmap"
```

---

### Task 2: Hook Handler (hook.js)

**Files:**
- Create: `scripts/hook.js`

The hook is a Node.js script invoked by Claude Code as a `PostToolUse` hook. It reads the hook payload from stdin and appends a structured JSON line to the log file.

**Claude Code hook stdin format (PostToolUse):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/dir",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test", "description": "Run tests" },
  "tool_result": { "stdout": "...", "stderr": "...", "exit_code": 0 }
}
```

The hook must exit 0 immediately and not block the agent.

- [ ] **Step 1: Write hook.js**

```javascript
#!/usr/bin/env node
'use strict';

// HappyTrails PostToolUse hook
// Reads tool call data from stdin, appends a JSON line to the log file.
// Must be fast — runs on every tool call.

const fs = require('fs');

const LOG_FILE = process.env.HAPPYTRAILS_LOG;
if (!LOG_FILE) process.exit(0);

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch (e) {
    process.exit(0);
  }

  const entry = {
    timestamp: Date.now(),
    session_id: data.session_id || null,
    tool: data.tool_name || 'unknown',
    input: data.tool_input || {},
    output: data.tool_result || {},
    cwd: data.cwd || null
  };

  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Silently fail — never block the agent
  }

  process.exit(0);
});
```

- [ ] **Step 2: Make hook.js executable**

```bash
chmod +x scripts/hook.js
```

- [ ] **Step 3: Test hook manually**

```bash
echo '{"session_id":"test","tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_result":{"stdout":"hello\n","exit_code":0}}' | HAPPYTRAILS_LOG=/tmp/happytrails-test.jsonl node scripts/hook.js
cat /tmp/happytrails-test.jsonl
```

Expected: A single JSON line with timestamp, tool, input, output fields.

- [ ] **Step 4: Test with missing env var**

```bash
echo '{}' | node scripts/hook.js
echo $?
```

Expected: Exit code 0, no output, no crash.

- [ ] **Step 5: Commit**

```bash
git add scripts/hook.js
git commit -m "feat: add PostToolUse hook handler for log capture"
```

---

### Task 3: Browser Client (client.html)

**Files:**
- Create: `scripts/client.html`

Single-page HTML app with all CSS and JS inline. Three view modes, WebSocket connection, infinite scroll with smart auto-scroll.

- [ ] **Step 1: Write client.html — document structure and CSS**

The HTML document with:
- OS-aware light/dark theme (CSS variables, `prefers-color-scheme`)
- Fixed header with title "HappyTrails" and connection status dot
- Mode switcher bar (segmented radio: Full Verbose / Structured Cards / Raw Terminal)
- Scrollable log container div
- Monospace font stack: `'Cascadia Code', 'Fira Code', 'SF Mono', 'Consolas', monospace`

CSS for all three view modes:
- **Verbose mode:** `.entry-verbose` with timestamp divider, command line, output block, exit badge
- **Cards mode:** `.entry-card` with left border (green/red), collapsible body, header with command + timestamp + exit code
- **Raw mode:** `#log-container` gets dark background class, entries are just monospace text lines

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>HappyTrails</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }

    :root {
      --bg-primary: #f5f5f7;
      --bg-secondary: #ffffff;
      --bg-tertiary: #e5e5e7;
      --border: #d1d1d6;
      --text-primary: #1d1d1f;
      --text-secondary: #86868b;
      --text-tertiary: #aeaeb2;
      --accent: #0071e3;
      --success: #34c759;
      --error: #ff3b30;
      --warning: #ff9f0a;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-primary: #1d1d1f;
        --bg-secondary: #2d2d2f;
        --bg-tertiary: #3d3d3f;
        --border: #424245;
        --text-primary: #f5f5f7;
        --text-secondary: #86868b;
        --text-tertiary: #636366;
        --accent: #0a84ff;
      }
    }

    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      display: flex;
      flex-direction: column;
    }

    .header {
      background: var(--bg-secondary);
      padding: 0.5rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .header h1 { font-size: 0.85rem; font-weight: 500; color: var(--text-secondary); }
    .status { font-size: 0.7rem; display: flex; align-items: center; gap: 0.4rem; }
    .status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; }
    .status.connected { color: var(--success); }
    .status.connected::before { background: var(--success); }
    .status.disconnected { color: var(--error); }
    .status.disconnected::before { background: var(--error); }

    .mode-bar {
      background: var(--bg-secondary);
      padding: 0.5rem 1.5rem;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .mode-switcher {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .mode-btn {
      padding: 0.4rem 1rem;
      font-size: 0.8rem;
      cursor: pointer;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      border: none;
      border-left: 1px solid var(--border);
      font-family: inherit;
    }
    .mode-btn:first-child { border-left: none; }
    .mode-btn.active { background: var(--accent); color: white; font-weight: 500; }

    #log-container {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 1.5rem;
      font-family: 'Cascadia Code', 'Fira Code', 'SF Mono', 'Consolas', monospace;
      font-size: 0.8rem;
      line-height: 1.5;
    }

    /* Verbose mode styles */
    .entry-verbose { margin-bottom: 0.75rem; }
    .entry-verbose .timestamp-divider {
      color: var(--text-tertiary);
      font-size: 0.75rem;
      margin-bottom: 0.25rem;
    }
    .entry-verbose .tool-label {
      color: var(--accent);
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .entry-verbose .command-line { color: var(--text-primary); }
    .entry-verbose .command-line .prompt { color: var(--accent); }
    .entry-verbose .output-block {
      color: var(--text-secondary);
      margin: 0.25rem 0;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .entry-verbose .exit-badge { font-size: 0.75rem; }
    .entry-verbose .exit-badge.success { color: var(--success); }
    .entry-verbose .exit-badge.failure { color: var(--error); }

    /* Cards mode styles */
    .entry-card {
      background: var(--bg-secondary);
      border-radius: 6px;
      margin-bottom: 0.5rem;
      overflow: hidden;
    }
    .entry-card .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.6rem 1rem;
      cursor: pointer;
      border-left: 3px solid var(--success);
    }
    .entry-card.failed .card-header { border-left-color: var(--error); }
    .entry-card .card-command { font-weight: 600; font-size: 0.8rem; }
    .entry-card .card-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.7rem;
      color: var(--text-tertiary);
      flex-shrink: 0;
    }
    .entry-card .card-meta .exit-code.success { color: var(--success); }
    .entry-card .card-meta .exit-code.failure { color: var(--error); }
    .entry-card .card-body {
      display: none;
      padding: 0.5rem 1rem;
      border-top: 1px solid var(--border);
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-all;
      font-size: 0.75rem;
    }
    .entry-card.expanded .card-body { display: block; }

    /* Raw mode styles */
    #log-container.raw-mode {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 1rem;
    }
    .entry-raw .prompt { color: #6a9955; }
    .entry-raw .error-text { color: #f44747; }
    .entry-raw { margin-bottom: 0.25rem; white-space: pre-wrap; word-break: break-all; }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-tertiary);
      font-family: system-ui, sans-serif;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>HappyTrails</h1>
    <div class="status disconnected" id="status">Connecting...</div>
  </div>

  <div class="mode-bar">
    <div class="mode-switcher">
      <button class="mode-btn active" data-mode="verbose">Full Verbose</button>
      <button class="mode-btn" data-mode="cards">Structured Cards</button>
      <button class="mode-btn" data-mode="raw">Raw Terminal</button>
    </div>
  </div>

  <div id="log-container">
    <div class="empty-state">Waiting for tool activity...</div>
  </div>

  <script>
    /* === JS will be added in the next step === */
  </script>
</body>
</html>
```

- [ ] **Step 2: Write client.html — JavaScript (WebSocket + renderers)**

Replace the script placeholder with the full client-side JS:

```javascript
(function() {
  const logContainer = document.getElementById('log-container');
  const statusEl = document.getElementById('status');
  const entries = [];
  let currentMode = localStorage.getItem('happytrails-mode') || 'verbose';
  let autoScroll = true;
  let ws = null;

  // --- Mode Switching ---
  document.querySelectorAll('.mode-btn').forEach(btn => {
    if (btn.dataset.mode === currentMode) btn.classList.add('active');
    else btn.classList.remove('active');

    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
      localStorage.setItem('happytrails-mode', currentMode);
      renderAll();
    });
  });

  // --- Auto-scroll ---
  logContainer.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = logContainer;
    autoScroll = (scrollHeight - scrollTop - clientHeight) < 50;
  });

  function scrollToBottom() {
    if (autoScroll) logContainer.scrollTop = logContainer.scrollHeight;
  }

  // --- Renderers ---
  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false });
  }

  function getToolSummary(entry) {
    const t = entry.tool;
    const inp = entry.input || {};
    switch (t) {
      case 'Bash': return inp.command || '';
      case 'Read': return inp.file_path || '';
      case 'Write': return inp.file_path || '';
      case 'Edit': return inp.file_path || '';
      case 'Grep': return (inp.pattern || '') + (inp.path ? ' in ' + inp.path : '');
      case 'Glob': return inp.pattern || '';
      case 'Agent': return inp.description || inp.prompt?.slice(0, 80) || '';
      default: return JSON.stringify(inp).slice(0, 120);
    }
  }

  function getOutputText(entry) {
    const out = entry.output || {};
    if (typeof out === 'string') return out;
    if (out.stdout !== undefined) {
      let text = out.stdout || '';
      if (out.stderr) text += (text ? '\n' : '') + out.stderr;
      return text;
    }
    if (out.content !== undefined) return out.content;
    if (out.message !== undefined) return out.message;
    if (out.matches !== undefined) return JSON.stringify(out.matches, null, 2);
    if (out.files !== undefined) return out.files.join('\n');
    if (out.response !== undefined) return out.response;
    return JSON.stringify(out, null, 2);
  }

  function getExitCode(entry) {
    const out = entry.output || {};
    if (out.exit_code !== undefined) return out.exit_code;
    if (out.success === true) return 0;
    if (out.success === false) return 1;
    return null;
  }

  function isFailure(entry) {
    const code = getExitCode(entry);
    return code !== null && code !== 0;
  }

  function renderVerbose(entry) {
    const div = document.createElement('div');
    div.className = 'entry-verbose';
    const time = formatTime(entry.timestamp);
    const summary = getToolSummary(entry);
    const output = getOutputText(entry);
    const exitCode = getExitCode(entry);
    const failed = isFailure(entry);

    let html = '<div class="timestamp-divider">── ' + time + ' ──────────────────────────────────</div>';
    html += '<div class="tool-label">' + escapeHtml(entry.tool) + '</div>';
    html += '<div class="command-line"><span class="prompt">$</span> ' + escapeHtml(summary) + '</div>';
    if (output) html += '<div class="output-block">' + escapeHtml(output) + '</div>';
    if (exitCode !== null) {
      html += '<div class="exit-badge ' + (failed ? 'failure' : 'success') + '">'
        + (failed ? '✗ exit ' : '✓ exit ') + exitCode + '</div>';
    }
    div.innerHTML = html;
    return div;
  }

  function renderCard(entry) {
    const div = document.createElement('div');
    const failed = isFailure(entry);
    div.className = 'entry-card' + (failed ? ' failed' : '');
    const time = formatTime(entry.timestamp);
    const summary = getToolSummary(entry);
    const output = getOutputText(entry);
    const exitCode = getExitCode(entry);

    let html = '<div class="card-header" onclick="this.parentElement.classList.toggle(\'expanded\')">';
    html += '<span class="card-command">' + escapeHtml(entry.tool) + ': ' + escapeHtml(summary).slice(0, 80) + '</span>';
    html += '<span class="card-meta">';
    html += '<span>' + time + '</span>';
    if (exitCode !== null) {
      html += '<span class="exit-code ' + (failed ? 'failure' : 'success') + '">'
        + (failed ? '✗ ' : '✓ ') + exitCode + '</span>';
    }
    html += '</span></div>';
    html += '<div class="card-body">' + escapeHtml(output) + '</div>';
    div.innerHTML = html;
    return div;
  }

  function renderRaw(entry) {
    const div = document.createElement('div');
    div.className = 'entry-raw';
    const summary = getToolSummary(entry);
    const output = getOutputText(entry);
    let html = '<span class="prompt">$</span> ' + escapeHtml(summary);
    if (output) html += '\n' + escapeHtml(output);
    div.innerHTML = html;
    return div;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderEntry(entry) {
    switch (currentMode) {
      case 'verbose': return renderVerbose(entry);
      case 'cards': return renderCard(entry);
      case 'raw': return renderRaw(entry);
    }
  }

  function renderAll() {
    logContainer.innerHTML = '';
    logContainer.classList.toggle('raw-mode', currentMode === 'raw');
    if (entries.length === 0) {
      logContainer.innerHTML = '<div class="empty-state">Waiting for tool activity...</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    entries.forEach(e => fragment.appendChild(renderEntry(e)));
    logContainer.appendChild(fragment);
    scrollToBottom();
  }

  function appendEntry(entry) {
    entries.push(entry);
    if (entries.length === 1) logContainer.innerHTML = '';
    logContainer.appendChild(renderEntry(entry));
    scrollToBottom();
  }

  // --- WebSocket ---
  function connect() {
    ws = new WebSocket('ws://' + window.location.host);

    ws.onopen = () => {
      statusEl.className = 'status connected';
      statusEl.textContent = 'Connected';
    };

    ws.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch (e) { return; }
      if (data.type === 'entry') {
        appendEntry(data.entry);
      } else if (data.type === 'history') {
        data.entries.forEach(e => entries.push(e));
        renderAll();
      }
    };

    ws.onclose = () => {
      statusEl.className = 'status disconnected';
      statusEl.textContent = 'Disconnected';
      setTimeout(connect, 1000);
    };

    ws.onerror = () => ws.close();
  }

  // Initialize
  renderAll();
  connect();
})();
```

- [ ] **Step 3: Verify client.html is a complete, valid document**

Read through the final file and confirm:
- DOCTYPE, html, head, body tags
- All CSS present
- All JS present inside a single script tag
- No external dependencies

- [ ] **Step 4: Commit**

```bash
git add scripts/client.html
git commit -m "feat: add browser client with three view modes"
```

---

### Task 4: Node.js Server (server.cjs)

**Files:**
- Create: `scripts/server.cjs`

HTTP + WebSocket server that watches `log.jsonl` and broadcasts entries to browser clients. Adapted from the brainstorming skill's server.

- [ ] **Step 1: Write server.cjs — WebSocket protocol and configuration**

Copy the WebSocket protocol implementation (RFC 6455 frame encoding/decoding) from the brainstorming server. Set up configuration with `HAPPYTRAILS_*` env vars.

```javascript
#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ========== WebSocket Protocol (RFC 6455) ==========

const OPCODES = { TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0A };
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

function encodeFrame(opcode, payload) {
  const fin = 0x80;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = fin | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = fin | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = fin | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const secondByte = buffer[1];
  const opcode = buffer[0] & 0x0F;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7F;
  let offset = 2;
  if (!masked) throw new Error('Client frames must be masked');
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const maskOffset = offset;
  const dataOffset = offset + 4;
  const totalLen = dataOffset + payloadLen;
  if (buffer.length < totalLen) return null;
  const mask = buffer.slice(maskOffset, dataOffset);
  const data = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    data[i] = buffer[dataOffset + i] ^ mask[i % 4];
  }
  return { opcode, payload: data, bytesConsumed: totalLen };
}

// ========== Configuration ==========

const PORT = process.env.HAPPYTRAILS_PORT || (49152 + Math.floor(Math.random() * 16383));
const HOST = process.env.HAPPYTRAILS_HOST || '127.0.0.1';
const URL_HOST = process.env.HAPPYTRAILS_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);
const SESSION_DIR = process.env.HAPPYTRAILS_DIR || '/tmp/happytrails';
const LOG_FILE = process.env.HAPPYTRAILS_LOG || path.join(SESSION_DIR, 'log.jsonl');
const OWNER_PID = process.env.HAPPYTRAILS_OWNER_PID ? Number(process.env.HAPPYTRAILS_OWNER_PID) : null;
```

- [ ] **Step 2: Write server.cjs — HTTP handler and client serving**

```javascript
// ========== Client HTML ==========

const clientHtml = fs.readFileSync(path.join(__dirname, 'client.html'), 'utf-8');

// ========== HTTP Handler ==========

function handleRequest(req, res) {
  touchActivity();
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(clientHtml);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}
```

- [ ] **Step 3: Write server.cjs — WebSocket handling and broadcast**

```javascript
// ========== WebSocket ==========

const clients = new Set();

function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = computeAcceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  let buffer = Buffer.alloc(0);
  clients.add(socket);

  // Send history on connect
  const history = loadHistory();
  if (history.length > 0) {
    const msg = JSON.stringify({ type: 'history', entries: history });
    socket.write(encodeFrame(OPCODES.TEXT, Buffer.from(msg)));
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      let result;
      try { result = decodeFrame(buffer); } catch (e) {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
        clients.delete(socket);
        return;
      }
      if (!result) break;
      buffer = buffer.slice(result.bytesConsumed);
      switch (result.opcode) {
        case OPCODES.CLOSE:
          socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
          clients.delete(socket);
          return;
        case OPCODES.PING:
          socket.write(encodeFrame(OPCODES.PONG, result.payload));
          break;
      }
    }
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

function broadcast(msg) {
  const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(msg)));
  for (const socket of clients) {
    try { socket.write(frame); } catch (e) { clients.delete(socket); }
  }
}
```

- [ ] **Step 4: Write server.cjs — Log file watching and history**

```javascript
// ========== Log File Watching ==========

let fileOffset = 0;
let partialLine = '';

function loadHistory() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const content = fs.readFileSync(LOG_FILE, 'utf-8');
  fileOffset = Buffer.byteLength(content, 'utf-8');
  const entries = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch (e) {}
  }
  return entries;
}

function readNewEntries() {
  if (!fs.existsSync(LOG_FILE)) return;
  const stat = fs.statSync(LOG_FILE);
  if (stat.size <= fileOffset) {
    if (stat.size < fileOffset) fileOffset = 0; // file was truncated
    else return;
  }
  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(stat.size - fileOffset);
  fs.readSync(fd, buf, 0, buf.length, fileOffset);
  fs.closeSync(fd);
  fileOffset = stat.size;

  const text = partialLine + buf.toString('utf-8');
  const lines = text.split('\n');
  partialLine = lines.pop(); // last element is either '' or partial line

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      broadcast({ type: 'entry', entry });
    } catch (e) {}
  }
}
```

- [ ] **Step 5: Write server.cjs — Activity tracking, lifecycle, startup**

```javascript
// ========== Activity Tracking ==========

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
let lastActivity = Date.now();
function touchActivity() { lastActivity = Date.now(); }

// ========== Server Startup ==========

function startServer() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  // Create empty log file if it doesn't exist
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');

  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);

  // Watch log file for changes
  let debounceTimer = null;
  const watcher = fs.watch(path.dirname(LOG_FILE), (eventType, filename) => {
    if (filename !== path.basename(LOG_FILE)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      touchActivity();
      readNewEntries();
    }, 50);
  });
  watcher.on('error', (err) => console.error('fs.watch error:', err.message));

  function shutdown(reason) {
    console.log(JSON.stringify({ type: 'server-stopped', reason }));
    const infoFile = path.join(SESSION_DIR, '.server-info');
    if (fs.existsSync(infoFile)) fs.unlinkSync(infoFile);
    fs.writeFileSync(
      path.join(SESSION_DIR, '.server-stopped'),
      JSON.stringify({ reason, timestamp: Date.now() }) + '\n'
    );
    watcher.close();
    clearInterval(lifecycleCheck);
    server.close(() => process.exit(0));
  }

  function ownerAlive() {
    if (!OWNER_PID) return true;
    try { process.kill(OWNER_PID, 0); return true; } catch (e) { return false; }
  }

  const lifecycleCheck = setInterval(() => {
    if (!ownerAlive()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) shutdown('idle timeout');
  }, 60 * 1000);
  lifecycleCheck.unref();

  server.listen(PORT, HOST, () => {
    const info = JSON.stringify({
      type: 'server-started', port: Number(PORT), host: HOST,
      url_host: URL_HOST, url: 'http://' + URL_HOST + ':' + PORT,
      session_dir: SESSION_DIR, log_file: LOG_FILE
    });
    console.log(info);
    fs.writeFileSync(path.join(SESSION_DIR, '.server-info'), info + '\n');
  });
}

if (require.main === module) {
  startServer();
}
```

- [ ] **Step 6: Test server manually**

```bash
HAPPYTRAILS_DIR=/tmp/happytrails-test HAPPYTRAILS_LOG=/tmp/happytrails-test/log.jsonl node scripts/server.cjs &
SERVER_PID=$!
sleep 1

# Append a test entry
echo '{"timestamp":1706000101000,"tool":"Bash","input":{"command":"echo hello"},"output":{"stdout":"hello\n","exit_code":0}}' >> /tmp/happytrails-test/log.jsonl

# Check server is serving
PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/happytrails-test/.server-info','utf-8')).port)")
curl -s http://localhost:$PORT/ | head -5

kill $SERVER_PID
```

Expected: Server starts, serves HTML client, and `.server-info` file exists.

- [ ] **Step 7: Commit**

```bash
git add scripts/server.cjs
git commit -m "feat: add HTTP/WebSocket server with log file watching"
```

---

### Task 5: Lifecycle Scripts (start-server.sh, stop-server.sh)

**Files:**
- Create: `scripts/start-server.sh`
- Create: `scripts/stop-server.sh`

Adapted from brainstorming skill's scripts with `HAPPYTRAILS_*` env vars and `.happytrails/` session directory.

- [ ] **Step 1: Write start-server.sh**

Adapt brainstorming's `start-server.sh`:
- Replace `BRAINSTORM_*` env vars with `HAPPYTRAILS_*`
- Session directory: `<project>/.happytrails/<session-id>/`
- Log file path: `<session-dir>/log.jsonl`
- Same platform detection (Windows, Codex, foreground/background modes)
- Same startup verification (poll for server-started in log)

```bash
#!/usr/bin/env bash
# Start the HappyTrails server and output connection info
# Usage: start-server.sh [--project-dir <path>] [--host <bind-host>] [--url-host <display-host>] [--foreground] [--background]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PROJECT_DIR=""
FOREGROUND="false"
FORCE_BACKGROUND="false"
BIND_HOST="127.0.0.1"
URL_HOST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --host) BIND_HOST="$2"; shift 2 ;;
    --url-host) URL_HOST="$2"; shift 2 ;;
    --foreground|--no-daemon) FOREGROUND="true"; shift ;;
    --background|--daemon) FORCE_BACKGROUND="true"; shift ;;
    *) echo "{\"error\": \"Unknown argument: $1\"}"; exit 1 ;;
  esac
done

if [[ -z "$URL_HOST" ]]; then
  if [[ "$BIND_HOST" == "127.0.0.1" || "$BIND_HOST" == "localhost" ]]; then
    URL_HOST="localhost"
  else
    URL_HOST="$BIND_HOST"
  fi
fi

# Auto-foreground for environments that reap background processes
if [[ -n "${CODEX_CI:-}" && "$FOREGROUND" != "true" && "$FORCE_BACKGROUND" != "true" ]]; then
  FOREGROUND="true"
fi
if [[ "$FOREGROUND" != "true" && "$FORCE_BACKGROUND" != "true" ]]; then
  case "${OSTYPE:-}" in
    msys*|cygwin*|mingw*) FOREGROUND="true" ;;
  esac
  if [[ -n "${MSYSTEM:-}" ]]; then FOREGROUND="true"; fi
fi

SESSION_ID="$$-$(date +%s)"
if [[ -n "$PROJECT_DIR" ]]; then
  SESSION_DIR="${PROJECT_DIR}/.happytrails/${SESSION_ID}"
else
  SESSION_DIR="/tmp/happytrails-${SESSION_ID}"
fi

LOG_FILE="${SESSION_DIR}/log.jsonl"
PID_FILE="${SESSION_DIR}/.server.pid"
SERVER_LOG="${SESSION_DIR}/.server.log"

mkdir -p "$SESSION_DIR"

if [[ -f "$PID_FILE" ]]; then
  old_pid=$(cat "$PID_FILE")
  kill "$old_pid" 2>/dev/null
  rm -f "$PID_FILE"
fi

cd "$SCRIPT_DIR"

OWNER_PID="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')"
if [[ -z "$OWNER_PID" || "$OWNER_PID" == "1" ]]; then
  OWNER_PID="$PPID"
fi
case "${OSTYPE:-}" in
  msys*|cygwin*|mingw*) OWNER_PID="" ;;
esac

if [[ "$FOREGROUND" == "true" ]]; then
  echo "$$" > "$PID_FILE"
  env HAPPYTRAILS_DIR="$SESSION_DIR" HAPPYTRAILS_LOG="$LOG_FILE" HAPPYTRAILS_HOST="$BIND_HOST" HAPPYTRAILS_URL_HOST="$URL_HOST" HAPPYTRAILS_OWNER_PID="$OWNER_PID" node server.cjs
  exit $?
fi

nohup env HAPPYTRAILS_DIR="$SESSION_DIR" HAPPYTRAILS_LOG="$LOG_FILE" HAPPYTRAILS_HOST="$BIND_HOST" HAPPYTRAILS_URL_HOST="$URL_HOST" HAPPYTRAILS_OWNER_PID="$OWNER_PID" node server.cjs > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null
echo "$SERVER_PID" > "$PID_FILE"

for i in {1..50}; do
  if grep -q "server-started" "$SERVER_LOG" 2>/dev/null; then
    alive="true"
    for _ in {1..20}; do
      if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        alive="false"
        break
      fi
      sleep 0.1
    done
    if [[ "$alive" != "true" ]]; then
      echo "{\"error\": \"Server started but was killed. Retry with: $SCRIPT_DIR/start-server.sh${PROJECT_DIR:+ --project-dir $PROJECT_DIR} --host $BIND_HOST --url-host $URL_HOST --foreground\"}"
      exit 1
    fi
    grep "server-started" "$SERVER_LOG" | head -1
    exit 0
  fi
  sleep 0.1
done

echo '{"error": "Server failed to start within 5 seconds"}'
exit 1
```

- [ ] **Step 2: Write stop-server.sh**

```bash
#!/usr/bin/env bash
# Stop the HappyTrails server and clean up
# Usage: stop-server.sh <session_dir>

SESSION_DIR="$1"
if [[ -z "$SESSION_DIR" ]]; then
  echo '{"error": "Usage: stop-server.sh <session_dir>"}'
  exit 1
fi

PID_FILE="${SESSION_DIR}/.server.pid"
if [[ -f "$PID_FILE" ]]; then
  pid=$(cat "$PID_FILE")
  kill "$pid" 2>/dev/null || true
  for i in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.1
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo '{"status": "failed", "error": "process still running"}'
    exit 1
  fi
  rm -f "$PID_FILE" "${SESSION_DIR}/.server.log"
  if [[ "$SESSION_DIR" == /tmp/* ]]; then
    rm -rf "$SESSION_DIR"
  fi
  echo '{"status": "stopped"}'
else
  echo '{"status": "not_running"}'
fi
```

- [ ] **Step 3: Make scripts executable**

```bash
chmod +x scripts/start-server.sh scripts/stop-server.sh
```

- [ ] **Step 4: Test start/stop cycle**

```bash
OUTPUT=$(scripts/start-server.sh --project-dir /tmp/happytrails-e2e)
echo "$OUTPUT"
# Verify JSON output with port and URL
SESSION_DIR=$(echo "$OUTPUT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).session_dir))")
# Verify .server-info exists in $SESSION_DIR
scripts/stop-server.sh "$SESSION_DIR"
# Verify {"status": "stopped"}
```

- [ ] **Step 5: Commit**

```bash
git add scripts/start-server.sh scripts/stop-server.sh
git commit -m "feat: add server lifecycle scripts"
```

---

### Task 6: Skill File (SKILL.md)

**Files:**
- Create: `SKILL.md`

The skill definition that Claude Code loads when `/happytrails` is invoked.

- [ ] **Step 1: Write SKILL.md**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add SKILL.md
git commit -m "feat: add skill definition with start/stop lifecycle"
```

---

### Task 7: End-to-End Integration Test

**Files:** None created — manual verification

- [ ] **Step 1: Start the server**

```bash
scripts/start-server.sh --project-dir /run/media/system/Dos/Projects/HappyTrails
```

Save the session_dir and log_file from output.

- [ ] **Step 2: Open browser and verify empty state**

Open the URL. Verify:
- "HappyTrails" header visible
- "Connecting..." then "Connected" status
- Mode switcher bar with three buttons
- "Waiting for tool activity..." empty state

- [ ] **Step 3: Simulate tool output**

Pipe test data through the hook:

```bash
echo '{"session_id":"test","tool_name":"Bash","tool_input":{"command":"echo hello world"},"tool_result":{"stdout":"hello world\n","exit_code":0},"cwd":"/tmp"}' | HAPPYTRAILS_LOG=<LOG_FILE> node scripts/hook.js

echo '{"session_id":"test","tool_name":"Read","tool_input":{"file_path":"/etc/hostname"},"tool_result":{"content":"myhost\n"},"cwd":"/tmp"}' | HAPPYTRAILS_LOG=<LOG_FILE> node scripts/hook.js

echo '{"session_id":"test","tool_name":"Bash","tool_input":{"command":"exit 1"},"tool_result":{"stdout":"","stderr":"command failed","exit_code":1},"cwd":"/tmp"}' | HAPPYTRAILS_LOG=<LOG_FILE> node scripts/hook.js
```

- [ ] **Step 4: Verify all three view modes**

In browser:
- **Full Verbose**: Timestamps, `$ command` lines, output blocks, green/red exit badges
- **Structured Cards**: Collapsible cards, click to expand, color-coded borders
- **Raw Terminal**: Dark background, monospace, sequential stream

Switch between modes and verify all entries render correctly in each.

- [ ] **Step 5: Verify auto-scroll**

Send 20+ test entries rapidly. Verify:
- Page auto-scrolls to show newest entry
- Scrolling up pauses auto-scroll
- Scrolling back to bottom resumes auto-scroll

- [ ] **Step 6: Stop server and clean up**

```bash
scripts/stop-server.sh <SESSION_DIR>
```

Verify `{"status": "stopped"}` response.

- [ ] **Step 7: Commit any fixes discovered during testing**

```bash
git add -A
git commit -m "fix: adjustments from integration testing"
```

(Skip if no fixes needed.)

---

### Task 8: Final Cleanup

**Files:**
- Modify: `.gitignore` (if needed)

- [ ] **Step 1: Verify .gitignore covers runtime artifacts**

Ensure `.happytrails/` and `.superpowers/` are listed.

- [ ] **Step 2: Review all files for consistency**

Read through each file and verify:
- Env var names are consistent (`HAPPYTRAILS_*`)
- File paths referenced in SKILL.md match actual locations
- No leftover brainstorming references

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and consistency review"
```

(Skip if no changes needed.)
