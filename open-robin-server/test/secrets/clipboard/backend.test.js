'use strict';

jest.mock('../../../lib/secrets/clipboard/keychain');
jest.mock('../../../lib/secrets/clipboard/index-table');

const keychain = require('../../../lib/secrets/clipboard/keychain');
const indexTable = require('../../../lib/secrets/clipboard/index-table');
const backend = require('../../../lib/secrets/clipboard/backend');

beforeEach(() => {
  jest.resetAllMocks();
});

describe('backend.append', () => {
  test('inserts new row, writes keychain, returns metadata without value', async () => {
    indexTable.getByContentHash.mockResolvedValue(null);
    indexTable.insert.mockResolvedValue(42);
    indexTable.count.mockResolvedValue(1);
    indexTable.get.mockResolvedValue({
      id: 42, type: 'text', preview: 'hello world', content_hash: 'abc',
      created_at: 1, last_used_at: 1, source: 'manual',
    });
    keychain.set.mockResolvedValue();

    const row = await backend.append({ text: 'hello world' });

    expect(indexTable.insert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'text',
      preview: 'hello world',
      source: 'manual',
    }));
    expect(keychain.set).toHaveBeenCalledWith(42, 'hello world');
    expect(row.id).toBe(42);
    expect(row).not.toHaveProperty('value');
    expect(row).not.toHaveProperty('text');
  });

  test('dedup hit touches existing row, no new keychain write', async () => {
    const existing = { id: 5, type: 'text', preview: 'hi', content_hash: 'h', last_used_at: 100 };
    indexTable.getByContentHash.mockResolvedValue(existing);
    indexTable.touch.mockResolvedValue(true);

    const row = await backend.append({ text: 'hi' });

    expect(indexTable.insert).not.toHaveBeenCalled();
    expect(keychain.set).not.toHaveBeenCalled();
    expect(indexTable.touch).toHaveBeenCalledWith(5, expect.any(Number));
    expect(row.deduped).toBe(true);
    expect(row.id).toBe(5);
  });

  test('secret-shaped value gets fingerprint preview, type=secret', async () => {
    indexTable.getByContentHash.mockResolvedValue(null);
    indexTable.insert.mockResolvedValue(7);
    indexTable.count.mockResolvedValue(1);
    indexTable.get.mockResolvedValue({
      id: 7, type: 'secret', preview: '••••••••••••7890',
      content_hash: 'x', created_at: 1, last_used_at: 1, source: 'manual',
    });
    keychain.set.mockResolvedValue();

    await backend.append({ text: 'sk_live_abcdef1234567890' });

    expect(indexTable.insert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'secret',
      preview: '••••••••••••' + '7890',
    }));
  });

  test('rejects empty string', async () => {
    await expect(backend.append({ text: '' })).rejects.toMatchObject({
      code: 'INVALID_VALUE',
    });
  });

  test('rejects non-string text', async () => {
    await expect(backend.append({ text: null })).rejects.toMatchObject({
      code: 'INVALID_VALUE',
    });
  });

  test('rolls back index row if keychain write fails', async () => {
    indexTable.getByContentHash.mockResolvedValue(null);
    indexTable.insert.mockResolvedValue(99);
    keychain.set.mockRejectedValue(new Error('keychain locked'));
    indexTable.remove.mockResolvedValue(true);

    await expect(backend.append({ text: 'hello world' })).rejects.toThrow('keychain locked');

    expect(indexTable.remove).toHaveBeenCalledWith(99);
  });

  test('prunes to capacity after insert', async () => {
    indexTable.getByContentHash.mockResolvedValue(null);
    indexTable.insert.mockResolvedValue(31);
    indexTable.count.mockResolvedValue(31); // CLIPBOARD_CAP=30, so one over
    indexTable.listOldestIds.mockResolvedValue([1]);
    indexTable.removeMany.mockResolvedValue(1);
    indexTable.get.mockResolvedValue({ id: 31, type: 'text', preview: 'x', last_used_at: 1 });
    keychain.set.mockResolvedValue();
    keychain.del.mockResolvedValue(true);

    await backend.append({ text: 'this is a brand new clipboard value' });

    expect(indexTable.listOldestIds).toHaveBeenCalledWith(1);
    expect(indexTable.removeMany).toHaveBeenCalledWith([1]);
    expect(keychain.del).toHaveBeenCalledWith(1);
  });
});

