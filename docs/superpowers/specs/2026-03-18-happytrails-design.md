# HappyTrails Design Spec

## Overview

HappyTrails is a standalone Claude Code skill that provides live browser-based visibility into all agent tool activity. It captures every tool call (Bash, Read, Write, Edit, Grep, Glob, etc.) via Claude Code's hook system and streams structured output to an infinite-scroll HTML pane in the browser with three switchable view modes.

## Architecture

Three components connected by a JSONL log file:

```
Agent uses tool
  → Claude Code fires PostToolUse hook
    → hook.js appends JSON line to log.jsonl
      → server.cjs detects file change
        → broadcasts entry via WebSocket
          → browser renders in active view mode
```

### Component 1: Skill File (SKILL.md)

Entry point and lifecycle orchestrator.

**User-invocable commands:**
- `/happytrails` and `/happytrails-start` — Start the server, register hooks, present the URL
- `/happytrails-stop` — Remove hooks, stop the server

**Startup sequence:**
1. Run `scripts/start-server.sh --project-dir <cwd>`
2. Add a `PostToolUse` hook entry to the project's `.claude/settings.json` pointing to `scripts/hook.js` with the log file path as an env var (`HAPPYTRAILS_LOG`)
3. Tell user to open the browser URL
4. Session runs passively — all subsequent tool calls captured automatically

**Teardown sequence:**
1. Remove the `PostToolUse` hook entry from `.claude/settings.json`
2. Run `scripts/stop-server.sh <session_dir>`

### Component 2: Hook Handler (hook.js)

A Node.js script registered as a `PostToolUse` hook for all tool types.

**Input:** Claude Code provides hook data via environment variables and stdin:
- `CLAUDE_TOOL_NAME` — tool identifier
- Tool input and output via stdin (JSON)
- Session metadata (working directory, etc.)

**Output:** Appends a single JSON line to the log file at `$HAPPYTRAILS_LOG`:

```json
{
  "timestamp": 1706000101000,
  "tool": "Bash",
  "input": {"command": "npm run build", "description": "Build the project"},
  "output": "> happytrails@1.0.0 build\n> tsc -p tsconfig.json\n",
  "exit_code": 0
}
```

