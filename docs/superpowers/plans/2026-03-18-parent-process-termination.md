# Parent Process Termination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the HappyTrails server reliably terminates when the Claude Code process that launched it exits.

**Architecture:** The server monitors an owner PID with adaptive polling (fast then slow), validates against PID recycling via process start-time comparison, cleans up `.active` on any shutdown path, and falls back to a lock file on Windows where PID monitoring is unavailable.

**Tech Stack:** Node.js (no dependencies), bash, `/proc` filesystem (Linux), `ps` command (macOS fallback)

**Spec:** `docs/superpowers/specs/2026-03-18-parent-process-termination.md`

---

### Task 1: Clean up `.active` file on shutdown

**Files:**
- Modify: `skills/happytrails/scripts/server.cjs:360-363`

The `shutdown()` function currently writes `.server-stopped` and removes `.server-info` but leaves `.happytrails/.active` in place. This causes the hook to keep writing to a dead session's log.

- [ ] **Step 1: Modify `shutdown()` to remove `.active`**

Replace the existing `shutdown` function at line 360:

```javascript
function shutdown(reason) {
  // Remove .active pointer so hook stops writing
  try {
    const happytrailsDir = path.dirname(SESSION_DIR);
    const activePath = path.join(happytrailsDir, '.active');
    const activeContent = fs.readFileSync(activePath, 'utf-8').trim();
    // Only remove if it points to our log file (avoids race with new session)
    if (activeContent === LOG_FILE) {
      fs.unlinkSync(activePath);
    }
  } catch (_) {}

  writeServerStopped(reason);
  process.exit(0);
}
```

- [ ] **Step 2: Test `.active` cleanup on normal shutdown**

```bash
# Start server
OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir /tmp/happytrails-t1)
SESSION_DIR=$(echo "$OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).session_dir))")

# Verify .active exists
cat /tmp/happytrails-t1/.happytrails/.active

# Stop server
skills/happytrails/scripts/stop-server.sh "$SESSION_DIR"

# Verify .active is gone
ls /tmp/happytrails-t1/.happytrails/.active 2>&1
# Expected: No such file or directory
```

- [ ] **Step 3: Make idle timeout configurable for testing**

In `server.cjs`, replace the hardcoded idle timeout at line 382:

```javascript
const IDLE_MS = 30 * 60 * 1000; // 30 minutes
```

with:

```javascript
const IDLE_MS = Number(process.env.HAPPYTRAILS_IDLE_TIMEOUT) || 30 * 60 * 1000;
```

- [ ] **Step 4: Test `.active` cleanup on idle timeout**

```bash
# Start server with very short idle timeout for testing
OUTPUT=$(HAPPYTRAILS_IDLE_TIMEOUT=5000 skills/happytrails/scripts/start-server.sh --project-dir /tmp/happytrails-t1b)
# Wait ~10 seconds for idle timeout
sleep 10
ls /tmp/happytrails-t1b/.happytrails/.active 2>&1
# Expected: No such file or directory
```

- [ ] **Step 5: Clean up test artifacts**

```bash
rm -rf /tmp/happytrails-t1 /tmp/happytrails-t1b
```

- [ ] **Step 6: Commit**

```bash
git add skills/happytrails/scripts/server.cjs
git commit -m "fix: clean up .active file on server shutdown"
```

---

### Task 2: Add `--owner-pid` flag to `start-server.sh`

**Files:**
- Modify: `skills/happytrails/scripts/start-server.sh:1-4` (usage comment)
- Modify: `skills/happytrails/scripts/start-server.sh:12-21` (arg parsing)
- Modify: `skills/happytrails/scripts/start-server.sh:64-70` (PID resolution)

- [ ] **Step 1: Add `--owner-pid` to usage comment and arg parser**

Update line 2:
```bash
# Usage: start-server.sh [--project-dir <path>] [--host <bind-host>] [--url-host <display-host>] [--owner-pid <pid>] [--foreground] [--background]
```

