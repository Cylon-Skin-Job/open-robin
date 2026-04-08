# Customization Tab Specification

## Overview

A new tab in the Robin system panel for managing workspace themes. System-level theme is the baseline. Each workspace can inherit it or use custom colors. All theme data lives in SQLite (system partition). The filesystem receives propagated CSS — it's never the source of truth, but it can be hand-edited and absorbed back.

---

## Location

Robin system panel → new "Customization" tab alongside CLIs, Connectors, Secrets, LLM Providers, Enforcement.

---

## Database Schema

### Migration: `003_workspace_themes.js`

```sql
-- System-level theme (the baseline everything inherits)
CREATE TABLE system_theme (
  id TEXT PRIMARY KEY DEFAULT 'default',
  preset TEXT DEFAULT 'dark',           -- 'light' | 'medium' | 'dark' | 'oled'
  primary_color TEXT DEFAULT '#4fc3f7',
  primary_rgb TEXT DEFAULT '79, 195, 247',
  theme_css TEXT NOT NULL,              -- Full themes.css content
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Workspaces registry (user-managed, grows over time)
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon TEXT DEFAULT 'folder',
  description TEXT,
  repo_path TEXT,                        -- Absolute path to the repo/project root (null for built-in)
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Per-workspace custom themes (always preserved, never wiped)
CREATE TABLE workspace_themes (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  primary_color TEXT DEFAULT '#4fc3f7',
  primary_rgb TEXT DEFAULT '79, 195, 247',
  theme_css TEXT,                       -- Custom themes.css content (null = never customized)
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**Design notes:**
- Workspaces and themes are separate tables. A workspace always exists in `workspaces`. It gets a `workspace_themes` row only when the user first customizes its colors.
- `workspaces.repo_path` is the absolute path to the project root. This is what the workspace switcher (upper-left menu) uses to change the active project. Null for built-in/system workspaces.
- There is no `custom_enabled` or toggle column. The toggle state is derived at render time by diffing the filesystem CSS against system and workspace CSS in the database.
- New workspaces added by the user automatically appear in the Customization tab. No manual registration needed.

### Seed Data

**system_theme:** One row with the default dark theme CSS and `#4fc3f7` primary.

**workspaces:** Initial stubs (users can add/remove):

| id | label | icon | repo_path | sort_order |
|---|---|---|---|---|
| system | System | settings | null | 0 |
| chat | Chat | chat | null | 1 |
| home-office | Home Office | home | null | 2 |
| bookkeeping | Bookkeeping App | account_balance | null | 3 |
| media-center | Media Center | play_circle | null | 4 |
| code-editor | Code Editor | code | null | 5 |
| research-vault | Research Vault | science | null | 6 |

**workspace_themes:** No rows seeded. All workspaces inherit system theme by default. A row is created in `workspace_themes` only when a user first customizes that workspace's colors.

The "System" workspace is special — selecting it in the Customization tab edits `system_theme`, not `workspace_themes`.

### Tab Registration

Add to `system_tabs`:

```javascript
{
  id: 'customization',
  label: 'Customization',
  icon: 'palette',
  description: 'Set the system theme and customize individual workspace colors. Changes here flow to every workspace unless overridden.',
  sort_order: 5,  // After enforcement (4), before nothing
}
```

### Wiki Page

Add to `system_wiki`:

```javascript
{
  slug: 'customization',
  title: 'Customization',
  content: '## How theming works\n\nOpen Robin uses a single accent color to define the entire look of the interface...',
  tab: 'customization',
  description: 'Theme system, color picker, and hand-editing CSS',
  // ... (full content below in Guide Content section)
}
```

---

## Three States Per Workspace

When the customization tab renders and a workspace is selected, the system determines which of three states it's in by diffing the filesystem CSS against the database.

### State 1: Inheriting System Theme

**How detected:** Filesystem CSS at `ai/views/settings/themes.css` matches `system_theme.theme_css` from the database.

**UI:**
- Toggle shows **ON** (inherit system)
- Color picker is **greyed out / disabled**
- Label: "This workspace uses the system theme"

