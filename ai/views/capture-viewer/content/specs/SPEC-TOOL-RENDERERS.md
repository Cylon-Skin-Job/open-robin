---
title: Tool Renderer Spec — Per-Tool Content Modules
created: 2026-03-29
status: active
parent: MASTER_SYSTEM_SPEC.md
---

# Tool Renderer Spec

How each tool call type renders its content inside the shared ToolCallBlock shell. The shell handles orchestration (shimmer, expand, collapse). The renderer handles what goes inside.

---

## Architecture

```
LiveToolSegment (shared orchestration)
  ├── Icon fade-in
  ├── Label shimmer (text from renderer.buildTitle)
  ├── Content area expand
  ├── Renderer: render content (delegated to module)
  ├── Renderer: check grouping (singular vs grouped)
  ├── Post-typing pause
  ├── Collapse animation
  └── onDone → next segment

ToolRenderer (per-tool module)
  ├── grouped: boolean
  ├── buildTitle(itemCount, args) → string
  ├── renderItem(content, args) → string | JSX
  └── shouldConsumeNext(currentType, nextType) → boolean
```

Zero type-specific code in LiveToolSegment. All presentation decisions come from the renderer module.

---

## Two Fundamental Tool Call Types

### Singular

One tool call → render its content → collapse. The closing tag ends the block.

**Tools:** think, shell, write, edit, subagent, todo

### Grouped

Look ahead for same-type tool calls → clump into one block → render each item as a line → counter updates in title → collapse when a different type appears.

**Tools:** read, glob, grep, web_search, fetch

### Completion Gates

| Type | Block is complete when... |
|------|--------------------------|
| **Singular** | Closing tag received for this tool call |
| **Grouped** | Next tool call is a DIFFERENT type (or turn ends) |

For grouped tools, the closing tag of one read does NOT collapse the block. The system peeks at the next segment. If it's another read, consume it into the same block. If it's different (or end of turn), collapse.

---

## Renderer Module Interface

```typescript
interface ToolRenderer {
  /** Does this renderer consume multiple consecutive same-type segments? */
  grouped: boolean;

  /**
   * Build the title text displayed next to the icon.
   * Called on mount and again each time a new item is consumed (grouped).
   *
   * @param itemCount - Number of items rendered so far (1 for singular, N for grouped)
   * @param args - Tool arguments from the segment (file_path, pattern, url, etc.)
   */
  buildTitle(itemCount: number, args?: Record<string, unknown>): string;

  /**
   * Render one item's content within the tool block.
   * For singular tools: called once with the full content.
   * For grouped tools: called once per consumed segment.
   *
   * @param content - The tool call's content/output
   * @param args - Tool arguments (file_path, pattern, expression, etc.)
   * @returns HTML string or raw text to display
   */
  renderItem(content: string, args?: Record<string, unknown>): string;

  /**
   * Content container styles (applied to the wrapper div inside ToolCallBlock).
   * Lets each renderer control typography without hardcoding in the shell.
   */
  contentStyle: {
    fontFamily: 'monospace' | 'inherit';
    fontStyle: 'italic' | 'normal';
    fontSize?: string;
    color?: string;
  };

  /**
   * Whether to show the typing cursor during reveal.
   * Most tools show it. Grouped-summary tools that render instantly don't.
   */
  showCursor: boolean;

  /**
   * For grouped renderers: should we consume the next segment into this block?
   * Called after each item's closing tag arrives. Peek at the next segment type.
   *
   * @param nextType - The segment type of the next tool call in the stream
   * @returns true to consume into this block, false to collapse
   */
  shouldConsumeNext?(nextType: string): boolean;
}
```

---

## Renderer Modules

### think — Plain Text Blocks

**Type:** Singular
**Render mode:** Paragraphs of text. No headers, no code blocks, no special formatting. Indentation preserved. Everything is gray italic — visually distinct from the main assistant text.

```
renderers/think.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `false` |
| `buildTitle` | `() => 'Thinking'` (static, never changes) |
| `contentStyle.fontFamily` | `'inherit'` |
| `contentStyle.fontStyle` | `'italic'` |
| `contentStyle.color` | `'var(--text-dim)'` |
| `showCursor` | `true` |

**Reveal behavior:** Line-stream. Content streams in as paragraphs separated by `\n\n` or single lines separated by `\n`. Each chunk types out character by character with the speed attenuator (fast if next chunk buffered, slow if not).

**Content formatting:** Raw text. No markdown parsing. No code block decoration even if thinking contains code snippets. Just preserve indentation and line breaks.

**Why separate from text:** Text segments use markdown parsing with headers, code fences, lists. Thinking intentionally skips all of that — it's internal reasoning, not presentation content.

---

### shell — Monospace Stream

**Type:** Singular
**Render mode:** Line-by-line monospace output. Preserves exact formatting. Like a terminal.

```
renderers/shell.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `false` |
| `buildTitle` | `() => 'shell'` (static) |
| `contentStyle.fontFamily` | `'monospace'` |
| `contentStyle.fontStyle` | `'normal'` |
| `contentStyle.fontSize` | `'13px'` |
| `showCursor` | `true` |

