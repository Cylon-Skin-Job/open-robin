# SPEC-05b: ws-client.ts — Thread & File Handler Extraction

## SCOPE BOUNDARY — READ THIS FIRST

This spec extracts two groups of message handlers from ws-client.ts: thread handlers and file handlers. That's it.

**You are NOT restructuring ws-client.ts.** You are NOT moving the connection lifecycle, robin pub/sub, or robin/clipboard dispatch. You are NOT touching stream-handlers.ts (already extracted in SPEC-05a). You are NOT changing the handleMessage dispatch pattern.

The robin/clipboard cases (lines 270-284) are 15 lines of pass-through — they stay. The `connected`, `modal:show`, and `panel_config` cases are one-liners — they stay. The connection lifecycle, robin pub/sub, and exports all stay.

**If you finish early, stop. Do not look for more work in this file.**

---

## Context

After SPEC-05a, ws-client.ts is 353 lines. Stream handlers are already extracted to `ws/stream-handlers.ts`. What remains is connection lifecycle + boring "receive message, write to store" handlers. This spec extracts the two largest remaining groups so ws-client becomes a thin coordinator.

---

## File 1: `src/lib/ws/thread-handlers.ts`

Extract these cases from the switch in `handleMessage()`:

```
case 'thread:list'      (lines 141-146)
case 'thread:created'   (lines 148-158)
case 'thread:opened'    (lines 160-189)
case 'wire_ready'       (lines 191-193)
case 'thread:renamed'   (lines 195-199)
case 'thread:deleted'   (lines 201-205)
case 'message:sent'     (lines 207-209)
```

Also move the history conversion helpers that ONLY thread:opened uses:

```
convertExchangesToMessages()   (lines 293-317)
convertPartToSegment()         (lines 319-337)
convertHistoryToMessages()     (lines 339-352)
```

**These helpers need these imports (move with them):**
```ts
import { toolNameToSegmentType, SEGMENT_ICONS } from '../instructions';
import type { ExchangeData, AssistantPart, StreamSegment } from '../../types';
```

**Export a single function matching the stream-handlers pattern:**

```ts
import { usePanelStore } from '../../state/panelStore';
import { toolNameToSegmentType, SEGMENT_ICONS } from '../instructions';
import { loadRootTree } from '../file-tree';
import type { WebSocketMessage, ExchangeData, AssistantPart, StreamSegment } from '../../types';

/**
 * Handle thread-related WebSocket messages.
 * Returns true if the message was handled, false if not recognized.
 */
export function handleThreadMessage(msg: WebSocketMessage): boolean {
  const store = usePanelStore.getState();
  const panel = store.currentPanel;

  switch (msg.type) {
    case 'thread:list':
      // ... exact current code ...
      return true;

    case 'thread:created':
      // ... exact current code ...
      return true;

    case 'thread:opened':
      // ... exact current code ...
      return true;

    // ... remaining cases ...

    default:
      return false;
  }
}

// --- History conversion helpers (private to this module) ---

function convertExchangesToMessages(...) { ... }
function convertPartToSegment(...) { ... }
function convertHistoryToMessages(...) { ... }
```

---

## File 2: `src/lib/ws/file-handlers.ts`

Extract these cases:

```
case 'file_changed'           (lines 221-243)
case 'file_tree_response'     (lines 246-252)
case 'file_content_response'  (lines 254-260)
case 'file:moved'             (lines 262-264)
case 'file:move_error'        (lines 266-268)
```

**Export a single function:**

```ts
import { usePanelStore } from '../../state/panelStore';
import { useActiveResourceStore } from '../../state/activeResourceStore';
import { useFileDataStore } from '../../state/fileDataStore';
import { showToast } from '../toast';
import type { WebSocketMessage } from '../../types';

/**
 * Handle file-related WebSocket messages.
 * Returns true if the message was handled, false if not recognized.
 */
export function handleFileMessage(msg: WebSocketMessage): boolean {
  switch (msg.type) {
    case 'file_changed':
      // ... exact current code ...
      return true;

    // ... remaining cases ...

    default:
      return false;
  }
}
```

---

## Changes to ws-client.ts

### Remove these imports (they move to the new files):
```ts
// REMOVE — moves to thread-handlers.ts:
import { toolNameToSegmentType, SEGMENT_ICONS } from '../lib/instructions';
import { loadRootTree } from '../lib/file-tree';

// REMOVE — moves to file-handlers.ts:
import { useActiveResourceStore } from '../state/activeResourceStore';
import { useFileDataStore } from '../state/fileDataStore';
```

### Add these imports:
```ts
import { handleThreadMessage } from './ws/thread-handlers';
import { handleFileMessage } from './ws/file-handlers';
```

