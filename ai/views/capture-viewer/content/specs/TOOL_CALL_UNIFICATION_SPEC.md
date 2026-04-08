# Tool Call Unification Spec — Single Rendering Paradigm

**Status:** DRAFT — Awaiting approval
**Date:** 2026-03-19
**Supersedes:** Phases 2–5 of `SEGMENT_DEFINITIONS_SPEC.md`
**Context:** The inline vs collapsible tool call distinction introduced visual inconsistency and label rewriting that obscures tool identity. This spec eliminates both.

---

## 1. Problem Statement

### 1a. Tool names are being rewritten

Labels are generated in **three separate places**, all drifting from each other:

| Location | What it does |
|----------|-------------|
| `instructions.ts` — `SEGMENT_ICONS` | Defines icon + label pairs (e.g. `{ icon: 'terminal', label: 'Shell' }`) |
| `instructions.ts` — `toolLabel()` | Rewrites labels with args (e.g. `Running \`ls -la\``) |
| `segmentCatalog.ts` — `LABEL_BUILDERS` | Does the same rewriting independently |
| `useWebSocket.ts` — `getToolIcon()` + `getLabelForType()` | A third icon/label map for history loading |

Result: the tool name `shell` never appears. Instead the user sees `Running \`ls -la\`` or `Shell` depending on which path rendered it.

| Raw tool name | What renders | What should render |
|---------------|-------------|-------------------|
| `shell` | `Running \`ls -la\`` | `shell` |
| `read` | `Read \`/path/to/file\`` | `read` |
| `write` | `Write \`/path/to/file\`` | `write` |
| `edit` | `Edit \`/path/to/file\`` | `edit` |
| `glob` | `Find \`*.ts\`` | `glob` |
| `grep` | `Search \`pattern\`` | `grep` |
| `web_search` | `Search \`query\`` | `web_search` |
| `fetch` | `Fetch \`url\`` | `fetch` |
| `subagent` | `Task: description` | `subagent` |
| `todo` | `Planning` | `todo` |

Tool arguments (command, path, pattern) belong **inside the collapsible content area**, not baked into the header label.

### 1b. Two rendering paradigms exist where one should

`getSegmentCategory()` (defined independently in both `segmentCatalog.ts` and `instructions.ts`) routes tool calls into collapsible vs inline:

- **collapsible** → think, shell, write, edit — header + expandable content
- **inline** → read, glob, grep, web_search, fetch, subagent, todo — compact one-liner

Both renderers implement this split with separate components:

| Renderer | Collapsible component | Inline component |
|----------|----------------------|-----------------|
| `MessageList.tsx` | `CollapsibleChunk` | `InlineChunk` |
| `SimpleBlockRenderer.tsx` | `CollapsibleBlock` | `InlineToolBlock` |

### 1c. Two parallel data pipelines feed two renderers — DOUBLE RENDERING BUG

Both are mounted simultaneously in `ChatArea.tsx` inside the same `.chat-messages` scrollable div:

| Pipeline | Data flow | Renderer |
|----------|-----------|----------|
| Segment store | `useWebSocket.ts` → pushSegment/appendSegment → Zustand store | `MessageList.tsx` |
| Accumulator + queue | `useWebSocket.ts` → `ContentAccumulator` → `SimpleQueue` | `SimpleBlockRenderer.tsx` |

Both receive the same wire messages and **render the same tool calls twice** into the same scroll container. This is the root cause of visual inconsistency — two independent renderers with different animation lifecycles, different label logic, and no coordination between them.

Only `MessageList` is connected to the `finalizeTurn` / `pendingTurnEnd` / scroll / spacer machinery. `SimpleBlockRenderer` runs independently with no connection to any of that.

`SimpleBlockRenderer` was added by a prior Claude Code session that built a new system instead of extending the existing one. It must be removed.

### 1d. Three render contexts exist

| Context | When | Expected behavior |
|---------|------|-------------------|
| **Live/streaming** | Claude is actively responding | Shimmer → type content → collapse → advance to next block |
| **History/instant** | User clicks on a different thread | Render everything immediately, collapsed, no animation |
| **User toggle** | User clicks a collapsed/expanded header | Expand or collapse on demand |

