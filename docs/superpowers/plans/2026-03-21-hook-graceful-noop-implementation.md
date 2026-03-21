# Hook Graceful No-Op Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PostToolUse hook exit instantly (under 10ms) when no HappyTrails session is active, eliminating Node.js startup overhead and visible hook errors.

**Architecture:** A bash guard wrapper (`hook-guard.sh`) checks for an active session before spawning Node. Two fast checks: `.active` file existence, then `HAPPYTRAILS_LOG` env var. If neither signals an active session, exit 0 immediately. Otherwise, `exec node hook.js` with stdin inherited.

**Tech Stack:** Bash, existing Node.js hook

**Spec:** `docs/superpowers/specs/2026-03-21-hook-graceful-noop-design.md`

---

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `skills/happytrails/scripts/hook-guard.sh` | Bash guard wrapper — hook entry point |
| Modify | `hooks/hooks.json` | Point hook command at guard instead of hook.js |
| Modify | `CLAUDE.md` | Update architecture diagram and key files |

---

### Task 1: Verify PWD assumption

Before writing any code, confirm that Claude Code sets `PWD` to the project root when invoking plugin hooks. This is the critical assumption the entire design rests on.

**Files:**
- Modify: `skills/happytrails/scripts/hook.js:18` (temporary debug line)

- [ ] **Step 1: Add temporary PWD logging to hook.js**

Add this line inside the `stdin.on('end')` handler, before the JSON parse, at line 19 of `skills/happytrails/scripts/hook.js`:

```javascript
try { require('fs').appendFileSync('/tmp/hook-pwd-debug.log', 'PWD=' + process.cwd() + ' env.PWD=' + process.env.PWD + '\n'); } catch(e) {}
```

- [ ] **Step 2: Trigger a few tool calls in a Claude Code session**

Run any tool calls in this project (e.g., read a file, run a bash command). Each one fires the hook.

- [ ] **Step 3: Check the debug log**

Run: `cat /tmp/hook-pwd-debug.log`

Expected: Every line shows `PWD=/run/media/system/Dos/Projects/HappyTrails` (or whatever the project root is). If `PWD` points somewhere else (e.g., the plugin cache, `/tmp`, or home dir), the guard design needs an alternative — stop here and revisit the spec.

- [ ] **Step 4: Remove temporary debug line and clean up**

Revert `hook.js` to its original state. Delete `/tmp/hook-pwd-debug.log`.

Run: `rm /tmp/hook-pwd-debug.log`

- [ ] **Step 5: Commit (nothing to commit — revert only)**

No commit needed. hook.js should be back to its original state with no diff.

---

### Task 2: Create hook-guard.sh

**Files:**
- Create: `skills/happytrails/scripts/hook-guard.sh`

- [ ] **Step 1: Write hook-guard.sh**

Create `skills/happytrails/scripts/hook-guard.sh` with the exact content from the spec:

```bash
#!/usr/bin/env bash
set -u
trap 'exit 0' ERR

# Fast-path no-op: exit before spawning Node if no active session.
# Primary check: .happytrails/.active file in the project directory.
# Fallback: HAPPYTRAILS_LOG env var (manual/advanced usage only —
# not set during normal hook invocations since Claude Code spawns
# a fresh process for each hook call).
#
# The ERR trap ensures the guard always exits 0, even if dirname,
# cd, or exec fails unexpectedly. This matches hook.js's philosophy:
# silently fail, never block the agent.

# Primary check: .active file in project root.
# Assumption: Claude Code sets PWD to the project root when invoking
# plugin hooks. If this assumption breaks, the guard false-negatives
# (no-ops when a session is active). hook.js has a secondary .active
# lookup via stdin's data.cwd field, so the worst case is a missed
# log entry — not an error. See "PWD assumption" in Assumptions section.
if [[ -f "${PWD}/.happytrails/.active" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  exec node "${SCRIPT_DIR}/hook.js"
fi

# Env var fallback — only effective when explicitly exported by the
# caller (e.g., manual testing, custom wrapper scripts). Checked
# second to match hook.js priority order (.active first, env var second).
# A stale HAPPYTRAILS_LOG in a shell profile would defeat the guard,
# so .active is the authoritative signal.
if [[ -n "${HAPPYTRAILS_LOG:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  exec node "${SCRIPT_DIR}/hook.js"
fi

exit 0
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x skills/happytrails/scripts/hook-guard.sh`

