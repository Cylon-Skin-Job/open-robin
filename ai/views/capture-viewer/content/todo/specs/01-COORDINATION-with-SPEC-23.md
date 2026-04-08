# SPEC-01 ↔ SPEC-23 Coordination

**Audience:** The Claude chat currently working on SPEC-01 (server.js decomposition).

**Purpose:** SPEC-23 is a parallel refactor (chunking queue + bus-as-spine) that touches the same region of `server.js` you're about to extract. This doc explains the overlap, the impact, and proposes options to avoid duplicating effort.

**What you should do with this doc:** Read it before you start Extract 2 (Wire Message Router). Decide with the user whether to (a) coordinate the two refactors or (b) sequence them. Adjust your extraction plan accordingly.

---

## TL;DR

- SPEC-23 is being scoped in parallel by the user. Master doc: `23-CONTEXT-FORWARD.md`.
- **One sub-spec touches `server.js` directly: SPEC-23a.** Sub-specs 23b through 23f touch other files (harness modules, client code).
- **SPEC-23a's work region IS your SPEC-01 Extract 2 region.** Both touch `server.js` lines 768-1037 (the wire message router, `handleWireMessage`).
- **The two refactors are not in conflict — they're complementary.** SPEC-23a removes duplicated code from that region. SPEC-01 Extract 2 then extracts the cleaner code into its own module.
- **Recommended approach: Combine them into a single coordinated extraction during your SPEC-01 Extract 2 step.** This avoids two passes over the same code and produces the cleanest end state.
- The user is okay with restructuring SPEC-01's plan to accommodate this. They explicitly said: *"We may have to reconsider how we do our refactor so we don't have to duplicate effort here."*

---

## What SPEC-23 is (brief)

SPEC-23 makes the existing `event-bus.js` the spine of the chat render pipeline, on both server and client. The goals:

1. **Server:** Remove the double-emit pattern in `server.js` where chat events are both emitted to the bus AND sent inline via `ws.send()`. Replace with a new `lib/wire/wire-broadcaster.js` module that subscribes to `chat:*` bus events and forwards to clients. This is SPEC-23a.

2. **Server (per-harness):** Each harness module (kimi, qwen, gemini, codex, claude-code) gains a `capabilities` object declaring what its CLI's wire output supports per tool type. Each emits a `renderTier` tag on outgoing events. SPEC-23b. Doesn't touch `server.js`.

3. **Client:** `panelStore.segments` becomes a discriminated union of queue beats (`tool_open`, `tool_chunk`, `tool_close`, `text_chunk`, `collapse_transition`) so the queue depth math becomes correct and pressure attenuation works. SPEC-23c–f. Doesn't touch `server.js`.

The full design is in `DESIGN-chunking-queue.md` and the master orientation is in `23-CONTEXT-FORWARD.md`. Read those if you want the full picture.

---

## Which SPEC-23 sub-specs touch server.js

| Sub-spec | Touches server.js? | Where |
|---|---|---|
| **23a** Bus consolidation + wire-broadcaster | **YES — directly** | Lines 768-1037 (wire message router region). Removes inline `ws.send()` calls for chat events. Adds a new file `lib/wire/wire-broadcaster.js`. |
| 23b Harness tier tagging | No (touches `lib/harness/*`) | Each harness module gains a capabilities matrix and emits `renderTier`. server.js currently imports those modules but the changes are inside the modules. |
| 23c Client panelStore schema | No | Pure client-side change. |
| 23d Render dispatcher + tier renderers | No | Pure client-side change. |
| 23e LiveSegmentRenderer slim-down | No | Pure client-side change. |
| 23f Delete tool-grouper | No | Pure client-side change. |

**Only SPEC-23a is in your blast radius.**

---

## The specific overlap with SPEC-01 Extract 2

### Your Extract 2 plan (from `01-server-js-CONTEXT-FORWARD.md`)

> **Extract 2: Wire Message Router**
> Lines 768-1037 → `lib/wire/message-router.js`
> - `handleWireMessage` with all 10 event type cases
> - Needs: session object (inject), ws (inject), ThreadWebSocketHandler, event-bus `emit`, `checkSettingsBounce`
> - Enforcement hook MUST stay atomic inside the extracted function — do not refactor the bounce return pattern

### SPEC-23a's work in the same region

In the same lines (768-1037), SPEC-23a needs to:

1. **Identify all `ws.send(JSON.stringify({ type: 'turn_begin', ... }))`-style calls** for chat events (turn_begin, content, thinking, tool_call, tool_result, turn_end, status_update, step_begin) — there are roughly 7-10 of them, paired with the existing `emit('chat:*', ...)` calls.
2. **Remove those `ws.send()` calls.** The bus emit is preserved.
3. **Create `lib/wire/wire-broadcaster.js`** that subscribes to `chat:*` events and handles client fan-out, including per-client routing if applicable.
4. **Verify per-client routing.** Today routing is implicit via per-session `ws` closures. The broadcaster needs to know which sessions get which events. This is the biggest gotcha — if you collapse per-client routing to a global broadcast, clients see other users' events.

### What the same code looks like before/after

