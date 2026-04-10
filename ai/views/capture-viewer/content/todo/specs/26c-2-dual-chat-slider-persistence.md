# SPEC-26c-2 — Dual Chat Slider State + Local JSON Persistence

**Parent:** SPEC-26 (dual-chat paradigm)
**Position:** Phase 3.5 of 4. Polish pass on 26c. Adds collapse/expand affordances for each chat column and per-view persistence of those preferences.
**Depends on:**
- 26a (`72d390e`), 26b (`e0913c2`), 26c (TBD) all merged
**Model recommendation:** **Sonnet 4.6**. Smaller than 26c; mostly additive. Local JSON file format, a few new UI affordances, a new store slice for slider state.
**Estimated blast radius:** **Low-medium.** No state shape changes to existing slices. Adds one new top-level store field + one new server route (if file-based) OR a client-side hook (if localStorage). No wire protocol changes.

---

## Your mission

Add collapse/expand controls for each of the four chat-column pieces (left sidebar, left chat, right chat, right sidebar), and persist the collapsed/expanded state per view so it survives reloads.

Two work streams:

**Stream 1 — Collapse affordances.**
Each chat column can collapse to a thin edge rail (or menu button) and expand back out. Minimum UX:
- Each sidebar has a collapse toggle (probably a small button at the header or edge)
- Each chat column has a similar toggle (in the chat header area, or at the edge between it and the content)
- Content area flexes to fill the freed space when any side collapses
- Collapsed state is a thin strip (not hidden) so the expand affordance is always reachable

**Stream 2 — Per-view persistence via local JSON.**
Per the user's directive: "Local JSON" — following the project's "templated but composable" config pattern (matching how index.json / content.json / layout.json live in view folders today).

The persistence model:
- Each view has its own UI state file at `ai/views/<view>/state/<username>.json` (or similar — see design decision below)
- The file holds per-user UI preferences for that view — starting with the four collapse booleans
- On mount, the client asks the server for the current user's state file for the current view
- On toggle, the client writes the updated state back to the server
- Server reads/writes the file via new wire messages (OR a REST endpoint — see design decision)

The "templated but composable" intent: the file format matches the project's other config file patterns (JSON, small, per-user, in the view's own folder). It should be browsable via the file explorer, git-trackable for users who want to sync UI preferences across devices, and obvious to a human reader.

---

**After this phase:**
- Each of the four chat-column pieces has a collapse toggle
- Clicking a toggle hides that piece (to a thin rail or menu button) and expands the content area
- State persists per view: switching views restores the previous collapse state for the new view
- Per-user state file lives at `ai/views/<view>/state/<username>.json` (or similar location — locked in below)
- Default state for new views: everything expanded (conservative)
- Reloading the browser restores the last-saved state

**You are not touching:**
- Server thread routing, wire protocol, SQLite schema — all handled in 26a/26b
- The dual-chat layout itself — that's 26c's responsibility
- Dual-wire support — 26d
- Chat header component design — 26d (this spec adds collapse toggles, probably as small inline buttons; the full chat header is 26d)
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
- **Per-column booleans:** `{ leftSidebar: boolean, leftChat: boolean, rightChat: boolean, rightSidebar: boolean }`
- **Richer preferences:** include widths, thread list collapsed state, etc.

**My recommendation:** Start with the four booleans. Richer preferences come later when the need is real. Keep the schema minimal.

**D4 — Default state for views without a file.**
- Everything expanded (all four booleans true)
- Or read from `ai/views/<view>/settings/layout.json` which still has `chatPosition`, `threadListVisible` etc. from the pre-26c era. These fields become the "view default" if no per-user state exists.

**My recommendation:** Use `layout.json`'s `threadListVisible` (and a new `chatVisible` if needed) as the per-view DEFAULT. Per-user state in `state/<username>.json` OVERRIDES. This lets a view's author ship with sensible defaults (e.g., agents-viewer starts with threads hidden because its threads are agent-owned), while individual users can still diverge.

This is the "templated but composable" pattern the user described: each view has default config that composes with user overrides.

---

## Scope — assuming the D1-D4 recommendations

### Server changes

