# UI theme: surfaces, borders, and delivery paths

This document describes the **current** shell and chat styling (as of 2026-04). It supersedes informal assumptions: there is no rule that “file viewer must be black”; view-level CSS and global tokens are the source of truth.

## CSS variable map (`kimi-ide-client/src/styles/variables.css`)

| Token | Role |
|-------|------|
| `--bg-solid` | Pure black `#000000` — body, empty code-explorer main when no file, stop button base |
| `--document-surface-bg` | `#0d0d0d` — generic document surface (e.g. markdown reading shell) |
| `--document-code-bg` | `#161616` — code canvas, thread sidebar, tools/header backgrounds when set to match |
| `--sidebar-surface-bg` | Alias of `--document-code-bg` — thread list, file-picker column, new-thread button fill |
| `--panel-chrome-bg` | `#1a1a1a` — code-viewer tab/header rail, chat message column, `--file-tree-sidebar-bg` in explorer |
| `--chat-surface-bg` | Alias of `--panel-chrome-bg` — `.chat-area` |
| `--neutral-chrome-border` | `rgba(255, 255, 255, 0.12)` — structural hairlines (not workspace accent) |
| `--theme-border` / `--theme-border-glow` | Cyan accent borders (opacity **0.38** / **0.68**); also set in `App.tsx` from panel theme RGB |

Accent cyan is for **interactive** emphasis (send button, active thread border, chips that should pop). Neutral white-alpha is for **splits** and **input/bubble chrome** when matching the document gray look.

## Where styles live

| Area | Primary files |
|------|----------------|
| Global tokens | `kimi-ide-client/src/styles/variables.css` |
| App shell (header, tools, content grid) | `kimi-ide-client/src/components/App.css` |
| Chat, thread list, composer, context meter, messages | `ai/views/settings/styles/views.css` (imported from `main.tsx`) |
| Code viewer / file explorer chrome | `ai/views/code-viewer/settings/styles/layout.css` (injected per workspace) |
| Code/markdown reading surface | `kimi-ide-client/src/styles/document.css` |

## Behavioral notes

- **Tools rail & header menu**: `.tool-btn` and `.menu-btn` use **`color: var(--text-dim)`**, **`border: none`**, transparent background; hover uses primary color + light rgba fill; active tool shows a **left accent bar** (`App.css`). See **`docs/STYLE_GUIDE.md`** for the interaction pattern summary.
- **Thread list active row**: `.chat-item.active` uses **`border-color: var(--theme-primary)`**, **`background: transparent`** (no primary tint fill).
- **User bubble & composer & context chip**: `#161616` fill via `--document-code-bg`, border via `--neutral-chrome-border`; send button stays primary-colored.
- **Chat footer**: `.chat-footer` wraps composer + context meter; top border is neutral; context meter is **below** input, **right-aligned** (`.context-usage-below-input`).
- **Floating chat**: `.floating-chat-body .context-usage { display: none }` — context meter hidden in floating panel; layout still works.
- **Scrollbars**: `.chat-messages` uses the same thumb treatment as `.file-viewer-content .code-editor` in `document.css` (10px, neutral gray thumb), not the global `index.css` 8px theme-border thumb.
- **Outer app frame**: `.app-container` has **no** outer border (removed).
- **Code explorer empty state** (no file open): `.file-explorer-main:empty` / `.file-explorer-empty` use **`--bg-solid`**; open file viewer uses **`--document-code-bg`** for the viewer shell.

## Delivery gotchas

1. **Bundled vs injected CSS**  
   - Anything imported in `main.tsx` (e.g. `views.css`) ships with the Vite bundle — **`npm run build`** updates `dist/`.  
   - `ai/views/code-viewer/settings/styles/layout.css` is loaded via workspace style injection — **reload/reconnect** the app so the client refetches it; editing alone does not use Vite HMR for that path.

2. **Build after client edits**  
   Per project rules: after changes under `kimi-ide-client/src/`, run **`npm run build`** in `kimi-ide-client/` when validating against the server-served `dist/`.

3. **Theme borders in JS**  
   `App.tsx` sets `--theme-border` and `--theme-border-glow` from the active panel’s theme; keep opacities aligned with `variables.css` if you change the global defaults.

4. **Documentation split**  
   **`docs/STYLE_GUIDE.md`** documents toolbar/menu interaction chrome (borderless tools, left-bar active state). **`UI_THEME_SURFACE.md`** remains the canonical token map and file locations; use both when changing shell vs. writing new panels.

## Related

- `docs/FILE_EXPLORER_SPEC.md` — file explorer behavior (separate from shell theming).
- `docs/TYPESCRIPT_REACT_SPEC.md` — component constraints (no timers in components, etc.).