- [ ] **Step 3: Test no-op path (no active session)**

Run:
```bash
cd /run/media/system/Dos/Projects/HappyTrails
unset HAPPYTRAILS_LOG
rm -f .happytrails/.active
echo '{"tool_name":"Bash"}' | bash skills/happytrails/scripts/hook-guard.sh
echo $?
```

Expected: exit code `0`, no output.

- [ ] **Step 4: Test timing on no-op path**

Run:
```bash
cd /run/media/system/Dos/Projects/HappyTrails
unset HAPPYTRAILS_LOG
rm -f .happytrails/.active
time (echo '{}' | bash skills/happytrails/scripts/hook-guard.sh)
```

Expected: `real` under 10ms (0.010s). Likely 2-5ms.

- [ ] **Step 5: Test active session path via .active file**

Run:
```bash
cd /run/media/system/Dos/Projects/HappyTrails
mkdir -p .happytrails
echo "/tmp/ht-test-log.jsonl" > .happytrails/.active
echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"},"cwd":"/run/media/system/Dos/Projects/HappyTrails"}' | bash skills/happytrails/scripts/hook-guard.sh
cat /tmp/ht-test-log.jsonl
```

Expected: One JSON line in `/tmp/ht-test-log.jsonl` with `"tool":"Bash"`.

- [ ] **Step 6: Test active session path via HAPPYTRAILS_LOG env var**

Run:
```bash
cd /run/media/system/Dos/Projects/HappyTrails
rm -f .happytrails/.active
rm -f /tmp/ht-test-log2.jsonl
echo '{"tool_name":"Read","tool_input":{"file_path":"/tmp/x"}}' | HAPPYTRAILS_LOG=/tmp/ht-test-log2.jsonl bash skills/happytrails/scripts/hook-guard.sh
cat /tmp/ht-test-log2.jsonl
```

Expected: One JSON line in `/tmp/ht-test-log2.jsonl` with `"tool":"Read"`.

- [ ] **Step 7: Test ERR trap (exec failure)**

Run:
```bash
cd /run/media/system/Dos/Projects/HappyTrails
mkdir -p .happytrails
echo "/tmp/doesnt-matter" > .happytrails/.active
echo '{}' | PATH="" bash skills/happytrails/scripts/hook-guard.sh
echo $?
```

Expected: exit code `0` (ERR trap catches the failed `exec node` and exits cleanly).

- [ ] **Step 8: Clean up test artifacts**

Run:
```bash
rm -f .happytrails/.active /tmp/ht-test-log.jsonl /tmp/ht-test-log2.jsonl
```

- [ ] **Step 9: Commit**

```bash
git add skills/happytrails/scripts/hook-guard.sh
git commit -m "feat: add hook-guard.sh for fast no-op when no active session"
```

---

### Task 3: Wire up hooks.json

**Files:**
- Modify: `hooks/hooks.json:9`

- [ ] **Step 1: Update hooks.json command**

In `hooks/hooks.json`, change line 9 from:

```json
"command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/happytrails/scripts/hook.js\""
```

to:

```json
"command": "bash \"${CLAUDE_PLUGIN_ROOT}/skills/happytrails/scripts/hook-guard.sh\""
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); console.log('valid')"`

Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat: point PostToolUse hook at hook-guard.sh"
```

---

### Task 4: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:8,13,26-27,35,43`

- [ ] **Step 1: Update architecture diagram**

In `CLAUDE.md`, change line 8 from:

```
Agent uses tool → PostToolUse hook → hook.js → log.jsonl → server.cjs → WebSocket → browser
```

to:

```
Agent uses tool → PostToolUse hook → hook-guard.sh → (if active) hook.js → log.jsonl → server.cjs → WebSocket → browser
```

- [ ] **Step 2: Update component list**

In `CLAUDE.md`, replace the full component block (lines 11-15) from:

```
Four components:
1. **SKILL.md** (`skills/happytrails/SKILL.md`) — Entry point and lifecycle orchestrator for `/happytrails`, `/happytrails-start`, `/happytrails-stop`
2. **hook.js** (`skills/happytrails/scripts/hook.js`) — PostToolUse hook handler; reads stdin JSON, appends to `log.jsonl`
3. **server.cjs** (`skills/happytrails/scripts/server.cjs`) — HTTP + WebSocket server; watches log file, broadcasts entries to browsers
4. **client.html** (`skills/happytrails/scripts/client.html`) — Single-page browser app with three view modes
```

