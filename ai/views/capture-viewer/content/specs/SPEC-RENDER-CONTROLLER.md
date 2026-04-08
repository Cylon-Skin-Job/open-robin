---
title: Render Controller Spec — Fractal Controller Architecture
created: 2026-03-30
status: DRAFT — Awaiting approval
parent: SPEC-TOOL-RENDERERS.md
supersedes: Current inline orchestration in LiveSegmentRenderer.tsx
---

# Render Controller Spec

How streaming content flows from the wire to the screen. One unified catalog. Fractal controllers. Tagged chunks. Submodules that never import each other.

---

## 1. Problem Statement

### 1a. Orchestration logic lives in a React component

LiveSegmentRenderer.tsx is doing three jobs:

1. React component (state, refs, JSX)
2. Segment dispatcher (text vs tool routing)
3. Tool orchestration (strategy selection, renderer selection, pressure wiring, reveal options)

When an LLM is asked to fix tool typing, it opens LiveSegmentRenderer.tsx and is now in the same file as text typing, segment dispatch, and pressure wiring. One bad edit takes out everything.

### 1b. Tool type knowledge is scattered across four files

Adding or modifying a tool type requires touching:

| File | What it knows |
|------|---------------|
| `segmentCatalog.ts` | Label, render mode, icon |
| `chunk-strategies/index.ts` | Switch statement: type → chunk strategy |
| `segment-renderers/index.ts` | Switch statement: renderMode → renderer |
| `reveal/index.ts` | Switch statement: type → reveal style |

These four files all answer the same question: "given this tool type, what do I do with it?" They drift independently. Forget to update one and the tool silently falls through to a default.

### 1c. The text pipeline is clean, the tool pipeline is not

`text-animate.ts` is a proper controller — pure async function, no React, owns the full text typing loop. The tool side has no equivalent. Its orchestration is smeared across LiveSegmentRenderer.tsx (component), reveal/index.ts (dispatch), and reveal/orchestrator.ts (typing loop).

### 1d. Speed/pressure logic has no single owner

Speed decisions cross module boundaries without a clear chain of command:
- `speed-attenuator.ts` computes from queue depth
- `pressure.ts` computes from segment backlog
- LiveToolSegment manually threads pressure fields to reveal
- Some tools should override speed entirely (shell = always fast), but there's no place to declare that

### 1e. Rendering doesn't respect parent context

A code fence inside a think block renders identically to a code fence inside text. It shouldn't. Think content should stay gray and flat. Text code fences should get full syntax highlighting. The renderer has no knowledge of its parent segment type.

### 1f. Tool call completeness is not tracked

Write/edit tools stream content as the AI generates it, but the file isn't written until the tool result arrives. There's no mechanism to hold chunks until the write is confirmed, making diff rendering impossible without race conditions.

---

## 2. Design Principles

### 2a. File boundaries are edit fences

Each concern is its own file. An LLM editing one file cannot break another concern. This is the primary design constraint — not clean architecture for its own sake, but blast radius containment for AI editing.

### 2b. One catalog, all tool knowledge

A single registry defines everything about every tool type: tags, labels, icons, chunk strategy, transform, renderer, speed hints. Add a tool: one entry. Remove a tool: one entry. Nothing else changes.

### 2c. Fractal controllers

Controllers nest. Every level has the same shape: receive, classify, dispatch, collect, return. The submodules at each level are pure — they take input, return output, don't know the pipeline exists, and never import each other.

### 2d. Submodules are agnostic

The chunker doesn't know what tools exist. The renderer doesn't know how chunking works. The speed attenuator doesn't know what tool type it's serving. They receive work, do their job, return results. The controller is the only module that knows multiple concerns exist.

### 2e. Parent type overrides content shape

A code fence inside a think block is think content, not code content. The parent segment type determines rendering, not the content's markdown structure. The chunker tags every chunk with its parent context. The renderer reads the tag and never re-parses.

### 2f. Chunks carry metadata

The chunker attaches rendering instructions to every chunk it emits. The renderer never scans for markdown boundaries, never detects block types, never infers context. All parsing happens once, upstream, where the boundary knowledge naturally lives.

---

## 3. Unified Catalog

### 3a. One entry per tool type

```typescript
interface CatalogEntry {
  // Identity
  type: string;                    // 'shell', 'read', 'write', 'text', ...
  tags: string[];                  // Wire tag names: ['Bash', 'bash']
  label: string;                   // Display name: 'Shell'
  icon: string;                    // Material symbol: 'terminal'

  // Chunking
  strategy: ChunkStrategy;         // How to split streaming content into chunks

  // Transform
  transform?: ChunkTransform;      // Reshape data for display (null = pass-through)

  // Rendering
  renderer: SegmentContentRenderer; // How to convert a chunk to HTML

  // Speed
  speed?: 'fast' | 'slow';        // Override attenuator. Absent = attenuator decides.
  interChunkPause?: number;        // Override default pause between chunks. Absent = pressure decides.

  // Completeness
  awaitsResult?: boolean;          // Hold all chunks until tool_result arrives (write, edit, shell)
}
```

