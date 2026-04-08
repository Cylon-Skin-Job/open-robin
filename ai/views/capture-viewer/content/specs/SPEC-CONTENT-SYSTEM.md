# Content System Specification

## Overview

A universal, declarative content rendering system where folder structure drives UI and `content.json` files declare how each level renders. Every workspace panel follows the same structural contract. No bespoke React components per panel — one renderer reads declarations and composes the view.

---

## Panel Folder Structure

Every panel in `ai/views/` follows this layout:

```
{viewer}/
├── index.json          ← Panel identity (id, label, icon, rank, theme)
├── content.json        ← Display type for this panel's content area
├── chat/               ← Optional. Conversation threads for this workspace.
└── content/            ← Optional. Present for folder-driven display types.
    ├── settings/       ← Optional. Default CSS, icon, color scheme for items.
    │   └── styles.css
    └── ...folders...   ← Structure depends on display type.
```

- `index.json` — Panel metadata. Unchanged from current system.
- `content.json` — Declares the display type and rendering rules.
- `chat/` — Present if the panel has chat. Absent if it doesn't (e.g., terminal).
- `content/` — The viewable data. Folder structure maps to UI based on display type.
- `content/settings/` — Write-locked for AI. Contains default styling that flows down to all items. Individual items can override icon and color only.

---

## Content Types

### Folder-Driven Types

These types derive their UI from folder structure + `content.json` declarations.

#### `tiled-rows`

Folders within `content/` become labeled row headers. Items within each folder render as tiles beneath the header.

```
content/
├── content.json           ← { "display": "tiled-rows" }
├── settings/              ← Default tile icon, color, card layout
├── System/                ← Row header: "System"
│   ├── wiki-manager/      ← Tile
│   ├── code-manager/      ← Tile
│   └── ops-manager/       ← Tile
└── User/                  ← Row header: "User"
    └── my-agent/          ← Tile
```

**CSS cascade:** `settings/styles.css` defines defaults for all tiles. Individual item folders can override icon + color (via their own `index.json`). Card layout, typography, spacing flow down unchanged — all cards look structurally identical.

**Drill-in:** Clicking a tile goes full-screen detail view. The detail view can have pill tabs (e.g., Prompt / Triggers / Sessions / Runs). This is not tab nesting — the parent context is replaced.

**Used by:** agents-viewer, capture-viewer.

---

#### `navigation`

A list on the left drives content on the right. Clicking an item in the nav list shows its content.

```
content/
├── content.json           ← { "display": "navigation" }
├── settings/              ← Nav list styling (wiki circles, settings cards, plain list)
├── group-a/               ← Nav group header
│   ├── item-one/
│   │   └── PAGE.md        ← Content (rendered on right when selected)
│   └── item-two/
│       └── PAGE.md
└── group-b/               ← Nav group header
    └── item-three/
        └── PAGE.md
```

**Three-column behavior:** If `PAGE.md` contains a footer section (below a `---` delimiter or `## Footer` / `## Edges` marker), the footer content pulls out into a third column on the right. No footer = two-column layout. Responsive: right column collapses to bottom at narrow widths.

**Mechanism:** The nav list is always rendered. Clicking an item sets `display: block` on that item's content and `display: none` on the previous. Nav item gets an `active` class. That's the entire mechanism — everything else is CSS.