### Update handleMessage():
```ts
function handleMessage(msg: WebSocketMessage) {
  if (handleStreamMessage(msg)) return;
  if (handleThreadMessage(msg)) return;
  if (handleFileMessage(msg)) return;

  const store = usePanelStore.getState();

  switch (msg.type) {
    case 'connected':
      console.log('[WS] Session:', msg.sessionId);
      break;

    case 'modal:show':
      showModal(msg as unknown as import('../lib/modal').ModalConfig);
      break;

    case 'panel_config':
      if ((msg as any).projectRoot) {
        store.setProjectRoot((msg as any).projectRoot);
      }
      break;

    // Robin system panel responses
    case 'robin:tabs':
    case 'robin:items':
    case 'robin:wiki':
    case 'robin:theme-data':
      emitRobin(msg.type, msg);
      break;

    // Clipboard manager responses
    case 'clipboard:list':
    case 'clipboard:append':
    case 'clipboard:touch':
    case 'clipboard:clear':
      emitRobin(msg.type, msg);
      break;

    default:
      break;
  }
}
```

### Delete the history conversion helpers (bottom of file):
`convertExchangesToMessages`, `convertPartToSegment`, `convertHistoryToMessages` — they moved to thread-handlers.ts.

### Delete unused type imports:
Remove `ExchangeData`, `AssistantPart`, `StreamSegment` from the types import if no longer used in ws-client.ts. Keep `WebSocketMessage`.

---

## What Stays in ws-client.ts

After this extraction, ws-client.ts should contain:
- Module state (`socket`, `reconnectTimer`, `WS_URL`)
- Robin pub/sub (`robinListeners`, `sendRobinMessage`, `onRobinMessage`, `emitRobin`)
- Connection lifecycle (`connectWs`, `disconnectWs`)
- `handleMessage()` — dispatches to stream/thread/file handlers, keeps connected + modal + panel_config + robin/clipboard
- Exports: `connectWs`, `disconnectWs`, `sendRobinMessage`, `onRobinMessage`

**Estimated size: ~120 lines.** Down from 552 original.

---

## Gotchas

### 1. thread:opened uses targetPanel, not panel
Line 163: `const targetPanel = msg.panel || panel;` — this prevents cross-panel pollution. The extracted function must read `panel` fresh from `usePanelStore.getState().currentPanel` internally, same as the stream handlers do. Do NOT accept panel as a parameter.

### 2. thread:created calls loadRootTree()
Line 154: `loadRootTree()` is imported from `../lib/file-tree`. This import moves to thread-handlers.ts.

### 3. file_changed reads from two stores
Lines 222-241: reads `useFileDataStore` AND `useActiveResourceStore` AND `usePanelStore` (for ws). All three imports move to file-handlers.ts.

### 4. file_changed sends a WS message
Lines 233-239: if the active resource matches the changed file, it sends a `file_content_request` back through the WebSocket. It reads `store.ws` to get the socket. This is fine — `usePanelStore.getState().ws` gives the current socket.

### 5. Check for unused imports after extraction
ws-client.ts currently imports `toolNameToSegmentType`, `SEGMENT_ICONS`, `loadRootTree`, `useActiveResourceStore`, `useFileDataStore`, and the type imports. After extraction, verify none of these are still used in ws-client.ts. Remove any that aren't. If `showToast` is only used by file:move_error, it moves too.

**Check `showToast`**: currently used by `auth_error` (in stream-handlers.ts) and `file:move_error`. If `auth_error` already moved in 05a, then `showToast` moves to file-handlers.ts and is removed from ws-client.ts.

---

## What NOT to Do

- Do not move the robin pub/sub system
- Do not move the robin/clipboard dispatch cases
- Do not move connected, modal:show, or panel_config
- Do not move the connection lifecycle
- Do not touch stream-handlers.ts
- Do not change any handler behavior
- Do not create an index.ts barrel for ws/
- Do not reorganize or rename anything

---

## Directory Structure After

```
src/lib/
  ws-client.ts              ← coordinator (~120 lines)
  ws/
    stream-handlers.ts      ← turn lifecycle (from SPEC-05a)
    thread-handlers.ts      ← thread CRUD + history conversion (NEW)
    file-handlers.ts        ← file cache + live updates (NEW)
```

---

## Verification

1. **Build passes** — `npm run build`
2. **Open a thread** — history loads (thread:opened → convertExchangesToMessages)
3. **Switch threads** — previous thread's history clears, new one loads
4. **Create a thread** — thread:created fires, panel clears, file tree reloads
5. **Rename a thread** — name updates in sidebar
6. **Delete a thread** — removed from list
7. **File changes** — edit a file externally, verify file_changed invalidates cache
8. **File explorer** — navigate folders, verify file_tree_response and file_content_response work

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| targetPanel not read correctly | Thread history written to wrong panel | Switching panels shows other panel's messages |
| loadRootTree import missing | File tree doesn't reload on thread create | Explorer shows stale tree |
| showToast left in ws-client but only used in extracted files | Unused import (harmless) or missing import (build error) | Build error caught immediately |
| History helpers not moved | thread:opened can't convert exchanges | Thread opens with empty history |