**Before (today, simplified):**
```javascript
// inside handleWireMessage, ContentPart case (around line 825)
emit('chat:content', { workspace, threadId, turnId, text: payload.text });
ws.send(JSON.stringify({ type: 'content', turnId, text: payload.text }));
```

**After SPEC-23a:**
```javascript
// inside handleWireMessage, ContentPart case
emit('chat:content', { workspace, threadId, turnId, text: payload.text, sessionId: session.connectionId });
// no ws.send — wire-broadcaster handles delivery
```

**Plus a new file:**
```javascript
// lib/wire/wire-broadcaster.js
const { on } = require('../event-bus');

function createWireBroadcaster({ getSessions }) {
  on('chat:content', (event) => {
    const session = getSessions().get(event.sessionId);
    if (session?.ws?.readyState === 1) {
      session.ws.send(JSON.stringify({
        type: 'content',
        turnId: event.turnId,
        text: event.text,
      }));
    }
  });

  // ... same pattern for each chat:* event type
}
```

### Why the overlap is helpful, not harmful

If SPEC-01 Extract 2 happens FIRST (without SPEC-23a), the extracted `lib/wire/message-router.js` will contain both the bus emits AND the `ws.send()` calls — the same double-emit smell, just relocated. SPEC-23a then has to make a second pass over the new file to remove the ws.sends.

If SPEC-23a happens FIRST (without SPEC-01 Extract 2), the cleanup happens inside `server.js` on the unextracted code. SPEC-01 Extract 2 then extracts the cleaner code, which is easier and produces a thinner extracted module.

If they happen TOGETHER, the work is one coordinated pass: in the same edit, you remove the ws.sends, extract the message router into `lib/wire/message-router.js`, AND create the wire-broadcaster. Server.js loses both the duplicated calls AND the message router in one shot. **The extracted message-router.js is dramatically thinner because it doesn't carry the duplicated wire delivery logic.**

---

## Proposed coordination — three options

### Option A: SPEC-23a first, then SPEC-01 Extract 2 (sequential)

**How it works:**
1. The user (or a chat) executes SPEC-23a first. server.js loses ~80-100 lines of `ws.send()` calls. A new `lib/wire/wire-broadcaster.js` is created.
2. SPEC-01 Extract 2 then proceeds on the cleaned-up code. The extracted `lib/wire/message-router.js` is thinner because it doesn't need to carry the wire delivery.

**Pros:**
- Clean separation of concerns. Each spec does its own thing.
- SPEC-01 Extract 2 inherits known-good cleanup work.
- Lower coordination cost between chats.

