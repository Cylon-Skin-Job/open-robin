# SPEC-26c — Dual Chat Client Layout + State Split

**Parent:** SPEC-26 (dual-chat paradigm)
**Position:** Phase 3 of 4. Builds on 26a (data model) and 26b (server routing). Exposes dual chat to the user for the first time. Does NOT deliver dual-wire support (that's 26d) or slider persistence (that's 26c-2).
**Depends on:**
- 26a merged (`72d390e`) — schema has project_id / scope / view_id
- 26b merged (`e0913c2`) — server routes by scope, wire protocol carries scope
**Model recommendation:** **Opus 4.6**. State shape changes + component parameterization + layout rewrite. Multiple files, tightly coupled, one wrong move breaks both chat columns.
**Estimated blast radius:** **High.** First user-visible change in the 26 series. Dual sidebars, dual chat areas, layout transition from 3-column to 5-column. Client-only (no server changes). Pre-prod wipe required per parent spec.

---

## Your mission

Give the user two chat columns per view — project (left) and view (right) — backed by the dual-scope routing 26b landed. Four coupled work streams:

**Stream 1 — Scope-aware client state.**
panelStore splits thread state by scope:
- `threads` becomes `{ project: Thread[]; view: Thread[] }`
- `currentThreadId` becomes `currentThreadIds: { project: string|null; view: string|null }`
- New field `currentScope: 'project' | 'view' | null` — tracks which chat has the live wire
- Per-panel chat state (`panels[panelId]`) is for view-scoped chat
- New top-level `projectChat: PanelState` holds project-scoped chat state (project chat follows the user across views, so it's NOT per-panel)
- Every thread action gains a `scope` arg: `addThread(scope, thread)`, `setCurrentThreadId(scope, id)`, etc.
- Every message-state action (`addMessage`, `appendSegment`, etc.) gains a `scope` arg; an internal `getChatState(state, scope)` helper resolves to `state.projectChat` or `state.panels[state.currentPanel]`

**Stream 2 — WebSocket handlers route by scope.**
`thread-handlers.ts` reads `msg.scope` from every thread:* response and routes to the right state slot. `thread:list`, `thread:created`, `thread:opened`, `thread:renamed`, `thread:deleted`, `wire_ready` all carry scope from 26b. Handlers use it to decide which list to update, which history to load, which scope becomes `currentScope`.

**Stream 3 — Parameterize Sidebar and ChatArea by scope.**
- `Sidebar.tsx` takes a `scope` prop, reads `threads[scope]` and `currentThreadIds[scope]`, sends `thread:*` messages with `scope` in the payload. Rendered twice: once for project, once for view.
- `ChatArea.tsx` takes a `scope` prop, reads `getChatState(store, scope)` for its messages/turn/segments, sends `prompt` messages with `scope`. Active iff `store.currentScope === scope`. Inactive chat renders history but disables its input with a "click a thread in this sidebar to activate" hint.

**Stream 4 — 5-column layout.**
App.tsx's PanelContent currently switches on three layout strings (`'full'` / `'chat-content'` / `'sidebar-chat-content'`). That whole zoo collapses to a binary `hasChat`:
- `hasChat=false`: `<ContentArea />` only
- `hasChat=true`: `<Sidebar scope="project" /><ChatArea scope="project" /><ContentArea /><ChatArea scope="view" /><Sidebar scope="view" />`

The index.json `settings.layout` field becomes meaningless — all chat-enabled views use the 5-column layout. Delete the field from index.json files OR leave it and ignore it (executor's choice; cleaner to delete since it's the last meaningful remnant of the 3-string switch).

---

**After this phase:**
- Every chat-enabled panel renders five columns: `[LeftSidebar(project)][LeftChat(project)][ContentArea][RightChat(view)][RightSidebar(view)]`
- Both sidebars visible at all times (slider hide/show comes in 26c-2)
- Both chat areas visible at all times; ONE is active (has the live wire), the OTHER shows its thread's history with a disabled input
- Clicking "New Thread" in either sidebar sends `thread:open-assistant` with the matching scope and opens a new thread on that side
- Clicking a thread in either sidebar opens that thread on that side, becoming the new active scope (and killing the old wire, per the single-wire model from 26b)
- Project threads persist across panel switches; view threads swap with the panel
- SQLite rows and filesystem paths stay correctly scoped (verified in 26b)
- Smoke test passes 49/0 (or whatever 26b landed at)

**You are not touching:**
- Server code — all server changes for the dual-chat paradigm were done in 26a and 26b
- Dual-wire support — 26d
- Slider hide/show state persistence — 26c-2
- Chat header component — 26d
- Harness wizard per side — 26d
- The `layout.json` fields (`threadListVisible`, `chatWidth`, etc.) — 26c-2 will use them for default hide/show state; leave them untouched for now
- `lib/views/resolveChatConfig` on the server — its `chatType` / `chatPosition` return fields are still per-view UI settings; unchanged
- Any CSS architecture migration — separate future spec
- The agents-viewer area (saved feedback: don't audit)

---

## Context before you touch code

Read these in order:

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules.
2. **`ai/views/capture-viewer/content/todo/specs/26a-dual-chat-data-model.md`** — what 26a delivered.
3. **`ai/views/capture-viewer/content/todo/specs/26b-dual-chat-routing-layer.md`** — what 26b delivered, especially the wire protocol scope field.
4. **`open-robin-client/src/state/panelStore.ts`** (all ~340 lines) — the largest single edit.
5. **`open-robin-client/src/lib/ws/thread-handlers.ts`** (all ~160 lines) — scope-aware response routing.
6. **`open-robin-client/src/components/Sidebar.tsx`** (all ~385 lines) — parameterize by scope.
7. **`open-robin-client/src/components/ChatArea.tsx`** — parameterize by scope, active/inactive branching.
8. **`open-robin-client/src/components/App.tsx`** (focus on PanelContent at L19-38) — 5-column layout.
9. **`open-robin-client/src/types/index.ts`** — add `Scope` type, update `AppState` shape references.
10. **`open-robin-client/src/components/ChatInput.tsx`** and any place `sendMessage` is called — make sure prompt messages carry scope.

### Line-number drift verification

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-client
wc -l \
  src/state/panelStore.ts \
  src/lib/ws/thread-handlers.ts \
  src/components/Sidebar.tsx \
  src/components/ChatArea.tsx \
  src/components/App.tsx \
  src/components/ChatInput.tsx \
  src/types/index.ts
```

### Pre-flight — find every `threads` / `currentThreadId` reference in the client

```bash
grep -rn "\.threads\b\|currentThreadId\b\|setThreads\b\|addThread\b\|removeThread\b\|updateThread\b" src
```

Expected: 30-50 hits across panelStore, thread-handlers, Sidebar, ChatArea, possibly hooks. Every hit needs scope-awareness.

### Pre-prod wipe

```bash
pkill -9 -f "node.*server.js" 2>/dev/null; sleep 1
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "PRAGMA foreign_keys=ON; DELETE FROM threads;"
find /Users/rccurtrightjr./projects/open-robin/ai/views/chat/threads -type f -name '*.md' -delete 2>/dev/null
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' -delete 2>/dev/null

# Verify clean
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT COUNT(*) FROM threads;"
```

Note the `PRAGMA foreign_keys=ON;` prefix. CLI sessions need it explicitly or cascade won't fire.

---

## Changes — file by file

### 1. `open-robin-client/src/types/index.ts`

**1a. Add the `Scope` type.**

```ts
export type Scope = 'project' | 'view';
```

Put it near the other thread-related types (around L140).

**1b. Update `ThreadEntry` and `Thread` if needed.**

`ThreadEntry.name: string | null` was updated in 24e. The server now also returns `scope` and `viewId` on entries (added in 26a). Extend `ThreadEntry`:

```ts
export interface ThreadEntry {
  name: string | null;
  createdAt: string;
  resumedAt?: string;
  messageCount: number;
  status: 'active' | 'suspended';
  harnessId?: string;
  scope?: Scope;        // NEW — returned by server since 26a
  viewId?: string | null; // NEW — returned by server since 26a
}
```

`Thread` stays `{ threadId: string; entry: ThreadEntry }`.

---

### 2. `open-robin-client/src/state/panelStore.ts`

This is the biggest edit. The state shape changes materially.

**2a. Update the imports and add the scope type.**

```ts
import type {
  PanelState,
  Message,
  AssistantTurn,
  StreamSegment,
  Thread,
  Scope,  // NEW
} from '../types';
```

**2b. Replace the Thread management slice.**

Current:
```ts
// Thread management
threads: Thread[];
currentThreadId: string | null;
wireReady: boolean;
setThreads: (threads: Thread[]) => void;
setCurrentThreadId: (threadId: string | null) => void;
setWireReady: (ready: boolean) => void;
addThread: (thread: Thread) => void;
updateThread: (threadId: string, updates: Partial<Thread['entry']>) => void;
removeThread: (threadId: string) => void;
```

New:
```ts
// Thread management — SPEC-26c: dual-scope
threads: { project: Thread[]; view: Thread[] };
currentThreadIds: { project: string | null; view: string | null };
currentScope: Scope | null;  // which scope has the live wire
wireReady: boolean;

setThreads: (scope: Scope, threads: Thread[]) => void;
setCurrentThreadId: (scope: Scope, threadId: string | null) => void;
setCurrentScope: (scope: Scope | null) => void;
setWireReady: (ready: boolean) => void;
addThread: (scope: Scope, thread: Thread) => void;
updateThread: (scope: Scope, threadId: string, updates: Partial<Thread['entry']>) => void;
removeThread: (scope: Scope, threadId: string) => void;
```

**2c. Add top-level `projectChat` state alongside per-panel view chat state.**

```ts
// Per-panel states hold VIEW-scoped chat state.
// (Each view has its own view chat; the current panel's view chat lives
// at panels[state.currentPanel].)
panels: Record<string, PanelState>;

// Project-scoped chat state is top-level because the project chat follows
// the user across panel switches. SPEC-26c.
projectChat: PanelState;
```

Initialize `projectChat: createInitialPanelState()` in the store's initial state block.

**2d. Action signatures gain a scope arg.**

Current:
```ts
addMessage: (panel: string, message: Message) => void;
setCurrentTurn: (panel: string, turn: AssistantTurn | null) => void;
updateTurnContent: (panel: string, content: string) => void;
appendSegment: (panel: string, segType: StreamSegment['type'], text: string) => void;
pushSegment: (panel: string, segment: StreamSegment) => void;
updateLastSegment: (panel: string, updates: Partial<StreamSegment>) => void;
updateSegmentByToolCallId: (panel: string, toolCallId: string, updates: Partial<StreamSegment>) => void;
appendSegmentContentByIndex: (panel: string, index: number, text: string) => void;
resetSegments: (panel: string) => void;
setPendingTurnEnd: (panel: string, pending: boolean) => void;
setPendingMessage: (panel: string, message: Message | null) => void;
finalizeTurn: (panel: string) => void;
clearPanel: (panel: string) => void;
```

New — replace `panel: string` with `scope: Scope`:
```ts
addMessage: (scope: Scope, message: Message) => void;
setCurrentTurn: (scope: Scope, turn: AssistantTurn | null) => void;
updateTurnContent: (scope: Scope, content: string) => void;
appendSegment: (scope: Scope, segType: StreamSegment['type'], text: string) => void;
pushSegment: (scope: Scope, segment: StreamSegment) => void;
updateLastSegment: (scope: Scope, updates: Partial<StreamSegment>) => void;
updateSegmentByToolCallId: (scope: Scope, toolCallId: string, updates: Partial<StreamSegment>) => void;
appendSegmentContentByIndex: (scope: Scope, index: number, text: string) => void;
resetSegments: (scope: Scope) => void;
setPendingTurnEnd: (scope: Scope, pending: boolean) => void;
setPendingMessage: (scope: Scope, message: Message | null) => void;
finalizeTurn: (scope: Scope) => void;
clearChat: (scope: Scope) => void;  // renamed from clearPanel
```

**2e. Internal helper: resolve chat state by scope.**

Replace the existing `getPs` (panel-state) helper with a scope-aware variant:

```ts
/**
 * Resolve the chat state slot for a given scope.
 * - 'project' → top-level state.projectChat
 * - 'view'    → state.panels[state.currentPanel] (auto-init if missing)
 */
function getChatState(state: AppState, scope: Scope): PanelState {
  if (scope === 'project') return state.projectChat;
  return state.panels[state.currentPanel] || createInitialPanelState();
}
```

Action implementations use `getChatState` to read and return the right slot in their set() call:

```ts
addMessage: (scope, message) => set((state) => {
  const cs = getChatState(state, scope);
  const updated = { ...cs, messages: [...cs.messages, message] };
  if (scope === 'project') {
    return { projectChat: updated };
  }
  return {
    panels: { ...state.panels, [state.currentPanel]: updated },
  };
}),
```

Every message-state action follows this pattern. Tedious but mechanical.

**2f. Thread actions use scope to select the list.**

```ts
setThreads: (scope, threads) => set((state) => ({
  threads: { ...state.threads, [scope]: threads },
})),

addThread: (scope, thread) => set((state) => ({
  threads: {
    ...state.threads,
    [scope]: [thread, ...state.threads[scope]],
  },
})),

updateThread: (scope, threadId, updates) => set((state) => ({
  threads: {
    ...state.threads,
    [scope]: state.threads[scope].map(t =>
      t.threadId === threadId ? { ...t, entry: { ...t.entry, ...updates } } : t
    ),
  },
})),

removeThread: (scope, threadId) => set((state) => ({
  threads: {
    ...state.threads,
    [scope]: state.threads[scope].filter(t => t.threadId !== threadId),
  },
  currentThreadIds: {
    ...state.currentThreadIds,
    [scope]: state.currentThreadIds[scope] === threadId ? null : state.currentThreadIds[scope],
  },
})),

setCurrentThreadId: (scope, threadId) => set((state) => ({
  currentThreadIds: { ...state.currentThreadIds, [scope]: threadId },
})),

setCurrentScope: (scope) => set({ currentScope: scope }),
```

**2g. Update `sendMessage` to take scope.**

Current:
```ts
sendMessage: (text: string, panel?: string) => void;
```

New:
```ts
sendMessage: (text: string, scope: Scope) => void;
```

Implementation sends a `prompt` message with the scope field and the matching thread ID:

```ts
sendMessage: (text, scope) => {
  const state = get();
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const threadId = state.currentThreadIds[scope];
  if (!threadId) {
    console.error(`[Store] sendMessage: no active thread in scope=${scope}`);
    return;
  }
  ws.send(JSON.stringify({
    type: 'prompt',
    scope,
    threadId,
    user_input: text,
  }));
},
```

**2h. Initial state values.**

Replace the current initial-state block around L99-107:

```ts
currentPanel: 'code-viewer',
panels: {},
projectChat: createInitialPanelState(),  // SPEC-26c
ws: null,
projectRoot: null,
contextUsage: 0,
threads: { project: [], view: [] },
currentThreadIds: { project: null, view: null },
currentScope: null,
wireReady: false,
```

**2i. `setCurrentPanel` implementation.**

When switching panels, the view chat state resets to whatever the new panel has in its slot (or auto-init). The project chat is untouched. Current thread IDs:
- `currentThreadIds.project` persists across switches
- `currentThreadIds.view` resets to null (new panel has no active view thread until the user opens one)
- `currentScope` — tricky. If the user had a view thread active and switches panels, the wire gets killed (server does this in setPanel). The new panel has no active thread. So currentScope should reset to null on panel switch.

```ts
setCurrentPanel: (id) => {
  const state = get();
  if (!state.panels[id]) {
    set({
      currentPanel: id,
      panels: { ...state.panels, [id]: createInitialPanelState() },
      currentThreadIds: { ...state.currentThreadIds, view: null },
      currentScope: null,
    });
  } else {
    set({
      currentPanel: id,
      currentThreadIds: { ...state.currentThreadIds, view: null },
      currentScope: null,
    });
  }
  const ws = state.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_panel', panel: id }));
  }
},
```

---

### 3. `open-robin-client/src/lib/ws/thread-handlers.ts`

Every case in `handleThreadMessage` reads `msg.scope` and routes to the right store slot.

**3a. Update the imports and helper signature.**

```ts
import type { WebSocketMessage, ExchangeData, AssistantPart, StreamSegment, Scope } from '../../types';
```

**3b. Scope helper at the top of `handleThreadMessage`.**

```ts
export function handleThreadMessage(msg: WebSocketMessage): boolean {
  const store = usePanelStore.getState();
  // SPEC-26c: every thread:* response carries scope since 26b. Default 'view'
  // for any older messages that slip through without scope.
  const scope: Scope = (msg as any).scope === 'project' ? 'project' : 'view';

  switch (msg.type) {
    // ... cases below ...
  }
}
```

**3c. Rewrite each case to be scope-aware.**

```ts
case 'thread:list':
  if (msg.threads) {
    store.setThreads(scope, msg.threads);
  }
  return true;

case 'thread:created':
  if (msg.thread && msg.threadId) {
    store.addThread(scope, { threadId: msg.threadId, entry: msg.thread });
    store.setCurrentThreadId(scope, msg.threadId);
    store.setCurrentScope(scope);
    store.clearChat(scope);
    // Optional: loadRootTree() for code-viewer only — leave as-is for compat.
  }
  return true;

case 'thread:opened':
  if (msg.threadId && msg.thread) {
    store.setCurrentThreadId(scope, msg.threadId);
    store.setCurrentScope(scope);
    store.clearChat(scope);

    if (msg.exchanges && msg.exchanges.length > 0) {
      convertExchangesToMessages(scope, msg.exchanges);
    } else if (msg.history && msg.history.length > 0) {
      convertHistoryToMessages(scope, msg.history);
    }

    if (msg.contextUsage !== undefined && msg.contextUsage !== null) {
      store.setContextUsage(msg.contextUsage);
    }
  }
  return true;

case 'wire_ready':
  // wire_ready echoes scope in 26b; use it to set currentScope.
  store.setCurrentScope(scope);
  store.setWireReady(true);
  return true;

case 'thread:renamed':
  if (msg.threadId && msg.name) {
    store.updateThread(scope, msg.threadId, { name: msg.name });
  }
  return true;

case 'thread:deleted':
  if (msg.threadId) {
    store.removeThread(scope, msg.threadId);
  }
  return true;
```

**3d. Update the `convertExchangesToMessages` and `convertHistoryToMessages` helpers to take scope instead of panel.**

```ts
function convertExchangesToMessages(scope: Scope, exchanges: ExchangeData[]) {
  const store = usePanelStore.getState();
  exchanges.forEach((exchange, idx) => {
    store.addMessage(scope, { /* ... */ });
    // ... same conversion logic, just uses scope instead of panel
  });
}

function convertHistoryToMessages(scope: Scope, history: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const store = usePanelStore.getState();
  history.forEach((h, idx) => {
    store.addMessage(scope, { /* ... */ });
  });
}
```

**3e. Delete the old `const panel = store.currentPanel` assignment and the `targetPanel === panel` guard.**

The old guard (from the 24a era when we had `thread:open-daily` cross-panel pollution) is obsolete. The scope field is now the disambiguator. Remove it along with any `targetPanel` variables.

---

### 4. `open-robin-client/src/components/Sidebar.tsx`

Parameterize by scope. Read from the right store slot. Send scope with every outbound thread:* message.

**4a. Add `scope` prop to the component signature.**

```tsx
interface SidebarProps {
  panel: string;
  scope: Scope;  // NEW
}

export function Sidebar({ panel, scope }: SidebarProps) {
  // ...
}
```

**4b. Read thread state from the scope-keyed slots.**

Current (illustrative):
```tsx
const threads = usePanelStore((s) => s.threads);
const currentThreadId = usePanelStore((s) => s.currentThreadId);
```

New:
```tsx
const threads = usePanelStore((s) => s.threads[scope]);
const currentThreadId = usePanelStore((s) => s.currentThreadIds[scope]);
const currentScope = usePanelStore((s) => s.currentScope);
```

Use `currentScope === scope` to style the sidebar as "active" if desired (e.g., a subtle border color). Not required for 26c but nice touch.

**4c. Every outbound thread:* message includes the scope field.**

- The "new thread" button sends `{ type: 'thread:open-assistant', scope, harnessId }` (already handled via the harness picker, but the picker needs the scope too — see 4d)
- `handleOpenThread(threadId)` → `sendMessage({ type: 'thread:open-assistant', scope, threadId })`
- `handleRenameSubmit(threadId)` → `sendMessage({ type: 'thread:rename', scope, threadId, name })`
- `handleDeleteThread(threadId)` → `sendMessage({ type: 'thread:delete', scope, threadId })`
- `handleCopyLink(threadId)` → `sendMessage({ type: 'thread:copyLink', scope, threadId })`

**4d. Thread-list request on mount.**

The useEffect at L147-151:
```tsx
useEffect(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'thread:list' }));
  }
}, [ws, panel]);
```

Becomes:
```tsx
useEffect(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'thread:list', scope }));
  }
}, [ws, panel, scope]);
```

**4e. The header title.**

Sidebar currently shows `{config?.name || panel}` at the top. Make it clearer which scope the sidebar represents:

- Project sidebar: header text like `"Project"` or `"Project Chat"` (short, clean)
- View sidebar: header text like the view name — `{config?.name || panel}`

Trivial branching:
```tsx
<div className="sidebar-header">
  {scope === 'project' ? 'Project' : (config?.name || panel)}
