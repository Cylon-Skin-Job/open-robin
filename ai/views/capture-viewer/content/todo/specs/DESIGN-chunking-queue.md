# DESIGN: Chunking Queue — Tool Calls as Meta-Chunks with Internal Items

Captured from voice riff sessions. This is design intent, not an action spec yet.

## Core insight

The pressure/speed queue should see **every structural beat** of rendering as a first-class queue item — including tool open events, each internal chunk, and tool close events. A tool call is a *meta-chunk* with its own internal chunking rules, but those internal chunks must bubble up to the main queue so pressure attenuation can see them.

## Queue items per tool call

For a typical tool like `think` with 5 paragraphs, the queue is:

```
[think_open, para1, para2, para3, para4, para5, think_close, ...next_segment]
```

Queue depth = 7, not 1.

### Open and close are REAL queue items, not internal phases

This is the critical distinction from current code. Today, `shimmer → revealing → collapsing → done` are React component-internal phases inside one segment. That's wrong.

The shimmer (drawing the box, the 200-300ms hold) is already a stall — the queue should see it as a stall. If two paragraphs of text are queued behind a `<think>` event, queueing the think_open as a real chunk means the pending paragraphs see "current chunk + 1 (think_open) + 1 (first thought paragraph) = 2 chunks behind." Pressure correctly perceives the backlog and accelerates.

If the open event is hidden inside a single segment's internal phase machine, the queue depth math is wrong. Pressure thinks there's only one item ahead when there's actually a 200-300ms stall coming.

The same logic applies to close: collapsing the box is its own queue item with its own animation time, not a phase tucked inside the previous chunk.

## Why this matters: pressure attenuation depends on queue depth

- If queue is `[think_open, para1, para2, para3, think_close, text1, text2, ...]`, depth is 7+ → pressure sees backlog → render accelerates
- If queue is `[whole_think_block, text1, text2]`, depth looks like 3 → pressure thinks it's idle → slow render
- **Current suspected bug:** some tools dump the whole tool call as ONE queue item. Defeats the entire purpose of pressure attenuation.

## Speed appraisal happens at chunk-start, not mid-chunk

Reaffirmed from prior feedback. At the beginning of each chunk, the renderer queries pressure (queue depth) and locks the speed for that chunk. No mid-chunk speed shifts. Queue depth is the only input to the speed decision.

The current `LINE_END_HOLD` logic in `reveal/orchestrator.ts:53` violates this — it forces a slower speed for the last 2 chars before `\n` regardless of the chunk's chosen speed. That's mid-chunk speed mutation. Delete it.

## Speed system: content only (resolved)

The existing fast/slow attenuator stays as-is, applied to **text segments and tool content chunks only**. The "two distinct speed profiles for tools" idea is dropped — there's no separate slow/fast profile per tool. Tool open and tool close chunks have **fixed durations**, not queue-depth-driven speed (see next section).

So the speed decision tree is simple:
- **Tool open chunk** → fixed 100ms (see Open/close chunk timing)
- **Tool close chunk** → fixed 100ms (see Open/close chunk timing)
- **Content chunks** (text paragraphs, tool internal chunks) → existing two-speed attenuator, queue-depth driven, appraised at chunk start

## Open/close chunk timing (FINAL)

Fixed durations. Not pressure-driven. These are queue items so the queue depth math is correct, but their duration is hard-pegged.

### Tool open chunk: 100ms
- 100ms opacity fade-in with `ease-out` curve
- 6 frames at 60fps — registers as a transition without ever feeling like a pop
- Below ~80ms it reads as a flicker; 100-120ms is the perceptual sweet spot
- After 100ms elapses, the open chunk releases the queue and the next chunk (first content paragraph, first line, etc.) starts rendering

### Tool close chunk: 100ms
- Kill shimmer
- Wait 100ms
- Collapse the drawer

Same value, same reasoning — the close is the entrance-in-reverse. 100ms keeps it from feeling abrupt without making the user wait.

### What about pure-opacity vs. opacity-plus-transform?

If the open chunk does only opacity, 100ms is fine. If you add scale/translate (e.g., box slides up while fading in), bump to 120-150ms — multiple visual cues need slightly more time to land coherently. **Default to pure opacity at 100ms** unless there's a reason to introduce transform.

### Shadows and blur

Drop shadows and backdrop filters sometimes paint a frame late on slower machines, so the *perceived* appearance moment is when the shadow lands, not when opacity hits full. Either keep the tool block shadow subtle, or pre-render the shadow slightly before starting the opacity ramp so they finish together.

## The "first paragraph renders too fast" suspicion

