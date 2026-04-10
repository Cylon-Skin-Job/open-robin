# SPEC-26c-2 — Dual Chat Slider State + Resize Handles + Local JSON Persistence

**Parent:** SPEC-26 (dual-chat paradigm)
**Position:** Phase 3.5 of 4. Polish pass on 26c. Adds collapse/expand affordances, drag-to-resize handles at every column boundary, and per-view persistence of both dimensions of UI state.
**Depends on:**
- 26a (`72d390e`), 26b (`e0913c2`), 26c (TBD) all merged
**Model recommendation:** **Opus 4.6**. Two new UX patterns (collapse + drag-resize), new persistence layer, CSS refactor from hardcoded grid widths to CSS variables. Multiple moving pieces tightly coupled through the same state slice.
**Estimated blast radius:** **Medium.** Adds one new top-level store field + new wire messages + new server module + new client components (drag handle, collapse button). Refactors the grid-template-columns in views.css from hardcoded values to CSS variables. No wire protocol changes for thread messages; new `state:*` namespace added.

---

## Your mission

Two UX affordances built on one shared persistence layer. Three work streams:

**Stream 1 — Collapse affordances.**
Each chat column can collapse to a thin edge rail and expand back out. Minimum UX:
- Each sidebar has a collapse toggle (a small button in the header or at its inner edge)
- Each chat column has a similar toggle (likewise at the header or inner edge)
- Content area flexes to fill the freed space when any side collapses
- Collapsed state is a thin strip (~40px — the "rail"), not fully hidden, so the expand affordance is always reachable

**Stream 2 — Drag-to-resize handles.**
Four thin vertical drag handles sit at the column boundaries:
- Between left sidebar and left chat
- Between left chat and content area
- Between content area and right chat
- Between right chat and right sidebar

Each handle shows a `col-resize` cursor on hover and updates the adjacent column's width on drag. Content area stays `1fr` and absorbs whatever width change happens on either side. Min/max enforced in the drag handler (120px min per column, ~600px max — tune to taste).

**Stream 3 — Per-view persistence via local JSON.**
Per the user's directive: "Local JSON" — following the project's "templated but composable" config pattern (matching how index.json / content.json / layout.json live in view folders today).

The persistence model:
- Each view has its own UI state file at `ai/views/<view>/state/<username>.json`
- The file holds per-user UI preferences for that view: the four collapse booleans AND the four pane widths
- On mount, the client asks the server for the current user's state file for the current view
- On toggle OR after a drag settles, the client writes the updated state back to the server
- Server reads/writes the file via new `state:*` wire messages

The "templated but composable" intent: the file format matches the project's other config file patterns (JSON, small, per-user, in the view's own folder). It should be browsable via the file explorer, git-trackable for users who want to sync UI preferences across devices, and obvious to a human reader.

**CSS refactor:** 26c ships with hardcoded grid-template-columns values (e.g., `220px 320px 1fr 320px 220px`). 26c-2 converts those to CSS variables driven by state so both collapse and resize can mutate them at runtime without touching the stylesheet.

---

**After this phase:**
- Each of the four chat-column pieces has a collapse toggle
- Clicking a toggle collapses that piece to a thin rail (~40px with just an expand icon) and the content area reflows to fill the freed space
- Each column boundary has a drag handle; the user can stretch any column to their preferred width
- State persists per view: switching views restores the previous collapse state AND widths for the new view
- Per-user state file lives at `ai/views/<view>/state/<username>.json` and holds BOTH collapsed booleans and pane widths
- Default state for new views: everything expanded at widths from `layout.json` (if present) or hardcoded fallbacks
- Reloading the browser restores the last-saved state including drag positions
- Grid-template-columns in views.css is CSS-variable-driven (`var(--left-sidebar-w)` etc.), mutated from state

**You are not touching:**
- Server thread routing, wire protocol (thread:* messages), SQLite schema — all handled in 26a/26b
- The dual-chat layout itself — that's 26c's responsibility
- Dual-wire support — 26d
- Chat header component design — 26d (this spec adds collapse toggles + drag handles, probably as small inline affordances; the full chat header is 26d)
- Harness wizard — 26d
- Agents area

---

## Design decisions to lock in before coding