**Requirements:**
- Must be fast — runs on every tool call, should not add perceptible latency
- Must handle missing/malformed data gracefully (append what's available)
- Must use append-mode file writes (no read-modify-write)

### Component 3: Node.js Server (server.cjs)

HTTP + WebSocket server adapted from the brainstorming skill's visual companion.

**File watching:**
- Watches a single `log.jsonl` file for appends
- Tracks byte offset; reads only new bytes on each `fs.watch` event
- Parses new content into lines, broadcasts each as a WebSocket message

**HTTP handler:**
- `GET /` — Serves the client HTML app (client.html with CSS and JS bundled inline)
- No other routes needed

**WebSocket protocol:**
- Same RFC 6455 implementation from brainstorming (no library dependency)
- Server→client only: sends new log entries as JSON
- No `.events` file (read-only viewer)

**Lifecycle:**
- Owner PID monitoring (auto-shutdown when parent exits)
- 30-minute idle timeout
- `.server-info` / `.server-stopped` files for state detection
- Graceful shutdown via SIGTERM with SIGKILL fallback

**Environment variables:**
- `HAPPYTRAILS_PORT` — port to bind (default: random high port)
- `HAPPYTRAILS_HOST` — bind host (default: 127.0.0.1)
- `HAPPYTRAILS_URL_HOST` — display host for URL (default: localhost)
- `HAPPYTRAILS_DIR` — session directory for server state files
- `HAPPYTRAILS_LOG` — path to the JSONL log file to watch

### Component 4: Browser Client (client.html)

Single-page HTML app served by the server.

**Mode switcher:**
- Segmented radio bar at top: Full Verbose / Structured Cards / Raw Terminal
- Switching re-renders all existing entries from in-memory array (no refetch)
- Selection persists in localStorage

**Log container:**
- Single scrollable div with all rendered entries
- Auto-scrolls to bottom as new entries arrive
- Auto-scroll pauses when user scrolls up; resumes when user scrolls back to bottom

**WebSocket client:**
- Connects to server, receives JSON events
- Pushes entries into in-memory array, calls active renderer
- Auto-reconnects on disconnect (1-second retry)

**Three renderers (all take same JSON entry):**

1. **Full Verbose** — Timestamp divider line, `$ command` prompt, full output block, color-coded exit code badge (green ✓ / red ✗)
2. **Structured Cards** — Collapsible card with color-coded left border, command as header, timestamp + exit code on right, click to expand/collapse output
3. **Raw Terminal** — Dark monospace block, `$ command` in green, output as plain text, sequential stream with blinking cursor at bottom

**Connection status:**
- Small dot indicator in header (green = connected, red = disconnected)

## File Layout

```
HappyTrails/
├── .claude-plugin/
│   ├── marketplace.json    # Marketplace definition
│   └── plugin.json         # Plugin metadata
├── skills/
│   └── happytrails/
│       ├── SKILL.md        # Skill definition and instructions
│       └── scripts/
│           ├── server.cjs      # Node.js HTTP/WebSocket server
│           ├── hook.js         # PostToolUse hook handler
│           ├── client.html     # Browser client (frame + CSS + JS)
│           ├── start-server.sh # Server launcher
│           └── stop-server.sh  # Server shutdown
└── docs/
    ├── superpowers/
    │   ├── specs/           # Design specs
    │   └── plans/           # Implementation plans
    └── future-features.md   # Roadmap for post-v1 features
```

**Runtime files (created in session directory):**
```
<project>/.happytrails/<session-id>/
├── log.jsonl          # Append-only tool call log
├── .server-info       # Server startup JSON
├── .server-stopped    # Written on shutdown
├── .server.pid        # Server process ID
└── .server.log        # Server stdout/stderr
```

## v1 Scope

**In scope:**
- Three view modes with radio switcher
- Infinite scroll with smart auto-scroll
- Capture all tool types via PostToolUse hook
- Connection status indicator
- Self-installing hooks on start, self-removing on stop
- Cross-platform server lifecycle (Linux, macOS, Windows)

**Out of scope (v1):**
- Search
- Filtering by tool type or status
- Export / selective export
- Streaming to external file
- Persistent hooks (always-on capture)

## Future Features (Post-v1)

These features are planned but not included in v1:

### Search
- Full-text search across all captured output
- Highlight matches in current view mode
- Search-as-you-type with debounce

### Filtering
- Filter by tool type (checkboxes: Bash, Read, Write, Edit, Grep, Glob, etc.)
- Filter by status (success / failure)
- Combine filters with search
- Filter state reflected in URL hash for shareability

### Export
- Export full log as JSONL file (raw data)
- Export rendered view as HTML or plain text
- Selective export: select specific entries to include

### File Streaming
- Configure an output file path; HappyTrails streams log entries to that file in addition to the browser
- Useful for piping into other tools or archiving

### Persistent Hooks
- **Decision point:** Currently hooks are ephemeral (installed on start, removed on stop). A future option could keep hooks always active, writing to a log file even when the server isn't running. This enables post-hoc review and background monitoring. See memory: `project_hook_persistence.md`.

## Design Decisions

1. **Single JSONL file over per-event files** — HappyTrails is a streaming log viewer, not an interactive screen picker. A single append-only file is the natural fit, simpler to watch, and doubles as a ready-made export artifact.

2. **Client-side rendering over server-side** — The server sends raw JSON; the browser handles all formatting. This keeps the server thin and makes view mode switching instant without round-trips.

3. **No external dependencies** — Following brainstorming's pattern: WebSocket protocol implemented from scratch, no npm packages. The entire skill is self-contained.

4. **Ephemeral hooks** — Hooks are registered on start and removed on stop. This keeps HappyTrails non-invasive when not in use. Persistent hooks are a documented future option.
