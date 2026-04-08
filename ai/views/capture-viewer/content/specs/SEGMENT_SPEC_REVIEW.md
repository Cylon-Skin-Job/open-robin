# Segment Spec Review — Assumptions, Gotchas, and Design Decisions

**Purpose:** Before implementing the catalog, surface every hidden assumption and potential breaking change.

---

## 1. Critical Discovery: `edit` Segments Are Collapsible (Sometimes)

### The Code Evidence

**`instructions.ts` line 55:**
```typescript
const COLLAPSIBLE_TYPES = new Set(['think', 'shell', 'write', 'edit']);
```

**`MessageList.tsx` lines 519-525:**
```typescript
function getSegmentCategory(segmentType: string): 'collapsible' | 'inline' | 'text' {
  if (segmentType === 'text') return 'text';
  if (segmentType === 'think' || segmentType === 'shell' || segmentType === 'write') {
    return 'collapsible';
  }
  return 'inline';  // <-- edit falls through to inline!
}
```

**`SimpleBlockRenderer.tsx` lines 130-137:**
```typescript
case 'tool': {
  const segType = block.meta?.segmentType || '';
  const category = getSegmentCategory(segType);  // Uses instructions.ts version
  if (category === 'collapsible') {
    return <CollapsibleBlock ... />;
  }
  return <InlineToolBlock ... />;
}
```

### The Contradiction

| Source | `edit` Category |
|--------|-----------------|
| `instructions.ts` COLLAPSIBLE_TYPES | **collapsible** |
| `MessageList.tsx` getSegmentCategory | **inline** (falls through) |
| My Spec | collapsible |

**Question:** Is `edit` supposed to be collapsible or inline? The `instructions.ts` says collapsible, but `MessageList.tsx` renders it as inline.

---

## 2. Icon Discrepancies Between Renderers

### `instructions.ts` (lines 3-15) vs `MessageList.tsx` (lines 527-542)

| Type | instructions.ts | MessageList.tsx | My Spec |
|------|-----------------|-----------------|---------|
| `glob` | `folder_data` | `folder_search` | `folder_data` |
| `grep` | `document_search` | `search` | `document_search` |
| `fetch` | `link_2` | `link` | `link_2` |

**Impact:** The static renderer would show different icons than the live renderer.

**Decision Needed:** Which icon set is authoritative?

---

## 3. The Inline Tool Block Background Mystery

### `MessageList.tsx` InlineChunk (lines 368-379)

```typescript
return (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    marginBottom: '4px',
    borderRadius: '6px',
    background: 'rgba(var(--theme-primary-rgb), 0.03)',  // <-- Has background
    opacity: shimmerOpacity,
    transition: 'opacity 250ms ease',
  }}>
```

### `SimpleBlockRenderer.tsx` InlineToolBlock (lines 823-831)

```typescript
return (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 0',
    marginTop: '20px',
    marginBottom: '2px',
    // NO background
  }}>
```

**Question:** Should inline tools have a subtle background or not?

---

## 4. Thinking Block Border Width Discrepancy

### `MessageList.tsx` CollapsibleChunk (line 287)

```typescript
...(segment.type === 'think' ? { borderLeft: '2px solid var(--theme-primary)', paddingLeft: '12px' } : {}),
```

### `SimpleBlockRenderer.tsx` CollapsibleBlock (line 497)

```typescript
borderLeft: `1px solid ${isTyping || phase === 'post-type-pause' || phase === 'collapsing' || phase === 'collapsed' ? 'var(--theme-primary)' : 'transparent'}`,
```

**Question:** Is it 2px or 1px? This is a visible difference.

---

## 5. Timing Differences Between Renderers (Both Are Used!)

