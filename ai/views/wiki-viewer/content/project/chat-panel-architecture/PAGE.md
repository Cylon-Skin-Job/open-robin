# Chat Panel Architecture

How the chat panel is built, how it renders, and why it works the way it does. Internal development reference.

## Panel Lifecycle

All panels live in the DOM simultaneously. Panel switching is a CSS visibility flip, not a mount/unmount cycle.

```css
.panel          → position: absolute; visibility: hidden; opacity: 0;
.panel.active   → visibility: visible; opacity: 1; transition: 0.2s
```

This means:
- React component trees stay mounted across panel switches
- Refs, local state, scroll positions survive
- No re-initialization penalty on return
- Zustand store data persists independently of DOM

Only runtime plugins (vanilla JS modules with `ui/` folder) unmount/remount. React components never unmount during normal navigation.

## Component Hierarchy

```
ChatArea                          ← scroll container, send handler, orb state
  └─ MessageList                  ← routes messages to correct renderer
       ├─ InstantSegmentRenderer  ← history messages (collapsed, no animation)
       │    ├─ InstantText        ← markdown → HTML, no animation
       │    ├─ InstantToolBlock   ← single tool, collapsed by default
       │    └─ InstantGroupedBlock← consecutive same-type tools grouped
       │
       └─ LiveSegmentRenderer     ← current streaming turn (animated)
            ├─ Orb               ← Phase 1: gatekeeper animation
            ├─ LiveTextSegment   ← Phase 2: markdown typing with cursor
            └─ LiveToolSegment   ← Phase 2: shimmer → reveal → collapse
```

## Two Renderers, One Data Source

Every message has a `segments[]` array. The same data renders through two completely different paths:

**InstantSegmentRenderer** — History. No animation. Groups consecutive same-type segments. All collapsed by default. Used for: thread load, thread switch, finalized turns.

**LiveSegmentRenderer** — Current turn. Animated. Sequential reveal (one segment at a time). Orb gatekeeper before first content. Used for: active streaming.

The transition between them happens at finalization (see Turn Lifecycle wiki).

## Sequential Reveal

Segments render ONE AT A TIME during live streaming. Enforced by:

```
segments.slice(0, revealedCount + 1)
```

- `revealedCount` starts at 0 — only segment[0] is mounted
- When segment N finishes its animation, `onSegmentDone` bumps `revealedCount`
- React mounts segment N+1, its animation starts
- Already-revealed segments stay mounted in their final state

This prevents text and tools from racing in parallel. The animation sequence is always:
1. Segment appears (shimmer for tools, immediate for text)
2. Content reveals (typing animation or instant for grouped)
3. Post-reveal pause
4. Collapse animation (tools only)
5. Next segment mounts

## Tool Rendering

All presentation decisions are delegated to `lib/tool-renderers/`. Zero type-specific code in the components.

```
LiveToolSegment calls:
  getToolRenderer(segment.type) → ToolRenderer
    .contentStyle     → font, whitespace, color
    .formatContent()  → HTML string for display
    .showCursor       → whether to show blinking cursor
    .buildTitle()     → label text (with counter for grouped)
```

The reveal system (`lib/reveal/`) controls HOW content appears (typing speed, chunking). The tool renderer controls WHAT it looks like.

Renderers by type:
- **Singular** (think, shell, write, edit, subagent, todo): one tool call per block, typed reveal
- **Grouped** (read, glob, grep, web_search, fetch): consecutive same-type consumed into one block, items appear instantly, title counter updates live

## Cursor Injection

The typing cursor must render INSIDE the HTML structure, not appended after closing tags.

**Text segments:** A marker string is injected into raw text before `markdownToHtml()`. Markdown wraps it into the same `<p>`, `<h1>`, `<li>` as surrounding text. After parsing, the marker is replaced with the cursor span.

**Tool segments:** `injectCursor()` finds the last closing HTML tag and inserts the cursor before it. For flat text (no tags), it just appends.

If the cursor is appended AFTER the HTML (e.g., `<p>text</p><span>█</span>`), it renders on a new line below the content instead of inline. This bug has been fixed multiple times.

## Completion Detection

Turn finalization uses an effect, not a callback. See the Turn Lifecycle wiki for the full explanation.

The short version: `onSegmentDone` only bumps `revealedCount`. A separate `useEffect` watches `[revealedCount, segments.length, onRevealComplete]` and fires `finalizeTurn()` when all three conditions align. This handles both orderings (stream finishes first OR renderer finishes first).

## State Flow

```
WebSocket message
    ↓
ws-client.ts (handleMessage)
    ↓
panelStore (Zustand) — per-panel state
    ├─ segments[]      ← grows as tokens arrive
    ├─ currentTurn     ← streaming/complete status
    └─ pendingTurnEnd  ← gate for finalization
    ↓
React selectors re-evaluate
    ↓
ChatArea → MessageList → LiveSegmentRenderer → individual segments
```

All store reads in ws-client use `getState()` — always fresh, no stale closures. React components use Zustand selectors for reactive updates.

## Memory Model

- Messages: append-only within a session, cleared on thread switch (`clearPanel`)
- Per panel: ~100-200KB typical (messages + segments + metadata)
- DOM: ~700-1000 nodes per panel with 50 messages
- Hidden panels: `visibility: hidden` skips layout/paint — zero render cost

Panels survive panel switches. Thread switches clear and reload. No message windowing yet — long single-thread conversations accumulate, but even 200 exchanges is only 2-5MB.

## Files

| File | What it does |
|------|-------------|
| `components/ChatArea.tsx` | Scroll container, send handler, orb state |
| `components/MessageList.tsx` | Routes to Live vs Instant renderer, bridges pendingTurnEnd |
| `components/LiveSegmentRenderer.tsx` | Sequential reveal, completion detection, orb |
| `components/InstantSegmentRenderer.tsx` | History render with grouping |
| `components/ToolCallBlock.tsx` | Shared shell: icon, label, collapse, shimmer |
| `components/Orb.tsx` | Gatekeeper animation (expand → breathe → dispose) |
| `lib/tool-renderers/` | Per-type presentation: style, title, content format |
| `lib/reveal/` | Animation engine: typing speed, chunking, orchestration |
| `lib/segment-renderers/` | Low-level content formatting: diff, code, line-stream |
| `lib/segmentCatalog.ts` | Visual identity: icons, colors, borders, render modes |
| `lib/text/` | Markdown text rendering: chunk parsing, sub-renderers |
| `lib/timing.ts` | All timing constants (shimmer, pause, collapse durations) |
| `lib/ws-client.ts` | WebSocket routing, turn_begin/turn_end handling |
| `state/panelStore.ts` | Zustand store: per-panel state, finalizeTurn |
