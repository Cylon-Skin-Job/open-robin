# SPEC-24b — Chat Simplification: ChatFile Immutable Filenames + Frontmatter

**Parent:** SPEC-24 (chat simplification)
**Position:** Phase 2 of 6. Depends on SPEC-24a (timestamp thread IDs) and SPEC-25 (frontmatter parser + `chat` catalog stub) both merged. Unblocks 24c (relocation), 24e (display fallback), and 24f (deep sweep).
**Depends on:**
- SPEC-24a merged — thread IDs are timestamps like `2026-04-09T14-30-22-123`
- SPEC-25 merged — `lib/frontmatter/` exists with the `chat` catalog entry
**Model recommendation:** **Opus 4.6** or equivalent. This is a structural rework of ChatFile.js + ThreadManager.js call sites + a one-line correctness fix to the shared frontmatter parser. Three files changed meaningfully, moderate behavioral surface.
**Estimated blast radius:** **Medium.** File on-disk format changes (H1 title → YAML frontmatter). Filename derivation changes (name-slug → thread ID). The rename flow loses its filesystem move step. These are coupled changes that must land together. Pre-prod wipe before validation, per parent spec.

---

## Your mission

Four coupled changes, single commit.

**Stream 1 — Filename is `${threadId}.md`, immutable for the life of the file.**
Delete `threadNameToFilename()` and every caller. ChatFile constructor takes `{ viewsDir, threadId }` instead of `{ viewsDir, threadName }`. Filenames never change again — rename is a frontmatter-only operation.

**Stream 2 — Display name lives in YAML frontmatter, not an H1 header.**
The on-disk file format changes from:
```
# Some Title

User

Hello

Assistant

Hi
```
to:
```
---
name: Some Title
---

User

Hello

Assistant

Hi
```
Frontmatter block holds the display name. Everything below the second `---` is the conversation body, identical to before (including the existing `<!-- metadata: -->` per-turn HTML comments — those are preserved verbatim, they solve a different problem).

When a thread has `name = null`, the frontmatter block still exists with `name: null` — round-trips through the parser as JS null.

**Stream 3 — Delete legacy `CHAT.md` mode entirely.**
The pre-views-dir fallback in `ChatFile` constructor (where `opts` is a string or has `threadDir`) is dead code. Zero callers use it today after SPEC-24a. Delete the branch, delete the UUID-subdirectory-cleanup code in `ThreadManager.deleteThread`, delete the `else if (this.threadDir)` branch.

**Stream 4 — Teach `parseValue` to recognize the literal `null` token.**
One-line addition to `lib/frontmatter/parser.js`: `if (raw === 'null') return null;`. Needed so `name: null` round-trips through the parser as JS null instead of the string `"null"`. This is a semantic correctness improvement that benefits every catalogued type — any trigger/filter/component/ticket file that currently sets a field to `null` is today silently getting the string `"null"` (which is truthy and causes latent bugs). After this change, it gets JS null.

---

**After this phase:**
- `lib/thread/ChatFile.js` has no `threadNameToFilename`, no `renameFile`, no legacy `CHAT.md` mode.
- ChatFile constructor signature: `new ChatFile({ viewsDir, threadId })` — and that is the only valid invocation.
- `parse()` returns `{ name, messages }` instead of `{ title, messages }`. `name` comes from the frontmatter, not from a `# ...` header.
- `serialize()` signature stays `serialize(name, messages)` — but the output begins with a YAML frontmatter block, not an H1.
- `ThreadManager._createChatFile(threadId)` takes one argument — the name is no longer needed for filename derivation.
- `ThreadManager.renameThread` does NOT call `renameFile()`. It writes the new name into the existing file by rewriting frontmatter + body.
- `lib/frontmatter/parser.js` recognizes `null` as JS null.
- A fresh thread creates a file at `${viewsDir}/${threadId}.md` containing `---\nname: null\n---\n\n` and nothing else.
- Renaming a thread does not move the file. `ls` before and after shows the same filename. `git status` shows a modification, not a rename.
- Pre-prod: existing thread files (if any) are wiped during validation before testing.

