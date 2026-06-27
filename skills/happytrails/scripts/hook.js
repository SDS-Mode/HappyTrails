#!/usr/bin/env node
'use strict';

// HappyTrails PostToolUse hook
// Reads tool call data from stdin, appends a JSON line to the log file.
// Must be fast — runs on every tool call.
//
// Log file discovery: reads <cwd>/.happytrails/.active for the current
// session's log path. Falls back to HAPPYTRAILS_LOG env var.
// If neither exists, exits silently (no active session).

const fs = require('fs');
const path = require('path');

// Restrictive umask so the log file — which can contain commands and secrets
// in tool output — is created 0600 if this process is what creates it.
process.umask(0o077);

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

  // Resolve log file: .active file first, then env var fallback
  let logFile = process.env.HAPPYTRAILS_LOG || null;
  const cwd = data.cwd || null;
  let fromActive = false;
  if (cwd) {
    try {
      const activePath = path.join(cwd, '.happytrails', '.active');
      const active = fs.readFileSync(activePath, 'utf-8').trim();
      if (active) { logFile = active; fromActive = true; }
    } catch (e) {
      // No .active file — use env var fallback or exit
    }
  }
  if (!logFile) process.exit(0);

  // A session log resolved from .active must stay inside <cwd>/.happytrails/, and
  // must not be a symlink that escapes it. A booby-trapped .active (e.g. a
  // malicious cloned repo) could otherwise redirect appends to an arbitrary file.
  // The HAPPYTRAILS_LOG env var is operator-set (by start-server.sh), so it's
  // trusted without confinement.
  if (fromActive && cwd) {
    const htRoot = path.resolve(cwd, '.happytrails');
    let resolved;
    try {
      resolved = fs.realpathSync(logFile); // follow symlinks → real location
    } catch (_) {
      // Log may not exist yet: resolve lexically, but reject a leaf symlink.
      try { if (fs.lstatSync(logFile).isSymbolicLink()) process.exit(0); } catch (_) {}
      resolved = path.resolve(logFile);
    }
    const rel = path.relative(htRoot, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      process.exit(0); // escapes <cwd>/.happytrails — refuse to write
    }
  }

  const entry = {
    timestamp: Date.now(),
    session_id: data.session_id || null,
    tool: data.tool_name || 'unknown',
    input: data.tool_input || {},
    output: data.tool_response || {},
    cwd: cwd
  };

  // Passthrough subagent context for grouping
  if (data.agent_id) entry.parent_agent_id = data.agent_id;
  if (data.agent_type) entry.agent_type = data.agent_type;
  if (data.permission_mode) entry.permission_mode = data.permission_mode;

  // Dedup guard: suppress the double-fire that occurs when both a settings.json
  // hook and the plugin hook fire for the same PostToolUse event. Such pairs
  // arrive within milliseconds; a genuine repeated call (e.g. `git status` twice,
  // or reading the same file again) is seconds+ apart. So require the prior
  // entry to match tool+input AND be recent — otherwise we'd drop real calls.
  const DEDUP_WINDOW_MS = 2000;
  const DEDUP_TAIL = 65536; // 64 KB tail; large enough for typical entries
  const inputStr = JSON.stringify(entry.input);
  let isDup = false;
  try {
    const buf = Buffer.allocUnsafe(DEDUP_TAIL);
    const fd = fs.openSync(logFile, 'r');
    const stat = fs.fstatSync(fd);
    const readStart = Math.max(0, stat.size - DEDUP_TAIL);
    const bytesRead = fs.readSync(fd, buf, 0, DEDUP_TAIL, readStart);
    fs.closeSync(fd);
    const tail = buf.toString('utf-8', 0, bytesRead);
    // Walk backward to the most recent COMPLETE line. The first line in the tail
    // may be partial (the read started mid-entry); skip unparseable lines rather
    // than failing, so a large prior entry doesn't defeat the check.
    const lines = tail.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let last;
      try { last = JSON.parse(line); } catch (e) { continue; }
      const age = entry.timestamp - last.timestamp;
      if (last.tool === entry.tool &&
          JSON.stringify(last.input) === inputStr &&
          typeof last.timestamp === 'number' &&
          age >= 0 && age <= DEDUP_WINDOW_MS) {
        isDup = true;
      }
      break; // only the most recent complete entry is a candidate
    }
  } catch (e) {
    // On any error, proceed with write (safe default — never block the agent)
  }

  if (!isDup) {
    try {
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch (e) {
      // Silently fail — never block the agent
    }
  }

  process.exit(0);
});
