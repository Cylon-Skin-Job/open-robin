# Segment Definitions Spec — Unifying Static and Animated Renderers

**Status:** Phase 1 COMPLETE — Catalog built and ready  
**Context:** Addressing visual drift between `MessageList.tsx` (static/reload path) and `SimpleBlockRenderer.tsx` (animated/live path)

**Execution Order (5 Phases):**
1. ✅ Build complete catalog (`src/lib/segmentCatalog.ts`)
2. Fix static renderer (`MessageList.tsx`) — separate coding session
3. Fix dynamic renderer (`SimpleBlockRenderer.tsx`) — separate coding session
4. Build universal text renderer — separate coding session
5. Deprecate old code — separate coding session

---

## Design Decisions (Locked)

| Issue | Decision | Rationale |
|-------|----------|-----------|
| `edit` category | **Collapsible** | Matches `instructions.ts` intention; edit blocks should collapse like write blocks |
| Icons | **Use `instructions.ts` set** | Live renderer is source of truth; icons are more descriptive |
| Thinking border | **1px** | Live renderer uses 1px; consistency with other borders |
| Inline tool background | **Transparent (none)** | Live renderer has no background; simpler visual |
| Error states | **Fix in catalog** | Not intentional gap; catalog defines error styling for all segment types |

---

## 1. Problem Statement

The codebase currently has **two renderers** that display the same segment types:

| Renderer | Purpose | Location |
|----------|---------|----------|
| **Static** (`SegmentRenderer` in `MessageList.tsx`) | Displays finalized message history on reload | `src/components/MessageList.tsx` |
| **Animated** (`SimpleBlockRenderer.tsx`) | Displays live streaming content with timing/animation | `src/components/SimpleBlockRenderer.tsx` |

### Visual Drift Examples

Both renderers define the same visual properties independently:

| Property | Static Renderer | Animated Renderer |
|----------|----------------|-------------------|
| **Thinking icon** | `lightbulb` (line 529) | `lightbulb` (from `SEGMENT_ICONS`) |
| **Thinking label** | Hardcoded "Thinking" | From `block.header?.label` |
| **Thinking border** | `2px solid var(--theme-primary)` (line 287) | `1px solid var(--theme-primary)` (line 497) |
| **Thinking font** | `fontStyle: 'italic'` (line 295) | `fontStyle: block.type === 'think' ? 'italic' : 'normal'` (line 532) |
| **Shell icon** | `terminal` (line 530) | `terminal` (from `SEGMENT_ICONS`) |
| **Inline tool bg** | `rgba(var(--theme-primary-rgb), 0.03)` (line 376) | Transparent (no background) |

**Result:** When you update how "thinking blocks look" in one renderer, the other drifts out of sync.

---

## 2. Guiding Principles

### 2.1 Catalog Contains Shared Visual State

**Heuristic:** *If the finished state (when fully rendered) is identical between live and static renders, it belongs in the catalog.*

| In Catalog | NOT in Catalog (stays in renderer) |
|------------|-----------------------------------|
| Icon names and colors | Timing constants (ms delays) |
| Label text/templates | Animation phase state machines |
| Border styles (width, color) | Shimmer active/inactive states |
| Typography (font-style, font-family) | Typing cursor visibility |
| Background colors | Content reveal progress |
| Collapsible yes/no | Expand/collapse animation progress |
| Default collapsed state | Orb pulse/expand/contract phases |
| Content format (markdown/code/plain) | Queue advancement logic |
| Error state visuals | Error state transition timing |

### 2.2 Timing Logic Is Preserved Exactly

The current timing in `SimpleBlockRenderer.tsx` is meticulously tuned. **Do not change it.** Only document it thoroughly so we don't lose it during refactoring.

See Section 6 for complete timing audit.

### 2.3 Dynamic Labels Belong in Catalog

Anything that affects the final visual text — including dynamic construction like `"Read \`file.ts\`"` — goes in the catalog. The renderer just reads the final string.

### 2.4 Error States Are Visual → Catalog

Error styling (red text, error icons) affects the finished appearance → belongs in catalog. The renderer just passes an `isError` flag.

---

