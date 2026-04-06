# Context Usage Percentage Bar - Bug Analysis & Fix Spec

## Executive Summary

**BUG IDENTIFIED:** The token usage percentage bar appears broken because the server sends `context_usage` as a **decimal (0-1)** but the React component treats it as a **percentage (0-100)**.

**EXAMPLE:** When the wire sends `0.057` (5.7%), the UI displays `0%` (rounded from 0.057) instead of `6%`.

---

## Complete Data Flow Analysis

### 1. Wire Protocol (Kimi CLI → Server)

**File:** External Kimi CLI wire process

The wire sends `StatusUpdate` events with `context_usage` as a decimal between 0 and 1:

```json
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "type": "StatusUpdate",
    "payload": {
      "context_usage": 0.057373046875,
      "context_tokens": 15040,
      "max_context_tokens": 262144,
      "token_usage": { ... }
    }
  }
}
```

**Field:** `context_usage` (decimal, range 0.0 - 1.0)

---

### 2. Server Message Handler (Server → WebSocket Client)

**File:** `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-server/server.js` (lines 941-947)

```javascript
case 'StatusUpdate':
  ws.send(JSON.stringify({
    type: 'status_update',
    contextUsage: payload?.context_usage,  // PASSTHROUGH: Still 0-1 decimal
    tokenUsage: payload?.token_usage
  }));
  break;
```

**Status:** ✅ CORRECT - Server passes through the decimal value as `contextUsage` (camelCase)

---

### 3. WebSocket Client Handler (WebSocket → Store)

**File:** `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/src/lib/ws-client.ts` (lines 314-318)

```typescript
case 'status_update':
  if (msg.contextUsage !== undefined) {
    store.setContextUsage(msg.contextUsage);  // Stores the 0-1 decimal
  }
  break;
```

**Status:** ✅ CORRECT - Receives `contextUsage` and stores it directly

---

### 4. Store Definition

**File:** `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/src/state/panelStore.ts` (lines 61-62, 318)

```typescript
// State
contextUsage: number,  // Stores 0-1 decimal

// Action
setContextUsage: (usage) => set({ contextUsage: usage }),
```

**Status:** ✅ CORRECT - Store accepts and stores the decimal value

---

### 5. Type Definition

**File:** `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/src/types/index.ts` (line 110)

```typescript
export interface WebSocketMessage {
  type: WebSocketMessageType;
  contextUsage?: number;  // Defined as number, no range specified
  // ...
}
```

**Status:** ✅ CORRECT - Type allows any number

---

### 6. React Component (Store → UI) ⚠️ BUG LOCATION

**File:** `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/src/components/ChatArea.tsx`

#### Reading from store (line 30):
```typescript
const contextUsage = usePanelStore((state) => state.contextUsage);  // Gets 0-1 decimal
```

#### Rendering (lines 134-142):
```tsx
<div className="context-usage context-usage-below-input">
  <div className="context-usage-bar">
    <div
      className="context-usage-fill"
      style={{ width: `${Math.min(contextUsage, 100)}%` }}  // ❌ BUG: 0.057 → "0.057%"
    />
  </div>
  <span>{Math.round(contextUsage)}%</span>  // ❌ BUG: Math.round(0.057) → "0%"
</div>
```

**THE BUG:**
- Server sends: `0.057` (meaning 5.7%)
- `Math.round(0.057)` = `0` (displays "0%")
- `Math.min(0.057, 100)` = `0.057` (bar width is 0.057%, invisible)

**EXPECTED:**
- Should display: "6%" (0.057 × 100, rounded)
- Bar width should be: 5.7%

---

### 7. CSS Styling

**File:** `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/src/components/App.css` (lines 210-246)

```css
.chat-composer-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.chat-composer-meta-row .context-usage {
  flex: 0 0 150px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-composer-meta-row .context-usage-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
  min-width: 100px;
}

.chat-composer-meta-row .context-usage-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 1px;
  transition: width 0.3s ease;
}

.chat-composer-meta-row .context-usage span {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  min-width: 30px;
}
```

