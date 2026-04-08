# SPEC: Modularity Refactor — Client State & WebSocket Architecture

**Status:** Draft  
**Created:** 2026-04-04  
**Author:** Kimi Code CLI  
**Scope:** kimi-ide-client state management and WebSocket handling

---

## 1. Problem Statement

The client codebase has accumulated "god modules" that handle multiple unrelated concerns:

| Module | Lines | Concerns Mixed |
|--------|-------|----------------|
| `panelStore.ts` | ~350 | Panel configs, messages/turns/segments, threads, WebSocket, context usage |
| `ws-client.ts` | 532 | Connection mgmt, 32 message handlers, routing, history conversion, Robin listeners |
| `Sidebar.tsx` | 393 | FLIP animations, thread CRUD, WebSocket I/O, modals, UI rendering |
| `LiveSegmentRenderer.tsx` | 417 | Orb phase, segment orchestration, completion detection |
| `catalog-visual.ts` | 492 | 20+ segment definitions in single file |

This creates:
- **High cognitive load** — developers must understand unrelated domains to modify code
- **Merge conflicts** — multiple features touch the same files
- **Testing friction** — can't test handlers without WebSocket infrastructure
- **Refactoring risk** — changes ripple unpredictably

---

## 2. Goals

1. **Single Responsibility** — each module has one reason to change
2. **Testability** — handlers are pure functions, testable without WebSocket
3. **Discoverability** — file structure reveals architecture
4. **Incremental migration** — no big-bang rewrite

---

## 3. Proposed Architecture

### 3.1 State Store Split

**Current:** Monolithic `panelStore.ts`

```
src/state/
├── panelStore.ts          # ❌ 350 lines, 6 concerns
```

**Proposed:** 4 focused stores

```
src/state/
├── panelConfigStore.ts    # Panel discovery, configs, theming
├── messageStore.ts        # Messages, turns, segments per panel
├── threadStore.ts         # Thread list, CRUD operations
└── connectionStore.ts     # WebSocket ref, connection status, context usage
```

#### Store Responsibilities

| Store | State | Actions |
|-------|-------|---------|
| `panelConfigStore` | `panelConfigs[]`, `currentPanel` | `setConfigs()`, `switchPanel()` |
| `messageStore` | `panels[id].messages`, `currentTurn`, `segments` | `addMessage()`, `setTurn()`, `appendSegment()` |
| `threadStore` | `threads[]`, `currentThreadId` | `create()`, `rename()`, `delete()`, `open()` |
| `connectionStore` | `ws`, `isConnected`, `contextUsage` | `setWs()`, `setConnected()`, `setContextUsage()` |

#### Cross-Store Communication

Use Zustand's `subscribe` pattern for cross-cutting concerns:

```typescript
// When thread changes, clear messages
threadStore.subscribe((state) => {
  if (state.currentThreadId !== previousThreadId) {
    messageStore.getState().clearPanel(currentPanel);
  }
});
```

---

### 3.2 WebSocket Client Refactor

**Current:** 532-line `ws-client.ts` with giant switch

```
src/lib/
└── ws-client.ts           # ❌ Connection + 32 handlers + routing + conversion
```

**Proposed:** Router + handlers

```
src/lib/ws/
├── index.ts               # Public API: connectWs(), disconnectWs(), send()
├── connection.ts          # WebSocket lifecycle, reconnection
├── router.ts              # Message routing switch (thin)
├── robin.ts               # Robin listener system
├── history-converter.ts   # convertExchangesToMessages, convertHistoryToMessages
└── handlers/
    ├── index.ts           # Handler registry map
    ├── turn-handlers.ts   # turn_begin, turn_end, content, thinking
    ├── thread-handlers.ts # thread:list, thread:created, opened, renamed, deleted
    ├── tool-handlers.ts   # tool_call, tool_result
    ├── file-handlers.ts   # file_tree_response, file_content_response, file_changed
    └── system-handlers.ts # connected, error, auth_error, status_update
```

#### Handler Interface

```typescript
// src/lib/ws/handlers/types.ts
export interface HandlerContext {
  panel: string;
  store: {
    panel: PanelStore;
    message: MessageStore;
    thread: ThreadStore;
    connection: ConnectionStore;
    fileData: FileDataStore;
    activeResource: ActiveResourceStore;
  };
}

export type MessageHandler = (msg: WebSocketMessage, ctx: HandlerContext) => void;
```

#### Router Implementation

```typescript
// src/lib/ws/router.ts
import { turnHandlers } from './handlers/turn-handlers';
import { threadHandlers } from './handlers/thread-handlers';
// ...

const handlerMap: Record<string, MessageHandler> = {
  // Turn lifecycle
  turn_begin: turnHandlers.begin,
  content: turnHandlers.content,
  thinking: turnHandlers.thinking,
  tool_call: toolHandlers.call,
  tool_result: toolHandlers.result,
  turn_end: turnHandlers.end,
  
  // Thread management
  'thread:list': threadHandlers.list,
  'thread:created': threadHandlers.created,
  // ... etc
};

export function routeMessage(msg: WebSocketMessage, ctx: HandlerContext) {
  const handler = handlerMap[msg.type];
  if (handler) {
    handler(msg, ctx);
  } else {
    console.warn('[WS] Unknown message type:', msg.type);
  }
}
```

