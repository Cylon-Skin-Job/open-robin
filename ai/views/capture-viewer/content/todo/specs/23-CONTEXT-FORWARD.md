# SPEC-23 Context Forward — Chunking Queue + Bus-as-Spine Refactor

This document is the resume-from-cold context for SPEC-23. Any chat picking up this work — fresh, mid-session, or coordinating across instances — should read this entire file before touching code.

This is a CONTEXT-FORWARD doc modeled on `01-server-js-CONTEXT-FORWARD.md`. It's the master orientation. Sub-specs (23a through 23f) define the actual work units.

---

## Why this exists

User has been trying to fix the chat renderer for an extended period. Every previous attempt collapsed into either spaghetti or half-finished work because the system itself was unclear: too much in one file, hidden state, dead code paths, and an architecture that drifted from the documented standards.

This refactor is the user's frustration crystallized into a plan. The goal is not "fix the chat renderer." The goal is to **build a pluggable modular system** where adding a new harness takes 5 minutes instead of 5 hours, and where the chat render pipeline is an honest end-to-end flow you can trace start to finish without spelunking.

**User's exact framing:** *"This is exactly what I want. The next time I come to add a harness, it should take fucking five minutes and not five hours. We build this once, and we pull all the concerns into separate files, and we finally have a pluggable modular system where this bullshit debug stuff goes away."*

---

## What this refactor achieves

Five concrete outcomes:

1. **Event bus becomes the spine.** `open-robin-server/lib/event-bus.js` is already carrying nearly the full `chat:*` event stream (turn_begin, content, thinking, tool_call, tool_result, turn_end, status_update). Today server.js does double work — it emits to the bus AND sends to WebSocket clients in two separate code paths. After this refactor, server.js emits to the bus exactly once. A new `wire-broadcaster` module subscribes to the bus and handles client fan-out. This is the clean separation between event flow and transport.

2. **Tool calls become meta-chunks with first-class queue items.** Today, a tool call is one segment in `panelStore.segments[]` whose lifecycle (open/streaming/close) is implied via React component-internal phases. After this refactor, a tool call expands into multiple queue items: `tool_open`, content chunks (one per paragraph/line), and `tool_close`. The shimmer/draw-box phase (200-300ms today) is itself a queue item. This makes pressure attenuation math correct — the queue depth reflects real backlog, not lies.

3. **Render fidelity is wire-driven via tier tags.** Each per-CLI harness module (which already exists as the interpreter) tags every emitted segment with a `renderTier: 'rich' | 'basic' | 'minimum'` based on what the CLI's wire payload provides. Kimi tags everything `'rich'`. Sparser CLIs (Qwen, Gemini, Codex, Claude Code via ACP) tag what they can support and fall back to `'minimum'` (read-style summary) for what they can't. The catalog declares per-tool tier RENDERERS, not predicates. The dispatcher reads the tier tag and calls the matching renderer. No runtime predicate walking, no per-CLI catalog forks.

4. **Collapse-on-transition replaces the grouper.** `tool-grouper.ts` (177 lines of hidden module-level state) gets deleted. Reads/fetches/globs/greps render as individual queue items. When the tool type transitions (prev=read, next≠read), the queue receives a synthetic `collapse_transition` chunk whose render IS the dropdown summary line. Catalog field: `collapseOnTransition: true`. The grouping source-of-truth becomes a flat queue with synthetic transition events.

5. **Open and close timing is fixed at 100ms hard.** The two-speed attenuator (queue-depth driven) applies to content chunks only. Tool open and tool close are 100ms hard fade (perceptual sweet spot — never reads as a pop, never feels deliberately animated). This kills the `LINE_END_HOLD` mid-chunk speed shift and makes the timing model predictable.

---

## Current state of the chat render pipeline

Read these files in this order to understand the existing mess. Cited line numbers are accurate as of the last full read.

### Server side