**You are not touching:**
- The client (no client-side frontmatter handling; display fallback with ms-stripped ID is Phase 24e)
- `lib/thread/auto-rename.js` (Phase 24d)
- `strategies/daily-rolling.js` or any other strategy files (Phase 24d)
- `lib/runner/index.js` persona-wire notify block (Phase 24f)
- `Sidebar.tsx`'s `thread:create:confirm` dead code (Phase 24f)
- Thread file relocation to `ai/views/chat/threads/` (Phase 24c)
- `lib/harness/kimi/index.js:52` `--session` flag coupling (separate followup)
- `lib/thread/HistoryFile.js` (separate concern — records session metadata, not chat content)
- The per-message `<!-- metadata: {...} -->` HTML comments inside the body (keep exactly as they are — they're per-turn telemetry with a different lifecycle from thread-level frontmatter)

---

## Context before you touch code

Read these in order. Do not skip.

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules. Re-read "delete don't deprecate" and "no backward-compat shims" — both bite hard in this spec.
2. **`ai/views/capture-viewer/content/todo/specs/24-chat-simplification.md`** — parent spec. Understand which phases are deferred.
3. **`ai/views/capture-viewer/content/todo/specs/24a-chat-simplification-id-format.md`** — the precursor that introduced timestamp thread IDs. You build on top of its ID format.
4. **`ai/views/capture-viewer/content/todo/specs/25-frontmatter-separation-of-concerns.md`** — the `lib/frontmatter/` module you'll consume.
5. **`open-robin-server/lib/thread/ChatFile.js`** (all 280 lines) — the file you rework most.
6. **`open-robin-server/lib/thread/ThreadManager.js`** (read L1-310, focus on L31-239) — every caller of `_createChatFile`, `chatFile.renameFile`, `chatFile.write`, `chatFile.appendMessage`, `chatFile.read`.
7. **`open-robin-server/lib/frontmatter/index.js`** — the API you'll import: `parseFrontmatter`, `serializeFrontmatter`.
8. **`open-robin-server/lib/frontmatter/parser.js`** — you'll edit `parseValue` here. One line.
9. **`open-robin-server/lib/frontmatter/catalog.js`** — the `chat` entry exists as a stub. You are its first real caller.
10. **`open-robin-server/lib/thread/ThreadIndex.js`** — no changes, but sanity-check that `rename(threadId, newName)` still does what you expect (updates the SQLite `name` column and `updated_at`).

### Line-number drift verification

```bash
cd open-robin-server

wc -l lib/thread/ChatFile.js lib/thread/ThreadManager.js \
      lib/frontmatter/parser.js lib/frontmatter/catalog.js
```

Expected (±3 lines):
- `ChatFile.js` ≈ 280
- `ThreadManager.js` ≈ 310+ (not shown in full below — check the parts you care about)
- `parser.js` ≈ 90
- `catalog.js` ≈ 50

Then grep:

```bash
# Every caller of _createChatFile (should be 6-7 sites in ThreadManager.js)
grep -n "_createChatFile" lib/thread/ThreadManager.js

# Every caller of renameFile (should be one site: ThreadManager.js:189)
grep -rn "\.renameFile(" lib

# Every caller of threadNameToFilename (should be two sites: ChatFile.js itself)
grep -rn "threadNameToFilename" lib

# Every place the old H1-title shape leaks
grep -n "title" lib/thread/ChatFile.js
# Expected: several hits in parse/serialize. You're replacing all of them with `name`.
```

Reconcile drift before editing. If a caller shows up outside `ThreadManager.js`, flag it and stop — I don't know about it and it may require spec update.

### Pre-flight: are there any chat files on disk right now?

```bash
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' 2>/dev/null
```

If any exist, they were created between SPEC-24a landing and the start of 24b execution. They are in the old format (H1 header, no frontmatter, filename is name-slug, not thread ID). Per parent spec, these are disposable test data. You will wipe them during live validation, not migrate them.

---

## Changes — file by file

### 1. `open-robin-server/lib/frontmatter/parser.js` — one-line addition

**1a. Add null-literal recognition in `parseValue`.**

Current:
```js
function parseValue(raw) {
  if (!raw) return null;

  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}
```

New — add one line after `if (raw === 'false') return false;`:
```js
function parseValue(raw) {
  if (!raw) return null;

  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;   // ← ADDED
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}
```

**1b. Verify round-trip with the existing serializer.**

`serializeValue` in `lib/frontmatter/serializer.js` already handles `null`:
```js
if (v === null || v === undefined) return 'null';
```

So serializing `null` outputs the bare token `null` (not quoted), which now parses back as JS null. Round-trip preserved.

The quoting rule lower in `serializeValue` also catches the STRING `"null"`:
```js
if (... || s === 'null' || ...) { return `"${...}"`; }
```

So if a caller passes the actual string `"null"` (not JS null), it gets emitted as `"null"` (quoted) and parses back as the string `"null"` via the quoted-string branch in `parseValue`. String and null are distinguishable on round-trip. Sanity-check this.

**1c. Behavioral-impact audit (do before moving on).**

This change affects every catalog type, not just `chat`. Grep for fields currently set to the literal `null` in TRIGGERS.md, ticket files, filter definitions, and component configs:

```bash
grep -rn "^\s*\w*:\s*null\s*$" ai/views/**/settings/TRIGGERS.md ai/views/issues-viewer/tickets/ ai/components 2>/dev/null
```

What to flag:
- If ANY hit appears, open the file and check if the corresponding field is read via truthiness (`if (def.field)`). If it is, the behavior changes from "truthy string" (field treated as set) to "falsy null" (field treated as unset). This is a correctness improvement, but flag each case in the report-back.
- If zero hits appear, the change is purely additive and the `chat` type is the first real user.

Do not fix any downstream issues you find. Just report them. Deep sweep (24f) can follow up.

---

### 2. `open-robin-server/lib/thread/ChatFile.js` — major rework

Work top-to-bottom. This file gets substantially smaller.

**2a. Delete the `threadNameToFilename()` function (L40-49).**

The whole function including its JSDoc block:

```js
/**
 * Convert a thread name to a safe filename.
 * @param {string} name
 * @returns {string}
 */
function threadNameToFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) + '.md';
}
```

DELETE all of it. The replacement is a one-liner inlined into the constructor.

**2b. Rework the constructor (L52-79).**

Current:
```js
class ChatFile {
  /**
   * @param {object} opts
   * @param {string} [opts.threadDir] - Legacy: directory containing CHAT.md
   * @param {string} [opts.viewsDir] - New: ai/views/{workspace}/chat/threads/{username}
   * @param {string} [opts.threadName] - Thread name (used for filename in views mode)
   */
  constructor(opts) {
    if (typeof opts === 'string') {
      // Legacy: constructor(threadDir)
      this.threadDir = opts;
      this.filePath = path.join(opts, 'CHAT.md');
      this.viewsDir = null;
      this.threadName = null;
    } else {
      this.viewsDir = opts.viewsDir || null;
      this.threadName = opts.threadName || null;
      this.threadDir = opts.threadDir || null;

      if (this.viewsDir && this.threadName) {
        this.filePath = path.join(this.viewsDir, threadNameToFilename(this.threadName));
      } else if (this.threadDir) {
        this.filePath = path.join(this.threadDir, 'CHAT.md');
      } else {
        this.filePath = null;
      }
    }
  }
```

New:
```js
class ChatFile {
  /**
   * @param {object} opts
   * @param {string} opts.viewsDir - Absolute path to the per-user threads directory
   *   (e.g. ai/views/code-viewer/chat/threads/rccurtrightjr.)
   * @param {string} opts.threadId - Timestamp thread ID (YYYY-MM-DDTHH-MM-SS-mmm)
   *   from SPEC-24a. Becomes the filename: ${threadId}.md — immutable for the
   *   life of the file. Rename is a frontmatter operation, not a filesystem one.
   */
  constructor({ viewsDir, threadId }) {
    if (!viewsDir || !threadId) {
      throw new Error('ChatFile: both viewsDir and threadId are required');
    }
    this.viewsDir = viewsDir;
    this.threadId = threadId;
    this.filePath = path.join(viewsDir, `${threadId}.md`);
  }
```

Notes:
- Delete `this.threadDir`, `this.threadName`, and the legacy string-arg branch entirely.
- The constructor throws on bad input instead of silently producing a ChatFile with `filePath: null`. Every call site in ThreadManager already does `if (chatFile.filePath)` defensively; after this change, those checks become dead code (see 3b-3g below) because the constructor either succeeds with a valid path or throws.
- No more `threadNameToFilename` call. `${threadId}.md` is the whole rule.

**2c. Rework `parse()` (L90-157) — return `{ name, messages }` instead of `{ title, messages }`.**

Delete the H1-title parsing logic. Parse frontmatter first via the shared parser, then process the body exactly as before.

New:
```js
  /**
   * Parse a chat markdown file into frontmatter + messages.
   * @param {string} content - Full file content
   * @returns {{name: string|null, messages: Array}}
   */
  parse(content) {
    const { parseFrontmatter } = require('../frontmatter');
    const { frontmatter, body } = parseFrontmatter(content, 'chat');

    // name may be null (fresh thread before enrichment), undefined (file has
    // no frontmatter — treat as null), or a string.
    const name = frontmatter.name === undefined ? null : frontmatter.name;

    const lines = body.split('\n');
    const messages = [];
    let currentRole = null;
    let currentContent = [];
    let currentHasToolCalls = false;
    let currentMetadata = null;

    const flushMessage = () => {
      if (currentRole && currentContent.length > 0) {
        const msg = {
          role: currentRole,
          content: currentContent.join('\n').trim(),
          hasToolCalls: currentHasToolCalls
        };
        if (currentMetadata) {
          msg.metadata = currentMetadata;
        }
        messages.push(msg);
      }
      currentContent = [];
      currentHasToolCalls = false;
      currentMetadata = null;
    };

    for (const line of lines) {
      if (line === 'User') {
        flushMessage();
        currentRole = 'user';
      } else if (line === 'Assistant') {
        flushMessage();
        currentRole = 'assistant';
      } else if (line === TOOL_CALL_MARKER) {
        currentHasToolCalls = true;
      } else if (line.startsWith('<!-- metadata:') && line.endsWith('-->')) {
        try {
          const jsonStart = line.indexOf('{');
          const jsonEnd = line.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1) {
            currentMetadata = JSON.parse(line.slice(jsonStart, jsonEnd + 1));
          }
        } catch {
          // Ignore parse errors for malformed metadata
        }
      } else if (currentRole) {
        currentContent.push(line);
      }
    }

    flushMessage();
    return { name, messages };
  }
```

Changes from the old `parse`:
- The `require('../frontmatter')` is inside the function to avoid circular imports. Move it to a top-of-file require if you'd rather — verify no circular dependency with `lib/frontmatter/` (shouldn't be any).
- No more `title = 'New Chat'` default. `name` is explicitly null when absent.
- No `startIdx` — the body from `parseFrontmatter` already has the frontmatter stripped, so start from index 0.
- The loop iterates `for (const line of lines)` directly instead of `for (let i = startIdx; ...)`.
- Return shape: `{ name, messages }` — not `{ title, messages }`.

