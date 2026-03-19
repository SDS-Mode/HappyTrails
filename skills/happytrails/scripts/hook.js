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
  if (cwd) {
    try {
      const activePath = path.join(cwd, '.happytrails', '.active');
      logFile = fs.readFileSync(activePath, 'utf-8').trim() || logFile;
    } catch (e) {
      // No .active file — use env var fallback or exit
    }
  }
  if (!logFile) process.exit(0);

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

  process.exit(0);
});
