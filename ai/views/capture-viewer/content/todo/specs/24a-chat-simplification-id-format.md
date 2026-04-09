# SPEC-24a — Chat Simplification: Timestamp IDs, Null Names, Unified Verb, Orphan Purge

**Parent:** SPEC-24 (chat simplification)
**Position:** Phase 1 of 6. Foundation — every other 24x phase depends on timestamp IDs, a single unified `thread:open-assistant` verb, and the `thread:open-agent` orphan chain being gone.
**Depends on:** SPEC-01 complete (server.js decomposition merged). Latest commit should include `thread-crud.js`, `client-message-router.js`, `ThreadIndex.js`, `agent-session-handler.js`, and `createAgentSessionHandler` wired into server.js.
**Model recommendation:** **Opus 4.6** or equivalent. This is a multi-file surgical pass touching server + client + tests. There are **five work streams** and a ~400-line orphan deletion; the orchestrator considered splitting it but chose to bundle because the renames, deletions, and wire-protocol changes are tightly coupled and must land atomically.
**Estimated blast radius:** **Medium-high.** You're renaming a wire-protocol message type (`thread:create` + `thread:open` → `thread:open-assistant`), deleting a second wire-protocol message type (`thread:open-daily`), deleting a third wire-protocol message type (`thread:open-agent`) along with its 395-line handler chain, and cutting one dead-code client hijack. A mistake here can strand the chat UI (no working thread verb) or crash the runner (if the orphan global is actually load-bearing — it isn't, but verify).

---

## Your mission

Five tightly-coupled work streams. All in one commit (or one stacked PR). Do not split.

**Stream 1 — Timestamp thread IDs.**
Replace `uuidv4()`-based thread IDs with human-readable timestamp IDs in `YYYY-MM-DDTHH-MM-SS-mmm` format, **local time**. Add a `generateThreadId()` helper. Delete the `uuid` import from `thread-crud.js` (the package stays — other files still use it).

**Stream 2 — Null default name + kill `newChatName()`.**
Default `name` in `ThreadIndex.create()` becomes `null`. Delete the `newChatName()` function in `thread-crud.js`. New threads have no display name until Mario's enrichment pipeline fills one in; the client falls back to the ID minus milliseconds (Phase 24e).

**Stream 3 — Unify `thread:create` + `thread:open` → `thread:open-assistant`.**
The current protocol has two entry points with overlapping responsibilities. Collapse them into one verb — `thread:open-assistant` — that upserts: if `msg.threadId` is provided and the thread exists, resume it; otherwise create a new one. The verb name is deliberate — it matches the `Chat Assistants/` vs `Background Workers/` taxonomy in `ai/views/agents-viewer/`, and the explicitness prevents the class of "agents need their own message type" mistake that created the `thread:open-agent` orphan we're deleting in Stream 5.

**Stream 4 — Delete `thread:open-daily` entirely.**
Kill the server handler (`handleThreadOpenDaily` in `thread-crud.js`). Kill the router case (`client-message-router.js`). Kill the one client caller (`TicketBoard.tsx`) — but **delete** the hijack, do not replace it. Audit shows `TicketBoard` has no chat UI at all; the `thread:open-daily` send is dead code cargo-culted from an earlier design. Proof: it only reads `tickets.json` via `usePanelData`, never uses the thread it opens. Removing the `useEffect` is the correct fix.

**Stream 5 — Delete the `thread:open-agent` orphan chain.**
395 lines of dead code across three files, plus the server.js wiring. Zero clients send this message type (grep proves it). Files to delete:
- `open-robin-server/lib/thread/agent-session-handler.js` (167 lines)
- `open-robin-server/lib/session/session-loader.js` (164 lines)
- `open-robin-server/lib/wire/agent-sessions.js` (64 lines)

Plus: `createAgentSessionHandler` require + call in `server.js`, the router case in `client-message-router.js`, the `handleThreadOpenAgent` dependency injection, and the `lib/session/` directory itself (empty after deletion).

---

**After this phase:**
- New threads get IDs like `2026-04-08T14-30-22-123`.
- `SELECT name FROM threads WHERE name IS NULL` returns most or all rows.
- `thread:create`, `thread:open`, `thread:open-daily`, and `thread:open-agent` all return "unknown message type" if any stale client sends them.
- `thread:open-assistant` is the only verb that opens a chat thread.
- `newChatName()`, `handleThreadOpenDaily`, `handleThreadCreate` (as export), `handleThreadOpen` (as export), and the `uuid` import in `thread-crud.js` no longer exist.
- `ThreadWebSocketHandler.handleThreadOpenAssistant` is exported and is the only external entry point into create/open.
- The entire `lib/session/` directory is gone.
- `lib/thread/agent-session-handler.js` and `lib/wire/agent-sessions.js` are gone.
- `createAgentSessionHandler` is gone from `server.js`.
- `TicketBoard.tsx` no longer sends any thread messages on mount.
- `ChatArea.tsx` sends `thread:open-assistant` (not `thread:create`).
- `Sidebar.tsx` sends `thread:open-assistant` for both "new" and "resume" (not `thread:create` / `thread:open`).
- The smoke test handler-export list is updated.

**You are not touching:**
- `ChatFile.js` (filename changes live in Phase 24b)
- Strategy files (`strategies/daily-rolling.js`, etc. — Phase 24d)
- `auto-rename.js` (Phase 24d)
- Any `viewsDir` path computation (Phase 24c)
- UI display-name rendering with milliseconds stripped (Phase 24e)
- `lib/runner/index.js:115-135` — the persona-wire notify block becomes functionally dead after this phase (since `global.__agentWireSessions` is no longer set), but it self-nulls safely via its existing `if (agentWireSessions && ...)` guard. **Flag it for Phase 24f deep sweep**, do not delete in 24a.
- `lib/harness/kimi/index.js:52` `--session` flag coupling — separate followup.
- `lib/harness/compat.js:85` `--session` flag — separate followup.