</div>
```

**4f. Leave `thread:link` copy-link response handler unchanged.**

The `useEffect` at L144-181 (post-24f shape) handling `thread:link` stays the same. It doesn't need scope awareness — `thread:link` is a narrow copy-to-clipboard response.

---

### 5. `open-robin-client/src/components/ChatArea.tsx`

Parameterize by scope. Read messages from the scope-keyed state. Gate input on active/inactive.

**5a. Add `scope` prop.**

```tsx
interface ChatAreaProps {
  panel: string;
  scope: Scope;  // NEW
}

export function ChatArea({ panel, scope }: ChatAreaProps) {
  // ...
}
```

**5b. Read chat state from the scope-appropriate slot.**

Currently reads `panels[panel]` or similar. New: reads from scope-aware selectors:

```tsx
const messages = usePanelStore((s) =>
  scope === 'project' ? s.projectChat.messages : (s.panels[panel]?.messages || [])
);
const segments = usePanelStore((s) =>
  scope === 'project' ? s.projectChat.segments : (s.panels[panel]?.segments || [])
);
// ... etc for currentTurn, pendingMessage, pendingTurnEnd, lastReleasedSegmentCount
const currentScope = usePanelStore((s) => s.currentScope);
const currentThreadId = usePanelStore((s) => s.currentThreadIds[scope]);
const wireReady = usePanelStore((s) => s.wireReady);
```

Consider extracting a `useScopedChatState(scope)` hook to avoid the selector duplication across scopes.

**5c. Active/inactive branching.**

```tsx
const isActive = currentScope === scope && wireReady;