**2d. Rework `serialize()` (L159-187) — emit frontmatter block, not H1.**

New:
```js
  /**
   * Serialize frontmatter + messages to markdown format.
   * @param {string|null} name - Display name. null is emitted as `name: null`
   *   in the frontmatter and round-trips through the parser as JS null.
   * @param {Array} messages
   * @returns {string}
   */
  serialize(name, messages) {
    const { serializeFrontmatter } = require('../frontmatter');
    const fm = serializeFrontmatter({ name });

    const lines = [''];  // blank line after frontmatter block

    for (const msg of messages) {
      lines.push(msg.role === 'user' ? 'User' : 'Assistant');
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      if (msg.hasToolCalls) {
        lines.push(TOOL_CALL_MARKER);
        lines.push('');
      }

      if (msg.role === 'assistant' && msg.metadata && Object.keys(msg.metadata).length > 0) {
        lines.push(`<!-- metadata: ${JSON.stringify(msg.metadata)} -->`);
        lines.push('');
      }
    }

    return fm + lines.join('\n');
  }
```

Changes from the old `serialize`:
- First block is the YAML frontmatter via `serializeFrontmatter({ name })`. Output: `---\nname: Something\n---\n` (with trailing newline).
- A single blank line follows the frontmatter block, then the User/Assistant blocks start.
- The per-message body structure (User/Assistant headers, blank lines, content, TOOL_CALL_MARKER, metadata HTML comments) is **unchanged**.
- No more `# ${title}` header line.