### `SimpleBlockRenderer.tsx` Timing (lines 52-70)

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
  TYPING_SLOW: 6,         // <-- 6ms
  BOUNDARY_PAUSE: 300,     // <-- 300ms
  POST_TYPE_PAUSE: 500,
  COLLAPSE: 500,
  POST_COLLAPSE_PAUSE: 500,

  INLINE_FADE_IN: 250,
  INLINE_SHIMMER: 500,
} as const;
```

### `MessageList.tsx` Timing (lines 7-18)

```typescript
const TIMING = {
  START_PAUSE: 250,
  FADE_IN_START: 250,
  FADE_IN_END: 500,
  SHIMMER_MINIMUM: 1000,
  POST_TYPING_PAUSE: 500,
  COLLAPSE_DURATION: 300,  // <-- 300ms (vs 500ms)
  INTER_CHUNK_PAUSE: 250,
  TYPING_FAST: 1,
  TYPING_MEDIUM: 2,
  TYPING_SLOW: 5,          // <-- 5ms (vs 6ms)
} as const;
```

**My Understanding:** These are for different renderers and don't need to match. But confirming: the live renderer uses one set, static uses another by design?

---

## 6. The `block.header` Pattern in SimpleBlockRenderer

### `SimpleBlockRenderer.tsx` CollapsibleBlock (line 462)

```typescript
{block.header?.icon || 'lightbulb'}
```

### `SimpleBlockRenderer.tsx` InlineToolBlock (line 847)

```typescript
{block.header?.icon || 'build'}
```

**The Pattern:** The animated renderer uses `block.header?.icon` with a fallback. This suggests the `Block` type has an optional `header` field containing `icon` and `label`.

**Gotcha:** If the catalog defines icons, but blocks are created with `block.header.icon` from the existing `SEGMENT_ICONS`, we need to ensure they stay in sync.

**Question:** Should blocks be created with header info from the catalog, eliminating the fallbacks?

---

## 7. `StreamSegment` Has Optional `icon` and `label` Fields

### `types/index.ts` lines 28-37

```typescript
export interface StreamSegment {
  type: SegmentType;
  content: string;
  icon?: string;      // <-- Optional override
  label?: string;     // <-- Optional override
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  toolDisplay?: unknown[];
  isError?: boolean;
}
```

**Implication:** Segments can arrive from the server with custom icons/labels that override the defaults.

**My Spec Assumption:** The catalog provides defaults, but renderers should respect `segment.icon` and `segment.label` when present.

**Is this correct?**

---

## 8. Code Block Syntax Highlighting Logic Is Complex

### `SimpleBlockRenderer.tsx` CodeBlock (lines 722-738)

```typescript
useEffect(() => {
  if (isDone && block.content) {
    const lang = block.meta?.language || '';  // <-- From block.meta
    try {
      if (lang && hljs.getLanguage(lang)) {
        const result = hljs.highlight(block.content, { language: lang });
        setHighlighted(result.value);
      } else {
        const result = hljs.highlightAuto(block.content);
        setHighlighted(result.value);
      }
    } catch {
      setHighlighted(block.content);
    }
  }
}, [isDone, block.content, block.meta?.language]);
```

### `SimpleBlockRenderer.tsx` CollapsibleBlock for code (lines 380-395)

```typescript
useEffect(() => {
  if (!isCodeTool || phase !== 'post-type-pause') return;
  const content = liveBlock.current.content;
  if (!content) return;
  const lang = langFromPath(block.meta?.toolArgs?.path as string);  // <-- From path!
  try {
    if (lang && hljs.getLanguage(lang)) {
      setHighlightedCode(hljs.highlight(content, { language: lang }).value);
    } else {
      setHighlightedCode(hljs.highlightAuto(content).value);
    }
  } catch {
    setHighlightedCode(content);
  }
}, [phase, isCodeTool, block.meta?.toolArgs?.path]);
```

**Two Different Strategies:**
1. `CodeBlock`: Uses `block.meta?.language`
2. `CollapsibleBlock` (write/edit): Uses `langFromPath(block.meta?.toolArgs?.path)`

**Question:** Should the catalog specify language detection per segment type, or is this renderer logic?

My spec has: `languageDetection?: 'auto' | 'from-path' | 'from-meta'`

Is this over-complicating? Should we just preserve existing behavior?

---

## 9. The `langFromPath` Function

### `SimpleBlockRenderer.tsx` lines 263-272

```typescript
function langFromPath(path?: string): string {
  if (!path) return '';
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', sh: 'bash', json: 'json', css: 'css', html: 'html',
    md: 'markdown', xml: 'xml',
  };
  return map[ext] || '';
}
```

**Question:** Is this utility used elsewhere? Should it be in the catalog or stay in the renderer?

---

## 10. `getSegmentCategory` Returns Different Types

### `instructions.ts` (lines 52-53, 57-59)

```typescript
export type SegmentCategory = 'collapsible' | 'inline';