**What the toggle did:** Copied `system_theme.theme_css` → `ai/views/settings/themes.css`

### State 2: Custom via GUI

**How detected:** Filesystem CSS matches `workspace_themes.theme_css` for this workspace (and does NOT match system theme).

**UI:**
- Toggle shows **OFF** (custom)
- Color picker is **active** — shows this workspace's custom primary color
- Preset swatches available
- Changes save to `workspace_themes.theme_css` in SQLite AND write to filesystem immediately

**What the toggle does if flipped ON:** Copies `system_theme.theme_css` → filesystem. Custom CSS in SQLite is **preserved** (not deleted). Flipping back restores it.

### State 3: Hand-Edited (Diverged)

**How detected:** Filesystem CSS matches **neither** `system_theme.theme_css` nor `workspace_themes.theme_css`.

**UI:**
- Toggle is **replaced** by an "Apply" button (refresh/apply icon)
- Color picker shows last SQLite state (may not match filesystem)
- Label: "CSS has been modified outside the system panel"
- Instructions: "Click Apply to save your changes to the system"

**What Apply does:**
1. Reads filesystem CSS from `ai/views/settings/themes.css`
2. Writes it to `workspace_themes.theme_css` in SQLite
3. Extracts primary color from the CSS if possible (parse `--color-primary` value)
4. Updates `workspace_themes.primary_color` and `primary_rgb`
5. UI returns to State 2 (custom via GUI, toggle OFF, color picker updated)

---

## Left Panel: Workspace List

Standard Robin settings list pattern. One item per workspace.

```
┌──────────────────────────┐
│ 📖 Customization Guide   │  ← guide link (returns right panel to wiki)
│ ─────────────────────── │
│                          │
│ ● System                 │
│   ⚙ System               │  ← special: edits system_theme, not workspace_themes
│                          │
│ ● Workspaces             │
│   💬 Chat                │
│   🏠 Home Office         │
│   📊 Bookkeeping App     │
│   🎬 Media Center        │
│   💻 Code Editor          │
│   🔬 Research Vault       │
│                          │
└──────────────────────────┘
```

**Section dividers:** "System" and "Workspaces" — using the existing `robin-settings-section-divider` pattern.

**Item cards:** Icon + label + status badge:
- Badge shows "system" (inheriting), "custom" (has custom theme), or "modified" (diverged/hand-edited)
- Uses existing `robin-setting-item` styling

**Selecting "System":** Right panel shows the system-level color picker. Changes here affect ALL workspaces that inherit. No toggle (system is always its own source).

**Selecting a workspace:** Right panel shows that workspace's customization with the three-state toggle/apply logic.

---

## Right Panel: System Theme

When "System" is selected in the left panel:

```
┌─────────────────────────────────────────────┐
│  ← Customization / System                    │
│                                             │
│  🎨 System Theme                             │
│  The baseline look for all workspaces.      │
│  Workspaces inherit this unless they         │
│  have custom overrides.                      │
│                                             │
│  ┌───────────────────────────────────┐      │
│  │  Theme                           │      │
│  │  [Dark ▾]                        │      │
│  │                                  │      │
│  │  Primary Color                   │      │
│  │  [●] #4fc3f7                     │      │
│  │                                  │      │
│  │  ○ Sky    ○ Teal   ○ Lavender   │      │
│  │  ○ Sage   ○ Peach  ○ Steel     │      │
│  │  ○ Lilac  ○ Ice                 │      │
│  │                                  │      │
│  │  [  Custom color wheel  ]        │      │
│  └───────────────────────────────────┘      │
│                                             │
│  ## Preview                                 │
│                                             │
│  ┌───────────────────────────────────┐      │
│  │  Sample card with current colors  │      │
│  │  showing bg, border, accent,     │      │
│  │  text hierarchy, badge, toggle   │      │
│  └───────────────────────────────────┘      │
│                                             │
└─────────────────────────────────────────────┘
```

**Theme preset dropdown:** Light / Medium / Dark / OLED Black. Selecting a preset changes all background and text variables. The primary accent color is independent of the preset.