`MessageList.tsx` handles this via `isLive` prop. `SimpleBlockRenderer.tsx` is always live — it has no history path.

### 1e. Grouping behavior is trapped in the removed pipeline

`ContentAccumulator` groups consecutive tool calls of the same type (read, glob, grep, web_search, fetch) into a single block. This is the feature that triggered the entire refactor — getting grouping to work is why the code is in its current state.

The grouping logic currently:
- On first `tool_call` of a groupable type → creates a block, enters `tool-group` state
- On subsequent same-type `tool_call` → increments count, updates header to show `(N files)`
- On `tool_result` for a grouped call → appends one line (file path, pattern, etc.) to the block
- Group stays open until a **different type arrives**, **text arrives**, or **turn ends**

This logic lives only in `ContentAccumulator` — the pipeline being removed. The segment store (Zustand) has no grouping. Each `tool_call` → `pushSegment()` creates a separate segment. Without intervention, removing the accumulator kills grouping.

**Grouping must be preserved.** It must migrate to the surviving pipeline.

---

## 2. Design Decision

### 2a. One visual paradigm for all tool calls

```
┌──────────────────────────────────────────────┐
│ [icon]  tool_name                        [▶] │  ← header (always visible)
├──────────────────────────────────────────────┤
│ │ content: arguments, output, file paths,    │  ← collapsible content area
│ │ command output, etc.                       │
│ │                                            │
└──────────────────────────────────────────────┘
```

- **Header:** Icon (from catalog) + literal tool name (e.g. `shell`, `read`, `glob`)
- **Content:** Tool arguments, results, file paths — whatever the tool produced
- **Behavior:** Collapsible. Expanded during live animation, collapses when done. User can toggle.
- **No exceptions.** Even if the content is a single line.

### 2b. Extract `ToolCallBlock` component

A single, shared component used by both renderers (and any future renderer):

```typescript
interface ToolCallBlockProps {
  type: SegmentType;          // tool name = header label
  content: string;            // what goes in the collapsible area
  isError?: boolean;          // error styling from catalog
  mode: 'live' | 'instant';  // live = animate, instant = render complete
  onComplete?: () => void;    // signal animation finished (live mode only)
}
```

**`mode: 'live'`** — shimmer → reveal content → collapse → call `onComplete()`
**`mode: 'instant'`** — render collapsed immediately, no animation, call `onComplete()` synchronously

User toggle (expand/collapse on click) works in both modes after initial render.

**Flush on turn end:** When `turn_end` arrives, any `ToolCallBlock` still mid-animation must fast-forward — show all remaining content immediately, collapse, call `onComplete()`. Without this, the `finalizeTurn` chain stalls waiting for animations to finish. Implementation options:
- `ToolCallBlock` detects that its content is complete and no more is coming → skips remaining animation
- `MessageList` passes a `flush` signal when `pendingTurnEnd` is true
- Either way, `onComplete()` must fire promptly after turn end, not after the full animation duration

### 2c. Single source of truth for icons and labels

`instructions.ts` already has `SEGMENT_ICONS` with the correct icon + label pairs. This is the one source. The label rewriting in `toolLabel()`, the `LABEL_BUILDERS` in `segmentCatalog.ts`, and the `getToolIcon()`/`getLabelForType()` in `useWebSocket.ts` are all eliminated or simplified to return the raw name.

### 2d. Grouping as a catalog property, not a rendering paradigm

Grouping is a behavioral property of the tool type — "does this tool wait for more of the same before closing?" It has nothing to do with how the tool renders. Every tool call still renders identically (icon + name + collapsible content). The only difference is in the data layer.

#### New catalog property: `groupable`

```typescript
/** Whether consecutive calls of this type merge into one segment */
groupable: boolean;
```

Added to `SegmentBehavior` in `segmentCatalog.ts`:

| Tool type | `groupable` | Why |
|-----------|------------|-----|
| `think` | `false` | One thinking block per thinking phase |
| `shell` | `false` | Each shell command is independent |
| `read` | `true` | 5 consecutive reads → one block listing 5 paths |
| `write` | `false` | Each write is a distinct file operation |
| `edit` | `false` | Each edit is a distinct file operation |
| `glob` | `true` | Consecutive glob patterns merge |
| `grep` | `true` | Consecutive grep searches merge |
| `web_search` | `true` | Consecutive searches merge |
| `fetch` | `true` | Consecutive fetches merge |
| `subagent` | `false` | Each agent task is independent |
| `todo` | `false` | One planning block |

#### Grouping state machine in `useWebSocket.ts`

A lightweight tracker replaces the accumulator's grouping logic. It lives in the WebSocket handler, between the wire and the segment store:

```typescript
// Grouping state — tracks whether we're accumulating same-type tool calls
let activeGroupType: SegmentType | null = null;
let activeGroupSegmentIndex: number = -1;
let activeGroupToolCallIds: string[] = [];
let activeGroupCount: number = 0;
```

**On `tool_call`:**
1. Look up `groupable` from the catalog for this tool type
2. If `groupable` AND same type as `activeGroupType`:
   - Don't push a new segment — track the `toolCallId` for later result matching
   - Increment count
3. If `groupable` AND different type (or first groupable call):
   - Close any existing group (mark segment complete)
   - Push a new segment, record its index as `activeGroupSegmentIndex`
   - Set `activeGroupType`, reset count to 1
4. If NOT `groupable`:
   - Close any existing group
   - Push a new segment (solo tool call)

**On `tool_result`:**
1. If `toolCallId` belongs to the active group:
   - Append a content line to the group segment (file path, pattern, etc.)
   - Don't close the group — more may come
2. Otherwise:
   - Find the matching segment by `toolCallId` and update it normally

**Group closes when:**
- A `tool_call` of a **different type** arrives
- A `content` or `thinking` message arrives
- `turn_end` arrives

**The renderer never knows.** `ToolCallBlock` receives a segment with type `read`, content that happens to be 5 file paths, and renders it like any other tool call. Grouping is invisible to the rendering layer.

#### Wire timing: `toolArgs` arrives late

`tool_call` only carries `toolName` and `toolCallId`. The actual arguments (file path, command, pattern) arrive later in `tool_result` as `toolArgs`. This means:

- On `tool_call` for a groupable type: create/extend the group segment, track the `toolCallId`, but **do not attempt to read args** — they don't exist yet
- On `tool_result`: extract the display line from `toolArgs` (e.g., `args.file_path` for read, `args.pattern` for glob) and append it to the group segment's content
- For solo tools: content area is empty between `tool_call` and `tool_result` — this is intentional. `ToolCallBlock` shows shimmer during this gap, then reveals content when the result arrives

#### History path

When loading thread history via `convertPartToSegment()`, grouping has already happened at storage time. Each part in the history is already a discrete unit. No re-grouping needed — the segments load as-is.

### 2e. Single renderer — `SimpleBlockRenderer` removed

`SimpleBlockRenderer.tsx`, `SimpleQueue` (`simpleQueue.ts`), and `ContentAccumulator` (`contentAccumulator.ts`) are removed. `MessageList.tsx` is the single renderer.

**What migrates from the accumulator:**
- Fence detection (code block boundary detection) — already handled by `chunkParser.ts`
- Tool grouping (consecutive same-type reads/globs) — needs to move into the segment store or a lightweight middleware
- The orb is not a rendering concern — it stays in `ChatArea` as a standalone element that appears on send and disappears when first content arrives

**Also removed: Ribbon and `renderPhase` state machine**

The Ribbon was supposed to be replaced by the orb. It's already orphaned — nothing imports it. The `renderPhase` state machine (`idle`, `ribbon_entering`, `ribbon_caught`, `ribbon_completing`, `streaming`) and the message queuing system (`queueMessage`, `flushMessageQueue`, `messageQueue`) only existed to defer wire messages during ribbon animation. All removed.

