# SPEC-07: catalog-visual.ts Review

## Issue
`catalog-visual.ts` is 492 lines. However, it is primarily a **data catalog** (segment type definitions) with accessor functions. This may be a "one job" file that is large due to data volume, not multiple concerns.

## File
`open-robin-client/src/lib/catalog-visual.ts` — 492 lines

## Current Responsibilities
1. **Segment type visual definitions** — icon, colors, labels, borders, background, typography for 12 segment types
2. **Render mode determination** — markdown, line-stream, diff, code, grouped-summary
3. **Behavior definitions** — contentFormat, syntaxHighlight, languageDetection, groupability
4. **Error state styling** — visual overrides when isError=true
5. **Accessor functions** — getSegmentVisual, getSegmentIcon, getRenderMode, getSummaryField, etc.

## One-Job Test
"This file defines the visual identity catalog for all segment types." — Passes. No "and."

## Segment Types Defined (12)
text, think, shell, read, write, edit, glob, grep, web_search, fetch, subagent, todo

## Exports
- Types: SegmentVisualStyle, RenderMode, SegmentBehavior, SegmentErrorStyle, SegmentDefinition, ModalState
- Data: SEGMENT_CATALOG
- Functions: getSegmentVisual, buildSegmentLabelWithError, isGroupable, getSegmentIcon, getSegmentIconColor, getSegmentLabelColor, getRenderMode, getSummaryField

## Consumers
- `ws-client.ts` — getSummaryField
- `ToolCallBlock.tsx` — catalog functions for rendering
- `InstantSegmentRenderer.tsx` — catalog functions
- `tool-grouper.ts` — getSummaryField, isGroupable

## Assessment
**Borderline.** The file is large because each segment type has 15+ visual properties. The actual logic (accessor functions) is <50 lines. Splitting the catalog data from the accessors would create unnecessary indirection.

## Recommendation
**Do not split unless a second catalog emerges.** If the file grows beyond 600 lines (new segment types), consider extracting the raw SEGMENT_CATALOG data to a separate `segment-catalog-data.ts` and keeping accessors in `catalog-visual.ts`.

## Dependencies
- None; consumed by 4 files but doesn't depend on other specs

## Gotchas
- `getSummaryField()` must stay in sync with tool-grouper.ts — both use it for grouped-summary rendering. If catalog adds a new groupable type but tool-grouper doesn't handle it, grouped results silently fall through.
- `SEGMENT_CATALOG` is the single source of truth for rendering. If a new segment type is added here but not handled in ws-client.ts message routing, the segment renders with default (text) styling — no error, just wrong appearance.

## Silent Fail Risks
- Low risk. This is a data catalog. The main risk is drift between catalog definitions and consumers (tool-grouper, ws-client, renderers) when new segment types are added.
