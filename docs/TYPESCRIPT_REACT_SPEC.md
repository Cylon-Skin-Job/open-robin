# TypeScript + React Code Spec

**Modularization, separation of concerns, validation, and enforcement rules for this codebase.**

---

## Core Principle

Maximum separation of concerns. Every module has one job. No module bypasses the controller. No component manages orchestration. No timer lives in a component. The architecture is legible from the file tree alone.

---

## File Organization

```
kimi-ide-client/src/
├── engine/               # Standalone render engine (no React)
│   ├── RenderEngine.ts   # Pulse, queue, state machine
│   ├── types.ts          # Engine-specific types (Instruction, etc.)
│   └── constants.ts      # Timing constants
├── bridge/               # Engine-to-React adapter
│   └── useEngineBridge.ts
├── state/                # Zustand store (read-only from React's view)
│   └── workspaceStore.ts
├── hooks/                # React hooks (WebSocket, etc.)
│   └── useWebSocket.ts
├── components/           # Pure renderers — no timers, no orchestration
│   ├── ChatArea.tsx
│   ├── MessageList.tsx
│   ├── SegmentBlock.tsx
│   ├── Ribbon/
│   └── ...
├── types/                # Shared TypeScript types
│   └── index.ts
└── styles/               # CSS modules and animations
    ├── variables.css
    └── animations.css
```

---

## Separation of Concerns

### What belongs where

| Concern | Location | NOT in |
|---------|----------|--------|
| Pulse timing, queue management | `engine/` | Components, hooks, store |
| Wire event parsing, message routing | `hooks/useWebSocket.ts` | Components, store |
| Segment type mapping (ToolCall -> segment) | `hooks/useWebSocket.ts` or `engine/` | Components |
| React state for rendering | `state/workspaceStore.ts` | Components directly |
| DOM rendering | `components/` | Anywhere else |
| CSS transitions, animations | `styles/` | Inline styles (unless dynamic) |
| Type definitions | `types/` or `engine/types.ts` | Scattered across files |

### Rules

1. **Components are pure renderers.** They read store state via `useStore()` and return JSX. No `setTimeout`. No `setInterval`. No orchestration logic. If a component needs to "wait," the engine handles the waiting and updates the store when it is time to render.

2. **The engine owns all timing.** The 500ms pulse, the shimmer duration, the collapse delay, the post-content pause — all live in the engine. Components do not compute timing.

3. **The store is a projection.** It contains exactly what React needs to draw the current frame. It does not contain queue state, engine internals, or timing data. The bridge translates engine state into store state.

4. **User actions go through the engine.** A click to expand a collapsed thought block calls `engine.enqueue()`, not `setState()` directly. The engine processes it on the next tick and updates the store through the bridge.

5. **One bridge, one direction.** Engine -> Bridge -> Store -> Components. Never Components -> Store directly (except reading). Never Components -> Engine directly (except user actions via `enqueue()`).

---

## TypeScript Rules

### What TypeScript handles (no custom validation needed)

These checks were necessary in vanilla JS but TypeScript catches them at compile time:

| Old JS Check | TypeScript Equivalent |
|-------------|----------------------|
| ID referenced in JS must exist in HTML | Not applicable — React renders from data, not DOM selectors |
| Function called must be defined | Compiler error: `TS2304` (cannot find name) |
| Import exists | Compiler error: `TS2307` (cannot find module) |
| Property exists on object | Compiler error: `TS2339` (property does not exist) |
| Unused variables | Compiler error: `TS6133` (declared but never read) |
| Type mismatches | Compiler error: `TS2322` (type not assignable) |
| Missing function arguments | Compiler error: `TS2554` (expected N arguments) |

### What TypeScript does NOT handle (custom validation needed)

| Check | Why TypeScript Misses It | Enforcement |
|-------|-------------------------|-------------|
| Unused exports | TS only checks unused locals, not exports | Lint rule or custom script |
| Circular dependencies | TS resolves them but they cause bugs | `madge --circular` or similar |
| Store state shape drift | Store and components can diverge if not careful | Shared types in `types/index.ts` |
| CSS class referenced but not defined | TypeScript doesn't validate CSS | CSS modules or custom script |
| Component renders stale data | Zustand selector returns old reference | Selector granularity review |
| Engine-store contract drift | Engine writes fields the store doesn't have | Shared interface for bridge output |
| Dead components | Files exist but are never imported | `ts-prune` or import graph analysis |

---

## React-Specific Rules

### Component Patterns