### 3b. Text is not special

Text is a catalog entry like any other. Its `tags` match the absence of a tool tag (or an explicit text marker). Its `strategy` is the text chunk strategy. Its `renderer` is the markdown renderer. The chunker doesn't have `if (type === 'text')`.

### 3c. Catalog is the only file that knows what tools exist

The catalog imports strategies, renderers, transforms, and other submodules. Nothing else does. The controller asks the catalog. The catalog returns the entry. The controller passes the relevant field to the relevant submodule.

```
Controller: "catalog, what handles 'Bash'?"
Catalog:    → { type: 'shell', strategy: shellStrategy, speed: 'fast', awaitsResult: true, ... }
Controller: chunk = strategy.next()
Controller: chunk = entry.transform ? entry.transform(chunk) : chunk
Controller: html = entry.renderer.toHtml(chunk)
```

The chunker never sees the catalog. The renderer never sees the catalog. The transform never sees the catalog. The controller is the bridge.

### 3d. Adding a new tool

1. Write `chunk-strategies/new-tool.ts` — implements `ChunkStrategy`
2. Write a renderer (if needed; may reuse existing text/code/think renderer)
3. Write a transform (if needed; most tools use pass-through)
4. Add one entry to the catalog

No existing files edited. No switch statements updated. No routing changes.

### 3e. Removing a tool

1. Remove the catalog entry
2. Delete the strategy, renderer, and transform files (if not shared)

The controller, chunker, attenuator, and typing loop don't change.

### 3f. Current tool type entries

```
text:
  strategy: markdownChunkStrategy   (parse paragraphs, headers, lists, code fences)
  transform: null                   (pass-through)
  renderer: textRenderer            (markdown → HTML)
  speed: null                       (attenuator decides)
  awaitsResult: false

think:
  strategy: lineChunkStrategy       (split on line boundaries)
  transform: null
  renderer: thinkRenderer           (gray monospace, everything flat)
  speed: 'slow'
  awaitsResult: false

shell:
  strategy: singleChunkStrategy     (accumulate all, emit on result)
  transform: null
  renderer: codeRenderer            (monospace, no syntax highlighting)
  speed: 'fast'
  awaitsResult: true

read:
  strategy: singleChunkStrategy     (emit on result)
  transform: filePathTransform      (truncate path for label)
  renderer: codeRenderer            (syntax highlighted)
  speed: 'fast'
  awaitsResult: true

write:
  strategy: singleChunkStrategy     (accumulate all, emit on result)
  transform: filePathTransform
  renderer: codeRenderer            (syntax highlighted; future: diff renderer)
  speed: 'fast'
  awaitsResult: true

edit:
  strategy: singleChunkStrategy     (accumulate all, emit on result)
  transform: filePathTransform
  renderer: diffRenderer            (red/green diff view)
  speed: 'fast'
  awaitsResult: true

grep:
  strategy: lineChunkStrategy
  transform: null
  renderer: codeRenderer
  speed: 'fast'
  awaitsResult: true

glob:
  strategy: lineChunkStrategy
  transform: null
  renderer: codeRenderer
  speed: 'fast'
  awaitsResult: true
```

---

## 4. Tagged Chunks

### 4a. The problem with raw chunks

Currently, chunks are raw strings. The renderer has to re-parse them to figure out what they are — scan for triple backticks, detect headers, infer block types. This duplicates work the chunker already did and creates a coupling between chunker and renderer assumptions.

### 4b. Chunks carry their own rendering instructions

The chunker attaches metadata to every chunk it emits. The renderer reads the tag and calls the right sub-function. No re-parsing. No detection. No inference.

```typescript
interface TaggedChunk {
  // Content
  content: string;                 // The raw content of this chunk

  // Identity (set by chunker)
  block: 'text' | 'code' | 'think' | 'diff' | 'shell';
  parent: string;                  // Parent segment type: 'text', 'think', 'write', etc.
  lang?: string;                   // Language hint for code blocks: 'javascript', 'typescript', etc.

  // Position (for multi-chunk blocks)
  position: 'complete' | 'open' | 'continue' | 'close';

  // Display (set by transform, if any)
  displayLabel?: string;           // Truncated path: '.../renderers/paragraph.ts'
  tooltip?: string;                // Full project-relative path
  copyValue?: string;              // Absolute path for clipboard

  // Result (set by strategy for awaitsResult tools)
  result?: string;                 // Tool call result content
}
```