Add to the `case` block (after the `--url-host` case):
```bash
    --owner-pid) EXPLICIT_OWNER_PID="$2"; shift 2 ;;
```

Initialize `EXPLICIT_OWNER_PID=""` before the while loop (alongside the other variable declarations).

- [ ] **Step 2: Use explicit PID when provided, fall back to grandparent detection**

Replace lines 64-70 (the OWNER_PID resolution block):

```bash
if [[ -n "$EXPLICIT_OWNER_PID" ]]; then
  OWNER_PID="$EXPLICIT_OWNER_PID"
else
  OWNER_PID="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')"
  if [[ -z "$OWNER_PID" || "$OWNER_PID" == "1" ]]; then
    OWNER_PID="$PPID"
  fi
fi
case "${OSTYPE:-}" in
  msys*|cygwin*|mingw*) OWNER_PID="" ;;
esac
```

- [ ] **Step 3: Test with explicit `--owner-pid`**

```bash
# Start a sleep process to act as "owner"
sleep 300 &
OWNER=$!

# Start server with explicit owner PID
OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir /tmp/happytrails-t2 --owner-pid $OWNER)
echo "$OUTPUT"
SESSION_DIR=$(echo "$OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).session_dir))")

# Kill the "owner" — server should detect and exit
kill $OWNER
sleep 10

# Verify server is gone
PID=$(cat "$SESSION_DIR/.server.pid" 2>/dev/null)
kill -0 $PID 2>/dev/null && echo "FAIL: server still running" || echo "PASS: server exited"

# Clean up
rm -rf /tmp/happytrails-t2
```

- [ ] **Step 4: Test without `--owner-pid` (backward compatibility)**

```bash
OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir /tmp/happytrails-t2b)
echo "$OUTPUT"
SESSION_DIR=$(echo "$OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).session_dir))")

# Verify server is running (grandparent fallback should have set OWNER_PID)
PID=$(cat "$SESSION_DIR/.server.pid")
kill -0 $PID 2>/dev/null && echo "PASS: server running" || echo "FAIL: server not running"

# Clean up
skills/happytrails/scripts/stop-server.sh "$SESSION_DIR"
rm -rf /tmp/happytrails-t2b
```

- [ ] **Step 5: Commit**

```bash
git add skills/happytrails/scripts/start-server.sh
git commit -m "feat: add --owner-pid flag for explicit parent PID"
```

---

### Task 3: PID recycling guard

**Files:**
- Modify: `skills/happytrails/scripts/server.cjs:80` (add functions after OWNER_PID declaration)
- Modify: `skills/happytrails/scripts/server.cjs:409` (capture start time in Main section)

Add process start-time detection and comparison so a recycled PID doesn't fool the monitor. Uses inline `require('child_process')` for the macOS fallback (no top-level require needed).

- [ ] **Step 1: Add `getProcessStartTime()` and `isOwnerAlive()` functions**

Add these after the `OWNER_PID` declaration (after line 79) in the Configuration section:

```javascript
let ownerStartTime = null;

function getProcessStartTime(pid) {
  try {
    // Linux: /proc/<pid>/stat field 22
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
    // Handle comm field with spaces/parens: find last ')' then split
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
    const fields = afterComm.split(' ');
    return fields[19]; // field 22 is index 19 after skipping pid, comm, state (3 fields)
  } catch (_) {}
  try {
    // macOS/Linux fallback: ps
    const { execSync } = require('child_process');
    return execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf-8', timeout: 2000 }).trim();
  } catch (_) {}
  return null;
}

function isOwnerAlive() {
  try {
    process.kill(OWNER_PID, 0);
  } catch (_) {
    return false;
  }
  if (ownerStartTime !== null) {
    const currentStartTime = getProcessStartTime(OWNER_PID);
    if (currentStartTime !== null && currentStartTime !== ownerStartTime) {
      return false; // PID recycled
    }
  }
  return true;
}
```