**Cons:**
- Requires waiting for SPEC-23a before starting Extract 2 (which is item #5 in the SPEC-01 execution order, so the wait probably overlaps with extracts 1, 3, 6 anyway).
- Two passes over the same code.

### Option B: Combine into a single coordinated extraction (recommended)

**How it works:**
1. When the SPEC-01 chat reaches Extract 2, it ALSO does SPEC-23a in the same pass.
2. The extraction produces TWO new files: `lib/wire/message-router.js` (parsing + bus emit) AND `lib/wire/wire-broadcaster.js` (bus subscriber + client fan-out).
3. server.js loses the entire wire message router region (lines 768-1037) plus the duplicated `ws.send()` calls — not just one.

**Pros:**
- Single coordinated change to a fragile region of server.js. Less risk of midway breakage.
- Produces the cleanest end state. Each new module has one job, both under 200 lines.
- Avoids two passes over the same code.
- The SPEC-01 chat is already going to be concentrated on this region during the pairing session — adding the bus consolidation is a small extra commitment.

**Cons:**
- The SPEC-01 chat needs to absorb SPEC-23 context. (Easy: read `23-CONTEXT-FORWARD.md` and `23a-bus-consolidation-wire-broadcaster.md`.)
- The Extract 2 work item grows slightly. Not much — the bus emits already exist; we're removing the parallel ws.send paths and registering a subscriber.

### Option C: SPEC-01 Extract 2 first, then SPEC-23a (current default)

**How it works:**
1. SPEC-01 Extract 2 proceeds as currently planned. The extracted `lib/wire/message-router.js` carries both the bus emits and the duplicated ws.sends.
2. SPEC-23a then operates on the new file: removes the ws.sends, creates the wire-broadcaster.

**Pros:**
- Zero changes to the SPEC-01 plan.
- SPEC-23a has a well-defined target file to operate on.

**Cons:**
- Two passes over the same code.
- The first pass produces an obviously sub-optimal intermediate state.
- Higher risk of regression because the same region gets touched twice.

### Recommendation: Option B

Combine SPEC-23a into SPEC-01 Extract 2. The SPEC-01 chat is already going to be deep in this code during the pairing session. The bus consolidation is mechanically simple (remove parallel ws.sends, register a bus subscriber) and produces a meaningfully cleaner end state. The two extractions complement each other — SPEC-01 separates the message router from server.js, SPEC-23a separates the delivery from the routing.

**The combined extraction produces:**
- `server.js`: loses lines 768-1037 plus the wire-debug logging plus signal cleanup → drops by ~280-300 lines
- `lib/wire/message-router.js`: ~150 lines, one job (parse wire messages, emit to bus, run enforcement)
- `lib/wire/wire-broadcaster.js`: ~80 lines, one job (subscribe to bus, fan out to client sessions)
- Total: server.js shrinks dramatically AND we get two clean modules instead of one fat extracted module

This is the path with the highest signal-to-noise ratio.

---

## Other coordination notes

### SPEC-23b touches harness modules — read this before you do anything to harness/

SPEC-23b will modify each harness module in `lib/harness/` to:
- Add a `capabilities` object declaring what its CLI emits per tool type
- Tag a `renderTier` field on every event payload it emits
- Emit `chat:tool_open` and `chat:tool_close` as their own events (not implied lifecycle of `chat:tool_call`)

SPEC-01 doesn't extract harness modules — they're already separated from `server.js`. **No conflict.** But if SPEC-01 work touches anything that *imports* harness modules, be aware that the event payload shape will gain a `renderTier` field after SPEC-23b. Not a breaking change for SPEC-01 (extra field, not removed field), but worth knowing.

### SPEC-23c–f are pure client-side and don't affect server.js

You can ignore them. They happen in `open-robin-client/`. The only way they'd impact SPEC-01 is if SPEC-01 were also extracting client code, which it isn't.

### `compat.js` and SPEC-11

SPEC-11 (compat.js cleanup) is deferred until after SPEC-01. SPEC-23 doesn't touch compat.js. The compat.js cleanup remains a SPEC-01 follow-up, independent of SPEC-23.

### Per-client routing — verify this in code

The single biggest gotcha for SPEC-23a (and therefore for the combined Option B extraction). Today server.js routes chat events to clients via per-session `ws` closures inside `handleWireMessage`. The bus emits do NOT carry session/client identity. To make the wire-broadcaster route correctly, **the bus emits need to gain a `sessionId` or equivalent field**, AND the broadcaster needs access to the sessions Map.

**Action item for whoever does the combined extraction:** Read every chat-related `ws.send()` call in lines 768-1037 and document:
- (a) Is this a true broadcast (all clients) or per-client routing?
- (b) What identifies the target client? (session.connectionId? threadId?)

Then add the corresponding identity field to the bus emit, and have the broadcaster look up the right session in the sessions Map.

If you don't do this carefully, clients will see events for other users' threads. This is a security concern, not just a UX bug.

### Bus shape vs wire shape

The bus events today have slightly different field names than the wire events. For example:
- Bus: `emit('chat:content', { workspace, threadId, turnId, text })`
- Wire: `ws.send({ type: 'content', turnId, text })`

The wire-broadcaster is responsible for translating bus-shape to wire-shape. **Do not change the wire-shape during this refactor.** Clients depend on the existing wire shape and SPEC-23 explicitly does not touch client deserialization until SPEC-23c. The broadcaster must produce wire messages identical to what clients receive today.

### checkSettingsBounce — preserve atomically

`server.js:886-905`. The settings enforcement check inside `ToolResult`. Must stay atomic — runs after parsing tool args, before saving to history, with break semantics. SPEC-01's existing gotcha #5 already calls this out. SPEC-23a shares this gotcha — the bus emit for `chat:tool_result` happens at line 931, AFTER the bounce check. Preserve that ordering exactly.

---

## Summary action items for the SPEC-01 chat

1. **Read this doc and `23-CONTEXT-FORWARD.md` and `23a-bus-consolidation-wire-broadcaster.md`** before starting Extract 2.
2. **Decide with the user:** Option A, B, or C from above. Recommendation is B.
3. **Audit the per-client routing** in lines 768-1037 (specifically the chat-event ws.send calls). Document whether each is broadcast or per-client. This audit is needed for ANY of the three options.
4. **If Option B:** plan the combined extraction. Two new files, one removal. Sequence: write the broadcaster first, then update server.js to remove ws.sends and add the subscription, then extract the message router, then verify.
5. **If Option A:** wait for SPEC-23a to complete (or do it yourself before Extract 2), then proceed with SPEC-01 Extract 2 on the cleaned code.
6. **If Option C:** proceed as planned, but flag that SPEC-23a will follow.
7. **In all cases:** preserve `checkSettingsBounce` atomicity, preserve middleware ordering, preserve `global.__agentWireSessions` assignment, preserve session closure semantics. SPEC-01's existing gotchas all still apply.

---

## Files referenced

- `23-CONTEXT-FORWARD.md` — SPEC-23 master orientation
- `23a-bus-consolidation-wire-broadcaster.md` — the SPEC-23a sub-spec in detail
- `01-server-js-decomposition.md` — original SPEC-01 spec
- `01-server-js-CONTEXT-FORWARD.md` — SPEC-01 resume doc
- `DESIGN-chunking-queue.md` — full design intent for the chunking queue work (read for the "why")
- `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md` — code standards (one job per file, layer as little as possible, delete don't deprecate)
- `open-robin-server/lib/event-bus.js` — the existing bus
- `open-robin-server/lib/audit/audit-subscriber.js` — the architectural template for wire-broadcaster