**Used by:** wiki-viewer (topics as nav items, PAGE.md as content, edges in footer = right column), settings-viewer tabs (each tab's content is a navigation view), future email app (inbox left, message right).

---

#### `columns`

Folders become columns arranged left to right. Items within each folder render as cards stacked vertically.

```
content/
├── content.json           ← { "display": "columns" }
├── open/                  ← Column: "Open"
│   ├── KIMI-0042.md       ← Card
│   └── KIMI-0043.md       ← Card
├── in-progress/           ← Column: "In Progress"
│   └── KIMI-0041.md       ← Card
└── done/                  ← Column: "Done"
    └── KIMI-0040.md       ← Card
```

**Moving items:** Moving a file between folders = moving the card between columns. Board state IS the filesystem.

**Used by:** issues-viewer (tickets by status), future to-do/kanban views.

---

#### `file-explorer`

Tree navigation with expandable folders. Selecting a file renders its content.

```
content/
├── content.json           ← { "display": "file-explorer" }
└── ...file tree...
```

**Pointer files:** For cases where content lives outside `ai/views/` (e.g., code-viewer pointing to the project repo root), use a `CONTENT.md` with a path declaration instead of symlinking into yourself:

```yaml
---
root: "${PROJECT_ROOT}"
---
```

**Used by:** code-viewer.

---

#### `library`

Hierarchical document reader for books, scientific studies, and reference material. Structurally similar to `file-explorer` but designed for reading, not code. Data lives in the project repo (like code-viewer), not in its own `content/` folder.

```
content/
├── content.json           ← { "display": "library" }
└── CONTENT.md             ← Pointer to library data root in repo
```

**Library data structure** (in repo):
```
library/
├── index.json             ← Collection index (sort order, metadata)
├── mythology/             ← Collection
│   ├── index.json         ← Book list, sort order
│   ├── greek-myths/       ← Book
│   │   ├── index.json     ← Table of contents (chapters, sections)
│   │   ├── ch01/          ← Chapter
│   │   │   ├── index.json ← Section headings, sort order
│   │   │   ├── 001.json   ← Content chunk
│   │   │   └── 002.json   ← Content chunk
│   │   └── ch02/
│   └── norse-myths/
└── research/              ← Collection
    └── study-001/
        ├── index.json
        └── ...
```

**Navigation:**
- Breadcrumb path at top (Collection > Book > Chapter) — each segment clickable for back-navigation.
- Back button at top of the nav column.
- Left column shows table of contents at current depth: collections → books → chapters → sections/headings.
- Clicking drills deeper: collection expands to show books, book expands to show chapters, chapter shows content with section headings in the left column.
- Content area renders the selected chunk/section as readable text.

**Data pipeline:** Source material (PDFs, scanned books) → OCR → chunk → enrich → structure as JSON in folders → index.json at each level manages sort and hierarchy. Supports RAG integration for AI-powered search and retrieval across the library.

**Used by:** library-viewer (scientific papers, personal book collections, reference material).

---

#### `tabbed`

A container type. Subfolders become pill tabs. Each subfolder declares its own content type via its own `content.json`. Tabbed views do not render content themselves — they switch which subfolder is visible.

```
content/
├── content.json           ← { "display": "tabbed" }
├── tickets/
│   └── content.json       ← { "display": "columns" }
├── pull-requests/
│   └── content.json       ← { "display": "columns" }
└── calendar/
    └── content.json       ← { "display": "calendar" }
```

**Rules:**
- **One level of tabs maximum.** A tabbed view never contains another tabbed view.
- Pill tab style by default. Customizable in `settings/`.
- Each tab is fully independent — different display types, different styling.

**Used by:** issues-viewer (tickets / PRs / calendar), settings-viewer (skills / triggers / sessions / etc.).

---

#### `list`

The primitive. Renders items from a folder as a scrollable list. Clickable. No content panel beside it — just the list.

```
content/
├── content.json           ← { "display": "list" }
├── item-a.md              ← List item
├── item-b.md              ← List item
└── item-c.md              ← List item
```

**Relationship to other types:**
- `navigation` = `list` + content area to the right.
- `columns` = multiple `list`s side by side.
- `list` is the base component that the others compose from.

---

#### `calendar`

Time-based view. Folder structure and frontmatter mapping TBD.

---

### Embedded Types

These types mount a widget directly. No `content/` folder. No folder-driven rendering.

#### `terminal`

Embedded terminal. No chat, no content folder.

```
terminal-viewer/
├── index.json
└── content.json           ← { "display": "terminal" }
```

---

#### `browser`

Embedded browser. Chat optional.

```
browser-viewer/
├── index.json
├── content.json           ← { "display": "browser" }
└── chat/                  ← Optional
```

---

## content.json Schema

Minimal declaration at each level:

```json
{
  "display": "tiled-rows | navigation | columns | file-explorer | library | tabbed | list | calendar | terminal | browser",
  "item": {
    "preview": "code | markdown | image | none",
    "meta": ["status", "schedule", "priority", "assignee"]
  },
  "features": {
    "search": true,
    "frozen": false
  }
}
```

- `display` — Required. Which content type to render.
- `item` — Optional. Declares how individual items render (preview thumbnails, metadata badges).
- `features` — Optional. Toggle capabilities.

For `tabbed` containers, per-tab configuration lives in each subfolder's own `content.json`. The parent just declares `"display": "tabbed"`.

---

## Tab Rules

1. **One level of tabs maximum.** `tabbed` content never nests another `tabbed` view.
2. **Drill-in is not nesting.** A `tiled-rows` view where clicking a tile opens a full-screen detail with pill tabs — that's drilling in, not tab nesting. The parent context is replaced entirely.
3. **Pill tabs by default.** Customizable in the panel's `content/settings/` folder.
4. **Clean demarcation.** Top-level tabs = structural (you're in a different section). Drill-in pill tabs = contextual (you're looking at facets of one thing). The visual difference creates clear hierarchy.

---

## CSS Cascade

1. `content/settings/styles.css` defines defaults for all items in that content area (icon, color, border, card shape, tile layout).
2. Individual item folders can override **icon and color only** (via their `index.json` or settings override).
3. Everything else — card layout, typography, spacing, detail view structure — flows down from the content-level settings. All cards/tiles look structurally identical within a content area.
4. The base rendering for each content type (navigation list, tile grid, column layout) uses CSS variables with fallback defaults, following the existing component pattern: `var(--token, fallback)`.

---

## Symlinks & Pointers

- **Symlinks are first-class.** Symlink any folder into `content/` and it appears as a row, tab, column, or nav item depending on the display type. The server already resolves symlinks with security checks.
- **Pointer files** for self-referential cases. A `CONTENT.md` with frontmatter declaring `root: "${PROJECT_ROOT}"` tells the system to serve content from that path. Used by code-viewer to point to the repo without creating a recursive symlink.
- **Cross-project composability.** Symlink another project's capture folder into your capture-viewer to see both side by side (as separate rows in `tiled-rows` or separate tabs if `tabbed`).

---

## Background Update Model

All content panels display files from the project filesystem. The system uses a cache-and-invalidate model:

1. **First paint:** Fetch, render, cache. Accept initial rendering cost.
2. **Navigation within panel:** Show/hide cached content. Never re-render unless data changed. No component unmount/remount.
3. **Background updates:** Server watches filesystem. On change, sends `file_changed` event via WebSocket. Client invalidates only the affected cache entry and re-renders that item.
4. **Panel switching:** Panels stay mounted (or their state is preserved). Switching panels toggles visibility, not lifecycle.

This is why chat doesn't flicker today — messages stay in memory, components stay mounted. Content panels must follow the same pattern.

---

## Panel Inventory (Target State)

| Panel | Display Type | Chat | Notes |
|---|---|---|---|
| capture-viewer | `tiled-rows` | Yes | Folders = row headers, items = tiles with code/image preview |
| code-viewer | `file-explorer` | Yes | CONTENT.md pointer to project root |
| wiki-viewer | `navigation` | Yes | Collections = nav groups, topics = nav items, footer = edges |
| issues-viewer | `tabbed` | Yes | Tabs: tickets (`columns`), PRs (`columns`), calendar (`calendar`) |
| agents-viewer | `tiled-rows` | No | System/User = row headers, agents = tiles. Drill-in = pill tabs |
| settings-viewer | `tabbed` | No | Each tab is `navigation` or other type as needed |
| library-viewer | `library` | Yes | Hierarchical doc reader. CONTENT.md pointer to repo library data. |
| terminal-viewer | `terminal` | No | Embedded widget |
| browser-viewer | `browser` | Optional | Embedded widget |

---

## Folder Cleanup (ai/ Target State)

The `ai/` directory contains only:

```
ai/
├── system/                ← System-level config and tools
└── views/                 ← All panel folders
    ├── index.json
    ├── agents-viewer/
    ├── capture-viewer/
    ├── code-viewer/
    ├── issues-viewer/
    ├── wiki-viewer/
    │   └── content/       ← Wiki data lives here (moved from ai/wiki-data/)
    ├── settings-viewer/
    │   └── content/
    │       └── components/modals/  ← Moved from ai/components/
    ├── terminal-viewer/
    └── browser-viewer/
```

**Removed:**
- `ai/wiki-data/` → moved into `ai/views/wiki-viewer/content/`
- `ai/wiki/` → deleted (stale duplicate)
- `ai/components/` → moved into `ai/views/settings-viewer/`
- `ai/scripts/` → setup-secrets.js replaced by AI skill + secrets manager; sync-wiki.sh stale (wrong path); capture-wire-output.js is dev tool (move to docs/ or delete); git-credential-kimi.sh moves to kimi-ide-server/
- `ai/STATE.md` → historical, let git history handle it or move to system/

---

## Relationship to Robin

Robin's system panel uses the same UI vocabulary (pill tabs, list+detail, card items) but reads from `robin.db` instead of the filesystem. The content type system is the filesystem equivalent of what Robin does with the database. Same patterns, same CSS, different data source.

---

## Future Platform Extensions

The content type system is general enough to power applications beyond the IDE:

- Email = `navigation` (inbox left, message right)
- Docs = `tiled-rows` (capture reskinned, markdown editor)
- Sheets = SQLite-backed tables with JS macros in scripts folder
- Calendar = `calendar` (standalone)
- Kanban/To-do = `columns`
- Brochures = HTML artifacts with PDF export
- Library = `library` (books, papers, research — OCR → chunk → enrich → RAG)

Workspace switching enables separate workspaces (IDE, Office, etc.) using the same panel system, same content types, different configurations.