User suspects the chunking strategy isn't applying to the first paragraph of think segments — they render faster than expected. Worth instrumenting before fixing. Possible causes:

- First chunk has no `nextChunkReady` predecessor in the buffer, but `speedFast` may still be picked due to a race in `orchestrateReveal` where the buffer fills before the first `typeChunk` call
- The `skipShimmer` flag for the first segment after orb may be cascading into the content reveal somehow
- The `instantReveal` shortcut may be triggering for short first paragraphs

**Action:** add a console log at chunk start in `orchestrateReveal` showing queue depth + chosen speed for the first 3 chunks of the first think segment. Then we'll know.

## Collapse-on-transition chunks for groupable tools (NEW DESIGN MOVE)

This is the cleanest part of the second riff. Replaces the entire `tool-grouper.ts` two-layer state machine with queue-level synthetic chunks.

### The model

Reads, fetches, globs, greps render as **individual queue items** — one per call. Each one shimmers and waits for its result chunk to arrive, then renders, then waits for the next.

When a run of same-type calls ends (next call is a different type, or a non-tool segment arrives), the queue receives a **synthetic collapse-transition chunk**. This chunk's render IS the collapsed dropdown view: it pulls all the prior same-type calls in the run, replaces them with a single line `(read 8 files)` or `(3 files read)`, and the dropdown holds the individual reads inside.

### The rule (catalog-driven)

Per-tool catalog field, e.g. `collapseOnTransition: true`:

```
if (currentTool.collapseOnTransition
    && prevSegment.type === currentTool.type
    && nextSegment.type !== currentTool.type) {
  insert collapseTransitionChunk(prevRunSegments) into queue
}
```

The transition detection lives as a catalog entry, NOT as hardcoded logic in `tool-grouper.ts` or `ws-client`. New collapsable tool types just add the field.

### Why this is better than the current grouper

- Deletes the hidden module-level state in `tool-grouper.ts` (`activeGroup`, `toolCallMap`)
- No more "grouping happens at wire layer, segments are pre-collapsed" — segments stay flat
- Pressure attenuation sees real queue depth (5 reads + 1 collapse chunk = 6 items, not "one grouped read segment")
- Each individual read can have its own shimmer / hold / minimum render time
- Symmetric with thinking: open chunk + content chunks + close/collapse chunk

### Symmetry

| think | read run |
|---|---|
| `think_open` (draw box, shimmer) | `read_1_open` (draw box, shimmer) |
| `para_1`, `para_2`, ..., `para_n` (content) | `read_2_open`, `read_3_open`, ... |
| `think_close` (collapse box) | `reads_collapse` (transition: replace with summary line + dropdown) |

The closing event in both cases is a queue item that takes time and animates.

## Per-tool minimum hold / shimmer-until-next

Each tool can declare a minimum render time. The pattern from the riff:

> "We can have a transition for read where it appears and shimmers until the next chunk is ready, with a minimum of 200 ms or whatever sounds good."

This means: a read renders its open chunk (shimmer), then HOLDS the shimmer until either:
1. The next queue chunk is ready (next read, or the collapse-transition, or whatever)
2. A minimum hold time has elapsed (e.g., 200ms)

Whichever is later. This pegs each read to "the moment the next thing is available," giving the queue a natural rhythm and keeping reads from popping in faster than the eye can follow.

Catalog field, e.g. `minHoldMs: 200` or `holdUntilNext: true`.

## Render fidelity is wire-driven, not type-driven

Different CLIs emit different richness for the same tool type. Kimi streams rich tokens for an edit (the diff content character-by-character). Another CLI might just announce "edited file X" with no diff payload. The renderer should adapt to **what the wire actually delivers**, not assume every `edit` segment can be rendered as a diff.

### The fallback ladder

For each tool type, declare a render ladder from richest to minimum viable. The renderer picks the highest tier the wire payload supports.

Example for `edit`:
1. **Rich (Kimi):** Full diff with red/green line coloring, streamed line-by-line
2. **Basic:** Filename + "edited" + line count, no diff content
3. **Minimum viable:** Just the filename — same as a `read` summary

If the wire payload has the diff text, render tier 1. If it only has the file path, fall through to tier 3. The catalog entry declares the ladder; the runtime payload picks the tier.

### Why this matters

Kimi is the only CLI today that gives rich wire output for tools (diffs, file content, live shell output). Other CLIs (Qwen, Gemini, Codex, Claude Code via ACP) emit much sparser tool data — sometimes just "tool was called" with no payload. Hardcoding "edit always renders as diff" breaks for every non-Kimi CLI.

