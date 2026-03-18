# Parent Process Termination Spec

## Problem

When Claude Code exits (user closes the session, terminal closes, crash), the HappyTrails server continues running as an orphaned background process. The existing owner PID monitor has several reliability gaps:

1. **Fragile PID resolution** — `start-server.sh` guesses the Claude Code PID by walking up the process tree (`ps -o ppid= -p "$PPID"`). The actual depth between Claude Code and the script varies depending on how the skill executor invokes bash, whether there are intermediate shells, and the platform. The guess often captures the wrong process.

2. **60-second detection lag** — The server polls once per minute. After Claude exits, the server runs for up to 60 seconds before noticing.

3. **`.active` file not cleaned up** — `shutdown()` writes `.server-stopped` and removes `.server-info`, but does not remove `.happytrails/.active`. This leaves the hook writing to a dead session's log file until the next `/happytrails` start overwrites it.

4. **PID recycling** — On long-running or busy systems, the monitored PID could be reassigned to an unrelated process. `process.kill(pid, 0)` would succeed, preventing shutdown indefinitely.

5. **No Windows support** — Owner PID is blanked on Windows (`msys`/`cygwin`/`mingw`), so the monitor never starts.

## Design

### 1. Accept explicit PID via `--owner-pid` flag

Instead of guessing the parent process, let the caller pass the PID explicitly. The SKILL.md instructs the agent to pass its own process PID (available from the Claude Code environment) to `start-server.sh`:

```bash
<SKILL_DIR>/scripts/start-server.sh --project-dir <CWD> --owner-pid <CLAUDE_PID>
```

`start-server.sh` changes:
- Add `--owner-pid <pid>` argument parsing
- If provided, use it directly instead of the grandparent PID walk
- Fall back to the existing grandparent detection if not provided (backward compatibility)

The agent can determine its PID from the `$PPID` environment or by reading `/proc/self/stat` in the hook context. SKILL.md should instruct the agent to discover and pass the correct PID.

### 2. Faster polling with backoff

Replace the fixed 60-second interval with an adaptive schedule:

- **First 5 minutes:** Poll every 5 seconds (fast detection during active use)
- **After 5 minutes:** Poll every 30 seconds (reduce overhead for long sessions)

This cuts worst-case detection lag from 60 seconds to 5 seconds during typical usage.

Implementation in `server.cjs`:
```javascript
function startOwnerPidMonitor() {
  if (!OWNER_PID) return;
  const FAST_INTERVAL = 5000;
  const SLOW_INTERVAL = 30000;
  const FAST_DURATION = 5 * 60 * 1000;
  const startTime = Date.now();

  function check() {
    try {
      process.kill(OWNER_PID, 0);
    } catch (_) {
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

### 3. Clean up `.active` file on shutdown

The `shutdown()` function in `server.cjs` must remove `.happytrails/.active` so the hook stops writing. The server already knows `SESSION_DIR`, so it can infer the `.active` path:

```javascript
function shutdown(reason) {
  // Remove .active pointer
  try {
    const happytrailsDir = path.dirname(SESSION_DIR);
    const activePath = path.join(happytrailsDir, '.active');
    if (fs.existsSync(activePath)) {
      const activeContent = fs.readFileSync(activePath, 'utf-8').trim();
      // Only remove if it points to our log file
      if (activeContent === LOG_FILE) {
        fs.unlinkSync(activePath);
      }
    }
  } catch (_) {}

  writeServerStopped(reason);
  process.exit(0);
}
```

The conditional check (`activeContent === LOG_FILE`) prevents a new session's `.active` from being removed by an old server shutting down during a race.

### 4. PID recycling guard

Add a process start-time check to detect PID recycling. On startup, record the owner process's start time. On each poll, verify both PID existence and start time match.

**Linux/macOS:** Read `/proc/<pid>/stat` field 22 (starttime) or use `ps -o lstart= -p <pid>`.

Implementation in `server.cjs`:
```javascript
let ownerStartTime = null;

function getProcessStartTime(pid) {
  try {
    // Linux: /proc/<pid>/stat field 22
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
    const fields = stat.split(' ');
    return fields[21]; // starttime in clock ticks
  } catch (_) {}
  try {
    // macOS/Linux fallback: ps
    const result = require('child_process')
      .execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf-8', timeout: 2000 })
      .trim();
    return result;
  } catch (_) {}
  return null;
}

function isOwnerAlive() {
  try {
    process.kill(OWNER_PID, 0);
  } catch (_) {
    return false;
  }
  // If we captured start time, verify it hasn't changed (PID recycled)
  if (ownerStartTime !== null) {
    const currentStartTime = getProcessStartTime(OWNER_PID);
    if (currentStartTime !== null && currentStartTime !== ownerStartTime) {
      return false; // PID recycled
    }
  }
  return true;
}
```

On startup, capture `ownerStartTime = getProcessStartTime(OWNER_PID)`. If the platform doesn't support start time detection (Windows, permission issues), skip the check — PID-only monitoring is still better than nothing.

### 5. Windows: named pipe or lock file fallback

On Windows, where PID monitoring is disabled:

- **Lock file approach:** `start-server.sh` creates a lock file (e.g., `.happytrails/.lock`) that Claude Code holds open. The server periodically checks if the lock is still held. When Claude exits, the OS releases the lock, and the server detects it.

- Implementation: `server.cjs` attempts to acquire an exclusive lock on the file at each poll interval. If it succeeds, the owner is gone.

This is a best-effort fallback. The primary mechanism (PID + start time) covers Linux and macOS.

## Files Changed

| File | Change |
|------|--------|
| `skills/happytrails/scripts/start-server.sh` | Add `--owner-pid` flag, pass to server |
| `skills/happytrails/scripts/server.cjs` | Adaptive polling, `.active` cleanup, PID recycling guard, Windows lock file |
| `skills/happytrails/SKILL.md` | Instruct agent to pass `--owner-pid` |
| `skills/happytrails-stop/SKILL.md` | No changes needed |

## Out of Scope

- Signals-based notification (Claude Code doesn't send signals to child processes on exit)
- Systemd/launchd integration (too heavyweight for a dev tool)
- Automatic restart after parent exits (server should stop, not restart)

## Testing

1. Start HappyTrails, close the terminal running Claude Code, verify server exits within 10 seconds
2. Start HappyTrails, kill the Claude Code process, verify `.active` is removed
3. Start HappyTrails with `--owner-pid` pointing to a short-lived process, verify server exits after it completes
4. Start HappyTrails without `--owner-pid`, verify grandparent fallback still works
5. Verify PID recycling guard by simulating a recycled PID (start a process with the same PID as a previously exited one — hard to do deterministically, but can be tested with a mock)
