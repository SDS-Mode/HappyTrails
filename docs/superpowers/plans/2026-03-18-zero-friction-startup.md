# Zero-Friction Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the first-run restart requirement by moving hook registration to plugin-level `hooks/hooks.json`, simplifying SKILL.md, and adding duplicate session detection and `.gitignore` automation.

**Architecture:** Replace agent-interpreted settings.json hook registration with a declarative `hooks/hooks.json` file using `${CLAUDE_PLUGIN_ROOT}`. Add duplicate session detection and `.gitignore` management to `start-server.sh`. Add dedup guard to `hook.js` for migration safety.

**Tech Stack:** Bash (start-server.sh), Node.js (hook.js), JSON (hooks.json), Markdown (SKILL.md)

**Spec:** `docs/superpowers/specs/2026-03-18-zero-friction-startup.md`

**Task dependencies:** Tasks 1, 2, 5, 6 are independent. Tasks 3 and 4 both modify `start-server.sh` and must be done sequentially. Task 4's tests depend on Task 3's duplicate session detection. Task 7 depends on all other tasks. Task 8 depends on Task 7.

---

## File Structure

| File | Role | Change |
|------|------|--------|
| `hooks/hooks.json` | Plugin-level hook declaration | **Create** |
| `skills/happytrails/SKILL.md` | Skill entry point for `/happytrails` | **Rewrite** |
| `skills/happytrails/scripts/hook.js` | PostToolUse hook handler | **Modify** — add dedup guard |
| `skills/happytrails/scripts/start-server.sh` | Server lifecycle manager | **Modify** — add session detection + gitignore, remove dead PID check |
| `skills/happytrails-stop/SKILL.md` | Skill entry point for `/happytrails-stop` | **Modify** — remove stale settings.json reference |
| `docs/future-features.md` | Roadmap | Already updated in spec commit |

---

### Task 1: Create `hooks/hooks.json`

**Files:**
- Create: `hooks/hooks.json`

- [ ] **Step 1: Create the hooks directory and hooks.json file**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/happytrails/scripts/hook.js\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Verify the file is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf-8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat: add plugin-level PostToolUse hook declaration"
```

---

### Task 2: Add dedup guard to `hook.js`

**Files:**
- Modify: `skills/happytrails/scripts/hook.js:48-52`

The dedup guard prevents duplicate log entries when both the old `settings.json` hook and the new plugin hook fire for the same tool event. Before appending, read the last line of the log file and compare `tool` name and stringified `input`. If they match, skip the write. Direct string comparison is used instead of hashing — zero false positives, negligible performance difference for single-line comparison.

- [ ] **Step 1: Test the current hook behavior manually**

Create a test log file and run the hook to confirm current append behavior works:

```bash
TESTDIR=$(mktemp -d)
mkdir -p "$TESTDIR/.happytrails"
LOGFILE="$TESTDIR/.happytrails/test-session/log.jsonl"
mkdir -p "$(dirname "$LOGFILE")"
echo "$LOGFILE" > "$TESTDIR/.happytrails/.active"
touch "$LOGFILE"

echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_response":{"stdout":"hello"},"cwd":"'"$TESTDIR"'"}' \
  | node skills/happytrails/scripts/hook.js

