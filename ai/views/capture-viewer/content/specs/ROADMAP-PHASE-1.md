---
title: Phase 1 — SQLite Foundation
created: 2026-03-28
updated: 2026-03-28
status: active
parent: ROADMAP.md
---

# Phase 1: SQLite Foundation

Redirect wire protocol storage from JSON files to SQLite. Keep thread markdown in the repo. No migration of old files needed — this is pre-production.

**Prerequisites:** None. Can start immediately.
**Parallel with:** Phase 0 and Phase 2 (no dependencies between them).

---

## Context for This Session

### Project Location
`/Users/rccurtrightjr./projects/kimi-claude`

### What This Phase Does
1. Add Knex.js + better-sqlite3 as dependencies
2. Create two databases: `ai/system/robin.db` (system) and `ai/system/project.db` (project data)
3. Redirect HistoryFile.js from writing history.json files to writing SQLite exchanges table
4. Redirect ThreadIndex.js from writing threads.json to writing SQLite threads table
5. Modify ChatFile.js to write to per-user folders: `threads/{username}/thread-name.md`

### Key Architecture Decisions (already made)
- **Knex.js** for query building — same queries work against SQLite (local) and Postgres (Supabase future). Chosen over Drizzle (wants TypeScript, static schemas) and raw SQL (two dialects to maintain).
- **Three database model:** robin.db (system, invisible to agents), project.db (project data, invisible to agents), apps/*.db (user-created, accessible via scripts with develop/production mode)
- **DB location:** `ai/system/` — visible to user (Option B), managed by Robin, in .gitignore
- **No migration needed** — pre-production. Old JSON files (history.json, threads.json) can be ignored. Stop writing them, start writing to SQLite.
- **No virtual-markdown-over-DB** — Robin's panel renders system config inline. No phantom files on disk.
- **The assistant parts JSON shape is sacred** — `{ parts: [...] }` with text/think/tool_call types must survive the SQLite JSON round-trip exactly. The client's `convertPartToSegment()` depends on this shape.

### Key Files
- `kimi-ide-server/lib/thread/HistoryFile.js` — exchange storage (redirect to SQLite)
- `kimi-ide-server/lib/thread/ThreadIndex.js` — thread metadata (redirect to SQLite)
- `kimi-ide-server/lib/thread/ThreadManager.js` — orchestrator (calls both, interface stays same)
- `kimi-ide-server/lib/thread/ChatFile.js` — markdown writer (change output path to per-user)
- `kimi-ide-server/lib/thread/ThreadWebSocketHandler.js` — sends exchanges on thread:open
- `kimi-ide-server/server.js` — wire handler writes exchanges on TurnEnd (line ~749)
- `kimi-ide-client/src/lib/ws-client.ts` — receives exchanges, calls convertExchangesToMessages()
- `kimi-ide-server/package.json` — add knex + better-sqlite3

---

## Critical Data Flow (must preserve exactly)

```
Wire event (ContentPart, ToolCall, ToolResult, TurnEnd)
    ↓
server.js accumulates session.assistantParts[] during turn
    ↓  (text/think parts combined when consecutive)
    ↓  (tool_call parts mutated in-place with arguments + result on ToolResult)
    ↓
TurnEnd fires → HistoryFile.addExchange(threadId, userInput, assistantParts)
    ↓
Currently: writes to threads/{uuid}/history.json
Target:    INSERT INTO exchanges (thread_id, seq, ts, user_input, assistant)
    ↓
On thread:open → HistoryFile.read() → returns { exchanges: [...] }
    ↓
Server sends: { type: 'thread:opened', exchanges: [...] }
    ↓
Client: convertExchangesToMessages() → convertPartToSegment() per part
    ↓
InstantSegmentRenderer renders grouped segments (collapsed, no animation)
```

### The Contract

The client expects `exchanges` as an array of:
```typescript
{
  seq: number,
  ts: number,
  user: string,
  assistant: {
    parts: Array<
      | { type: 'text', content: string }
      | { type: 'think', content: string }
      | { type: 'tool_call', toolCallId: string, name: string,
          arguments: Record<string, unknown>,
          result: { output?: string, display?: unknown[], error?: string, files?: string[] },
          duration_ms?: number }
    >
  },
  metadata?: unknown[]
}
```

**This shape must come out of SQLite exactly as it comes out of history.json today.** The `assistant` column stores the parts object as JSON. On read, parse it back. The client conversion code (`convertExchangesToMessages`, `convertPartToSegment`) does not change.

### Wire Resume

Kimi CLI uses `--session {threadId}` to resume. The CLI manages its own session state independently. The history.json / SQLite data is for **our UI rendering**, not for the CLI's memory. Both coexist — CLI has its session, we have our exchange history.

---

## 1.1 SQLite Setup

### Dependency

Use **Knex.js** as query builder for future Supabase/Postgres portability.

```bash
cd kimi-ide-server && npm install knex better-sqlite3
```

Knex wraps `better-sqlite3` and provides async interface + Postgres-compatible query syntax. Same queries work against both SQLite and Postgres when we add Supabase.

### Database Module

New file: `kimi-ide-server/lib/db/index.js`

```javascript
const knex = require('knex');
const path = require('path');

let db = null;

function getDb(systemDir) {
  if (db) return db;
  const dbPath = path.join(systemDir, 'robin.db');
  db = knex({
    client: 'better-sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true,
  });
  return db;
}

async function migrate(db) {
  // Create tables — see schema below
}

async function close() {
  if (db) { await db.destroy(); db = null; }
}

module.exports = { getDb, migrate, close };
```

### Database Location

`ai/system/robin.db` — Option B. Visible to user, managed by Robin. In `.gitignore`.

### Schema

Write as Knex migrations for portability (works with both SQLite and Postgres):

```javascript
// migrations/001_initial.js
exports.up = function(knex) {
  return knex.schema
    .createTable('threads', table => {
      table.text('thread_id').primary();
      table.text('panel_id').notNullable();
      table.text('name').notNullable().defaultTo('New Chat');
      table.text('created_at').notNullable();
      table.text('resumed_at');
      table.integer('message_count').notNullable().defaultTo(0);
      table.text('status').notNullable().defaultTo('suspended');
      table.text('date');  // YYYY-MM-DD for daily-rolling
      table.integer('updated_at').notNullable().defaultTo(0);  // ms timestamp for MRU
      table.index(['panel_id']);
      table.index(['date']);
    })
    .createTable('exchanges', table => {
      table.increments('id').primary();
      table.text('thread_id').notNullable()
        .references('thread_id').inTable('threads').onDelete('CASCADE');
      table.integer('seq').notNullable();
      table.integer('ts').notNullable();
      table.text('user_input').notNullable();
      table.text('assistant').notNullable();  // JSON string: { parts: [...] }
      table.text('metadata').defaultTo('[]');
      table.unique(['thread_id', 'seq']);
      table.index(['thread_id', 'seq']);
    })
    .createTable('system_config', table => {
      table.text('key').primary();
      table.text('value').notNullable();
      table.integer('updated_at').notNullable().defaultTo(0);
    })
    .createTable('system_wiki', table => {
      table.text('slug').primary();
      table.text('title').notNullable();
      table.text('content').notNullable();
      table.text('context');  // where this surfaces
      table.integer('updated_at').notNullable().defaultTo(0);
    });
};
```

**Postgres-compatible:** No SQLite-specific syntax. `table.increments()` maps to `SERIAL` in Postgres. `text` type works in both. Knex handles the differences.

### Steps
- [ ] `npm install knex better-sqlite3`
- [ ] Create `lib/db/index.js` with Knex config
- [ ] Create migration file with 4 tables
- [ ] Run migration on server startup (`knex.migrate.latest()`)
- [ ] Add `ai/system/robin.db` to `.gitignore`
- [ ] Add `db.destroy()` to server shutdown handler
- [ ] Verify: server starts, robin.db created in `ai/system/`, tables exist

---

## 1.2 Redirect HistoryFile.js → SQLite

Replace file reads/writes with Knex queries. **Same interface, same return shapes.**

### Current Interface (preserve exactly)

```
constructor(threadDir)                              → sets up path
async create(threadId)                              → HistoryData (empty exchanges)
async read()                                        → HistoryData | null
async addExchange(threadId, userInput, parts)        → Exchange
async exists()                                       → boolean
async countExchanges()                               → number
async getLastExchange()                              → Exchange | null
```

### Method-by-Method Conversion

**`addExchange(threadId, userInput, parts)`**

Currently: read entire file → push to array → write entire file.
SQLite: single INSERT.

```javascript
async addExchange(threadId, userInput, parts) {
  const db = getDb();
  const seq = await this.countExchanges() + 1;
  const ts = Date.now();
  const assistant = JSON.stringify({ parts: parts.map(p => ({ ...p })) });

  await db('exchanges').insert({
    thread_id: threadId,
    seq,
    ts,
    user_input: userInput,
    assistant,
    metadata: '[]',
  });

  return { seq, ts, user: userInput, assistant: { parts }, metadata: [] };
}
```

**`read()`**

Currently: read JSON file, return parsed object.
SQLite: SELECT all exchanges, reconstruct HistoryData shape.

```javascript
async read() {
  const db = getDb();
  const rows = await db('exchanges')
    .where('thread_id', this.threadId)
    .orderBy('seq', 'asc');

  if (rows.length === 0) return null;

  return {
    version: '1.0.0',
    threadId: this.threadId,
    createdAt: rows[0].ts,
    updatedAt: rows[rows.length - 1].ts,
    exchanges: rows.map(row => ({
      seq: row.seq,
      ts: row.ts,
      user: row.user_input,
      assistant: JSON.parse(row.assistant),  // { parts: [...] }
      metadata: JSON.parse(row.metadata || '[]'),
    })),
  };
}
```

**Critical:** `JSON.parse(row.assistant)` must return `{ parts: [...] }` — the exact shape the client expects. The client does `exchange.assistant.parts.map(convertPartToSegment)`. If the JSON is malformed, the instant renderer breaks.

**`getLastExchange()`**

```javascript
async getLastExchange() {
  const db = getDb();
  const row = await db('exchanges')
    .where('thread_id', this.threadId)
    .orderBy('seq', 'desc')
    .first();

  if (!row) return null;
  return {
    seq: row.seq, ts: row.ts,
    user: row.user_input,
    assistant: JSON.parse(row.assistant),
    metadata: JSON.parse(row.metadata || '[]'),
  };
}
```

**`exists()` and `countExchanges()`**

```javascript
async exists() {
  const db = getDb();
  const row = await db('exchanges').where('thread_id', this.threadId).first();
  return !!row;
}

async countExchanges() {
  const db = getDb();
  const result = await db('exchanges').where('thread_id', this.threadId).count('* as count').first();
  return result?.count || 0;
}
```

### Constructor Change

Currently takes `threadDir` (path to thread folder). Needs to take `threadId` instead (or extract it from the path). The DB queries scope by `thread_id`.

```javascript
constructor(threadId) {
  this.threadId = threadId;
}
```

Callers in server.js and ThreadManager.js pass `threadId` instead of constructing a path.

### Steps
- [ ] Modify HistoryFile constructor: accept `threadId` instead of `threadDir`
- [ ] Replace all fs operations with Knex queries
- [ ] `read()` reconstructs exact HistoryData shape from rows
- [ ] `addExchange()` does single INSERT, returns Exchange object
- [ ] `JSON.parse(row.assistant)` returns `{ parts: [...] }` — verify with test
- [ ] Update callers: server.js (line 749), ThreadManager.js (getRichHistory)
- [ ] Delete history.json file writes (stop creating thread UUID directories for this purpose)
- [ ] Verify: send a chat message → exchange appears in SQLite
- [ ] Verify: open a thread → exchanges load from SQLite → client renders correctly
- [ ] Verify: tool calls with arguments and results survive the JSON round-trip

---

## 1.3 Redirect ThreadIndex.js → SQLite

Replace threads.json file with `threads` table queries.

### Current Interface (preserve exactly)

```
async init()                          → void
async list()                          → Array<{threadId, entry}>  (MRU order)
async get(threadId)                   → ThreadEntry | null
async create(threadId, name?)         → ThreadEntry
async update(threadId, updates)       → ThreadEntry | null
async rename(threadId, newName)       → ThreadEntry | null
async activate(threadId)              → ThreadEntry | null
async suspend(threadId)               → ThreadEntry | null
async incrementMessageCount(threadId) → ThreadEntry | null
async markResumed(threadId)           → ThreadEntry | null
async delete(threadId)                → boolean
async touch(threadId)                 → ThreadEntry | null
async setDate(threadId, dateString)   → ThreadEntry | null
async rebuild()                       → number
```

### Key Conversions

**`list()` — MRU ordering**

Currently: Object insertion order (delete + re-add = move to end).
SQLite: `ORDER BY updated_at DESC`.

```javascript
async list() {
  const db = getDb();
  const rows = await db('threads')
    .where('panel_id', this.panelId)
    .orderBy('updated_at', 'desc');

  return rows.map(row => ({
    threadId: row.thread_id,
    entry: {
      name: row.name,
      createdAt: row.created_at,
      resumedAt: row.resumed_at,
      messageCount: row.message_count,
      status: row.status,
      date: row.date,
    },
  }));
}
```

**`touch()` — MRU bump**

Currently: delete key from object, re-add (moves to end of insertion order).
SQLite: update `updated_at` timestamp.

```javascript
async touch(threadId) {
  const db = getDb();
  await db('threads').where('thread_id', threadId).update({ updated_at: Date.now() });
  return this.get(threadId);
}
```

**`create()`**

```javascript
async create(threadId, name = 'New Chat') {
  const db = getDb();
  const entry = {
    thread_id: threadId,
    panel_id: this.panelId,
    name,
    created_at: new Date().toISOString(),
    message_count: 0,
    status: 'suspended',
    updated_at: Date.now(),
  };
  await db('threads').insert(entry);
  return { name, createdAt: entry.created_at, messageCount: 0, status: 'suspended' };
}
```

### Constructor Change

Needs `panelId` for scoped queries. Currently scoped by directory path.

```javascript
constructor(panelId) {
  this.panelId = panelId;
}
```

### Steps
- [ ] Modify constructor: accept `panelId` instead of `threadsDir`
- [ ] Replace all fs operations with Knex queries
- [ ] `list()` uses `ORDER BY updated_at DESC` for MRU
- [ ] `touch()` updates `updated_at` instead of delete+reinsert
- [ ] Remove `load()` / `_save()` file caching (SQLite is the cache)
- [ ] Update callers: ThreadManager, ThreadWebSocketHandler
- [ ] `rebuild()`: scan filesystem for CHAT.md files, INSERT OR IGNORE into threads table
- [ ] Verify: create/list/rename/delete threads works
- [ ] Verify: MRU ordering correct after touch
- [ ] Verify: daily-rolling strategy finds today's thread by date

---

## 1.4 ChatFile.js → Per-User Thread Folders

ChatFile continues writing markdown to the repo. Output path changes.

### Current Path
```
ai/views/{workspace}/threads/{threadId}/CHAT.md
```

### New Path
```
ai/views/{workspace}/chat/threads/{username}/thread-name.md
```

### Username Detection

```javascript
const { execSync } = require('child_process');

function getUsername() {
  try {
    return execSync('git config user.name', { encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
}
```

### Thread Name → Filename

```javascript
function threadNameToFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) + '.md';
}
```

### threads/index.json

```json
{
  "sort": "last-active",
  "order": "desc"
}
```

### Steps
- [ ] Add `getUsername()` utility
- [ ] Add `threadNameToFilename()` utility
- [ ] Modify ChatFile constructor to accept per-user path
- [ ] Create `threads/` and `threads/{username}/` directories on first write
- [ ] Create `threads/index.json` with default sort config
- [ ] On thread rename: rename the .md file too
- [ ] Verify: markdown lands in `threads/{username}/thread-name.md`

---

## 1.5 Cleanup

### Stop Creating Thread UUID Directories

Currently the server creates `threads/{uuid}/` directories to hold CHAT.md and history.json. With SQLite handling exchange data, and ChatFile writing to per-user folders, these UUID directories are no longer needed for new threads.

- [ ] Remove directory creation from ThreadManager.createThread() (or delegate to ChatFile only)
- [ ] HistoryFile no longer needs `ensureDir()` — it writes to SQLite

### Old Files

This is pre-production. No migration needed. Old threads.json and history.json files can be left in place or deleted manually. They won't be read.

- [ ] Add `threads.json` and `history.json` patterns to `.gitignore`

---

## Issues / Discussion Points

### Knex Async vs better-sqlite3 Sync

`better-sqlite3` is synchronous. Knex wraps it in Promises. The existing codebase uses `async/await` throughout (HistoryFile, ThreadIndex, ThreadManager all use `async` methods). So Knex's async wrapper is fine — the calling code is already async.

If we ever swap to Postgres (Supabase), the async is real. No code changes needed.

### JSON Round-Trip Fidelity

The `assistant` column stores `JSON.stringify({ parts: [...] })`. On read, `JSON.parse()` must return the exact same shape. This is safe for:
- Strings, numbers, booleans, null
- Nested objects and arrays
- `undefined` values are dropped by JSON.stringify (this is fine — no part uses undefined)

**Test:** Write a tool_call part with arguments + result + display, read it back, deep-equal compare. This is the most fragile point.

### Knex Migration Runner

Knex has a built-in migration system. On server startup:
```javascript
await db.migrate.latest({ directory: './lib/db/migrations' });
```

This auto-creates tables on first run and applies schema changes on updates. Standard pattern.

### Supabase Future Path

When Supabase is added:
```javascript
// Switch from SQLite to Postgres by changing config:
db = knex({
  client: 'pg',
  connection: process.env.SUPABASE_DB_URL,
});
```

Same Knex queries, different driver. The schema migrations work for both. This is why we use Knex instead of raw `better-sqlite3`.

---

## Completion Criteria

- [ ] `knex` and `better-sqlite3` installed
- [ ] `ai/system/robin.db` created on server start (4 tables)
- [ ] HistoryFile reads/writes exchanges table (JSON round-trip verified)
- [ ] ThreadIndex reads/writes threads table (MRU ordering verified)
- [ ] ChatFile writes to `threads/{username}/thread-name.md`
- [ ] threads/index.json created with sort config
- [ ] Client receives `exchanges` array on thread:open → instant render works
- [ ] Tool call arguments + results survive SQLite JSON round-trip
- [ ] No more history.json or threads.json files created for new threads
- [ ] Server starts cleanly
