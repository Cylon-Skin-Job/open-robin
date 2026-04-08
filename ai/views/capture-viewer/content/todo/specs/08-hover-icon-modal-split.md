# SPEC-08: HoverIconModal.tsx Split

## Context for Executing Session

This is a standalone React component refactoring. Separate the hook logic (state machine, cross-instance coordination, timing) from the UI components (pure presentational JSX). No server changes. No behavior changes.

**Model recommendation: Sonnet 4.6** — mechanical file split with one critical gotcha.

**File:** `open-robin-client/src/components/hover-icon-modal/HoverIconModal.tsx` — 473 lines

---

## Problem

HoverIconModal.tsx contains a complex state machine hook (250 lines) and 11 presentational UI components (220 lines) in one file. The hook and the UI components are independent concerns — the hook manages behavior, the components render JSX.

---

## What to Create

### File 1: `src/components/hover-icon-modal/useHoverIconModal.ts`

**Move the following from HoverIconModal.tsx:**

**Module-level singleton state (lines 17-28) — MUST travel with the hook:**
```ts
let activeInstance: string | null = null;
const listeners = new Set<(id: string | null) => void>();

function notifyInstanceChange(id: string | null) { ... }
function subscribeToInstanceChanges(fn: (id: string | null) => void): () => void { ... }
```

**Types (lines 30-61):**
```ts
type ModalState = 'CLOSED' | 'PREVIEW' | 'LOCKED';
type TriggerMode = 'hover' | 'click';
interface UseHoverIconModalOptions { ... }
interface UseHoverIconModalReturn { ... }
```

**Timing constants (lines 13-14):**
```ts
const HOVER_DELAY = 200;
const LOCK_GRACE = 500;
```

**The hook function (lines 63-249):**
```ts
export function useHoverIconModal(options: UseHoverIconModalOptions = {}): UseHoverIconModalReturn { ... }
```

**Export the ModalState type:**
```ts
export type { ModalState, UseHoverIconModalOptions, UseHoverIconModalReturn };
```

**This file has zero React JSX. It's pure hook logic + module-level state.**

---

### File 2: `src/components/hover-icon-modal/HoverIconModalParts.tsx`

**Move all 11 presentational components (lines 251-469):**
- `HoverIconTrigger`
- `HoverIconModalContainer`
- `HoverIconModalHeader`
- `HoverIconModalRow`
- `HoverIconModalList`
- `HoverIconModalThumb`
- `HoverIconModalContent`
- `HoverIconModalLoading`
- `HoverIconModalEmpty`
- `HoverIconModalHint`
- `HoverIconModalPreview`

**These components are pure props → JSX. They have zero state, zero effects, zero logic.** They only need React and the ModalState type (import from the hook file).

**Import for ModalState:**
```ts
import type { ModalState } from './useHoverIconModal';
```

---

### File 3: Update `src/components/hover-icon-modal/index.ts` (barrel re-export)

The existing barrel file (if present) or HoverIconModal.tsx itself currently serves as the entry point. Replace it with:

```ts
export { useHoverIconModal } from './useHoverIconModal';
export type { ModalState, UseHoverIconModalOptions, UseHoverIconModalReturn } from './useHoverIconModal';

export {
  HoverIconTrigger,
  HoverIconModalContainer,
  HoverIconModalHeader,
  HoverIconModalRow,
  HoverIconModalList,
  HoverIconModalThumb,
  HoverIconModalContent,
  HoverIconModalLoading,
  HoverIconModalEmpty,
  HoverIconModalHint,
  HoverIconModalPreview,
} from './HoverIconModalParts';
```

**All consumers currently import from `../hover-icon-modal` or `../hover-icon-modal/HoverIconModal`. The barrel must make both paths work.** Check what consumers import and ensure the barrel covers it.

---

## Known Consumers

Search the codebase for imports from hover-icon-modal:

- `src/emojis/EmojiTrigger.tsx` — imports `useHoverIconModal`, `HoverIconTrigger`, `HoverIconModalContainer`, `HoverIconModalList`
- `src/components/hover-icon-modal/index.ts` — current barrel (if exists)
- Any other file importing from this path

**Verify all consumers still resolve after the split.**

---

## The ONE Critical Gotcha

### Module-level `activeInstance` and `listeners` MUST be in the hook file

Lines 17-18:
```ts
let activeInstance: string | null = null;
const listeners = new Set<(id: string | null) => void>();
```

This provides **singleton behavior** — only one hover modal can be open at a time across the entire app. When modal A opens, it notifies all other instances to close via the `listeners` Set.

**If this state is accidentally left in the old file, put in a separate file, or duplicated:**
- Multiple hover modals can be open simultaneously
- Modals don't close each other
- No error thrown — it's a silent UX regression

**The rule:** `activeInstance`, `listeners`, `notifyInstanceChange`, and `subscribeToInstanceChanges` MUST be in the same module as `useHoverIconModal`. They are the hook's cross-instance coordination mechanism.

---

## Other Notes

### HOVER_DELAY and LOCK_GRACE are duplicated elsewhere
These constants (200ms, 500ms) also appear in `HoverPopover.tsx` and `interaction-controller.ts`. This is not a bug to fix in this spec — just be aware. Don't create a shared constants file unless asked.

### HoverIconModalContainer has inline positioning styles
Lines 308-312: `style={{ position: 'fixed', left: position.left, bottom: position.bottom }}`. These are dynamic (calculated from trigger bounds at runtime). They MUST stay inline — do not extract to CSS.

### HoverIconModalPreview also has inline positioning styles
Lines 458-462: Same pattern — fixed positioning calculated at runtime. Keep inline.

### The CSS file (HoverIconModal.css) stays where it is
It's imported by the current file. After the split, import it from HoverIconModalParts.tsx (where the JSX lives) instead of the hook file. The hook file has no JSX and doesn't need CSS.

---

## What NOT to Do

- Do not change any component behavior or state machine logic
- Do not consolidate HOVER_DELAY/LOCK_GRACE with other files
- Do not extract inline positioning styles to CSS
- Do not change HoverIconModal.css
- Do not modify EmojiTrigger.tsx (consumer) — it should work via the barrel
- Do not add features, types, or exports beyond what currently exists

---

## Verification

1. EmojiTrigger still works — hover to preview, click to lock, Escape to close
2. Only one hover modal can be open at a time (hover over two different trigger icons rapidly)
3. Click outside closes the modal
4. Escape closes the modal
5. Hover delay is ~200ms (not instant)
6. Lock grace period is ~500ms (leaving a locked modal doesn't close it instantly)
7. Build succeeds with no import resolution errors

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| activeInstance not in hook module | Multiple modals open simultaneously | Visual confusion, overlapping popups |
| CSS import in wrong file | Styles not loaded | Unstyled modal appears |
| Barrel doesn't cover existing import paths | Consumer can't resolve import | Build error (caught immediately) |
| Dynamic position styles moved to CSS | Modal at wrong position | Popover renders at (0,0) |
