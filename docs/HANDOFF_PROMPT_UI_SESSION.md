# Hand-off prompt (paste into a new session)

Copy everything below the line into a new chat to restore context.

---

## Project

**kimi-claude** — Kimi IDE: `kimi-ide-client/` (React + Vite + Zustand), `kimi-ide-server/` (WebSocket bridge). Active UI code is under **`kimi-ide-client/src/`** and **`ai/views/`** (workspace styles). After edits under `kimi-ide-client/src/`, run **`npm run build`** in `kimi-ide-client/`; the server serves **`dist/`**.

## Where we left off (shell & chat UI)

We aligned the app shell and chat to a **layered gray + neutral hairline** system, with **cyan** reserved for accents (theme borders on controls, active thread outline, send button, etc.).

### Tokens (see `kimi-ide-client/src/styles/variables.css`)

- **`--bg-solid`** — black `#000`
- **`--document-code-bg`** — `#161616` — document/code canvas, thread sidebar, new-thread button, header + tools backgrounds (when set), user bubbles, composer, context meter fill
- **`--panel-chrome-bg`** / **`--chat-surface-bg`** — `#1a1a1a` — chat column, code-viewer tab/header rail (`--file-tree-sidebar-bg` aliases this in explorer layout)
- **`--sidebar-surface-bg`** — same as document code bg — thread list + file-picker column
- **`--neutral-chrome-border`** — `rgba(255,255,255,0.12)` — structural dividers (tools↔threads↔chat, header bottom, composer top, user bubble border, etc.)
- **`--theme-border`** — cyan, opacity **0.38** (and glow **0.68**); **`App.tsx`** sets these from panel theme with the same opacities

### Files touched (conceptually)

- **`App.css`** — `.app-container` **no outer border**; **`.header`** / **`.tools-panel`** use **`--document-code-bg`**; **`.menu-btn`** matches **`.tool-btn`** (no border, **`--text-dim`**, hover primary + light fill)
- **`views.css`** — chat column, sidebar, **`.chat-footer`** (composer + context meter below input, meter **right-aligned**), **`.message-user-content`**, **`.chat-input-wrapper`**, **`.chat-item.active`** (primary border only, transparent fill), **`.new-chat-btn`**, neutral structural borders, **`.chat-messages`** scrollbar matches **`document.css`** code editor
- **`ChatArea.tsx`** — context meter in **`.chat-footer`** under **`ChatInput`** (not absolutely positioned)
- **`variables.css`** — tokens above
- **`code-viewer/.../layout.css`** — explorer chrome; **`--file-viewer-chrome-border`** uses **`--neutral-chrome-border`**; empty explorer uses **`--bg-solid`**

### Canonical doc in repo

**`docs/UI_THEME_SURFACE.md`** — full token map, file locations, gotchas, and notes on bundled vs injected CSS.

## Gotchas / issues to remember

1. **Two CSS delivery paths**: `views.css` is **bundled** via `main.tsx`. **`ai/views/code-viewer/settings/styles/layout.css`** is **workspace-injected** — changes need **reload/reconnect**, not only mental model; **`npm run build`** does not bundle that file into the same pipeline as `views.css`.

2. **`STYLE_GUIDE.md`** was swept **2026-04-04** to document **borderless** tools + menu and point to **`UI_THEME_SURFACE.md`** for surfaces/tokens.

3. **Floating chat** hides **`.context-usage`** with CSS — meter does not show in floating panel.

4. **Empty vs open file** in code viewer: empty main uses **black** (`--bg-solid`); open viewer uses **`#161616`** — intentional.

5. **No “must stay black” rule** for view CSS — view stylesheets exist to override; earlier confusion was from stale CSS lines, not architecture.

## Suggested next steps (if continuing)

- Any new “sidebar-like” or “thread-like” surface should reuse **`--sidebar-surface-bg`** / **`--neutral-chrome-border`** unless product asks otherwise.

---

_End of hand-off block._