Resist the urge to DRY, rename, or reorganize anything outside the explicit change list. This is a targeted surgical pass across a large surface. Every extra edit grows the blast radius.

---

## Context before you touch code

Read these in order. Do not skip — line numbers drift and wire-protocol work is unforgiving.

1. **`ai/views/capture-viewer/content/todo/specs/24-chat-simplification.md`** — parent spec. 1 minute. Understand the 6-phase layout and what's deferred.
2. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules. Pay attention to "delete, don't deprecate", "no backward-compat shims", and "one job per file".
3. **`open-robin-server/lib/thread/thread-crud.js`** (all 365 lines) — the file you'll edit most.
4. **`open-robin-server/lib/thread/ThreadIndex.js`** (lines 51-79 and 193-211) — the `create()` default + `_toEntry()` serialization.
5. **`open-robin-server/lib/thread/ThreadWebSocketHandler.js`** (lines 163-187) — the module export wiring; understand how `...crud` spreads into the module exports.
6. **`open-robin-server/lib/ws/client-message-router.js`** (all 525 lines — focus on lines 5-30 header and 97-215 thread cases) — the router you'll rewrite.
7. **`open-robin-server/server.js`** (lines 60-70 and 320-362) — where `createAgentSessionHandler` is wired up; you'll rip both.
8. **`open-robin-server/lib/thread/agent-session-handler.js`** (all 167 lines) — read the header to understand what it does, then mentally prepare to delete it.
9. **`open-robin-server/lib/session/session-loader.js`** (all 164 lines) — same. Transitively orphaned; only caller is `agent-session-handler.js`.
10. **`open-robin-server/lib/wire/agent-sessions.js`** (all 64 lines) — same. Only caller is `agent-session-handler.js`. Note the `global.__agentWireSessions` side effect — the runner reads it but null-checks, so it's safe to delete (see "Orphan deletion safety check" below).
11. **`open-robin-server/lib/runner/index.js`** (lines 115-135) — read to confirm the runner's null-check guard works when the global is undefined.
12. **`open-robin-client/src/components/tickets/TicketBoard.tsx`** (lines 125-165) — the dead-code hijack you'll delete.
13. **`open-robin-client/src/components/ChatArea.tsx`** (lines 50-60) — one-line rename of the wire message type.
14. **`open-robin-client/src/components/Sidebar.tsx`** (lines 140-200) — two one-line renames of the wire message type.
15. **`open-robin-server/test/smoke-spec03-spec15.js`** (lines 52-72) — the handler export list you'll update.

### Line-number drift verification

Before editing, run:

```bash
cd open-robin-server

wc -l lib/thread/thread-crud.js lib/thread/ThreadIndex.js \
      lib/ws/client-message-router.js server.js \
      lib/thread/agent-session-handler.js lib/session/session-loader.js \
      lib/wire/agent-sessions.js
```

Expected totals (approximately — tolerate ±3 lines):
- `thread-crud.js` = 365
- `ThreadIndex.js` = 214
- `client-message-router.js` = 524
- `server.js` = 412
- `agent-session-handler.js` = 167
- `session-loader.js` = 164
- `agent-sessions.js` = 64

Then grep for every reference you're about to touch:

```bash
grep -n "newChatName\|handleThreadOpenDaily\|uuidv4\|thread:create\|thread:open\b\|thread:open-daily\|thread:open-agent\|handleThreadOpenAgent\|createAgentSessionHandler\|registerAgentSession\|parseSessionConfig\|buildSystemContext\|checkSessionInvalidation" lib/ server.js test/smoke-spec03-spec15.js
```

Reconcile any drift before editing. If line numbers in this spec are more than ~3 off from what you see, read the files again and re-pick the insertion points from context (not line numbers).

### Orphan deletion safety check

Before deleting `lib/wire/agent-sessions.js`, prove the `global.__agentWireSessions` side effect is safe to remove:

```bash
# Only consumer of the global:
grep -rn "__agentWireSessions\|agentWireSessions" open-robin-server/lib open-robin-server/server.js
```

Expected output (after filtering out `wire-debug.log.old`):
- `lib/runner/index.js:117` — reads `global.__agentWireSessions`, null-checks at L118
- `lib/wire/agent-sessions.js:21,24,25,35,36,47,57` — the file we're deleting
- `lib/wire/process-manager.js:15-16` — a comment only

The runner's code is:
```js
const agentWireSessions = global.__agentWireSessions;
if (agentWireSessions && manifest?.bot_name) { ... }
```

After we delete the producer, `global.__agentWireSessions` is `undefined`, the check fails, the block silently skips. **Safe.**

Prove no other file sets or reads the global:
```bash
grep -rn "global\.__agentWireSessions" open-robin-server/lib open-robin-server/server.js
```
Expected: only `lib/wire/agent-sessions.js:25` (the assignment we're deleting) and `lib/runner/index.js:117` (the null-checked reader).

---

## Changes — file by file

### 1. `open-robin-server/lib/thread/thread-crud.js`

This file gets the most surgery. Work top-to-bottom in the file so you don't lose your place.

**1a. Delete the `uuid` import (L13).**

```js
// DELETE:
const { v4: uuidv4 } = require('uuid');
```

Verify there are no other `uuidv4` callers in this file:
```bash
grep -n uuidv4 lib/thread/thread-crud.js
```
Expected: zero hits after deletion.

**1b. Delete `newChatName()` (L25-40) entirely.**

The whole function, including its JSDoc block (L25-29). Its only caller is `handleThreadCreate` at L59, which you're fixing in 1d.

**1c. Add `generateThreadId()` as a private helper.**

Put it where `newChatName()` used to be (near the top of the factory function, L25 area). Keep it inside `createCrudHandlers` — it's a private helper, not an export. It has no dependencies on injected `deps`, so it could live outside the factory, but put it **inside** to match the style of the original `newChatName()` it replaces.

```js
  /**
   * Generate a timestamp-based thread ID.
   *
   * Format: YYYY-MM-DDTHH-MM-SS-mmm (e.g. "2026-04-08T14-30-22-123")
   *
   * This format is:
   * - Filesystem-safe (no colons — colons break on Windows and some tooling)
   * - Lexicographically sortable (chronological sort by string comparison)
   * - Human-readable at a glance
   * - Millisecond-precise (collision-resistant within a single process;
   *   two threads created in the same millisecond is not a concern for
   *   human-driven chat creation)
   *
   * Local time, not UTC. A chat created at 2:34 PM Pacific shows `14-30` in
   * its ID, not `21-30`. Matches user intuition for "when did I create that
   * chat" and matches how newChatName() worked before it was deleted.
   *
   * @returns {string}
   */
  function generateThreadId() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}-${ms}`;
  }