**2e. Delete `renameFile()` (L256-277) entirely.**

Delete the whole method and its JSDoc block. Its caller (`ThreadManager.renameThread`) loses one call in step 3d below.

**2f. Verify `write`, `appendMessage`, `exists`, `countMessages`, `ensureDir` still work unchanged.**

- `write(name, messages)` — the signature is unchanged; it calls the new `serialize(name, messages)`.
- `appendMessage(name, message)` — unchanged externally; internally it reads via `parse()` which now returns `{ name, messages }`. The local variable `existing.messages` still exists. But verify: the current code does `if (existing) { messages = existing.messages; }` — that still works because `existing` is `{ name, messages }`, truthy, and `.messages` is still there.
- `exists`, `countMessages`, `ensureDir` — no changes needed.

**2g. Update the module exports (L280).**

Current:
```js
module.exports = { ChatFile, TOOL_CALL_MARKER, getUsername, threadNameToFilename };
```

New:
```js
module.exports = { ChatFile, TOOL_CALL_MARKER, getUsername };
```

`threadNameToFilename` is gone.

**2h. Verify no stale references remain in the file.**

```bash
grep -n "title\|threadName\|threadDir\|CHAT\.md\|renameFile\|threadNameToFilename" lib/thread/ChatFile.js
```

Expected: zero hits. If any remain, they're residues to delete.

---

### 3. `open-robin-server/lib/thread/ThreadManager.js` — update all call sites

This file has six `_createChatFile` calls. Each one drops its second argument.

**3a. Rework `_createChatFile()` (L90-106).**

Current:
```js
  /**
   * Create a ChatFile for the given thread.
   * Uses per-user views path if projectRoot is set, otherwise legacy UUID dir.
   * @param {string} threadId
   * @param {string} threadName
   * @returns {ChatFile}
   */
  _createChatFile(threadId, threadName) {
    const viewsDir = this._getViewsDir();
    if (viewsDir) {
      return new ChatFile({ viewsDir, threadName });
    }
    if (this.threadsDir) {
      return new ChatFile(path.join(this.threadsDir, threadId));
    }
    return new ChatFile({ threadDir: null });
  }
```

New:
```js
  /**
   * Create a ChatFile for the given thread. Requires a views directory —
   * if _getViewsDir() returns null (no projectRoot), throws instead of
   * silently producing a broken ChatFile. Legacy CHAT.md mode was removed
   * in SPEC-24b.
   * @param {string} threadId
   * @returns {ChatFile}
   */
  _createChatFile(threadId) {
    const viewsDir = this._getViewsDir();
    if (!viewsDir) {
      throw new Error(
        `ThreadManager._createChatFile: no viewsDir available for panel ${this.panelId}. ` +
        `projectRoot must be set. Legacy CHAT.md mode was removed in SPEC-24b.`
      );
    }
    return new ChatFile({ viewsDir, threadId });
  }
```

Key changes:
- Signature drops `threadName`.
- Legacy `this.threadsDir`-based `CHAT.md` branch is gone.
- Empty-fallback `new ChatFile({ threadDir: null })` is gone.
- Throws loudly if `viewsDir` is unavailable instead of returning a `ChatFile` with `filePath: null`.

**3b. Update `createThread()` (L133-148).**

Current:
```js
  async createThread(threadId, name = 'New Chat', options = {}) {
    await this._enforceSessionLimit();
    const entry = await this.index.create(threadId, name, options);
    await this._ensureThreadsIndex();
    const chatFile = this._createChatFile(threadId, name);
    if (chatFile.filePath) {
      await chatFile.write(name, []);
    }
    return { threadId, entry };
  }
```

New:
```js
  async createThread(threadId, name = null, options = {}) {
    await this._enforceSessionLimit();
    const entry = await this.index.create(threadId, name, options);
    await this._ensureThreadsIndex();
    const chatFile = this._createChatFile(threadId);
    await chatFile.write(name, []);
    return { threadId, entry };
  }
```