**D1 — File location and naming.**
Three candidates:
- **A.** `ai/views/<view>/state/<username>.json` — new `state/` subdirectory per view, per-user file inside. Clean separation from settings/ (which is AI-locked) and content/ (which is primary data).
- **B.** `ai/views/<view>/content/ui-state.json` — shared across users, one file per view. Simpler but doesn't match the per-user model the user described.
- **C.** `ai/user-state/<username>/views/<view>.json` — global user-state root, view-keyed files inside. Centralized per user but breaks the "each view owns its own config" locality.

**My recommendation:** Option A. It matches the "each view is a self-contained unit with its own config" pattern. The per-user subfile respects collaboration (co-workers can have different slider preferences in the same view without conflict). The `state/` directory is new but parallels the existing `content/` and `settings/` subfolders.

Lock it in with the executor before drafting; or take the lean.

**D2 — Transport: wire messages or HTTP?**
- **Wire messages:** `state:get { view, username }` / `state:set { view, username, state }`. Reuses the existing WS. Low-overhead.
- **HTTP:** REST endpoint like `GET /api/view-state/<view>` and `POST /api/view-state/<view>`. Simple. No coordinating with wire protocol state.

**My recommendation:** Wire messages. The client is already WS-heavy, and this keeps the persistence path consistent with everything else. A new `state:*` namespace on the wire (parallel to `thread:*`, `robin:*`, `clipboard:*`).

**D3 — Granularity.**
- **Per-column booleans only:** just `{ leftSidebar, leftChat, rightChat, rightSidebar }` visibility flags
- **Booleans + widths:** `{ collapsed: {...4 booleans}, widths: {...4 numbers} }`

**My recommendation:** Both. The four booleans cover collapse state; the four widths cover drag-to-resize state. Both persist to the same file so the user's full layout preferences are captured in one place.

**D4 — Default state for views without a file.**
- Everything expanded (all four booleans true) + hardcoded default widths
- Or read from `ai/views/<view>/settings/layout.json` which has `chatPosition`, `threadListVisible`, `chatWidth`, `threadListWidth` — existing fields from the pre-26c era that become the "view default" when no per-user state exists.

**My recommendation:** Use `layout.json`'s existing fields as per-view defaults, with a precedence chain:

1. **Per-user file** (`ai/views/<view>/state/<username>.json`) — if present, highest priority
2. **View's `layout.json`** — `threadListVisible` → collapsed.leftSidebar; `threadListWidth` → widths.leftSidebar; `chatWidth` → widths.leftChat; mirror fields for the right side if present, otherwise same widths applied symmetrically
3. **Hardcoded fallback:** all expanded, sidebars 220px, chats 320px

This revives the existing `layout.json` fields for their intended purpose: each view ships with sensible default widths and visibility, and individual users override via drag/collapse. The "templated but composable" pattern.

**D5 — Resize handle UX.**
- **Width commit timing:**
  - **Optimistic + throttled:** update state on every mousemove (throttled to ~16ms), commit to server 300ms after the user stops dragging
  - **Commit on mouseup only:** update state on every mousemove (unbounded), commit to server once when the drag ends
- **Handle positioning:**
  - **In-grid handle:** a thin column in the grid-template-columns (e.g., 6px wide) between each pair of content columns
  - **Absolute overlay:** `position: absolute` strip on top of the boundary

**My recommendation:** Commit-on-mouseup (simpler, avoids sending many writes during a drag) + in-grid handle (works naturally with the grid layout, no z-index games). Store the widths in state during the drag so other components re-render smoothly; persist to server only once the user releases.

**D6 — Minimum and maximum widths.**
- Each pane has a min of **120px** (below this, content becomes unusable)
- Each pane has a max of **600px** (above this, the content area gets squeezed too hard)
- When a pane is collapsed, its "collapsed width" is **40px** (the rail), but its stored width in the user's file remains at whatever value they set — so expanding restores the previous size

**My recommendation:** Enforce 120px/600px in the drag handler (clamp the value before writing to state). Don't persist values outside that range.

---

## Scope — assuming the D1-D6 recommendations

### Server changes

**New file:** `lib/view-state/index.js` — read/write per-user view state files.

Exports:
- `readViewState(projectRoot, viewId, username)` → returns the parsed JSON or `null` if missing
- `writeViewState(projectRoot, viewId, username, state)` → writes atomically, creates `ai/views/<view>/state/` if needed
- `resolveViewState(projectRoot, viewId, username)` → merges per-user file with layout.json defaults and hardcoded fallbacks; returns the fully populated `ViewUIState`

