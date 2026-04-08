# SPEC-02: RobinOverlay.tsx Split

## SCOPE BOUNDARY — READ THIS FIRST

This spec extracts 8 internal sub-components from RobinOverlay.tsx into separate files. The main RobinOverlay component stays in RobinOverlay.tsx — it keeps all state, effects, WS subscriptions, and the JSX shell. Only the sub-components move out.

**You are NOT refactoring RobinOverlay.** You are NOT changing its state management, WS subscription pattern, or tab routing logic. You are NOT splitting the main component's JSX. You are NOT creating a context or custom hook. You are moving already-standalone functions to their own files and importing them back.

**If you finish early, stop.**

---

## Context

`open-robin-client/src/components/Robin/RobinOverlay.tsx` is 887 lines. The main component is ~490 lines (state + effects + JSX). Below it are 8 internal sub-components (~400 lines) that are already self-contained functions receiving data via props. They just need their own files.

**Model recommendation: Sonnet 4.6** — mechanical file moves, no judgment calls.

---

## Types to Extract First

Create a shared types file so all sub-components can import from it:

### File: `src/components/Robin/robin-types.ts`

Move these interfaces and constants from the top of RobinOverlay.tsx (lines 25-101):

```ts
export interface Tab { ... }
export interface WikiPage { ... }
export interface ConfigItem { ... }
export interface CliItem { ... }
export interface SystemTheme { ... }
export interface WorkspaceItem { ... }

export const COLOR_SWATCHES = [ ... ];
```

Do NOT move `RobinOverlayProps` or `CHAT_MESSAGES` — those are only used by the main component.

---

## Files to Create

### File 1: `src/components/Robin/WikiDetail.tsx`

Move these functions (lines 495-544):
- `WikiToolbar` 
- `WikiDetail`

**Imports needed:**
```ts
import { markdownToHtml } from '../../lib/transforms/markdown';
import type { WikiPage } from './robin-types';
```

**Export both:**
```ts
export function WikiToolbar({ ... }) { ... }
export function WikiDetail({ ... }) { ... }
```