**Status:** ✅ CORRECT - CSS is properly styled and complete

---

## Visual Evidence

### Current Broken State

| Wire Sends | Store Has | UI Displays | Bar Width |
|------------|-----------|-------------|-----------|
| 0.057 (5.7%) | 0.057 | "0%" | 0.057% (invisible) |
| 0.439 (43.9%) | 0.439 | "0%" | 0.439% (invisible) |
| 0.85 (85%) | 0.85 | "1%" | 0.85% (invisible) |

### After Fix

| Wire Sends | Store Has | UI Displays | Bar Width |
|------------|-----------|-------------|-----------|
| 0.057 (5.7%) | 0.057 | "6%" | 5.7% (visible) |
| 0.439 (43.9%) | 0.439 | "44%" | 43.9% (visible) |
| 0.85 (85%) | 0.85 | "85%" | 85% (visible) |

---

## The Fix

**File:** `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/src/components/ChatArea.tsx`

**Location:** Lines 134-142

**CURRENT CODE:**
```tsx
<div className="context-usage context-usage-below-input">
  <div className="context-usage-bar">
    <div
      className="context-usage-fill"
      style={{ width: `${Math.min(contextUsage, 100)}%` }}
    />
  </div>
  <span>{Math.round(contextUsage)}%</span>
</div>
```

**FIXED CODE:**
```tsx
<div className="context-usage context-usage-below-input">
  <div className="context-usage-bar">
    <div
      className="context-usage-fill"
      style={{ width: `${Math.min(contextUsage * 100, 100)}%` }}
    />
  </div>
  <span>{Math.round(contextUsage * 100)}%</span>
</div>
```

**Changes:**
1. Multiply `contextUsage` by 100 for the percentage display: `{Math.round(contextUsage * 100)}%`
2. Multiply `contextUsage` by 100 for the bar width: `Math.min(contextUsage * 100, 100)`

---

## Testing with Playwright

### Debug Script

Create file: `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/e2e/context-usage-debug.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test('verify context usage percentage display', async ({ page }) => {
  // Navigate and wait for connection
  await page.goto('/');
  await page.waitForSelector('textarea.chat-input');
  
  // Get initial percentage (should be 0% initially)
  const usageText = await page.locator('.context-usage span').textContent();
  console.log('Initial usage:', usageText);
  
  // Send a test message
  const textarea = page.locator('textarea.chat-input').first();
  await textarea.fill('Hello, test message for context usage');
  
  const sendButton = page.locator('.send-btn').first();
  await sendButton.click();
  
  // Wait for response and status updates
  await page.waitForTimeout(5000);
  
  // Check the percentage display during/after streaming
  const usageTextDuring = await page.locator('.context-usage span').textContent();
  console.log('Usage during/after response:', usageTextDuring);
  
  // Get the fill bar width
  const fillWidth = await page.locator('.context-usage-fill').evaluate(el => 
    (el as HTMLElement).style.width
  );
  console.log('Fill bar width:', fillWidth);
  
  // The percentage should show a number between 0-100
  // If it shows "0%" when wire sends 0.057, the bug is confirmed
  expect(usageTextDuring).toMatch(/^\d+%$/);
});
```

### Run Test

```bash
cd /Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client
npx playwright test e2e/context-usage-debug.spec.ts --headed
```

---

## Verification Steps for Next Session

1. **Confirm the bug:**
   ```bash
   cd /Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client
   npx playwright test e2e/context-usage-debug.spec.ts --headed
   ```

2. **Apply the fix:**
   - Edit `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-client/src/components/ChatArea.tsx`
   - Multiply `contextUsage` by 100 in two places (lines 138 and 141)

3. **Verify the fix:**
   - Rebuild: `npm run build`
   - Run test again to confirm percentage displays correctly

4. **Check wire-debug.log to see raw values:**
   ```bash
   tail -f /Users/rccurtrightjr./projects/kimi-claude/kimi-ide-server/wire-debug.log | grep StatusUpdate
   ```