**Color swatches:** The eight preset colors from DESIGN.md (Sky, Teal, Lavender, Sage, Peach, Steel, Lilac, Ice). Clicking one sets the primary and recomputes all derived values.

**Custom color wheel:** For users who want a specific color not in the presets. Standard hue wheel / saturation-brightness picker.

**Preview panel:** A live mini-preview showing a sample card, text hierarchy, badge, toggle, and button using the current colors. Updates in real time as the user picks colors.

**Save behavior:** Changes save to `system_theme` table immediately on interaction (no save button). Propagation to filesystem happens for all workspaces that are in State 1 (inheriting).

---

## Right Panel: Workspace Theme

When a workspace is selected in the left panel:

### State 1 — Inheriting

```
┌─────────────────────────────────────────────┐
│  ← Customization / Code Editor               │
│                                             │
│  💻 Code Editor                              │
│  This workspace uses the system theme.       │
│                                             │
│  [ ● Inherit system theme ──── ON ]         │
│                                             │
│  ┌───────────────────────────────────┐      │
│  │  Color picker (greyed out)       │      │
│  │  Primary: #4fc3f7 (from system)  │      │
│  │  [swatches disabled]             │      │
│  └───────────────────────────────────┘      │
│                                             │
│  ## Customizing by hand                     │
│                                             │
│  To customize this workspace's appearance,  │
│  flip the toggle above, or edit the CSS     │
│  directly at:                               │
│                                             │
│  `ai/views/settings/themes.css`             │
│                                             │
│  After editing, come back here and click    │
│  Apply to save your changes to the system.  │
│                                             │
└─────────────────────────────────────────────┘
```

### State 2 — Custom

```
┌─────────────────────────────────────────────┐
│  ← Customization / Code Editor               │
│                                             │
│  💻 Code Editor                              │
│  This workspace has a custom theme.          │
│                                             │
│  [ ○ Inherit system theme ──── OFF ]        │
│                                             │
│  ┌───────────────────────────────────┐      │
│  │  Primary Color                   │      │
│  │  [●] #4dd0c7                     │      │
│  │                                  │      │
│  │  ○ Sky    ● Teal   ○ Lavender   │      │
│  │  ○ Sage   ○ Peach  ○ Steel     │      │
│  │  ○ Lilac  ○ Ice                 │      │
│  │                                  │      │
│  │  [  Custom color wheel  ]        │      │
│  └───────────────────────────────────┘      │
│                                             │
│  ## Customizing by hand                     │
│                                             │
│  You can also edit the CSS directly at:     │
│  `ai/views/settings/themes.css`             │
│                                             │
│  After editing, come back here and click    │
│  Apply to save your changes to the system.  │
│                                             │
└─────────────────────────────────────────────┘
```

### State 3 — Diverged (Hand-Edited)

```
┌─────────────────────────────────────────────┐
│  ← Customization / Code Editor               │
│                                             │
│  💻 Code Editor                              │
│  CSS has been modified outside the panel.    │
│                                             │
│  [ ↻ Apply Changes ]                        │
│                                             │
│  ┌───────────────────────────────────┐      │
│  │  Primary Color                   │      │
│  │  [●] #4dd0c7 (last saved)       │      │
│  │                                  │      │
│  │  Note: The file on disk may have │      │
│  │  different colors. Click Apply   │      │
│  │  to sync.                        │      │
│  └───────────────────────────────────┘      │
│                                             │
│  ## What happened                           │
│                                             │
│  The CSS at `ai/views/settings/themes.css`  │
│  has been edited directly and no longer     │
│  matches what's saved here. This is fine —  │
│  click Apply above to absorb your changes   │
│  into the system so they're preserved.      │
│                                             │
└─────────────────────────────────────────────┘
```

---

## WebSocket Protocol

### Client → Server

