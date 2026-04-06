# Kimi IDE - Style Guide

**Shell, chat, and surfaces:** Token names, layered grays, neutral hairlines, and where CSS lives are documented in **`docs/UI_THEME_SURFACE.md`**. Read that first when changing layout chrome, chat, or explorer injection.

This guide covers **interaction chrome** (tools rail, header menu) and **workspace accent** behavior at a high level.

---

## Icon toolbar controls (tools rail + header menu)

The **implemented** pattern is **borderless** controls on **`--document-code-bg`** (tools rail) or header: **`color: var(--text-dim)`**, **no border**, transparent background. Hover and active use the **active workspace theme** (`--theme-primary` / `--theme-primary-rgb`), not a fixed cyan border recipe.

Accent cyan in `variables.css` is the **default** theme; the live panel still sets `--theme-border` / `--theme-border-glow` from the workspace primary in **`App.tsx`** (opacities **0.38** / **0.68**).

### CSS (canonical — `kimi-ide-client/src/components/App.css`)

```css
.menu-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  transition: color 0.2s ease, background 0.2s ease;
}

.menu-btn:hover {
  color: var(--theme-primary);
  background: rgba(var(--theme-primary-rgb), 0.05);
}

.tool-btn {
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  position: relative;
}

.tool-btn:hover {
  color: var(--theme-primary);
  background: rgba(var(--theme-primary-rgb), 0.05);
}

.tool-btn.active {
  color: var(--theme-primary);
}

.tool-btn.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 24px;
  background: var(--theme-primary);
  border-radius: 0 2px 2px 0;
}
```

### Visual states

| State | Border | Icon color | Background | Other |
|-------|--------|------------|------------|--------|
| Default | none | `--text-dim` | transparent | — |
| Hover | none | `--theme-primary` | `rgba(theme-rgb, 0.05)` | — |
| Active (tools) | none | `--theme-primary` | transparent | **3px left bar** (`::before`) |

**Not used in production:** The older **bordered glass** recipe (1px cyan border + box-shadow glow on every tool) described in revisions of this file before 2026-04. Do not reintroduce it for the tools rail or header menu unless product explicitly asks.

---

### HTML usage

```html
<button class="menu-btn" title="Menu" type="button">
  <span class="material-symbols-outlined">menu</span>
</button>

<nav class="tools-panel" aria-label="Workspaces">
  <button class="tool-btn active" title="Code" type="button">
    <span class="material-symbols-outlined">code_blocks</span>
  </button>
</nav>
```

---

### Where this applies

- **Tools panel** — workspace switcher icons (`.tool-btn`)
- **Header** — menu control (`.menu-btn`)

Other icon buttons (send, tabs, content toolbars) may use different classes; prefer **`UI_THEME_SURFACE.md`** and the relevant component CSS for those.

---

### Optional sizing

Default sizes are **60×60** (tools) and **40×40** (header menu). If you add smaller or larger variants, keep the same borderless + dim/hover/active rules and adjust only dimensions and icon size.

---

## Workspace color themes

Each workspace has a **primary accent** (and related colors) used for theme-aware UI: active tool state, header title, `--theme-border` on the app container, and workspace-specific panels that read `--ws-*` from **`kimi-ide-client/src/lib/panels.ts`** (`--ws-primary`, `--ws-sidebar-bg`, `--ws-content-bg`, `--ws-panel-border`).

The shell sets **`--theme-primary`** and **`--theme-primary-rgb`** from the active workspace config in **`App.tsx`** so tools/header track the current tab.

### Workspace list (conceptual accents)

| Workspace | Accent role |
|-----------|-------------|
| browser | Blue |
| code | Cyan |
| rocket | Orange |
| issues | Yellow |
| wiki | Pink |
| claw | Red |
| skills | Purple |

Exact hex values come from each workspace’s theme data and Robin/customization, not from this table.

---

*Updated: 2026-04-04*  
*Canonical surfaces/tokens: `docs/UI_THEME_SURFACE.md`*  
*Location: `docs/STYLE_GUIDE.md`*
