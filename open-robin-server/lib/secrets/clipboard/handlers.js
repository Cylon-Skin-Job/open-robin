/**
 * Clipboard — WebSocket handler map.
 *
 * One job: map clipboard:* messages to backend calls, emit UEB events on
 * mutation, broadcast state to all connected clients.
 *
 * Backend errors send a clipboard:error frame to the requesting socket;
 * unexpected errors bubble (real bugs surface).
 *
 * See CLIPBOARD_KEYCHAIN_REDESIGN.md §3a, §3e.
 */

'use strict';

const backend = require('./backend');
const { emit } = require('../../event-bus');

function publicFields(row) {
  return {
    kind: 'clipboard',
    id: row.id,
    type: row.type,
    preview: row.preview,
    source: row.source,
    last_used_at: row.last_used_at,
  };
}

function createClipboardHandlers({ getAllClients }) {
  function broadcast(items, total) {
    const payload = JSON.stringify({ type: 'clipboard:state', items, total });
    for (const ws of getAllClients()) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }

  function sendError(ws, code, message) {
    ws.send(JSON.stringify({ type: 'clipboard:error', code, message }));
  }

  async function broadcastAll() {
    const { items, total } = await backend.list({ offset: 0, limit: 50 });
    broadcast(items, total);
  }

  return {
    'clipboard:list': async (ws, msg) => {
      try {
        const offset = Number.isInteger(msg.offset) ? msg.offset : 0;
        const limit = Number.isInteger(msg.limit) ? msg.limit : 50;
        const { items, total } = await backend.list({ offset, limit });
        ws.send(JSON.stringify({ type: 'clipboard:list', items, total, offset, limit }));
      } catch (err) {
        if (err instanceof backend.ClipboardBackendError) {
          sendError(ws, err.code, err.message);
          return;
        }
        throw err;
      }
    },

    'clipboard:append': async (ws, msg) => {
      try {
        const row = await backend.append({ text: msg.text, source: msg.source });
        ws.send(JSON.stringify({ type: 'clipboard:append', item: publicFields(row) }));
        if (!row.deduped) {
          emit('clipboard:added', publicFields(row));
        } else {
          emit('clipboard:used', publicFields(row));
        }
        await broadcastAll();
      } catch (err) {
        if (err instanceof backend.ClipboardBackendError) {
          sendError(ws, err.code, err.message);
          return;
        }
        throw err;
      }
    },

    'clipboard:use': async (ws, msg) => {
      try {
        const { row, value } = await backend.use(msg.id);
        // Value is sent back to the requesting socket only — the chat-input
        // insertion path. The WS debug logger redaction map (lib/ws/redaction-map.js)
        // scrubs `value` on serialization so it never lands in server-live.log.
        ws.send(JSON.stringify({ type: 'clipboard:use', id: row.id, value }));
        emit('clipboard:used', publicFields(row));
        await broadcastAll();
      } catch (err) {
        if (err instanceof backend.ClipboardBackendError) {
          sendError(ws, err.code, err.message);
          return;
        }
        throw err;
      }
    },

    'clipboard:touch': async (ws, msg) => {
      try {
        const row = await backend.touch(msg.id);
        ws.send(JSON.stringify({ type: 'clipboard:touch', item: publicFields(row) }));
        emit('clipboard:used', publicFields(row));
        await broadcastAll();
      } catch (err) {
        if (err instanceof backend.ClipboardBackendError) {
          sendError(ws, err.code, err.message);
          return;
        }
        throw err;
      }
    },

    'clipboard:delete': async (ws, msg) => {
      try {
        const removed = await backend.remove(msg.id);
        ws.send(JSON.stringify({ type: 'clipboard:delete', id: msg.id, removed }));
        if (removed) {
          emit('clipboard:deleted', { kind: 'clipboard', id: msg.id });
          await broadcastAll();
        }
      } catch (err) {
        if (err instanceof backend.ClipboardBackendError) {
          sendError(ws, err.code, err.message);
          return;
        }
        throw err;
      }
    },

    'clipboard:clear': async (ws) => {
      try {
        const deleted = await backend.clear();
        ws.send(JSON.stringify({ type: 'clipboard:clear', deleted }));
        emit('clipboard:cleared', { kind: 'clipboard', deleted });
        await broadcastAll();
      } catch (err) {
        if (err instanceof backend.ClipboardBackendError) {
          sendError(ws, err.code, err.message);
          return;
        }
        throw err;
      }
    },
  };
}

module.exports = createClipboardHandlers;
