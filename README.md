# HappyTrails

Live browser-based viewer for all Claude Code agent tool activity. Streams every command, file read, write, edit, search, and more to an infinite-scroll HTML pane with three switchable view modes.

## How It Works

HappyTrails registers a `PostToolUse` hook in Claude Code that captures every tool call. A Node.js server watches the resulting log file and pushes entries to connected browsers over WebSocket in real time.

```
Agent uses tool → PostToolUse hook → log.jsonl → server → WebSocket → browser
```

## View Modes

Switch between three display modes with a single click — all render from the same data:

- **Full Verbose** — Timestamped entries with command, full output, and color-coded exit badges
- **Structured Cards** — Collapsible cards with success/failure indicators, click to expand output
- **Raw Terminal** — Dark monospace stream mimicking `tail -f`, sequential output with no chrome

## Installation

HappyTrails is a standalone Claude Code skill. Clone or download this repo, then point Claude Code to it by adding the skill directory to your configuration.

### Requirements

- Node.js (no npm install needed — zero external dependencies)
- Claude Code with hooks support

## Usage

### Start a session

Invoke `/happytrails` or `/happytrails-start` in Claude Code. The skill will:

1. Start the server on a random high port
2. Register a `PostToolUse` hook to capture all tool activity
3. Provide a URL to open in your browser

All subsequent tool calls are captured automatically — no further action needed.

### Stop a session

Invoke `/happytrails-stop`. The skill will remove the hook and shut down the server.

### Manual usage

Start the server directly:

```bash
scripts/start-server.sh --project-dir /path/to/your/project
```

This outputs JSON with the port, URL, and session directory. Open the URL in your browser.

Stop the server:

```bash
scripts/stop-server.sh <session_dir>
```

## What Gets Captured

Every tool the agent uses:

| Tool | What's Shown |
|------|-------------|
| Bash | Command, stdout/stderr, exit code |
| Read | File path, content |
| Write | File path, result |
| Edit | File path, old/new strings, result |
| Grep | Pattern, path, matches |
| Glob | Pattern, matched files |
| Agent | Description, response |
| Others | Tool name, raw input/output |

## Project Structure

```
HappyTrails/
├── .claude-plugin/
│   ├── marketplace.json  # Marketplace definition
│   └── plugin.json       # Plugin metadata
├── skills/
│   └── happytrails/
│       ├── SKILL.md      # Skill definition (entry point)
│       └── scripts/
│           ├── server.cjs        # HTTP/WebSocket server
│           ├── hook.js           # PostToolUse hook handler
│           ├── client.html       # Browser client (3 view modes)
│           ├── start-server.sh   # Server launcher
│           └── stop-server.sh    # Server shutdown
└── docs/
    └── future-features.md
```

## Configuration

The server accepts these options via `start-server.sh`:

| Flag | Description | Default |
|------|-------------|---------|
| `--project-dir <path>` | Store session files under `<path>/.happytrails/` | `/tmp` |
| `--host <host>` | Bind address | `127.0.0.1` |
| `--url-host <host>` | Hostname in returned URL | `localhost` |
| `--foreground` | Run in foreground (no backgrounding) | auto-detect |

## Browser Features

- **Auto-scroll** — Follows new entries as they arrive. Scroll up to pause, scroll back to bottom to resume.
- **Mode persistence** — Selected view mode is saved to `localStorage`
- **Connection status** — Green/red indicator shows WebSocket connection state
- **Auto-reconnect** — Reconnects automatically if the connection drops

## Roadmap

Planned post-v1 features (see `docs/future-features.md`):

- Full-text search across captured output
- Filtering by tool type and success/failure
- Export and selective export (JSONL, HTML, plain text)
- File streaming to an output file
- Persistent hooks for offline capture

## License

Unlicensed. Private project.