**New file:** `lib/view-state/index.js` — read/write per-user view state files.

Exports:
- `readViewState(projectRoot, viewId, username)` → returns the parsed JSON or `{}` if missing
- `writeViewState(projectRoot, viewId, username, state)` → writes atomically, creates `ai/views/<view>/state/` if needed

**Wire messages (new):** Add to `lib/ws/client-message-router.js`:

- `state:get { view }` — server reads `ai/views/<view>/state/<currentUser>.json`, merges with the view's layout.json defaults, sends back `state:result { view, state }`
- `state:set { view, state }` — server writes the (partial) state to the per-user file

Username comes from `getUsername()` in `lib/thread/ChatFile.js` — reuse that.

**Default state resolution order:**
1. `ai/views/<view>/state/<username>.json` (if exists) — highest priority
2. `ai/views/<view>/settings/layout.json` — `threadListVisible`, `chatVisible` (new field if we want it), etc.
3. Hardcoded defaults: all four panes visible

### Client changes

**New store slice: `viewState`.**

```ts
// in panelStore.ts
interface ViewUIState {
  leftSidebar: boolean;   // project sidebar visible
  leftChat: boolean;      // project chat visible
  rightChat: boolean;     // view chat visible
  rightSidebar: boolean;  // view sidebar visible
}

interface AppState {
  // ... existing ...

  // SPEC-26c-2: per-view UI state (collapse/expand preferences)
  viewStates: Record<string, ViewUIState>;  // keyed by view id
  setViewStatePane: (view: string, pane: keyof ViewUIState, visible: boolean) => void;
  loadViewState: (view: string) => void;  // sends state:get, updates store on reply
}
```

**New WS handler** to process `state:result` responses and populate `viewStates[view]`.

**On `setCurrentPanel(id)` dispatch:** if `viewStates[id]` is missing, call `loadViewState(id)` to fetch from the server.

**Collapse toggles in Sidebar/ChatArea:**
- Sidebar gets a small collapse button (e.g., a `<` or `→` icon in the header)
- ChatArea gets a similar button (e.g., at the top-right of the chat pane, or in an eventual chat header)
- Clicking sends `state:set { view: currentPanel, state: { [pane]: !currentValue } }` and optimistically updates local state

**Layout CSS updates:**
- Add collapsed variants for each of the four panes:
  - `.sidebar--collapsed` — narrow rail (e.g., 40px wide with just an expand icon)
  - `.chat-area--collapsed` — similar rail
- `.rv-layout-dual-chat` grid template columns dynamically sized via inline style or CSS vars based on which panes are collapsed

### Per-view defaults (from layout.json)

Augment `lib/views/index.js` `resolveChatConfig` (or add a sibling helper) to read `settings/layout.json` and extract the default UI state fields. Returned alongside the other chat config. The server uses these when no per-user state file exists.

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

1. **Fresh view — defaults load.** Open a view you haven't visited since this spec landed. All four panes visible by default (or whatever the view's layout.json declares).

2. **Collapse a pane.** Click the collapse toggle on the left sidebar. It collapses to a thin rail. The content area expands.

3. **Refresh the browser.** The collapsed state is restored — left sidebar still collapsed.

4. **Switch views.** The new view has its own state (independently collapsed or expanded based on its own file).

5. **Switch back to the original view.** State is restored to what you left it.

6. **Check the state file on disk.**
   ```bash
   cat /Users/rccurtrightjr./projects/open-robin/ai/views/code-viewer/state/rccurtrightjr..json
   ```
   Expected: valid JSON with the boolean state you toggled.

7. **Manually edit the file.** Flip a boolean via your editor. Refresh the browser. The edited value should appear (proves the server reads the file on demand).

8. **Delete the state file.** Refresh. Defaults from layout.json (or hardcoded fallback) should apply.

