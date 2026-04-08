# Chunk Rendering Fix Spec

## Core Principle

**Nothing preemptively bypasses the queue.** The queue is the single authority for what renders and when. There is no flush. There is no shortcut. Every character goes through the typing loop. Every block completes its full lifecycle before the next one starts.

## Terminology

- **Block**: A top-level queue item — TextBlock, CodeBlock, CollapsibleBlock, OrbBlock, InlineToolBlock.
- **Sub-chunk**: A piece of content within a block, bounded by rendering boundaries. A paragraph, a code line, a list item. This is the atomic unit of both rendering and cadence.
- **Stream-complete**: All tokens have been received from the server, OR a `write` tool block has finished its full rendering lifecycle. This signals a backlog — content is waiting. Flips acceleration to fast (1ms).
- **Turn-complete**: All blocks have finished their full lifecycle (typing, pauses, collapse animations, advanceBlock). The queue is drained. `activeBlockId` is `null` with no more blocks queued. Resets acceleration to default (3ms). This is NOT when tokens stop arriving — that's stream-complete.

## The Typing Loop

All three content blocks (TextBlock, CodeBlock, CollapsibleBlock) use the same chase loop. Content is typed **character by character**, organized into **sub-chunks**.

### The sub-chunk is the cadence; the cadence is the sub-chunk

A sub-chunk is a self-contained module. It has its own cadence lifecycle:

1. **Identify** the next sub-chunk boundary in available content
2. **Type** the sub-chunk character by character:
   - First 10 chars: **6ms** per char
   - Chars 11+: **3ms** per char (or **1ms** when accelerated)
3. **Sub-chunk complete** → **300ms pause** → cadence resets
4. **Next sub-chunk** → repeat from step 1

When a sub-chunk's render starts, the cadence is 6ms. At the 10th character, it flips to the fast speed. When the sub-chunk's render finishes, the cadence resets. The render and the cadence share the same boundaries because they are the same thing.

### Sub-chunk Boundaries

**Text** (TextBlock, CollapsibleBlock):
- Paragraph break: `\n\n`
- Line before a header: `\n` followed by `# `
- Line before a list item: `\n` followed by `- `, `* `, or `1. `
- Plain newline: `\n`
- **Formatting safety**: Do not break at a boundary if `**` or `` ` `` markers are unbalanced. Keep typing through until formatting closes, then break at the next boundary.
- **Stall safety**: If 500+ chars accumulate with no valid boundary, break at the last word boundary.

**Code** (CodeBlock):
- Newline: `\n` — each line is a sub-chunk.

### Acceleration Variable

A shared variable on the queue, readable by all typing loops, controls the fast portion of the cadence:

- **Default**: `fastDelay = 3` (cadence is 6-3)
- **On stream-complete** → flip to `fastDelay = 1` (cadence becomes 6-1)
  - Triggered by: all tokens received from server (`endTurn()`), OR a `write` tool block finishing its full lifecycle
  - Both mean the same thing: there's a backlog of content waiting to render
- **On turn-complete** → reset to `fastDelay = 3`
  - Triggered by: last block calls `advanceBlock()`, `activeBlockId` goes to `null`, no more blocks queued
  - The queue is fully drained, all lifecycles are done

### Pseudocode

```
charsSinceBoundary = 0
idx = 0
nextBoundary = findNextBoundary(content, 0)

while true:
  content = liveBlock.current.content

  if idx < content.length:
    // Cadence: 6ms for first 10 chars of sub-chunk, then fast
    delay = (charsSinceBoundary < 10) ? 6 : sharedFastDelay
    sleep(delay)
    idx++
    charsSinceBoundary++
    setCharIndex(idx)

    // Did we just finish a sub-chunk?
    if idx >= nextBoundary:
      sleep(300)                             // breathe between sub-chunks
      charsSinceBoundary = 0                 // cadence resets
      nextBoundary = findNextBoundary(content, idx)

  else if liveBlock.current.complete:
    done — transition to post-type state

  else:
    sleep(16)                                // content still streaming, poll
