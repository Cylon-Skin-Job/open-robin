# Live Sync Module Specification

## Overview

Centralized infrastructure for real-time state synchronization between server and client. Enables multi-tab consistency, optimistic updates, and predictable DOM re-renders.

## Core Principle

**Infrastructure centralized. Business logic distributed.**

The Live Sync module handles *how* updates flow. Feature modules handle *what* to update.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         SERVER                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Mutation   │→│    PubSub    │→│  WebSocket Broadcast  │  │
│  │   Occurs     │  │  Registry    │  │  (type + payload)    │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              LIVE SYNC MODULE (Infrastructure)            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│  │  │  Connection │  │  Dispatcher │  │  Update Router  │  │   │
│  │  │  Manager    │  │  (central)  │  │  (type→handler) │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            FEATURE MODULES (Business Logic)               │   │
│  │                                                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │ thread/     │  │  files/     │  │   chat/         │   │   │
│  │  │ handlers.ts │  │ handlers.ts │  │  handlers.ts    │   │   │
│  │  │             │  │             │  │                 │   │   │
│  │  │ onRename()  │  │ onCreate()  │  │ onMessage()     │   │   │
│  │  │ onDelete()  │  │ onDelete()  │  │ onTyping()      │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              STATE LAYER (Zustand Stores)                 │   │
│  │         (Single source of truth, triggers React)          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Structure

```
src/
  live-sync/
    ├── index.ts              # Public API
    ├── types.ts              # Shared interfaces
    ├── connection.ts         # WebSocket lifecycle
    ├── dispatcher.ts         # Central message router
    ├── registry.ts           # Subscription management
    └── README.md             # Usage guide
```

---

## Core Interfaces

### Message Protocol

```typescript
// Base message - all server→client updates
interface LiveUpdate {
  type: string;           // 'entity:action' format
  id: string;            // entity identifier
  timestamp: number;     // server timestamp
  payload: unknown;      // action-specific data
}

// Examples:
// { type: 'thread:renamed', id: 'thread-123', payload: { name: '...' } }
// { type: 'thread:deleted', id: 'thread-123', payload: {} }
// { type: 'file:created', id: '/path/to/file', payload: { node } }
// { type: 'chat:message', id: 'thread-123', payload: { role, content } }
```

### Subscription Registry

```typescript
interface Subscription {
  id: string;                    // subscription ID
  entityType: string;            // 'thread', 'file', 'chat'
  entityId?: string;             // specific ID or undefined for all
  handler: (update: LiveUpdate) => void;
}

// Registry maintains:
// - Map<entityType, Map<entityId, Set<Subscription>>>
// - Wildcard subscriptions (listen to all entities of type)
```

### Handler Signature

```typescript
type LiveUpdateHandler<T = unknown> = (
  update: LiveUpdate<T>,
  context: {
    store: StoreApi;           // Zustand store reference
    optimistic: boolean;       // is this an optimistic update?
    rollback: () => void;      // rollback function for optimistic
  }
) => void | Promise<void>;
```

---

## Public API

### For Feature Modules (Consumers)

```typescript
// Subscribe to updates
const unsubscribe = liveSync.subscribe({
  entityType: 'thread',
  entityId: 'thread-123',      // optional - undefined for all threads
  handler: threadHandlers.onRename
});

// Unsubscribe on cleanup
unsubscribe();

// Optimistic update (client predicts server success)
liveSync.optimistic({
  type: 'thread:renamed',
  id: 'thread-123',
  payload: { name: 'New Name' }
}, {
  rollbackOn: ['thread:rename:failed'],  // auto-rollback if this arrives
  timeout: 5000                          // auto-rollback after timeout
});
```

### For Server (Producers)

```typescript
// Broadcast to all connections watching this entity
pubsub.broadcast({
  type: 'thread:renamed',
  id: threadId,
  payload: { name: newName }
});

// Broadcast to specific workspace
pubsub.broadcastToWorkspace(workspaceId, update);

// Notify single connection (e.g., response to action)
ws.send(JSON.stringify(update));
```

---

## Data Flow

### Server-Side Broadcast

```
1. Mutation occurs (thread renamed, file created, etc.)
2. Server persists change (DB, filesystem)
3. PubSub looks up subscribers for this entity
4. Broadcasts LiveUpdate to all subscriber WebSockets
```

### Client-Side Handling

```
1. WebSocket receives message
2. Dispatcher validates and deserializes
3. Registry looks up handlers for entityType
4. Each handler executes:
   a. Updates Zustand store
   b. Store change triggers React re-render
   c. DOM updates automatically
```