| File | Purpose | Notes |
|---|---|---|
| `open-robin-server/lib/event-bus.js` | Universal event bus (Node EventEmitter) | Already carries `chat:*` events. Header explicitly says it's NOT the core flow wiring — but it's about to become it for chat. |
| `open-robin-server/server.js` (lines 768-1037) | Wire message router — handleWireMessage with 10 event types | Where chat:* emit calls live. **Overlaps with SPEC-01 Extract 2** — see `01-COORDINATION-with-SPEC-23.md`. |
| `open-robin-server/server.js` lines 802, 825, 842, 868, 931, 961, 993 | The chat:* emit calls | These are PARALLEL to ws.send() calls in the same area — that's the double-emit smell. |
| `open-robin-server/lib/harness/kimi/index.js` | Kimi harness (interpreter for Kimi wire output) | Already emits chat:turn_end and chat:status_update. Will gain tier tagging in SPEC-23b. |
| `open-robin-server/lib/harness/clis/{qwen,codex,gemini,claude-code}/index.js` | ACP harnesses (partially broken) | Each emits chat:turn_end + chat:status_update. Tier tagging will be added per-CLI in SPEC-23b. |
| `open-robin-server/lib/audit/audit-subscriber.js` | Audit log subscriber | Already a bus subscriber. Lives next to where wire-broadcaster will live. Use this as the architectural template. |

### Client side

| File | Purpose | Notes |
|---|---|---|
| `open-robin-client/src/state/panelStore.ts` | Zustand store, holds `segments: StreamSegment[]` | THE schema change happens here. Today: one entry per tool call, lifecycle implicit. After: discriminated union with `kind: tool_open \| tool_chunk \| tool_close \| text_chunk \| collapse_transition`. |
| `open-robin-client/src/types/index.ts` (lines 12-23) | StreamSegment type definition | Replace with discriminated union. |
| `open-robin-client/src/components/LiveSegmentRenderer.tsx` (418 lines) | Two-phase render (orb → segments) with phase state machine | Slim down to ~80 lines. Keep ONLY the completion-detection effect (load-bearing, spec-13 protected). Move animation orchestration out. |
| `open-robin-client/src/components/InstantSegmentRenderer.tsx` | History replay renderer | Today does its OWN grouping via `groupSegments()`. After: walks the flat queue (collapse beats already baked in). |
| `open-robin-client/src/components/ToolCallBlock.tsx` | The visual tool block | Largely unchanged. The dispatcher feeds it pre-rendered HTML per chunk. |
| `open-robin-client/src/lib/catalog.ts` | Pipeline catalog (one entry per tool type) | Today: declares `createStrategy` + `renderer` + `revealController`. After: declares `tierRenderers: { rich, basic, minimum }`. The `createStrategy` field is currently cosmetic — the strategy is built and discarded in `tool-animate.ts`. |
| `open-robin-client/src/lib/tool-animate.ts` | Reveal orchestration for tool segments | Currently builds an adapter from the catalog strategy and DISCARDS it (line 60-68). The reveal controller hardcodes its own parser. The pipeline that would make this work is half-built. SPEC-23d wires it properly. |
| `open-robin-client/src/lib/reveal/orchestrator.ts` | Shared reveal engine | Has the O(N²) bottleneck — `setDisplayed(contentRef.current.slice(0, charCursor))` re-formats the whole string every tick. `LINE_END_HOLD` at line 53 is mid-chunk speed shift — delete it. |
| `open-robin-client/src/lib/tool-grouper.ts` (177 lines) | Two-layer grouping state machine | DELETE in SPEC-23f after collapse-on-transition is wired. Hidden module-level state, fragile. |
| `open-robin-client/src/lib/segment-renderers/` (113 lines) | Old per-tool segment renderers | DEAD CODE — referenced only by catalog `renderer` field which is never called. DELETE in SPEC-23d. |
| `open-robin-client/src/lib/tool-renderers/*.ts` | Per-tool presentation modules (think, edit, read, etc.) | These STAY but get refactored as tier renderers (rich tier specifically). New tier-renderers folder for basic/minimum tiers. |