export function getSegmentCategory(segType: string): SegmentCategory {
  return COLLAPSIBLE_TYPES.has(segType) ? 'collapsible' : 'inline';
}
```

### `MessageList.tsx` (lines 519-525)

```typescript
function getSegmentCategory(segmentType: string): 'collapsible' | 'inline' | 'text' {
  if (segmentType === 'text') return 'text';
  if (segmentType === 'think' || segmentType === 'shell' || segmentType === 'write') {
    return 'collapsible';
  }
  return 'inline';
}
```

**Differences:**
1. `instructions.ts` doesn't have `'text'` as a category
2. `MessageList.tsx` doesn't include `'edit'` in collapsible

**Question:** Which is the source of truth? Should the catalog export a canonical `getSegmentCategory`?

---

## 11. The `isCodeTool` Check in CollapsibleBlock

### `SimpleBlockRenderer.tsx` line 293

```typescript
const isCodeTool = block.meta?.segmentType === 'write' || block.meta?.segmentType === 'edit';
```

This drives:
- Different typing boundary logic (lines 353-356)
- Different padding (line 496)
- Different content rendering (lines 503-541)
- Syntax highlighting trigger (lines 380-395)

**Question:** Is this `isCodeTool` logic catalog-worthy or renderer implementation detail?

---

## 12. Error State Handling

### `MessageList.tsx` InlineChunk (lines 389-393)

```typescript
{segment.isError && (
  <span style={{ fontSize: '12px', color: 'var(--error, #ef4444)', marginLeft: 'auto' }}>
    error
  </span>
)}
```

**Question:** My spec includes `SegmentErrorStyle`. But is error handling consistent across all segment types and both renderers?

Current observations:
- `MessageList.tsx` InlineChunk shows "error" text
- `MessageList.tsx` CollapsibleChunk doesn't check `isError`
- `SimpleBlockRenderer.tsx` doesn't check `isError` anywhere

**Is this intentional or a gap?**

---

## 13. The `toolLabel` Function in instructions.ts

### `instructions.ts` lines 35-49

```typescript
export function toolLabel(segType: SegmentType, args?: Record<string, unknown>): string {
  const base = SEGMENT_ICONS[segType]?.label || segType;
  if (!args) return base;

  switch (segType) {
    case 'read':  return `Read \`${args.path || ''}\``;
    case 'write': return `Write \`${args.path || ''}\``;
    case 'edit':  return `Edit \`${args.path || ''}\``;
    case 'glob':  return `Find \`${args.pattern || ''}\``;
    case 'grep':  return `Search \`${args.pattern || ''}\``;
    case 'web_search': return `Search \`${args.query || ''}\``;
    case 'fetch': return `Fetch \`${args.url || ''}\``;
    case 'shell': return `Running \`${(args.command as string || '').slice(0, 40)}\``;
    default: return base;
  }
}
```

**Observations:**
1. Uses `SEGMENT_ICONS` for base label
2. Has custom logic per segment type
3. `shell` has special truncation logic (`slice(0, 40)`)
4. `subagent` doesn't have dynamic label logic here, but my spec says it does

**Question:** Should the catalog define label templates or keep this logic?

---

## 14. UserBlock Is Special

### `SimpleBlockRenderer.tsx` lines 148-163

```typescript
function UserBlock({ block, queue }: BlockItemProps) {
  const advancedRef = useRef(false);

  useEffect(() => {
    if (!advancedRef.current) {
      advancedRef.current = true;
      queue.advanceBlock();
    }
  }, [queue]);

  return (
    <div className="message message-user" style={{ marginTop: '20px' }}>
      <div className="message-user-content">{block.content}</div>
    </div>
  );
}
```

**User blocks:**
- Have no icon
- Have no label
- Render immediately
- Auto-advance queue
- Use CSS classes, not inline styles

**Question:** Should user blocks be in the catalog, or are they a renderer concern?

---

## 15. Orb Block Is Special

### `SimpleBlockRenderer.tsx` lines 168-259

The Orb block:
- Has unique animation phases (pause-before, fade-in, expand, hold, contract, fade-out, pause-after)
- Uses `lens_blur` icon specifically
- Icon size is 24px (different from others)
- Is removed from queue after animation (lines 183-184)
- Disappears completely (doesn't stay in final output)

**Question:** Should orb be in the catalog (as a special pseudo-segment) or stay as renderer implementation?

My spec has `ORB_DEFINITION` as a separate export.

---

## 16. Content Padding Differences

### `SimpleBlockRenderer.tsx` CollapsibleBlock (lines 494-496)

```typescript
<div style={{
  marginLeft: '11px',
  paddingLeft: isCodeTool ? '0' : '21px',  // <-- Conditional padding
  borderLeft: ...
}}>
```

### `MessageList.tsx` CollapsibleChunk (line 282)

```typescript
<div style={{
  marginLeft: '24px',
  maxHeight: expanded ? '2000px' : '0px',
  // No conditional padding logic
}}>
```

**Question:** The static renderer doesn't have the `isCodeTool` padding logic. Intentional or drift?

---

## Summary of Decisions Needed

| # | Issue | My Spec Says | Question |
|---|-------|--------------|----------|
| 1 | `edit` category | collapsible | But `MessageList.tsx` treats it as inline. Which is correct? |
| 2 | Icons | Uses `instructions.ts` set | But `MessageList.tsx` uses different icons. Which set? |
| 3 | Inline tool background | Not specified (undefined) | Add background or keep transparent? |
| 4 | Thinking border | 1px | But static uses 2px. Which is correct? |
| 5 | Timing | Different per renderer | Confirm this is intentional |
| 7 | Segment icon/label overrides | Catalog provides defaults | Should renderers respect segment.icon/label? |
| 8 | Language detection | Per-segment-type config | Is this over-engineering? |
| 12 | Error states | In catalog | But only InlineChunk checks isError. Gap or intentional? |
| 13 | Label builders | In catalog | But shell has special truncation. Preserve? |
| 15 | Orb definition | Separate export | Should orb be in catalog at all? |
| 16 | Code tool padding | Not in catalog | Should catalog specify layout padding? |

---

## My Recommendations

1. **Resolve `edit` category discrepancy** before building catalog
2. **Pick authoritative icon set** — probably `instructions.ts` since it's more descriptive
3. **Decide on inline tool background** — either add to both or remove from both
4. **Pick border width** — probably 1px for consistency
5. **Preserve existing timing** — don't try to unify, just document
6. **Support segment.icon/label overrides** — catalog provides defaults
7. **Keep language detection simple** — preserve existing behavior, document it
8. **Defer error state unification** — out of scope for Phase 1
9. **Keep shell truncation** — it's there for a reason (long commands)
10. **Keep orb separate** — it's a UI construct, not a segment type