// If there's no thread in this scope, show the harness picker (existing behavior)
const noThread = !currentThreadId;

if (noThread) {
  return <ChatHarnessPicker scope={scope} ... />;  // see below
}

return (
  <div className={`chat-area ${isActive ? 'chat-area--active' : 'chat-area--inactive'}`}>
    <MessageList messages={messages} />
    {/* current turn, segments, etc. — same as today */}
    <ChatInput
      scope={scope}
      disabled={!isActive}
      placeholder={isActive ? 'Send a message...' : 'Click a thread to activate this chat'}
    />
  </div>
);
```

The `.chat-area--inactive` CSS class is new — styling is out of scope for 26c (use a simple dim or border change; SPEC-27 or a future CSS pass can refine).

**5d. `ChatHarnessPicker` gets a scope prop.**

The picker is what appears when no thread is open. Its "pick this harness" callback sends `thread:open-assistant` — now with scope. Find the callsite and add scope to the message:

```tsx
const handleHarnessSelect = useCallback((harnessId: string) => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'thread:open-assistant', scope, harnessId }));
  }
}, [ws, scope]);
```

**5e. Delete the old `panel`-keyed access patterns.**

The file probably has a lot of `panels[panel].x` reads. Every one of those needs to become `scope === 'project' ? s.projectChat.x : s.panels[panel].x` via the helper pattern above.

---

### 6. `open-robin-client/src/components/ChatInput.tsx`

**6a. Accept `scope` and pass it to sendMessage.**

```tsx
interface ChatInputProps {
  panel: string;
  scope: Scope;  // NEW
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ panel, scope, disabled, placeholder }: ChatInputProps) {
  const sendMessage = usePanelStore((s) => s.sendMessage);
  // ...
  
  const handleSend = () => {
    if (disabled) return;
    if (!input.trim()) return;
    sendMessage(input, scope);  // SPEC-26c: store.sendMessage now takes scope
    setInput('');
  };
  
  return (
    <textarea
      disabled={disabled}
      placeholder={placeholder || 'Send a message...'}
      // ...
    />
  );
}
```

---

### 7. `open-robin-client/src/components/App.tsx`

Replace the 3-string layout switch with the 5-column binary.

**7a. Rewrite `PanelContent`.**

Current:
```tsx
const PanelContent = memo(function PanelContent({ panel, layout }: { panel: string; layout: string }) {
  if (layout === 'full') {
    return <ContentArea panel={panel} />;
  }
  if (layout === 'chat-content') {
    return (
      <>
        <ChatArea panel={panel} />
        <ContentArea panel={panel} />
      </>
    );
  }
  return (
    <>
      <Sidebar panel={panel} />
      <ChatArea panel={panel} />
      <ContentArea panel={panel} />
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
  // SPEC-26c: dual-chat layout. Left = project, right = view.
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

**7b. Update the PanelContent call site.**

Current:
```tsx
const layout = config.layout || (config.hasChat ? 'sidebar-chat-content' : 'full');
return (
  <div
    key={config.id}
    data-panel={config.id}
    className={`rv-panel rv-layout-${layout} ${currentPanel === config.id ? 'active' : ''}`}
  >
    <PanelContent panel={config.id} layout={layout} />
  </div>
);
```

New:
```tsx
const hasChat = !!config.hasChat;
return (
  <div
    key={config.id}
    data-panel={config.id}
    className={`rv-panel ${hasChat ? 'rv-layout-dual-chat' : 'rv-layout-full'} ${currentPanel === config.id ? 'active' : ''}`}
  >
    <PanelContent panel={config.id} hasChat={hasChat} />
  </div>
);
```

The `rv-layout-dual-chat` class is new — needed by CSS to lay out five columns. CSS edit is in step 8.

---

### 8. CSS — `ai/views/settings/styles/views.css`

The existing CSS has classes for `.sidebar`, `.chat-area`, and layout variants. Add a grid layout for the dual-chat mode.

**8a. Add or update the panel container grid.**

Find the existing `.rv-layout-sidebar-chat-content` (or equivalent) rule and add a new sibling:

```css
.rv-layout-dual-chat {
  display: grid;
  grid-template-columns: 220px 320px 1fr 320px 220px;
  /* adjust widths to taste — these match the existing sidebar/chat widths */
  grid-template-rows: 1fr;
  height: 100%;
}

.rv-layout-full {
  display: block;
  height: 100%;
}
```

**8b. Add an inactive-chat dim (minimal).**

```css
.chat-area--inactive {
  opacity: 0.6;
  /* optional: pointer-events: none on the input area only */
}

.chat-area--inactive .chat-composer {
  /* disabled input styling */
}
```

Keep it minimal. Polish can come later. The goal is: "the user can tell which chat is active."

**8c. Delete or leave the old layout CSS classes.**

`.rv-layout-sidebar-chat-content`, `.rv-layout-chat-content`, `.rv-layout-full` (pre-existing) — after this spec, only `.rv-layout-dual-chat` and `.rv-layout-full` (new) are referenced from the App.tsx className. The old classes are unused and can be removed, OR left as dead code for a future CSS cleanup spec.

Your call — I lean toward deleting them for cleanliness, but it's not load-bearing.

---

### 9. index.json `settings.layout` cleanup

Every chat-enabled view's `index.json` currently has `settings.layout: "sidebar-chat-content"` (flipped by 24f). In 26c, the string is meaningless — the layout is driven by `hasChat` only.

**9a. Delete the `settings.layout` field from every view's `index.json`.**

Find them:
```bash
grep -l '"layout"' /Users/rccurtrightjr./projects/open-robin/ai/views/*/index.json
```

Remove the `"layout": "sidebar-chat-content"` line from each. Leave other `settings` fields intact.

**9b. Update `lib/panels.ts` on the client — remove the fallback branch.**

The current file has:
```ts
layout: json.settings?.layout || (hasChat ? 'sidebar-chat-content' : 'full') as PanelLayout,
```

Delete that field from the returned PanelConfig entirely. `config.layout` is no longer consumed by App.tsx.

If `PanelConfig.layout` is typed somewhere, remove it from the type too.

---

## Test plan

### Static checks

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-client

# Typecheck — catches any missed scope arg additions, wrong selector shapes
npx tsc --noEmit

# Build
npm run build
```

Both should pass cleanly. TypeScript catches most of the shape change issues.

### Pre-prod wipe

Do the wipe from the pre-flight section above. SQLite empty, both filesystem locations empty.

### Server restart

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-server
pkill -9 -f "node.*server.js" 2>/dev/null; sleep 1
node server.js > /tmp/26c-boot.log 2>&1 &
sleep 4
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/
```

### Live validation — this is the big one

Hard-refresh the browser (`Cmd+Shift+R`). You should see a visible layout change on any chat-enabled view.

**Walk through this checklist:**

1. **Code-viewer loads with 5 columns visible.** Left sidebar (labeled "Project" or similar), left chat pane, content (file tree), right chat pane, right sidebar (labeled "code-viewer" or similar).

2. **Both sidebars show empty thread lists** (post-wipe).

3. **Create a project thread.** Click "New Thread" in the LEFT sidebar. Pick a harness. Send a message.
   - Left chat should become active (border or dim indicator changes)
   - Right chat remains inactive (dimmed, input disabled)
   - SQLite: `SELECT thread_id, project_id, scope, view_id FROM threads;` should show the new row with `scope=project`, `view_id=NULL`
   - Filesystem: file lands at `ai/views/chat/threads/<user>/<id>.md`

4. **Create a view thread.** Click "New Thread" in the RIGHT sidebar. Pick a harness. Send a message.
   - Right chat becomes active
   - Left chat becomes inactive
   - SQLite shows second row with `scope=view`, `view_id=code-viewer`
   - Filesystem: file lands at `ai/views/code-viewer/chat/threads/<user>/<id>.md`

5. **Switch to issues-viewer.**
   - Right sidebar switches to issues-viewer's thread list (should be empty — no view threads for that panel yet)
   - Left sidebar still shows the project thread (project scope persists)
   - Right chat area is inactive (no view thread open)

6. **Create a view thread on issues-viewer.** Verify it lands with `view_id=issues-viewer`.

7. **Switch back to code-viewer.** Verify:
   - Right sidebar shows the code-viewer view thread (NOT the issues-viewer view thread)
   - Left sidebar still shows the project thread
   - Both scopes retain their state correctly

8. **Click an existing thread in either sidebar.** Verify it opens in that side's chat pane and becomes active.

9. **Rename a thread** via either sidebar's menu. Verify the update propagates to the right list (not the other scope's list).

10. **Delete a thread.** Verify:
    - The correct row disappears from SQLite
    - The correct sidebar updates
    - The other scope's list is unaffected
    - If deleting the active thread, the chat area becomes empty/shows harness picker

11. **Browser console check.** No red errors. Specifically:
    - No `TypeError: Cannot read properties of undefined` related to threads, currentThreadId, or scope
    - No missed scope arg warnings

12. **Network tab WS frames.** Every outbound `thread:*` and `prompt` message should include `"scope": "project"` or `"scope": "view"`. Every incoming `thread:*` response should echo the scope.

### Post-validation SQLite audit

```bash
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db \
  "SELECT thread_id, project_id, scope, view_id, name, message_count FROM threads ORDER BY scope, updated_at DESC;"
```

Expected: rows correctly scoped by `scope` and `view_id`.

### Post-validation filesystem audit

```bash
echo "=== project threads ==="
find /Users/rccurtrightjr./projects/open-robin/ai/views/chat/threads -type f -name '*.md'
echo "=== view threads ==="
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' 2>/dev/null | grep -v '^/Users/rccurtrightjr./projects/open-robin/ai/views/chat/'
```

Each file should appear in exactly one of the two categories based on its scope.

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| Blank screen on chat-enabled view | App.tsx PanelContent branch missing or throwing | Check the dual-chat render path |
| One sidebar shows the other scope's threads | Sidebar reads `threads[scope]` with wrong scope prop | Check the App.tsx call sites pass `scope="project"` / `scope="view"` correctly |
| Both chat areas show the same messages | ChatArea selector is not scope-aware | Fix the selectors in step 5b |
| Typing in the left input sends to the right chat | ChatInput's scope prop is wrong OR sendMessage doesn't use the right threadId | Check `store.sendMessage(text, scope)` resolves the threadId from `currentThreadIds[scope]` |
| Project sidebar empties when switching panels | `setCurrentPanel` is clearing `currentThreadIds.project` by mistake | Only reset `.view`, never `.project` |
| Active indicator never changes | `currentScope` state isn't being set by `thread:opened` / `thread:created` / `wire_ready` handlers | Check step 3c — every opening message calls `setCurrentScope(scope)` |
| Console error: `Cannot read property 'messages' of undefined` | A message-state action tried to read `panels[currentPanel]` but currentPanel wasn't initialized | Verify `getChatState` auto-inits or guards with `|| createInitialPanelState()` |
| Server error: "No panel set" when opening a thread | `set_panel` wasn't sent before the first `thread:*` request | Check the WebSocket connection flow — `set_panel` should fire on mount and panel switch |
| TypeScript build fails with "'panel' is possibly undefined" or similar | Missed a removed-panel-arg callsite | Run `npx tsc --noEmit` and chase every error |

---

## Do not do

- **Do not** touch any server file. All server-side changes landed in 26a and 26b.
- **Do not** implement slider hide/show for the chat columns. 26c-2 handles persistence.
- **Do not** add a chat header component. 26d territory.
- **Do not** implement dual-wire support. The awkward "one chat is inactive" state is expected in 26c.
- **Do not** try to make `currentScope` infer from the user's last click — it must come from the server's `wire_ready` / `thread:opened` / `thread:created` responses. The server is the source of truth for which scope has the wire.
- **Do not** change the wire protocol. Scope field additions were done in 26b. 26c only reads/sends existing fields.
- **Do not** remove `panels: Record<string, PanelState>` — it still holds view-scoped per-panel chat state. Only the globally-flat `threads: Thread[]` goes away.
- **Do not** add harness wizard or custom config screens. 26d.
- **Do not** touch `lib/panels.ts` beyond removing the `layout` field handling — its other responsibilities stay intact.
- **Do not** modify `layout.json` files in the view folders. 26c-2 will use them for default hide/show defaults.
- **Do not** add animations or transitions for the column changes. CSS polish is future work.
- **Do not** touch `thread-crud.js`, `thread-messages.js`, `client-message-router.js`, `ThreadWebSocketHandler.js`, or any server file — they were fully updated in 26b.
- **Do not** rename `Sidebar.tsx` or `ChatArea.tsx` to something plural. Same components, just parameterized.

---

## Commit message template

```
SPEC-26c: dual-chat client layout + state split

First user-visible change in the 26 series. Delivers the 5-column
dual-chat layout backed by 26b's server-side routing. Every chat-
enabled view now renders:

  [Sidebar(project)] [ChatArea(project)] [ContentArea] [ChatArea(view)] [Sidebar(view)]

State shape (panelStore.ts):
  - threads: Thread[]                      → { project: Thread[], view: Thread[] }
  - currentThreadId: string|null           → currentThreadIds: { project, view }
  - NEW: currentScope: Scope|null          (which side has the live wire)
  - NEW: projectChat: PanelState           (top-level, follows user across panels)
  - panels[panelId]: PanelState            (unchanged — holds view-scoped chat state)
  - Every message-state action gains a scope arg (addMessage, appendSegment,
    setCurrentTurn, etc.). An internal getChatState(state, scope) helper
    resolves to projectChat or panels[currentPanel].
  - Every thread action gains a scope arg (addThread, removeThread,
    updateThread, setCurrentThreadId, setThreads).
  - sendMessage takes (text, scope) instead of (text, panel?) and sends
    `prompt` with scope + threadId fields.

WebSocket handlers (thread-handlers.ts):
  - Extract scope from msg.scope (with 'view' default for backward compat).
  - Route thread:list, thread:created, thread:opened, thread:renamed,
    thread:deleted to the scope-keyed store slots.
  - wire_ready sets currentScope to the response's scope (server is the
    source of truth for which wire is live).
  - Old targetPanel cross-panel-pollution guard removed — scope field
    is the disambiguator now.

Components:
  - Sidebar.tsx: takes `scope` prop. Reads threads[scope] and
    currentThreadIds[scope]. Sends thread:* messages with scope.
    Header label is scope-aware ("Project" vs the view name).
  - ChatArea.tsx: takes `scope` prop. Reads chat state via scope-aware
    selectors. Active iff currentScope === scope; inactive otherwise
    with disabled input and "click a thread to activate" hint.
  - ChatInput.tsx: takes `scope` prop, passes to sendMessage.
  - ChatHarnessPicker: takes scope prop, sends thread:open-assistant
    with the correct scope when a harness is picked.

Layout (App.tsx):
  - Three-string layout switch ('full' / 'chat-content' /
    'sidebar-chat-content') removed entirely.
  - PanelContent now branches on hasChat boolean: no chat → ContentArea
    only; chat → the 5-column dual layout.
  - rv-layout-dual-chat CSS grid class defined in views.css with
    220px / 320px / 1fr / 320px / 220px columns.
  - .chat-area--inactive dim for the non-active chat column.

Cleanup:
  - Deleted `settings.layout` field from every chat-enabled view's
    index.json (now unused post 26c).
  - Deleted the `layout` fallback branch in lib/panels.ts and the
    corresponding field in PanelConfig.

Live-validated across code-viewer, issues-viewer, wiki-viewer:
  - 5 columns render on every chat-enabled view
  - Project sidebar persists across panel switches; view sidebar swaps
  - Creating a project thread → SQLite scope=project, view_id=NULL,
    file at ai/views/chat/threads/<user>/<id>.md
  - Creating a view thread → SQLite scope=view, view_id=<panel>,
    file at ai/views/<view>/chat/threads/<user>/<id>.md
  - Active/inactive chat indicator follows currentScope
  - Rename/delete/copy-link all route correctly by scope
  - Zero browser console errors
  - Smoke test 49/0

Single-wire limitation: one wire at a time per WS connection.
Switching between project and view chats kills and respawns the wire.
The inactive chat shows history but the input is disabled with an
"activate to chat" hint. Real dual-wire support (both chats live
simultaneously) is deferred to 26d.

Part of SPEC-26 (dual-chat paradigm). 26c-2 will add slider
persistence; 26d will add dual-wire support + chat header per side
+ harness wizard per side.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main`. Expected: panelStore.ts heavily changed (100+ net), thread-handlers.ts medium (~40 net), Sidebar.tsx medium (~40), ChatArea.tsx medium-to-large (~60), ChatInput.tsx small (~10), App.tsx small (~20), types/index.ts small (~10), views.css small-to-medium (~30), 5+ index.json files (one line removed each), panels.ts small (~5).

2. **Typecheck output.** `npx tsc --noEmit` must pass clean.

3. **Build output.** `npm run build` must succeed with the new bundle hash.

4. **Server restart confirmation.** HTTP 200, trigger/filter loading unchanged.

5. **Live validation walkthrough.** Run all 12 checklist items in the "Live validation — this is the big one" section. For each, report:
   - What you saw
   - Any deviations from expected
   - Whether the browser console stayed clean

6. **SQLite audit after live activity.** Paste the `SELECT thread_id, project_id, scope, view_id, ...` output after creating threads in both scopes across multiple panels.

7. **Filesystem audit after live activity.** Show both find outputs.

8. **WebSocket frame inspection.** Paste 2-3 sample outbound frames from the browser's WS inspector showing the `scope` field is included on `thread:*` and `prompt` messages.

9. **Surprises.** Unexpected selector patterns, state shape issues, hooks that needed updating, anything that took more than a one-line fix.

10. **Files touched outside the change list.** Expected: zero. If any, explain.

11. **26c-2 signals.** Things you noticed that will need addressing in 26c-2 (slider persistence):
    - Where is the obvious home for per-view slider state in the store?
    - Does the layout CSS need preemptive prep for collapsible columns?
    - Any local JSON patterns already used in the project you spotted that would serve as the storage mechanism?

12. **26d signals.** Things you noticed that 26d will need to address (dual wire + chat header):
    - Where is the most obvious place to lift the "inactive" hint into a proper chat header component?
    - Does `session.currentScope` tracking feel like it'll scale to two concurrent wires?
    - Any wire-path code paths that assume single-wire that are going to need refactoring?

Hand the report back to the orchestrator before moving to any other 26x phase.