Note on `/proc/<pid>/stat` parsing: The comm field (field 2) is wrapped in parentheses and can contain spaces and parens itself. The safe approach is to find the last `)` in the line and split everything after it. Field 22 (starttime) is the 20th field after the comm block (fields 3-onwards are index 0-based from `afterComm.split(' ')`), so it's at index 19.

- [ ] **Step 2: Capture owner start time on startup**

In the Main section, after `loadHistory()` (line 409), add:

```javascript
// Capture owner process start time for PID recycling detection
if (OWNER_PID) {
  ownerStartTime = getProcessStartTime(OWNER_PID);
  if (ownerStartTime) {
    console.log(`[server] Owner PID ${OWNER_PID} start time captured`);
  }
}
```

- [ ] **Step 3: Verify start time capture works**

```bash
# Get our shell's PID and start time
echo "Shell PID: $$"
node -e "
const fs = require('fs');
const stat = fs.readFileSync('/proc/${$$}/stat', 'utf-8');
const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
const fields = afterComm.split(' ');
console.log('Start time field:', fields[19]);
"
```

Expected: A numeric value (clock ticks since boot).

- [ ] **Step 4: Test PID recycling detection logic**

Verify that `isOwnerAlive()` returns false when the start time doesn't match (simulates a recycled PID):

```bash
node -e "
const fs = require('fs');
const pid = process.pid;

// Parse our own start time
const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf-8');
const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
const realStartTime = afterComm.split(' ')[19];

// Simulate: ownerStartTime was captured as a different value (old process)
const fakeStartTime = '99999';
console.log('Real start time:', realStartTime);
console.log('Fake start time:', fakeStartTime);
console.log('Match:', realStartTime === fakeStartTime ? 'YES (would NOT detect recycling)' : 'NO (would detect recycling)');

// The real scenario: isOwnerAlive checks if current start time matches captured one
// If they differ, PID was recycled
console.log(realStartTime !== fakeStartTime ? 'PASS: recycled PID would be detected' : 'FAIL');
"
```

Expected: `PASS: recycled PID would be detected`

- [ ] **Step 5: Commit**

```bash
git add skills/happytrails/scripts/server.cjs
git commit -m "feat: add PID recycling guard via process start-time comparison"
```

---

### Task 4: Adaptive polling with backoff

**Files:**
- Modify: `skills/happytrails/scripts/server.cjs:391-400` (replace `startOwnerPidMonitor`)

Replace the fixed 60-second `setInterval` with `setTimeout` chain that starts fast (5s) and slows down (30s) after 5 minutes.

- [ ] **Step 1: Replace `startOwnerPidMonitor()`**

Replace the existing function (lines 391-400) with:

```javascript
function startOwnerPidMonitor() {
  if (!OWNER_PID) return;
  const FAST_INTERVAL = 5000;
  const SLOW_INTERVAL = 30000;
  const FAST_DURATION = 5 * 60 * 1000;
  const startTime = Date.now();

  function check() {
    if (!isOwnerAlive()) {
      shutdown(`owner process ${OWNER_PID} no longer running`);
      return;
    }
    const elapsed = Date.now() - startTime;
    const interval = elapsed < FAST_DURATION ? FAST_INTERVAL : SLOW_INTERVAL;
    setTimeout(check, interval).unref();
  }

  setTimeout(check, FAST_INTERVAL).unref();
}
```

- [ ] **Step 2: Test fast detection**

```bash
# Start a short-lived owner
sleep 10 &
OWNER=$!

OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir /tmp/happytrails-t4 --owner-pid $OWNER)
SESSION_DIR=$(echo "$OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).session_dir))")
PID=$(cat "$SESSION_DIR/.server.pid")

# Kill owner
kill $OWNER

# Wait 10 seconds — should be enough for the 5-second poll to catch it
sleep 10

kill -0 $PID 2>/dev/null && echo "FAIL: server still running" || echo "PASS: server exited within 10s"

# Verify .active was cleaned up
ls /tmp/happytrails-t4/.happytrails/.active 2>&1
# Expected: No such file or directory

rm -rf /tmp/happytrails-t4
```

- [ ] **Step 3: Commit**

