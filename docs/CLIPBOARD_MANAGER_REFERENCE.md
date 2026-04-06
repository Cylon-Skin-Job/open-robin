# Clipboard Manager - Implementation Reference

> Complete reference for the clipboard manager implementation. Use this as a template for building similar toolbar widgets.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ ClipboardTrigger│───▶│  Controller     │───▶│   Store     │ │
│  │   (Icon UI)     │    │ (State Machine) │    │  (Zustand)  │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│           │                      │                      │       │
│           ▼                      ▼                      ▼       │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ClipboardPopover │    │ interaction-    │    │  clipboard- │ │
│  │   (List UI)     │    │ controller.ts   │    │   store.ts  │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│           │                      │                             │
│           └──────────────────────┘                             │
│                      │                                         │
│              WebSocket (ws-client)                             │
└──────────────────────┼─────────────────────────────────────────┘
                       │
┌──────────────────────┼─────────────────────────────────────────┐
│                      ▼                                         │
│  SERVER (Node.js)                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  server.js → routes clipboard:* messages to handlers    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                      │                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  lib/clipboard/ws-handlers.js → CRUD operations         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                      │                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  lib/clipboard/queries.js → SQL operations              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                      │                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  lib/db/migrations/005_clipboard.js → Database schema   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
kimi-ide-client/src/clipboard/
├── index.ts                    # Public exports
├── types.ts                    # TypeScript interfaces
├── clipboard-store.ts          # Zustand state management
├── clipboard-api.ts            # API functions + monitor
├── interaction-controller.ts   # State machine (CLOSED/PREVIEW/LOCKED)
├── ClipboardTrigger.tsx        # Icon button component
└── ClipboardPopover.tsx        # Popover list component

ai/views/settings/styles/views.css  # All styling
kimi-ide-server/lib/clipboard/
├── ws-handlers.js              # WebSocket message handlers
└── queries.js                  # SQL queries

kimi-ide-server/lib/db/migrations/
└── 005_clipboard.js            # Database migration
```

## Component Breakdown

### 1. ClipboardTrigger (Icon Button)

**Role**: Pure UI trigger with React mouse event handlers

```typescript
// Key features:
- Reads bubbleState from store for styling
- Calls controller methods on mouse events
- No internal state - purely reactive

const handleMouseEnter = () => {
  getClipboardController().preview();  // Opens PREVIEW
};

const handleMouseLeave = () => {
  getClipboardController().handleTriggerLeave();  // Starts close timer
};

const handleClick = () => {
  getClipboardController().toggle();  // Toggles LOCKED
};
```

**Styling approach**:
```css
.clipboard-trigger {
  opacity: 0.4;                    /* Subtle default */
  transition: opacity 150ms;       /* Smooth fade */
  background: transparent;         /* No background */
}
.clipboard-trigger:hover {
  opacity: 0.8;                    /* Hover state */
}
.clipboard-trigger.open {
  opacity: 1;                      /* Active state */
}
/* NO background changes, NO color changes - just opacity */
```

### 2. ClipboardPopover (Modal List)

**Role**: Presentational component showing clipboard history

```typescript
// Key features:
- Reads items from store
- Handles its own mouse events to prevent closing
- Calls controller methods for hover

onMouseEnter={handlePopoverEnter}  // Cancels close timer
onMouseLeave={handlePopoverLeave}  // Starts close timer
```

### 3. InteractionController (State Machine)

**Role**: Vanilla TypeScript controller managing all timing and state

```typescript
// States:
CLOSED   → Initial state, popover hidden
PREVIEW  → Hovering trigger, popover visible
LOCKED   → Clicked trigger, popover stays open
LEAVING  → Mouse left, timer running

// Timing constants:
HOVER_DELAY = 200ms   // Before PREVIEW opens
LOCK_GRACE = 500ms    // Before LOCKED closes
```

**Key methods exposed for React components**:
```typescript
preview()              // Trigger hover → PREVIEW
toggle()               // Click → LOCKED or CLOSED
handleTriggerLeave()   // Trigger mouseleave
handlePopoverEnter()   // Popover mouseenter (cancels close)
handlePopoverLeave()   // Popover mouseleave (starts close)
```

### 4. ClipboardStore (Zustand)

```typescript
interface ClipboardState {
  items: ClipboardEntry[];      // History items
  total: number;                // Total count
  selectedIndex: number;        // Keyboard nav
  bubbleState: BubbleState;     // 'CLOSED' | 'PREVIEW' | 'LOCKED'
  isLoading: boolean;
  error: string | null;
}
```

### 5. ClipboardAPI (Client-Side)

```typescript
// Manual operations
writeAndRecord(text)     // Copy + save to history
copyFromHistory(entry)   // Copy from history
clearHistory()           // Clear all
listPage(offset, limit)  // Paginated fetch

