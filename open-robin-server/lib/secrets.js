/**
 * Local Secrets Manager — macOS Keychain accessor
 *
 * Pure data-access module (Layer 4). Returns data only.
 * No events, no DOM, no business logic, no caching.
 *
 * Convention:
 *   Account:  "open-robin"
 *   Service:  Key name in UPPER_SNAKE_CASE (e.g. GITLAB_TOKEN)
 */

const { execFile } = require('child_process');

const ACCOUNT = 'open-robin';
const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// ── Error class ──────────────────────────────────────────────

class SecretsError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'SecretsError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

SecretsError.NOT_FOUND = 'NOT_FOUND';
SecretsError.KEYCHAIN_LOCKED = 'KEYCHAIN_LOCKED';
SecretsError.ACCESS_DENIED = 'ACCESS_DENIED';
SecretsError.INVALID_KEY = 'INVALID_KEY';
SecretsError.UNKNOWN = 'UNKNOWN';

// ── Helpers ──────────────────────────────────────────────────

function validateKey(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new SecretsError(
      `Invalid key "${key}" — must match ${KEY_PATTERN}`,
      SecretsError.INVALID_KEY
    );
  }
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/security', args, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').toLowerCase();
        if (msg.includes('could not be found') || msg.includes('secitemnotfound')) {
          return reject(new SecretsError(`Key not found`, SecretsError.NOT_FOUND));
        }
        if (msg.includes('user canceled') || msg.includes('errsecinternalcomponent')) {
          return reject(new SecretsError(`Keychain locked`, SecretsError.KEYCHAIN_LOCKED));
        }
        if (msg.includes('not allowed') || msg.includes('authorization')) {
          return reject(new SecretsError(`Access denied`, SecretsError.ACCESS_DENIED));
        }
        return reject(new SecretsError(stderr || err.message, SecretsError.UNKNOWN, err));
      }
      resolve(stdout);
    });
  });
}

// ── Public API ───────────────────────────────────────────────

async function get(key) {
  validateKey(key);
  try {
    const value = await run([
      'find-generic-password',
      '-a', ACCOUNT,
      '-s', key,
      '-w'
    ]);
    return value.replace(/\n$/, '');
  } catch (err) {
    if (err.code === SecretsError.NOT_FOUND) return null;
    throw err;
  }
}

async function set(key, value) {
  validateKey(key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretsError('Value must be a non-empty string', SecretsError.INVALID_KEY);
  }
  // -U = update if exists, create if not
  await run([
    'add-generic-password',
    '-a', ACCOUNT,
    '-s', key,
    '-w', value,
    '-U'
  ]);
}

async function del(key) {
  validateKey(key);
  try {
    await run([
      'delete-generic-password',
      '-a', ACCOUNT,
      '-s', key
    ]);
    return true;
  } catch (err) {
    if (err.code === SecretsError.NOT_FOUND) return false;
    throw err;
  }
}

async function has(key) {
  validateKey(key);
  try {
    await run([
      'find-generic-password',
      '-a', ACCOUNT,
      '-s', key
    ]);
    return true;
  } catch (err) {
    if (err.code === SecretsError.NOT_FOUND) return false;
    throw err;
  }
}

async function getMany(keys) {
  const results = await Promise.all(
    keys.map(async (key) => [key, await get(key)])
  );
  return Object.fromEntries(results);
}

module.exports = { get, set, del, has, getMany, SecretsError, ACCOUNT };
