'use strict';

jest.mock('../../../lib/secrets/clipboard/backend');
jest.mock('../../../lib/event-bus');

const backend = require('../../../lib/secrets/clipboard/backend');
const eventBus = require('../../../lib/event-bus');
const createClipboardHandlers = require('../../../lib/secrets/clipboard/handlers');

// Make the real ClipboardBackendError class available on the mocked backend
// so `err instanceof backend.ClipboardBackendError` works in handlers.
class ClipboardBackendError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ClipboardBackendError';
    this.code = code;
  }
}
backend.ClipboardBackendError = ClipboardBackendError;

function makeWs() {
  return { readyState: 1, send: jest.fn(), sent: () => makeWs._sentJson(this) };
}
function lastJson(ws) {
  const calls = ws.send.mock.calls;
  return calls.length ? JSON.parse(calls[calls.length - 1][0]) : null;
}

let handlers;
let allClients;

beforeEach(() => {
  jest.resetAllMocks();
  backend.ClipboardBackendError = ClipboardBackendError;
  allClients = [makeWs(), makeWs()];
  handlers = createClipboardHandlers({ getAllClients: () => allClients });
});

describe('clipboard:list', () => {
  test('returns metadata items + total', async () => {
    backend.list.mockResolvedValue({
      items: [{ id: 1, type: 'text', preview: 'hi', last_used_at: 100 }],
      total: 1,
    });
    const ws = makeWs();
    await handlers['clipboard:list'](ws, { offset: 0, limit: 10 });
    const out = lastJson(ws);
    expect(out.type).toBe('clipboard:list');
    expect(out.items).toHaveLength(1);
    expect(out.total).toBe(1);
  });
});

describe('clipboard:append', () => {
  test('emits clipboard:added on new row, broadcasts state', async () => {
    backend.append.mockResolvedValue({
      id: 1, type: 'text', preview: 'hi', source: 'manual', last_used_at: 100, deduped: false,
    });
    backend.list.mockResolvedValue({ items: [], total: 0 });
    const ws = makeWs();
    await handlers['clipboard:append'](ws, { text: 'hi' });
    expect(eventBus.emit).toHaveBeenCalledWith('clipboard:added', expect.objectContaining({
      kind: 'clipboard',
      id: 1,
    }));
    // Broadcast went to all clients.
    for (const client of allClients) {
      const msg = lastJson(client);
      expect(msg.type).toBe('clipboard:state');
    }
  });

  test('emits clipboard:used on dedup, not added', async () => {
    backend.append.mockResolvedValue({
      id: 5, type: 'text', preview: 'hi', source: 'manual', last_used_at: 200, deduped: true,
    });
    backend.list.mockResolvedValue({ items: [], total: 0 });
    const ws = makeWs();
    await handlers['clipboard:append'](ws, { text: 'hi' });
    expect(eventBus.emit).toHaveBeenCalledWith('clipboard:used', expect.objectContaining({ id: 5 }));
    expect(eventBus.emit).not.toHaveBeenCalledWith('clipboard:added', expect.anything());
  });

  test('backend error sends clipboard:error frame', async () => {
    backend.append.mockRejectedValue(new ClipboardBackendError('INVALID_VALUE', 'nope'));
    const ws = makeWs();
    await handlers['clipboard:append'](ws, { text: '' });
    const out = lastJson(ws);
    expect(out.type).toBe('clipboard:error');
    expect(out.code).toBe('INVALID_VALUE');
  });
});

describe('clipboard:use', () => {
  test('returns value to requesting socket only, emits used', async () => {
    backend.use.mockResolvedValue({
      row: { id: 9, type: 'text', preview: 'foo', source: 'auto', last_used_at: 300 },
      value: 'the-real-value',
    });
    backend.list.mockResolvedValue({ items: [], total: 0 });
    const ws = makeWs();
    await handlers['clipboard:use'](ws, { id: 9 });
    const out = lastJson(ws);
    expect(out.type).toBe('clipboard:use');
    expect(out.value).toBe('the-real-value');
    expect(eventBus.emit).toHaveBeenCalledWith('clipboard:used', expect.objectContaining({ id: 9 }));
    // Broadcast does NOT contain the value — broadcast carries metadata only.
    for (const client of allClients) {
      const msg = lastJson(client);
      expect(msg.type).toBe('clipboard:state');
      expect(msg.value).toBeUndefined();
    }
  });
});

describe('clipboard:delete', () => {
  test('emits clipboard:deleted when removal succeeds', async () => {
    backend.remove.mockResolvedValue(true);
    backend.list.mockResolvedValue({ items: [], total: 0 });
    const ws = makeWs();
    await handlers['clipboard:delete'](ws, { id: 4 });
    expect(eventBus.emit).toHaveBeenCalledWith('clipboard:deleted', { kind: 'clipboard', id: 4 });
    const out = lastJson(ws);
    expect(out.type).toBe('clipboard:delete');
    expect(out.removed).toBe(true);
  });

  test('does not emit deleted when row was already gone', async () => {
    backend.remove.mockResolvedValue(false);
    const ws = makeWs();
    await handlers['clipboard:delete'](ws, { id: 999 });
    expect(eventBus.emit).not.toHaveBeenCalled();
    const out = lastJson(ws);
    expect(out.removed).toBe(false);
  });
});

describe('clipboard:clear', () => {
  test('emits clipboard:cleared with deleted count', async () => {
    backend.clear.mockResolvedValue(7);
    backend.list.mockResolvedValue({ items: [], total: 0 });
    const ws = makeWs();
    await handlers['clipboard:clear'](ws, {});
    expect(eventBus.emit).toHaveBeenCalledWith('clipboard:cleared', { kind: 'clipboard', deleted: 7 });
    const out = lastJson(ws);
    expect(out.type).toBe('clipboard:clear');
    expect(out.deleted).toBe(7);
  });
});