cat "$LOGFILE"
wc -l "$LOGFILE"
rm -rf "$TESTDIR"
```

Expected: 1 line in the log file containing the tool entry.

- [ ] **Step 2: Add the dedup guard**

**Replace** the try/catch write block at lines 48-52 of `hook.js` (the block containing `fs.appendFileSync`) with the following. Keep `process.exit(0)` at line 54 intact.

```javascript
  // Dedup guard: skip if last entry has same tool + input (handles double-firing
  // when both settings.json hook and plugin hook are active during migration)
  const inputStr = JSON.stringify(entry.input);
  let isDup = false;
  try {
    const buf = Buffer.alloc(16384);
    const fd = fs.openSync(logFile, 'r');
    const stat = fs.fstatSync(fd);
    const readStart = Math.max(0, stat.size - 16384);
    const bytesRead = fs.readSync(fd, buf, 0, 16384, readStart);
    fs.closeSync(fd);
    const tail = buf.toString('utf-8', 0, bytesRead);
    const lines = tail.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const last = JSON.parse(lines[lines.length - 1]);
      if (last.tool === entry.tool && JSON.stringify(last.input) === inputStr) {
        isDup = true;
      }
    }
  } catch (e) {
    // On any error, proceed with write (safe default)
  }

  if (!isDup) {
    try {
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch (e) {
      // Silently fail — never block the agent
    }
  }
```

- [ ] **Step 3: Test that normal writes still work**

```bash
TESTDIR=$(mktemp -d)
mkdir -p "$TESTDIR/.happytrails/test-session"
LOGFILE="$TESTDIR/.happytrails/test-session/log.jsonl"
echo "$LOGFILE" > "$TESTDIR/.happytrails/.active"
touch "$LOGFILE"

echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_response":{"stdout":"hello"},"cwd":"'"$TESTDIR"'"}' \
  | node skills/happytrails/scripts/hook.js

wc -l "$LOGFILE"
rm -rf "$TESTDIR"
```

Expected: `1` line.

- [ ] **Step 4: Test that duplicate writes are suppressed**

```bash
TESTDIR=$(mktemp -d)
mkdir -p "$TESTDIR/.happytrails/test-session"
LOGFILE="$TESTDIR/.happytrails/test-session/log.jsonl"
echo "$LOGFILE" > "$TESTDIR/.happytrails/.active"
touch "$LOGFILE"

PAYLOAD='{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_response":{"stdout":"hello"},"cwd":"'"$TESTDIR"'"}'

echo "$PAYLOAD" | node skills/happytrails/scripts/hook.js
echo "$PAYLOAD" | node skills/happytrails/scripts/hook.js

wc -l "$LOGFILE"
rm -rf "$TESTDIR"
```

Expected: `1` line (second write suppressed).

- [ ] **Step 5: Test that different tool calls are NOT suppressed**

```bash
TESTDIR=$(mktemp -d)
mkdir -p "$TESTDIR/.happytrails/test-session"
LOGFILE="$TESTDIR/.happytrails/test-session/log.jsonl"
echo "$LOGFILE" > "$TESTDIR/.happytrails/.active"
touch "$LOGFILE"

echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_response":{"stdout":"hello"},"cwd":"'"$TESTDIR"'"}' \
  | node skills/happytrails/scripts/hook.js

echo '{"tool_name":"Read","tool_input":{"file":"/tmp/x"},"tool_response":{"content":"x"},"cwd":"'"$TESTDIR"'"}' \
  | node skills/happytrails/scripts/hook.js

wc -l "$LOGFILE"
rm -rf "$TESTDIR"
```

Expected: `2` lines (different tool calls both written).

- [ ] **Step 6: Commit**

```bash
git add skills/happytrails/scripts/hook.js
git commit -m "feat: add dedup guard to hook.js for migration double-firing"
```

---

### Task 3: Add duplicate session detection to `start-server.sh`

**Files:**
- Modify: `skills/happytrails/scripts/start-server.sh:54-62`

Insert duplicate session detection after the `ACTIVE_FILE` variable is set (line 54) and before `mkdir -p "$SESSION_DIR"` (line 56). Also remove the now-dead PID file check at lines 58-62 — that block checks `$PID_FILE` for the new `SESSION_DIR`, which can never have a PID file since `SESSION_ID` is freshly generated with `$$-$(date +%s)`.

- [ ] **Step 1: Add the detection logic and remove dead PID check**

Insert after line 54 (`ACTIVE_FILE=...`) and before line 56 (`mkdir -p "$SESSION_DIR"`):

```bash
# --- Duplicate session detection ---
# If an active session exists, stop its server before starting a new one
if [[ -n "$ACTIVE_FILE" && -f "$ACTIVE_FILE" ]]; then
  OLD_LOG="$(cat "$ACTIVE_FILE" 2>/dev/null)"
  if [[ -n "$OLD_LOG" ]]; then
    OLD_SESSION_DIR="$(dirname "$OLD_LOG")"
    OLD_PID_FILE="${OLD_SESSION_DIR}/.server.pid"
    if [[ -f "$OLD_PID_FILE" ]]; then
      old_pid=$(cat "$OLD_PID_FILE")
      if kill -0 "$old_pid" 2>/dev/null; then
        # Server is running — stop it
        kill "$old_pid" 2>/dev/null
        for i in {1..20}; do
          if ! kill -0 "$old_pid" 2>/dev/null; then break; fi
          sleep 0.1
        done
        if kill -0 "$old_pid" 2>/dev/null; then
          kill -9 "$old_pid" 2>/dev/null || true
          sleep 0.1
        fi
      fi
      rm -f "$OLD_PID_FILE"
    fi
  fi
  rm -f "$ACTIVE_FILE"
fi
```

Then remove the dead PID file check at lines 58-62:

```bash
# REMOVE these lines:
if [[ -f "$PID_FILE" ]]; then
  old_pid=$(cat "$PID_FILE")
  kill "$old_pid" 2>/dev/null
  rm -f "$PID_FILE"
fi
```

- [ ] **Step 2: Test — start two sessions, verify no orphan**

```bash
TESTDIR=$(mktemp -d)

# Start first session, capture its PID from stdout JSON
FIRST_OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir "$TESTDIR")
FIRST_SESSION=$(echo "$FIRST_OUTPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.stdout.write(j.session_dir)})")
FIRST_PID=$(cat "${FIRST_SESSION}/.server.pid" 2>/dev/null)
echo "First server PID: $FIRST_PID"

