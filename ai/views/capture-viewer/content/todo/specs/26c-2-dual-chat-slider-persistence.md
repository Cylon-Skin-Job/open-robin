# SPEC-26c-2 — Left-Column Collapse + Resize + Per-View Persistence + Right-Side Column Teardown

**Parent:** SPEC-26 (dual-chat paradigm, post-pivot to asymmetric layout)
**Position:** Phase 3.5 of 5. Narrows 26c's symmetric 5-column layout to an asymmetric 3-column layout and adds collapse/resize affordances with per-view JSON persistence. The right-side view chat becomes a floating popup in SPEC-26d, not here.
**Depends on:**
- 26a (`72d390e`), 26b (`e0913c2`), 26c (`536727e`) all merged
- `ai/views/settings/styles/views.css` (global workspace CSS) — minor touch
**Model recommendation:** **Opus 4.6**. Substantial panelStore refactor residue, CSS grid restructure, new resize handle component, new server module, new wire messages. Multiple moving pieces tightly coupled.
**Estimated blast radius:** **Medium.** Removes two components from the App.tsx render tree (right-side Sidebar + ChatArea), adds one new component (ResizeHandle), adds one new server module (`lib/view-state/`), adds a new store slice, adds new wire messages (`state:get` / `state:set`), refactors grid-template-columns to CSS variables. No thread-protocol changes. The right-scope infrastructure from 26c stays intact — SPEC-26d will re-expose view chats as a floating popup.

---

## Your mission — the pivot explainer

**Design reality check:** SPEC-26c delivered a symmetric 5-column layout (`[project sidebar][project chat][content][view chat][view sidebar]`). After live validation, the user observed that two empty thread rails + two chat columns created visual confusion and wasted screen real estate. The right-side view chat needs to become a floating popup (SPEC-26d), not a permanent column.

This spec does two things:

1. **Dismantles the right-side columns** from 26c's layout — `<ChatArea scope="view" />` and `<Sidebar scope="view" />` are removed from the `PanelContent` render tree. Grid collapses from 5 columns to 3.
2. **Adds collapse + resize + persistence for the remaining left-side columns** — left sidebar (project thread list), left chat (project chat), content area. Two collapsible panes (`leftSidebar`, `leftChat`), two resize handles (between sidebar/chat and between chat/content), content area always `1fr`.

**Not scrapped — staying for 26d:**
- `panelStore` scope split (`threads: { project, view }`, `currentThreadIds: { project, view }`, `currentScope`) — 26d's floating popup will render the view scope
- `Sidebar.tsx` / `ChatArea.tsx` scope props — 26d will re-instantiate `<ChatArea scope="view" />` and `<Sidebar scope="view" />` inside a `FloatingChat` container
- Server routing from 26b (`scope` field on wire messages, dual ThreadManagers) — unchanged, still used
- `thread-handlers.ts` scope-aware response routing — unchanged
- `FloatingChat.tsx` — already exists, currently used only by wiki-viewer; 26d will generalize and enhance it

**Three work streams in this spec:**

**Stream 1 — Right-side layout teardown.**
- Remove `<ChatArea scope="view" />` and `<Sidebar scope="view" />` from `PanelContent` in `App.tsx`
- Remove the right-side resize handles (in 26c-2 they never existed as concrete components; this is just "don't render them")
- Update CSS grid from 5 content columns to 3: `[leftSidebar][leftChat][content]`

**Stream 2 — Left-side collapse + resize affordances.**
- Two collapse toggles: one on the project Sidebar header, one on the project ChatArea (position TBD — executor chooses)
- Clicking collapse → pane shrinks to a 40px rail with an expand icon
- Two drag handles at the grid boundaries: `leftSidebar | leftChat` and `leftChat | content`
- Dragging updates width state smoothly (mousemove → local state); commits on mouseup (mouseup → wire `state:set`)
- Clamps: min 120px, max 600px per pane
- Content area always `1fr` — absorbs any width change

**Stream 3 — Per-view persistence via local JSON.**
Following the project's "templated but composable" config pattern.
- Each view has its own UI state file at `ai/views/<view>/state/<username>.json`
- Holds the two collapsed booleans (`leftSidebar`, `leftChat`) and the two widths (`leftSidebar`, `leftChat`)
- Wire messages: `state:get { view }` → `state:result { view, state }`, `state:set { view, state }`
- Server resolves precedence: per-user file → view's `layout.json` defaults → hardcoded fallbacks
- Client loads state on `setCurrentPanel`, commits changes on toggle or mouseup

---

**After this phase:**
- Every chat-enabled view renders three content columns: `[Sidebar(project)][ChatArea(project)][ContentArea]`
- Two resize handles (6px each) sit between the three columns
- Both the left sidebar and left chat can be collapsed to 40px rails
- Widths persist per view per user at `ai/views/<view>/state/<username>.json`
- Content area gets much more horizontal space than in 26c's 5-column model
- The right-scope infrastructure (viewThreadManager, view storage paths, scope field on wire messages) is untouched — SPEC-26d will re-expose it as a floating popup
- `FloatingChat.tsx` continues to work for wiki-viewer as it does today (unchanged in this spec)