```
robin:theme-workspaces                    → Request all workspace theme entries
robin:theme-system                        → Request system theme
robin:theme-workspace-detail              → { workspace_id } Request one workspace's theme + diff state
robin:theme-system-update                 → { preset?, primary_color?, primary_rgb?, theme_css } Update system theme
robin:theme-workspace-update              → { workspace_id, primary_color?, primary_rgb?, theme_css } Update workspace custom theme
robin:theme-workspace-inherit             → { workspace_id } Set workspace to inherit system (overwrite filesystem)
robin:theme-workspace-apply               → { workspace_id } Absorb filesystem CSS into workspace's SQLite row
```

### Server → Client

```
robin:theme-workspaces                    → { workspaces: Array<WorkspaceThemeItem> }
robin:theme-system                        → { preset, primary_color, primary_rgb, theme_css }
robin:theme-workspace-detail              → { workspace_id, state, primary_color, primary_rgb, theme_css }
                                             state: 'inheriting' | 'custom' | 'diverged'
robin:theme-updated                       → { workspace_id?, success, message }
```

### Diff Logic (Server-Side)

When `robin:theme-workspace-detail` is requested:

```javascript
async function getWorkspaceThemeState(db, workspaceId, projectRoot) {
  const systemTheme = await db('system_theme').where('id', 'default').first();
  const workspaceTheme = await db('workspace_themes').where('workspace_id', workspaceId).first();

  // Read filesystem CSS
  const cssPath = path.join(projectRoot, 'ai', 'views', 'settings', 'themes.css');
  let filesystemCss = null;
  try { filesystemCss = await fs.readFile(cssPath, 'utf8'); } catch {}

  // Determine state
  let state = 'inheriting';
  if (filesystemCss === null) {
    state = 'inheriting'; // No file = inheriting by default
  } else if (filesystemCss.trim() === systemTheme.theme_css.trim()) {
    state = 'inheriting';
  } else if (workspaceTheme?.theme_css && filesystemCss.trim() === workspaceTheme.theme_css.trim()) {
    state = 'custom';
  } else {
    state = 'diverged';
  }

  return {
    workspace_id: workspaceId,
    state,
    primary_color: state === 'inheriting' ? systemTheme.primary_color : (workspaceTheme?.primary_color || systemTheme.primary_color),
    primary_rgb: state === 'inheriting' ? systemTheme.primary_rgb : (workspaceTheme?.primary_rgb || systemTheme.primary_rgb),
    theme_css: state === 'inheriting' ? systemTheme.theme_css : (workspaceTheme?.theme_css || systemTheme.theme_css),
  };
}
```

### Inherit Action (Server-Side)

When `robin:theme-workspace-inherit` is received:

```javascript
// 1. Read system theme CSS from SQLite
// 2. Write it to ai/views/settings/themes.css
// 3. Do NOT modify workspace_themes row (custom CSS preserved)
// 4. Send robin:theme-updated confirmation
```

### Apply Action (Server-Side)

When `robin:theme-workspace-apply` is received:

```javascript
// 1. Read ai/views/settings/themes.css from filesystem
// 2. Parse --color-primary value from the CSS if possible
// 3. Write to workspace_themes: theme_css, primary_color, primary_rgb, updated_at
// 4. Send robin:theme-updated confirmation
// 5. Client refreshes to State 2 (custom)
```

---

## Color Picker Component

### Preset Swatches

Eight colors from DESIGN.md, rendered as small filled circles:

| Name | Hex | RGB |
|------|-----|-----|
| Sky | #4fc3f7 | 79, 195, 247 |
| Teal | #4dd0c7 | 77, 208, 199 |
| Lavender | #9fa8da | 159, 168, 218 |
| Sage | #81c784 | 129, 199, 132 |
| Peach | #f0a07a | 240, 160, 122 |
| Steel | #90a4ae | 144, 164, 174 |
| Lilac | #b39ddb | 179, 157, 219 |
| Ice | #80deea | 128, 222, 234 |

Clicking a swatch:
1. Sets `primary_color` and `primary_rgb`
2. Regenerates the full `theme_css` with derived opacity values
3. Saves to appropriate SQLite table (system or workspace)
4. Writes to filesystem
5. Live-updates the app if this is the active workspace

### Custom Color Wheel

