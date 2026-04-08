# SPEC-05a: ws-client.ts — Stream Handler Extraction ONLY

## SCOPE BOUNDARY — READ THIS FIRST

This spec extracts ONE block of code from ws-client.ts: the stream message handlers (turn_begin through turn_end + status_update). That's it.

**You are NOT refactoring ws-client.ts.** You are NOT restructuring the message routing. You are NOT extracting thread handlers, file handlers, robin handlers, or clipboard handlers. You are NOT changing the connection lifecycle. You are NOT touching the robin pub/sub system. You are NOT improving error handling, adding types, cleaning up imports, or reorganizing anything else.

There is a follow-up spec (05b) planned for the remaining extractions. This spec is deliberately narrow so we can smoke test the most fragile part in isolation before touching anything else.

**If you finish early, stop. Do not look for more work in this file.**

---

## Context

`open-robin-client/src/lib/ws-client.ts` is 552 lines with a single giant `handleMessage()` switch statement routing 30+ message types. The stream handlers (turn lifecycle) are the most fragile part — they manage pendingTurnEnd state, tool-grouper module-level state, and have a documented past bug. Everything else in the file is simple "receive message, write to store" handlers that are low risk.

This spec extracts the stream handlers into their own file so they're isolated and testable. The rest of ws-client stays exactly as-is.

---

## File to Create

### `src/lib/ws/stream-handlers.ts`

Extract the following cases from the `handleMessage()` switch statement:

```
case 'turn_begin'     (lines 143-191)
case 'content'        (lines 194-211)
case 'thinking'       (lines 213-225)
case 'tool_call'      (lines 227-245)
case 'tool_result'    (lines 247-274)
case 'turn_end'       (lines 276-318)
case 'status_update'  (lines 321-325)
case 'request'        (lines 327-329)
case 'auth_error'     (lines 331-333)
case 'error'          (lines 335-337)
```

**Export a single function:**

```ts
import { usePanelStore } from '../../state/panelStore';
import { toolNameToSegmentType, SEGMENT_ICONS } from '../instructions';
import { getSummaryField } from '../catalog-visual';
import {
  onToolCall,
  getGroupForResult,
  breakSequence,
  reset as resetGrouper,
} from '../tool-grouper';
import { showToast } from '../toast';
import type { WebSocketMessage } from '../../types';

/**
 * Handle stream-related WebSocket messages.
 * Returns true if the message was handled, false if not recognized.
 */
export function handleStreamMessage(msg: WebSocketMessage): boolean {
  const store = usePanelStore.getState();
  const panel = store.currentPanel;

  switch (msg.type) {
    case 'turn_begin':
      // ... exact current code ...
      return true;

    case 'content':
      // ... exact current code ...
      return true;

    // ... all cases listed above ...

    default:
      return false;
  }
}

/**
 * Reset stream state (called on reconnect from ws-client.ts).
 * Exported so the connection lifecycle can reset grouper on reconnect.
 */
export { reset as resetStreamState } from '../tool-grouper';
```

**The function returns `boolean`** so ws-client can call it first and fall through to the remaining handlers if it returns false:

```ts
// In ws-client.ts handleMessage():
function handleMessage(msg: WebSocketMessage) {
  // Try stream handlers first
  if (handleStreamMessage(msg)) return;

  // Everything else stays here in the switch
  const store = usePanelStore.getState();
  const panel = store.currentPanel;

  switch (msg.type) {
    case 'connected':
      // ... unchanged ...
    case 'thread:list':
      // ... unchanged ...
    // ... all remaining cases unchanged ...
  }
}
```

---

## What Changes in ws-client.ts

### Remove these imports (they move to stream-handlers.ts):
```ts
// REMOVE these — they move to stream-handlers.ts:
import { toolNameToSegmentType, SEGMENT_ICONS } from '../lib/instructions';
import { getSummaryField } from '../lib/catalog-visual';
import {
  onToolCall,
  getGroupForResult,
  breakSequence,
  reset as resetGrouper,
} from '../lib/tool-grouper';
```

### Add this import:
```ts
import { handleStreamMessage, resetStreamState } from './ws/stream-handlers';
```