### 4c. Parent context determines block type

The chunker tags based on the parent segment type, not by inspecting content:

```
Segment: text
  Chunker parses markdown boundaries.
  Paragraphs, headers, lists → block: 'text'
  Code fences → block: 'code' (with lang)
  Mixed tags. The text chunker is the only one that does content-aware tagging.

Segment: think
  Everything → block: 'think'. Period.
  Code-looking content stays think. The chunker does not scan for fences.
  Gray monospace for all of it.

Segment: write / edit
  Everything → block: 'code' (or 'diff' for edit with result)
  Lang from tool args, not from content scanning.

Segment: read
  Everything → block: 'code'
  Lang inferred from file extension in tool args.

Segment: shell
  Everything → block: 'shell'
  No syntax highlighting. Monospace output.
```

Text is the only segment type where the chunker does content-aware tagging. Everything else: "you're inside a {type} segment, all your chunks are {type}."

### 4d. Position states for multi-chunk blocks

For long tool output that gets sub-chunked (800-line write, long shell output):

```
{ content: "lines 1-50",    block: 'code', position: 'open' }      ← start <pre><code>
{ content: "lines 51-100",  block: 'code', position: 'continue' }  ← append inside
{ content: "lines 101-150", block: 'code', position: 'continue' }  ← append inside
{ content: "lines 751-800", block: 'code', position: 'close' }     ← close </code></pre>
```

The renderer sees `open` → start wrapper. `continue` → append. `close` → close wrapper. It never scans for triple backticks or counts fences.

For single-chunk tools (most tool calls with `awaitsResult: true`), position is always `'complete'`.

---

## 5. The Four-Step Pipeline

### 5a. Overview

Every chunk passes through four steps. The controller calls them in order. Each is its own concern.

```
Chunk → Transform → Render → Type
```

1. **Chunk:** Split streaming content into tagged chunks with metadata
2. **Transform:** Reshape data for display (path truncation, normalization). Always called — returns unchanged if nothing to do.
3. **Render:** Produce HTML from display-ready tagged chunk
4. **Type:** Reveal HTML to screen with speed and pressure

### 5b. The controller loop (same for every tool type)

```
chunk = strategy.next()                              // may hold until result
chunk = entry.transform ? entry.transform(chunk) : chunk
html = entry.renderer.toHtml(chunk)
reveal(html, speed)
```

Four lines. No branching per tool type. The catalog entries make each tool behave differently.

### 5c. Transform

The transform step reshapes data for display. It's a pure function: tagged chunk in, tagged chunk out. The controller always calls it if the catalog entry provides one. If the entry doesn't, the chunk passes through unchanged.

Transforms are small. A few lines each. They live alongside the catalog or in a single file — not a directory with a registry. If the list grows past 5-6 distinct transforms, extract to their own files then.

**Current transforms:**

```
filePathTransform:
  Input:  chunk with content containing a file path
  Output: chunk with displayLabel, tooltip, copyValue added
  Used by: read, write, edit

  displayLabel: '.../parent/filename.ext'
  tooltip: 'kimi-ide-client/src/lib/text/renderers/paragraph.ts'
  copyValue: '/Users/.../paragraph.ts' (absolute, for clipboard)
```

The transform does NOT check whether it's needed. The controller doesn't check either. The catalog said "use filePathTransform" — it runs. If the catalog says nothing — pass-through. The decision was made at registration time, not runtime.

### 5d. Chunk strategies and completeness

Each tool type's chunk strategy defines when a chunk is ready to emit.

**Boundary-detected (text, think):** Emit when a block boundary is found. The chunker parses forward, finds a paragraph break or heading or fence boundary, and emits immediately.

**Result-awaited (write, edit, shell, read, grep, glob):** Accumulate all content. Do not emit until the tool result arrives. The strategy holds internally — the buffer never sees incomplete tool operations.

```typescript
interface ChunkStrategy {
  onContent(data: string): void;          // Wire data arrives
  onResult(result: string): void;         // Tool result arrives
  next(): TaggedChunk | null;             // Pop next ready chunk (null = still accumulating)
  flush(): TaggedChunk[];                 // Force-emit everything (timeout/cancel)
}
```

For `singleChunkStrategy` (write, edit, shell):
- `onContent` accumulates into an internal string
- `next()` returns null until `onResult` is called
- `onResult` finalizes: emit one chunk with content + result + metadata
- `flush()` emits what we have without result (timeout fallback)

For `markdownChunkStrategy` (text):
- `onContent` parses forward from cursor, detects boundaries
- `next()` returns tagged chunks as boundaries are found
- `onResult` not used (text has no tool result)
- `flush()` emits any partial block