**You are not touching:**
- Any server code except the new `lib/view-state/` module and the `state:*` handlers in `client-message-router.js`
- Wire protocol for `thread:*` messages — unchanged
- SQLite schema — unchanged
- 26c's `panelStore` scope split — unchanged (view-scope fields remain populated, they just aren't rendered as columns)
- 26c's `thread-handlers.ts` scope routing — unchanged
- `FloatingChat.tsx`, `WikiExplorer.tsx` — unchanged (wiki's existing floating chat pattern is preserved as-is, and SPEC-26d will generalize)
- Dual-wire support — 26d
- Chat header component — 26d
- Harness wizard per side — 26d
- Traffic lights / FAB / dock / thread picker modal — 26d
- CSS architecture migration — separate future spec
- Agents-viewer area (saved feedback: don't audit)

---

## Design decisions locked in (from the earlier conversation)

These were already argued through in the previous draft's D1-D6 and in the follow-up pivot conversation. Keeping as-is:

**D1 — File location.** `ai/views/<view>/state/<username>.json`. New `state/` subdirectory per view. Matches "each view is self-contained" pattern.

**D2 — Transport.** New `state:*` wire messages (parallel to `thread:*`), not HTTP.

**D3 — Granularity.** Both `collapsed` (2 booleans) and `widths` (2 numbers) in one state slice. Drop the right-side `rightChat` / `rightSidebar` fields from the original 4-pane design.

**D4 — Default resolution order.**
1. Per-user file (`ai/views/<view>/state/<username>.json`)
2. View's `layout.json` defaults (`threadListVisible`, `threadListWidth`, `chatWidth`)
3. Hardcoded fallback: `leftSidebar` visible at 220px, `leftChat` visible at 320px

**D5 — Resize commit timing + handle positioning.**
- Commit on mouseup (not every mousemove)
- In-grid handles (6px columns between content columns), not absolute overlays
- Split store actions: `setPaneWidth` (local only, called on mousemove) and `commitPaneWidths` (persist to server, called on mouseup)

**D6 — Min/max widths.**
- Min 120px per pane (below this, content becomes unusable)
- Max 600px per pane (above this, the content area gets squeezed too hard)
- Collapsed rail is 40px (not a persisted width value — it's a runtime-only presentation)
- Collapsed pane stores the pre-collapse width; expanding restores it

---

## Context before you touch code

Read these in order:

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules.
2. **`ai/views/capture-viewer/content/todo/specs/26a-dual-chat-data-model.md`** — understand the data model that the scope infrastructure rests on.
3. **`ai/views/capture-viewer/content/todo/specs/26b-dual-chat-routing-layer.md`** — understand the server routing.
4. **`ai/views/capture-viewer/content/todo/specs/26c-dual-chat-client-layout.md`** — understand what 26c delivered (and what you're partially undoing).
5. **`open-robin-client/src/components/App.tsx`** (focus on `PanelContent` L20-60 post-26c) — the file you partially revert.
6. **`open-robin-client/src/components/App.css`** (focus on `.rv-layout-dual-chat` grid rule around L200-210) — refactor from hardcoded 5-col to CSS-variable 3-col.
7. **`open-robin-client/src/state/panelStore.ts`** — read the full file but only add a new `viewStates` slice; do NOT touch the existing scope split (`threads`, `currentThreadIds`, `currentScope`, `projectChat`, `panels[panelId]`).
8. **`open-robin-client/src/components/Sidebar.tsx`** — add collapse button + collapsed rail rendering. Scope prop remains.
9. **`open-robin-client/src/components/ChatArea.tsx`** — add collapse button + collapsed rail rendering. Scope prop remains.
10. **`open-robin-server/lib/ws/client-message-router.js`** — add `state:*` handler cases.

### Line-number drift verification

```bash
cd /Users/rccurtrightjr./projects/open-robin
wc -l \
  open-robin-client/src/components/App.tsx \
  open-robin-client/src/components/App.css \
  open-robin-client/src/state/panelStore.ts \
  open-robin-client/src/components/Sidebar.tsx \
  open-robin-client/src/components/ChatArea.tsx \
  open-robin-server/lib/ws/client-message-router.js
```

### Pre-prod wipe

```bash
pkill -9 -f "node.*server.js" 2>/dev/null; sleep 1
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "PRAGMA foreign_keys=ON; DELETE FROM threads;"
find /Users/rccurtrightjr./projects/open-robin/ai/views/chat/threads -type f -name '*.md' -delete 2>/dev/null
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' -delete 2>/dev/null
rm -rf /Users/rccurtrightjr./projects/open-robin/ai/views/*/state/ 2>/dev/null
```

Note the `PRAGMA foreign_keys=ON;` prefix and the new `state/` directory removal — any leftover state files from earlier drafts need to go so the defaults fallback is exercised.

---

## Changes — file by file

### 1. `open-robin-client/src/components/App.tsx` — Stream 1 (right-side teardown)

**1a. Remove the right-side `<ChatArea>` and `<Sidebar>` from `PanelContent`.**

Current (post-26c):
```tsx
const PanelContent = memo(function PanelContent({ panel, hasChat }: { panel: string; hasChat: boolean }) {
  if (!hasChat) {
    return <ContentArea panel={panel} />;
  }
  return (
    <>
      <Sidebar panel={panel} scope="project" />
      <ChatArea panel={panel} scope="project" />
      <ContentArea panel={panel} />
      <ChatArea panel={panel} scope="view" />
      <Sidebar panel={panel} scope="view" />
    </>
  );
});
```

New:
```tsx
const PanelContent = memo(function PanelContent({ panel, hasChat }: { panel: string; hasChat: boolean }) {
  if (!hasChat) {
    return <ContentArea panel={panel} />;
  }
  // SPEC-26c-2: right-side view chat is no longer a column. SPEC-26d
  // will re-expose it as a floating popup.
  return (
    <>
      <Sidebar panel={panel} scope="project" />
      <ResizeHandle panel={panel} pane="leftSidebar" />
      <ChatArea panel={panel} scope="project" />
      <ResizeHandle panel={panel} pane="leftChat" />
      <ContentArea panel={panel} />
    </>
  );
});
```

Three content children (Sidebar, ChatArea, ContentArea) + two ResizeHandles interleaved. Grid has 5 tracks total (3 content + 2 handles).

**1b. Inline grid style driven by `viewStates`.**

Just above the PanelContent render (or wherever the `rv-panel` div is built in App.tsx), add scope-aware grid inline styles:

```tsx
const viewState = usePanelStore((s) => s.viewStates[panel]);
const widths = viewState?.widths ?? DEFAULT_WIDTHS;
const collapsed = viewState?.collapsed ?? DEFAULT_COLLAPSED;

const gridStyle: CSSProperties = {
  '--left-sidebar-w': `${collapsed.leftSidebar ? 40 : widths.leftSidebar}px`,
  '--left-chat-w':    `${collapsed.leftChat    ? 40 : widths.leftChat   }px`,
} as CSSProperties;

return (
  <div className="rv-panel rv-layout-dual-chat active" style={gridStyle}>
    <PanelContent panel={panel} hasChat={hasChat} />
  </div>
);
```

(The exact structure depends on where `rv-panel` is built in App.tsx today — read the current file and match its pattern.)

**1c. Defaults constants near the top of the file.**

```ts
const DEFAULT_WIDTHS = { leftSidebar: 220, leftChat: 320 };
const DEFAULT_COLLAPSED = { leftSidebar: false, leftChat: false };
```

---

### 2. `open-robin-client/src/components/App.css` — 3-column grid refactor

**2a. Rewrite `.rv-layout-dual-chat` to use CSS variables.**

Current (post-26c):
```css
.rv-layout-dual-chat {
  /* [project sidebar] [project chat] [content] [view chat] [view sidebar] */
  grid-template-columns:
    var(--sidebar-width)
    var(--chat-width)
    1fr
    var(--chat-width)
    var(--sidebar-width);
}
```

New:
```css
/* SPEC-26c-2: 3-column asymmetric layout.
 * [project sidebar] [handle] [project chat] [handle] [content]
 * Widths come from per-view state (viewStates), written to inline style
 * as CSS variables on the .rv-panel container.
 */
.rv-layout-dual-chat {
  grid-template-columns:
    var(--left-sidebar-w, 220px)
    6px   /* resize handle 1 */
    var(--left-chat-w,    320px)
    6px   /* resize handle 2 */
    1fr;
}
```

**2b. Add resize handle styling.**

```css
/* SPEC-26c-2: in-grid drag handle. 6px thin strip, col-resize cursor,
   subtle hover feedback so users can find it.
   NOTE: do NOT set grid-row on this element. An explicit grid-row with
   auto grid-column makes CSS Grid's auto-placement treat handles as
   "partially placed" and pack them into the first tracks, pushing
   the actual content into the wrong columns. This bug was hit in the
   first iteration of 26c-2 — fixed by deleting the grid-row line.
   Single-row grid (grid-template-rows: minmax(0, 1fr)) already puts
   everything in row 1. */
.rv-resize-handle {
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s ease;
  min-width: 0;
}

.rv-resize-handle:hover,
.rv-resize-handle:active {
  background: rgba(var(--theme-primary-rgb, 136, 136, 136), 0.35);
}
```

**2c. Add collapsed rail variants.**

```css
/* SPEC-26c-2: collapsed rail — sidebar/chat collapses to a 40px strip
   with only an expand icon. Width comes from the inline CSS variable
   on .rv-panel (set to 40px when collapsed). Hide child content except
   the expand affordance. */
.sidebar--collapsed,
.chat-area--collapsed {
  overflow: hidden;
}

.sidebar--collapsed > *:not(.rv-collapse-rail-btn),
.chat-area--collapsed > *:not(.rv-collapse-rail-btn) {
  display: none;
}

.rv-collapse-rail-btn {
  width: 40px;
  height: 40px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-dim, #888);
}

.rv-collapse-rail-btn:hover {
  color: var(--theme-primary, #888);
}

.rv-collapse-btn {
  /* inline collapse toggle — position TBD per component */
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-dim, #888);
}

.rv-collapse-btn:hover {
  color: var(--theme-primary, #888);
}
```

---

### 3. `open-robin-client/src/components/ResizeHandle.tsx` — new component

```tsx
import { useRef } from 'react';
import { usePanelStore } from '../state/panelStore';
import type { Pane } from '../types';

interface ResizeHandleProps {
  panel: string;
  pane: Pane;  // 'leftSidebar' | 'leftChat'
}

const MIN_WIDTH = 120;
const MAX_WIDTH = 600;

export function ResizeHandle({ panel, pane }: ResizeHandleProps) {
  const setPaneWidth = usePanelStore((s) => s.setPaneWidth);
  const commitPaneWidths = usePanelStore((s) => s.commitPaneWidths);
  const getPaneWidth = usePanelStore((s) => {
    const vs = s.viewStates[panel];
    return vs?.widths?.[pane] ?? 220;  // fallback
  });

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startWidth: getPaneWidth,
    };

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const raw = dragRef.current.startWidth + delta;
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
      setPaneWidth(panel, pane, clamped);
    };

    const handleUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      commitPaneWidths(panel);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  return (
    <div
      className="rv-resize-handle"
      data-pane={pane}
      onMouseDown={handleMouseDown}
    />
  );
}
```

Key points:
- Captures `startX` and `startWidth` on mousedown
- Mousemove updates store via `setPaneWidth` (local only — no server write)
- Mouseup commits via `commitPaneWidths` (one server write per drag)
- Clamps between 120 and 600
- Disables text selection during drag

---

### 4. `open-robin-client/src/state/panelStore.ts` — new viewStates slice

**4a. Add types and defaults.**

Add to imports:
```ts
import type { ViewUIState, Pane } from '../types';
```

Add constants near the top:
```ts
const DEFAULT_VIEW_UI_STATE: ViewUIState = {
  collapsed: { leftSidebar: false, leftChat: false },
  widths:    { leftSidebar: 220,   leftChat: 320   },
};

function clampWidth(n: number): number {
  return Math.max(120, Math.min(600, n));
}
```

**4b. Extend the store interface.**

```ts
interface AppState {
  // ... existing ...

  // SPEC-26c-2: per-view UI state (collapse/expand + left-column widths)
  viewStates: Record<string, ViewUIState>;

  loadViewState: (view: string) => void;                         // sends state:get; updates on reply
  setViewState: (view: string, state: ViewUIState) => void;      // used by the WS handler
  toggleCollapsed: (view: string, pane: Pane) => void;           // local + persists
  setPaneWidth: (view: string, pane: Pane, width: number) => void; // local only, drag-time
  commitPaneWidths: (view: string) => void;                      // persists current widths on mouseup
}
```

**4c. Implementation.**

Add to the initial state block:
```ts
viewStates: {},
```

Add the actions:
```ts
loadViewState: (view) => {
  const ws = get().ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'state:get', view }));
},

setViewState: (view, state) => set((s) => ({
  viewStates: { ...s.viewStates, [view]: state },
})),

toggleCollapsed: (view, pane) => {
  set((s) => {
    const current = s.viewStates[view] ?? DEFAULT_VIEW_UI_STATE;
    const nextCollapsed = {
      ...current.collapsed,
      [pane]: !current.collapsed[pane],
    };
    const nextState: ViewUIState = { ...current, collapsed: nextCollapsed };

    // Persist immediately — collapse is a discrete event, not a drag.
    const ws = get().ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'state:set',
        view,
        state: { collapsed: nextCollapsed },
      }));
    }

    return {
      viewStates: { ...s.viewStates, [view]: nextState },
    };
  });
},

setPaneWidth: (view, pane, width) => set((s) => {
  const current = s.viewStates[view] ?? DEFAULT_VIEW_UI_STATE;
  const clamped = clampWidth(width);
  const nextWidths = { ...current.widths, [pane]: clamped };
  return {
    viewStates: {
      ...s.viewStates,
      [view]: { ...current, widths: nextWidths },
    },
  };
}),

commitPaneWidths: (view) => {
  const state = get().viewStates[view];
  if (!state) return;
  const ws = get().ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'state:set',
    view,
    state: { widths: state.widths },
  }));
},
```

**4d. Hook `loadViewState` into `setCurrentPanel`.**

Current `setCurrentPanel` in panelStore (post-26c):
```ts
setCurrentPanel: (id) => {
  // ... existing panel init logic ...
  const ws = state.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_panel', panel: id }));
  }
},
```

Add after the `set_panel` send:
```ts
// SPEC-26c-2: load view state if not yet cached
if (!get().viewStates[id]) {
  get().loadViewState(id);
}
```

---

### 5. `open-robin-client/src/types/index.ts` — add types

```ts
// SPEC-26c-2: per-view UI state (collapse + pane widths)
export type Pane = 'leftSidebar' | 'leftChat';

export interface ViewUIState {
  collapsed: {
    leftSidebar: boolean;
    leftChat: boolean;
  };
  widths: {
    leftSidebar: number;
    leftChat: number;
  };
}

// Add to WebSocketMessage union
export interface StateResultMessage {
  type: 'state:result';
  view: string;
  state: ViewUIState;
}
// Also add to the union type if one exists
```

---

### 6. `open-robin-client/src/components/Sidebar.tsx` — collapse affordance

**6a. Accept a `collapsed` prop from parent.**

```tsx
interface SidebarProps {
  panel: string;
  scope: Scope;
  collapsed?: boolean;
}
```

**6b. Render collapsed rail variant when `collapsed === true`.**

```tsx
if (collapsed) {
  return (
    <div className={`sidebar sidebar--${scope} sidebar--collapsed`}>
      <button
        className="rv-collapse-rail-btn"
        onClick={() => toggleCollapsed(panel, scope === 'project' ? 'leftSidebar' : 'leftSidebar')}
        title="Expand sidebar"
      >
        <span className="material-symbols-outlined">chevron_right</span>
      </button>
    </div>
  );
}
```

(scope === 'view' shouldn't happen in 26c-2 because the view sidebar is no longer rendered, but the prop remains for 26d future use.)

**6c. Add a collapse button to the expanded sidebar header.**

In the existing header JSX, add a small button. Exact placement is the executor's judgment call — probably to the right of the existing title:

```tsx
<div className="sidebar-header">
  <span className="sidebar-title">{scope === 'project' ? 'Project' : (config?.name || panel)}</span>
  <button
    className="rv-collapse-btn"
    onClick={() => toggleCollapsed(panel, 'leftSidebar')}
    title="Collapse sidebar"
  >
    <span className="material-symbols-outlined">chevron_left</span>
  </button>
</div>
```

**6d. Wire up the store hook at the top of the component.**

```tsx
const toggleCollapsed = usePanelStore((s) => s.toggleCollapsed);
```

---

### 7. `open-robin-client/src/components/ChatArea.tsx` — collapse affordance

**7a. Accept a `collapsed` prop.**

```tsx
interface ChatAreaProps {
  panel: string;
  scope: Scope;
  collapsed?: boolean;
}
```

**7b. Render collapsed rail variant.**

```tsx
if (collapsed) {
  return (
    <div className={`chat-area chat-area--${scope} chat-area--collapsed`}>
      <button
        className="rv-collapse-rail-btn"
        onClick={() => toggleCollapsed(panel, 'leftChat')}
        title="Expand chat"
      >
        <span className="material-symbols-outlined">chevron_right</span>
      </button>
    </div>
  );
}
```

**7c. Add a collapse button to the expanded chat area.**

Position is executor's judgment — probably top-right of the chat area. The chat area has an existing "inactive" state from 26c; the collapse button is a separate affordance.

```tsx
<button
  className="rv-collapse-btn rv-collapse-btn--chat"
  onClick={() => toggleCollapsed(panel, 'leftChat')}
  title="Collapse chat"
  style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}
>
  <span className="material-symbols-outlined">chevron_left</span>
</button>
```

**7d. Ensure `.chat-area` has `position: relative`** so the absolute-positioned collapse button anchors correctly. Add to the CSS in step 2 if not already present.

---

### 8. `open-robin-server/lib/view-state/index.js` — new server module

**8a. Create the directory and the main module.**

```js
/**
 * View-state — per-user per-view UI preferences.
 *
 * Persists collapse/expand state and pane widths for each view to
 * ai/views/<view>/state/<username>.json. Reads fall back through a
 * precedence chain: per-user file → view's layout.json → hardcoded
 * defaults.
 *
 * Part of SPEC-26c-2. Foundation for any future per-view UI state
 * (slider positions, font sizes, etc.).
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { getDefaults } = require('./defaults');

function getStatePath(projectRoot, viewId, username) {
  return path.join(projectRoot, 'ai', 'views', viewId, 'state', `${username}.json`);
}

async function readViewState(projectRoot, viewId, username) {
  const filePath = getStatePath(projectRoot, viewId, username);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeViewState(projectRoot, viewId, username, state) {
  const filePath = getStatePath(projectRoot, viewId, username);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2));
  await fs.rename(tmpPath, filePath);
}

/**
 * Merge a partial patch into the existing state file. Writes atomically.
 */
async function writeViewStatePatch(projectRoot, viewId, username, patch) {
  const current = (await readViewState(projectRoot, viewId, username)) || {};
  const merged = {
    collapsed: { ...(current.collapsed || {}), ...(patch.collapsed || {}) },
    widths:    { ...(current.widths    || {}), ...(patch.widths    || {}) },
  };
  await writeViewState(projectRoot, viewId, username, merged);
  return merged;
}

/**
 * Resolve the effective view state via the precedence chain:
 *   1. per-user file
 *   2. view's layout.json defaults
 *   3. hardcoded defaults
 */
async function resolveViewState(projectRoot, viewId, username) {
  const userState = await readViewState(projectRoot, viewId, username);
  const defaults = getDefaults(projectRoot, viewId);

  return {
    collapsed: {
      leftSidebar: userState?.collapsed?.leftSidebar ?? defaults.collapsed.leftSidebar,
      leftChat:    userState?.collapsed?.leftChat    ?? defaults.collapsed.leftChat,
    },
    widths: {
      leftSidebar: clampWidth(userState?.widths?.leftSidebar ?? defaults.widths.leftSidebar),
      leftChat:    clampWidth(userState?.widths?.leftChat    ?? defaults.widths.leftChat),
    },
  };
}

function clampWidth(n) {
  return Math.max(120, Math.min(600, n));
}

module.exports = {
  readViewState,
  writeViewState,
  writeViewStatePatch,
  resolveViewState,
};
```

**8b. Create `defaults.js`.**

```js
/**
 * Defaults for per-view UI state.
 *
 * Precedence: per-user file → view's layout.json → these hardcoded values.
 *
 * Maps existing layout.json fields (threadListVisible, threadListWidth,
 * chatWidth) to the ViewUIState shape. These fields were originally from
 * the pre-26c layout system and were repurposed in 26c-2 as view defaults.
 */

const path = require('path');
const fsSync = require('fs');

const HARDCODED_DEFAULTS = {
  collapsed: { leftSidebar: false, leftChat: false },
  widths:    { leftSidebar: 220,   leftChat: 320   },
};

function getDefaults(projectRoot, viewId) {
  const layoutPath = path.join(projectRoot, 'ai', 'views', viewId, 'settings', 'layout.json');
  let layout = null;
  try {
    layout = JSON.parse(fsSync.readFileSync(layoutPath, 'utf8'));
  } catch {
    // No layout.json — use hardcoded
    return HARDCODED_DEFAULTS;
  }

  return {
    collapsed: {
      // threadListVisible === false means the sidebar starts collapsed
      leftSidebar: layout.threadListVisible === false,
      leftChat:    false,  // no existing field; always start expanded
    },
    widths: {
      leftSidebar: typeof layout.threadListWidth === 'number' ? layout.threadListWidth : HARDCODED_DEFAULTS.widths.leftSidebar,
      leftChat:    typeof layout.chatWidth       === 'number' ? layout.chatWidth       : HARDCODED_DEFAULTS.widths.leftChat,
    },
  };
}

module.exports = {
  getDefaults,
  HARDCODED_DEFAULTS,
};
```

---

### 9. `open-robin-server/lib/ws/client-message-router.js` — state:* handlers

**9a. Add a require at the top.**

```js
const { resolveViewState, writeViewStatePatch } = require('../view-state');
const { getUsername } = require('../thread/ChatFile');
```

**9b. Add the handler cases.**

Place these near the other `thread:*` handlers (probably around the same area where thread:list etc. live in `client-message-router.js`):

```js
// ---- View UI state (SPEC-26c-2) ----

if (clientMsg.type === 'state:get') {
  try {
    const projectRoot = getDefaultProjectRoot();
    const username = getUsername();
    const state = await resolveViewState(projectRoot, clientMsg.view, username);
    ws.send(JSON.stringify({
      type: 'state:result',
      view: clientMsg.view,
      state,
    }));
  } catch (err) {
    console.error('[state:get] failed:', err);
    ws.send(JSON.stringify({ type: 'state:error', message: err.message }));
  }
  return;
}

if (clientMsg.type === 'state:set') {
  try {
    const projectRoot = getDefaultProjectRoot();
    const username = getUsername();
    const merged = await writeViewStatePatch(projectRoot, clientMsg.view, username, clientMsg.state);
    // Echo the merged state back so the client can reconcile
    ws.send(JSON.stringify({
      type: 'state:result',
      view: clientMsg.view,
      state: merged,
    }));
  } catch (err) {
    console.error('[state:set] failed:', err);
    ws.send(JSON.stringify({ type: 'state:error', message: err.message }));
  }
  return;
}
```

`getUsername()` is already used elsewhere in the server for chat file paths; reuse it.

---

### 10. `open-robin-client/src/lib/ws-client.ts` — handle `state:result` / `state:error`

Find the main WS message handler (probably a `switch (msg.type)` or chain of `if (msg.type === ...)`) and add:

```ts
if (msg.type === 'state:result') {
  store.setViewState(msg.view, msg.state);
  return true;
}
if (msg.type === 'state:error') {
  console.error('[state] error:', msg.message);
  return true;
}
```

---

### 11. Pre-prod wipe + rebuild

```bash
cd /Users/rccurtrightjr./projects/open-robin
pkill -9 -f "node.*server.js" 2>/dev/null; sleep 1
sqlite3 ai/system/robin.db "PRAGMA foreign_keys=ON; DELETE FROM threads;"
find ai/views/chat/threads -type f -name '*.md' -delete 2>/dev/null
find ai/views/*/chat/threads -type f -name '*.md' -delete 2>/dev/null
rm -rf ai/views/*/state/ 2>/dev/null
cd open-robin-client && npm run build
cd ../open-robin-server && node server.js > /tmp/26c2-boot.log 2>&1 &
sleep 4
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/
```

---

## Test plan

### Static checks

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-server
node -e "require('./lib/view-state')"
node -e "require('./lib/view-state/defaults')"

cd ../open-robin-client
npx tsc --noEmit
npm run build
```

All must pass.

### Live validation — walk through these in the browser

**3-column layout verification:**
1. Hard-refresh. The panel should show exactly three columns: project sidebar, project chat, content. NOT the 5-column layout 26c shipped.
2. No right-side sidebar or chat area visible.
3. FloatingChat on wiki-viewer still works (unchanged from 26c).

**Collapse path:**
4. Click the collapse button in the project sidebar header. Sidebar shrinks to a 40px rail with a chevron_right expand icon.
5. Content area expands to fill the freed space.
6. Refresh the browser. Collapsed state persists.
7. Click the rail expand icon. Sidebar returns to its previous width.
8. Same flow for the project chat column.

**Resize path:**
9. Hover the boundary between the sidebar and the chat. Cursor → col-resize.
10. Drag. The sidebar widens/narrows smoothly. Content area absorbs the change.
11. Release. State commits to file (check `/tmp/26c2-boot.log` for `[state:set]` lines if logging is enabled).
12. Refresh. Dragged width restored.
13. Drag past 120px (min). Clamps.
14. Drag past 600px (max). Clamps.
15. Drag the boundary between the chat and the content area. Same behavior for `leftChat`.

**Persistence file audit:**
16. ```bash
    cat /Users/rccurtrightjr./projects/open-robin/ai/views/code-viewer/state/rccurtrightjr..json
    ```
    Expected: JSON with `collapsed` (2 booleans) and `widths` (2 numbers), NO rightChat/rightSidebar fields.

17. Manually edit the file (e.g. change `leftSidebar` width to 250). Refresh. UI picks it up.

18. Delete the state file. Refresh. Defaults from `layout.json` (or hardcoded fallback) apply.

**Multi-view independence:**
19. Set different widths on 2-3 different views. Each view keeps its own state.

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| 5 columns instead of 3 | 1a revert incomplete; right-side Sidebar/ChatArea still rendered | Re-check PanelContent |
| Grid children in wrong tracks | `.rv-resize-handle` has `grid-row: 1` set (the 26c-2 v1 bug) | DO NOT set grid-row on the handle. Delete that line if present. |
| Drag jumps on mousedown | Not capturing `startX` correctly; using `clientX` every time without subtracting | Store `startX` on mousedown, subtract from later `clientX` |
| Every mousemove hits the server | `setPaneWidth` sends `state:set` instead of updating local only | Split clearly: setPaneWidth is local; commitPaneWidths persists |
| State doesn't persist across refresh | `state:set` not being sent, OR server file write failing | Check WS frames + server log |
| Defaults never apply | `getDefaults` reading wrong path, or layout.json missing | Verify the fallback chain |
| Collapsed pane disappears entirely | `display: none` instead of narrow rail | `.sidebar--collapsed > *:not(...)` display:none, but the parent itself should be visible at 40px |
| Right-side FloatingChat (wiki-viewer) breaks | Wasn't supposed to touch it | Revert any changes to FloatingChat.tsx or WikiExplorer.tsx |

---

## Do not do

- **Do not** touch `FloatingChat.tsx` or `WikiExplorer.tsx`. Wiki's existing popup stays exactly as it is. SPEC-26d will generalize.
- **Do not** touch `panelStore` thread state (`threads`, `currentThreadIds`, `currentScope`, `projectChat`, `panels[panelId]`). Those were set up correctly in 26c for both scopes; 26d will use the view-scope fields.
- **Do not** touch `thread-handlers.ts` or any `thread:*` wire handling. 26c is done.
- **Do not** add the right-side view chat back in any form. SPEC-26d handles the floating popup.
- **Do not** add the FAB, traffic lights, thread picker modal, or dock in this spec. All of that is 26d.
- **Do not** rename `Sidebar.tsx` or `ChatArea.tsx` or split them into project/view variants. They keep the scope prop; only one instance of each is rendered in the current layout (scope="project").
- **Do not** touch SQLite schema.
- **Do not** touch wire protocol for `thread:*`.
- **Do not** set `grid-row: 1` on `.rv-resize-handle`. See the bug note in the CSS section.
- **Do not** write per-view state to any location other than `ai/views/<view>/state/<username>.json`.
- **Do not** use localStorage — the user explicitly chose file-based persistence.
- **Do not** touch `lib/runner/`, `lib/frontmatter/`, `lib/views/`, or any other server module.
- **Do not** auto-collapse based on screen width or other responsive behavior.
- **Do not** add animations (beyond the free CSS variable transitions).
- **Do not** touch the agents-viewer area.

---

## Commit message template

```
SPEC-26c-2: left-column collapse + resize + right-column teardown

Pivot from 26c's symmetric 5-column layout to an asymmetric 3-column
layout. The right-side view chat column is removed in this spec;
SPEC-26d will re-expose it as a floating popup.

Stream 1 — Right-side layout teardown:
  - App.tsx PanelContent drops <ChatArea scope="view" /> and
    <Sidebar scope="view" />. Grid collapses from 5 tracks to 3 content
    columns + 2 resize handles.
  - App.css .rv-layout-dual-chat grid-template-columns rewritten as:
    var(--left-sidebar-w, 220px) 6px var(--left-chat-w, 320px) 6px 1fr
  - panelStore scope infrastructure (threads.view, currentThreadIds.view,
    etc.) retained intact for SPEC-26d to consume.

Stream 2 — Left-column collapse + resize:
  - New ResizeHandle.tsx component (~60 lines). Captures startX +
    startWidth on mousedown, mousemove calls setPaneWidth (local),
    mouseup calls commitPaneWidths (persist). Clamps 120-600.
  - Sidebar.tsx and ChatArea.tsx each accept a `collapsed` prop. When
    true, render a 40px rail with an expand icon. When false, render
    normally with an inline collapse button.
  - App.tsx writes inline CSS variables on .rv-panel from
    viewStates[panel].widths (or DEFAULT_WIDTHS) with collapsed-aware
    40px overrides.
  - user-select: none during drag; grid-row NOT set on handles
    (avoids the CSS Grid auto-placement bug seen in the first draft).

Stream 3 — Per-view local JSON persistence:
  - New lib/view-state/index.js server module: readViewState,
    writeViewState, writeViewStatePatch, resolveViewState. Atomic
    writes (tmp + rename).
  - New lib/view-state/defaults.js: maps existing layout.json fields
    (threadListVisible, threadListWidth, chatWidth) to the ViewUIState
    shape. HARDCODED_DEFAULTS fallback: sidebar 220px, chat 320px,
    both expanded.
  - New state:get / state:set wire messages in client-message-router.js.
    Username via lib/thread/ChatFile getUsername(). Responses echoed
    as state:result so client can reconcile.
  - ws-client.ts handles state:result / state:error.
  - panelStore gains viewStates slice + loadViewState / toggleCollapsed /
    setPaneWidth / commitPaneWidths actions. setCurrentPanel dispatches
    loadViewState on uncached views.

Files at ai/views/<view>/state/<username>.json hold:
  {
    "collapsed": { "leftSidebar": bool, "leftChat": bool },
    "widths":    { "leftSidebar": num,  "leftChat": num  }
  }

Default precedence: per-user file → view's layout.json → hardcoded.

Live-validated:
  - 3-column layout: [Sidebar][Chat][Content]
  - Collapse toggles rail the pane to 40px, content reflows
  - Drag handles resize smoothly, clamp at 120/600
  - State persists across refresh and view switches
  - FloatingChat on wiki-viewer still works unchanged
  - Smoke test 49/0

Part of SPEC-26 (dual-chat paradigm, asymmetric). SPEC-26d is next:
view chat becomes a floating popup (FAB + traffic lights + dock +
thread picker modal).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main`. Expected:
   - `App.tsx` medium (~30 net — right-side removal + inline style vars)
   - `App.css` medium (~60 — grid rewrite + handle + collapsed styles)
   - `panelStore.ts` medium (~90 — viewStates slice + actions)
   - New `ResizeHandle.tsx` (~60)
   - `Sidebar.tsx` small (~25 — collapse button + rail)
   - `ChatArea.tsx` small (~25 — same)
   - `ChatInput.tsx` untouched
   - `types/index.ts` small (~15)
   - `ws-client.ts` small (~10 — state:* handlers)
   - New `lib/view-state/index.js` (~90)
   - New `lib/view-state/defaults.js` (~40)
   - `client-message-router.js` small (~35 — state:* cases)

2. **Static checks.** tsc, npm build, node-e module load — all pass.

3. **Server boot output.** HTTP 200, no errors, trigger/filter loading unchanged.

4. **Live validation walkthrough.** Run all 19 steps in the live validation section. Report each. Specifically confirm:
   - Only 3 columns visible (NOT 5)
   - Wiki-viewer's FloatingChat still works
   - Collapse rail renders correctly (not display: none)
   - Drag is smooth (no jump on mousedown, no jitter during drag)
   - Clamps work at 120 and 600

5. **State file audit.** Paste two different views' state files after toggling and dragging.

6. **Surprises.** Anything that needed updating outside the change list. Particular watch items: did the 26c scope split in `panelStore` interact weirdly with the new `viewStates` slice? Did 26c's thread-handlers.ts need any changes (shouldn't, but verify)?

7. **Files touched outside the change list.** Expected: zero beyond what's listed. If any, explain.

8. **26d signals.** While touching Sidebar.tsx and ChatArea.tsx, note:
   - What will the FloatingChat wrapper need to provide for the view-scoped ChatArea to work inside a popup?
   - Is the current FloatingChat.tsx's draggable logic reusable, or does 26d need to rewrite it?
   - Where does the per-view popup state belong (new store slice? extension of viewStates?)?

Hand the report back to the orchestrator. After this lands, SPEC-26d (FAB + floating popup for view chats) is the next and final phase of the 26 series.
