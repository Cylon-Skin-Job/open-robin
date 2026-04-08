# SPEC-12: EmojiTrigger.tsx Review

## Issue
`EmojiTrigger.tsx` is 418 lines. However, ~250 lines are a hardcoded emoji database (187 emoji objects). The actual component logic is ~168 lines.

## File
`open-robin-client/src/emojis/EmojiTrigger.tsx` — 418 lines

## Current Responsibilities
1. **Emoji database** — hardcoded EMOJIS array with 187 entries (emoji, name, category)
2. **Modal integration** — delegates to useHoverIconModal hook
3. **Emoji grouping** — reverse array, group by category
4. **Keyboard navigation** — Arrow keys (1 horizontal, 20 vertical), Enter to insert, Esc to close
5. **Mouse selection** — hover highlight, click insert
6. **Auto-scroll** — scroll to bottom on open
7. **Position calculation** — fixed popover from trigger bounds
8. **Grid layout** — 20 per row, 28px cells with category headers

## Exports
- Default export: `EmojiTrigger` component

## Consumers
- `ChatArea.tsx` — renders as inline button

## One-Job Test
"This file provides an emoji picker." — Passes.

## Assessment
**Acceptable size.** The 187-emoji database inflates the line count but is data, not logic. The actual component logic at ~168 lines is well within limits.

## Recommendation
**Optional: Extract emoji data to `emojis/emoji-data.ts`** to separate data from logic. This is low priority — the file passes the one-job test and the logic portion is small.

## Dependencies
- None; self-contained, can be done anytime

## Gotchas

### EMOJIS array is REVERSED at runtime
Line 334: `const REVERSED_EMOJIS = [...EMOJIS].reverse()`. If data is extracted to a separate file and accidentally includes the reverse (or forgets it), emojis appear in wrong order — least popular first. Silent UX regression.

### Keyboard navigation uses magic number 20 (grid columns)
Lines 301-305: Arrow keys move by +/-20 (matching `gridTemplateColumns: repeat(20, 28px)`). If extracted and grid changes to 15 or 25 columns without updating the constant, arrow keys navigate in wrong jumps. Should be extracted alongside grid definition.

## Silent Fail Risks
- Low risk overall. Emoji order reversal is the main gotcha — no error, just wrong UX.
