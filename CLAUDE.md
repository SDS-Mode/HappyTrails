# HappyTrails

Live browser-based viewer for all Claude Code agent tool activity. Streams every tool call to an infinite-scroll HTML pane with three switchable view modes (Full Verbose, Structured Cards, Raw Terminal).

## Architecture

```
Agent uses tool → PostToolUse hook → hook.js → log.jsonl → server.cjs → WebSocket → browser
```

Four components:
1. **SKILL.md** (`skills/happytrails/SKILL.md`) — Entry point and lifecycle orchestrator for `/happytrails`, `/happytrails-start`, `/happytrails-stop`
2. **hook.js** (`skills/happytrails/scripts/hook.js`) — PostToolUse hook handler; reads stdin JSON, appends to `log.jsonl`
3. **server.cjs** (`skills/happytrails/scripts/server.cjs`) — HTTP + WebSocket server; watches log file, broadcasts entries to browsers
4. **client.html** (`skills/happytrails/scripts/client.html`) — Single-page browser app with three view modes

## Key Files

```
hooks/
└── hooks.json               # Plugin-level PostToolUse hook declaration
skills/happytrails/
├── SKILL.md                 # Skill definition (Claude Code entry point)
└── scripts/
    ├── server.cjs           # HTTP/WebSocket server (zero dependencies)
    ├── hook.js              # PostToolUse hook handler
    ├── client.html          # Browser client (CSS + JS inline)
    ├── start-server.sh      # Server launcher
    └── stop-server.sh       # Server shutdown
```

## Design Constraints

- **Zero external dependencies** — No npm packages. WebSocket protocol implemented from scratch (RFC 6455).
- **Hook must be fast** — `hook.js` runs on every tool call. Append-only writes, silent failure, immediate exit.
- **Client-side rendering** — Server sends raw JSON; browser handles all formatting. View mode switching is instant with no round-trips.
- **Plugin-managed hooks** — The PostToolUse hook is declared in `hooks/hooks.json` and loaded automatically by Claude Code when the plugin is enabled. No manual hook registration required.

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `HAPPYTRAILS_LOG` | hook.js, server.cjs | Path to the JSONL log file |
| `HAPPYTRAILS_DIR` | server.cjs | Session directory for server state files |
| `HAPPYTRAILS_PORT` | server.cjs | Port to bind (default: random high port) |
| `HAPPYTRAILS_HOST` | server.cjs | Bind address (default: 127.0.0.1) |
| `HAPPYTRAILS_URL_HOST` | server.cjs | Display hostname for URL (default: localhost) |
| `HAPPYTRAILS_OWNER_PID` | server.cjs | Parent PID for auto-shutdown |
| `HAPPYTRAILS_ICON` | server.cjs | Header icon and favicon; emoji char or `data:image/` URI (default: 🥾) |

## Runtime Files

Session data lives in `<project>/.happytrails/<session-id>/`:
- `log.jsonl` — Append-only tool call log
- `.server-info` / `.server-stopped` — Server state
- `.server.pid` / `.server.log` — Process management

## Testing

Manual start/stop cycle:

```bash
# Start
scripts/start-server.sh --project-dir /run/media/system/Dos/Projects/HappyTrails

# Simulate a tool call through the hook
echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_result":{"stdout":"hello\n","exit_code":0}}' \
  | HAPPYTRAILS_LOG=<log_file_from_start> node scripts/hook.js

# Stop
scripts/stop-server.sh <session_dir_from_start>
```

## Plugin Metadata

- `.claude-plugin/plugin.json` — Plugin identity and version
- `.claude-plugin/marketplace.json` — Marketplace listing

## Roadmap

Post-v1 features are documented in `docs/future-features.md`: search, filtering, export, file streaming, persistent hooks.

Full design spec: `docs/superpowers/specs/2026-03-18-happytrails-design.md`
Implementation plan: `docs/superpowers/plans/2026-03-18-happytrails-implementation.md`