For `lineChunkStrategy` (think):
- `onContent` splits on newlines
- `next()` returns each line as a tagged chunk
- Tags everything as `block: 'think'` regardless of content

**Timeout fallback:** If a tool result never arrives (10s timeout), the strategy calls `flush()`. Emits what it has, flags as incomplete. The renderer shows the content without diff/enrichment. Graceful degradation, not a hang.

### 5e. Per-segment pipelines

Each segment gets its own pipeline instance. The write segment holding for a tool result does not block the next text segment from chunking and typing. Segments are independent.

```
Segment 1 (write):    strategy accumulating, waiting for tool result → shimmer/progress
Segment 2 (text):     strategy parsing, emitting, typing normally
Segment 3 (shell):    strategy accumulating, waiting for tool result → shimmer/progress
```

Display order is still sequential — segment 2 doesn't start typing until segment 1 finishes. But the *processing* (chunking, accumulating) happens concurrently. When the write result arrives and segment 1 resolves, segment 2 may already have its chunks ready to go.

---

## 6. Three Renderers

### 6a. Overview

Three rendering submodules. The tagged chunk's `block` field determines which one is called. Each is a pure function: tagged chunk → HTML.

```
text    → Markdown renderer (##, **, *, `, lists, paragraphs — universal markdown)
code    → Syntax-highlighted <pre><code> with language detection
think   → Gray monospace, everything flat, no promotion to code
```

A fourth renderer exists for diffs:

```
diff    → Red/green line diff view (edit tool results with before/after)
```

Shell output uses the code renderer without a language (plain monospace).

### 6b. Text renderer (markdown)

Handles all standard markdown: headers, bold, italic, inline code, lists, paragraphs. This is the universal renderer for AI-generated prose.

File paths in text are **never truncated**. They render as monospace inline `<code>` spans, full path, copy-pasteable. The AI is telling the user where something is — that information must be preserved.

### 6c. Code renderer (syntax highlighted)

Handles code blocks with optional language-based syntax highlighting. Used by write, read, shell, grep, glob, and code fences within text segments.

Respects `position` tags:
- `open` → emit opening `<pre><code class="language-{lang}">`
- `continue` → append content inside the block
- `close` → close `</code></pre>`
- `complete` → full self-contained code block

### 6d. Think renderer (gray flat)

Everything is gray monospace. No markdown parsing. No code promotion. Content that looks like a code fence inside a think block stays gray and flat. The chunker tagged it `block: 'think'` — the renderer trusts the tag.

### 6e. Diff renderer

Red/green line-level diff view for edit tool results. Receives a chunk with both `content` (the new state) and `result` (the tool result confirming the write). The before-state comes from the event bus or is derived from the result.

---

## 7. File Path Display Rules

### 7a. Two contexts, two rules

**In text segments:** File paths are content. The AI is telling the user where something is. Render full path in monospace inline `<code>`, copy-pasteable. Never truncate.

**In tool dropdowns:** File paths are labels. The user already knows the AI is reading/writing — the tool type tells them that. Show enough to identify *which* file.

### 7b. Tool label truncation

Strip to `.../parent/filename.ext`:

```
Full:     /Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/src/lib/text/renderers/paragraph.ts
Label:    .../renderers/paragraph.ts
Tooltip:  kimi-ide-client/src/lib/text/renderers/paragraph.ts
Copy:     /Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/src/lib/text/renderers/paragraph.ts
```

Rules:
- **Filename:** Always full, never clipped
- **Immediate parent:** Always shown (one directory before filename)
- **Prefix:** `.../ ` (indicates truncation)
- **Project root files:** No ellipsis needed — just show `server.js`

Three levels of progressive disclosure on one data point:
1. **Label** (visible): `.../renderers/paragraph.ts` — scan and identify
2. **Tooltip** (hover): `kimi-ide-client/src/lib/text/renderers/paragraph.ts` — context
3. **Copy** (clipboard): absolute path — paste into terminal

### 7c. Implementation

This is the `filePathTransform` referenced in the catalog. It runs as the transform step for read/write/edit. It sets `displayLabel`, `tooltip`, and `copyValue` on the tagged chunk. The renderer reads these fields instead of parsing the path itself.

---

## 8. Speed and Pressure

### 8a. Speed tiers

Two tiers, not three. There is no `'instant'` tier. Animation always runs — even fast tools get the line-end deceleration.

```
'fast'   → fast base speed + line-end deceleration
'slow'   → slow base speed + line-end deceleration
null     → attenuator decides base speed + line-end deceleration
```

Only `pressure.instantReveal` skips animation entirely. That's the emergency valve, not a speed tier.

### 8b. Line-end deceleration (universal)

The last two characters before a newline always get a brief hold, regardless of speed tier. This is a property of the typing loop, not the catalog. It applies universally. No tool type can disable it. No catalog field controls it.

```
Typing loop (universal):
  for each character:
    if within last 2 chars before newline:
      effectiveSpeed = max(speed, LINE_END_HOLD)   // never faster than this
    else:
      effectiveSpeed = speed                        // whatever catalog/attenuator said
