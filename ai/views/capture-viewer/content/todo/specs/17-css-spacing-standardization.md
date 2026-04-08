# SPEC-17: Spacing & Font Size Variables

## Context for Executing Session

This is a standalone CSS task. Define spacing, font-size, and border-radius variable scales in `variables.css`, then migrate `VoiceRecorder.css` as the first consumer. No other files are changed.

**Model recommendation: Sonnet 4.6** — mechanical replacement, detailed instructions, no judgment calls.

Do not change component behavior. Only define variables and replace hardcoded values with `var(--token, fallback)` references.

---

## Problem

No spacing, font-size, or border-radius variable scale exists. VoiceRecorder.css has 30+ hardcoded values.

---

## Step 1: Add Variable Scales to variables.css

**File:** `open-robin-client/src/styles/variables.css`

Add these three blocks inside the existing `:root`, after the `/* Z-Index Hierarchy */` section:

```css
  /* Spacing Scale */
  --space-2xs: 2px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;

  /* Font Size Scale */
  --font-2xs: 10px;
  --font-xs: 11px;
  --font-sm: 12px;
  --font-md: 13px;
  --font-lg: 16px;
  --font-xl: 20px;
  --font-2xl: 32px;

  /* Border Radius Scale */
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 8px;
```

---

## Step 2: Replace Hardcoded Values in VoiceRecorder.css

**File:** `open-robin-client/src/mic/VoiceRecorder.css`

Every replacement below. Left column is the exact current CSS. Right column is the replacement. Fallback always matches the original value.

### Spacing

| Line | Current | Replacement |
|------|---------|-------------|
| 10 | `gap: 12px;` | `gap: var(--space-md, 12px);` |
| 11 | `padding: 16px;` | `padding: var(--space-lg, 16px);` |
| 71 | `gap: 4px;` | `gap: var(--space-xs, 4px);` |
| 89 | `gap: 12px;` | `gap: var(--space-md, 12px);` |
| 91 | `padding: 16px 0;` | `padding: var(--space-lg, 16px) 0;` |
| 98 | `gap: 6px;` | `gap: 6px;` | **KEEP — no exact token. 6px is between xs (4) and sm (8).** |
| 99 | `padding: 8px 16px;` | `padding: var(--space-sm, 8px) var(--space-lg, 16px);` |
| 117 | `padding: 4px 8px;` | `padding: var(--space-xs, 4px) var(--space-sm, 8px);` |
| 155 | `gap: 8px;` | `gap: var(--space-sm, 8px);` |
| 161 | `padding: 6px 12px;` | `padding: 6px var(--space-md, 12px);` | **6px kept hardcoded — no token.** |
| 197 | `padding: 1px 4px;` | `padding: 1px var(--space-xs, 4px);` | **1px kept hardcoded — below scale.** |

### Font Sizes

| Line | Current | Replacement |
|------|---------|-------------|
| 25 | `font-size: 13px;` | `font-size: var(--font-md, 13px);` |
| 104 | `font-size: 12px;` | `font-size: var(--font-sm, 12px);` |
| 121 | `font-size: 11px;` | `font-size: var(--font-xs, 11px);` |
| 133 | `font-size: 12px;` | `font-size: var(--font-sm, 12px);` |
| 164 | `font-size: 12px;` | `font-size: var(--font-sm, 12px);` |
| 190 | `font-size: 11px;` | `font-size: var(--font-xs, 11px);` |
| 203 | `font-size: 10px;` | `font-size: var(--font-2xs, 10px);` |

### Border Radius

| Line | Current | Replacement |
|------|---------|-------------|
| 79 | `border-radius: 2px;` | `border-radius: var(--radius-sm, 2px);` |
| 102 | `border-radius: 4px;` | `border-radius: var(--radius-md, 4px);` |
| 162 | `border-radius: 4px;` | `border-radius: var(--radius-md, 4px);` |
| 200 | `border-radius: 3px;` | `border-radius: 3px;` | **KEEP — 3px doesn't map cleanly. Between sm (2) and md (4).** |

### DO NOT Replace (component-specific dimensions)

These are specific to VoiceRecorder's visual design, not part of a global scale. Leave hardcoded:

| Line | Property | Value | Reason |
|------|----------|-------|--------|
| 12 | min-width | 200px | Component-specific layout |
| 35-36 | width/height | 140px | Ring container dimensions |
| 47-48 | width/height | 140px | SVG ring dimensions |
| 55, 61 | stroke-width | 4 | SVG stroke (not CSS spacing) |
| 72 | height | 44px | KITT bar container height |
| 77 | width | 8px | KITT bar width |
| 81 | min-height | 4px | KITT bar minimum |
| 29 | letter-spacing | 0.5px | Typography detail |
| 140-141 | width/height | 24px | Spinner dimensions |
| 142 | border | 2px | Spinner border width |

---

## What NOT to Do

- Do not change any file other than `variables.css` and `VoiceRecorder.css`
- Do not force-fit values into the scale (6px, 3px, 1px stay hardcoded)
- Do not replace SVG stroke-width, letter-spacing, or component-specific dimensions
- Do not change any colors, transitions, or non-spacing properties
- Do not modify VoiceRecorder.tsx
- Do not add variables for dimensions that only VoiceRecorder uses (140px ring, 44px bar height, etc.)

---

## Verification

After changes:
1. VoiceRecorder renders identically — visual diff should show zero differences
2. `variables.css` has all three variable blocks (spacing, font, radius)
3. Every replacement in VoiceRecorder.css includes the original value as fallback
4. Values that don't map to the scale (6px, 3px, 1px) are still hardcoded
5. Component-specific dimensions (140px, 44px, 8px bar width, 24px spinner) are still hardcoded
6. No other CSS files were modified

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Missing fallback | Property becomes `initial` if var undefined | Layout breaks — no padding/gap |
| Wrong token (e.g., --space-sm for font-size) | Font scales with spacing changes | Text too big or too small |
| Replaced a component dimension | Ring/bar/spinner size changes with spacing | Visual distortion |