# Start second session (should stop the first)
SECOND_OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir "$TESTDIR")
SECOND_SESSION=$(echo "$SECOND_OUTPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.stdout.write(j.session_dir)})")

# Verify first server is gone
sleep 0.5
if kill -0 "$FIRST_PID" 2>/dev/null; then
  echo "FAIL: first server still running"
else
  echo "PASS: first server stopped"
fi

# Clean up
skills/happytrails/scripts/stop-server.sh "$SECOND_SESSION" 2>/dev/null
rm -rf "$TESTDIR"
```

Expected: `PASS: first server stopped`

- [ ] **Step 3: Commit**

```bash
git add skills/happytrails/scripts/start-server.sh
git commit -m "feat: add duplicate session detection to start-server.sh"
```

---

### Task 4: Add automatic `.gitignore` management to `start-server.sh`

**Files:**
- Modify: `skills/happytrails/scripts/start-server.sh`

**Depends on:** Task 3 (duplicate session detection must be in place for tests to pass).

Insert after `mkdir -p "$SESSION_DIR"`, before the `cd "$SCRIPT_DIR"` line.

- [ ] **Step 1: Add `.gitignore` management**

Insert after `mkdir -p "$SESSION_DIR"`:

```bash
# --- Automatic .gitignore management ---
if [[ -n "$PROJECT_DIR" ]]; then
  GITIGNORE="${PROJECT_DIR}/.gitignore"
  if [[ -f "$GITIGNORE" ]]; then
    if ! grep -qxF '.happytrails/' "$GITIGNORE"; then
      echo '.happytrails/' >> "$GITIGNORE"
    fi
  else
    echo '.happytrails/' > "$GITIGNORE"
  fi
fi
```

The `grep -qxF` flag does an exact full-line fixed-string match for `.happytrails/`.

- [ ] **Step 2: Test — `.gitignore` created when missing**

```bash
TESTDIR=$(mktemp -d)
OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir "$TESTDIR")
SESSION=$(echo "$OUTPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.stdout.write(j.session_dir)})")
cat "$TESTDIR/.gitignore"
skills/happytrails/scripts/stop-server.sh "$SESSION" 2>/dev/null
rm -rf "$TESTDIR"
```

Expected: `.happytrails/`

- [ ] **Step 3: Test — `.gitignore` appended when entry missing**

```bash
TESTDIR=$(mktemp -d)
echo "node_modules/" > "$TESTDIR/.gitignore"
OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir "$TESTDIR")
SESSION=$(echo "$OUTPUT" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.stdout.write(j.session_dir)})")
cat "$TESTDIR/.gitignore"
skills/happytrails/scripts/stop-server.sh "$SESSION" 2>/dev/null
rm -rf "$TESTDIR"
```

Expected:
```
node_modules/
.happytrails/
```

- [ ] **Step 4: Test — `.gitignore` NOT duplicated on second run**

```bash
TESTDIR=$(mktemp -d)
OUTPUT1=$(skills/happytrails/scripts/start-server.sh --project-dir "$TESTDIR")
SESSION1=$(echo "$OUTPUT1" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.stdout.write(j.session_dir)})")
skills/happytrails/scripts/stop-server.sh "$SESSION1" 2>/dev/null
sleep 0.5
OUTPUT2=$(skills/happytrails/scripts/start-server.sh --project-dir "$TESTDIR")
SESSION2=$(echo "$OUTPUT2" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.stdout.write(j.session_dir)})")
grep -c '.happytrails/' "$TESTDIR/.gitignore"
skills/happytrails/scripts/stop-server.sh "$SESSION2" 2>/dev/null
rm -rf "$TESTDIR"
```

Expected: `1`

- [ ] **Step 5: Commit**

```bash
git add skills/happytrails/scripts/start-server.sh
git commit -m "feat: add automatic .gitignore management to start-server.sh"
```

---

### Task 5: Rewrite SKILL.md

**Files:**
- Rewrite: `skills/happytrails/SKILL.md`

- [ ] **Step 1: Replace SKILL.md contents**

```markdown
---
name: happytrails
description: Start live browser-based viewer for all agent tool activity — streams every command, read, write, edit, search, and more to an infinite-scroll HTML pane with three switchable view modes
invocable_by:
  - user
