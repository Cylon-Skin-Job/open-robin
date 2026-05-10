/**
 * Keychain accessor for clipboard values.
 *
 * One job: read/write/delete keychain entries at
 *   account = "fusion-studio", service = "clipboard:<id>"
 *
 * Distinct from lib/secrets.js (which validates UPPER_SNAKE service names
 * for API keys); the clipboard service-name shape is `clipboard:<n>` where
 * `n` is the clipboard_index row id.
 *
 * No I/O beyond the macOS `security` binary. No event emission. Pure
 * data-access layer.
 */

'use strict';

const { execFile } = require('child_process');

const ACCOUNT = 'fusion-studio';
const SERVICE_PREFIX = 'clipboard:';

class ClipboardKeychainError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ClipboardKeychainError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}
ClipboardKeychainError.NOT_FOUND = 'NOT_FOUND';
ClipboardKeychainError.LOCKED = 'KEYCHAIN_LOCKED';
ClipboardKeychainError.UNKNOWN = 'UNKNOWN';

function service(id) {
  if (!Number.isInteger(id) || id <= 0) {
    throw new ClipboardKeychainError(
      ClipboardKeychainError.UNKNOWN,
      `Invalid clipboard id: ${id}`
    );
  }
  return SERVICE_PREFIX + id;
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/security', args, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').toLowerCase();
        if (msg.includes('could not be found') || msg.includes('secitemnotfound')) {
          return reject(new ClipboardKeychainError(ClipboardKeychainError.NOT_FOUND, 'Entry not found'));
        }
        if (msg.includes('user canceled') || msg.includes('errsecinternalcomponent')) {
          return reject(new ClipboardKeychainError(ClipboardKeychainError.LOCKED, 'Keychain locked'));
        }
        return reject(new ClipboardKeychainError(ClipboardKeychainError.UNKNOWN, stderr || err.message, err));
      }
      resolve(stdout);
    });
  });
}

async function set(id, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ClipboardKeychainError(ClipboardKeychainError.UNKNOWN, 'Value must be a non-empty string');
  }
  await run(['add-generic-password', '-a', ACCOUNT, '-s', service(id), '-w', value, '-U']);
}

async function get(id) {
  try {
    const value = await run(['find-generic-password', '-a', ACCOUNT, '-s', service(id), '-w']);
    return value.replace(/\n$/, '');
  } catch (err) {
    if (err.code === ClipboardKeychainError.NOT_FOUND) return null;
    throw err;
  }
}

async function del(id) {
  try {
    await run(['delete-generic-password', '-a', ACCOUNT, '-s', service(id)]);
    return true;
  } catch (err) {
    if (err.code === ClipboardKeychainError.NOT_FOUND) return false;
    throw err;
  }
}

module.exports = { set, get, del, ACCOUNT, SERVICE_PREFIX, ClipboardKeychainError };