```

**Do not** use `new Date().toISOString().replace(...)`. `toISOString()` returns UTC. This helper uses local wall-clock time — that's the whole point of millisecond-precise, filesystem-safe, human-readable IDs.

**1d. Update `handleThreadCreate` (L50-91) — keep the function, update the ID + name generation, remove the stale comment.**

Current (L57-59):
```js
    // Generate thread ID (will be Kimi session ID)
    const threadId = uuidv4();
    const name = msg.name || newChatName();
    const harnessId = msg.harnessId || 'kimi';
```

New:
```js
    // Generate thread ID — timestamp-based, filesystem-safe, lexicographically
    // sortable. See generateThreadId() above for format.
    const threadId = generateThreadId();
    const name = msg.name || null;
    const harnessId = msg.harnessId || 'kimi';
```

Notes:
- The comment `"(will be Kimi session ID)"` was already stale — thread IDs are Open Robin's, not Kimi's. Deleting it now as part of this cleanup. The actual `--session` flag coupling in `lib/harness/kimi/index.js:52` and `lib/harness/compat.js:85` is **not touched** — separate followup.
- `handleThreadCreate` stays defined. It does NOT get renamed or deleted. It just stops being exported (see 1g below) and gets called by the new dispatcher instead.

**1e. Delete `handleThreadOpenDaily()` (L179-240) entirely.**

The whole doc comment block (L179-189) and the full function body (L190-240) go. Approximately 62 lines gone.

After deletion, the function right above the deletion should be `handleThreadOpen` (L99-177) and the function right below should be `handleThreadRename` (formerly at L249, now shifted up).

**1f. Add `handleThreadOpenAssistant()` — the new unified dispatcher.**

Place it **immediately after** `handleThreadOpen` (which ends around L177 before, or wherever it lands after your edits). This is the new exported entry point for all thread open/create operations.

```js
  /**
   * Handle thread:open-assistant message — the unified create-or-resume verb.
   *
   * Upsert semantics: if msg.threadId is provided and the thread exists in the
   * index, resume it (fires thread:opened). Otherwise, create a new thread
   * (fires thread:created, then thread:opened via handleThreadCreate's chained
   * call to handleThreadOpen).
   *
   * This replaces the split thread:create / thread:open / thread:open-daily /
   * thread:open-agent protocol. The "assistant" suffix matches the
   * Chat Assistants vs Background Workers taxonomy in ai/views/agents-viewer/ —
   * background workers use the runner path (lib/runner/) and never touch
   * thread:* messages.
   *
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} [msg.threadId] - If present and valid, resume. Otherwise create.
   * @param {string} [msg.name] - Optional display name for new threads (default null).
   * @param {string} [msg.harnessId] - Harness selection for new threads ('kimi' | 'robin').
   * @param {object} [msg.harnessConfig] - BYOK configuration for new threads.
   */
  async function handleThreadOpenAssistant(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    // Upsert: if client supplied a threadId and it exists, resume.
    if (msg.threadId) {
      const existing = await state.threadManager.getThread(msg.threadId);
      if (existing) {
        return handleThreadOpen(ws, msg);
      }
      // threadId provided but thread doesn't exist — fall through to create.
      // This handles the race where a client tries to resume a freshly-deleted
      // thread. Creating a new one is the least-surprising outcome.
      console.warn(`[ThreadWS] thread:open-assistant with unknown threadId ${msg.threadId} — creating new`);
    }

    // No threadId, or threadId not found → create a new thread.
    return handleThreadCreate(ws, msg);
  }
```

**1g. Update the return object (L355-362).**

`handleThreadCreate` and `handleThreadOpen` become **private helpers** — called only by the new dispatcher, which lives in the same closure. Remove both from the return object along with `handleThreadOpenDaily`. Add `handleThreadOpenAssistant`.

Current:
```js
  return {
    handleThreadCreate,
    handleThreadOpen,
    handleThreadOpenDaily,
    handleThreadRename,
    handleThreadDelete,
    handleThreadCopyLink
  };
```

New:
```js
  return {
    handleThreadOpenAssistant,
    handleThreadRename,
    handleThreadDelete,
    handleThreadCopyLink
  };
```

This shrinks `ThreadWebSocketHandler`'s public surface and prevents future code from re-creating the split. If someone wants to call create or open directly, they have to go through the dispatcher (which enforces upsert semantics).

**1h. Update the file header doc comment (L1-11).**

Current:
```js
/**
 * Thread CRUD Handlers
 *
 * Extracted from ThreadWebSocketHandler.js — handles thread create, open,
 * open-daily, rename, delete, and copy-link operations.
 *
 * Uses a factory pattern so the coordinator can inject shared state (Maps)
 * and helper functions. All functions close over the same scope, which is
 * critical because handleThreadCreate and handleThreadOpenDaily both call
 * handleThreadOpen internally.
 */
```

New:
```js
/**
 * Thread CRUD Handlers
 *
 * Extracted from ThreadWebSocketHandler.js — exposes handleThreadOpenAssistant
 * (the unified create-or-resume dispatcher), handleThreadRename,
 * handleThreadDelete, and handleThreadCopyLink.
 *
 * handleThreadCreate and handleThreadOpen remain as private helpers inside
 * the factory, called only by handleThreadOpenAssistant. They are not
 * exported — external callers must use the dispatcher so upsert semantics
 * are enforced.
 *
 * Uses a factory pattern so the coordinator can inject shared state (Maps)
 * and helper functions. All functions close over the same scope, which is
 * critical because handleThreadOpenAssistant calls handleThreadCreate /
 * handleThreadOpen, and handleThreadCreate calls handleThreadOpen internally.
 */