---

# HappyTrails — Start Session

1. Start the server:

   ```bash
   <SKILL_DIR>/scripts/start-server.sh --project-dir <CWD> --owner-pid <PPID>
   ```

   Replace `<PPID>` with the PID of the current Claude Code process (typically available as `$PPID` in the bash environment).

   Save `session_dir` from the JSON response.

2. Tell the user to open the URL in their browser.

3. Inform the user that all tool activity will now appear in the browser.

## Important

- The server auto-exits when the owner process (Claude Code) exits, or after 30 minutes of inactivity
- Session files persist in `<project>/.happytrails/` for later reference
```

- [ ] **Step 2: Verify the frontmatter is valid YAML**

Run: `node -e "const lines = require('fs').readFileSync('skills/happytrails/SKILL.md','utf-8').split('---'); console.log(lines[1].includes('name: happytrails') ? 'valid' : 'invalid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add skills/happytrails/SKILL.md
git commit -m "refactor: simplify SKILL.md — remove all hook registration logic"
```

---

### Task 6: Update `happytrails-stop/SKILL.md`

**Files:**
- Modify: `skills/happytrails-stop/SKILL.md:23`

- [ ] **Step 1: Remove the stale settings.json reference**

Replace line 23:
```
4. Do NOT remove the hook from `.claude/settings.json` — it is stable and reusable.
```

With:
```
4. Do NOT remove the hook — it is managed by the plugin and reused across sessions.
```

- [ ] **Step 2: Commit**

```bash
git add skills/happytrails-stop/SKILL.md
git commit -m "docs: update happytrails-stop to remove stale settings.json reference"
```

---

### Task 7: Manual integration test

**Depends on:** All previous tasks (1-6).

This task verifies the full end-to-end flow. It is manual because it requires an active Claude Code session with the plugin installed.

- [ ] **Step 1: Verify stdin schema parity (precondition)**

Temporarily add logging to `hook.js` to dump stdin to a debug file:

```bash
# At the top of hook.js's stdin.on('end') callback, temporarily add:
# fs.writeFileSync('/tmp/happytrails-stdin-debug.json', input);
```

Run `/happytrails`, trigger a tool call, inspect `/tmp/happytrails-stdin-debug.json` to confirm `cwd` is present. Remove the debug line after verification.

- [ ] **Step 2: Fresh start test**

Run `/happytrails` — server should start immediately with no restart prompt.

- [ ] **Step 3: Duplicate session test**

Run `/happytrails` again in the same project — old session should stop, new session should start cleanly.

- [ ] **Step 4: Migration double-firing test (if old settings.json hook exists)**

With both the plugin hook and the old `settings.json` hook active, verify log entries are not duplicated.

- [ ] **Step 5: Clean migration test**

Remove the old `settings.json` hook entry, verify single clean log entries continue.

- [ ] **Step 6: Stop test**

Run `/happytrails-stop` — server should stop cleanly.

---

### Task 8: Version bump

**Depends on:** Task 7 (integration tests must pass first).

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Bump version in both files**

Update version from `1.1.1` to `1.2.0` in both `plugin.json` and `marketplace.json` (this is a feature release).

- [ ] **Step 2: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump version to 1.2.0 for zero-friction startup"
```