**What does NOT change:**
- `text` segments still render as markdown (no header, no collapsible)
- `think` segments keep their current collapsible behavior (already correct paradigm)
- Icons, icon colors, error states — still sourced from the catalog
- Animation timing constants — untouched
- Wire protocol / WebSocket message format — untouched
- The `finalizeTurn` / `pendingTurnEnd` / scroll / spacer chain — untouched, already wired through `MessageList`

### 2e. Universal code rendering module

Code is displayed in multiple contexts across the app. Currently these are independent implementations with no shared rendering:

| Context | Current implementation | Has highlighting | Has line numbers |
|---------|----------------------|-------------------|-----------------|
| Chat tool calls (live) | `SimpleBlockRenderer.tsx` — inline `<pre><code>` | Yes (`hljs`) | No |
| Chat tool calls (history) | `MessageList.tsx` — `CollapsibleChunk` | No | No |
| File viewer | `FileContentRenderer.tsx` — `<pre><code>` with gutter | No | Yes (gutter) |

These should all look the same. A file opened in the file viewer should render identically to the same file's content shown in a `read` tool call result.

#### The `CodeView` component

A single, universal code display component used everywhere code appears:

```typescript
interface CodeViewProps {
  content: string;           // the code text
  language?: string;         // hljs language name (e.g. 'typescript', 'bash')
  filePath?: string;         // alternative: detect language from extension
  lineNumbers?: boolean;     // show gutter with line numbers (default: true)
  highlight?: boolean;       // apply syntax highlighting (default: true)
  maxHeight?: string;        // optional scroll constraint
  className?: string;        // additional CSS class
}
```

**Features:**
- Line numbers gutter (synced with content lines)
- `hljs` syntax highlighting
- Language detection from file path extension or explicit language prop
- Monospace font, consistent sizing via CSS variables
- Scrollable for long content

**Where it's used:**
- `ToolContentRenderer` — for `code` and `diff` content formats inside tool call blocks
- `FileContentRenderer` — replaces the current manual line rendering
- Markdown code blocks in `text` segments (fenced code blocks)
- Anywhere else code appears in the app

#### The content rendering layer inside `ToolCallBlock`

`ToolCallBlock` is the shell (header + collapsible wrapper). Inside the collapsible area, a **content renderer** handles the actual display of tool output. This is delegated based on `contentFormat` from the segment catalog.

```
ToolCallBlock (header + collapse logic)
  └─ ToolContentRenderer (picks strategy from contentFormat)
       ├─ CodeView              — contentFormat: 'code' or 'diff'
       ├─ plain monospace text  — contentFormat: 'plain' (shell output, file paths)
       └─ italic text           — contentFormat: 'plain' + italic typography (think)
```

`ToolCallBlock` passes `mode`, `content`, and `contentFormat` down. The content renderer picks the right strategy. `CodeView` is used for code/diff; plain content is simpler and doesn't need a separate component.

#### Existing code to reconnect

`chunkParser.ts` already has the boundary detection logic for live progressive reveal. It is currently only wired into `SimpleBlockRenderer.tsx` and disconnected from `MessageList.tsx`. This spec reconnects it through the content renderer:

| Utility | What it does | Used by |
|---------|-------------|---------|
| `getTextChunkBoundary()` | Finds paragraph/header/list boundaries, checks formatting balance | Think content (live mode) |
| `getCodeChunkBoundary()` | Finds line boundaries (`\n`) for line-by-line code reveal | Shell output, write/edit content (live mode) |
| `getCodeCommentBoundary()` | Chunks on `//` comment lines for code with structure | Write/edit content (live mode) |
| `truncateHtmlToChars()` | Progressive HTML reveal without flicker | Text content rendered through markdown (live mode) |
| `getVisibleTextLength()` | Counts visible chars in HTML (excluding tags) | Used with `truncateHtmlToChars()` |
| `formattingIsBalanced()` | Prevents partial `**bold**` or `` ` `` flicker | Used by `getTextChunkBoundary()` |

`markdownBlocks.ts` (`parseMarkdownBlocks`, `isHeaderBlock`) is **orphaned** — nothing imports it. Can be removed or kept for future use. Not needed by this spec.

#### Content rendering by mode

**`mode: 'instant'`** (history / thread switching / file viewer):
- All content renders immediately, complete, no animation
- `CodeView` applies syntax highlighting in one pass
- No boundary detection, no progressive reveal
- Content is already complete when the component mounts

**`mode: 'live'`** (streaming):
- Content arrives incrementally (block content grows via `updateBlockContent`)
- Renderer chases the growing content using boundary detection from `chunkParser.ts`
- Strategy depends on `contentFormat`:

| `contentFormat` | Live reveal strategy | Boundary function |
|----------------|---------------------|-------------------|
| `code` | Line-by-line reveal via `CodeView`, then highlight on complete | `getCodeChunkBoundary()` or `getCodeCommentBoundary()` |
| `diff` | Line-by-line reveal via `CodeView` (same as code) | `getCodeChunkBoundary()` |
| `plain` | Line-by-line for monospace content (file paths, command output) | `getCodeChunkBoundary()` |
| `markdown` | Not used in tool calls (only `text` segments) | N/A |

#### Content rendering per tool type

| Tool | `contentFormat` | Live behavior | Instant behavior |
|------|----------------|---------------|-----------------|
| `think` | `plain` | Paragraph-by-paragraph, italic | Full content, italic, collapsed |
| `shell` | `plain` | Line-by-line monospace | Full content, monospace, collapsed |
| `read` | `code` | Content arrives complete → `CodeView` with highlight | `CodeView` highlighted, collapsed |
| `write` | `code` | Line-by-line → `CodeView` highlight on complete | `CodeView` highlighted, collapsed |
| `edit` | `diff` | Line-by-line → `CodeView` highlight on complete | `CodeView` highlighted, collapsed |
| `glob` | `plain` | Lines append as results arrive (grouped) | All paths listed, collapsed |
| `grep` | `plain` | Lines append as results arrive (grouped) | All paths listed, collapsed |
| `web_search` | `plain` | Content arrives complete | Full content, collapsed |
| `fetch` | `plain` | Content arrives complete | Full content, collapsed |
| `subagent` | `plain` | Content arrives complete | Full content, collapsed |
| `todo` | `plain` | Content arrives complete | Full content, collapsed |

#### Syntax highlighting

Applies to `code` and `diff` content formats, handled by `CodeView`:
- Language detected from file path (`languageDetection: 'from-path'` in catalog) or explicit `language` prop or auto-detected
- In live mode: applied **after** content is marked complete (not during typing)
- In instant mode: applied immediately on mount
- `hljs` language registration lives in `CodeView` (or a shared `hljs-register.ts`) — one place, not duplicated
- Uses `hljs` (currently registered in `SimpleBlockRenderer.tsx` lines 33–46, to be moved)

#### CSS unification

The file viewer currently has its own CSS classes (`.code-editor`, `.code-gutter`, `.code-content`, `.code-line`, `.line-number` in `index.css` lines 593–648). `CodeView` replaces these with a single set of styles that apply everywhere:

- Gutter + content layout (already well-defined in the existing CSS)
- Font: `var(--font-mono)` with fallback chain
- Font size: 13px, line-height: 1.6 (matching current file viewer)
- Line number styling: tabular-nums, dim color, right-aligned
- These styles can live in `CodeView` as injected styles (per the design spec component pattern) or in `index.css` — either way, one definition

---

## 3. Scope of Changes

### 3a. New files

#### `src/components/ToolCallBlock.tsx`

The shell component. Handles:

- Header: icon + literal tool name from catalog
- Collapsible wrapper with expand/collapse toggle
- Mode switching (`live` vs `instant`)
- `live`: shimmer → delegates to content renderer → collapse → `onComplete()`
- `instant`: renders collapsed with full content, no animation
- Does NOT contain content rendering logic — delegates to `ToolContentRenderer`

#### `src/components/CodeView.tsx`

Universal code display component. Used everywhere code appears in the app:

- Line numbers gutter (synced with content)
- `hljs` syntax highlighting (language from prop, file path, or auto-detect)
- Monospace font via CSS variables, consistent sizing
- Scrollable for long content
- Pure presentation — no animation logic, no streaming awareness
- Replaces the manual line rendering in `FileContentRenderer.tsx`
- Replaces the inline `<pre><code>` in `SimpleBlockRenderer.tsx`

#### `src/components/ToolContentRenderer.tsx`

Content display inside the collapsible area. Handles:

- Reads `contentFormat` and `contentTypography` from the segment catalog
- Routes to the right rendering strategy:
  - `code` / `diff` → delegates to `CodeView`
  - `plain` → monospace or plain text (from `contentTypography`)
- In live mode: uses `chunkParser.ts` boundary detection for progressive reveal, feeds growing content to `CodeView`
- In instant mode: passes full content to `CodeView` or renders plain text immediately
- `CodeView` handles highlighting internally; `ToolContentRenderer` just decides when to show content

#### `src/lib/hljs-register.ts`

Shared `hljs` language registration. Currently only in `SimpleBlockRenderer.tsx` (lines 33–46). Extracted so `CodeView` and any other component that needs highlighting can import it. Single registration, no duplication.

### 3b. `segmentCatalog.ts` — Remove dead abstractions

**Remove entirely:**
- `getSegmentCategory()` function
- `isCollapsible()` function
- `COLLAPSIBLE_TYPES` constant
- `INLINE_TOOL_TYPES` constant
- `collapsible` field from `SegmentBehavior` interface
- `defaultCollapsed` field from `SegmentBehavior` interface
- `preserveContentWhenCollapsed` field from `SegmentBehavior` interface
- All `collapsible`/`defaultCollapsed`/`preserveContentWhenCollapsed` values from `BEHAVIOR_OVERRIDES`

**Add:**
- `groupable: boolean` field to `SegmentBehavior` interface
- `groupable` values in `BEHAVIOR_OVERRIDES` (true for read, glob, grep, web_search, fetch; false for all others)
- Export a `isGroupable(type: SegmentType): boolean` helper

**Modify:**
- `LABEL_BUILDERS` — every tool type returns its raw type name as the label:
  ```typescript
  const LABEL_BUILDERS: Record<SegmentType, (args?: Record<string, unknown>) => string> = {
    text: () => '',
    think: () => 'Thinking',
    shell: () => 'shell',
    read: () => 'read',
    write: () => 'write',
    edit: () => 'edit',
    glob: () => 'glob',
    grep: () => 'grep',
    web_search: () => 'web_search',
    fetch: () => 'fetch',
    subagent: () => 'subagent',
    todo: () => 'todo',
  };
  ```

**Keep:**
- All visual style definitions (icons, colors, borders, typography)
- `getSegmentVisual()`, `getSegmentIcon()`, `getSegmentIconColor()`, `getSegmentLabelColor()`
- `buildSegmentLabel()`, `buildSegmentLabelWithError()`
- `getSegmentBehavior()` (still has `contentFormat`, `syntaxHighlight`, `languageDetection`)
- `getSegmentErrorStyle()`
- `hasIcon()`
- `ICON_TYPES` constant

### 3c. `instructions.ts` — Remove category routing and label rewriting

**Remove:**
- `getSegmentCategory()` function
- `SegmentCategory` type
- `COLLAPSIBLE_TYPES` constant
- `toolLabel()` function (the arg-interpolating version)

**Keep:**
- `SEGMENT_ICONS` — the one source of truth for icon + label pairs
- `toolNameToSegmentType()` — wire name to segment type mapping

### 3d. `useWebSocket.ts` — Remove duplicates, add grouping state

**Remove:**
- `getToolIcon()` function (lines 85–96)
- `getLabelForType()` function (lines 101–117)
- All `accumulator.*` calls (lines 239, 254, 264, 279-283, 306-309)
- All `queue.*` calls (lines 202-203, 225, 325)
- `getAccumulator` and `getQueue` imports
- `queueMessage` usage and import (line 141, 407) — ribbon message queuing no longer needed
- The `default` case message queuing logic (lines 404-409) — no more `renderPhase` gating

**Modify:**
- `convertPartToSegment()` — stop setting `icon` and `label` on segments. Let the renderer fall through to the catalog. If these fields are set here with old values but the catalog returns new values, history-loaded threads and live-streamed threads will look different. The safe path: don't set them at all, or set them from the catalog using the same functions the renderer uses. **This must be updated in lockstep with the catalog changes — partial cleanup causes either runtime crashes (calling deleted functions) or visual drift (old labels on history, new labels on live).**

**Add:**
- Grouping state variables (activeGroupType, activeGroupSegmentIndex, activeGroupToolCallIds, activeGroupCount)
- Grouping logic in `tool_call` handler — check `isGroupable()` from catalog, merge or push accordingly
- Grouping logic in `tool_result` handler — append content line if result belongs to active group
- Group-closing logic in `content`, `thinking`, and `turn_end` handlers
- Reset grouping state in `turn_begin` handler

### 3e. `MessageList.tsx` — Use `ToolCallBlock`

**Remove:**
- `InlineChunk` component entirely
- `CollapsibleChunk` component entirely (replaced by `ToolCallBlock`)
- `getSegmentCategory` import
- The `switch (category)` routing in `SegmentRenderer`

**Replace routing with:**
```typescript
if (seg.type === 'text') {
  return <TextChunk ... />;
} else {
  return <ToolCallBlock
    type={seg.type}
    content={seg.content}
    isError={seg.isError}
    mode={isLastReleased ? 'live' : 'instant'}
    onComplete={segmentOnDone}
  />;
}
```

### 3f. Remove `SimpleBlockRenderer` pipeline (RESOLVED — not optional)

**Remove files:**
- `src/components/SimpleBlockRenderer.tsx` — the duplicate renderer
- `src/lib/simpleQueue.ts` — block queue (only used by SimpleBlockRenderer + ContentAccumulator)
- `src/lib/contentAccumulator.ts` — state machine (only feeds SimpleQueue)

**Modify:**
- `src/components/ChatArea.tsx` — remove `SimpleBlockRenderer` import (line 9) and mount (line 215), remove `getQueue`/`getAccumulator` usage in `handleSend` and `/demo` handler
- `src/hooks/useWebSocket.ts` — remove all `accumulator.*` calls and `queue.*` calls (lines 203, 225, 239, 254, 264, 279-283, 306-309, 322-325), remove `getQueue`/`getAccumulator` imports

**`/demo` command** in `ChatArea.tsx` (lines 70-140) — currently writes directly to `SimpleQueue` with hardcoded icons, labels, and the old inline/collapsible split. Breaks entirely when SimpleQueue is removed. Must be rewritten to push segments through the Zustand segment store (matching the live wire protocol path), or removed. If rewritten, it must use catalog lookups for icons/labels, not hardcoded values — otherwise it becomes another source of drift.

**Orb** — extract from the block queue system. Keep as a standalone element in `ChatArea` that appears on send, disappears when first content arrives. No queue needed.

**Tool grouping** — the accumulator's grouping state machine moves into `useWebSocket.ts` as lightweight state tracking (see section 2d). Uses the new `groupable` catalog property to decide behavior. Rendering layer is unaware of grouping.

### 3h. `types/index.ts` — No changes

`SegmentType` union and `StreamSegment` interface are unaffected.

---

## 4. What goes in the content area

For each tool type, the content area displays whatever `segment.content` contains. The accumulator/parser upstream is responsible for populating this. This spec does not change what data flows into `segment.content` — only how it renders.

| Tool | Content | Typography |
|------|---------|------------|
| `think` | Thinking text | Italic |
| `shell` | Command + output | Monospace |
| `read` | File contents | Monospace (syntax highlighted) |
| `write` | File contents being written | Monospace (syntax highlighted) |
| `edit` | Diff content | Monospace (syntax highlighted) |
| `glob` | Matched file paths (newline-separated) | Monospace |
| `grep` | Matched lines (newline-separated) | Monospace |
| `web_search` | Search results | Plain text |
| `fetch` | Fetched content | Plain text |
| `subagent` | Agent output | Plain text |
| `todo` | Task list | Plain text |

The `contentFormat` and `contentTypography` fields in the catalog still govern how content renders inside the collapsible area. This is unchanged.

---

## 5. Files touched

| File | Action |
|------|--------|
| `src/components/CodeView.tsx` | **NEW** — universal code display (line numbers, highlighting) |
| `src/components/ToolCallBlock.tsx` | **NEW** — tool call shell (header + collapsible wrapper) |
| `src/components/ToolContentRenderer.tsx` | **NEW** — content display inside collapsible area, delegates to CodeView |
| `src/lib/hljs-register.ts` | **NEW** — shared hljs language registration |
| `src/lib/chunkParser.ts` | **RECONNECT** — already exists, wire into ToolContentRenderer |
| `src/lib/segmentCatalog.ts` | Remove dead abstractions, fix label builders |
| `src/lib/instructions.ts` | Remove category routing and label rewriting |
| `src/hooks/useWebSocket.ts` | Remove duplicate icon/label maps |
| `src/lib/contentAccumulator.ts` | **REMOVE** — duplicate pipeline |
| `src/lib/simpleQueue.ts` | **REMOVE** — only used by removed pipeline |
| `src/components/SimpleBlockRenderer.tsx` | **REMOVE** — duplicate renderer causing double-rendering bug |
| `src/components/MessageList.tsx` | Remove InlineChunk + CollapsibleChunk, use ToolCallBlock |
| `src/components/ChatArea.tsx` | Remove SimpleBlockRenderer mount, rewrite /demo, extract orb |
| `src/components/Ribbon/index.tsx` | **REMOVE** — orphaned, replaced by orb |
| `src/components/Ribbon/Ribbon.css` | **REMOVE** — orphaned |
| `src/types/index.ts` | Remove `RenderPhase` type (ribbon phases), remove `renderPhase` and `messageQueue` from workspace state |
| `src/state/workspaceStore.ts` | Remove `renderPhase`, `queueMessage`, `flushMessageQueue`, `messageQueue`, `setRenderPhase` |
| `src/components/file-explorer/FileContentRenderer.tsx` | Replace manual line rendering with `CodeView` |
| `src/components/file-explorer/FileViewer.tsx` | Update to use new `CodeView` (language detection moves to CodeView) |
| `src/index.css` | `.code-editor`/`.code-gutter`/`.code-content` classes may move into CodeView or be kept and reused |
| `src/lib/markdownBlocks.ts` | **ORPHANED** — nothing imports it, can be removed |
| `spec/SEGMENT_DEFINITIONS_SPEC.md` | Mark phases 2–5 as superseded by this spec |

---

## 6. What this spec does NOT cover

- Animation timing changes (shimmer duration, typing speed, collapse duration)
- New tool types
- Changes to the wire protocol (WebSocket message format)
- Changes to `chunkParser.ts` internals (boundary detection algorithms are unchanged)

---

## 7. Verification

After implementation, every tool call in the UI should:

1. Show the icon from the catalog next to the **literal tool name** in the header
2. Have a collapsible content area below the header
3. Content area contains the tool's arguments/output
4. Expand/collapse toggle works
5. No tool call renders as a compact inline one-liner
6. `text` segments still render as markdown without a header
7. **Clicking between threads** renders all tool calls instantly (collapsed, no animation)
8. **Live streaming** animates tool calls (shimmer → reveal → collapse)
9. Grouped tool calls (consecutive reads, globs, etc.) render as a single collapsible block with all paths listed in the content area
10. **Code content** (write, edit, read) renders with syntax highlighting
11. **Live code content** reveals line-by-line using `chunkParser.ts` boundary detection, then highlights on complete
12. **Instant code content** (history) highlights immediately, no progressive reveal
13. **Shell output** renders monospace, line-by-line in live mode
14. **No partial formatting artifacts** — `formattingIsBalanced()` prevents mid-`**bold**` or mid-backtick flicker during live reveal
15. **File viewer code** renders identically to chat `read` tool call results — same component (`CodeView`), same line numbers, same highlighting
16. **All code display** across the app uses `CodeView` — no separate code rendering implementations