### The bottleneck

For an N-line tool output, the current code does roughly `1 + 2 + 3 + ... + N = O(N²)` line operations because `formatContent` re-runs on the whole accumulated string every render tick. Plus `dangerouslySetInnerHTML` rebuilds the entire DOM subtree per tick. For long shell outputs or large file writes, this is the wallclock cost.

The fix is in SPEC-23d: the strategy/adapter pipeline emits one chunk at a time, the tier renderer formats one chunk to HTML, the dispatcher appends to a growing buffer (or DOM-level append), and the whole-string reformat goes away. The architecture for this is already half-built — the modules exist (`chunk-strategies/active/`, `tool-animate.ts:createAdapter`), they just aren't wired into the reveal loop.

---

## Sub-spec breakdown

| Sub-spec | Title | Server/Client | Risk | Depends on |
|---|---|---|---|---|
| **23a** | Server bus consolidation + wire-broadcaster extraction | Server | Low | — |
| **23b** | Harness tier tagging + open/close events + capability matrices | Server (per-harness) | Medium | 23a |
| **23c** | Client panelStore queue schema migration | Client | High | 23b |
| **23d** | Render dispatcher + tier renderers + wire existing strategy/adapter | Client | Medium | 23c |
| **23e** | LiveSegmentRenderer slim-down to completion detection only | Client | Medium | 23d |
| **23f** | Delete tool-grouper, finalize collapse-on-transition, dead code sweep | Server + Client | Low | 23b, 23c |

### Dependency graph

```
23a (server bus consolidation)
   ↓
23b (harness tier tagging) ← only one that touches harness modules; per-CLI fan-out possible
   ↓
23c (panelStore schema change)
   ↓
23d (render dispatcher + tier renderers)
   ↓
23e (LiveSegmentRenderer slim-down)

23f (delete tool-grouper, dead code) ← can run in parallel with 23e once 23c is done
```

23a and 23b are server-side and can be sequenced first. 23c-e are client-side and run after server emits the new event shape. 23f cleans up at the end.

---

## Critical invariants that must NOT break

Carry these through every sub-spec. Each one has bitten previous attempts.

### 1. Completion detection effect — load-bearing
`LiveSegmentRenderer.tsx:103-123`. The `useEffect` watching `[revealedCount, segments.length, onRevealComplete]` with the `finalizedRef` guard. **Do not move this into a callback.** Past bug: callback-based completion detection hangs forever when all segments finish before `turn_end` arrives, because nobody re-triggers the check. The effect-based approach re-evaluates on every input change. Spec-13 explicitly forbids splitting LiveSegmentRenderer for this reason. SPEC-23e SHRINKS LiveSegmentRenderer (moves animation orchestration out, keeps the effect) — that's allowed. Splitting the effect itself is not.

### 2. Tool grouper interleaving correctness
Today `tool-grouper.ts:39-46` uses a two-layer structure (activeGroup + toolCallMap) specifically to handle the case where thinking/content tokens interleave between `tool_call` and `tool_result`. Past bug: single `group` variable lost the group on interleave, tool_result fell to a non-grouped path and dumped full file contents as segment content. SPEC-23f deletes tool-grouper but **the collapse-on-transition logic that replaces it must handle the same interleaving correctness.** When tool calls of the same type are separated by non-tool content (text, thinking), the collapse decision must still be made correctly at type boundaries. Test this explicitly.

### 3. checkSettingsBounce enforcement placement
`server.js:886-905`. Inside the `ToolResult` event handler. Runs after parsing tool args but before saving to history. **Must stay atomic.** If extracted with middleware in between, the `break` semantics change and bounced tools get saved to history anyway. SPEC-23a touches this region of server.js — preserve the enforcement hook position exactly.

### 4. Session object closure scope
`server.js:669`. The per-WebSocket `session` object is captured by 5 inner functions. Any extraction must inject session as an explicit parameter, not capture by closure. SPEC-23a's wire-broadcaster doesn't directly touch this, but moving emit calls might inadvertently. Be careful.