Changes:
- Default for `name` is now `null` (matching SPEC-24a's SQLite default).
- `_createChatFile` takes one argument.
- Drop the `if (chatFile.filePath)` guard — the constructor throws on bad input now, so if you got a ChatFile, `filePath` is valid.

**3c. Update `getThread()` (L154-162).**

Current:
```js
  async getThread(threadId) {
    const entry = await this.index.get(threadId);
    if (!entry) return null;
    const chatFile = this._createChatFile(threadId, entry.name);
    return { threadId, entry, filePath: chatFile.filePath };
  }
```

New:
```js
  async getThread(threadId) {
    const entry = await this.index.get(threadId);
    if (!entry) return null;
    const chatFile = this._createChatFile(threadId);
    return { threadId, entry, filePath: chatFile.filePath };
  }
```

Just drops the `entry.name` argument. The ChatFile path is now derived from `threadId` alone.

**3d. Update `renameThread()` (L177-198).**

This is the most important change — the rename flow no longer touches the filesystem.

Current:
```js
  async renameThread(threadId, newName) {
    const oldEntry = await this.index.get(threadId);
    if (!oldEntry) return null;

    const entry = await this.index.rename(threadId, newName);
    if (!entry) return null;

    // Update chat markdown: rename file + rewrite title
    const chatFile = this._createChatFile(threadId, oldEntry.name);
    if (chatFile.filePath) {
      if (chatFile.viewsDir) {
        // Views mode: rename the file, then rewrite with new title
        await chatFile.renameFile(newName);
      }
      const parsed = await chatFile.read();
      if (parsed) {
        await chatFile.write(newName, parsed.messages);
      }
    }

    return { threadId, entry };
  }
```

New:
```js
  async renameThread(threadId, newName) {
    const oldEntry = await this.index.get(threadId);
    if (!oldEntry) return null;

    const entry = await this.index.rename(threadId, newName);
    if (!entry) return null;

    // Rewrite the frontmatter name in place — filename is immutable in SPEC-24b.
    const chatFile = this._createChatFile(threadId);
    const parsed = await chatFile.read();
    if (parsed) {
      await chatFile.write(newName, parsed.messages);
    }
    // If parsed is null (file doesn't exist yet), there's nothing to rewrite.
    // SQLite has the name either way — the file will pick it up on first write.

    return { threadId, entry };
  }
```

Changes:
- `oldEntry` is still needed to verify the thread exists before renaming SQLite, but it's no longer used for `_createChatFile` (filename only depends on `threadId`).
- `chatFile.renameFile(newName)` call is **gone**. File stays at `${threadId}.md`.
- The `if (chatFile.viewsDir)` branch is gone — there's only one mode now.
- The `if (chatFile.filePath)` guard is gone.
- The read/write pattern stays: read existing messages, write back with new name in frontmatter.

**3e. Update `deleteThread()` (L204-239).**

Current:
```js
  async deleteThread(threadId) {
    await this.closeSession(threadId);
    const entry = await this.index.get(threadId);

    const deleted = await this.index.delete(threadId);
    if (!deleted) return false;

    const fsPromises = require('fs').promises;
    if (entry) {
      const chatFile = this._createChatFile(threadId, entry.name);
      if (chatFile.filePath) {
        try {
          await fsPromises.rm(chatFile.filePath, { force: true });
        } catch (err) {
          console.error(`Failed to delete chat file for ${threadId}:`, err);
        }
      }
    }

    // Clean up legacy UUID directory if it exists
    if (this.threadsDir) {
      const threadPath = path.join(this.threadsDir, threadId);
      try {
        await fsPromises.rm(threadPath, { recursive: true, force: true });
      } catch {
        // Ignore — may not exist
      }
    }

    return true;
  }
```

New:
```js
  async deleteThread(threadId) {
    await this.closeSession(threadId);

    const deleted = await this.index.delete(threadId);
    if (!deleted) return false;

    // Remove the markdown file. Filename is ${threadId}.md — no need to fetch
    // the entry or look up the name.
    const fsPromises = require('fs').promises;
    try {
      const chatFile = this._createChatFile(threadId);
      await fsPromises.rm(chatFile.filePath, { force: true });
    } catch (err) {
      // ENOENT is fine — file may not exist yet for zero-message threads
      if (err.code !== 'ENOENT') {
        console.error(`Failed to delete chat file for ${threadId}:`, err);
      }
    }

    return true;
  }
```

Changes:
- No need to `this.index.get(threadId)` before delete — we don't need the entry's name to derive the filename.
- The legacy UUID-directory cleanup block is **gone**. That was the legacy mode we're killing.
- Simplified error handling: swallow ENOENT silently (the file legitimately may not exist), log everything else.

**3f. Update `addMessage()` (L246-263).**

Current:
```js
  async addMessage(threadId, message) {
    const entry = await this.index.get(threadId);
    if (!entry) throw new Error(`Thread not found: ${threadId}`);

    const chatFile = this._createChatFile(threadId, entry.name);
    if (chatFile.filePath) {
      await chatFile.appendMessage(entry.name, message);
    }

    await this.index.incrementMessageCount(threadId);
    await this.index.touch(threadId);

    return { threadId, messageCount: entry.messageCount + 1 };
  }
```

New:
```js
  async addMessage(threadId, message) {
    const entry = await this.index.get(threadId);
    if (!entry) throw new Error(`Thread not found: ${threadId}`);

    const chatFile = this._createChatFile(threadId);
    await chatFile.appendMessage(entry.name, message);

    await this.index.incrementMessageCount(threadId);
    await this.index.touch(threadId);

    return { threadId, messageCount: entry.messageCount + 1 };
  }
```

`entry.name` is still passed to `appendMessage` — it's used by the write step to rewrite the frontmatter block with the current name (SQLite-authoritative). Drop `entry.name` from `_createChatFile` only.

**3g. Update `addMessageWithMetadata()` (L271-289).**

Same pattern as 3f:

New:
```js
  async addMessageWithMetadata(threadId, message, metadata = null) {
    const entry = await this.index.get(threadId);
    if (!entry) throw new Error(`Thread not found: ${threadId}`);

    const chatFile = this._createChatFile(threadId);
    const messageWithMetadata = metadata ? { ...message, metadata } : message;
    await chatFile.appendMessage(entry.name, messageWithMetadata);

    await this.index.incrementMessageCount(threadId);
    await this.index.touch(threadId);

    return { threadId, messageCount: entry.messageCount + 1 };
  }
```

**3h. Update `getHistory()` (L296-300+).**

Current:
```js
  async getHistory(threadId) {
    const entry = await this.index.get(threadId);
    if (!entry) return null;
    const chatFile = this._createChatFile(threadId, entry.name);
    return chatFile.read();
  }
```

New:
```js
  async getHistory(threadId) {
    const entry = await this.index.get(threadId);
    if (!entry) return null;
    const chatFile = this._createChatFile(threadId);
    return chatFile.read();
  }
```

Drop `entry.name`. Also note: `chatFile.read()` now returns `{ name, messages }` instead of `{ title, messages }`. If any caller of `getHistory` was destructuring `title`, it needs updating. **Do a grep to verify** (see step 4).

**3i. Remove the unused import comment, if any.**

The top of ThreadManager.js requires ChatFile and getUsername — both still used. Leave them alone.

---

### 4. Downstream consumers of `parse()`'s return shape — grep and verify

The old `parse()` returned `{ title, messages }`. The new one returns `{ name, messages }`. Any caller destructuring `title` from the result breaks.

```bash
grep -rn "\.title\|{ title," lib/thread server.js lib/ws
```

What to look for: anything like `const { title, messages } = chatFile.read()` or `history.title` or `parsed.title`. These all need to become `name`.

**Expected hit sites:** possibly `lib/thread/ChatFile.js` itself (internal), possibly `lib/thread/HistoryFile.js` (sanity check — may or may not relate), possibly `lib/thread/thread-messages.js` or similar if it reads parsed chat data.

**If you find a hit:** update the field reference (`title` → `name`) and report it in the report-back. If you find more than a few, pause and flag — the rename is bigger than anticipated.

**Known safe callers:**
- `thread-crud.js:handleThreadOpen` uses `threadManager.getHistory(threadId)` and destructures `messages` — not `title`. Check to confirm.
- `client/src/**/*` — only reads from the SQLite `name` field via the wire protocol, not from parsed markdown. No client change.

---

### 5. Delete any tests or doc strings that reference the old shape

Grep for `threadNameToFilename` and the legacy CHAT.md mentions in comments and tests:

```bash
grep -rn "threadNameToFilename\|CHAT\.md" lib test
```

**Expected after this spec lands:**
- Zero code references to `threadNameToFilename`.
- Comments mentioning "CHAT.md" may persist in unrelated files (wire-debug logs, historical notes) — leave those alone. Only delete references in code or in JSDoc that implies `CHAT.md` is a current mode.

---

## Test plan

### Unit / static checks

```bash
cd open-robin-server

# No stale references in the changed files
grep -n "threadNameToFilename\|renameFile\|threadName\|threadDir\|'# '" lib/thread/ChatFile.js
# Expected: zero hits

grep -n "threadNameToFilename" lib
# Expected: zero hits

grep -n "renameFile" lib/thread
# Expected: zero hits (the method is deleted, so no callers and no definition)

# Constructor now requires both args
node -e "
const { ChatFile } = require('./lib/thread/ChatFile');
try { new ChatFile({ viewsDir: '/tmp', threadId: 'test' }); console.log('PASS: valid construction'); } catch (e) { console.log('FAIL:', e.message); }
try { new ChatFile({}); console.log('FAIL: should have thrown'); } catch (e) { console.log('PASS: missing args rejected —', e.message); }
try { new ChatFile({ viewsDir: '/tmp' }); console.log('FAIL: should have thrown'); } catch (e) { console.log('PASS: missing threadId rejected'); }
"
# Expected: all three PASS

# Null round-trip through the parser
node -e "
const { parseFrontmatter, serializeFrontmatter } = require('./lib/frontmatter');
const original = { name: null };
const written = serializeFrontmatter(original);
console.log('Serialized:');
console.log(written);
const { frontmatter: parsed } = parseFrontmatter(written, 'chat');
console.log('Parsed:', parsed);
console.log('name === null:', parsed.name === null ? 'PASS' : 'FAIL (got ' + typeof parsed.name + ': ' + JSON.stringify(parsed.name) + ')');
"
# Expected: name === null: PASS

# Non-null round-trip
node -e "
const { parseFrontmatter, serializeFrontmatter } = require('./lib/frontmatter');
const original = { name: 'My thread' };
const written = serializeFrontmatter(original);
const { frontmatter: parsed } = parseFrontmatter(written, 'chat');
console.log('Round-trip:', parsed.name === 'My thread' ? 'PASS' : 'FAIL');
"
# Expected: Round-trip: PASS

# String 'null' vs JS null distinction
node -e "
const { parseFrontmatter, serializeFrontmatter } = require('./lib/frontmatter');
const a = serializeFrontmatter({ x: null });
const b = serializeFrontmatter({ x: 'null' });
console.log('null →', a.trim());
console.log('\"null\" →', b.trim());
const pa = parseFrontmatter(a, 'chat').frontmatter;
const pb = parseFrontmatter(b, 'chat').frontmatter;
console.log('null parses as:', pa.x, '(', pa.x === null ? 'JS null' : 'string', ')');
console.log('\"null\" parses as:', pb.x, '(', pb.x === null ? 'JS null' : 'string', ')');
console.log('Distinguishable:', (pa.x === null && pb.x === 'null') ? 'PASS' : 'FAIL');
"
# Expected: Distinguishable: PASS

# Module loads
node -e "require('./lib/thread/ChatFile')"
node -e "require('./lib/thread/ThreadManager')"
node -e "require('./lib/thread')"
# Expected: no errors

# Smoke test
node test/smoke-spec03-spec15.js
# Expected: 49 passed, 0 failed (unchanged from SPEC-25)
```

### Full-file round-trip test

```bash
node -e "
const { ChatFile } = require('./lib/thread/ChatFile');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfile-test-'));
const cf = new ChatFile({ viewsDir: tmp, threadId: '2026-04-09T14-30-22-123' });

(async () => {
  // Create a thread with null name
  await cf.write(null, []);
  let raw = fs.readFileSync(cf.filePath, 'utf8');
  console.log('=== Fresh thread (null name) ===');
  console.log(raw);

  // Add a message
  await cf.appendMessage(null, { role: 'user', content: 'Hello', hasToolCalls: false });
  await cf.appendMessage(null, { role: 'assistant', content: 'Hi', hasToolCalls: false, metadata: { contextUsage: 0.1 } });
  raw = fs.readFileSync(cf.filePath, 'utf8');
  console.log('=== After two messages (null name) ===');
  console.log(raw);

  // Rename via write
  const { messages } = await cf.read();
  await cf.write('My conversation', messages);
  raw = fs.readFileSync(cf.filePath, 'utf8');
  console.log('=== After rename ===');
  console.log(raw);

  // Read back
  const parsed = await cf.read();
  console.log('=== Parsed ===');
  console.log('name:', parsed.name);
  console.log('messages:', parsed.messages.length);
  console.log('first msg:', parsed.messages[0]);

  // Verify file was NOT moved during rename
  console.log('=== Filename immutable ===');
  console.log('Path:', cf.filePath);
  console.log('Exists:', fs.existsSync(cf.filePath));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PASS');
})();
"
# Expected output: the file shows null frontmatter first, then messages,
# then rewritten frontmatter with 'My conversation', then parsed correctly,
# and the path stays identical through the rename.
```

### Live validation

1. **Kill stale processes.**
   ```bash
   pkill -9 -f "node.*server.js" || true
   pkill -9 -f "kimi" || true
   ```

2. **Wipe pre-prod thread data** (per parent spec — existing threads are disposable).
   ```bash
   sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "DELETE FROM threads;"
   find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' -delete 2>/dev/null
   # Also remove any stray user folders if they're empty after file deletion
   find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type d -empty -delete 2>/dev/null
   ```

3. **Start the server.**
   ```bash
   cd open-robin-server && node server.js &
   sleep 4
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
   ```
   Expected: `200`, no module-load errors, no ChatFile construction errors.

4. **Create a new thread via the UI.** Pick any panel with chat + Kimi harness.

5. **Verify the file was created correctly.**
   ```bash
   # Find the file
   find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -name '*.md' -type f

   # Expected: one file with name matching /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.md$/
   # e.g. 2026-04-09T15-42-08-331.md

   # Show contents
   cat /path/to/that/file

   # Expected:
   # ---
   # name: null
   # ---
   #
   # (empty body for a fresh thread)
   ```

6. **Send a user message.** Verify the turn completes and the response streams.

7. **Verify the file updated.**
   ```bash
   cat /path/to/that/file
   # Expected: frontmatter block (name still null), then User/Assistant blocks with content
   ```

8. **Rename the thread via the sidebar UI.** Use any string, e.g. "My first real thread".

9. **Verify the filename did NOT change.**
   ```bash
   ls -la /path/to/*/threads/*/
   # Expected: same filename (the timestamp-ID .md) still exists. No second file.

   cat /path/to/that/file | head -5
   # Expected:
   # ---
   # name: My first real thread
   # ---
   ```

10. **Verify SQLite agrees.**
    ```bash
    sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT thread_id, name FROM threads;"
    # Expected: thread_id matches the filename, name = 'My first real thread'
    ```

11. **Click the thread in the sidebar to resume it.** The UI should show the existing history correctly. Verify no parse errors in the console.

12. **Delete the thread via the sidebar.** Verify:
    - File is removed from disk
    - SQLite row is gone
    - No errors in the server log

13. **Create a second thread, rename via auto-rename (if configured), delete.** Smoke test the full lifecycle once more with a non-null initial name path.

14. **Check for any parse errors across the session.**
    ```bash
    grep -i "frontmatter\|parse.*error\|unknown type" server-live.log | head -20
    # Expected: zero frontmatter-related errors
    ```

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| Server startup crash: `ThreadManager._createChatFile: no viewsDir available` | ThreadManager constructed without `projectRoot` somewhere | Check `lib/ws/client-message-router.js` and `server.js` for ThreadManager construction — projectRoot must be passed |
| Fresh thread's file doesn't have frontmatter | serializer got `undefined` instead of `null` | Check `createThread(threadId, name = null)` default |
| Rename appears to work but second rename fails with "no messages" | Second rename reads the file, but parse returns old `title` instead of `name` | Step 2c — `parse()` must return `{ name, messages }` |
| `parsed.title is undefined` at some call site | Missed a downstream consumer | Run step 4's grep and fix hits |
| File gets MOVED on rename (shouldn't happen) | Didn't delete `renameFile()` method OR still calling it | Step 2e and step 3d |
| `name: null` shows up as the string "null" in the UI | One-line parser fix not applied | Step 1a |
| TRIGGERS.md trigger that used `condition: null` stopped firing in an unexpected way | Semantic-correctness change — field went from truthy string to falsy JS null | Flag in report-back; this is a correctness improvement, not a regression |
| `new ChatFile('/some/path')` still works somewhere | Legacy string-arg branch not fully deleted | Step 2b — constructor should throw on non-object arg |
| Legacy UUID directories still get created/cleaned | Deleted code didn't fully go | Step 3e |

---

## Do not do

- **Do not** touch `lib/thread/auto-rename.js` or `strategies/daily-rolling.js`. Phase 24d.
- **Do not** relocate thread files to `ai/views/chat/threads/...`. Phase 24c. Keep per-panel layout for this spec.
- **Do not** strip milliseconds from display names in the client. Phase 24e.
- **Do not** add a migration for old-format files. Pre-prod wipe, per parent spec.
- **Do not** delete `HistoryFile.js` or modify it — it's a different concern (session metadata history, not chat content).
- **Do not** keep a backward-compat shim that writes BOTH an H1 and frontmatter "during transition". Clean cut. Standards doc: "delete, don't deprecate".
- **Do not** try to preserve the old string-arg constructor (`new ChatFile('/path/to/dir')`). Force all callers to use `{ viewsDir, threadId }`.
- **Do not** add a `previous_names: []` history array to the frontmatter. Rename is a clean overwrite, per user directive.
- **Do not** add `created`, `harness`, `id`, or any other field to the frontmatter. Only `name`. Everything else is SQLite-authoritative.
- **Do not** touch the per-message `<!-- metadata: {...} -->` HTML comments. They're per-turn telemetry, different lifecycle from thread-level frontmatter.
- **Do not** add validation of the `chat` catalog's `fields` array at runtime. That's documentation-only per SPEC-25.
- **Do not** silently handle the "no viewsDir" case in `_createChatFile`. Throw loudly so the configuration error surfaces early.
- **Do not** add any `console.log` or `console.warn` statements to hot paths (parse/serialize/write). These run on every message.

---

## Commit message template

```
SPEC-24b: ChatFile immutable filenames + YAML frontmatter for name

Four coupled changes:

1. Thread files are now named ${threadId}.md (e.g.
   2026-04-09T14-30-22-123.md) and the filename is IMMUTABLE for the
   life of the file. Rename is a frontmatter-only operation; the file
   never moves on disk. ChatFile constructor takes { viewsDir, threadId }
   and throws if either is missing. Legacy string-arg constructor
   (new ChatFile('/path')) is deleted along with the threadDir +
   CHAT.md fallback mode.

2. Display name lives in YAML frontmatter at the top of the chat file:
     ---
     name: My thread
     ---
     (body with User/Assistant blocks follows)
   The old H1 `# Title` header is gone. ChatFile.parse() returns
   { name, messages }. ChatFile.serialize(name, messages) emits the
   frontmatter via lib/frontmatter/serializeFrontmatter().

3. Legacy CHAT.md mode fully deleted. ChatFile no longer has a threadDir
   property or a path.join(opts, 'CHAT.md') code path.
   ThreadManager._createChatFile signature drops threadName (filename is
   derived from threadId alone). deleteThread drops the legacy UUID
   directory cleanup block. renameThread drops the chatFile.renameFile
   call (and ChatFile.renameFile itself is deleted).

4. lib/frontmatter/parser.js parseValue now recognizes the literal
   `null` token as JS null. One-line addition. Needed so `name: null`
   round-trips through the parser as JS null instead of the string
   "null". Correctness improvement for every catalogued type — any
   trigger/filter/component/ticket file that set a field to `null` was
   previously getting the string "null" (which is truthy) and causing
   latent bugs. Now those fields are correctly JS null.

Pre-prod wipe: existing thread files and SQLite rows deleted during
validation per parent SPEC-24.

Live-validated: create, send message, rename (filename does NOT change),
delete, resume — all working end-to-end.

Part of SPEC-24 (chat simplification). Unblocks 24c (relocation), 24e
(ms-stripped display fallback), 24f (deep sweep).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main` — files changed and lines added/removed. Expected: `ChatFile.js` shrinks significantly (~50-70 lines removed), `ThreadManager.js` gets slightly smaller, `parser.js` gains one line, no other source files touched.

2. **Static check output.** Paste every grep and node-e check result from the "Unit / static checks" section. Every assertion must PASS.

3. **Full-file round-trip output.** Paste the stdout of the round-trip test showing the fresh-thread file, the file after messages, the file after rename, the parsed output, and the PASS confirmation.

4. **Live validation evidence.**
   - The actual filename generated (paste from `find` output).
   - `cat` of the file at each stage (fresh, after message, after rename).
   - The `sqlite3 SELECT thread_id, name` output before and after rename.
   - Confirmation that the filename is identical before and after rename.

5. **Downstream `title` grep findings.** Did step 4's grep find any callers destructuring `title` from chat parse results? If yes, list the files and what you changed.

6. **Null-literal audit.** Did the pre-edit grep for `: null` in trigger/ticket/filter/component files find anything? If yes, list them and flag whether any appear to be relying on the old "truthy string" behavior. Do not fix them — note for 24f deep sweep.

7. **Any surprises.** Unexpected callers, behavior changes beyond what was listed, test failures you had to work around, etc.

8. **Files touched outside the change list.** Should be zero. If any, explain why.

9. **Phase 24f candidates noticed.** Anything suspicious-looking you saw while working through ChatFile.js or ThreadManager.js that's out of 24b scope but worth flagging for the deep sweep. Examples from my mental model: anything in HistoryFile that references `title` from parsed chat data, dead `this.threadsDir` references after the legacy mode deletion, unused imports.

Hand the report back to the orchestrator before moving to any other 24x phase.
