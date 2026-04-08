# Secrets Manager

kimi-claude stores API keys and tokens in **macOS Keychain** — no `.env` files, no config objects, no plain text anywhere.

## Convention

All secrets use a single Keychain account:

| Field | Value |
|-------|-------|
| **Account** | `kimi-ide` |
| **Service** | Key name in `UPPER_SNAKE_CASE` |

Example: the GitLab token is stored with account `kimi-ide`, service `GITLAB_TOKEN`.

## Current Secrets

| Key | Description | Used By |
|-----|-------------|---------|
| `GITLAB_TOKEN` | GitLab Personal Access Token | Git credential helper, wiki sync, API calls |

Add new keys to the `KNOWN_SECRETS` array in `scripts/setup-secrets.js`.

## Reading a Secret

### From Node.js

```js
const secrets = require('./kimi-ide-server/lib/secrets');

const token = await secrets.get('GITLAB_TOKEN');   // string or null
const exists = await secrets.has('GITLAB_TOKEN');   // boolean
const many = await secrets.getMany(['GITLAB_TOKEN', 'OTHER_KEY']); // {key: value}
```

### From Shell / Claude Skills

```bash
TOKEN=$(security find-generic-password -a "kimi-ide" -s "GITLAB_TOKEN" -w 2>/dev/null)
```

### From Git (automatic)

The credential helper (`scripts/git-credential-kimi.sh`) reads `GITLAB_TOKEN` from Keychain automatically when git needs gitlab.com credentials.

## Writing a Secret

### Interactive setup

```bash
node scripts/setup-secrets.js
```

Shows status of all known secrets, prompts for missing values.

### Direct CLI

```bash
security add-generic-password -a "kimi-ide" -s "KEY_NAME" -w "value" -U
```

The `-U` flag updates if the key exists, creates if it doesn't.

### From Node.js

```js
await secrets.set('KEY_NAME', 'value');
```

## Deleting a Secret

```bash
security delete-generic-password -a "kimi-ide" -s "KEY_NAME"
```

Or from Node.js:
```js
await secrets.del('KEY_NAME');  // returns true/false
```

## API Reference — `lib/secrets.js`

| Method | Signature | Returns |
|--------|-----------|---------|
| `get` | `get(key)` | `Promise<string\|null>` — value or null if not found |
| `set` | `set(key, value)` | `Promise<void>` — throws on failure |
| `del` | `del(key)` | `Promise<boolean>` — true if deleted, false if not found |
| `has` | `has(key)` | `Promise<boolean>` — existence check |
| `getMany` | `getMany(keys[])` | `Promise<Object>` — parallel batch get |

### Error Codes

`SecretsError` is thrown with one of:

| Code | Meaning |
|------|---------|
| `NOT_FOUND` | Key doesn't exist (only thrown by `set`/`del` internals — `get` returns null) |
| `KEYCHAIN_LOCKED` | Keychain is locked, user cancelled the prompt |
| `ACCESS_DENIED` | App not authorized to access this Keychain item |
| `INVALID_KEY` | Key doesn't match `UPPER_SNAKE_CASE` pattern |
| `UNKNOWN` | Unexpected `security` CLI error |

### Key Validation

Keys must match `/^[A-Z][A-Z0-9_]*$/`. This enforces a consistent naming convention across Node.js code, shell scripts, and Claude skills.

## Design Decisions

- **Keychain is the single source of truth.** No caching, no `.env` files, no duplication.
- **`execFile` not `exec`.** Arguments passed as an array, never through a shell — prevents injection.
- **Separate from config.** Config (`config.js`) holds preferences and state. Secrets hold credentials. Different domains, different storage.
- **macOS only.** This is a personal dev tool. No cross-platform abstraction needed.
- **Token rotation.** Tokens were last rotated 2026-03-18. Next rotation due by 2026-06-18.

## Adding a New Secret to the System

1. Pick an `UPPER_SNAKE_CASE` name
2. Add it to `KNOWN_SECRETS` in `scripts/setup-secrets.js`:
   ```js
   { key: 'NEW_SERVICE_TOKEN', description: 'Description for setup prompt' }
   ```
3. Run `node scripts/setup-secrets.js` to store the value
4. Access it via `secrets.get('NEW_SERVICE_TOKEN')` or `security find-generic-password -a "kimi-ide" -s "NEW_SERVICE_TOKEN" -w`