Standard HSB color picker (hue ring + saturation/brightness square). Any color can be chosen. On selection, same flow as swatch click.

### Derived Values

From a single primary color, the system generates:

```css
--color-primary: {hex};
--color-primary-rgb: {r}, {g}, {b};
--color-primary-ghost: rgba({r}, {g}, {b}, 0.05);
--color-primary-fill: rgba({r}, {g}, {b}, 0.08);
--color-primary-dim: rgba({r}, {g}, {b}, 0.12);
--color-primary-border: rgba({r}, {g}, {b}, 0.25);
```

These are generated server-side when building the full `theme_css` string. The rest of the CSS (backgrounds, text, borders) comes from the preset (dark/light/medium/oled).

---

## Theme Presets

Four presets define the non-accent colors:

### Dark (Default)

```css
--bg-void: #0a0a0a;
--bg-inset: #0d0d0d;
--bg-base: #111111;
--bg-card: #161616;
--bg-hover: #1c1c1c;
--border-subtle: #1e1e1e;
--border-default: #282828;
--text-primary: #e0e0e0;
--text-secondary: #aaaaaa;
--text-dim: #666666;
```

### OLED Black

```css
--bg-void: #000000;
--bg-inset: #050505;
--bg-base: #0a0a0a;
--bg-card: #111111;
--bg-hover: #161616;
--border-subtle: #1a1a1a;
--border-default: #222222;
--text-primary: #e0e0e0;
--text-secondary: #aaaaaa;
--text-dim: #666666;
```

### Medium

```css
--bg-void: #1a1a1a;
--bg-inset: #1e1e1e;
--bg-base: #242424;
--bg-card: #2a2a2a;
--bg-hover: #303030;
--border-subtle: #333333;
--border-default: #3a3a3a;
--text-primary: #e0e0e0;
--text-secondary: #bbbbbb;
--text-dim: #777777;
```

### Light

```css
--bg-void: #f5f5f5;
--bg-inset: #eeeeee;
--bg-base: #ffffff;
--bg-card: #fafafa;
--bg-hover: #f0f0f0;
--border-subtle: #e0e0e0;
--border-default: #d0d0d0;
--text-primary: #1a1a1a;
--text-secondary: #555555;
--text-dim: #999999;
```

---

## Guide Content

The wiki page for the Customization tab (shown when "Customization Guide" is clicked):

```markdown
## How theming works

Open Robin uses a simple approach: pick one accent color and one brightness level, and the entire interface updates to match. Every button, border, badge, and background derives from these two choices.

## System theme vs workspace themes

The system theme is the baseline. It applies to the Robin system panel itself and to every workspace that hasn't been customized. Think of it as the default look.

Each workspace can optionally override the system theme with its own accent color. When a workspace inherits the system theme, changing the system color changes that workspace too. When a workspace has a custom theme, it keeps its own color regardless of system changes.

## The color picker

Choose from eight curated accent colors, or use the color wheel to pick any color you like. The system automatically generates all the subtle variations (hover states, active fills, borders) from your single choice.

## Editing CSS by hand

For advanced customization beyond the color picker, you can edit the CSS file directly:

`ai/views/settings/themes.css`

This gives you full control over every visual variable. After editing, come back to this panel and click Apply to save your changes. This ensures your edits are preserved in the system database and won't be lost if you switch themes later.

## What you can change

- **Accent color** — the primary highlight used for active states, links, and interactive elements
- **Theme preset** — Light, Medium, Dark, or OLED Black (controls all background and text values)
- **Per-workspace overrides** — give each workspace its own accent color while keeping the same brightness level

## What stays consistent

The Robin system panel always uses the system theme. It never inherits workspace colors. This keeps the "control room" visually stable regardless of which workspace you're in.
```

---

## CSS Styling

All new elements follow the existing Robin design language. New CSS classes:

### Color Picker Panel