```

---

### 2. `open-robin-server/lib/thread/ThreadIndex.js`

**2a. Change the `create()` default for `name` (L59).**

Current:
```js
  async create(threadId, name = 'New Chat', options = {}) {
```

New:
```js
  async create(threadId, name = null, options = {}) {
```

**2b. Verify the `threads.name` column is nullable.**

```bash
grep -n "'name'" lib/db/migrations/*.js
```

Look for the `threads` table creation and the `name` column definition. If it has `.notNullable()`, **stop and report** — the migration needs to change, which is out of scope for 24a (it'd push into 24b territory where ChatFile + frontmatter work lives). If `name` is nullable (just `.string('name')` or `.text('name')`, no `.notNullable()`), you're fine.

Expected: the column is nullable. If not, flag it.

**2c. Verify `_toEntry()` passes null through correctly (L193-211).**

```js
_toEntry(row) {
  const entry = {
    name: row.name,   // null round-trips as null — that's what we want
    createdAt: row.created_at,
    ...
```

No code change — sanity-check by reading the function and confirming no downstream field mutator assumes `name` is a string. It doesn't.

**2d. Update the `create()` JSDoc (L51-58).**

Current:
```js
  /**
   * Create a new thread entry
   * @param {string} threadId
   * @param {string} [name='New Chat']
   * @param {object} [options]
   * @param {string} [options.harnessId='kimi']
   * @param {object} [options.harnessConfig]
   * @returns {Promise<object>}
   */
```

New:
```js
  /**
   * Create a new thread entry
   * @param {string} threadId
   * @param {string|null} [name=null] - Display name; null means "fall back to ID" in the UI
   * @param {object} [options]
   * @param {string} [options.harnessId='kimi']
   * @param {object} [options.harnessConfig]
   * @returns {Promise<object>}
   */
```

---

### 3. `open-robin-server/lib/ws/client-message-router.js`

This file needs the biggest rewrite. Work methodically.

**3a. Delete the `handleThreadOpenAgent` dep from the factory signature.**

At L52 (the JSDoc param):
```js
 * @param {(clientMsg: object) => Promise<void>} deps.handleThreadOpenAgent - from createAgentSessionHandler (01e)
```
— DELETE this line.

At L68 (the destructured argument):
```js
  handleThreadOpenAgent,
```
— DELETE this line.

**3b. Replace the four thread-entry cases (L97-195) with a single `thread:open-assistant` case.**

Current (97-195):
```js
      if (clientMsg.type === 'thread:create') {
        console.log('[WS] thread:create received');
        await ThreadWebSocketHandler.handleThreadCreate(ws, clientMsg);
        // ... spawn wire, send wire_ready, register with ThreadManager ...
        return;
      }

      if (clientMsg.type === 'thread:open') {
        // ... close current wire, open thread, spawn wire, no wire_ready ...
        return;
      }

      if (clientMsg.type === 'thread:open-daily') {
        // ... close wire, call handleThreadOpenDaily, spawn wire ...
        return;
      }

      if (clientMsg.type === 'thread:open-agent') {
        await handleThreadOpenAgent(clientMsg);
        return;
      }
```

Delete all four blocks. Replace with a single unified block:

```js
      if (clientMsg.type === 'thread:open-assistant') {
        console.log('[WS] thread:open-assistant received, threadId:', clientMsg.threadId?.slice(0, 8) || '(new)');

        // Close current wire if one is open (switching threads or reopening).
        if (session.wire) {
          console.log('[WS] Closing previous wire before opening assistant thread');
          session.wire.kill('SIGTERM');
          session.wire = null;
        }

        // Dispatcher: create or resume based on whether msg.threadId exists.
        await ThreadWebSocketHandler.handleThreadOpenAssistant(ws, clientMsg);

        // After the handler runs, the per-ws state should have the current thread ID.
        const state = ThreadWebSocketHandler.getState(ws);
        const threadId = state?.threadId;
        if (!threadId) {
          console.error('[WS] No threadId after handleThreadOpenAssistant — dispatch failed');
          return;
        }

        console.log('[WS] Spawning wire for thread:', threadId);
        session.currentThreadId = threadId;
        const wire = spawnThreadWire(threadId, projectRoot);
        session.wire = wire;
        registerWire(threadId, wire, projectRoot, ws);

        console.log('[WS] Wire spawned, awaiting harness ready...');
        await awaitHarnessReady(wire);
        console.log('[WS] Setting up handlers...');
        setupWireHandlers(wire, threadId);
        session.wire = wire;  // Re-assign in case exit handler cleared it
        console.log('[WS] Initializing wire...');
        initializeWire(wire);
        console.log('[WS] Wire initialization complete');

        // Fire wire_ready for BOTH create and resume — this harmonizes the two
        // paths (previously only thread:create sent it, which was a latent bug
        // in the resume flow: the connecting overlay would not clear).
        ws.send(JSON.stringify({ type: 'wire_ready', threadId }));

        // Register with ThreadManager
        if (state?.threadManager) {
          console.log('[WS] Registering with ThreadManager...');
          await state.threadManager.openSession(threadId, wire, ws);
          console.log('[WS] ThreadManager registration complete');
        }
        return;
      }
```

**3c. Delete the file header paragraph that describes the split protocol (L5-12).**

Current (approximately L5-12):
```js
 * Extracted from server.js per SPEC-01f. This is the final extraction
 * under SPEC-01 (server.js decomposition). Handles the full 23-handler
 * switch for client message types: thread lifecycle (create / open /
 * open-daily / rename / delete / copyLink / list), agent session
 * (thread:open-agent), file explorer (tree / content / recent), panel
 * management (set_panel), wire protocol (initialize / prompt /
 * response), file operations (file:move), robin system panel
 * (robin:*), clipboard (clipboard:*), and harness admin
 * (harness:get_mode / set_mode / rollback / list / check_install).
```

New:
```js
 * Extracted from server.js per SPEC-01f. Handles the client message
 * switch for thread lifecycle (open-assistant / rename / delete /
 * copyLink / list), file explorer (tree / content / recent), panel
 * management (set_panel), wire protocol (initialize / prompt /
 * response), file operations (file:move), robin system panel
 * (robin:*), clipboard (clipboard:*), and harness admin
 * (harness:get_mode / set_mode / rollback / list / check_install).
```

**3d. Delete the "architectural note" paragraph (L22-29) that talks about the three wire-spawning handlers.**

Current:
```js
 * Architectural note: most of the handlers in this module are thin
 * delegations to already-extracted modules. The three wire-spawning
 * handlers (thread:create, thread:open, thread:open-daily) share a
 * visible repeated wire-spawn sequence — the repetition is intentional
 * for this extraction and is a candidate for post-SPEC-01 DRY cleanup.
 * The five harness:* admin handlers keep their inline require() calls
 * (only paid when the rarely-used admin command arrives) rather than
 * hoisting them to module-level imports.
```

New:
```js
 * Architectural note: most of the handlers in this module are thin
 * delegations to already-extracted modules. The five harness:* admin
 * handlers keep their inline require() calls (only paid when the
 * rarely-used admin command arrives) rather than hoisting them to
 * module-level imports.
```

The DRY-cleanup candidate the old comment referenced was the triple wire-spawn. That's gone now — there's one wire-spawn block, no duplication to clean up.

**3e. Verify zero stale references remain.**

After the above edits:
```bash
grep -n "thread:create\|thread:open\b\|thread:open-daily\|thread:open-agent\|handleThreadOpenAgent\|handleThreadCreate\|handleThreadOpenDaily" lib/ws/client-message-router.js
```

Expected: zero hits. Only `thread:open-assistant`, `ThreadWebSocketHandler.handleThreadOpenAssistant`, `thread:rename`, `thread:delete`, `thread:copyLink`, and `thread:list` should remain.

Note: `ThreadWebSocketHandler.handleThreadOpen` (without the `-agent` or `-daily` suffix and NOT `Assistant`) should ALSO return zero hits — the router no longer calls it directly.

---

### 4. `open-robin-server/server.js`

**4a. Delete the `createAgentSessionHandler` require (L67 with the comment block L63-66).**

Current (L63-67):
```js
// Agent session handler — per-connection thread:open-agent factory (SPEC-01e).
// NOTE: this require is load-bearing — its transitive require chain sets the
// persona-wire global that the runner reads at startup. Do not make this
// conditional or lazy.
const { createAgentSessionHandler } = require('./lib/thread/agent-session-handler');
```

DELETE all five lines. The "load-bearing" comment is a lie once the file it pulls in (`agent-sessions.js`) is also deleted — nothing needs the global after that. The runner's null check handles it.

**4b. Delete the `createAgentSessionHandler` factory call inside `wss.on('connection')` (L327-336).**

Current:
```js
  // Per-connection thread:open-agent handler (extracted per SPEC-01e).
  const { handleThreadOpenAgent } = createAgentSessionHandler({
    ws,
    session,
    projectRoot,
    AI_PANELS_PATH,
    getDefaultProjectRoot,
    threadWebSocketHandler: ThreadWebSocketHandler,
    wireLifecycle: { awaitHarnessReady, initializeWire, setupWireHandlers },
  });
```

DELETE all ten lines (the comment and the factory call).

**4c. Remove `handleThreadOpenAgent` from the `createClientMessageRouter` deps (L355).**

Current:
```js
  const { handleClientMessage, handleClientClose } = createClientMessageRouter({
    ws,
    session,
    connectionId,
    projectRoot,
    fileExplorer,
    wireLifecycle: { awaitHarnessReady, initializeWire, setupWireHandlers },
    handleThreadOpenAgent,
    sessions,
    setSessionRoot,
    clearSessionRoot,
    getDefaultProjectRoot,
    getRobinHandlers: () => robinHandlers,
    getClipboardHandlers: () => clipboardHandlers,
  });
```

New (remove the `handleThreadOpenAgent` line):
```js
  const { handleClientMessage, handleClientClose } = createClientMessageRouter({
    ws,
    session,
    connectionId,
    projectRoot,
    fileExplorer,
    wireLifecycle: { awaitHarnessReady, initializeWire, setupWireHandlers },
    sessions,
    setSessionRoot,
    clearSessionRoot,
    getDefaultProjectRoot,
    getRobinHandlers: () => robinHandlers,
    getClipboardHandlers: () => clipboardHandlers,
  });
```

**4d. Verify no stale references remain in server.js.**

```bash
grep -n "createAgentSessionHandler\|handleThreadOpenAgent\|thread:open-agent\|agent-session-handler\|agent-sessions" server.js
```

Expected: zero hits.

---

### 5. Delete `open-robin-server/lib/thread/agent-session-handler.js` entirely

All 167 lines gone.

```bash
rm lib/thread/agent-session-handler.js
```

---

### 6. Delete `open-robin-server/lib/session/session-loader.js` entirely

All 164 lines gone.

```bash
rm lib/session/session-loader.js
rmdir lib/session/
```

Confirm the directory is empty before removing it:
```bash
ls lib/session/
# Expected: empty output
```

If anything else shows up in `lib/session/`, stop and flag — you've either missed a file or someone added something since the spec was written.

---

### 7. Delete `open-robin-server/lib/wire/agent-sessions.js` entirely

All 64 lines gone.

```bash
rm lib/wire/agent-sessions.js
```

This is the file that sets `global.__agentWireSessions`. After deletion, the runner's guard at `lib/runner/index.js:118` silently skips the notify block. **Do not** touch the runner in this spec — the self-nulling check already handles it, and editing the runner expands scope.

---

### 8. `open-robin-client/src/components/tickets/TicketBoard.tsx`

**8a. Delete the entire daily-thread `useEffect` (L149-162).**

This component has no chat UI. The `useEffect` is dead code that sends `thread:open-daily` on mount but never consumes the thread. Data flows in via `usePanelData` (L142-147), which reads `tickets.json` directly — no thread needed.

Current:
```tsx
  // Open daily session on connect/reconnect.
  // Reset ref on cleanup so strict-mode remount re-sends.
  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws === lastDailyWsRef.current) return;
    lastDailyWsRef.current = ws;
    ws.send(JSON.stringify({
      type: 'thread:open-daily',
      panel: 'issues-viewer',
    }));
    return () => {
      lastDailyWsRef.current = null;
    };
  }, [ws]);