---

### 3.3 Sidebar Component Split

**Current:** 393-line `Sidebar.tsx`

```
src/components/
└── Sidebar.tsx            # ❌ Animation hook + thread list + CRUD + modals + UI
```

**Proposed:** Component + hooks directory

```
src/components/thread-list/
├── index.tsx              # Sidebar (orchestrator)
├── ThreadList.tsx         # List rendering only
├── ThreadItem.tsx         # Individual thread row
├── RenameInput.tsx        # Inline rename UI
├── ThreadMenu.tsx         # Dropdown menu
├── ConfirmModal.tsx       # Reusable confirmation
└── hooks/
    ├── useFlipAnimation.ts    # FLIP animation logic
    ├── useThreadActions.ts    # CRUD operations
    └── useThreadWebSocket.ts  # WS message handling
```

---

### 3.4 Segment Catalog Registry

**Current:** 492-line `catalog-visual.ts` with all definitions inline

```
src/lib/
└── catalog-visual.ts      # ❌ All 20+ segment definitions inline
```

**Proposed:** Registry pattern

```
src/lib/segments/
├── types.ts               # SegmentDefinition interface
├── registry.ts            # getSegmentDefinition(), registerSegment()
├── defaults.ts            # DEFAULT_VISUAL_STYLE
└── definitions/
    ├── index.ts           # Export all, register on load
    ├── file-segments.ts   # read, write, edit, glob, grep
    ├── search-segments.ts # web-search, fetch
    ├── code-segments.ts   # shell, code fence
    ├── meta-segments.ts   # think, todo, subagent
    └── system-segments.ts # request, status
```

#### Registration Pattern

```typescript
// src/lib/segments/definitions/file-segments.ts
import { registerSegment } from '../registry';

registerSegment({
  type: 'read',
  visual: { /* ... */ },
  behavior: { /* ... */ },
  buildLabel: (args) => args?.file_path ? `Read ${args.file_path}` : 'Read file',
});

registerSegment({
  type: 'write',
  // ...
});
```

---

### 3.5 LiveSegmentRenderer Split

**Current:** 417 lines handling orb phase + segment orchestration

**Proposed:** Phase separation

```
src/components/streaming/
├── LiveSegmentRenderer.tsx   # Orchestrator only
├── phases/
│   ├── OrbPhase.tsx          # Phase 1: Gatekeeper animation
│   └── SegmentPhase.tsx      # Phase 2: Sequential reveal
├── hooks/
│   ├── useSequentialReveal.ts   # revealedCount logic
│   └── useCompletionDetector.ts # Effect-based completion
└── types.ts
```

---

## 4. Migration Plan

### Phase 1: WebSocket Handlers (Week 1)
1. Create `src/lib/ws/` directory structure
2. Extract handlers one by one, starting with `thread-handlers.ts`
3. Update `ws-client.ts` to use router
4. Verify all E2E tests pass

### Phase 2: State Store Split (Week 2)
1. Extract `connectionStore.ts` (lowest risk)
2. Extract `threadStore.ts`
3. Refactor remaining `panelStore.ts` → `panelConfigStore.ts` + `messageStore.ts`
4. Update all imports

### Phase 3: Component Extraction (Week 3)
1. Extract `useFlipAnimation.ts` from Sidebar
2. Create `thread-list/` component directory
3. Migrate Sidebar incrementally

### Phase 4: Registry Pattern (Week 4)
1. Create `segments/` directory
2. Migrate segment definitions incrementally
3. Verify no visual regressions

---

## 5. Acceptance Criteria

- [ ] All E2E tests pass without modification
- [ ] No file > 250 lines (except generated/auto-generated)
- [ ] Handler functions are pure (no side effects except store writes)
- [ ] Each store has < 10 actions
- [ ] New segment type can be added by creating one file

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking changes during migration | Feature-flag new code, run parallel for one week |
| Store subscription bugs | Write integration tests for cross-store flows |
| Performance regression | Benchmark render cycles before/after |
| Import churn | Use path aliases (`@/state/*`) to minimize |

---

## 7. Related Specs

- `SPEC-RENDER-CONTROLLER.md` — Render engine architecture
- `WS_CLIENT_EXTRACTION.md` — Prior WebSocket refactor attempt
- `THREADS.md` — Thread management spec
- `SPEC-TOOL-RENDERERS.md` — Tool rendering patterns

---

## 8. Open Questions

1. Should we use Zustand's `combine` pattern or separate store instances?
2. Should handlers return effects (functions) for async work, or stay sync?
3. Do we want to adopt a proper event bus instead of direct store coupling?

---

*End of Spec*