```css
.robin-color-picker {
  background: var(--robin-card-bg, #161616);
  border: 1px solid var(--robin-border, #282828);
  border-radius: 10px;
  padding: 20px;
  margin: 16px 0;
}

.robin-color-picker-label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-dim, #666);
  margin-bottom: 12px;
}

.robin-color-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}

.robin-color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 150ms;
}

.robin-color-swatch:hover {
  transform: scale(1.15);
}

.robin-color-swatch.active {
  border-color: var(--text-primary, #e0e0e0);
  box-shadow: 0 0 0 2px var(--robin-card-bg, #161616), 0 0 0 4px var(--text-dim, #666);
}

.robin-color-current {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.robin-color-current-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--robin-border, #282828);
}

.robin-color-current-hex {
  font-size: 0.8125rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--text-primary, #e0e0e0);
}
```

### Inherit Toggle

Uses existing `robin-toggle` styling. Same 40x22px pill toggle.

### Apply Button (State 3)

```css
.robin-apply-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  background: rgba(79, 195, 247, 0.12);
  border: 1px solid rgba(79, 195, 247, 0.25);
  border-radius: 10px;
  color: var(--robin-primary, #4fc3f7);
  font-size: 0.8125rem;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms;
}

.robin-apply-btn:hover {
  background: rgba(79, 195, 247, 0.2);
}
```

### Disabled Color Picker (State 1)

```css
.robin-color-picker.disabled {
  opacity: 0.4;
  pointer-events: none;
}
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `kimi-ide-server/lib/db/migrations/003_workspace_themes.js` | Migration: system_theme + workspace_themes tables, seed data, new system_tab |
| (No new client files — extends existing RobinOverlay.tsx and robin.css) | |

### Modified Files

| File | Changes |
|------|---------|
| `kimi-ide-server/lib/robin/ws-handlers.js` | Add handlers for `robin:theme-*` messages |
| `kimi-ide-server/lib/robin/queries.js` | Add theme query functions |
| `kimi-ide-client/src/components/Robin/RobinOverlay.tsx` | Add `CustomizationDetail` component, handle customization tab rendering |
| `kimi-ide-client/src/components/Robin/robin.css` | Add color picker, swatch, apply button styles |

---

## Implementation Order

1. **Migration** — Create tables, seed workspaces and system theme, add tab + wiki page
2. **Queries** — `getSystemTheme`, `getWorkspaceThemes`, `getWorkspaceThemeDetail`, `updateSystemTheme`, `updateWorkspaceTheme`, `getWorkspaceThemeState`
3. **Handlers** — Wire up `robin:theme-*` message handlers with diff logic
4. **Component** — `CustomizationDetail` with three-state rendering, color picker, toggle/apply
5. **CSS** — Color picker, swatches, apply button styles
6. **Integration** — Propagation from SQLite to filesystem on save/inherit/apply

---

## Edge Cases

- **No filesystem CSS file exists:** Treat as State 1 (inheriting). System theme will be written on first interaction.
- **Workspace has no custom theme in SQLite (theme_css is null):** Treat as State 1. Flipping toggle OFF initializes custom theme as a copy of current system theme.
- **System theme changes while workspaces are inheriting:** All inheriting workspaces get their filesystem CSS overwritten immediately.
- **Color wheel picks a color very close to a preset:** Don't auto-snap. Show it as custom. User can click the swatch if they want the exact preset value.
- **Multiple workspaces sharing the same filesystem path:** Not possible — each workspace has its own `ai/views/` path. But if workspace switching isn't built yet, only the active workspace's path exists.
- **Hand-edited CSS has syntax errors:** Apply still absorbs it. The CSS is stored as-is. If it breaks rendering, the user can flip back to inherit or fix the file.

---

## Security Boundaries

- **System partition (read-only for AI):** `system_theme`, `workspace_themes`, and `system_tabs` entries for customization. AI agents cannot modify these tables. Only the Robin GUI can write to them.
- **Filesystem (AI can read):** `ai/views/settings/themes.css` is readable by AI but is a propagated copy, not source of truth. AI editing this file triggers State 3 (diverged) on next panel render.
- **No API exposure:** Theme data is only accessible via the Robin WebSocket protocol, not via any HTTP endpoint.