### Optimistic Updates

```
1. User action triggers optimistic update
2. Client applies update immediately (UI responsive)
3. Request sent to server
4. Server responds with success/failure
5. On success: confirm optimistic (no-op)
6. On failure: rollback to previous state
```

---

## Feature Integration Pattern

### Step 1: Define Handler

```typescript
// features/thread/live-handlers.ts
import { threadStore } from './store';

export const threadLiveHandlers = {
  
  onRenamed(update, { store }) {
    store.setState(state => ({
      threads: state.threads.map(t =>
        t.threadId === update.id 
          ? { ...t, entry: { ...t.entry, name: update.payload.name } }
          : t
      )
    }));
  },
  
  onDeleted(update, { store }) {
    store.setState(state => ({
      threads: state.threads.filter(t => t.threadId !== update.id),
      currentThreadId: state.currentThreadId === update.id 
        ? null 
        : state.currentThreadId
    }));
  },
  
  onCreated(update, { store }) {
    store.setState(state => ({
      threads: [update.payload.thread, ...state.threads]
    }));
  }
  
};
```

### Step 2: Register on Component Mount

```typescript
// features/thread/ThreadList.tsx
import { useEffect } from 'react';
import { liveSync } from '@/live-sync';
import { threadLiveHandlers } from './live-handlers';

export function ThreadList() {
  
  useEffect(() => {
    // Subscribe to all thread updates
    const unsub = liveSync.subscribe({
      entityType: 'thread',
      handler: (update) => {
        switch (update.type) {
          case 'thread:renamed': 
            return threadLiveHandlers.onRenamed(update);
          case 'thread:deleted': 
            return threadLiveHandlers.onDeleted(update);
          case 'thread:created': 
            return threadLiveHandlers.onCreated(update);
        }
      }
    });
    
    return unsub;
  }, []);
  
  // ... render threads
}
```

### Step 3: Server Broadcasts

```typescript
// server/lib/thread/ThreadManager.ts
async renameThread(threadId, newName) {
  // 1. Persist
  await this.index.rename(threadId, newName);
  
  // 2. Broadcast
  pubsub.broadcast({
    type: 'thread:renamed',
    id: threadId,
    payload: { name: newName }
  });
}
```

---

## Entity Types

| Entity | Actions | Payload |
|--------|---------|---------|
| `thread` | `created`, `renamed`, `deleted`, `updated` | Thread object or partial |
| `file` | `created`, `deleted`, `modified`, `moved` | FileNode object |
| `chat` | `message`, `typing`, `status` | Message or status object |
| `workspace` | `changed`, `config` | Workspace config |

---

## Error Handling

### Network Disconnected
- Queue updates locally
- Reconnect and replay
- Server resolves conflicts (last-write-wins or custom)

### Optimistic Rollback
- Handler throws → auto-rollback
- Server rejects → explicit rollback message
- Timeout → auto-rollback

### Handler Errors
- Log to error tracking
- Don't crash dispatcher
- Surface to user if critical

---

## Implementation Phases

### Phase 1: Infrastructure
- Connection manager
- Dispatcher
- Registry
- Basic subscribe/unsubscribe

### Phase 2: Thread Integration
- Thread entity type
- rename/create/delete handlers
- Replace current ad-hoc updates

### Phase 3: File Explorer
- File entity type
- Auto-refresh on changes
- Remove manual refresh need

### Phase 4: Optimistic
- Optimistic update API
- Rollback mechanism
- Conflict resolution

---

## Open Questions

1. **Scope granularity**: Per-entity subscriptions or wildcard patterns?
2. **Conflict resolution**: Last-write-wins or operational transforms?
3. **Offline support**: Queue and replay or show "disconnected" state?
4. **Backpressure**: What if client can't keep up with updates?

---

## Migration from Current System

### Current
- Server sends `thread:list` after mutations
- Client replaces entire thread list
- File tree requires manual refresh

### Target
- Server sends granular updates (`thread:renamed`, etc.)
- Client patches individual entities
- File tree auto-updates via subscription

### Migration Path
1. Build Live Sync module alongside existing code
2. Migrate thread updates first (highest value)
3. Migrate file explorer
4. Deprecate bulk `thread:list` refresh

---

## Success Metrics

- [ ] Multi-tab: Action in tab A visible in tab B < 100ms
- [ ] Optimistic: UI updates before server round-trip
- [ ] Recovery: Reconnect seamlessly, no lost updates
- [ ] Debuggable: Clear logs of all state changes
