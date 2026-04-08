# SPEC-21: Inline Styles Extraction — Style Layer

## Context for Executing Session

Inline `style={{}}` attributes in React components bypass the theme/style/layout system. Values hardcoded in JSX cannot be customized by users, don't respond to theme changes, and don't participate in the cascade.

Static inline styles should be moved to CSS classes in the style layer. Dynamic positioning styles (calculated from element bounds at runtime) must stay inline.

---

## Problem

6+ components use inline `style={{}}` with hardcoded values.

---

## Blocked By

- **SPEC-17** (spacing & font variables) — tokens must exist before inline styles can reference them

---

## Violations

### VoiceRecorder.tsx (9 inline styles — worst offender)
| Line | Element | Properties | Action |
|------|---------|------------|--------|
| 355 | `<p>` | fontSize: '12px', color: var, margin: 0 | Extract to CSS |
| 372 | `<span>` | fontSize: '32px', color: var | Extract to CSS |
| 375 | `<p>` | fontSize: '12px', color: var, textAlign, margin: 0 | Extract to CSS |
| 382 | `<span>` | fontSize: '16px' | Extract to CSS |
| 405 | `<span>` | fontSize: '32px', color: var | Extract to CSS |
| 415 | `<span>` | fontSize: '16px' | Extract to CSS |
| 459 | bars | Dynamic height/width | **KEEP INLINE** (responsive) |
| 471-479 | bars | Dynamic height | **KEEP INLINE** (responsive) |
| 518 | `<p>` | fontSize: '12px', color: var, margin: 0 | Extract to CSS |

### App.tsx (1 inline style)
| Line | Element | Properties | Action |
|------|---------|------------|--------|
| 127-133 | Loading div | display, alignItems, justifyContent, color: var, fontSize | Extract to CSS |

### TicketBoard.tsx (2 inline styles)
| Line | Element | Properties | Action |
|------|---------|------------|--------|
| 73 | div | position: 'relative' | **KEEP INLINE** (layout) |
| 109 | `<span>` | fontSize: '16px' | Extract to CSS |

### Orb.tsx (2 inline styles)
| Line | Element | Properties | Action |
|------|---------|------------|--------|
| 70 | wrapper | padding: '4px 0' | Extract to CSS |
| 73-76 | icon | fontSize: '16px', color: var | Extract to CSS |

### DocumentTile.tsx (1 inline style)
| Line | Element | Properties | Action |
|------|---------|------------|--------|
| 63 | `<img>` | width: 100%, height: 100%, objectFit: cover | **KEEP INLINE** (layout) |

---

## Rules for Extraction

### EXTRACT to CSS class (move to style layer):
- Hardcoded `fontSize` values → use `var(--font-*, fallback)` from SPEC-17
- Hardcoded `padding`, `margin`, `gap` → use `var(--space-*, fallback)` from SPEC-17
- Static color references that already use `var()` → move to CSS, keep the var reference

### KEEP INLINE (do not extract):
- Dynamic positioning calculated from element bounds at runtime (`left: rect.left`, `bottom: window.innerHeight - rect.top + 12`)
- Dynamic responsive values (`height: \`${barHeight}px\``)
- Layout-only properties on specific elements (`position: 'relative'`, `objectFit: 'cover'`)

---

## Gotchas

### Dynamic position styles MUST stay inline
`EmojiTrigger.tsx` line 281-282: `style={{ left: rect.left, bottom: window.innerHeight - rect.top + 12 }}`. This is calculated at runtime. If moved to CSS, modal renders at (0,0) or offscreen.

### fontSize for Material Icons is --font-*, not --space-*
`fontSize: '32px'` for an icon and `fontSize: '12px'` for text are in the `--font-*` family. Do not use `--space-*` variables for font sizes.

### Some inline styles already use CSS variables correctly
`style={{ color: 'var(--text-error, #ff4444)' }}` — preserve the variable reference when extracting to CSS. Don't replace it with a hardcoded value.

---

## Verification

After extraction:
- Components render identically (visual diff)
- Dynamic positioning still works (emoji picker, bar visualization)
- Extracted styles use SPEC-17 variables with fallbacks
- No `style={{}}` attributes remain with hardcoded spacing or font sizes (except dynamic/layout)

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Dynamic position moved to CSS | Modal at wrong position | Popover at (0,0) or offscreen |
| Icon fontSize in spacing variable | Icons scale with spacing | 32px icon becomes 8px |
| CSS variable reference lost | Style becomes hardcoded | Component stops responding to theme |
