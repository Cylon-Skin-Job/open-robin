/**
 * Clipboard — WebSocket message handlers
 *
 * One job: handle clipboard:* WebSocket messages.
 * Returns a handler map keyed by message type.
 */

const clipboardQueries = require('./queries');

/**
 * @param {Object} deps
 * @param {Function} deps.getDb - Returns Knex instance
 * @returns {Object<string, Function>} Message type → async handler
 */
module.exports = function createClipboardHandlers({ getDb }) {
  return {
    'clipboard:list': async (ws, msg) => {
      try {
        const offset = msg.offset || 0;
        const limit = msg.limit || 50;
        const { items, total } = await clipboardQueries.listItems(getDb(), offset, limit);
        ws.send(JSON.stringify({ type: 'clipboard:list', items, total, offset, limit }));
      } catch (err) {
        console.error('[Clipboard] list error:', err.message);
        ws.send(JSON.stringify({ type: 'clipboard:list', items: [], total: 0, error: err.message }));
      }
    },

    'clipboard:append': async (ws, msg) => {
      try {
        const { text, type = 'text', source = 'manual' } = msg;
        if (!text || typeof text !== 'string') {
          ws.send(JSON.stringify({ type: 'clipboard:append', error: 'Missing or invalid text' }));
          return;
        }
        const item = await clipboardQueries.appendItem(getDb(), { text, type, source });
        ws.send(JSON.stringify({ type: 'clipboard:append', item }));
      } catch (err) {
        console.error('[Clipboard] append error:', err.message);
        ws.send(JSON.stringify({ type: 'clipboard:append', error: err.message }));
      }
    },

    'clipboard:touch': async (ws, msg) => {
      try {
        const { id } = msg;
        if (!id || typeof id !== 'number') {
          ws.send(JSON.stringify({ type: 'clipboard:touch', error: 'Missing or invalid id' }));
          return;
        }
        const item = await clipboardQueries.touchItem(getDb(), id);
        if (!item) {
          ws.send(JSON.stringify({ type: 'clipboard:touch', error: 'Item not found' }));
          return;
        }
        ws.send(JSON.stringify({ type: 'clipboard:touch', item }));
      } catch (err) {
        console.error('[Clipboard] touch error:', err.message);
        ws.send(JSON.stringify({ type: 'clipboard:touch', error: err.message }));
      }
    },

    'clipboard:clear': async (ws) => {
      try {
        const deleted = await clipboardQueries.clearAll(getDb());
        ws.send(JSON.stringify({ type: 'clipboard:clear', deleted }));
      } catch (err) {
        console.error('[Clipboard] clear error:', err.message);
        ws.send(JSON.stringify({ type: 'clipboard:clear', error: err.message }));
      }
    },
  };
};