## 3. Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: SEGMENT CATALOG (src/lib/segmentCatalog.ts)       │
│  ─────────────────────────────────────────────────────────  │
│  Visual identity (icon, colors, borders, typography)        │
│  Dynamic label construction                                 │
│  Behavior flags (collapsible, format, highlight)            │
│  Error state visuals                                        │
│  ─────────────────────────────────────────────────────────  │
│  NO timing constants                                        │
│  NO animation state machines                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: STATIC RENDERER (MessageList.tsx)                 │
│  ─────────────────────────────────────────────────────────  │
│  Reads from catalog: "What does a thinking block look like?"│
│  Renders immediately in final state                         │
│  No timing, no animation                                    │
│  Applies error styles when isError=true                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: ANIMATED RENDERER (SimpleBlockRenderer.tsx)       │
│  ─────────────────────────────────────────────────────────  │
│  Reads from catalog: "What does a thinking block look like?"│
│  Wraps in timing/sequencing (PRESERVED EXACTLY AS-IS)       │
│  Same final visual output as static renderer                │
│  Applies error styles when isError=true                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Segment Catalog Structure

### 4.1 Core Types

```typescript
// VISUAL IDENTITY — Everything that affects final appearance
interface SegmentVisualStyle {
  // Icon
  icon: string;              // Material icon name
  iconColor: string;         // CSS color value
  iconSize: number;          // px
  
  // Label
  labelColor: string;        // CSS color
  labelStyle: 'normal' | 'italic';
  
  // Container styling
  backgroundColor?: string;  // undefined = transparent
  borderLeft?: {
    width: string;           // e.g., "1px"
    color: string;           // e.g., "var(--theme-primary)"
  };
  border?: {
    width: string;
    color: string;
    radius?: string;
  };
  
  // Content typography
  contentTypography: 'body' | 'italic' | 'monospace' | 'markdown';
  contentColor: string;
}

// BEHAVIOR — Affects how it's rendered (but not timing)
interface SegmentBehavior {
  // What kind of content
  contentFormat: 'plain' | 'markdown' | 'code' | 'diff';
  
  // Syntax highlighting for code
  syntaxHighlight?: boolean;
  languageDetection?: 'auto' | 'from-path' | 'from-meta';
  
  // Collapsible behavior
  collapsible: 'never' | 'after-animation' | 'always';
  defaultCollapsed: boolean;
  preserveContentWhenCollapsed: boolean;  // Keep in DOM when hidden?
}

// ERROR STATE — Visual overrides when isError=true
interface SegmentErrorStyle {
  icon?: string;             // e.g., "error" instead of "description"
  iconColor?: string;        // e.g., "var(--error, #ef4444)"
  labelColor?: string;
  labelSuffix?: string;      // e.g., " (error)"
}

// COMPLETE DEFINITION
interface SegmentDefinition {
  type: SegmentType;
  visual: SegmentVisualStyle;
  behavior: SegmentBehavior;
  errorStyle: SegmentErrorStyle;  // Always defined, even if empty
  
  // Dynamic label function
  // Returns final label string given segment args
  buildLabel: (args?: Record<string, unknown>) => string;
}
```

### 4.2 Complete Segment Inventory

| Type | Icon | Base Label | Category | Collapsible | Format |
|------|------|------------|----------|-------------|--------|
| `text` | (none) | (none) | text | never | markdown |
| `think` | `lightbulb` | "Thinking" | collapsible | after-animation | plain |
| `shell` | `terminal` | dynamic | collapsible | after-animation | plain |
| `read` | `description` | dynamic | inline | never | code |
| `write` | `edit_note` | dynamic | collapsible | after-animation | code |
| `edit` | `find_replace` | dynamic | collapsible | after-animation | diff |
| `glob` | `folder_data` | dynamic | inline | never | plain |
| `grep` | `document_search` | dynamic | inline | never | plain |
| `web_search` | `travel_explore` | dynamic | inline | never | plain |
| `fetch` | `link_2` | dynamic | inline | never | plain |
| `subagent` | `smart_toy` | dynamic | inline | never | plain |
| `todo` | `checklist` | "Planning" | inline | never | plain |

### 4.3 Visual Style Specification

