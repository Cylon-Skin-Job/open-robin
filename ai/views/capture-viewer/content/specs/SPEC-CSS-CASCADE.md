---
title: Spec — CSS Cascade System (Folder-Based Theme Inheritance)
created: 2026-03-30
status: draft
parent: MASTER_SYSTEM_SPEC.md
---

# CSS Cascade System

Styles flow down the folder tree. Child `settings/` folders override parent `settings/` folders. Anything not overridden falls through to the parent. This is pure CSS — no build step, no merge logic, just load order.

---

## The Rule

Every `settings/` folder in the `ai/` tree can contain a `styles.css`. The server collects them from root to leaf and injects them in order. Later styles win (standard CSS cascade).

```
ai/
  settings/
    styles.css              ← Layer 1: system-wide theme (header, sidebar, chrome, everything)
  views/
    settings/
      styles.css            ← Layer 2: all views share this override
    code-viewer/
      settings/
        styles.css          ← Layer 3: just this view
      agents/
        {agent-name}/
          settings/
            styles.css      ← Layer 4: just this agent's cards/UI
    agents-viewer/
      settings/
        styles.css
      System/
        {agent-name}/
          settings/
            styles.css      ← agent-specific card styling
```

---

## Cascade Order

The server resolves the style chain by walking from root to the current context:

```
1. ai/settings/styles.css                          ← system base
2. ai/views/settings/styles.css                     ← all-views override
3. ai/views/{current-view}/settings/styles.css      ← view-specific override
4. ai/views/{view}/agents/{agent}/settings/styles.css  ← agent-specific override
```

Each layer is injected as a `<style>` tag in document order. CSS specificity handles the rest — same selector in a later `<style>` tag wins.

---

## What Each Layer Can Override

**Any layer can override anything.** There is no scoping restriction.

- Layer 1 (system) defines the full theme: header, sidebar, chrome, content area, chat, everything
- Layer 2 (all-views) can change the sidebar color for all views while leaving the header alone
- Layer 3 (view-specific) can restyle the entire chrome when that view is active
- Layer 4 (agent-specific) can change agent card appearance

If a layer doesn't declare a property, the parent's value applies. This is just how CSS works.

---

## Design Tokens (Base Layer)

The system base (`ai/settings/styles.css`) defines CSS custom properties that all other layers reference:

```css
:root {
  /* Core palette */
  --bg-solid: #000000;
  --color-primary: #00d4ff;
  --color-secondary: #00a8cc;
  --border-primary: rgba(0, 212, 255, 0.3);
  --border-glow: rgba(0, 212, 255, 0.6);
  --glass-bg: rgba(0, 212, 255, 0.05);
  --text-white: #ffffff;
  --text-dim: rgba(255, 255, 255, 0.6);

  /* Layout */
  --header-height: 60px;
  --tools-width: 60px;
  --sidebar-width: 250px;
  --chat-width: 400px;

  /* Theme (dynamic per view) */
  --theme-primary: #00d4ff;
  --theme-primary-rgb: 0, 212, 255;
  --theme-border: rgba(0, 212, 255, 0.3);
  --theme-border-glow: rgba(0, 212, 255, 0.6);
}
```

Child layers can redefine any of these variables. All components reference variables, never hardcoded values.

---

## Template Pattern (Discovery Mechanism)

Each `settings/` folder ships with a **full copy** of the parent's styles.css, with everything commented out except a header explaining the pattern:

```css
/* =============================================
   VIEW: code-viewer
   Override system theme for this view.
   Uncomment properties to customize.
   Anything left commented inherits from parent.
   ============================================= */

/* --- Palette ---
:root {
  --bg-solid: #000000;
  --color-primary: #00d4ff;
  --color-secondary: #00a8cc;
}
*/

/* --- Header ---
.app-header {
  background: var(--bg-solid);
  border-bottom: 1px solid var(--theme-border);
}
*/

/* --- Sidebar ---
.sidebar {
  background: var(--bg-solid);
  border-right: 1px solid var(--theme-border);
}
*/

/* ... full copy of every section, all commented out ... */
```