```

DELETE all 14 lines.

**8b. Delete `lastDailyWsRef` (L127).**

Current:
```tsx
  const lastDailyWsRef = useRef<WebSocket | null>(null);
```

DELETE.

**8c. Remove `useRef` from the React import if no other usage remains.**

Current (L14):
```tsx
import { useCallback, useEffect, useRef } from 'react';
```

Grep inside `TicketBoard.tsx` for other `useRef` / `useEffect` uses:
```bash
grep -n "useRef\|useEffect" open-robin-client/src/components/tickets/TicketBoard.tsx
```

- If `useRef` has zero remaining uses → change import to `import { useCallback, useEffect } from 'react';`
- If `useEffect` also has zero remaining uses after 8a → change import to `import { useCallback } from 'react';`

Minimize the import to exactly what's still used. Do not leave unused import symbols.

**8d. Verify the component still renders correctly.**

After the edits, `TicketBoard` should:
- Still call `usePanelStore((s) => s.ws)` (leave it — harmless)
- Still call `usePanelData({ panel: 'issues-viewer', ... })` (the actual data path)
- Render its three ticket columns as before
- Send zero thread messages on mount
- Send zero thread messages ever

---

### 9. `open-robin-client/src/components/ChatArea.tsx`

**9a. Rename `thread:create` → `thread:open-assistant` (L57).**

Current:
```tsx
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'thread:create', harnessId }));
    }