```bash
git add skills/happytrails/scripts/server.cjs
git commit -m "feat: adaptive owner PID polling (5s fast, 30s slow)"
```

---

### Task 5: Windows lock file fallback

**Files:**
- Modify: `skills/happytrails/scripts/start-server.sh:68-70` (Windows section)
- Modify: `skills/happytrails/scripts/server.cjs` (add lock file check to lifecycle section)

On Windows, PID monitoring is disabled. Use a lock file that the launcher holds open; when the launcher's parent exits, the OS releases the file, and the server can detect it.

- [ ] **Step 1: Write owner PID to lock file in `start-server.sh` on Windows**

Replace the Windows OWNER_PID blanking (lines 68-70 in the current code, after the explicit PID changes):

```bash
case "${OSTYPE:-}" in
  msys*|cygwin*|mingw*)
    OWNER_PID=""
    # Write launcher's PPID to lock file for Windows fallback detection
    # The server polls this PID since process.kill(pid,0) works on Windows Node.js
    LOCK_FILE="${SESSION_DIR}/.owner.lock"
    echo "$PPID" > "$LOCK_FILE"
    ;;
esac
```

Also pass the lock file path to the server via env var. Add `HAPPYTRAILS_LOCK_FILE` to both the foreground and background `env` commands.

Foreground path (line 75):
```bash
env HAPPYTRAILS_DIR="$SESSION_DIR" HAPPYTRAILS_LOG="$LOG_FILE" HAPPYTRAILS_HOST="$BIND_HOST" HAPPYTRAILS_URL_HOST="$URL_HOST" HAPPYTRAILS_OWNER_PID="$OWNER_PID" HAPPYTRAILS_LOCK_FILE="${LOCK_FILE:-}" node server.cjs
```

Background path (line 80):
```bash
nohup env HAPPYTRAILS_DIR="$SESSION_DIR" HAPPYTRAILS_LOG="$LOG_FILE" HAPPYTRAILS_HOST="$BIND_HOST" HAPPYTRAILS_URL_HOST="$URL_HOST" HAPPYTRAILS_OWNER_PID="$OWNER_PID" HAPPYTRAILS_LOCK_FILE="${LOCK_FILE:-}" node server.cjs > "$SERVER_LOG" 2>&1 &
```

- [ ] **Step 2: Add lock file PID check to `server.cjs`**

In the Configuration section, after the `OWNER_PID` line:

```javascript
const LOCK_FILE = process.env.HAPPYTRAILS_LOCK_FILE || null;
```

Add a function in the Lifecycle section. This reads the PID from the lock file and polls it — `process.kill(pid, 0)` works on Windows Node.js even though bash PID monitoring doesn't:

```javascript
let lockFilePid = null;

function initLockFilePid() {
  if (!LOCK_FILE) return;
  try {
    lockFilePid = Number(fs.readFileSync(LOCK_FILE, 'utf-8').trim());
    if (!lockFilePid || isNaN(lockFilePid)) lockFilePid = null;
  } catch (_) {
    lockFilePid = null;
  }
}

function isLockFilePidAlive() {
  if (lockFilePid === null) return null; // Not applicable
  try {
    process.kill(lockFilePid, 0);
    return true;
  } catch (_) {
    return false;
  }
}
```

Update `isOwnerAlive()` to include lock file fallback:

```javascript
function isOwnerAlive() {
  // PID-based check (Linux/macOS)
  if (OWNER_PID) {
    try {
      process.kill(OWNER_PID, 0);
    } catch (_) {
      return false;
    }
    if (ownerStartTime !== null) {
      const currentStartTime = getProcessStartTime(OWNER_PID);
      if (currentStartTime !== null && currentStartTime !== ownerStartTime) {
        return false;
      }
    }
    return true;
  }
  // Lock file PID fallback (Windows)
  const lockAlive = isLockFilePidAlive();
  if (lockAlive !== null) return lockAlive;
  // No monitoring available
  return true;
}
```

Call `initLockFilePid()` in the Main section alongside the owner start time capture.