```typescript
// Default visual style applied to all segments
const DEFAULT_VISUAL_STYLE: SegmentVisualStyle = {
  icon: '',
  iconColor: 'var(--theme-primary)',
  iconSize: 16,
  labelColor: 'var(--text-dim)',
  labelStyle: 'normal',
  contentTypography: 'body',
  contentColor: 'var(--text-dim)',
};

// Per-type visual overrides (deep merge with defaults)
const SEGMENT_VISUAL_OVERRIDES: Record<SegmentType, Partial<SegmentVisualStyle>> = {
  text: {
    icon: '',
    iconSize: 0,
    contentTypography: 'markdown',
    contentColor: 'var(--text-white)',
  },
  
  think: {
    icon: 'lightbulb',
    labelStyle: 'italic',
    borderLeft: { width: '1px', color: 'var(--theme-primary)' },
    contentTypography: 'italic',
  },
  
  shell: {
    icon: 'terminal',
    contentTypography: 'monospace',
    borderLeft: { width: '1px', color: 'var(--theme-primary)' },
  },
  
  read: {
    icon: 'description',
    labelStyle: 'italic',
    contentTypography: 'monospace',
  },
  
  write: {
    icon: 'edit_note',
    contentTypography: 'monospace',
    borderLeft: { width: '1px', color: 'var(--theme-primary)' },
  },
  
  edit: {
    icon: 'find_replace',
    contentTypography: 'monospace',
    borderLeft: { width: '1px', color: 'var(--theme-primary)' },
  },
  
  glob: {
    icon: 'folder_data',
    labelStyle: 'italic',
  },
  
  grep: {
    icon: 'document_search',
    labelStyle: 'italic',
  },
  
  web_search: {
    icon: 'travel_explore',
    labelStyle: 'italic',
  },
  
  fetch: {
    icon: 'link_2',
    labelStyle: 'italic',
  },
  
  subagent: {
    icon: 'smart_toy',
    labelStyle: 'italic',
  },
  
  todo: {
    icon: 'checklist',
    labelStyle: 'italic',
  },
};
```

### 4.4 Dynamic Label Construction

```typescript
// Label builders by segment type
const LABEL_BUILDERS: Record<SegmentType, (args?: Record<string, unknown>) => string> = {
  text: () => '',
  think: () => 'Thinking',
  
  shell: (args) => {
    const cmd = (args?.command as string || '').slice(0, 40);
    return `Running \`${cmd}\``;
  },
  
  read: (args) => `Read \`${args?.path || ''}\``,
  write: (args) => `Write \`${args?.path || ''}\``,
  edit: (args) => `Edit \`${args?.path || ''}\``,
  glob: (args) => `Find \`${args?.pattern || ''}\``,
  grep: (args) => `Search \`${args?.pattern || ''}\``,
  web_search: (args) => `Search \`${args?.query || ''}\``,
  fetch: (args) => `Fetch \`${args?.url || ''}\``,
  subagent: (args) => `Task: ${args?.description || 'Subagent'}`,
  todo: () => 'Planning',
};
```

### 4.5 Error State Styling

```typescript
const SEGMENT_ERROR_OVERRIDES: Record<SegmentType, SegmentErrorStyle> = {
  // Default error style for most segments
  default: {
    iconColor: 'var(--error, #ef4444)',
    labelColor: 'var(--error, #ef4444)',
  },
  
  // Per-type overrides where needed
  read: {
    icon: 'error',
    iconColor: 'var(--error, #ef4444)',
    labelColor: 'var(--error, #ef4444)',
    labelSuffix: ' (error)',
  },
  
  write: {
    icon: 'error',
    iconColor: 'var(--error, #ef4444)',
    labelColor: 'var(--error, #ef4444)',
    labelSuffix: ' (error)',
  },
  
  edit: {
    icon: 'error',
    iconColor: 'var(--error, #ef4444)',
    labelColor: 'var(--error, #ef4444)',
    labelSuffix: ' (error)',
  },
  
  shell: {
    icon: 'error',
    iconColor: 'var(--error, #ef4444)',
    labelColor: 'var(--error, #ef4444)',
    labelSuffix: ' (failed)',
  },
  
  // Inline tool types
  glob: { labelSuffix: ' (error)' },
  grep: { labelSuffix: ' (error)' },
  web_search: { labelSuffix: ' (error)' },
  fetch: { labelSuffix: ' (error)' },
  subagent: { labelSuffix: ' (error)' },
  todo: { labelSuffix: ' (error)' },
  
  // Non-tool types
  text: {},  // No error state for text
  think: {},  // No error state for thinking
};
```

---

## 5. Catalog API

```typescript
// Get complete definition for a segment type
export function getSegmentDefinition(type: SegmentType): SegmentDefinition;

