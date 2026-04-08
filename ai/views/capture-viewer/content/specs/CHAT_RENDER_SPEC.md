# Chat Render Specification

## Overview
Real-time streaming chat with choreographed animations. Token-level WebSocket messages flow through a **content accumulator** that buffers them into logical blocks, then each block self-manages its animation lifecycle.

## Architecture

```
WebSocket tokens → ContentAccumulator (state machine) → SimpleQueue (blocks) → SimpleBlockRenderer (React)
```

- **Backend**: Sends token-level content via WebSocket (1-5 chars each)
- **ContentAccumulator**: Buffers tokens into logical blocks, detects boundaries (fences, headers, type changes)
- **SimpleQueue**: Holds blocks with mutable content, batches notifications via rAF
- **SimpleBlockRenderer**: Each block component self-manages timing, removes itself when done
- **Segment Store**: Parallel path for MessageList (past messages) — unchanged

---

## Block Types & Lifecycles

All blocks are agnostic — no inter-block tracking. Each runs its own timeline.

### Orb
**Trigger:** User sends message (immediate, before server responds)

1. 500ms pause (invisible)
2. Fade in (200ms)
3. Expand to 1.2x + blur (500ms)
4. Pause open at 1x (500ms)
5. Contract to 0.8x (500ms)
6. Fade out (200ms)
7. 500ms pause → remove

### Collapsible (think, shell, write) — IDENTICAL paradigm
1. First token arrives → create block (empty content, `complete: false`)
2. Icon fades in (300ms ease-in), then 500ms pause, then label fades in (300ms ease-in) with shimmer active
3. Shimmer runs 1500ms (fixed), then stops
4. 500ms pause (label settles to grey)
5. Chunk-render content — paragraphs, headers, list items appear as whole units (30ms between chunks)
6. 500ms pause → collapse (500ms) → 500ms pause → advanceBlock

### Text
1. First token → create block, render container immediately
2. Chunk-render content as tokens arrive — waits for semantic boundaries (paragraph, header, list item, line break) before revealing
3. Markdown rendered via `marked.parse()` as chunks reveal — no partial `**bold**` flicker
4. Boundary hit (backtick fence, type change, ## header) → mark complete → flush remaining content
5. 500ms post-type pause → advanceBlock

### Code
1. Opening ``` detected → create code block with language meta
2. Chunk-render raw code line-by-line (waits for `\n` before revealing each line, 30ms between lines)
3. Closing ``` detected → mark complete → flush remaining → apply `hljs` syntax highlighting
4. 500ms post-type pause → advanceBlock

### Inline Tool (read, edit, glob, grep, web_search, fetch, subagent, todo)
1. Fade in (250ms) → show icon + label → shimmer (500ms) → fade out → done
2. No 500ms gap between consecutive inline tools
3. Created with `complete: true` immediately

---

## Chunk Rendering

Content renders in semantic chunks rather than character-by-character.

**Text chunks** (`chunkParser.ts: getTextChunkBoundary`):
- Paragraph breaks (`\n\n`)
- Headers (`# ` at line start)
- List items (`- `, `* `, `1. ` at line start)
- Single line breaks (if formatting is balanced)
- Stall safety: forces render after 500+ chars with no boundary

**Code chunks** (`chunkParser.ts: getCodeChunkBoundary`):
- Each complete line (delimited by `\n`)

**Formatting safety**: Before accepting any boundary, verifies `**` and `` ` `` markers are balanced. Prevents partial `**bold**` flicker.

**Flush mode**: When `block.complete` is true, renders all remaining content immediately.

| Constant | Value | Purpose |
|----------|-------|---------|
| `CHUNK_DELAY` | 30ms | Inter-chunk rhythm (replaces 5-2-1 cadence) |
| Stall threshold | 500 chars | Force render if no boundary found |
| Poll interval | 16ms | Check for new content (~1 frame) |

---

## Content Accumulator State Machine

```
States: idle | text | thinking | code | tool
Transitions on: content msg, thinking msg, tool_call, tool_result, turn_end
```

**Boundary detection:**
- **Type change** (think↔text): complete current block, start new one
- **Code fence** (triple backtick): complete text block, start code block (and vice versa)
- **Header** (`## ` at line start): complete current text block, start new one
- **Tool call**: complete any active block, create tool block
- **Turn end**: complete all active blocks

**Token buffering:**
- Backtick counter tracks partial fence detection across token boundaries
- Line buffer tracks partial header detection
- Content accumulates character by character for precise boundary detection

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/simpleQueue.ts` | Block queue with mutable ops, rAF batching |
| `src/lib/chunkParser.ts` | Semantic chunk boundary detection for rendering |
| `src/lib/contentAccumulator.ts` | State machine: tokens → blocks |
| `src/hooks/useWebSocket.ts` | Routes WS messages through accumulator |
| `src/components/SimpleBlockRenderer.tsx` | All block components (Orb, Collapsible, Text, Code, InlineTool) |
| `src/components/ChatArea.tsx` | Mounts SimpleBlockRenderer (always, not gated) |
| `src/lib/instructions.ts` | Tool categorization, icons, labels |

---

## CSS Variables

- `--theme-primary` — Icons, shimmer gradient
- `--theme-primary-rgb` — Subtle backgrounds (0.03 opacity)
- `--text-dim` — Dim text color
- `--text-white` — Content text color
- `--bg-code` — Code block background
- `--theme-border` — Border color
- `--font-mono` — Monospace font family

## Icons

- `lens_blur` — Orb
- `lightbulb` — Thinking
- `terminal` — Shell
- `description` — Read
- `edit_note` — Write
- `find_replace` — Edit
- `folder_search` — Glob
- `search` — Grep
- `travel_explore` — Web search
- `link` — Fetch
- `smart_toy` — Subagent
- `checklist` — Todo

## Key Principles

1. **Orb = immediate feedback** — No waiting for backend
2. **Blocks self-manage timing** — No central queue controlling animations
3. **Content accumulator buffers tokens** — Prevents hundreds of micro-blocks
4. **Mutable blocks** — Content grows in-place, components chase it
5. **rAF batching** — Coalesces rapid token updates into single re-renders
6. **Boundary detection** — Code fences, headers, type changes split blocks correctly