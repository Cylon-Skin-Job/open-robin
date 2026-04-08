/**
 * Wire debug log — rotating append-only log of wire stdin/stdout traffic.
 *
 * Extracted from server.js. Writes to open-robin-server/wire-debug.log,
 * rotating to wire-debug.log.old when size exceeds 10MB.
 *
 * Separate from server-live.log (which captures console.log output) —
 * the wire log is raw wire-protocol traffic for debugging handshake and
 * event-routing issues.
 */

const fs = require('fs');
const path = require('path');

// Resolve to open-robin-server/wire-debug.log regardless of where this
// file lives in the lib/ tree.
const WIRE_LOG_FILE = path.join(__dirname, '..', '..', 'wire-debug.log');
const MAX_WIRE_LOG_SIZE = 10 * 1024 * 1024; // 10MB

function logWire(direction, data) {
  try {
    const stats = fs.statSync(WIRE_LOG_FILE);
    if (stats.size > MAX_WIRE_LOG_SIZE) {
      try { fs.unlinkSync(WIRE_LOG_FILE + '.old'); } catch {}
      fs.renameSync(WIRE_LOG_FILE, WIRE_LOG_FILE + '.old');
    }
  } catch {}

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${direction}: ${data}\n`;
  fs.appendFileSync(WIRE_LOG_FILE, entry);
}

module.exports = { logWire, WIRE_LOG_FILE, MAX_WIRE_LOG_SIZE };