**Reveal behavior:** Line-stream. Each line types out, newlines are chunk boundaries. Speed attenuator applies.

**Content formatting:** Raw monospace text. No syntax highlighting. Preserves all whitespace and indentation exactly as received.

**Note:** Shell output can be long. Consider max-height with scroll for expanded state. When collapsed, show first 2-3 lines as preview.

---

### read — File List (Grouped)

**Type:** Grouped
**Render mode:** Each consumed read becomes one line showing filename + truncated path. Title updates with count.

```
renderers/read.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `true` |
| `buildTitle(n)` | `n === 1 ? 'reading' : \`reading (${n} files)\`` |
| `contentStyle.fontFamily` | `'monospace'` |
| `contentStyle.fontStyle` | `'normal'` |
| `contentStyle.fontSize` | `'13px'` |
| `showCursor` | `false` (items appear instantly, no typing animation) |
| `shouldConsumeNext(next)` | `next === 'read'` |

**Title animation:** Title starts as "reading". As each file is consumed, updates to "reading (2)", "reading (3 files)". The number increments live in the shimmer label.

**Content per item:**
```
filename.ts    ~/project/.../src/lib/filename.ts
```

**Path truncation logic:**
- Always show the filename
- Always show the project-relative root
- If path is too long, truncate the middle with `...`
- Target: fits on one line at typical panel width
- Example: `secrets.js    kimi-ide-server/.../lib/secrets.js`

**Reveal behavior:** No typing animation. Each file line appears instantly when consumed. The "activity" is the counter incrementing and new lines appearing, not character-by-character typing.

---

### glob — File/Folder List (Grouped)

**Type:** Grouped
**Render mode:** Very similar to read — each glob result is one line. But shows the pattern matched, not file contents.

```
renderers/glob.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `true` |
| `buildTitle(n)` | `n === 1 ? 'glob' : \`glob (${n} results)\`` |
| `contentStyle.fontFamily` | `'monospace'` |
| `contentStyle.fontStyle` | `'normal'` |
| `contentStyle.fontSize` | `'13px'` |
| `showCursor` | `false` |
| `shouldConsumeNext(next)` | `next === 'glob'` |

**Content per item:** File path or folder path, one per line. Could share the path truncation logic with `read`.

**Note:** Glob and read are very similar. Could share a base `fileListRenderer` with different title builders. But keep as separate files so they can diverge.

---

### grep — Search Results (Grouped)

**Type:** Grouped
**Render mode:** Pattern + matching lines with context.

```
renderers/grep.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `true` |
| `buildTitle(n)` | `n === 1 ? 'grep' : \`grep (${n} results)\`` |
| `contentStyle.fontFamily` | `'monospace'` |
| `contentStyle.fontStyle` | `'normal'` |
| `contentStyle.fontSize` | `'13px'` |
| `showCursor` | `false` |
| `shouldConsumeNext(next)` | `next === 'grep'` |

**Content per item:** File path + matched line(s). Format TBD — could show just the path, or path + line number + snippet.

---

### write — Code Block (Singular)

**Type:** Singular
**Render mode:** Full code display with syntax highlighting. Language detected from file path.

```
renderers/write.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `false` |
| `buildTitle(_, args)` | Filename from `args.file_path` (e.g., `'write server.js'`) |
| `contentStyle.fontFamily` | `'monospace'` |
| `contentStyle.fontStyle` | `'normal'` |
| `contentStyle.fontSize` | `'13px'` |
| `showCursor` | `true` |

**Reveal behavior:** Line-stream. Code types out line by line. After completion, syntax highlighting is applied to the full block.

**Content formatting:** Wrapped in a code container with dark background (`var(--bg-code)`). Language detection from file extension in `args.file_path`.

**Future:** Syntax highlighting via Prism or Shiki. For now, monospace with no coloring.

---

### edit — Diff View (Singular)

**Type:** Singular
**Render mode:** Red/green diff lines showing what changed.

```
renderers/edit.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `false` |
| `buildTitle(_, args)` | Filename from `args.file_path` (e.g., `'edit server.js'`) |
| `contentStyle.fontFamily` | `'monospace'` |
| `contentStyle.fontStyle` | `'normal'` |
| `contentStyle.fontSize` | `'13px'` |
| `showCursor` | `true` |