### 5. `global.__agentWireSessions` assignment
`server.js:185-186`. Read by the runner module. Easy to forget during extraction. Grep for it after every server-side change.

### 6. Middleware ordering
`express.static` MUST come before SPA fallback. Don't reorder during refactor.

### 7. Past bug: ws-client setPendingTurnEnd
If not cleared on `turn_begin`, new turns finalize immediately. SPEC-23a doesn't touch this directly but it's worth flagging because the broadcaster will be the one triggering turn_begin on the client side.

---

## Coordination with SPEC-01

**Read:** `01-COORDINATION-with-SPEC-23.md` in this same folder.

Short version: SPEC-23a touches `server.js` lines 768-1037, which is the same region as SPEC-01's Extract 2 (Wire Message Router). The two refactors should be coordinated so we don't extract the same code twice. Coordination doc proposes specific options.

---

## Success criteria

The refactor is done when ALL of these are true:

- [ ] `server.js` no longer contains inline `ws.send()` for chat events. All chat events flow through the bus.
- [ ] A new `lib/wire/wire-broadcaster.js` module subscribes to `chat:*` and forwards to clients.
- [ ] Each harness module declares a `capabilities` object and tags `renderTier` on every emitted event.
- [ ] `chat:tool_open` and `chat:tool_close` are emitted as their own events, not implied by `chat:tool_call` lifecycle.
- [ ] `panelStore.segments` is a discriminated union with `kind` field. Each tool call expands to multiple entries.
- [ ] `LiveSegmentRenderer.tsx` is under 100 lines and contains only: state subscription, render dispatch, completion-detection effect.
- [ ] The render dispatcher reads `kind + type + renderTier` and dispatches to a tier renderer in O(1).
- [ ] Tier renderers are pure functions: `(payload) → HTML`. No state, no React.
- [ ] `tool-grouper.ts` is deleted. Grouping is done via `collapse_transition` queue items.
- [ ] `segment-renderers/` folder is deleted.
- [ ] `LINE_END_HOLD` mid-chunk speed shift is deleted from `reveal/orchestrator.ts`.
- [ ] Adding a new harness is a 5-minute job: copy an existing harness module, declare its capability matrix, register it. Zero changes to renderer, dispatcher, catalog, or panelStore.
- [ ] The "first paragraph renders too fast" suspicion is debugged and either fixed or confirmed not a bug.
- [ ] Existing chat works end-to-end with Kimi after every sub-spec completes.

---

## Files this refactor will create

```
open-robin-server/
  lib/
    wire/
      wire-broadcaster.js          ← NEW (SPEC-23a) — bus subscriber + WS fan-out
    harness/
      kimi/
        capabilities.js            ← NEW (SPEC-23b) — capability matrix module
      clis/
        qwen/capabilities.js       ← NEW (SPEC-23b)
        gemini/capabilities.js     ← NEW
        codex/capabilities.js      ← NEW
        claude-code/capabilities.js ← NEW

open-robin-client/
  src/
    state/
      panelStore.ts                ← MODIFIED (SPEC-23c) — discriminated union queue
    types/
      queue-beat.ts                ← NEW (SPEC-23c) — discriminated union types
    lib/
      render-dispatcher.ts         ← NEW (SPEC-23d) — kind + tier → renderer dispatch
      queue-iterator.ts            ← NEW (SPEC-23d) — walks queue, advances cursor
      tier-renderers/
        edit-rich.ts               ← NEW (SPEC-23d)
        edit-basic.ts              ← NEW
        write-rich.ts              ← NEW
        write-basic.ts             ← NEW
        shell-rich.ts              ← NEW
        shell-basic.ts             ← NEW
        think-rich.ts              ← NEW
        read-rich.ts               ← NEW
        (minimum tier reuses readRenderer — no new files)
    components/
      LiveSegmentRenderer.tsx      ← MODIFIED (SPEC-23e) — slimmed to ~80 lines
      InstantSegmentRenderer.tsx   ← MODIFIED (SPEC-23f) — walks flat queue
```