---

## Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Wire Protocol | ✅ Correct | Sends 0-1 decimal |
| Server Handler | ✅ Correct | Passes through as `contextUsage` |
| WebSocket Client | ✅ Correct | Stores value in state |
| Store | ✅ Correct | Holds the decimal value |
| Type Definition | ✅ Correct | Allows number type |
| **ChatArea Component** | ❌ **BUG** | Needs to multiply by 100 |
| CSS Styling | ✅ Correct | All styles present |

**SINGLE LINE FIX:** Multiply `contextUsage` by 100 in ChatArea.tsx at lines 138 and 141.

---

## Additional Notes

- The `context-usage-below-input` class is applied but has no CSS rules targeting it (unused)
- The wire-debug.log file at `/Users/rccurtrightjr./projects/kimi-claude/kimi-ide-server/wire-debug.log` captures all wire traffic
- The server must be running for the percentage bar to update (WebSocket connection required)
- Initial `contextUsage` is 0 (from store initialization), so bar starts at 0%

---

## Context Usage Persistence Strategy

### Current State: NOT Saved Anywhere

The `context_usage` value is **ephemeral** — it flows from wire → server → client → UI, but never gets persisted. When the browser refreshes, the value resets to 0.

### Proposed Storage Locations

#### Option 1: SQLite `exchanges.metadata` (Recommended)

**Schema** (`001_initial.js` line 35):
```javascript
t.text('metadata').defaultTo('[]');  // JSON text field
```

**Current Usage** (`HistoryFile.js` line 79):
```javascript
metadata: '[]',  // Always empty - ready for data!
```

**How It Works:**
- The `metadata` column is a **JSON text field** (not a separate table)
- New data can be added to the JSON **without migrations** — just change the code that writes/reads it
- Currently stores an empty array `[]`, but could store an object with context data

**Proposed Schema for Metadata:**
```json
{
  "contextUsage": 0.057,
  "contextTokens": 15040,
  "maxContextTokens": 262144,
  "tokenUsage": {
    "inputOther": 9920,
    "output": 307,
    "inputCacheRead": 5120,
    "inputCacheCreation": 0
  },
  "messageId": "chatcmpl-xxx",
  "capturedAt": 1712345678901
}
```

**Implementation Points:**
1. Track latest context in session (`server.js` StatusUpdate handler):
```javascript
session.contextUsage = payload?.context_usage;
session.tokenUsage = payload?.token_usage;
```

2. Pass to `addExchange()` in `server.js:914-918`:
```javascript
historyFile.addExchange(
  threadId,
  session.currentTurn.userInput,
  session.assistantParts,
  {  // metadata object
    contextUsage: session.contextUsage,
    tokenUsage: session.tokenUsage,
    messageId: session.lastMessageId
  }
);
```

3. Update `HistoryFile.js:67-89` to accept and store metadata:
```javascript
async addExchange(threadId, userInput, parts, metadata = {}) {
  await db('exchanges').insert({
    thread_id: threadId,
    seq,
    ts,
    user_input: userInput,
    assistant: JSON.stringify({ parts }),
    metadata: JSON.stringify(metadata || {}),  // Store context here!
  });
}
```

#### Option 2: CHAT.md Markdown File

**Current Format** (`ChatFile.js:140-155`):
```markdown
# Thread Title

User

Hello, this is the user message

Assistant

This is the assistant response

**TOOL CALL(S)**
```

**Proposed Addition** (after each Assistant response):
```markdown
Assistant

This is the assistant response

**TOOL CALL(S)**

<!-- metadata: {"contextUsage": 0.057, "contextTokens": 15040, "maxTokens": 262144} -->
```

**Key Points:**
- Place metadata **UNDER** each exchange (attributed to the exchange above)
- Use HTML comment format `<!-- ... -->` so it renders invisible in markdown viewers
- Include at the END of each exchange (after tool calls marker if present)