**New file:** `lib/view-state/defaults.js` — pull default state from the view's `settings/layout.json`. Maps the existing fields:
- `threadListVisible` → `collapsed.leftSidebar` (inverted: visible=true → collapsed=false)
- `threadListWidth` → `widths.leftSidebar`
- `chatWidth` → `widths.leftChat`
- Right-side fields get the same values unless the layout.json declares separate mirror fields (future extension)

**Wire messages (new) in `lib/ws/client-message-router.js`:**

- `state:get { view }` — server calls `resolveViewState`, sends back `state:result { view, state }`
- `state:set { view, state }` — server merges the partial state patch with the existing file and writes atomically

Username comes from `getUsername()` in `lib/thread/ChatFile.js` — reuse that.

### Client changes

**New store slice: `viewStates`.**

```ts
// in panelStore.ts
interface ViewUIState {
  collapsed: {
    leftSidebar: boolean;
    leftChat: boolean;
    rightChat: boolean;
    rightSidebar: boolean;
  };
  widths: {
    leftSidebar: number;
    leftChat: number;
    rightChat: number;
    rightSidebar: number;
  };
}

type Pane = 'leftSidebar' | 'leftChat' | 'rightChat' | 'rightSidebar';

interface AppState {
  // ... existing ...

  // SPEC-26c-2: per-view UI state (collapse/expand + pane widths)
  viewStates: Record<string, ViewUIState>;  // keyed by view id

  loadViewState: (view: string) => void;                          // send state:get, update on reply
  toggleCollapsed: (view: string, pane: Pane) => void;            // local toggle + send state:set
  setPaneWidth: (view: string, pane: Pane, width: number) => void; // local update (no persist)
  commitPaneWidths: (view: string) => void;                       // persist current widths to server
}
```

The split between `setPaneWidth` (local only) and `commitPaneWidths` (persist) lets drag handles update state smoothly on every mousemove without hitting the server, then commit once on mouseup.

**New WS handler** for `state:result`: populate `viewStates[msg.view]` from `msg.state`.

**On `setCurrentPanel(id)`:** if `viewStates[id]` is missing, call `loadViewState(id)` to fetch from the server. Show a reasonable default shape in the meantime (fully-expanded, hardcoded widths) so the layout doesn't flash.

**New component: `<ResizeHandle />`.**

```tsx
interface ResizeHandleProps {
  panel: string;   // current view
  pane: Pane;      // which pane this handle adjusts
}

function ResizeHandle({ panel, pane }: ResizeHandleProps) {
  // mousedown → start tracking; calculate delta from initial mouse x
  // apply to store.setPaneWidth(panel, pane, newWidth) on every mousemove
  // mouseup → store.commitPaneWidths(panel) to persist
  // clamp width between 120 and 600 before writing
  // show col-resize cursor
  return <div className="rv-resize-handle" data-pane={pane} />;
}
```

Rendered four times inside PanelContent, at the boundaries between grid columns.

**Collapse toggles in Sidebar / ChatArea:**
- Sidebar gets a small collapse button in its header (a `<` or `→` icon)
- ChatArea gets a similar button at its inner edge (toward the content area)
- Click → `store.toggleCollapsed(panel, pane)` → state updates locally + sends `state:set` with the new collapsed boolean
- Collapsed panes render as a ~40px rail with only an expand icon visible
- Click the rail expand icon → `toggleCollapsed` again → expand back to the stored width

**Layout CSS updates (`ai/views/settings/styles/views.css`):**

Replace the hardcoded grid-template-columns from 26c with CSS variable references. The client writes the variable values via inline style on the panel container.

```css
.rv-layout-dual-chat {
  display: grid;
  grid-template-columns:
    var(--left-sidebar-w, 220px)
    6px  /* resize handle column 1 */
    var(--left-chat-w, 320px)
    6px  /* resize handle column 2 */
    1fr
    6px  /* resize handle column 3 */
    var(--right-chat-w, 320px)
    6px  /* resize handle column 4 */
    var(--right-sidebar-w, 220px);
  grid-template-rows: 1fr;
  height: 100%;
}

.rv-resize-handle {
  grid-row: 1;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
}

.rv-resize-handle:hover {
  background: var(--theme-primary, #888);
  opacity: 0.4;
}

.sidebar--collapsed,
.chat-area--collapsed {
  width: 40px !important;  /* override grid-template width */
  /* hide child content except the expand button */
}

.chat-area--inactive {
  /* unchanged from 26c */
}
```

The six columns for the handles live between the five content columns. When a pane is collapsed, the JS updates its CSS variable to `40px` (the rail width) and adds the `--collapsed` class to the element for inner-content hiding.