## Files this refactor will delete

```
open-robin-client/src/lib/segment-renderers/      (entire folder, SPEC-23d)
open-robin-client/src/lib/tool-grouper.ts          (SPEC-23f)
open-robin-client/src/lib/reveal/orchestrator.ts:53 (LINE_END_HOLD only, SPEC-23d)
```

---

## Open questions to resolve before starting

1. **Coordination with SPEC-01.** The user is also working on SPEC-01 in another chat. Read `01-COORDINATION-with-SPEC-23.md` before SPEC-23a starts. The recommended approach: combine SPEC-23a's bus consolidation INTO SPEC-01 Extract 2 (Wire Message Router) so the refactor happens in one coordinated pass on those lines.
2. **`lastReleasedSegmentCount`.** Today `panelStore` tracks this as part of turn finalization. After the schema change, "released segment count" needs to be reinterpreted as "released queue beat count." Worth a quick design check during SPEC-23c.
3. **`InstantSegmentRenderer` migration timing.** Today it has its own `groupSegments()` logic that re-collapses segments at replay time. After SPEC-23c, should we (a) update InstantSegmentRenderer immediately to walk the new flat queue, or (b) leave it on the old shape and write a `oldShapeAdapter` for history? Option (a) is cleaner; option (b) is safer for shipping mid-migration. Decide during SPEC-23c.
4. **Audit of each CLI's wire output.** SPEC-23b needs to know what each CLI actually emits per tool type to populate the capability matrices. This audit hasn't been done. It can either be a prerequisite task (document everything first, then code) or interleaved (document one CLI, code its capabilities, repeat). The user's preference is unclear.
5. **Keep or rewrite `reveal/orchestrator.ts`.** Today it has the O(N²) bottleneck baked in (`setDisplayed(contentRef.current.slice(0, charCursor))`). SPEC-23d wires the existing strategy/adapter pipeline, but the orchestrator may need surgical changes too — specifically, `setDisplayed` should accept HTML chunks and append, not raw text and slice. Decide: minor surgery vs. rewrite.

---

## Related docs

- `DESIGN-chunking-queue.md` — design intent captured during the riff sessions. Read this for the "why" behind the architectural decisions. Long but rich.
- `01-server-js-decomposition.md` — original SPEC-01 spec
- `01-server-js-CONTEXT-FORWARD.md` — SPEC-01 resume doc, modeled this file on it
- `01-COORDINATION-with-SPEC-23.md` — coordination doc for the SPEC-01 chat
- `00-INDEX.md` — full audit spec index
- `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md` — code standards. **Read before writing any code.** One job per file, layer as little as possible, delete don't deprecate.

## Related memories (load when resuming)

- `project_chunking_queue_intent.md` — condensed design intent
- `feedback_surface_standards_proactively.md` — pull code-standards into context at start of any structural work
- `feedback_text_typing_rules.md` — speed set once per block at boundary, queue depth is input
- `project_harness_migration_state.md` — Kimi works (wire), ACP harnesses partially broken
- `feedback_one_file_one_thing.md` — max modularity is AI-safety
- `feedback_no_architecture_decisions.md` — AI implements within documented patterns; never makes architecture decisions

---

## How to resume from this document

After compacting or in a new chat:
1. User references this file: `ai/views/capture-viewer/content/todo/specs/23-CONTEXT-FORWARD.md`
2. Read this entire file before touching code
3. Read `DESIGN-chunking-queue.md` for the "why"
4. Read the relevant sub-spec (23a, 23b, etc.) for the work unit you're claiming
5. Read `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`
6. Verify line numbers in this doc are still accurate (run `wc -l` and spot-check)
7. Check `01-COORDINATION-with-SPEC-23.md` if you're touching server.js
8. Ask the user any of the open questions above that aren't resolved
9. Start work