// Auto-capture
startClipboardMonitor()  // Polls system clipboard every 1s
stopClipboardMonitor()   // Stops polling
```

### 6. Server-Side WebSocket Handlers

```javascript
// Message types handled:
'clipboard:list'     → Returns paginated items
'clipboard:append'   → Adds new item
'clipboard:touch'    → Updates last_used_at
'clipboard:clear'    → Deletes all items
```

### 7. Database Schema

```javascript
// clipboard_items table:
- id (primary key)
- text (full content)
- type ('text', 'code', etc.)
- preview (truncated for display)
- content_hash (unique, for dedup)
- created_at
- last_used_at (for ordering)
- source ('user', 'auto', etc.)
```

## Integration Steps

### Step 1: Add to ChatArea (or similar parent)

```tsx
import { ClipboardTrigger } from '../clipboard';

// In render:
<div className="chat-composer-meta-row">
  <ClipboardTrigger />
  <ContextUsage />  {/* Other meta items */}
</div>
```

### Step 2: CSS Positioning

```css
.chat-composer-meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Popover positioning */
.clipboard-bubble {
  position: absolute;
  bottom: calc(100% + 12px);  /* Above trigger */
  left: 0;                     /* Aligned left */
  z-index: 1003;              /* Above other UI */
}
```

### Step 3: Start Monitor on App Load

```tsx
// main.tsx
import { startClipboardMonitor } from './clipboard';
startClipboardMonitor();
```

## Key Design Decisions

### 1. No Background on Hover
- Only opacity changes (0.4 → 0.8 → 1)
- No simulated button press
- Visual feedback from popover appearance itself

### 2. Two-Stage Hover Behavior
- **Stage 1**: Hover trigger → PREVIEW (temporary)
- **Stage 2**: Click or enter popover → LOCKED (persistent)
- **Close**: Leave both trigger AND popover → CLOSED

### 3. Auto-Capture
- Polls system clipboard every 1 second
- Requires user permission (gracefully degrades)
- Deduplicates using content hash
- Silent (no toast) for auto-captured items

### 4. Separation of Concerns
- **Controller**: All timing logic (vanilla TS)
- **React components**: Pure rendering
- **Store**: State container only
- **API**: Transport layer only

## Testing Strategy

```typescript
// Test hover behavior
test('hover opens popover', async () => {
  await trigger.hover();
  await page.waitForTimeout(300);  // Wait for timer
  expect(await popover.isVisible()).toBe(true);
});

// Test leave behavior  
test('leave closes popover', async () => {
  await trigger.hover();
  await page.mouse.move(0, 0);     // Move away
  await page.waitForTimeout(300);  // Wait for leave timer
  expect(await popover.isVisible()).toBe(false);
});

// Test popover hover prevents close
test('popover hover prevents close', async () => {
  await trigger.hover();
  await popover.hover();           // Move to popover
  await page.waitForTimeout(500);  // Wait longer than leave timer
  expect(await popover.isVisible()).toBe(true);
});
```

## Common Patterns for New Toolbar Widgets

### Pattern 1: Hover-to-Preview Widget

```typescript
// Use the same interaction-controller pattern:
// 1. CLOSED state
// 2. Hover → PREVIEW (with timer)
// 3. Click or enter modal → LOCKED
// 4. Leave both → CLOSED (with timer)
```

### Pattern 2: Styling Approach

```css
/* Always use opacity-only for subtle interactions */
.widget-trigger {
  opacity: 0.4;
  transition: opacity 150ms;
  background: transparent;  /* Never change */
}
.widget-trigger:hover { opacity: 0.8; }
.widget-trigger.open { opacity: 1; }
```

### Pattern 3: Store Structure

```typescript
// Each widget gets its own slice:
interface WidgetStore {
  items: Item[];           // List data
  bubbleState: State;      // 'CLOSED' | 'PREVIEW' | 'LOCKED'
  selectedIndex: number;   // For keyboard nav
  isLoading: boolean;
}
```

### Pattern 4: Server Integration

```javascript
// Add WebSocket handlers in kimi-ide-server/lib/{widget}/
// 1. Create ws-handlers.js
// 2. Create queries.js
// 3. Create migration
// 4. Wire up in server.js
```

## Files to Reference

| Purpose | File |
|---------|------|
| Complete trigger component | `kimi-ide-client/src/clipboard/ClipboardTrigger.tsx` |
| Complete popover component | `kimi-ide-client/src/clipboard/ClipboardPopover.tsx` |
| State machine | `kimi-ide-client/src/clipboard/interaction-controller.ts` |
| API + monitor | `kimi-ide-client/src/clipboard/clipboard-api.ts` |
| CSS styling | `ai/views/settings/styles/views.css` (search `.clipboard-`) |
| Server handlers | `kimi-ide-server/lib/clipboard/ws-handlers.js` |
| DB schema | `kimi-ide-server/lib/db/migrations/005_clipboard.js` |
| Tests | `kimi-ide-client/e2e/clipboard-*.spec.ts` |

---

*Documented: 2026-04-04*
*Applies to: kimi-ide-client, kimi-ide-server*