**PanelContent update in App.tsx.**

Take the `viewStates[panel]` and apply its width values as inline style CSS variables:

```tsx
const viewState = usePanelStore((s) => s.viewStates[panel]);
const widths = viewState?.widths || DEFAULT_WIDTHS;
const collapsed = viewState?.collapsed || DEFAULT_COLLAPSED;

const gridStyle: CSSProperties = {
  '--left-sidebar-w':  `${collapsed.leftSidebar ? 40 : widths.leftSidebar}px`,
  '--left-chat-w':     `${collapsed.leftChat ? 40 : widths.leftChat}px`,
  '--right-chat-w':    `${collapsed.rightChat ? 40 : widths.rightChat}px`,
  '--right-sidebar-w': `${collapsed.rightSidebar ? 40 : widths.rightSidebar}px`,
} as CSSProperties;

return (
  <div className="rv-layout-dual-chat" style={gridStyle}>
    <Sidebar panel={panel} scope="project" collapsed={collapsed.leftSidebar} />
    <ResizeHandle panel={panel} pane="leftSidebar" />
    <ChatArea panel={panel} scope="project" collapsed={collapsed.leftChat} />
    <ResizeHandle panel={panel} pane="leftChat" />
    <ContentArea panel={panel} />
    <ResizeHandle panel={panel} pane="rightChat" />
    <ChatArea panel={panel} scope="view" collapsed={collapsed.rightChat} />
    <ResizeHandle panel={panel} pane="rightSidebar" />
    <Sidebar panel={panel} scope="view" collapsed={collapsed.rightSidebar} />
  </div>
);
```

Note: the `collapsed` prop on Sidebar/ChatArea is what those components use to decide whether to render full content or just the expand-icon rail. Pass it through.

**File format for the per-user state file:**

```json
{
  "collapsed": {
    "leftSidebar": false,
    "leftChat": false,
    "rightChat": false,
    "rightSidebar": false
  },
  "widths": {
    "leftSidebar": 220,
    "leftChat": 320,
    "rightChat": 320,
    "rightSidebar": 220
  }
}
```

Both `collapsed` and `widths` are always present after first write. Partial writes are merged with the existing file on the server side.

---

## Test plan

### Static checks

```bash
# Server module loads
node -e "require('./lib/view-state')"
node -e "require('./lib/ws/client-message-router')"

# Client typecheck + build
cd ../open-robin-client
npx tsc --noEmit
npm run build
```

### Live validation

**Collapse path:**

1. **Fresh view — defaults load.** Open a view you haven't visited since this spec landed. All four panes visible by default at widths from layout.json (or hardcoded 220/320/320/220).

2. **Collapse a pane.** Click the collapse toggle on the left sidebar. It collapses to a thin ~40px rail. The content area expands.

3. **Refresh the browser.** The collapsed state is restored — left sidebar still collapsed.

4. **Switch views.** The new view has its own state (independently collapsed or expanded based on its own file).

5. **Switch back to the original view.** Collapse state is restored to what you left it.

6. **Expand the rail back out.** Click the expand icon on the collapsed rail. The sidebar returns to its previous width (not a hardcoded default).

**Resize path:**

7. **Hover a column boundary.** Cursor should change to `col-resize`.

8. **Drag the left-sidebar / left-chat boundary.** The left sidebar widens or narrows; content area flexes. Smooth update on every mousemove.

9. **Release the drag.** State commits to the server file (check server log for a `state:set` message if logging is on).

10. **Refresh the browser.** The dragged width is restored.

11. **Drag past the min (120px).** The column should clamp at 120px — can't go narrower.

12. **Drag past the max (600px).** Clamp at 600px.

