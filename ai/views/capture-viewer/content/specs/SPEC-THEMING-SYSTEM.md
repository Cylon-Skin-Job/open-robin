# Theming & View Templating System Specification

## Overview

A three-file CSS architecture stored in SQLite, served to every workspace, with a cascading override system. New views are created from templates stored in `ai/system/`. The customization tab in settings provides GUI control over colors, and optionally layout, without touching code.

---

## Three CSS Files

### 1. `themes.css` — Color Palette

Pure color definitions. No structural rules. One primary accent color chosen by the user; all derivatives computed from it.

```css
:root {
  /* User picks this one color */
  --color-primary: #4fc3f7;

  /* Derived automatically */
  --color-primary-rgb: 79, 195, 247;
  --color-primary-dim: rgba(var(--color-primary-rgb), 0.12);
  --color-primary-glow: rgba(var(--color-primary-rgb), 0.25);
  --color-primary-border: rgba(var(--color-primary-rgb), 0.33);

  /* Background scale */
  --bg-base: #0a0a0a;
  --bg-surface: #111111;
  --bg-elevated: #1a1a1a;
  --bg-hover: #222222;

  /* Text scale */
  --text-primary: #e0e0e0;
  --text-secondary: #999999;
  --text-dim: #666666;

  /* Borders */
  --border-default: #282828;
  --border-subtle: #1e1e1e;

  /* Scrollbar */
  --scrollbar-thumb: var(--border-default);
  --scrollbar-thumb-hover: var(--color-primary-border);

  /* Shadows */
  --shadow-soft: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-medium: 0 4px 16px rgba(0, 0, 0, 0.4);
}
```

**Pre-built themes** are just different values for these variables:

| Theme | --bg-base | --bg-surface | --bg-elevated | --text-primary |
|-------|-----------|-------------|---------------|----------------|
| OLED Black | #000000 | #0a0a0a | #111111 | #e0e0e0 |
| Dark | #0a0a0a | #111111 | #1a1a1a | #e0e0e0 |
| Medium | #1a1a1a | #242424 | #2e2e2e | #d0d0d0 |
| Light | #f5f5f5 | #ffffff | #fafafa | #1a1a1a |

### 2. `components.css` — Structural Styles

Every UI element references theme variables. Never a hardcoded color. This file defines what things look like structurally — borders, backgrounds, text colors, scrollbars, badges, buttons, cards, headers — all in terms of the palette from `themes.css`.

```css
/* Chrome / Frame */
.app-header { background: var(--bg-surface); border-bottom: 1px solid var(--border-default); }
.tools-panel { background: var(--bg-base); border-right: 1px solid var(--border-subtle); }
.sidebar { background: var(--bg-base); }

/* Content */
.content-area { background: var(--bg-base); }
.panel-border { border-color: var(--color-primary-dim); }

/* Cards / Tiles */
.card { background: var(--bg-surface); border: 1px solid var(--border-default); }
.card:hover { background: var(--bg-hover); border-color: var(--color-primary-border); }
.card.active { border-color: var(--color-primary); }

/* Scrollbars */
::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }

/* Text */
.heading { color: var(--text-primary); }
.subtext { color: var(--text-secondary); }
.label { color: var(--text-dim); }

/* Accent elements */
.active-indicator { color: var(--color-primary); }
.badge { background: var(--color-primary-dim); color: var(--color-primary); }
.tab.active { border-color: var(--color-primary); color: var(--color-primary); }
```

**Rule:** `components.css` never changes between themes. Only `themes.css` values change.

### 3. `layout.css` — Spatial Configuration

Column widths, grid definitions, spacing, responsive breakpoints. Separate from colors and component styling so that layout can be tweaked independently.

```css
/* Grid */
.app-grid {
  grid-template-columns: var(--tools-width, 60px) var(--sidebar-width, 280px) var(--chat-width, 480px) 1fr;
  grid-template-rows: var(--header-height, 48px) 1fr;
}

/* Navigation column */
.nav-list { width: var(--nav-width, 240px); }

/* Content padding */
.content-area { padding: var(--content-padding, 24px); }

/* Responsive */
@media (max-width: 1200px) { ... }
@media (max-width: 768px) { ... }
```