```

This gives even fast output a visual rhythm. Lines feel written, not pasted. The eye catches the line break.

### 8c. Speed hierarchy (precedence, highest wins)

```
1. pressure.instantReveal     — system is drowning, paste everything, no animation
2. catalog.speed              — tool-level tier ('fast' or 'slow')
3. speed-attenuator           — queue-depth-based dynamic speed
```

The controller implements this precedence. The submodules don't know about each other.

### 8d. How each tool type uses speed

```
text:    attenuator decides. Slow when queue is shallow (first paragraph).
         Fast when queue is deep (content is ahead of display).

think:   catalog says 'slow'. Deliberate pace. The AI is "thinking."

shell:   catalog says 'fast'. Nobody reads shell output character by character.
         Single chunk, fast render, done.

read:    catalog says 'fast'. File contents appear quickly.

write:   catalog says 'fast'. Code appears quickly (or diff resolves instantly).

edit:    catalog says 'fast'. Diff view appears quickly.

grep:    catalog says 'fast'. Results appear quickly.

glob:    catalog says 'fast'. File list appears quickly.
```

### 8e. Pressure hierarchy

Pressure operates at boundaries, never mid-block:

```
Block boundary:     text controller or tool controller checks pressure
Segment boundary:   segment controller checks pressure
```

Pressure can force `instantReveal: true`, which overrides everything — including catalog speed tiers and line-end deceleration. If the system is drowning in backlog, everything goes instant regardless.

---

## 9. Fractal Controller Architecture

### 9a. The pattern

Every controller at every level has the same shape:

```
1. Receive work from the level above
2. Classify: what kind of work is this?
3. Dispatch: hand it to the right submodule
4. Collect: get the result back
5. Return: pass it up to the level above
```

Submodules don't import each other. They don't know the pipeline exists. They could be tested in isolation. The controller is the only file that knows the routing.

### 9b. Three levels

```
Level 0: Display Controller
  "Messages arrive. Each has segments. Hand each segment off."
  Owner: ChatArea (or a new message-controller if ChatArea gets too heavy)
  Submodules: segment controller

Level 1: Segment Controller          ← DOES NOT EXIST YET (lives in LiveSegmentRenderer)
  "This segment has a type. Look up the catalog. Route to the right pipeline."
  Owner: segment-controller.ts (new file, pure logic, no React)
  Submodules: text controller, tool controller

Level 2a: Text Controller            ← EXISTS (text-animate.ts)
  "Parse forward. Buffer blocks. Type inside pre-rendered HTML."
  Owner: text-animate.ts
  Submodules: parser, buffer, speed-attenuator, html-utils, sub-renderers