### Change line 77 (`resetGrouper()` in onopen):
```ts
// Old:
resetGrouper();

// New:
resetStreamState();
```

### Change handleMessage():
Add the `if (handleStreamMessage(msg)) return;` at the top. Remove the stream cases from the switch. Everything else stays.

### Remove these cases from the switch:
`turn_begin`, `content`, `thinking`, `tool_call`, `tool_result`, `turn_end`, `status_update`, `request`, `auth_error`, `error`

### Keep these cases in the switch (DO NOT TOUCH):
`connected`, `thread:list`, `thread:created`, `thread:opened`, `wire_ready`, `thread:renamed`, `thread:deleted`, `message:sent`, `modal:show`, `panel_config`, `file_changed`, `file_tree_response`, `file_content_response`, `file:moved`, `file:move_error`, `robin:tabs`, `robin:items`, `robin:wiki`, `robin:theme-data`, `clipboard:list`, `clipboard:append`, `clipboard:touch`, `clipboard:clear`

---

## Critical Code — Move Byte-for-Byte

### The pendingTurnEnd clear on turn_begin (lines 169-181)

This block has a big warning comment about a past bug. Move the ENTIRE block including all comments:

```ts
// CRITICAL: Clear pendingTurnEnd from the PREVIOUS turn.
//
// If the old turn's renderer hadn't finished revealing when this
// turn_begin arrives, pendingTurnEnd is still true. Without this
// clear, the NEW turn would inherit it — causing premature
// finalization as soon as the first segment of the new turn
// finishes revealing.
//
// KNOWN PAST BUG (DO NOT REMOVE):
// Omitting this line caused new turns to finalize immediately
// after their first segment, because the stale pendingTurnEnd
// from the previous turn was still set.
store.setPendingTurnEnd(panel, false);
```

**Do not rewrite, summarize, or "improve" this comment.** It's a warning to future developers. Move it exactly.

### The turn_end lifecycle comment (lines 276-298)

Same — move the entire comment block explaining the turn_end → pendingTurnEnd → renderer pipeline. Do not rewrite.

### The safety net in turn_begin (lines 148-164)

The "snapshot previous turn if not finalized" logic. Move exactly as-is.

---

## Gotchas

### 1. `resetGrouper()` is called from TWO places

- Line 77: `ws.onopen` — connection lifecycle (stays in ws-client.ts, renamed to `resetStreamState()`)
- Line 167: `turn_begin` handler — stream lifecycle (moves to stream-handlers.ts, uses direct `resetGrouper()` import)

Both call the same module-level function in tool-grouper.ts. After extraction, ws-client calls `resetStreamState` (re-exported from stream-handlers) and stream-handlers calls `resetGrouper` directly. They must resolve to the same function — if they don't, reconnect won't clear grouper state and tool results from the dead connection leak into new turns.

### 2. `store.currentPanel` is read fresh in every handler

Every handler does `usePanelStore.getState()` at the top. The extracted function must do the same — read `panel` from fresh store state, not accept it as a parameter. If `panel` were passed as a parameter, it could go stale between the call and the store write.

### 3. Tool-grouper state is module-level

`onToolCall`, `getGroupForResult`, `breakSequence`, `resetGrouper` all operate on Maps inside tool-grouper.ts. These Maps are module-level singletons. The extracted file imports the same functions from the same module — the singleton state is shared. This works correctly. Do not create a new grouper instance.

### 4. First-token timing instrumentation

Lines 196-202 and 215-220: `(window as any).__TIMING` instrumentation. Move as-is. Do not remove or "clean up" the timing code.

---

## What NOT to Do

- Do not extract thread handlers, file handlers, robin handlers, or clipboard handlers
- Do not change the robin pub/sub system (robinListeners Map, sendRobinMessage, onRobinMessage, emitRobin)
- Do not change the connection lifecycle (connectWs, disconnectWs, onopen, onclose, onerror)
- Do not change the history conversion helpers (convertExchangesToMessages, convertPartToSegment, convertHistoryToMessages)
- Do not change any message handler behavior
- Do not add types, error handling, or logging beyond what exists
- Do not rename functions or variables
- Do not reorganize imports in ws-client.ts beyond what's specified
- Do not create an index.ts barrel for the ws/ directory
- Do not touch any other file

