---
title: "Chat Renderer Rebuild"
status: spec
priority: critical
relates-to: CURRENT_STATE, ENGINE_SIGNAL_FIX_OPTIONS, RENDERER_MODULE_SPLIT_SPEC, TOOL_CALL_UNIFICATION_SPEC, CHAT_RENDER_SPEC
supersedes: ENGINE_SIGNAL_FIX_OPTIONS (engine is dead), RENDERER_MODULE_SPLIT_SPEC (updated module structure)
---

# Chat Renderer Rebuild

## Context

The chat renderer was broken by a prior Claude session that added a parallel rendering pipeline (SimpleBlockRenderer + ContentAccumulator) to handle grouping, causing double rendering. Phase 1 (commit b129728) killed the parallel pipeline but also gutted the animation system. Phase 2 (branch phase2-snapshot at b505e2d) tried to rebuild with proper module split but the render engine signal was never connected.

The render engine (beat-driven 500ms release gate) is dead. It never worked correctly and confused every AI that touched it. Components own their own timing.

Reference commit for working animation: `6173587` (original MessageList, 493 lines).
Reference branch for module structure: `phase2-snapshot` (LiveSegmentRenderer, InstantSegmentRenderer, etc.).

## Architecture

### No Render Engine

Delete renderEngine.ts, engineRegistry.ts, useEngineBridge.ts. Components self-manage their animation lifecycle. No external gating, no beat interval, no release count.

### One Catalog, Two Render Modes

`segmentCatalog.ts` is the single source of truth for ALL visual identity and behavior. Both renderers read from it. If you change the icon for `shell`, it changes everywhere.

The catalog defines per segment type:
- Icon, color, label, CSS (visual identity)
- `groupable: boolean` (look-ahead behavior)
- `renderMode` (how content is displayed)

### Render Modes (defined in catalog, implemented as submodules)

| Render Mode | Types | What Shows |
|-------------|-------|-----------|
| `markdown` | text | Paragraph/header chunked typing with blitz effect |
| `line-stream` | think, grep, shell | Line breaks = chunk boundaries, typing blitz per line |
| `diff` | edit | Red/green line diff view |
| `code` | write | Syntax highlighted code block |
| `grouped-summary` | read, glob, web_search, fetch | Key identifier only: filename, folder path, URL. Click to expand. |

### Module Structure

```
src/
├── lib/
│   ├── segmentCatalog.ts          ← single source of truth (icons, colors, labels, behavior, renderMode)
│   ├── chunkParser.ts             ← chunk boundary detection (paragraph, header, line break, code fence)
│   ├── chunkBuffer.ts             ← NEW: buffer + speed attenuator (fast/slow binary)
│   ├── instructions.ts            ← toolNameToSegmentType mapping
│   └── segment-renderers/
│       ├── markdown.ts            ← paragraph/header chunked typing
│       ├── line-stream.ts         ← line-break chunked typing
│       ├── diff.ts                ← red/green diff view
│       ├── code.ts                ← syntax highlighted code
│       └── grouped-summary.ts     ← key identifier (filename, path, URL)
├── components/
│   ├── MessageList.tsx            ← routing only (~60 lines): history → Instant, live → Live
│   ├── LiveSegmentRenderer.tsx    ← animation lifecycle (shimmer, typing blitz, collapse)
│   ├── InstantSegmentRenderer.tsx ← everything collapsed, no animation, same visual identity
│   ├── ToolCallBlock.tsx          ← shared shell: header (icon + label) + collapsible content area
│   └── CodeView.tsx               ← universal syntax-highlighted code display
```

### Deleted (do not rebuild)

- `renderEngine.ts` — dead, components own timing
- `engineRegistry.ts` — dead
- `useEngineBridge.ts` — dead
- `SimpleBlockRenderer.tsx` — already deleted (caused double rendering)
- `simpleQueue.ts` — already deleted
- `contentAccumulator.ts` — already deleted

## Behaviors

### Live Streaming (Orchestrated Render)

Segments animate one at a time. Each segment:
1. Tool block appears (icon + label shimmer)
2. Content typing blitz (speed determined by buffer depth)
3. Post-typing pause
4. Collapse animation
5. Next segment starts