Layout is the file users can modify to change column widths, move things around, adjust spacing. It has sensible defaults that work out of the box.

---

## Storage & Delivery

### SQLite Storage

All three CSS files are stored in the database as the **system defaults**:

```sql
CREATE TABLE system_css (
  id TEXT PRIMARY KEY,          -- 'themes', 'components', 'layout'
  css TEXT NOT NULL,             -- The full CSS content
  updated_at TEXT DEFAULT (datetime('now'))
);
```

The customization panel in settings reads and writes to this table. Changes reflect live.

### Delivery

On page load, the server sends the composed CSS:

1. Read system `themes.css` from SQLite
2. Check if active workspace has a `themes.css` override in its `content/settings/` folder
3. Check if active view has a `themes.css` override in its `content/settings/` folder
4. Compose: system base → workspace override → view override
5. Inject as `<style>` tags (or serve as CSS files with cache-busting)

### Override Cascade

```
System theme (SQLite)
  └─ Workspace override (ai/views/{workspace}/content/settings/themes.css)
      └─ View override (ai/views/{viewer}/content/settings/themes.css)
```

Each level only needs to declare the variables it wants to change. Everything else flows down from the level above.

**Example:** A workspace that only wants a different accent color:
```css
/* ai/views/my-workspace/content/settings/themes.css */
:root {
  --color-primary: #e91e63;
  --color-primary-rgb: 233, 30, 99;
}
/* Everything else inherited from system theme */
```

---

## Robin / System Panel

Robin **always** uses the system-level theme, never the workspace theme. It renders as a fixed overlay at z-index 600 — it should look consistent regardless of which workspace is active beneath it.

Implementation: Robin's overlay container resets to system theme variables, ignoring any workspace overrides applied to the document root.

---

## Customization Tab in Settings

### Layout

```
┌─────────────────────────────────────────────────────┐
│  [ Skills ] [ Triggers ] ... [ Customization ]      │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│  System      │  Theme: [Dark ▾]                     │
│  ──────────  │                                      │
│  Workspace A │  Primary Color: [●] #4fc3f7          │
│  Workspace B │  [color wheel]                       │
│  Workspace C │                                      │
│              │  Presets:                             │
│              │  [●] [●] [●] [●] [●] [●]            │
│              │                                      │
│              │  Preview:                             │
│              │  ┌────────────────────────┐           │
│              │  │  [live preview panel]  │           │
│              │  └────────────────────────┘           │
│              │                                      │
│              │  Layout:                              │
│              │  Sidebar width: [280px ▾]             │
│              │  Chat width: [480px ▾]                │
│              │                                      │
└──────────────┴──────────────────────────────────────┘
```

### Behavior

- **Left column:** "System" at top (global defaults), then all workspaces listed below
- **Click "System":** Edit the base theme that all workspaces inherit
- **Click a workspace:** Edit that workspace's overrides. Only shows what's different from system. "Reset to system" button clears overrides
- **Color picker:** Preset swatches + free color wheel. Picking a color computes all derived variables
- **Theme selector:** Dropdown for Light / Medium / Dark / OLED Black (swaps entire themes.css)
- **Live preview:** Changes visible immediately in the settings panel and, for the active workspace, in the workspace below
- **On exit:** Full app reflects changes

### What the GUI Controls

| Setting | CSS File | Variable |
|---------|----------|----------|
| Theme preset | themes.css | All background/text vars |
| Primary accent color | themes.css | --color-primary + derived |
| Sidebar width | layout.css | --sidebar-width |
| Chat width | layout.css | --chat-width |
| Header height | layout.css | --header-height |
| Content padding | layout.css | --content-padding |

Advanced users can edit CSS files directly in the workspace's `content/settings/` folder for full control. The GUI is a constrained interface over the same variables.

---

## View Templating System

### Templates in `ai/system/`

Each content type has a template folder stored in `ai/system/templates/`:

```
ai/system/
├── templates/
│   ├── tiled-rows/
│   │   ├── content.json       ← default content declaration
│   │   ├── index.json         ← panel config template (icon, label placeholders)
│   │   └── content/
│   │       └── settings/
│   │           └── styles.css ← default tile styling
│   ├── navigation/
│   │   ├── content.json
│   │   ├── index.json
│   │   └── content/
│   │       └── settings/
│   │           └── styles.css
│   ├── columns/
│   │   ├── content.json
│   │   ├── index.json
│   │   └── content/
│   │       └── settings/
│   │           └── styles.css
│   ├── file-explorer/
│   │   ├── content.json
│   │   ├── index.json
│   │   └── content/
│   │       └── CONTENT.md     ← pointer file template
│   ├── tabbed/
│   │   ├── content.json
│   │   └── index.json
│   ├── library/
│   │   ├── content.json
│   │   ├── index.json
│   │   └── content/
│   │       └── CONTENT.md
│   ├── terminal/
│   │   ├── content.json
│   │   └── index.json
│   ├── browser/
│   │   ├── content.json
│   │   └── index.json
│   └── calendar/
│       ├── content.json
│       └── index.json
```

### Creating a New View

User says "I want to add a library viewer to this workspace."

1. System reads `ai/system/templates/library/`
2. Copies the template into `ai/views/library-viewer/`
3. Fills in `index.json` placeholders (id, label, rank, created date)
4. Creates `content/` and `chat/` folders as appropriate
5. No custom CSS — inherits system theme + workspace theme automatically
6. View appears in the tools panel immediately (panel discovery picks it up)

Everything works out of the box. No code changes. No build step. The content type's template includes the right `content.json`, the right folder structure, and sensible default settings.

### Extending Templates

Templates ship with the app. They define the structural HTML, CSS, and any scripts needed for each content type. Adding a new content type means:

1. Build the renderer (one-time code work)
2. Create the template folder in `ai/system/templates/`
3. Now anyone can instantiate that type by creating a view from the template

The template IS the content type's definition — it's the portable unit that makes "add this view" a folder copy, not a development task.

---

## Relationship to Content System

This spec handles the visual layer. The Content System spec (SPEC-CONTENT-SYSTEM.md) handles the data layer. Together:

- **Content System:** What data exists, how folders map to UI, what `content.json` declares
- **Theming System:** How it looks — colors, borders, spacing, scrollbars, cards
- **Templates:** The intersection — a template bundles content structure + default styling into an installable unit

The theming work should be done **first** because:
1. It establishes the variable namespace that all content types will use
2. It fixes the current CSS bleed-through issues (Robin scrollbar, etc.)
3. Templates need the theming cascade to exist before they can inherit properly
4. The content system refactor will be building on stable visual foundations

---

## Implementation Order

1. **Define the CSS variable namespace** — finalize the list of variables in themes.css
2. **Migrate existing hardcoded colors** to theme variables across all CSS files
3. **Store system CSS in SQLite** — themes.css, components.css, layout.css
4. **Build the customization tab** in settings-viewer — workspace list + color picker
5. **Implement cascade** — system → workspace → view override resolution
6. **Fix Robin isolation** — Robin overlay always uses system theme
7. **Create templates** in ai/system/templates/ for each content type
8. **Wire up "create new view"** — template copy + panel discovery

---

## Design Principles

- **One color input, everything derived.** User picks an accent color. All dim/glow/border variants compute automatically.
- **themes.css changes, components.css doesn't.** Switching themes = swapping variable values. Structure never changes.
- **Layout is independent of color.** You can change column widths without affecting colors and vice versa.
- **Override only what you change.** Workspace overrides are sparse — only the variables that differ from system. Everything else flows down.
- **GUI for constraints, files for freedom.** The customization tab exposes safe knobs. Power users edit CSS files directly.
- **Templates are portable.** Copy a template folder, get a working view. No code changes needed.
- **Robin is always system-themed.** It's the frame, not the content. It never inherits workspace colors.