```

New:
```tsx
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'thread:open-assistant', harnessId }));
    }
```

No threadId on this send → dispatcher creates a new thread.

---

### 10. `open-robin-client/src/components/Sidebar.tsx`

**10a. Rename `thread:create` → `thread:open-assistant` in the confirmation-modal handler (L156).**

Current:
```tsx
            onConfirm: () => {
              sendMessage({ type: 'thread:create', confirmed: true });
              setConfirmModal(prev => ({ ...prev, show: false }));
            },
```

New:
```tsx
            onConfirm: () => {
              sendMessage({ type: 'thread:open-assistant', confirmed: true });
              setConfirmModal(prev => ({ ...prev, show: false }));
            },
```

Note: The `thread:create:confirm` *response* flow is client-only dead code (grep the server for it — zero hits). Leave the outer `useEffect` structure untouched; the deep sweep (Phase 24f) will catch it. We're only renaming the send in this phase.

**10b. Rename `thread:open` → `thread:open-assistant` in `handleOpenThread` (L198).**

Current:
```tsx
  const handleOpenThread = (threadId: string) => {
    sendMessage({ type: 'thread:open', threadId });
  };
```

New:
```tsx
  const handleOpenThread = (threadId: string) => {
    sendMessage({ type: 'thread:open-assistant', threadId });
  };
```

This is the "click to resume" path — `threadId` is populated, so the server dispatcher picks the resume branch.

**10c. Leave `thread:list`, `thread:rename`, `thread:delete`, `thread:copyLink` UNTOUCHED.**

These verbs are not affected by 24a. They stay as-is on both server and client.

---

### 11. `open-robin-server/test/smoke-spec03-spec15.js`

**11a. Update the `EXPECTED_EXPORTS` list (L54-62).**

Current:
```js
const EXPECTED_EXPORTS = [
  'setPanel', 'getState', 'cleanup',
  'sendThreadList',
  'handleThreadCreate', 'handleThreadOpen', 'handleThreadOpenDaily',
  'handleThreadRename', 'handleThreadDelete', 'handleThreadCopyLink',
  'handleMessageSend', 'addAssistantMessage',
  'getCurrentThreadId', 'getCurrentThreadManager',
  '_getThreadManagers', '_getWsState'
];
```

New:
```js
const EXPECTED_EXPORTS = [
  'setPanel', 'getState', 'cleanup',
  'sendThreadList',
  'handleThreadOpenAssistant',
  'handleThreadRename', 'handleThreadDelete', 'handleThreadCopyLink',
  'handleMessageSend', 'addAssistantMessage',
  'getCurrentThreadId', 'getCurrentThreadManager',
  '_getThreadManagers', '_getWsState'
];
```

`handleThreadCreate`, `handleThreadOpen`, `handleThreadOpenDaily` all gone from the export surface (they're private helpers now). `handleThreadOpenAssistant` replaces them.

---

### 12. `open-robin-server/package.json` — DO NOT MODIFY

The `uuid` package is still used elsewhere in the server. **Do not remove it from package.json.** Verify with:

```bash
grep -rn "require('uuid')\|from 'uuid'" lib server.js | grep -v "thread-crud.js"
```

Expected: at least one other caller (e.g., `lib/ws/client-message-router.js` has `require('uuid')` for `generateId`). Leave the dependency alone.

---

## Test plan

### Unit / static checks

```bash
cd open-robin-server

# No stale server references
grep -rn "newChatName\|handleThreadOpenDaily\|handleThreadOpenAgent\|createAgentSessionHandler\|parseSessionConfig\|buildSystemContext\|checkSessionInvalidation\|registerAgentSession\|unregisterAgentSession" lib server.js
# Expected: zero hits