Users uncomment what they want to change. This makes the system self-documenting — you don't need to know all the class names, they're right there in the template.

---

## Server Implementation

### Style chain resolution

```
resolveStyleChain(contextPath) → string[]
```

Given a context path (e.g., `ai/views/code-viewer/agents/kimi`):

1. Start at `ai/settings/styles.css`
2. Walk toward the context, checking each `settings/styles.css` along the way
3. Return ordered array of file paths that exist

### Delivery

Two modes:

**A. WebSocket fetch (current runtime-module pattern)**
- Client requests style chain for current view
- Server returns ordered array of CSS strings
- Client injects as `<style>` tags in order

**B. On view switch**
- When user switches views, client requests new style chain
- Old view-specific `<style>` tags are removed
- New chain injected
- System base (layer 1) persists across switches

### Style tag management

Each injected `<style>` tag gets a `data-layer` attribute:

```html
<style data-layer="system">/* ai/settings/styles.css */</style>
<style data-layer="all-views">/* ai/views/settings/styles.css */</style>
<style data-layer="view" data-view="code-viewer">/* view-specific */</style>
<style data-layer="agent" data-agent="kimi">/* agent-specific */</style>
```

On view switch: remove `data-layer="view"` and `data-layer="agent"` tags, inject new ones.

---

## Interaction with Existing Systems

### applyPanelTheme (current)
Currently sets `--theme-*` variables inline on the app container per view. This becomes the JS-side equivalent of the view layer — it sets the variables that the CSS references. The two systems complement each other:

- `applyPanelTheme` sets runtime variables (view color, computed values)
- `settings/styles.css` chain handles structural overrides (layout, component styling)

### runtime-module.ts (current)
Currently loads `ui/styles.css` per view. This is a separate concern — plugin module styles for custom view content. The cascade system handles the chrome/shell theming; runtime module styles handle the view's internal content.

### settings/ enforcement
All `settings/` folders are:
- Write-locked for AI (enforcement.js)
- Gitignored (user config stays local)
- Human-managed only

This means: the AI cannot modify themes. Users own their visual customization entirely.

### settings/ gitignore
Because `settings/` is gitignored, each user's theme customizations are local. Pulling from git never overwrites your styling choices.

---

## Current State vs Target

### What exists now
- `variables.css` with `:root` tokens (compiled into app bundle)
- `index.css` with 857 lines of component styles (compiled into app bundle)
- Per-component `.css` files (compiled into app bundle)
- `applyPanelTheme` sets `--theme-*` inline per view
- `runtime-module.ts` loads one `ui/styles.css` per view via WebSocket

### What needs to change
1. Extract base theme from `variables.css` + `index.css` into `ai/settings/styles.css`
2. Build `resolveStyleChain()` on the server
3. Client-side style tag injection with `data-layer` management
4. Generate commented-out template copies for each `settings/` folder
5. Wire view switching to swap style layers

### What stays the same
- `applyPanelTheme` continues handling runtime variable injection
- `runtime-module.ts` continues loading plugin-specific `ui/styles.css`
- Component `.css` files stay compiled for core app structure
- All CSS continues using `var()` with fallback defaults

---

## Open Questions

1. **Template generation**: Should the commented-out template be auto-generated from the parent's styles.css on folder creation? Or manually maintained?

2. **Hot reload**: When a user edits `settings/styles.css`, should a file watcher trigger live reload of the style chain? (Trigger-based: watch `**/settings/styles.css` → reload styles)

3. **Agent card styling scope**: Agent cards in agents-viewer render from the agent's folder. Should the agent's `settings/styles.css` apply only when viewing that agent's detail, or also when its card appears in a list?

4. **Modal and overlay styling**: Robin overlay and modals sit above views. Should they only inherit from layers 1-2 (system + all-views), ignoring view-specific and agent-specific layers?

5. **Compiled vs runtime**: The current app bundles CSS at build time. The cascade system loads CSS at runtime from the filesystem. Should the compiled CSS be the fallback/default, with runtime styles overlaying it? Or should everything move to runtime loading?