13. **Drag adjacent to a collapsed rail.** Either: disabled (can't drag into a rail), or the rail expands first and then the drag takes over. Executor's choice — document which.

**Persistence + multi-view:**

14. **Set different widths on three different views.** Verify each retains its own state independently.

15. **Check the state file on disk.**
    ```bash
    cat /Users/rccurtrightjr./projects/open-robin/ai/views/code-viewer/state/rccurtrightjr..json
    ```
    Expected: JSON with both `collapsed` and `widths` objects, values matching what you dragged/toggled.

16. **Manually edit the file.** Change a width to 250px via your editor. Refresh. The edited value should appear in the UI.

17. **Delete the state file.** Refresh. Defaults from layout.json (or hardcoded fallback) should apply.

18. **Second user.** If possible, test with a different username. Different state file, different preferences, no collisions.

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| State doesn't persist across reloads | `state:set` not being sent, or server not writing | Check the WS frame and the server log |
| All views share the same state | Store is using a single `viewState` instead of keyed `viewStates[view]` | Fix the store key |
| Default state never applies | Server isn't reading layout.json fallback | Check `resolveViewState` fallback chain |
| Collapsed pane is hidden instead of railed | CSS `.sidebar--collapsed` is `display: none` instead of narrow | Fix CSS |
| Per-user file collision | `getUsername()` returning the wrong value | Check the username resolution |
| File written to wrong location | Path assembly in server — check `ai/views/<view>/state/<username>.json` | Verify with file explorer |
| Drag jumps on mousedown | The drag handler is calculating delta from 0 instead of from mouse.x | Track initial mouse x on mousedown, subtract on mousemove |
| Drag persists to server on every mousemove | `setPaneWidth` is sending `state:set` instead of updating local state only | Split `setPaneWidth` (local) from `commitPaneWidths` (persist) |
| Content area overflows horizontally after drag | Grid template is losing `1fr` for content area | Verify the grid-template-columns still has `1fr` in the content slot regardless of how the other columns resize |
| Resize handle invisible | `.rv-resize-handle` has no background and zero hover feedback | Check the CSS — it should have `col-resize` cursor and a visible hover state |
| Drag through a collapsed rail causes weird behavior | Drag handler isn't aware the adjacent pane is collapsed | Either disable drag when adjacent pane is collapsed, or expand-and-drag (document choice in report-back) |
| Width values below 120 or above 600 persist | Clamp missing in the drag handler | Add `Math.max(120, Math.min(600, newWidth))` before writing to state |

---

## Do not do

- **Do not** add any per-view state beyond `collapsed` and `widths`. Font size, theme overrides, thread-list sort order — all future work.
- **Do not** use localStorage instead of the file-based persistence. The user specifically chose "local JSON" with the composable config pattern.
- **Do not** touch the SQLite schema. UI state stays file-based.
- **Do not** remove or modify the `layout.json` files in view folders. They become the per-view defaults (read-only from 26c-2's perspective).
- **Do not** auto-collapse anything based on screen width. Responsive behavior is future work.
- **Do not** add animations for the collapse/expand transitions unless they're effectively free (CSS transitions on grid-template-columns). Animations are polish.
- **Do not** move chat header affordances into a separate component. 26d handles that. 26c-2's collapse buttons are just small inline affordances on the existing Sidebar / ChatArea components.
- **Do not** touch `lib/thread/`, `lib/runner/`, `lib/frontmatter/`, or any server file unrelated to view state.
- **Do not** make the resize handles drag-commit to the server on every mousemove. Drag updates local state only; commit on mouseup.
- **Do not** use `position: absolute` for the resize handles. They live in the grid as thin (6px) columns between the content columns. Grid-native.
- **Do not** let widths go below 120px or above 600px. Clamp in the drag handler.
- **Do not** touch 26c's component file paths or delete any files. 26c-2 extends 26c; it doesn't rewrite.
- **Do not** persist the drag width while the pane is collapsed. When a pane is collapsed, the user's stored width stays at the previous (non-collapsed) value so expanding restores it.

---

## Commit message template

```
SPEC-26c-2: per-view collapse + resize + local JSON persistence

Builds on 26c's dual-chat layout with two new UX affordances and
the persistence layer for both.

Stream 1 — Collapse: each of the four chat-column pieces
(leftSidebar / leftChat / rightChat / rightSidebar) has a small
toggle button. Clicking collapses the pane to a 40px rail; click
the rail's expand icon to restore to the previous width.

Stream 2 — Resize: four drag handles at the column boundaries.
Grab + drag to stretch or narrow any pane. Content area stays 1fr
and flexes to absorb the change. Widths clamped 120-600px. Drag
updates local state smoothly; commit to server only on mouseup.

Stream 3 — Per-view local JSON persistence: both collapsed state
and widths persist to per-view per-user files following the
project's "templated but composable" config pattern.

File format — ai/views/<view>/state/<username>.json:
  {
    "collapsed": { leftSidebar, leftChat, rightChat, rightSidebar },
    "widths":    { leftSidebar, leftChat, rightChat, rightSidebar }
  }

Server:
  - New lib/view-state/index.js — readViewState, writeViewState,
    resolveViewState (merges per-user file with layout.json defaults
    and hardcoded fallbacks).
  - New lib/view-state/defaults.js — maps existing layout.json fields
    (threadListVisible, threadListWidth, chatWidth) to the view's
    default ViewUIState. Revives those fields for their intended
    purpose.
  - New wire messages in client-message-router:
      state:get { view } → state:result { view, state }
      state:set { view, state } — partial patch, merged into file
  - Username via lib/thread/ChatFile.js getUsername.

Client:
  - New viewStates store slice in panelStore.ts, keyed by view id.
    Separate setPaneWidth (local) and commitPaneWidths (persist)
    actions — drag updates local state on mousemove, commits once
    on mouseup.
  - toggleCollapsed action updates state + sends state:set in one
    call (collapse is a single discrete event, not a drag).
  - New WS handler for state:result responses.
  - loadViewState(view) dispatched on setCurrentPanel.
  - Sidebar.tsx and ChatArea.tsx each accept a `collapsed` prop and
    render the rail variant when true.
  - New ResizeHandle.tsx component. 4 instances in PanelContent,
    one per boundary. col-resize cursor, clamped drag, commits on
    mouseup.
  - App.tsx PanelContent writes CSS variables on the grid container
    from viewStates[panel].widths.
  - 26c's hardcoded grid-template-columns refactored to CSS vars:
    var(--left-sidebar-w) / var(--left-chat-w) / 1fr /
    var(--right-chat-w) / var(--right-sidebar-w). 6px handle
    columns inserted between each content column.

Default state resolution order (server-side):
  1. ai/views/<view>/state/<username>.json (if exists)
  2. ai/views/<view>/settings/layout.json (threadListVisible,
     threadListWidth, chatWidth)
  3. Hardcoded: all expanded, sidebars 220px, chats 320px

Live-validated:
  - Fresh view loads with layout.json defaults
  - Collapse toggle → pane becomes 40px rail, content reflows
  - Expand toggle → pane restores to previous width
  - Drag boundary → smooth mousemove-driven resize
  - Mouseup → state commits to file
  - Refresh → layout restored exactly
  - Switch views → each view keeps its independent state
  - Multiple users → isolated state files, no collisions
  - Min/max clamps enforced (120-600px)

Part of SPEC-26 (dual-chat paradigm). 26d is next: dual wire
support + chat header per side + harness wizard per side.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main`. Expected:
   - `panelStore.ts` medium (~60 net — the viewStates slice + actions)
   - New `lib/view-state/index.js` (~100 lines)
   - New `lib/view-state/defaults.js` (~40 lines)
   - `client-message-router.js` small (~30 for the new state:* handlers)
   - New `ResizeHandle.tsx` (~60 lines)
   - `Sidebar.tsx` small (~25 for collapse button + collapsed-rail rendering)
   - `ChatArea.tsx` small (~25 for the same)
   - `App.tsx` medium (~40 for inline CSS vars + ResizeHandle placements)
   - `views.css` medium (~60 for CSS var grid refactor + handle styling + collapsed variants)
   - New WS handler in `thread-handlers.ts` or a new handler file (~20 for state:result)

2. **D1-D6 decisions locked.** If you diverged from any of the six design recommendations, explain why.

3. **Static checks.** tsc, build, module load — all pass.

4. **Live validation walkthrough.** Run all 18 steps of the live validation section (collapse path + resize path + persistence/multi-view). Report each.

5. **State file audit.** Paste the contents of two different views' state files after toggling some panes AND dragging some widths. Confirm both `collapsed` and `widths` are present with reasonable values.

6. **Drag smoothness check.** Qualitative: does dragging a handle feel smooth? Any visible lag or flicker? If it's janky, note whether it's render-time (state update slow) or reflow-time (grid recompute slow).

7. **Clamp verification.** Drag a pane to its min (120) and max (600). Does it clamp correctly? Paste the persisted values.

8. **Surprises.**
   - Did the grid-template-columns CSS var refactor cause any unexpected layout breakage?
   - Did any 26c component assume fixed widths and need updating?
   - Did the drag handler fight with text selection in adjacent panes? If so, did you add `user-select: none` during drag?

9. **Files touched outside the change list.** Expected: zero beyond what's listed. If any, explain.

10. **26d signals.** After 26c-2 lands, what would make the most sense to build first in 26d — dual-wire support, chat header component, or harness wizard per side? Which one will feel most urgent to the user given what they now see in the UI?

Hand the report back to the orchestrator.