grep -rn "thread:open-daily\|thread:open-agent\|'thread:create'\|\"thread:create\"" lib server.js
# Expected: zero hits
# (The single quoted/double quoted forms catch the wire-protocol type strings.
#  Just `thread:open` in comments or docs is fine as long as it's not a message type.)

# Bare "thread:open" as a message-type literal should also be zero:
grep -rn "type: 'thread:open'\|type: \"thread:open\"" lib server.js
# Expected: zero hits (only thread:open-assistant should remain)

# Deleted files are gone
ls lib/thread/agent-session-handler.js lib/session/ lib/wire/agent-sessions.js 2>&1
# Expected: all three report "No such file or directory"

# Module loads cleanly
node -e "require('./lib/thread/thread-crud.js')"
node -e "require('./lib/ws/client-message-router.js')"
node -e "require('./lib/thread')"
# Expected: no errors, no stack traces

# Smoke test passes
node test/smoke-spec03-spec15.js
# Expected: all assertions pass
```

```bash
cd ../open-robin-client

# No stale client references
grep -rn "thread:create\|thread:open-daily\|thread:open-agent" src
# Expected: zero hits in src/
# (The only remaining thread-lifecycle verb should be thread:open-assistant;
#  response types like thread:created / thread:opened stay — grep for 'type: '
#  prefix to distinguish sends from response handlers.)

grep -rn "type: 'thread:open-assistant'\|type: \"thread:open-assistant\"" src
# Expected: at least 3 hits — ChatArea.tsx, Sidebar.tsx L156, Sidebar.tsx L198