---

## Directory Structure After

```
src/lib/
  ws-client.ts          ← coordinator, connection lifecycle, remaining handlers
  ws/
    stream-handlers.ts  ← turn lifecycle, tool grouping, timing
```

Just one new file. One new directory.

---

## Verification

1. **Build passes** — `npm run build` succeeds
2. **Send a message** — turn_begin fires, content streams, tool calls render, turn_end finalizes
3. **Send a second message immediately** — pendingTurnEnd clears correctly on new turn_begin (no premature finalization)
4. **Grouped tools work** — send a message that triggers multiple file reads → they group into one segment
5. **Disconnect and reconnect** — close server, restart, verify grouper state resets (no stale tool results from previous connection)
6. **Thread switch** — open a different thread, verify clean state (no segments from previous thread)

---

## Smoke Test Script

After implementation, run this to verify the module structure:

```js
// Quick structural check — run with: node -e "..."
// or add to test/smoke-spec05a.js

const path = require('path');
const fs = require('fs');

const clientSrc = path.join(__dirname, '..', '..', 'open-robin-client', 'src');

// 1. New file exists
const streamHandlers = path.join(clientSrc, 'lib', 'ws', 'stream-handlers.ts');
console.assert(fs.existsSync(streamHandlers), 'stream-handlers.ts must exist');

// 2. ws-client.ts no longer has stream cases
const wsClient = fs.readFileSync(path.join(clientSrc, 'lib', 'ws-client.ts'), 'utf8');
console.assert(!wsClient.includes("case 'turn_begin'"), 'turn_begin must not be in ws-client.ts');
console.assert(!wsClient.includes("case 'tool_call'"), 'tool_call must not be in ws-client.ts');
console.assert(!wsClient.includes("case 'turn_end'"), 'turn_end must not be in ws-client.ts');

// 3. ws-client.ts still has non-stream cases
console.assert(wsClient.includes("case 'thread:list'"), 'thread:list must still be in ws-client.ts');
console.assert(wsClient.includes("case 'robin:tabs'"), 'robin:tabs must still be in ws-client.ts');
console.assert(wsClient.includes("case 'file_changed'"), 'file_changed must still be in ws-client.ts');

// 4. ws-client.ts imports stream handlers
console.assert(wsClient.includes('handleStreamMessage'), 'ws-client must import handleStreamMessage');
console.assert(wsClient.includes('resetStreamState'), 'ws-client must import resetStreamState');

// 5. stream-handlers.ts has the critical code
const streamCode = fs.readFileSync(streamHandlers, 'utf8');
console.assert(streamCode.includes('setPendingTurnEnd'), 'stream-handlers must have pendingTurnEnd logic');
console.assert(streamCode.includes('KNOWN PAST BUG'), 'stream-handlers must preserve past bug comment');
console.assert(streamCode.includes('onToolCall'), 'stream-handlers must have tool-grouper integration');
console.assert(streamCode.includes('resetGrouper') || streamCode.includes('reset as resetGrouper'), 'stream-handlers must import resetGrouper');

// 6. No tool-grouper imports left in ws-client.ts
console.assert(!wsClient.includes('onToolCall'), 'onToolCall must not be in ws-client.ts');
console.assert(!wsClient.includes('breakSequence'), 'breakSequence must not be in ws-client.ts');
console.assert(!wsClient.includes('getGroupForResult'), 'getGroupForResult must not be in ws-client.ts');

console.log('✓ All structural checks passed');
```

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| pendingTurnEnd not cleared on turn_begin | New turns finalize immediately | Spinner loops, rendering broken |
| resetGrouper not called on reconnect | Stale tool IDs from dead connection | Garbled tool results after reconnect |
| Store read passed as parameter instead of fresh getState() | Stale panel reference | Messages written to wrong panel |
| Tool-grouper imported from different path | Two separate grouper instances | Group state not shared, tools don't group |
| Stream cases left in ws-client switch | Double-handling of stream messages | Duplicate segments, double finalization |