**Reveal behavior:** Line-stream. Each diff line types out.

**Content formatting:** Per-line coloring:
- Lines starting with `+` → green text (#4ade80), subtle green background
- Lines starting with `-` → red text (#f87171), subtle red background
- Context lines → default color

**Note:** The DiffContent component already exists inline in LiveSegmentRenderer.tsx. Extract it into this module.

---

### web_search — URL List (Grouped)

**Type:** Grouped
**Render mode:** Search queries and result URLs, one per line.

```
renderers/web-search.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `true` |
| `buildTitle(n)` | `n === 1 ? 'web_search' : \`web_search (${n})\`` |
| `contentStyle.fontFamily` | `'monospace'` |
| `contentStyle.fontStyle` | `'normal'` |
| `showCursor` | `false` |
| `shouldConsumeNext(next)` | `next === 'web_search'` |

**Content per item:** Query or URL, truncated to fit one line.

---

### fetch — URL Display (Grouped)

**Type:** Grouped
**Render mode:** URLs fetched, one per line.

```
renderers/fetch.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `true` |
| `buildTitle(n)` | `n === 1 ? 'fetch' : \`fetch (${n})\`` |
| `contentStyle.fontFamily` | `'monospace'` |
| `contentStyle.fontStyle` | `'normal'` |
| `showCursor` | `false` |
| `shouldConsumeNext(next)` | `next === 'fetch'` |

**Note:** Could share renderer with web_search. Keep separate for future divergence.

---

### subagent — Agent Output (Singular)

**Type:** Singular
**Render mode:** Line-by-line streaming, similar to thinking but not italic.

```
renderers/subagent.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `false` |
| `buildTitle` | `() => 'subagent'` |
| `contentStyle.fontFamily` | `'inherit'` |
| `contentStyle.fontStyle` | `'normal'` |
| `showCursor` | `true` |

**Reveal behavior:** Line-stream, same as think/shell.

---

### todo — Task List (Singular)

**Type:** Singular
**Render mode:** Line-by-line streaming.

```
renderers/todo.ts
```

| Property | Value |
|----------|-------|
| `grouped` | `false` |
| `buildTitle` | `() => 'todo'` |
| `contentStyle.fontFamily` | `'inherit'` |
| `contentStyle.fontStyle` | `'normal'` |
| `showCursor` | `true` |

**Reveal behavior:** Line-stream.

---

## Grouping Mechanics

### How Grouping Works in the Stream

The stream delivers segments one at a time. For grouped tools, the renderer consumes multiple consecutive segments into one visual block.

```
Stream arrives:      read(file1) → read(file2) → read(file3) → think → ...
                     ──────────────────────────   ─────
                     ONE grouped block              Next block (singular)

UI shows:
  ┌─────────────────────────────────────┐
  │ 📄 reading (3 files)                │  ← title updated live
  │                                     │
  │ secrets.js    .../lib/secrets.js     │  ← item 1 (appeared first)
  │ config.js     .../lib/config.js     │  ← item 2 (appeared second)
  │ auth.js       .../lib/auth.js       │  ← item 3 (appeared third)
  └─────────────────────────────────────┘
  (collapses because next segment is 'think', not 'read')
```

### Grouping Decision Flow

```
Segment N closing tag arrives
    ↓
Is this a grouped renderer?
    ├── NO → collapse, next segment
    └── YES → peek at segment N+1
                ├── N+1 is same type → consume into this block, increment counter
                └── N+1 is different type (or end of turn) → collapse, next segment
```

### Title Counter Update

For grouped renderers, the title updates live as items are consumed:

```
Item 1 arrives:  "reading"
Item 2 arrives:  "reading (2)"
Item 3 arrives:  "reading (3 files)"
```

The shimmer stays active during grouping (the block is still "working"). It only stops when the block starts collapsing.

### Implementation in LiveToolSegment

The shared `LiveToolSegment` orchestration needs to be aware of grouping but not implement it:

```typescript
// In LiveToolSegment's reveal phase:
const renderer = getToolRenderer(segment.type);

if (renderer.grouped) {
  // Grouped: render items, consume next same-type segments
  await revealGrouped(renderer, segments, currentIndex, contentRef, setDisplayedContent, cancelRef);
} else {
  // Singular: render content, standard reveal
  await revealSingular(renderer, contentRef, setDisplayedContent, cancelRef, completeRef);
}
```

`revealGrouped` handles the peek-ahead and consumption. `revealSingular` is the existing reveal system (orchestrator + parser).

---

## File Structure

```
src/lib/tool-renderers/
  index.ts              ← registry: getToolRenderer(segmentType) → ToolRenderer
  types.ts              ← ToolRenderer interface
  think.ts
  shell.ts
  read.ts
  glob.ts
  grep.ts
  write.ts
  edit.ts
  web-search.ts
  fetch.ts
  subagent.ts
  todo.ts
  shared/
    file-list.ts        ← shared logic for read/glob (path truncation, line formatting)
    url-list.ts         ← shared logic for web_search/fetch
    diff.ts             ← DiffContent component (extracted from LiveSegmentRenderer)
```

The registry maps segment types to renderer modules. LiveToolSegment calls `getToolRenderer()` and uses the returned module for all presentation decisions.

---

## Migration from Current Code

### What moves out of LiveSegmentRenderer.tsx

1. **DiffContent component** → `tool-renderers/shared/diff.ts`
2. **Inline fontStyle/fontFamily checks** → each renderer's `contentStyle`
3. **`segment.type === 'think'` italic check** → `think.ts` contentStyle
4. **`renderMode === 'diff'` special case** → `edit.ts` renderItem

### What stays in LiveSegmentRenderer.tsx

1. `LiveToolSegment` — the shared orchestration (shimmer → reveal → collapse → done)
2. `LiveTextSegment` — text content rendering (separate from tools)
3. The `sleep()` and `typeText()` helpers
4. Phase state machine (`shimmer | revealing | collapsing | done`)

### What stays in segmentCatalog.ts

1. Visual identity (icon, icon color, label color, border styling)
2. Error styles
3. The `groupable` flag (now also on the renderer, but catalog is the source of truth)
4. `renderMode` (still used for reveal dispatch — line-stream vs grouped-summary)

### What moves from segmentCatalog.ts to renderers

1. `LABEL_BUILDERS` → each renderer's `buildTitle` (with dynamic counter support)
2. `contentTypography` → each renderer's `contentStyle`
3. `summaryField` → each grouped renderer knows which arg to display

---

## Relationship to Existing Reveal System

The reveal system (`lib/reveal/`) handles HOW content appears (typing speed, chunking, stall prevention). The tool renderers handle WHAT the content looks like. They're complementary:

```
ToolRenderer.renderItem()     → WHAT to display (formatted HTML/text)
reveal.run()                  → HOW to display it (typing animation, speed)
```

For **singular** tools: the reveal system handles the typing animation as-is. The renderer just provides the content style and formatting.

For **grouped** tools: the reveal system is not used (items appear instantly). The renderer handles everything — item formatting, counter updates, consumption of next segments.

---

## Summary Table

| Tool | Type | Title | Content | Cursor | Shared with |
|------|------|-------|---------|--------|-------------|
| think | singular | "Thinking" | Plain text paragraphs, italic gray | yes | — |
| shell | singular | "shell" | Monospace line stream | yes | — |
| read | grouped | "reading (N files)" | File paths, truncated, one per line | no | glob (file-list) |
| glob | grouped | "glob (N results)" | File paths, one per line | no | read (file-list) |
| grep | grouped | "grep (N results)" | File + match context | no | — |
| write | singular | "write filename" | Syntax highlighted code | yes | — |
| edit | singular | "edit filename" | Red/green diff lines | yes | — |
| web_search | grouped | "web_search (N)" | URLs, one per line | no | fetch (url-list) |
| fetch | grouped | "fetch (N)" | URLs, one per line | no | web_search (url-list) |
| subagent | singular | "subagent" | Line stream, normal text | yes | — |
| todo | singular | "todo" | Line stream, normal text | yes | — |

---

## TODO

- [ ] Define ToolRenderer interface in `lib/tool-renderers/types.ts`
- [ ] Create registry in `lib/tool-renderers/index.ts`
- [ ] Implement think.ts (first — known-good baseline)
- [ ] Implement shell.ts
- [ ] Implement read.ts + shared/file-list.ts (path truncation)
- [ ] Implement glob.ts (reuse file-list)
- [ ] Implement write.ts
- [ ] Implement edit.ts + shared/diff.ts (extract DiffContent)
- [ ] Implement grep.ts
- [ ] Implement web-search.ts + shared/url-list.ts
- [ ] Implement fetch.ts (reuse url-list)
- [ ] Implement subagent.ts, todo.ts
- [ ] Update LiveToolSegment: remove all inline type checks, delegate to renderer
- [ ] Update LiveToolSegment: add grouped reveal path (revealGrouped)
- [ ] Move LABEL_BUILDERS from segmentCatalog to renderers
- [ ] Move contentTypography/summaryField from catalog to renderers
- [ ] Verify: thinking block renders identically after refactor
- [ ] Verify: grouped tools (read, glob) show counter in title and consume consecutive segments