grep -rn "lastDailyWsRef\|thread:open-daily" src/components/tickets
# Expected: zero hits
```

### Live validation

1. **Kill any stale processes first.**
   ```bash
   pkill -9 -f "node.*server.js" || true
   pkill -9 -f "kimi" || true
   ```

2. **Wipe existing thread data.** Pre-prod, per parent spec:
   ```bash
   sqlite3 ai/system/open-robin.db "DELETE FROM threads;"
   rm -rf ai/views/*/chat/
   # ls the chat dirs first if you're nervous — they should only contain test data
   ```

3. **Start the server.**
   ```bash
   cd open-robin-server && node server.js &
   ```
   Expected log: `[Server] Harness mode: ...`, no module load errors, no "require stack" errors.

4. **Open the UI in a browser.** Load the code-viewer or any panel with chat.

5. **Create a new thread via the harness picker.** Click a harness (Kimi recommended since it's the tested path).

6. **Verify the wire-protocol message was `thread:open-assistant`**, not `thread:create`:
   - Open the browser devtools Network tab, filter WS.
   - You should see the client send `{"type":"thread:open-assistant","harnessId":"kimi"}`.
   - The server should respond with `thread:created`, then `thread:opened`, then `wire_ready`.

7. **Verify the thread ID format.**
   ```bash
   sqlite3 ai/system/open-robin.db "SELECT thread_id, name FROM threads;"
   ```
   Expected: `thread_id` matches `/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/`. `name` is blank (null).

8. **Send one user message.** Confirm the turn completes, the response streams, and the message count increments in the DB.

9. **Click the same thread in the sidebar to resume it.** This should fire `thread:open-assistant` *with* a `threadId` field.
   - Server dispatcher should pick the resume branch.
   - Server should respond `thread:opened` (not `thread:created`).
   - The UI should show the history.
   - `wire_ready` should fire on resume too (this fixes a latent bug where the connecting overlay didn't clear on resume).

10. **Click "New Chat" in the sidebar** (or create another via the harness picker). Verify:
    - A fresh thread appears in the sidebar
    - SQLite has both rows with unique timestamp IDs
    - The IDs sort correctly (newer thread has a lexicographically greater ID)

11. **Rename a thread via the sidebar UI.** Confirm `thread:rename` still works:
    ```bash
    sqlite3 ai/system/open-robin.db "SELECT thread_id, name FROM threads;"
    ```
    The renamed row should show the new name.

12. **Delete a thread via the sidebar UI.** Confirm `thread:delete` still works.

13. **Load the issues-viewer panel** (the former TicketBoard chat-hijack site).
    - Open devtools WS filter.
    - Expected: **zero** thread messages sent from TicketBoard on mount.
    - Ticket data should still populate via `file_content_request` for `tickets.json`.
    - No console errors, no "unknown message type" errors from the server.

14. **Test a second connection (open a new tab).** Confirm both tabs can create/resume threads without cross-contamination.

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| Thread create fails with `newChatName is not defined` | Forgot to update `handleThreadCreate` at step 1d | See 1d |
| Thread create fails with `generateThreadId is not defined` | Forgot to add the helper at step 1c | See 1c |
| SQLite insert fails with `NOT NULL constraint failed: threads.name` | `threads.name` column is notNullable in the migration | STOP — flag it, this is out of scope (24b) |
| Client gets `unknown message type: thread:create` | Forgot to update `ChatArea.tsx` L57 or `Sidebar.tsx` L156 | See 9a / 10a |
| Client gets `unknown message type: thread:open` | Forgot to update `Sidebar.tsx` L198 | See 10b |
| Smoke test fails: `handleThreadCreate not found in exports` | Smoke test still asserts the old name | See 11a |
| Server crash on startup: `Cannot find module './lib/thread/agent-session-handler'` | Forgot to delete the require in server.js L67 | See 4a |
| TicketBoard shows "unknown message type: thread:open-daily" | Forgot 8a — the useEffect still fires | See 8a (delete, don't replace) |
| Connecting overlay never clears after resuming a thread | Forgot to send `wire_ready` in the unified open-assistant case | See 3b — `wire_ready` fires for both create and resume |
| Thread IDs look like `2026-04-08T21-30-22-123Z` instead of `14-30-22-123` | Used `toISOString()` instead of local-time getters | See 1c — use `getHours()` etc., not ISO |
| Runner logs crash at ticket completion with `Cannot read properties of undefined (reading 'get')` | You deleted the guard instead of leaving it alone | Restore `lib/runner/index.js` — the null check is the whole point |
| Two sidebars send thread messages when the issues panel is open | TicketBoard hijack still firing | See 8a |

---

## Do not do

- **Do not** touch `ChatFile.js`. Filename changes are Phase 24b.
- **Do not** touch `lib/harness/kimi/index.js:52` or `lib/harness/compat.js:85` (the `--session` flag coupling). Separate followup.
- **Do not** touch `lib/runner/index.js`. The persona-wire notify block self-nulls safely via its existing null-check guard. Flag it for Phase 24f deep sweep; do not delete.
- **Do not** delete `strategies/daily-rolling.js`. The file is functionally dead after this spec (no handler calls it), but its deletion belongs to Phase 24d so phases stay independently revertable.
- **Do not** delete `auto-rename.js`. Phase 24d.
- **Do not** rename any variable other than the ones explicitly called out. E.g. do not rename `currentThreadId`, do not rename `wsState`, do not rename `ChatArea` or `Sidebar` component symbols.
- **Do not** rename the `thread:created` / `thread:opened` *response* types. Keep them distinct — they tell the client whether it got a new thread or resumed an old one. Only the *request* verb is unified.
- **Do not** delete `thread:create:confirm` from `Sidebar.tsx` even though it looks like dead code. Grep confirms the server never sends it, but the cleanup belongs to Phase 24f (deep sweep). Rename the payload inside `onConfirm` (step 10a) and move on.
- **Do not** add YAML frontmatter to markdown files. Phase 24b.
- **Do not** relocate chats to `ai/views/chat/`. Phase 24c.
- **Do not** add a `harness_session_id` column. Different followup entirely.
- **Do not** add backward-compatibility shims for the deleted `thread:create` / `thread:open` / `thread:open-daily` / `thread:open-agent` wire types. Clean break, per standards doc ("Delete, don't deprecate"). If an old client sends them, it gets "unknown message type" in the server log. Acceptable — pre-prod.
- **Do not** introduce a feature flag gate for the rename. Cut clean.
- **Do not** DRY the wire-spawn block into a helper. The spec leaves the inline sequence in place deliberately — extracting it adds abstraction for zero benefit when there's only one caller. Any DRY pass is a separate spec.
- **Do not** commit the deletion of `lib/session/` and `lib/wire/agent-sessions.js` in a different commit from the `agent-session-handler.js` deletion. Atomic commit — they're one unified orphan chain.

---

## Commit message template

```
SPEC-24a: unify thread verbs, timestamp IDs, purge orphan chain

Five coupled changes that land atomically:

1. Thread IDs are now timestamps: generateThreadId() returns
   YYYY-MM-DDTHH-MM-SS-mmm in local time. uuidv4 gone from
   thread-crud.js (uuid package stays — other files use it).

2. New threads default to name=null. newChatName() deleted. Client
   renders the ID (with ms stripped) as fallback in a later phase.

3. thread:create + thread:open + thread:open-daily + thread:open-agent
   all collapse into one verb: thread:open-assistant. Upsert semantics —
   dispatcher picks resume vs create based on whether msg.threadId is
   present and valid. Matches the Chat Assistants vs Background Workers
   taxonomy in ai/views/agents-viewer/. thread:created / thread:opened
   response types stay distinct.

4. handleThreadCreate and handleThreadOpen become private helpers
   inside thread-crud.js — only handleThreadOpenAssistant is exported.
   Shrinks the ThreadWebSocketHandler public surface.

5. Deleted the thread:open-agent orphan chain — 395 lines of dead code
   with zero client senders:
     - lib/thread/agent-session-handler.js  (167 lines)
     - lib/session/session-loader.js        (164 lines)
     - lib/wire/agent-sessions.js           (64 lines)
     - lib/session/  (empty dir)
   Plus the createAgentSessionHandler wiring in server.js and the
   handleThreadOpenAgent dep in client-message-router.js.

Also: deleted the TicketBoard.tsx thread:open-daily hijack (dead
useEffect that sent a thread message but never consumed the thread —
TicketBoard has no chat UI). ChatArea.tsx and Sidebar.tsx updated to
send thread:open-assistant. Smoke test handler-export list updated.

Pre-prod: existing thread rows + chat files deleted during validation.

Part of SPEC-24 (chat simplification). Phase 24f will do a deep code
sweep to catch any orphans this phase missed.
```

---

## Report back

After you finish, report these to the orchestrator:

1. **Diff stats.** `git diff --stat main` — files changed, lines added/removed. Should show ~400+ lines removed (most of them from the orphan chain deletion), plus scattered small edits.

2. **Validation output.** Paste:
   - The full output of the static grep checks (should be "zero hits" for every stale reference).
   - The `sqlite3 SELECT thread_id, name FROM threads;` result after live-creating at least two threads.
   - The smoke test output.
   - The browser-WS dev-tool trace showing `thread:open-assistant` being sent on both the create path and the resume path, and `wire_ready` firing in both cases.

3. **Actual thread IDs generated.** Paste 2-3 real IDs from your test run. Confirms the format is correct end-to-end.

4. **The nullable-constraint check for `threads.name`.** Paste the migration line. Confirm it does not have `.notNullable()`. If it does, you should have stopped at step 2b and flagged it.

5. **Any surprises.**
   - Unexpected `uuidv4` callers you had to leave alone.
   - Other files that referenced any of the deleted orphans and needed fixup.
   - A TicketBoard edit that needed more than the delete-in-place (e.g., unused import cleanup).
   - Anything in the runner that cracked despite the null check (shouldn't happen — but report if it does).

6. **Any files you touched that weren't in the change list above.** There shouldn't be any. If there are, explain why.

7. **Phase 24f candidates.** Things you noticed during this pass that look like dead code but were out of scope:
   - The `thread:create:confirm` response flow in `Sidebar.tsx:151-162` (server never sends it).
   - The persona-wire notify block in `lib/runner/index.js:115-135` (never fires after orphan deletion).
   - Anything else that smells stale.

Hand the report back to the orchestrator before moving to any other 24x phase.
