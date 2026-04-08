# SPEC-15: Z-Index Hierarchy

## Context for Executing Session

This is a standalone CSS task. Fix 10 hardcoded z-index values across 8 files. Two values cause active collision bugs today.

All CSS values should use variables with fallbacks. The variables go in `open-robin-client/src/styles/variables.css` alongside the existing `:root` block. This is the current location where all CSS variables are defined — the eventual migration to a settings-based style system happens later; for now, `variables.css` is the right place.

Do not change component behavior. Only replace hardcoded z-index numbers with `var(--z-*, fallback)` references.

---

## Problem

10 hardcoded z-index values. Two active collision pairs.

---

## Active Bugs

### Bug 1: Z-index 1000 collision
- `src/index.css` line 90: `.modal-overlay { z-index: 1000; }`
- `src/components/HarnessSelector/HarnessSelector.css` line 10: `.harness-modal-overlay { z-index: 1000; }`
- **Both can render simultaneously** when HarnessSelector modal opens while a confirmation modal is showing
- **Symptom:** One modal is buried behind the other; app appears frozen

### Bug 2: Z-index 10 collision
- `src/components/ChatHarnessPicker/ChatHarnessPicker.css` line 6: `.chat-harness-picker { z-index: 10; }`
- `src/components/ConnectingOverlay/ConnectingOverlay.css` line 6: `.connecting-overlay { z-index: 10; }`
- **Both render at initial load** when no thread is selected
- **Symptom:** Click events go to wrong handler; harness not selected

---

## All 11 Z-Index Declarations (current state)

| File | Line | Current | Selector | Purpose |
|------|------|---------|----------|---------|
| `src/styles/document.css` | 135 | `2` | `.code-gutter` | Code line numbers |
| `src/mic/VoiceRecorder.css` | 73 | `1` | `.voice-recorder__kitt` | Voice visualization bars |
| `src/components/Robin/robin.css` | 1140 | `1` | `.robin-wiki-toolbar` | Wiki toolbar (internal) |
| `src/components/ChatHarnessPicker/ChatHarnessPicker.css` | 6 | `10` | `.chat-harness-picker` | Inline picker in chat |
| `src/components/ConnectingOverlay/ConnectingOverlay.css` | 6 | `10` | `.connecting-overlay` | Loading overlay in chat |
| `src/components/Robin/robin.css` | 8 | `600` | `.robin-overlay` | Full-screen system panel |
| `src/index.css` | 90 | `1000` | `.modal-overlay` | Modal backdrop |
| `src/components/HarnessSelector/HarnessSelector.css` | 10 | `1000` | `.harness-modal-overlay` | Harness selection modal |
| `src/components/hover-icon-modal/HoverIconModal.css` | 69 | `1003` | `.hover-icon-modal` | Hover modal trigger |
| `src/components/hover-icon-modal/HoverIconModal.css` | 261 | `1004` | `.hover-icon-modal-preview` | Preview tooltip |
| `src/components/Modal/modal.css` | 6 | `var(--z-modal, 10000)` | `.rv-modal-overlay` | System modal (ALREADY uses variable) |

---

## Step 1: Add Variables to variables.css

Add this block to the existing `:root` in `src/styles/variables.css`, after the Layout section:

```css
  /* Z-Index Hierarchy */
  --z-content: 1;
  --z-gutter: 2;
  --z-inline: 10;
  --z-panel: 600;
  --z-overlay: 1000;
  --z-modal: 1003;
  --z-tooltip: 1004;
  --z-system: 10000;
```

---

## Step 2: Replace Hardcoded Values

| File | Line | Old | New |
|------|------|-----|-----|
| `src/styles/document.css` | 135 | `z-index: 2;` | `z-index: var(--z-gutter, 2);` |
| `src/mic/VoiceRecorder.css` | 73 | `z-index: 1;` | `z-index: var(--z-content, 1);` |
| `src/components/Robin/robin.css` | 1140 | `z-index: 1;` | `z-index: var(--z-content, 1);` |
| `src/components/Robin/robin.css` | 8 | `z-index: 600;` | `z-index: var(--z-panel, 600);` |
| `src/index.css` | 90 | `z-index: 1000;` | `z-index: var(--z-overlay, 1000);` |
| `src/components/hover-icon-modal/HoverIconModal.css` | 69 | `z-index: 1003;` | `z-index: var(--z-modal, 1003);` |
| `src/components/hover-icon-modal/HoverIconModal.css` | 261 | `z-index: 1004;` | `z-index: var(--z-tooltip, 1004);` |