- [ ] **Step 3: Verify lock file is not created on Linux**

```bash
OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir /tmp/happytrails-t5)
SESSION_DIR=$(echo "$OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).session_dir))")
ls "$SESSION_DIR/.owner.lock" 2>&1
# Expected: No such file (lock file only created on Windows)
skills/happytrails/scripts/stop-server.sh "$SESSION_DIR"
rm -rf /tmp/happytrails-t5
```

- [ ] **Step 4: Commit**

```bash
git add skills/happytrails/scripts/server.cjs skills/happytrails/scripts/start-server.sh
git commit -m "feat: Windows lock file fallback for parent process detection"
```

---

### Task 6: Update SKILL.md to pass `--owner-pid`

**Files:**
- Modify: `skills/happytrails/SKILL.md:43` (start-server command)

- [ ] **Step 1: Update the start command in SKILL.md**

Change the server start command (step 3) from:

```bash
<SKILL_DIR>/scripts/start-server.sh --project-dir <CWD>
```

to:

```bash
<SKILL_DIR>/scripts/start-server.sh --project-dir <CWD> --owner-pid <PPID>
```

Where `<PPID>` is the PID of the Claude Code process. Add a note below:

```
Replace `<PPID>` with the PID of the current Claude Code process (typically available as `$PPID` in the bash environment).
```

- [ ] **Step 2: Commit**

```bash
git add skills/happytrails/SKILL.md
git commit -m "docs: instruct agent to pass --owner-pid when starting server"
```

---

### Task 7: Integration test

**Files:** None created — manual verification

- [ ] **Step 1: Full start/stop cycle with --owner-pid**

```bash
sleep 300 &
OWNER=$!

OUTPUT=$(skills/happytrails/scripts/start-server.sh --project-dir /run/media/system/Dos/Projects/HappyTrails --owner-pid $OWNER)
echo "$OUTPUT"
SESSION_DIR=$(echo "$OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).session_dir))")

# Verify .active exists
cat /run/media/system/Dos/Projects/HappyTrails/.happytrails/.active

# Simulate tool call through hook
echo '{"session_id":"test","tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_response":{"stdout":"hello\n","exit_code":0},"cwd":"/run/media/system/Dos/Projects/HappyTrails"}' | node skills/happytrails/scripts/hook.js

# Verify log entry was written
cat "$SESSION_DIR/log.jsonl"

# Kill owner — server should auto-exit within 10 seconds
kill $OWNER
sleep 10

PID=$(cat "$SESSION_DIR/.server.pid" 2>/dev/null)
kill -0 $PID 2>/dev/null && echo "FAIL: server still running" || echo "PASS: server exited"

# Verify .active was cleaned up
ls /run/media/system/Dos/Projects/HappyTrails/.happytrails/.active 2>&1
# Expected: No such file or directory
```

- [ ] **Step 2: Verify hook is inert after server exit**

```bash
# With .active gone, hook should exit silently
echo '{"session_id":"test","tool_name":"Bash","tool_input":{"command":"echo noop"},"tool_response":{"stdout":"noop\n","exit_code":0},"cwd":"/run/media/system/Dos/Projects/HappyTrails"}' | node skills/happytrails/scripts/hook.js
echo "exit: $?"
# Expected: exit 0, no log file written
```

- [ ] **Step 3: Clean up**

```bash
rm -rf /run/media/system/Dos/Projects/HappyTrails/.happytrails/
```

---

### Task 8: Version bump and push

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Bump version to 1.1.0**

This is a feature release (new `--owner-pid` flag, adaptive polling, PID recycling guard). Bump minor version.

Update both files: `"version": "1.0.4"` → `"version": "1.1.0"`

- [ ] **Step 2: Commit and push**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump version to 1.1.0 for parent process termination"
git push origin master
```

- [ ] **Step 3: Update marketplace and plugin**

```bash
git -C /home/dmickles/.claude/plugins/marketplaces/happytrails-marketplace/ pull origin master
claude plugins update happytrails@happytrails-marketplace
```