Treating render fidelity as wire-driven means:
- Kimi sessions show rich, animated diffs and shell streams
- Sparser CLIs gracefully fall back to read-style minimal summaries
- We don't have to fork the catalog per CLI
- Adding a new CLI just means: hook up the wire, see what it gives us, and the renderer auto-adapts

### Read as the universal floor

The minimum viable render for ANY tool is the read pattern: show the target (file path, URL, command name) on one line, collapsed, with a small icon. If a tool's wire payload is sparse, fall back to this. It's the lowest-common-denominator that always works.

### Diff streaming (when payload IS rich)

Even when the diff payload is fully present, diffs still need full context for coloring (you can't color half a diff correctly mid-stream). So the diff render is the **wholeBlock-with-placeholder** pattern: tool open chunk shows the placeholder, the diff content arrives in the background, and once complete, the diff snaps in fully colored. The placeholder occupies the queue slot. This is acceptable because:
- Diffs are usually rare in a response
- If every tool call IS a diff, that's actually a code-edit-heavy task and the user expects it
- The placeholder itself can be the filename + "editing..." which is informative

### Tier authority lives in the CLI interpreter, not the renderer

The cleanest place to decide the render tier is the **per-CLI interpreter** — the sub-module that translates between the Universal Language and the CLI's wire format. Each CLI gets one interpreter that handles both directions:

- **Inbound:** parse CLI wire output → emit canonical segments into the universal queue
- **Outbound:** take canonical instructions → format for the CLI's expected input

The interpreter is the only thing that *knows* what its CLI emits for each tool type. So the interpreter is the right place to declare or detect the render tier.

### How it works

As each tool segment passes through the interpreter on its way into the universal queue, the interpreter **tags the segment with a `renderTier`** field. The renderer downstream is dumb — it reads `segment.renderTier` and looks up the matching tier renderer in the catalog. No predicate walking. No runtime detection in the render path.

```
wire bytes
  ↓
CLI interpreter (per-CLI sub-module)
  ↓
canonical segment { type: 'edit', renderTier: 'rich', payload: {...} }
  ↓
universal queue
  ↓
renderer reads renderTier, picks tier-specific render function from catalog
```

### Two declaration styles

Interpreters can declare tier in two ways:

1. **Static capability matrix** — module-level variable. The interpreter knows its CLI always emits rich data for edits, never emits anything useful for thinking, etc.
   ```ts
   // kimi-interpreter.ts
   export const capabilities = {
     edit: 'rich', shell: 'rich', think: 'rich', read: 'rich', ...
   };
   ```
   ```ts
   // qwen-interpreter.ts (ACP)
   export const capabilities = {
     edit: 'minimum', shell: 'basic', think: null, read: 'minimum', ...
   };
   ```

2. **Per-call dynamic** — the interpreter inspects each individual tool call's payload and tags accordingly. Used when the same CLI sometimes emits rich data and sometimes doesn't (e.g., a CLI that streams diffs for small files but only summaries for large ones).

Most CLIs will use the static matrix. Dynamic is the escape hatch.

### Catalog responsibility shrinks

The catalog stops being responsible for *deciding* the tier. It only declares the *renderers* for each tier:

```ts
// catalog entry for edit
{
  type: 'edit',
  tags: ['Edit', 'edit'],
  tierRenderers: {
    rich: richDiffRenderer,    // streaming red/green
    basic: basicEditRenderer,  // filename + line count
    minimum: readRenderer,     // shared with read tool
  },
}
```

The minimum tier renderer is literally `readRenderer` — shared across all tools. The catalog only needs to define the higher tiers.

### Why this is better than runtime predicates

- **Knowledge lives where it's known.** The interpreter is the only thing that sees raw wire output and knows what its CLI quirks are. Runtime predicates duplicate that knowledge in the catalog.
- **No predicate walking.** Renderer becomes O(1) — read field, look up renderer, call it.
- **Per-CLI evolution is contained.** When a CLI updates its wire format and starts emitting richer data, you update one capability variable in one interpreter. No catalog changes.
- **Tier becomes part of the canonical segment shape.** It travels with the segment through the queue, into the store, into history replay. Re-rendering historical segments doesn't require re-running predicates against payloads that may have been simplified.
- **Connects to the existing "universal wire protocol" todo.** The interpreter pattern is the same one called for in the wiki's *"Universal send/receive syntax — Define a clean canonical send() that goes through each harness interpreter. Each module converts to CLI-specific wire format outbound and back to canonical format inbound."* This design uses the same interpreter sub-module to also carry tier information.

### Segment shape addition

```ts
interface CanonicalSegment {
  type: SegmentType;          // 'edit', 'read', 'think', etc. (universal)
  renderTier: 'rich' | 'basic' | 'minimum' | null;  // set by interpreter
  payload: unknown;           // tier-specific shape, opaque to queue
  toolCallId?: string;
  // ... existing fields
}
```

Note: `payload` shape varies by tier. The catalog's tier renderer knows how to read its own tier's payload shape.

## Implementation order (per riff)

1. **Nail thinking first.** Get think to emit `[think_open, para_1, ..., para_n, think_close]` as real queue items. Open chunk has its own minimum render time. Speed is appraised at the START of each paragraph chunk based on queue depth. Verify the first-paragraph "too fast" suspicion is fixed.
2. **Then port the model to other tools** — shell, subagent, todo (line-based, similar shape).
3. **Then the read/fetch/glob/grep family** with the collapse-on-transition catalog field. This is when `tool-grouper.ts` becomes obsolete or shrinks dramatically.
4. **Then write/edit (diff tools)** as the wholeBlock-with-placeholder special case.

## Known incomplete state

- Only 2-3 tool types have their internal chunking schemas properly defined
- Other tools are placeholder code or copies of earlier tool modules, mutated over time without being completed
- The catalog's `createStrategy` field exists but `lineStreamReveal` ignores it and hardcodes `createLineBreakParser()` for everyone — that's why "every tool chunks the same" today
- `tool-animate.ts` builds an adapter from the catalog strategy but the adapter is discarded when calling `revealController.run()`

## Implied action items (cross-reference for future spec)

1. **Audit each tool type:** does it emit multiple queue items or collapse to one?
2. **Make open and close events first-class queue items** in the segment store — not just phases inside one segment. This is a panelStore schema change.
3. **Verify pressure calculator sees inflated queue depth** when a tool has many internal chunks.
4. **Define each tool's internal chunk boundary rule explicitly** in its catalog entry. Stop hardcoding `createLineBreakParser()`.
5. **Wire the existing strategy/adapter pipeline** in `tool-animate.ts:createAdapter` into the reveal loop.
6. **Add catalog field `collapseOnTransition`** for read/fetch/glob/grep family. Implement queue-level collapse-transition chunk insertion.
7. **Add catalog field `minHoldMs` / `holdUntilNext`** for shimmer-until-next behavior on individual tool calls.
8. **Delete `LINE_END_HOLD` mid-chunk speed shift** in `orchestrator.ts:53`.
9. **Instrument first-chunk speed** to debug the "first paragraph renders too fast" suspicion.
10. ~~Decide on the "two render speeds" question~~ — **resolved.** Two-speed attenuator applies to content chunks only. Open/close are fixed at 100ms.
11. **Once collapse-on-transition is wired:** delete or shrink `tool-grouper.ts` and its hidden module-level state.
12. **Per-tool catalog declares tier renderers**, not predicates. `tierRenderers: { rich, basic, minimum }`. Minimum tier reuses the shared `readRenderer`.
13. **Each CLI gets an interpreter sub-module** that translates Universal Language ↔ CLI wire format. The interpreter tags each canonical segment with `renderTier` as it passes through. Most CLIs declare a static capability matrix; per-call dynamic detection is the escape hatch.
14. **Audit each CLI's wire output per tool type.** Used to populate the static capability matrices in each interpreter. This audit is the same one needed for the broader ACP harness debugging work blocked behind server.js refactor.
15. **Add `renderTier` field to the canonical segment shape.** Travels with the segment through queue, store, and history replay. Renderer reads the field and dispatches to the catalog's tier renderer.
16. **Connect this to the existing "universal send/receive syntax" todo.** The interpreter pattern is the same one — this design extends it to also carry tier information. See `ai/views/wiki-viewer/content/project/wire-protocol/PAGE.md`.

## Related memory / docs

- Feedback memory: *"Speed set ONCE per block at boundary, never mid-block. Queue depth is the input. Text loop needs cursor-forward rewrite."* — this design intent is the queue-granularity half of that rule.
- Project memory: `project_chunking_queue_intent.md` (condensed pointer to this doc).
- See `open-robin-client/src/lib/tool-animate.ts` — adapter is built but discarded.
- See `open-robin-client/src/lib/reveal/line-stream.ts` — hardcodes `createLineBreakParser()` for all tool types.
- See `open-robin-client/src/lib/catalog.ts` — `createStrategy` field is cosmetic in current wiring.
- See `open-robin-client/src/lib/tool-grouper.ts` — to be obsoleted by collapse-on-transition design.