---

## Step 3: Fix the Two Collisions

### Fix collision 1: HarnessSelector modal content should be ABOVE backdrops
`src/components/HarnessSelector/HarnessSelector.css` line 10:
```css
/* Old: z-index: 1000; (same as .modal-overlay — collision) */
/* New: modal content sits above overlay backdrop */
z-index: var(--z-modal, 1003);
```

### Fix collision 2: ChatHarnessPicker should sit above ConnectingOverlay
`src/components/ConnectingOverlay/ConnectingOverlay.css` line 6:
```css
/* Old: z-index: 10; (same as .chat-harness-picker — collision) */
/* New: connecting overlay sits below picker so picker stays clickable */
z-index: var(--z-content, 1);
```

`src/components/ChatHarnessPicker/ChatHarnessPicker.css` line 6:
```css
/* Old: z-index: 10; */
/* New: picker sits above connecting overlay */
z-index: var(--z-inline, 10);
```

**Rationale:** When both are visible, the harness picker is the actionable element. The connecting overlay is informational. The picker must be clickable above it.

---

## Step 4: Reconcile modal.css

`src/components/Modal/modal.css` line 6 already uses `var(--z-modal, 10000)`.

Now that `--z-modal` is defined as `1003` in variables.css, this file will use `1003` instead of the `10000` fallback. This is the correct behavior — system modals at the `--z-modal` layer, above overlays and below tooltips.

**However:** If modal.css was intentionally at 10000 to be "above everything," it should use `--z-system` instead. Check what `.rv-modal-overlay` is used for:

```css
/* If it's a standard modal: keep --z-modal */
z-index: var(--z-modal, 1003);

/* If it's a system-critical modal (error dialogs, etc.): use --z-system */
z-index: var(--z-system, 10000);
```

Read `modal.css` and the component that uses it to determine which. If unclear, use `--z-system` to preserve the original 10000 behavior — it's safer to keep the high value than accidentally bury a system modal.

---

## Gotchas

### Hover modal z-indexes (1003, 1004) are correctly layered — don't flatten
Trigger at `--z-modal` (1003), popover at `--z-tooltip` (1004). This is intentional hierarchy. Both must be ABOVE `--z-overlay` (1000) so hover modals work over modal backdrops.

### ConnectingOverlay drop from 10 to 1 is intentional
The connecting overlay is a background informational element. It was at z-index 10 only because it was added without a hierarchy. Dropping it to `--z-content` (1) makes it sit under the harness picker, which is the correct stacking.

### Fallbacks preserve behavior if variables are removed
Every replacement includes the original value as fallback. If `variables.css` isn't loaded (shouldn't happen, but safe), all elements render at their original z-index values.

---

## What NOT to Do

- Do not change any component behavior or structure
- Do not rename CSS classes
- Do not modify HTML/JSX
- Do not change any other CSS properties — only z-index
- Do not add z-index to elements that don't currently have it

---

## Verification

After changes:
1. **Collision 1 fixed:** Open harness selector while a confirmation modal is showing — both should be visible, modal content above backdrop
2. **Collision 2 fixed:** Load app with no thread selected — harness picker should be clickable above connecting overlay
3. **Robin panel:** Opens above page content (600) but below modals (1003)
4. **Hover modals:** Still appear above regular modal backdrops
5. **System modal (modal.css):** Appears at correct layer — verify it's not buried
6. **Code gutter:** Line numbers still visible (z-index 2)
7. **Voice recorder bars:** Still visible during recording (z-index 1)

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| --z-modal defined but modal.css needed 10000 | System modal buried under hover modals | Critical dialog invisible |
| ConnectingOverlay too low | Overlay not visible when it should be | No loading indication |
| Fallback value typo | Element at wrong z-index if variable missing | Visual stacking wrong |