**Implementation** (`ChatFile.js:189-199`):
```javascript
async appendMessage(title, message, metadata = null) {
  await this.ensureDir();

  let messages = [];
  const existing = await this.read();
  if (existing) {
    messages = existing.messages;
  }

  messages.push(message);
  
  // Write metadata comment if provided
  if (metadata) {
    messages.push({
      role: 'system',  // Or custom handling
      content: `<!-- metadata: ${JSON.stringify(metadata)} -->`,
      isMetadata: true
    });
  }
  
  await this.write(title, messages);
}
```

### SQLite vs Markdown Decision Matrix

| Aspect | SQLite `metadata` | CHAT.md Comments |
|--------|-------------------|------------------|
| Queryable | ✅ SQL + JSON functions | ❌ Text search only |
| Human readable | ❌ Binary DB | ✅ Plain text |
| Git trackable | ❌ DB file usually ignored | ✅ Markdown changes visible |
| Migration needed | ❌ No - use JSON field | ❌ No - just append text |
| Audit analysis | ✅ Easy SQL queries | ⚠️ Requires parsing |
| Per-exchange | ✅ Linked to exchange row | ✅ Placed after exchange |

### Recommendation: Store in BOTH

1. **SQLite `metadata`** - For programmatic audit queries and analysis
2. **CHAT.md comments** - For human readability and git history

### Audit Query Examples (SQLite)

Once saved, you can run queries like:

```sql
-- Find conversations near context limit (>80%)
SELECT 
  t.thread_id,
  t.name,
  e.seq,
  json_extract(e.metadata, '$.contextUsage') as usage_pct,
  json_extract(e.metadata, '$.contextTokens') as tokens
FROM exchanges e
JOIN threads t ON e.thread_id = t.thread_id
WHERE json_extract(e.metadata, '$.contextUsage') > 0.8
ORDER BY usage_pct DESC;

-- Average context usage per thread
SELECT 
  t.thread_id,
  t.name,
  COUNT(e.seq) as exchange_count,
  ROUND(AVG(json_extract(e.metadata, '$.contextUsage')), 3) as avg_usage,
  MAX(json_extract(e.metadata, '$.contextUsage')) as peak_usage
FROM threads t
JOIN exchanges e ON t.thread_id = e.thread_id
GROUP BY t.thread_id;

-- Find threads with sudden context spikes
SELECT 
  t.thread_id,
  e1.seq,
  json_extract(e1.metadata, '$.contextUsage') as prev_usage,
  json_extract(e2.metadata, '$.contextUsage') as curr_usage,
  (json_extract(e2.metadata, '$.contextUsage') - json_extract(e1.metadata, '$.contextUsage')) as jump
FROM exchanges e1
JOIN exchanges e2 ON e1.thread_id = e2.thread_id AND e2.seq = e1.seq + 1
JOIN threads t ON e1.thread_id = t.thread_id
WHERE jump > 0.2  -- 20% jump between exchanges
ORDER BY jump DESC;
```

### Summary: SQLite Schema Q&A

**Q: Do we have a metadata field in general on the SQLite DB?**  
**A:** YES - `exchanges.metadata` is a JSON text column (currently always `'[]'`)

**Q: Is every new thing we want to attach to a chat pair just another cell?**  
**A:** NO - You don't need new columns. The `metadata` JSON field can hold arbitrary structured data. Just change the code that inserts/retrieves it.

**Q: How does adding new fields work?**  
**A:** Since `metadata` stores JSON text, you can add new fields to the object without touching the database schema:
```javascript
// Current (empty array)
metadata: '[]'

// Future (rich object) - no migration needed!
metadata: '{"contextUsage": 0.057, "tokenUsage": {...}, "newField": "value"}'
```

**Q: What if I need to query the metadata in SQL?**  
**A:** SQLite has JSON functions:
```sql
-- Extract nested values
SELECT json_extract(metadata, '$.tokenUsage.inputOther') FROM exchanges;

-- Filter by metadata content
SELECT * FROM exchanges WHERE json_extract(metadata, '$.contextUsage') > 0.5;
```
