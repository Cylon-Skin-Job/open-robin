# SPEC-13: LiveSegmentRenderer.tsx Review

## Issue
`LiveSegmentRenderer.tsx` is 417 lines implementing a pressure-based sequential animation pipeline for streaming AI responses.

## File
`open-robin-client/src/components/LiveSegmentRenderer.tsx` — 417 lines

## Current Responsibilities
1. **Orb phase** — 2-second intro animation buying lead time for first token
2. **Sequential segment mounting** — one-at-a-time via visibleCount gating
3. **Completion detection** — effect-based, fires exactly once via finalizedRef
4. **Pressure-based timing** — backlog distance -> compressed pauses via getTimingProfile()
5. **Snap-to-frontier** — if backlog is hopeless, skip ahead and render instantly
6. **Turn boundary detection** — segment array shrinking = new turn, reset state
7. **LiveTextSegment sub-component** — text animation with renderTextInstant/animateText
8. **LiveToolSegment sub-component** — phase machine (shimmer -> revealing -> collapsing -> done)

## Critical Invariants
- Segments render ONE AT A TIME (enforced by slice logic)
- Turn finalization fires EXACTLY ONCE
- Past bug: checking completion inside callback hung if segments finished before turn_end
- onSegmentDone is stable (no deps), onRevealComplete checked in effect

## Imports (8 modules)
types, tool-renderers, pressure, tool-animate, text, text-animate, animate-utils, ToolCallBlock, Orb

## Consumer
- `MessageList.tsx` — renders for streaming turns

## One-Job Test
"This file orchestrates sequential segment-by-segment streaming animation." — Passes.

## Assessment
**Acceptable.** This is a complex rendering pipeline but it is genuinely one job. The sub-components (LiveTextSegment, LiveToolSegment) are internal and tightly coupled to the orchestration logic. Extracting them would create artificial boundaries across a tightly-coupled animation pipeline.

## Recommendation
**Do not split.** The 417 lines serve a single, complex purpose. Splitting the animation pipeline would create coordination bugs between the orchestrator and the segments it animates.

If growth occurs:
- LiveTextSegment could be extracted if it gains independent complexity
- LiveToolSegment could be extracted if its phase machine grows

## Dependencies
- None; consumed only by MessageList.tsx

## Gotchas
- **Splitting would break completion detection** (lines 114-123). The effect watches `[revealedCount, segments.length, onRevealComplete]`. If split into separate components, this reactive dependency graph breaks — completion fires twice or never.
- **Known past bug** (lines 96-100): Putting completion check inside callback instead of effect caused hang when segments finished before turn_end. This was hard to debug and would resurface if the orchestration is split.

## Silent Fail Risks
- If split: turn hangs forever, spinner loops endlessly, user must reload. **Do not split this file.**