to:

```
Five components:
1. **SKILL.md** (`skills/happytrails/SKILL.md`) — Entry point and lifecycle orchestrator for `/happytrails`, `/happytrails-start`, `/happytrails-stop`
2. **hook-guard.sh** (`skills/happytrails/scripts/hook-guard.sh`) — Fast-path guard; checks for active session before spawning Node
3. **hook.js** (`skills/happytrails/scripts/hook.js`) — PostToolUse hook handler; reads stdin JSON, appends to `log.jsonl`
4. **server.cjs** (`skills/happytrails/scripts/server.cjs`) — HTTP + WebSocket server; watches log file, broadcasts entries to browsers
5. **client.html** (`skills/happytrails/scripts/client.html`) — Single-page browser app with three view modes
```

- [ ] **Step 3: Update key files tree**

In the Key Files tree, add `hook-guard.sh` after `hook.js`:

```
skills/happytrails/
├── SKILL.md                 # Skill definition (Claude Code entry point)
└── scripts/
    ├── server.cjs           # HTTP/WebSocket server (zero dependencies)
    ├── hook-guard.sh        # Fast-path guard (bash, no Node on no-op)
    ├── hook.js              # PostToolUse hook handler
    ├── client.html          # Browser client (CSS + JS inline)
    ├── start-server.sh      # Server launcher
    └── stop-server.sh       # Server shutdown
```

- [ ] **Step 4: Update hook design constraint**

Change the "Hook must be fast" bullet in Design Constraints from:

```
- **Hook must be fast** — `hook.js` runs on every tool call. Append-only writes, silent failure, immediate exit.
```

to:

```
- **Hook must be fast** — `hook-guard.sh` runs on every tool call, exits in <5ms when no session is active. When active, forwards to `hook.js` for append-only writes, silent failure, immediate exit.
```

- [ ] **Step 5: Update environment variables table**

Add `hook-guard.sh` to the "Used By" column for `HAPPYTRAILS_LOG`:

Change: `hook.js, server.cjs`
To: `hook-guard.sh, hook.js, server.cjs`

- [ ] **Step 6: Update Testing section**

In the Testing section of `CLAUDE.md` (lines 60-72), update the manual hook test to use the guard. Change:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_result":{"stdout":"hello\n","exit_code":0}}' \
  | HAPPYTRAILS_LOG=<log_file_from_start> node scripts/hook.js
```

to:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_result":{"stdout":"hello\n","exit_code":0},"cwd":"/path/to/project"}' \
  | bash scripts/hook-guard.sh
```

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect hook-guard.sh entry point"
```

---

### Task 5: End-to-end verification

- [ ] **Step 1: Start a HappyTrails session and verify logging works**

Run:
```bash
cd /run/media/system/Dos/Projects/HappyTrails
bash skills/happytrails/scripts/start-server.sh --project-dir "$PWD"
```

Note the log file path from the output. Then simulate a tool call through the guard:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_response":{"stdout":"hello\n"},"cwd":"/run/media/system/Dos/Projects/HappyTrails"}' | bash skills/happytrails/scripts/hook-guard.sh
```

Verify the entry was logged:

```bash
tail -1 <log_file_from_start>
```

Expected: JSON line with `"tool":"Bash"`.

- [ ] **Step 2: Stop the session and verify no-op**

Stop the server (use the session dir from step 1):

```bash
bash skills/happytrails/scripts/stop-server.sh <session_dir>
```

Verify `.active` is gone:

```bash
ls .happytrails/.active 2>&1
```

Expected: "No such file or directory"

Now verify the guard no-ops:

```bash
echo '{"tool_name":"Bash"}' | bash skills/happytrails/scripts/hook-guard.sh
echo $?
```

Expected: exit code `0`, no output, fast return.

- [ ] **Step 3: Verify hooks.json points to guard**

Run: `cat hooks/hooks.json | grep hook-guard`

Expected: Line containing `hook-guard.sh`.

- [ ] **Step 4: Clean up any test session dirs**

Run:
```bash
rm -rf .happytrails/
```
