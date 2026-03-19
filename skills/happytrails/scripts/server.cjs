'use strict';

// =============================================================================
// Section 1: WebSocket Protocol (RFC 6455)
// =============================================================================

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OPCODES = { TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0A };
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

function encodeFrame(opcode, payload) {
  const fin = 0x80;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = fin | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = fin | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = fin | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const secondByte = buffer[1];
  const opcode = buffer[0] & 0x0F;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7F;
  let offset = 2;
  if (!masked) throw new Error('Client frames must be masked');
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const maskOffset = offset;
  const dataOffset = offset + 4;
  const totalLen = dataOffset + payloadLen;
  if (buffer.length < totalLen) return null;
  const mask = buffer.slice(maskOffset, dataOffset);
  const data = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    data[i] = buffer[dataOffset + i] ^ mask[i % 4];
  }
  return { opcode, payload: data, bytesConsumed: totalLen };
}

// =============================================================================
// Section 2: Configuration
// =============================================================================

const PORT = process.env.HAPPYTRAILS_PORT || (49152 + Math.floor(Math.random() * 16383));
const HOST = process.env.HAPPYTRAILS_HOST || '127.0.0.1';
const URL_HOST = process.env.HAPPYTRAILS_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);
const SESSION_DIR = process.env.HAPPYTRAILS_DIR || '/tmp/happytrails';
const LOG_FILE = process.env.HAPPYTRAILS_LOG || path.join(SESSION_DIR, 'log.jsonl');
const OWNER_PID = process.env.HAPPYTRAILS_OWNER_PID ? Number(process.env.HAPPYTRAILS_OWNER_PID) : null;
const LOCK_FILE = process.env.HAPPYTRAILS_LOCK_FILE || null;

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

// =============================================================================
// Section 3: HTTP Handler
// =============================================================================

// Read client.html at startup (relative to this script's location)
const CLIENT_HTML_PATH = path.join(__dirname, 'client.html');
let clientHtml;
try {
  clientHtml = fs.readFileSync(CLIENT_HTML_PATH, 'utf-8');
} catch (err) {
  console.error(`[server] Failed to read client.html from ${CLIENT_HTML_PATH}: ${err.message}`);
  clientHtml = '<!DOCTYPE html><html><body><h1>HappyTrails</h1><p>client.html not found</p></body></html>';
}

let lastActivityTime = Date.now();

function touchActivity() {
  lastActivityTime = Date.now();
}

function handleHttp(req, res) {
  touchActivity();
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(clientHtml),
    });
    res.end(clientHtml);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

// =============================================================================
// Section 4: WebSocket Handling
// =============================================================================

const clients = new Set();

function broadcast(msg) {
  const payload = Buffer.from(JSON.stringify(msg), 'utf-8');
  const frame = encodeFrame(OPCODES.TEXT, payload);
  for (const socket of clients) {
    try {
      socket.write(frame);
    } catch (err) {
      console.error(`[server] Error broadcasting to client: ${err.message}`);
      clients.delete(socket);
    }
  }
}

function sendToSocket(socket, msg) {
  const payload = Buffer.from(JSON.stringify(msg), 'utf-8');
  const frame = encodeFrame(OPCODES.TEXT, payload);
  try {
    socket.write(frame);
  } catch (err) {
    console.error(`[server] Error sending to client: ${err.message}`);
    clients.delete(socket);
  }
}

function handleUpgrade(req, socket, head) {
  touchActivity();

  const clientKey = req.headers['sec-websocket-key'];
  if (!clientKey) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const acceptKey = computeAcceptKey(clientKey);
  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n',
  ].join('\r\n');

  socket.write(responseHeaders);
  clients.add(socket);
  console.log(`[server] WebSocket client connected (total: ${clients.size})`);

  // Send history to newly connected client
  const history = loadHistory();
  sendToSocket(socket, { type: 'history', entries: history });

  let buf = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);

  socket.on('data', (chunk) => {
    touchActivity();
    buf = Buffer.concat([buf, chunk]);

    while (buf.length >= 2) {
      let frame;
      try {
        frame = decodeFrame(buf);
      } catch (err) {
        console.error(`[server] WebSocket frame decode error: ${err.message}`);
        socket.destroy();
        clients.delete(socket);
        return;
      }
      if (!frame) break; // Need more data

      buf = buf.slice(frame.bytesConsumed);

      if (frame.opcode === OPCODES.CLOSE) {
        // Send CLOSE response
        const closeFrame = encodeFrame(OPCODES.CLOSE, frame.payload.slice(0, 2));
        try {
          socket.write(closeFrame);
        } catch (_) {}
        socket.destroy();
        clients.delete(socket);
        console.log(`[server] WebSocket client closed (total: ${clients.size})`);
        return;
      } else if (frame.opcode === OPCODES.PING) {
        const pongFrame = encodeFrame(OPCODES.PONG, frame.payload);
        try {
          socket.write(pongFrame);
        } catch (err) {
          console.error(`[server] Error sending PONG: ${err.message}`);
          clients.delete(socket);
        }
      } else if (frame.opcode === OPCODES.PONG) {
        // Ignore unsolicited PONGs
      }
      // TEXT frames from client are ignored (server is broadcast-only)
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
    console.log(`[server] WebSocket socket closed (total: ${clients.size})`);
  });

  socket.on('error', (err) => {
    console.error(`[server] WebSocket socket error: ${err.message}`);
    clients.delete(socket);
  });
}

// =============================================================================
// Section 5: Log File Watching
// =============================================================================

let fileOffset = 0;
let partialLine = '';
let debounceTimer = null;