// Get visual style (merged defaults + overrides)
export function getSegmentVisual(type: SegmentType): SegmentVisualStyle;

// Get behavior spec
export function getSegmentBehavior(type: SegmentType): SegmentBehavior;

// Get error style
export function getSegmentErrorStyle(type: SegmentType): SegmentErrorStyle;

// Build label with args
export function buildSegmentLabel(
  type: SegmentType, 
  args?: Record<string, unknown>
): string;

// Build label with error state applied
export function buildSegmentLabelWithError(
  type: SegmentType,
  args?: Record<string, unknown>,
  isError?: boolean
): string;

// Type guards (for renderer routing)
export function isCollapsible(type: SegmentType): boolean;
export function hasIcon(type: SegmentType): boolean;
export function getSegmentCategory(type: SegmentType): 'collapsible' | 'inline' | 'text';
```

---

## 6. Timing Audit — Current State (PRESERVE EXACTLY)

This section documents the current timing logic in `SimpleBlockRenderer.tsx` **for reference only**. These values stay in the renderer, NOT in the catalog.

### 6.1 Global Timing Constants (lines 52-70)

```typescript
const TIMING = {
  ORB_PAUSE_BEFORE: 500,
  ORB_EXPAND: 500,
  ORB_PAUSE_OPEN: 500,
  ORB_CONTRACT: 500,
  ORB_PAUSE_AFTER: 500,
  ORB_FADE: 200,

  FADE_IN: 300,
  SHIMMER_PAUSE: 500,
  TYPING_SLOW: 6,         // first 10 chars of each sub-chunk
  BOUNDARY_PAUSE: 300,     // pause between sub-chunks
  POST_TYPE_PAUSE: 500,
  COLLAPSE: 500,
  POST_COLLAPSE_PAUSE: 500,

  INLINE_FADE_IN: 250,
  INLINE_SHIMMER: 500,
} as const;
```

### 6.2 Per-Block Timing

| Block Type | Timing Sequence |
|------------|-----------------|
| **OrbBlock** (lines 171-179) | pause-before (500ms) → fade-in (200ms) → expand (500ms) → hold (600ms) → contract (500ms) → fade-out (200ms) → pause-after (500ms) |
| **CollapsibleBlock** (lines 295-315) | icon fade (immediate) → label+shimmer appear (800ms) → shimmer runs (1500ms) → pre-type pause (500ms) → typing → post-type pause (500ms) → collapse (500ms) |
| **TextBlock** | shimmer (0ms for text) → typewriter (with sub-chunk boundary pauses) → post-type pause (500ms) |
| **CodeBlock** | typewriter line-by-line → highlight.js → post-type pause (500ms) |
| **InlineToolBlock** (lines 793-821) | icon fade (immediate) → label+shimmer (800ms) → shimmer (1500ms) → pause (500ms) → advance |

### 6.3 Typing Cadence

- First 10 chars after each boundary: **6ms per char** (`TIMING.TYPING_SLOW`)
- After 10 chars: **variable** (`queue.fastDelay`, defaults to 3, changes to 1 at turn-end)

---

## 7. Migration Plan

### Phase 1: Build Catalog (This Session)
1. Create `src/lib/segmentCatalog.ts` with:
   - Complete `SegmentDefinition` for all 12 types
   - Visual style defaults + overrides
   - Dynamic label builders
   - Error state overrides
   - Helper functions (`getSegmentDefinition`, `buildSegmentLabel`, etc.)

2. Add tests for catalog (if test suite exists)

### Phase 2: Update Static Renderer (Separate Session)
1. Modify `MessageList.tsx`:
   - Import from `segmentCatalog`
   - Replace hardcoded styles in `CollapsibleChunk` with catalog lookups
   - Replace hardcoded styles in `InlineChunk` with catalog lookups
   - Replace hardcoded styles in `TextChunk` with catalog lookups
   - Add error state handling to all chunk types
   - Verify visual output matches intended final state

### Phase 3: Update Animated Renderer (Separate Session)
1. Modify `SimpleBlockRenderer.tsx`:
   - Import from `segmentCatalog`
   - Replace hardcoded icon names with `def.visual.icon`
   - Replace hardcoded colors with `def.visual.iconColor`, etc.
   - Add error state handling (currently missing!)
   - **Preserve all timing logic exactly as-is**
   - Verify animations still work correctly

### Phase 4: Universal Text Renderer (Separate Session)

**Goal:** Extract the duplicated text/markdown/code rendering logic into a reusable module.

**Current Duplication:**
- `MessageList.tsx` - Markdown via `react-markdown`
- `SimpleBlockRenderer.tsx` - Markdown in `TextBlock` + typing animation
- `SimpleBlockRenderer.tsx` - Code in `CodeBlock` + syntax highlighting

**New Module:** `src/components/UniversalTextRenderer.tsx`

```typescript
interface UniversalTextRendererProps {
  format: 'plain' | 'markdown' | 'code' | 'diff';
  content: string;
  language?: string;           // For code/diff highlighting
  syntaxHighlight?: boolean;   // From catalog behavior
  isTyping?: boolean;          // Animated vs static
  isError?: boolean;           // Error styling
  // Future: typingSpeed, onComplete, etc.
}
```

**Catalog Integration:**
- `contentFormat` → `format` prop
- `syntaxHighlight` → `syntaxHighlight` prop  
- `languageDetection` → auto-detect language for code blocks

**Migration:**
1. Build `UniversalTextRenderer` supporting all 4 formats
2. Update `MessageList.tsx` chunks to use it
3. Update `SimpleBlockRenderer.tsx` blocks to use it
4. Remove duplicated markdown/code rendering logic

### Phase 5: Deprecate Old Code (Separate Session)
1. Update `src/lib/instructions.ts`:
   - Delegate to catalog
   - Mark old exports as `@deprecated`
2. Remove any remaining hardcoded fallbacks
3. Remove old text rendering implementations (now in UniversalTextRenderer)

---

## 8. Success Criteria

### Phase 1 (Catalog) ✓ COMPLETE
- [x] Catalog exports complete visual specification for all 12 segment types
- [x] Catalog exports dynamic label builders
- [x] Catalog exports error state styling for all segment types
- [x] TypeScript compiles without errors

### Phase 2 (Static Renderer)
- [ ] Static renderer imports visual styles from catalog
- [ ] Static renderer imports error states from catalog
- [ ] Visual output matches catalog specification

### Phase 3 (Animated Renderer)
- [ ] Animated renderer imports visual styles from catalog
- [ ] Animated renderer imports error states from catalog
- [ ] Timing logic is unchanged (verified by diff)

### Phase 4 (Universal Text Renderer)
- [ ] Universal text renderer component created
- [ ] Handles all 4 formats: plain, markdown, code, diff
- [ ] Static renderer uses UniversalTextRenderer
- [ ] Animated renderer uses UniversalTextRenderer
- [ ] Duplicated rendering logic removed

### Phase 5 (Cleanup)
- [ ] Old code in `instructions.ts` marked deprecated
- [ ] Both renderers produce visually identical final output
- [ ] No visual drift between static and animated paths

---

## Appendix A: Migration Reference

### Changes to Static Renderer (MessageList.tsx)

| Current (Line) | Change |
|----------------|--------|
| Line 287: `borderLeft: '2px solid var(--theme-primary)'` | Change to `'1px solid ...'` to match catalog |
| Line 376: `background: 'rgba(var(--theme-primary-rgb), 0.03)'` | Remove (transparent) to match catalog |
| Lines 527-542: `getIconForType()` | Replace with catalog lookup |
| Lines 519-525: `getSegmentCategory()` | Replace with catalog's version (includes 'edit') |
| Missing: Error handling | Add to all chunk types |

### Changes to Animated Renderer (SimpleBlockRenderer.tsx)

| Current (Line) | Change |
|----------------|--------|
| Line 462: `{block.header?.icon || 'lightbulb'}` | Use catalog default as fallback |
| Line 474: `{block.header?.label || 'Thinking'}` | Use catalog-built label |
| Missing: Error handling | Add to all block types |
| Preserve: All timing constants | Do not change |

### Deprecated in instructions.ts

- `SEGMENT_ICONS` — use catalog
- `toolLabel()` — use `buildSegmentLabel()`
- `getSegmentCategory()` — use catalog's version

---

## Appendix B: Universal Text Renderer Design

### Problem Statement

Currently, text/markdown/code rendering is duplicated across:

| Location | Format | Implementation |
|----------|--------|----------------|
| `MessageList.tsx:385-393` | Markdown | `react-markdown` + `remarkGfm` |
| `MessageList.tsx:467-476` | Plain/code | Direct `<pre>` / `<div>` rendering |
| `SimpleBlockRenderer.tsx:680-755` | Markdown | `react-markdown` + typing animation |
| `SimpleBlockRenderer.tsx:757-812` | Code | `react-markdown` + `highlight.js` |

**Result:** Same visual requirements implemented 4+ times. Bug fixes and style changes must be applied in multiple places.

### Solution: Universal Text Renderer

A single component that handles all content formats, configured by the catalog's `SegmentBehavior`:

```typescript
// From catalog
interface SegmentBehavior {
  contentFormat: 'plain' | 'markdown' | 'code' | 'diff';
  syntaxHighlight?: boolean;
  languageDetection?: 'auto' | 'from-path' | 'from-meta';
}