Level 2b: Tool Controller            ← DOES NOT EXIST YET (smeared across component + reveal/)
  "Get strategy from catalog. Chunk → transform → render → type."
  Owner: tool-animate.ts (new file, pure logic, no React)
  Submodules: chunk-strategies/*, renderers, reveal/orchestrator
```

### 9c. What lives where

| Concern | Owner | Who calls it |
|---------|-------|-------------|
| "What type is this segment?" | Catalog | Segment controller |
| "How do I chunk this content?" | chunk-strategies/{type} | Text controller or tool controller |
| "Should I hold for a tool result?" | Catalog (`awaitsResult`) | Tool controller |
| "How do I reshape this chunk?" | Transform (from catalog entry) | Tool controller |
| "How do I render this chunk?" | Renderer (from catalog entry) | Text controller or tool controller |
| "How fast should I type?" | speed-attenuator | Text controller or tool controller |
| "Should I skip the attenuator?" | Catalog (`speed` field) | Text controller or tool controller |
| "What are the pauses between segments?" | pressure.ts | Segment controller |
| "What are the pauses between blocks?" | pressure.ts | Text controller or tool controller |
| "Line-end deceleration" | Typing loop (universal) | Always on |
| React state, refs, JSX | LiveSegmentRenderer.tsx | React |

### 9d. LiveSegmentRenderer.tsx becomes a thin shell

After extraction, LiveSegmentRenderer.tsx contains:

- State declarations (displayedHtml, typing)
- Refs (contentRef, completeRef, cancelRef)
- One `useEffect` that calls the segment controller
- JSX return with `dangerouslySetInnerHTML`

No strategy selection. No renderer selection. No pressure wiring. No speed logic. ~30-40 lines per segment type. A React component that only does React things.

---

## 10. Data Flow

### 10a. Complete path for a streaming segment

```
Wire (WebSocket)
  │
  ▼
Display Controller (ChatArea)
  │  "new segment arrived"
  ▼
Segment Controller (segment-controller.ts)
  │  catalog.lookup(segment.type)
  │  → CatalogEntry { strategy, transform, renderer, speed, awaitsResult, ... }
  │
  ├── type is text ────────────────────────────────────────────┐
  │                                                             │
  │   Text Controller (text-animate.ts)                         │
  │     │  parseTextChunks(content, cursor) → tagged blocks     │
  │     │  buffer.push(blocks)                                  │
  │     │  for each block:                                      │
  │     │    pressure check at block boundary                   │
  │     │    speed = catalog.speed ?? attenuator(queue)         │
  │     │    html = block.html (pre-rendered by parser)         │
  │     │    type chars via truncateHtmlToChars                 │
  │     │    line-end deceleration on last 2 chars before \n   │
  │     ▼                                                       │
  │   setDisplayedHtml(accumulated + partial + cursor)          │
  │                                                             │
  ├── type is tool ────────────────────────────────────────────┐│
  │                                                             ││
  │   Tool Controller (tool-animate.ts)                         ││
  │     │  chunk = strategy.next()                              ││
  │     │    (may hold until tool result for awaitsResult tools)││
  │     │  chunk = transform(chunk)    // always called         ││
  │     │  html = renderer.toHtml(chunk)                        ││
  │     │  pressure check at chunk boundary                     ││
  │     │  speed = catalog.speed ?? attenuator(queue)           ││
  │     │  reveal html with speed + line-end deceleration       ││
  │     ▼                                                       ││
  │   setDisplayedContent(html)                                 ││
  │                                                             ││
  └─────────────────────────────────────────────────────────────┘│
                                                                 │
  Segment Controller                                             │
  │  pressure check at segment boundary                          │
  │  onDone() → next segment                                     │
  ▼                                                              │
Display Controller                                               │
  │  "segment complete, advance"                                 │
  └──────────────────────────────────────────────────────────────┘
```

### 10b. Tool result flow for awaitsResult tools

```
Wire streams tool_use content         Wire sends tool_result
         │                                      │
         ▼                                      ▼
  strategy.onContent(data)              strategy.onResult(result)
  (accumulates internally)              (finalizes, chunk ready)
         │                                      │
         │    strategy.next() → null            │    strategy.next() → TaggedChunk
         │    (not ready yet)                   │    (complete, with result attached)
         │                                      │
         ▼                                      ▼
  Display: shimmer/progress             Chunk enters pipeline:
  indicator while waiting               transform → render → type → done
```

### 10c. Import graph after refactor

```
LiveSegmentRenderer.tsx
  └── segment-controller.ts

segment-controller.ts
  ├── catalog.ts                  (lookup)
  ├── text-animate.ts             (text pipeline)
  ├── tool-animate.ts             (tool pipeline)
  └── pressure.ts                 (segment-boundary timing)

text-animate.ts
  ├── text/index.ts               (parsing → tagged blocks)
  ├── text/chunk-buffer.ts        (queue)
  ├── text/html-utils.ts          (char truncation)
  ├── animate-utils.ts            (sleep, cursor)
  └── pressure.ts                 (block-boundary timing)

tool-animate.ts
  ├── reveal/orchestrator.ts      (typing loop)
  ├── animate-utils.ts            (sleep, cursor)
  └── pressure.ts                 (chunk-boundary timing)

catalog.ts                          ← REPLACES segmentCatalog.ts
  ├── chunk-strategies/*.ts        (imported once, stored in entries)
  ├── renderers                    (imported once, stored in entries)
  └── transforms                   (imported once, stored in entries)

--- LEAF MODULES (no project imports) ---
text/speed-attenuator.ts
text/html-utils.ts
text/chunk-boundary.ts
text/renderers/*.ts                 (import only ../transforms and ./types)
chunk-strategies/*.ts               (import only ./types)
pressure.ts
animate-utils.ts
timing.ts
```

Every arrow points down. No cycles. No sideways imports between submodules.

---

## 11. File Inventory

### 11a. New files

| File | Role | Level |
|------|------|-------|
| `lib/segment-controller.ts` | Segment-level controller: catalog lookup, pipeline routing, segment-boundary pressure | Level 1 |
| `lib/tool-animate.ts` | Tool-level controller: strategy → transform → render → reveal, chunk-boundary pressure | Level 2b |
| `lib/catalog.ts` | Unified tool type registry: all entries, lookup by type or tag, holds all submodule references | Data |

### 11b. Files that shrink

| File | What gets removed |
|------|-------------------|
| `components/LiveSegmentRenderer.tsx` | All orchestration logic. Becomes thin React shell. |
| `lib/segmentCatalog.ts` | Replaced by `catalog.ts`. Delete after migration. |
| `lib/chunk-strategies/index.ts` | Switch statement replaced by catalog lookup. Delete. |
| `lib/segment-renderers/index.ts` | Switch statement replaced by catalog lookup. Delete. |
| `lib/reveal/index.ts` | Dispatch logic replaced by catalog + tool-animate. Delete. |

### 11c. Files unchanged

| File | Why |
|------|-----|
| `lib/text/text-animate.ts` | Already a proper Level 2a controller. |
| `lib/text/index.ts` | Parser. Called by text-animate.ts. Pure. |
| `lib/text/chunk-buffer.ts` | Queue. Called by text-animate.ts. Pure. |
| `lib/text/speed-attenuator.ts` | Math. Called by buffer. Pure. |
| `lib/text/html-utils.ts` | String manipulation. Called by text-animate.ts. Pure. |
| `lib/text/renderers/*.ts` | Per-block-type HTML. Called by parser. Pure. |
| `lib/text/chunk-boundary.ts` | Boundary detection. Called by parser. Pure. |
| `lib/pressure.ts` | Timing profiles. Called by controllers. Pure. |
| `lib/animate-utils.ts` | sleep, cursor. Called by controllers. Pure. |
| `lib/timing.ts` | Constants. Pure. |
| `lib/reveal/orchestrator.ts` | Tool typing loop. Called by tool-animate.ts. Pure. |
| `lib/chunk-strategies/{type}.ts` | Per-tool chunking. Referenced by catalog. Pure. |

---

## 12. Migration Path

Incremental. Each step is independently testable. No big bang.

### Step 1: Create catalog.ts

Merge data from `segmentCatalog.ts`, `chunk-strategies/index.ts`, `segment-renderers/index.ts`, and `reveal/index.ts` into one registry. Export `lookup(type)` and `lookupByTag(tag)`. Include transform and speed fields. Old files remain temporarily — they can re-export from catalog during migration.

### Step 2: Define TaggedChunk interface

Create the shared `TaggedChunk` type. Update chunk strategies to emit tagged chunks instead of raw strings. The text parser already returns `ParsedBlock` — align it with TaggedChunk or adapt at the boundary.

### Step 3: Create tool-animate.ts

Extract tool orchestration from LiveSegmentRenderer.tsx into a pure async function. It reads from the catalog entry (strategy, transform, renderer, speed). Implements the four-step pipeline: chunk → transform → render → type. Handles `awaitsResult` hold logic.

### Step 4: Create segment-controller.ts

Extract segment dispatch from LiveSegmentRenderer.tsx. Receives a segment, looks up the catalog, routes to text-animate.ts or tool-animate.ts, handles segment-boundary pressure.

### Step 5: Thin out LiveSegmentRenderer.tsx

LiveTextSegment and LiveToolSegment become pure React shells. State, refs, one useEffect that calls the controller, JSX return. Nothing else.

### Step 6: Delete old dispatch files

Remove `segmentCatalog.ts`, `chunk-strategies/index.ts` switch logic, `segment-renderers/index.ts` switch logic, `reveal/index.ts` dispatch logic. The catalog is the sole registry.

### Step 7: Add speed tiers and line-end deceleration

Add `speed` fields to catalog entries (shell = 'fast', think = 'slow', etc.). Implement line-end deceleration in the typing loop as a universal behavior.

### Step 8: Wire tool result holding

Implement `awaitsResult` in singleChunkStrategy. The strategy accumulates content, holds until `onResult` is called, then emits. Add timeout fallback with `flush()`.

---

## 13. Verification

1. **Build:** `npx vite build` succeeds
2. **Type-check:** `npx tsc --noEmit` passes
3. **Text typing:** Bold/italic/code render mid-type inside pre-rendered HTML
4. **Code fences in text:** Hold until closing ```, then type inside `<pre><code>`
5. **Code in think blocks:** Stays gray and flat. No syntax highlighting. No code promotion.
6. **Tool segments:** Shell, read, write, edit, grep, glob all render correctly
7. **Speed tiers:** Shell renders fast. Think renders slow. Text respects attenuator.
8. **Line-end deceleration:** Visible micro-pause at end of every line, even in fast mode
9. **Pressure:** Heavy backlog forces instantReveal across all types
10. **Tool result holding:** Write/edit show shimmer while streaming, resolve to content/diff on result
11. **Timeout fallback:** If tool result never arrives, content renders without enrichment after 10s
12. **File path labels:** Tool dropdowns show `.../parent/filename.ext`, tooltip shows full path
13. **File paths in text:** Full path preserved, monospace, copy-pasteable
14. **New tool test:** Add a fake catalog entry, verify it works without touching any controller
15. **No stalls:** Cursor never hangs mid-block
16. **Stop button:** Finalizes instantly across both pipelines

---

## 14. Design Decisions

### Why one catalog instead of four registries?

Four files answering the same question ("what do I do with this type?") drift independently. One catalog is one place to add, remove, or modify a tool type. The controller asks one question, gets one answer.

### Why fractal controllers?

Same pattern at every level makes the system predictable. When debugging, you find the controller at the relevant level and read it. It shows all routing. The submodules below it are pure and isolated. You never have to trace through multiple files to understand how routing works.

### Why extract to pure functions instead of React hooks?

React hooks can only be called inside components. Pure async functions can be called from anywhere — components, tests, other controllers. The segment controller doesn't need `useState` or `useEffect`. It needs to receive a segment and return when it's done typing. That's a function, not a hook.

### Why tagged chunks instead of raw strings?

The chunker already knows what each chunk is — it found the boundaries. Discarding that knowledge and forcing the renderer to re-discover it is wasted work and a coupling risk. Tagged chunks let the parsing happen once, upstream, and flow downstream as metadata.

### Why parent type overrides content shape?

A code fence inside a think block is think content, not code content. If the renderer scans for fences and promotes them to syntax-highlighted code, it overrides the intent of the think block. The parent type is the source of truth. The chunker knows the parent. It tags accordingly.

### Why three renderers (text, code, think) not one?

One renderer with branching for every content type becomes a god module. Three renderers with clear responsibilities are each simple and testable. The tagged chunk's `block` field picks the renderer. No branching in the renderer itself.

### Why speed overrides in the catalog instead of the attenuator?

"Shell is always fast" is a property of shell, not a property of the speed system. The attenuator is a pure function of queue state — it shouldn't know what tool types exist. The catalog is where tool-type-specific knowledge lives. The controller checks the catalog first, falls through to the attenuator only if the catalog doesn't have an opinion.

### Why no 'instant' speed tier?

Even fast output needs line-end deceleration. Truly instant (paste everything, no animation) is an emergency behavior owned by the pressure system (`instantReveal`), not a speed preference. The catalog says "how fast to type." The pressure system says "whether to type at all."

### Why line-end deceleration is universal?

It's always correct. Fast output with uniform character speed looks like a dump. The micro-pause at line endings gives visual rhythm — the eye catches the break. No tool type benefits from removing it. It's a typing loop behavior, not a per-tool decision.

### Why hold write/edit until tool result?

The interesting render for write/edit is the diff — what changed. The diff requires both before and after states. The after state isn't confirmed until the tool result arrives. Rendering before that is showing content that might not land on disk. The hold makes the display truthful.

### Why the chunker holds, not the buffer?

The chunker is where completeness knowledge lives. The text chunker knows "this code fence isn't closed yet." The write chunker knows "the tool result hasn't arrived yet." The buffer is a dumb FIFO — it shouldn't contain hold logic. Each strategy defines its own completeness condition.

### Why transform is always called (not conditionally)?

The controller doesn't check whether a transform is needed. It always calls what the catalog provides. If the catalog entry has no transform, the chunk passes through unchanged. This eliminates conditional logic in the controller. The decision was made at registration time, not runtime.

### Why does the catalog import submodules but nothing else does?

The catalog is a registry — it holds references to strategies, transforms, and renderers. The controller asks the catalog for an entry, then calls the submodules directly. The chunker doesn't import the catalog. The renderer doesn't import the catalog. The transform doesn't import the catalog. The controller is the only bridge. Submodule files have zero coupling to the registry system.

### Why is text just another catalog entry?

Special-casing text means the chunker has `if (type === 'text')` branches. That's one more place that knows about types instead of looking them up. Text has a strategy (markdown block parsing), a renderer (markdown → HTML), and default speed (attenuator-driven). It fits the same interface as every other tool. No special case needed.

### Why pressure overrides everything?

Pressure is the system's emergency valve. If 15 segments are queued and the user is waiting, it doesn't matter that the catalog says "think = slow." The system needs to catch up. `instantReveal` is the circuit breaker. This is explicitly checked first in the controller's speed hierarchy.

### Why per-segment pipelines instead of a global pipeline?

A write segment holding for a tool result shouldn't block the text segment behind it from processing. Each segment gets its own strategy instance, its own buffer, its own pipeline. Display order is still sequential (segment 2 waits for segment 1 to finish), but processing is concurrent.