9. **Second user.** If possible, test with a different username — either by changing `getUsername()` temporarily or by running as a different OS user. Different state file, different preferences, no collisions.

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| State doesn't persist across reloads | `state:set` not being sent, or server not writing | Check the WS frame and the server log |
| All views share the same state | Store is using a single `viewState` instead of keyed `viewStates[view]` | Fix the store key |
| Default state never applies | Server isn't reading layout.json fallback | Check `readViewState` fallback chain |
| Collapsed pane is hidden instead of railed | CSS `.sidebar--collapsed` is `display: none` instead of narrow | Fix CSS |
| Per-user file collision | `getUsername()` returning the wrong value | Check the username resolution |
| File written to wrong location | Path assembly in server — check `ai/views/<view>/state/<username>.json` | Verify with file explorer |

---

## Do not do

- **Do not** add slider state for anything other than the four collapse booleans. Width sliders, font size, theme — all future work.
- **Do not** use localStorage instead of the file-based persistence. The user specifically chose "local JSON" with the composable config pattern.
- **Do not** touch the SQLite schema. UI state stays file-based.
- **Do not** remove or modify the `layout.json` files. They become the per-view defaults.
- **Do not** auto-collapse anything based on screen width. Responsive behavior is future work.
- **Do not** add animations for the collapse/expand transitions unless they're effectively free (CSS transitions on grid-template-columns). Animations are polish.
- **Do not** move chat header affordances into a separate component. 26d handles that.
- **Do not** touch `lib/thread/`, `lib/runner/`, `lib/frontmatter/`, or any server file unrelated to view state.

---

## Commit message template

```
SPEC-26c-2: per-view slider state + local JSON persistence

Adds collapse/expand affordances for each of the four chat-column
pieces (left sidebar, left chat, right chat, right sidebar) and
persists the state per view per user to disk following the
project's "templated but composable" config pattern.

Server:
  - New lib/view-state/index.js — readViewState /
    writeViewState helpers. Files live at
    ai/views/<view>/state/<username>.json. Creates the directory
    on demand. Default state falls back to the view's
    settings/layout.json (threadListVisible, etc.) and then to
    hardcoded all-visible.
  - New wire messages in client-message-router:
      state:get { view } → state:result { view, state }
      state:set { view, state }
  - Username resolution via lib/thread/ChatFile.js getUsername.

Client:
  - New viewStates store slice in panelStore.ts, keyed by view id
  - loadViewState(view) action dispatched on setCurrentPanel
  - setViewStatePane(view, pane, visible) updates store
    optimistically and sends state:set
  - New WS handler for state:result responses
  - Sidebar.tsx and ChatArea.tsx each gain a collapse toggle
    button. Clicking it toggles the corresponding store slot.
  - New .sidebar--collapsed / .chat-area--collapsed CSS variants
    (thin rail with expand icon, ~40px wide).
  - App.tsx grid-template-columns sized dynamically based on
    which panes are collapsed (via CSS variables or inline style).

Default state resolution order (server-side):
  1. ai/views/<view>/state/<username>.json (if exists)
  2. ai/views/<view>/settings/layout.json defaults
  3. Hardcoded: all four panes visible

Live-validated:
  - Fresh view loads with defaults
  - Collapsing a pane persists across browser refresh
  - Switching views restores each view's independent state
  - Manually editing the state file is picked up on next load
  - Deleting the state file falls back to layout.json defaults
  - Multiple users have isolated state files

Part of SPEC-26 (dual-chat paradigm). 26d is next: dual wire
support + chat header per side + harness wizard per side.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main`. Expected: panelStore.ts small-medium (~40 net), one new lib/view-state/index.js (~80), client-message-router.js small (~30 for state:* handlers), Sidebar.tsx small (~15 for collapse button), ChatArea.tsx small (~15), views.css small (~25 for collapsed variants), possibly App.tsx tiny for the grid-template-columns adjustment.

2. **D1-D4 decisions locked.** If you diverged from the recommendations, explain why.

3. **Static checks.** tsc, build, module load — all pass.

4. **Live validation walkthrough.** Run steps 1-9 of the live validation section. Report each.

5. **State file audit.** Paste the contents of two different views' state files after toggling some panes.

6. **Surprises.**

7. **26d signals.** After 26c-2 lands, what would make the most sense to build first in 26d — dual wire support, chat header component, or harness wizard per side? Which one will feel most urgent to the user given what they now see in the UI?

Hand the report back to the orchestrator.