describe('backend.use', () => {
  test('returns row + value, bumps last_used_at', async () => {
    const row = { id: 3, type: 'text', preview: 'foo', last_used_at: 100 };
    indexTable.get.mockResolvedValue(row);
    keychain.get.mockResolvedValue('the-stored-value');
    indexTable.touch.mockResolvedValue(true);

    const result = await backend.use(3);

    expect(result.value).toBe('the-stored-value');
    expect(result.row.id).toBe(3);
    expect(result.row.last_used_at).toBeGreaterThanOrEqual(100);
    expect(indexTable.touch).toHaveBeenCalledWith(3, expect.any(Number));
  });

  test('throws NOT_FOUND when row missing', async () => {
    indexTable.get.mockResolvedValue(null);

    await expect(backend.use(99)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('cleans up orphan row when keychain entry missing', async () => {
    indexTable.get.mockResolvedValue({ id: 4, type: 'text', preview: 'x' });
    keychain.get.mockResolvedValue(null);
    indexTable.remove.mockResolvedValue(true);

    await expect(backend.use(4)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(indexTable.remove).toHaveBeenCalledWith(4);
  });
});

describe('backend.remove', () => {
  test('deletes row + keychain entry', async () => {
    indexTable.get.mockResolvedValue({ id: 8, type: 'text' });
    indexTable.remove.mockResolvedValue(true);
    keychain.del.mockResolvedValue(true);

    const ok = await backend.remove(8);

    expect(ok).toBe(true);
    expect(indexTable.remove).toHaveBeenCalledWith(8);
    expect(keychain.del).toHaveBeenCalledWith(8);
  });

  test('returns false when row not found', async () => {
    indexTable.get.mockResolvedValue(null);

    const ok = await backend.remove(99);

    expect(ok).toBe(false);
    expect(indexTable.remove).not.toHaveBeenCalled();
    expect(keychain.del).not.toHaveBeenCalled();
  });
});

describe('backend.deleteByContentHash', () => {
  test('removes matching row and keychain entry, returns row', async () => {
    const match = { id: 12, content_hash: 'h', type: 'text' };
    indexTable.getByContentHash.mockResolvedValue(match);
    indexTable.remove.mockResolvedValue(true);
    keychain.del.mockResolvedValue(true);

    const row = await backend.deleteByContentHash('h');

    expect(row).toEqual(match);
    expect(indexTable.remove).toHaveBeenCalledWith(12);
    expect(keychain.del).toHaveBeenCalledWith(12);
  });

  test('returns null when no row matches', async () => {
    indexTable.getByContentHash.mockResolvedValue(null);

    const row = await backend.deleteByContentHash('nope');

    expect(row).toBeNull();
    expect(indexTable.remove).not.toHaveBeenCalled();
    expect(keychain.del).not.toHaveBeenCalled();
  });
});

describe('backend.clear', () => {
  test('removes all rows and all keychain entries', async () => {
    indexTable.listAllIds.mockResolvedValue([1, 2, 3]);
    indexTable.clearAll.mockResolvedValue(3);
    keychain.del.mockResolvedValue(true);

    const count = await backend.clear();

    expect(count).toBe(3);
    expect(indexTable.clearAll).toHaveBeenCalled();
    expect(keychain.del).toHaveBeenCalledTimes(3);
    expect(keychain.del).toHaveBeenCalledWith(1);
    expect(keychain.del).toHaveBeenCalledWith(2);
    expect(keychain.del).toHaveBeenCalledWith(3);
  });
});

describe('CLIPBOARD_CAP', () => {
  test('is exported as 30', () => {
    expect(backend.CLIPBOARD_CAP).toBe(30);
  });
});