// Renderer props
interface UniversalTextRendererProps {
  format: 'plain' | 'markdown' | 'code' | 'diff';
  content: string;
  language?: string;
  syntaxHighlight?: boolean;
  isTyping?: boolean;      // Enable typing animation
  typingSpeed?: number;    // ms per char when typing
  isError?: boolean;       // Error state styling
  className?: string;      // Additional CSS classes
}
```

### Format-Specific Rendering

| Format | Library | Features |
|--------|---------|----------|
| `plain` | Native | Whitespace preserved, no markdown processing |
| `markdown` | `react-markdown` + `remarkGfm` | Tables, strikethrough, etc. |
| `code` | `react-markdown` + `highlight.js` | Syntax highlighting, line numbers (optional) |
| `diff` | Custom or `react-diff-viewer` | Unified diff with +/- styling |

### Static vs Animated Mode

**Static (`isTyping=false`):**
- Render full content immediately
- No cursor, no timing
- Used by `MessageList.tsx`

**Animated (`isTyping=true`):**
- Typewriter effect with cursor
- Respects `typingSpeed` and boundary pauses
- Used by `SimpleBlockRenderer.tsx`
- **Timing stays in renderer** (not in UniversalTextRenderer)

### Integration Flow

```
Catalog (behavior)          Renderer                     UniversalTextRenderer
────────────────────────────────────────────────────────────────────────────────
contentFormat: 'code'  ───► format='code'           ───► <code> with highlight
syntaxHighlight: true   ───► syntaxHighlight=true   ───► apply highlight.js
languageDetection:...   ───► language='typescript'  ───► detected from path
```

### Benefits

1. **Single source of truth** for markdown/code rendering
2. **Consistent styling** across static and animated renderers
3. **Easier testing** - one component to verify
4. **Simpler renderers** - they just call the universal component
5. **Future formats** (Mermaid, LaTeX) added in one place

### Catalog Properties for Text Rendering

```typescript
// Already in catalog
interface SegmentBehavior {
  contentFormat: 'plain' | 'markdown' | 'code' | 'diff';
  syntaxHighlight?: boolean;
  languageDetection?: 'auto' | 'from-path' | 'from-meta';
}

// Per-type values
const BEHAVIOR_OVERRIDES = {
  text:   { contentFormat: 'markdown' },
  think:  { contentFormat: 'plain' },
  shell:  { contentFormat: 'plain' },
  read:   { contentFormat: 'code', syntaxHighlight: true, languageDetection: 'from-path' },
  write:  { contentFormat: 'code', syntaxHighlight: true, languageDetection: 'from-path' },
  edit:   { contentFormat: 'diff', syntaxHighlight: true, languageDetection: 'from-path' },
  // ... inline tools use 'plain'
};
```