**GOTCHA: WikiToolbar has a querySelector** (line 500):
```ts
const btn = document.querySelector('.robin-wiki-link-btn') as HTMLElement;
```
Move this as-is. Do not change it. (It's flagged in SPEC-18 for the .rv- prefix migration later.)

---

### File 2: `src/components/Robin/ConfigDetail.tsx`

Move this function (lines 549-598):
- `ConfigDetail`

**Imports needed:**
```ts
import type { ConfigItem } from './robin-types';
```

**Export:**
```ts
export function ConfigDetail({ ... }) { ... }
```

---

### File 3: `src/components/Robin/CLIDetail.tsx`

Move these functions (lines 602-651, 852-886):
- `CLIDetail`
- `CLIRegistry`

**Imports needed:**
```ts
import type { CliItem } from './robin-types';
```

**Export both:**
```ts
export function CLIDetail({ ... }) { ... }
export function CLIRegistry({ ... }) { ... }
```

**Note:** CLIDetail has two inline `style={{ marginTop: '...' }}` attributes (lines 634, 643). Leave them inline — they're layout-specific.

---

### File 4: `src/components/Robin/ThemeDetail.tsx`

Move these functions (lines 658-848):
- `ColorPicker`
- `SystemThemeDetail`
- `WorkspaceThemeDetail`

**Imports needed:**
```ts
import { useState, useEffect } from 'react';
import { COLOR_SWATCHES } from './robin-types';
import type { SystemTheme, WorkspaceItem } from './robin-types';
```

**Export all three:**
```ts
export function ColorPicker({ ... }) { ... }
export function SystemThemeDetail({ ... }) { ... }
export function WorkspaceThemeDetail({ ... }) { ... }
```

**Note:** ColorPicker is the only sub-component with its own state (`inputValue`). It stays self-contained — the state moves with it.

**Note:** SystemThemeDetail and WorkspaceThemeDetail both have inline `style={{ marginTop: '...' }}` attributes. Leave them inline.

---

## Changes to RobinOverlay.tsx

### Add imports:
```ts
import { WikiDetail } from './WikiDetail';
import { ConfigDetail } from './ConfigDetail';
import { CLIDetail, CLIRegistry } from './CLIDetail';
import { SystemThemeDetail, WorkspaceThemeDetail } from './ThemeDetail';
import type { Tab, WikiPage, ConfigItem, CliItem, SystemTheme, WorkspaceItem } from './robin-types';
```

### Remove from RobinOverlay.tsx:
- All type interfaces that moved to robin-types.ts (Tab, WikiPage, ConfigItem, CliItem, SystemTheme, WorkspaceItem, COLOR_SWATCHES)
- All 8 sub-component functions (WikiToolbar, WikiDetail, ConfigDetail, CLIDetail, CLIRegistry, ColorPicker, SystemThemeDetail, WorkspaceThemeDetail)

### Keep in RobinOverlay.tsx:
- `RobinOverlayProps` interface
- `CHAT_MESSAGES` constant
- The entire `RobinOverlay` function (state, effects, handlers, JSX)
- The `import './robin.css'`
- The `import { sendRobinMessage, onRobinMessage } from '../../lib/ws-client'`
- The `import { markdownToHtml }` — WAIT, check if it's still used. WikiDetail uses it but is now imported. If RobinOverlay itself doesn't call markdownToHtml, remove this import.

**Estimated RobinOverlay.tsx after: ~500 lines** (the main component + types import + sub-component imports)

---

## Gotchas

### 1. WS subscriptions stay in the parent — sub-components get data via props

The 4 `onRobinMessage()` subscriptions (lines 141-175) stay in RobinOverlay. Sub-components receive data as props. Do NOT add WS subscriptions to any extracted component.

### 2. initializedRef stays in parent

Line 117: `initializedRef` controls first-tab activation. It stays in RobinOverlay. No sub-component needs it.

### 3. switchTab clears multiple state variables atomically

Lines 197-213: `switchTab()` clears `selectedItemId`, `selectedWorkspaceId`, `showRegistry`, `showContext`, `wikiPage`, `items`. This stays in RobinOverlay. Sub-components don't call switchTab — they receive selected state via props and send actions via callbacks.

### 4. WikiToolbar querySelector — do not change

Line 500: `document.querySelector('.robin-wiki-link-btn')`. This is a known issue tracked in SPEC-18. Do not fix it here — move it as-is.

### 5. markdownToHtml import may need to move

WikiDetail uses `markdownToHtml`. After extraction, WikiDetail.tsx imports it. Check if RobinOverlay.tsx still uses it directly — if not, remove the import from RobinOverlay.tsx.

### 6. robin.css stays imported in RobinOverlay.tsx

All sub-components use classes from robin.css. Since it's imported at the RobinOverlay level and CSS is global, the sub-components don't need their own import. Do NOT add `import './robin.css'` to sub-component files.

---

## What NOT to Do

- Do not move state, effects, or WS subscriptions out of RobinOverlay
- Do not create a React context or custom hook for the Robin system
- Do not split the main component's JSX into sub-components
- Do not change robin.css
- Do not change the tab routing logic (the conditional render chain in the JSX)
- Do not fix the querySelector in WikiToolbar
- Do not change any sub-component behavior
- Do not add or remove inline styles

---

## Directory Structure After

```
src/components/Robin/
  RobinOverlay.tsx    ← main component (~500 lines)
  robin-types.ts      ← shared types + COLOR_SWATCHES (NEW)
  WikiDetail.tsx      ← WikiToolbar + WikiDetail (NEW)
  ConfigDetail.tsx    ← ConfigDetail (NEW)
  CLIDetail.tsx       ← CLIDetail + CLIRegistry (NEW)
  ThemeDetail.tsx     ← ColorPicker + SystemThemeDetail + WorkspaceThemeDetail (NEW)
  robin.css           ← unchanged
```

---

## Verification

1. **Build passes** — `npm run build`
2. **Open Robin panel** (click Robin icon) — tabs load, first tab auto-activates
3. **Switch tabs** — list updates, detail panel shows wiki guide
4. **Click a settings item** — detail panel shows ConfigDetail
5. **CLIs tab** — installed CLIs list, click one shows CLIDetail
6. **Add CLI button** — shows CLIRegistry
7. **Customization tab** — system theme + workspace list loads
8. **Click System Theme** — shows SystemThemeDetail with color picker
9. **Click a workspace** — shows WorkspaceThemeDetail with inherit toggle
10. **Wiki tab** — wiki pages list, click one shows WikiDetail with toolbar
11. **Copy reference button** (link icon in wiki) — copies to clipboard
12. **Context toggle** (text_compare icon) — switches between user guide and agent message

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Types not exported from robin-types | Build error | Caught immediately |
| markdownToHtml left in RobinOverlay but unused | Unused import warning | Harmless |
| robin.css imported in sub-component | Duplicate CSS load | Harmless but unnecessary |
| WikiToolbar querySelector not moved | Copy button broken | Button does nothing (pre-existing pattern) |
| ColorPicker state not moved with it | Color picker input doesn't work | Hex input unresponsive |