function loadHistory() {
  try {
    const stat = fs.statSync(LOG_FILE);
    const data = fs.readFileSync(LOG_FILE, 'utf-8');
    fileOffset = stat.size;
    const entries = [];
    for (const line of data.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch (_) {
        // Skip malformed lines
      }
    }
    return entries;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[server] Error loading history: ${err.message}`);
    }
    fileOffset = 0;
    return [];
  }
}

function readNewEntries() {
  try {
    const stat = fs.statSync(LOG_FILE);
    const fileSize = stat.size;

    // Handle truncation
    if (fileSize < fileOffset) {
      console.log(`[server] Log file truncated, resetting offset`);
      fileOffset = 0;
      partialLine = '';
    }

    if (fileSize <= fileOffset) return;

    const fd = fs.openSync(LOG_FILE, 'r');
    const chunkSize = fileSize - fileOffset;
    const buf = Buffer.alloc(chunkSize);
    fs.readSync(fd, buf, 0, chunkSize, fileOffset);
    fs.closeSync(fd);
    fileOffset = fileSize;

    const text = partialLine + buf.toString('utf-8');
    const lines = text.split('\n');

    // The last element may be a partial line if the file didn't end with '\n'
    partialLine = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        broadcast({ type: 'entry', entry });
      } catch (_) {
        // Skip malformed lines
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[server] Error reading new entries: ${err.message}`);
    }
  }
}

function startWatcher() {
  const watchDir = path.dirname(LOG_FILE);

  try {
    fs.watch(watchDir, (eventType, filename) => {
      if (filename && path.basename(LOG_FILE) !== filename) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        readNewEntries();
      }, 50);
    });
    console.log(`[server] Watching directory: ${watchDir}`);
  } catch (err) {
    console.error(`[server] Failed to watch directory ${watchDir}: ${err.message}`);
  }
}

// =============================================================================
// Section 6: Lifecycle
// =============================================================================

const SERVER_INFO_FILE = path.join(SESSION_DIR, '.server-info');
const SERVER_STOPPED_FILE = path.join(SESSION_DIR, '.server-stopped');

function writeServerInfo(port) {
  const url = `http://${URL_HOST}:${port}/`;
  const info = {
    type: 'happytrails-server',
    port,
    host: HOST,
    url_host: URL_HOST,
    url,
    session_dir: SESSION_DIR,
    log_file: LOG_FILE,
  };
  try {
    fs.writeFileSync(SERVER_INFO_FILE, JSON.stringify(info, null, 2), 'utf-8');
    console.log(`[server] Server info written to ${SERVER_INFO_FILE}`);
  } catch (err) {
    console.error(`[server] Failed to write server info: ${err.message}`);
  }
}

function writeServerStopped(reason) {
  try {
    const stopped = { reason, timestamp: new Date().toISOString() };
    fs.writeFileSync(SERVER_STOPPED_FILE, JSON.stringify(stopped, null, 2), 'utf-8');
  } catch (_) {}
  try {
    fs.unlinkSync(SERVER_INFO_FILE);
  } catch (_) {}
  console.log(`[server] Server stopped: ${reason}`);
}

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

  // Clean up server runtime files
  try { fs.unlinkSync(path.join(SESSION_DIR, '.server.pid')); } catch (_) {}
  try { fs.unlinkSync(path.join(SESSION_DIR, '.server.log')); } catch (_) {}

  writeServerStopped(reason);
  process.exit(0);
}

function ensureSessionDir() {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.error(`[server] Failed to create SESSION_DIR: ${err.message}`);
    }
  }
  // Create empty log file if it doesn't exist
  try {
    fs.writeFileSync(LOG_FILE, '', { flag: 'a' });
  } catch (err) {
    console.error(`[server] Failed to ensure log file exists: ${err.message}`);
  }
}

function startIdleTimeout() {
  const IDLE_MS = Number(process.env.HAPPYTRAILS_IDLE_TIMEOUT) || 30 * 60 * 1000;
  const CHECK_MS = Math.min(IDLE_MS, 60 * 1000);
  setInterval(() => {
    const idleMs = Date.now() - lastActivityTime;
    if (idleMs >= IDLE_MS) {
      shutdown('idle timeout');
    }
  }, CHECK_MS).unref();
}

function startOwnerPidMonitor() {
  if (!OWNER_PID && lockFilePid === null) return;
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

// =============================================================================
// Main
// =============================================================================

ensureSessionDir();

// Initialize file offset from current log file size
loadHistory(); // sets fileOffset to current end of file

initLockFilePid();

// Capture owner process start time for PID recycling detection
if (OWNER_PID) {
  ownerStartTime = getProcessStartTime(OWNER_PID);
  if (ownerStartTime) {
    console.log(`[server] Owner PID ${OWNER_PID} start time captured`);
  }
}

const server = http.createServer(handleHttp);
server.on('upgrade', handleUpgrade);

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const actualPort = addr.port;
  console.log(`[server] HappyTrails server listening on http://${URL_HOST}:${actualPort}/`);
  console.log(`[server] Session dir: ${SESSION_DIR}`);
  console.log(`[server] Log file: ${LOG_FILE}`);
  writeServerInfo(actualPort);
  const url = `http://${URL_HOST}:${actualPort}/`;
  console.log(JSON.stringify({
    type: 'server-started',
    port: actualPort,
    host: HOST,
    url_host: URL_HOST,
    url,
    session_dir: SESSION_DIR,
    log_file: LOG_FILE,
  }));
  startWatcher();
  startIdleTimeout();
  startOwnerPidMonitor();
});

server.on('error', (err) => {
  console.error(`[server] HTTP server error: ${err.message}`);
  shutdown(`server error: ${err.message}`);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error(`[server] Uncaught exception: ${err.stack}`);
  shutdown(`uncaught exception: ${err.message}`);
});