```typescript
// GOOD: Pure renderer, reads from store
function ThinkingBlock({ content, isLive }: Props) {
  return <div>{content}</div>;
}

// BAD: Component manages its own timing
function ThinkingBlock({ content }: Props) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setTimeout(() => setVisible(true), 1500); // NO — engine's job
  }, []);
  return visible ? <div>{content}</div> : null;
}
```

### Forbidden Patterns in Components

| Pattern | Why | Alternative |
|---------|-----|-------------|
| `setTimeout` / `setInterval` | Timing belongs to the engine | Engine tick handles delays |
| `useEffect` for orchestration | Creates hidden state machines | Engine state machine |
| Direct `store.setState()` | Bypasses the bridge | `engine.enqueue()` |
| `useRef` for mutable timers | Hidden mutable state in render tree | Engine manages all timers |
| Conditional rendering based on time | Race condition source | Engine pre-computes visibility |

**Exception:** The typing animation (`requestAnimationFrame` loop for character reveal) runs in components because it is purely visual and does not affect state transitions. The engine polls its completion status.

### Allowed Patterns in Components

| Pattern | Use Case |
|---------|----------|
| `useStore(selector)` | Reading render state |
| `useState` for local UI only | Hover state, input field value |
| `useRef` for DOM references | Scroll position, element measurement |
| `onClick={() => engine.enqueue(...)}` | User interaction |
| CSS transitions via className | Visual animations driven by store state |

---

## File Header Convention

Each file should declare its role and dependencies at the top:

```typescript
/**
 * @module RenderEngine
 * @role Pulse-driven job queue for streaming UI orchestration
 * @depends-on engine/types.ts, engine/constants.ts
 * @depended-by bridge/useEngineBridge.ts
 * @framework-agnostic true
 */
```

For React components:

```typescript
/**
 * @module SegmentBlock
 * @role Pure renderer for stream segments (think, tool, text)
 * @reads workspaceStore: currentSegment, segments
 * @emits engine.enqueue (user toggle expand/collapse)
 */
```

---

## Validation Checklist

Run before every commit or PR:

### Automated (TypeScript compiler)

- `npm run build` — catches type errors, unused imports, missing properties

### Automated (lint rules to configure)

- [ ] No `setTimeout` / `setInterval` in `components/` directory
- [ ] No direct `store.setState()` calls outside `bridge/`
- [ ] No circular dependencies (`madge --circular`)
- [ ] No unused exports (`ts-prune`)
- [ ] All shared types in `types/index.ts` or `engine/types.ts`

### Manual review triggers

- [ ] Any new `useEffect` in a component — does it belong in the engine?
- [ ] Any new state in store — is it a projection of engine state, or independent?
- [ ] Any new file — does it fit the file organization spec?
- [ ] Any timing change — is it in `engine/constants.ts`?

---

## Staleness Detection

### File-level freshness tracking

Each doc and spec file includes a `Last Updated` footer. The nightly cron can check:

1. **Doc references code that changed.** If `RENDER_ENGINE_ARCHITECTURE.md` references `RenderEngine.ts` and that file's git timestamp is newer than the doc's, flag for review.

2. **Broken internal links.** `[STREAMING_CONTENT.md](./STREAMING_CONTENT.md)` — verify the target exists. Flag if not.

3. **Type drift.** Compare the `StreamSegment` interface in `types/index.ts` against actual usage in components. If a field is defined but never read, or read but not defined, flag it.

### React-specific staleness

| Signal | Meaning |
|--------|---------|
| Component imports a type that no longer exists | Dead reference |
| Store field never read by any component | Dead state |
| Component never imported by any parent | Dead component |
| CSS class in stylesheet but never in JSX | Dead style |
| Engine instruction type never enqueued | Dead instruction |

---

## Migration Notes from Vanilla JS

### What we carried forward

- **Separation of concerns** — the controller pattern (now: engine)
- **Validation mindset** — checking that references resolve
- **Header conventions** — documenting dependencies at the top of files

### What TypeScript replaces

- **ID existence checks** — React doesn't use `document.getElementById`. Components render from data.
- **Function existence checks** — TypeScript compiler catches missing functions.
- **Type checking** — No more runtime `typeof` guards for API contracts.

### What React adds (new concerns)

- **Re-render performance** — Zustand selector granularity matters. Subscribe to the smallest piece of state needed.
- **Stale closure bugs** — `useCallback` and `useRef` for values that change between renders.
- **Component lifecycle** — `useEffect` cleanup to prevent memory leaks on unmount.
- **Key prop correctness** — Array rendering needs stable keys, not array indices (for dynamic lists).

---

*Last Updated: 2026-03-01*
*Applies to: kimi-ide-client (React + TypeScript + Vite)*
