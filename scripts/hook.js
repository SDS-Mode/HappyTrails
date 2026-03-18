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