```

## What Does NOT Change

### CSS
- No CSS changes.

### CollapsibleBlock
- **Left border**: `1px solid var(--theme-primary)` — appears during typing, stays through collapse.
- **Starting state**: expanded (`isExpanded: true`).
- **Shimmer timeline**: icon fade (300ms) -> 800ms label+shimmer -> 1500ms shimmer -> 500ms pause -> typing.
- **Post-type**: 500ms pause -> collapse (500ms, `maxHeight` + `opacity` transition) -> 500ms pause -> advanceBlock.
- **Toggle arrow**: appears after collapse. Click to re-expand.
- **Content styling**: `var(--text-dim)`, italic for `think` type, `pre-wrap`.

### TextBlock
- **Markdown rendering**: `marked.parse()` on displayed text, unchanged.
- **Post-type**: 500ms pause -> advanceBlock.
- **Content styling**: `var(--text-white)`.

### CodeBlock
- **Post-type**: `hljs` syntax highlighting on full content -> 500ms pause -> advanceBlock.
- **Line numbers**: stream in as lines render.
- **Border**: `1px solid var(--theme-border)`, transparent background, `6px` border-radius.
- **No language header** (removed, stays removed).

### Everything Else
- `simpleQueue.ts` — block types, mutable content, rAF batching, gating. Unchanged except adding turn-complete signal.
- `contentAccumulator.ts` — structural boundaries (fences, type changes). Unchanged.
- `useWebSocket.ts` — message routing. Unchanged.
- OrbBlock, UserBlock, InlineToolBlock — no content typing, unchanged.
- Orb timing, shimmer animations — unchanged.

## Files to Modify

| File | Action |
|------|--------|
| `src/lib/chunkParser.ts` | Modify — expose `findNextBoundary(content, fromIdx)` for sub-chunk detection, keep `formattingIsBalanced` |
| `src/components/SimpleBlockRenderer.tsx` | Modify — replace three typing loops with char-by-char + sub-chunk cadence pattern, read shared acceleration variable |
| `src/lib/simpleQueue.ts` | Modify — add turn-complete callback (fires when all block lifecycles are done), host shared acceleration variable |

## TIMING Constants (target state)

```typescript
const TIMING = {
  // ... orb timings unchanged ...
  FADE_IN: 300,
  SHIMMER_PAUSE: 500,
  TYPING_SLOW: 6,         // first 10 chars of each sub-chunk
  TYPING_FAST_DEFAULT: 3,  // chars 10+ (normal)
  TYPING_FAST_ACCEL: 1,    // chars 10+ (when backlog detected)
  BOUNDARY_PAUSE: 300,     // pause between sub-chunks
  POST_TYPE_PAUSE: 500,
  COLLAPSE: 500,
  POST_COLLAPSE_PAUSE: 500,
  INLINE_FADE_IN: 250,
  INLINE_SHIMMER: 500,
} as const;
```

## Verification

1. `/demo` — all block types render with visible character-by-character animation
2. Real message — characters type in, pausing 300ms at each sub-chunk boundary
3. Within each sub-chunk: first 10 chars are slower (6ms), remaining are faster (3ms or 1ms)
4. After stream-complete (write block finishes or tokens all received): subsequent sub-chunks use 1ms for the fast portion
5. Bold text (`**bold**`) — typing continues through unbalanced markers without pausing at boundaries
6. Code blocks type char-by-char line-by-line, 300ms pause at each `\n`, line numbers appear per line
7. Collapsible blocks: shimmer timeline -> char-by-char with sub-chunk pauses -> collapse animation
8. Multi-turn: second message, first response stays intact
9. Blocks queued behind the active block still animate fully when they become active
10. Turn-complete (all lifecycles done, queue drained) resets acceleration back to default (3ms)