Text segments:
1. Parse by paragraph/header/code-fence boundaries
2. Brief pause before each chunk
3. Cursor blitzes across the line (1-6ms per character)
4. Next chunk

### Instant Render (History / Thread Switch / Re-render)

Everything renders collapsed immediately. Same icons, same colors, same labels from the catalog. No animation. Grouping still applies — consecutive reads are one collapsed block showing filenames.

### DOM Caching (Active Threads)

Active threads keep their DOM alive (`display: none` when not visible). Switching threads is instant — no re-render, expanded/collapsed state preserved, scroll position preserved.

Evicted threads (idle timeout or FIFO at max 10) drop their DOM. Next visit re-renders instant, all collapsed.

### Scrolling

User sends message → bubble jumps to top of new assistant turn. No auto-scroll after that. User scrolls manually. Padded container underneath prevents collapse-jerk when blocks collapse.

## Speed Attenuator (Binary: Fast/Slow)

The system renders chunks. At each chunk boundary, it checks TWO chunks ahead:

```
Rendering chunk N (N+1 is always ready — that's the precondition)
  → Is chunk N+2 complete in the buffer?
    → Yes: render N at FAST speed (1ms per char)
    → No:  render N at SLOW speed (6ms per char)
```

The system never stalls because N+1 is always buffered before N starts rendering. The speed toggle controls whether you're burning through runway or coasting to let the wire catch up.

### What is a "complete chunk"?

| Context | Chunk Boundary |
|---------|---------------|
| Text (markdown) | Paragraph break (`\n\n`), header (`##`), code fence (```), table, inline content boundary |
| Collapsible tool (think, shell) | Line break within the block |
| Grouped tool (read, glob) | Full open+close tool call tags |
| Code block | Entire fenced block |

## Grouping Look-Ahead

Dead simple. No buffer, no accumulator, no state machine.

1. Tool block renders on first opening tag
2. Content streams in, renders with typing animation
3. On closing tag, peek at next thing in the stream
4. If next thing is opening tag of same type AND type is `groupable: true` → merge into same block
5. If not → block is done, collapse

The system is already 300-500ms behind the wire. The next tool is always there by the time you check the closing tag.

During instant render: same grouping logic runs on the segment array (which is complete). Consecutive same-type groupable segments collapse into one block.

## Catalog Extension

Add `renderMode` to `SegmentBehavior` in segmentCatalog.ts:

```typescript
export interface SegmentBehavior {
  contentFormat: 'plain' | 'markdown' | 'code' | 'diff';
  renderMode: 'markdown' | 'line-stream' | 'diff' | 'code' | 'grouped-summary';
  groupable: boolean;
  summaryField?: string;  // which tool arg to show in grouped-summary (e.g., 'file_path', 'pattern', 'url')
  syntaxHighlight?: boolean;
  languageDetection?: 'auto' | 'from-path' | 'from-meta';
}
```

Per-type render modes:

```
text:        renderMode: 'markdown'
think:       renderMode: 'line-stream'
shell:       renderMode: 'line-stream'
read:        renderMode: 'grouped-summary', summaryField: 'file_path'
write:       renderMode: 'code'
edit:        renderMode: 'diff'
glob:        renderMode: 'grouped-summary', summaryField: 'pattern'
grep:        renderMode: 'grouped-summary', summaryField: 'pattern'
web_search:  renderMode: 'grouped-summary', summaryField: 'query'
fetch:       renderMode: 'grouped-summary', summaryField: 'url'
subagent:    renderMode: 'line-stream'
todo:        renderMode: 'line-stream'
```

## Recovery References

| Commit | What to recover |
|--------|----------------|
| `6173587` | CollapsibleChunk animation (shimmer, typewriter, collapse timing), TextChunk typing effect, TIMING constants, typeContent/sleep helpers |
| `phase2-snapshot` (b505e2d) | Module structure (LiveSegmentRenderer, InstantSegmentRenderer, ToolCallBlock, CodeView, ToolContentRenderer), grouping state machine in useWebSocket |

## What NOT to Recover

- RenderEngine, engineRegistry, useEngineBridge — dead
- SimpleBlockRenderer, simpleQueue, contentAccumulator — dead
- Any local icon/label maps in components — catalog is the source
- The `getSegmentCategory` collapsible/inline split — everything is collapsible
