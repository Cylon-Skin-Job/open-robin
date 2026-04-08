# Phase 2B: Harness Selector UI Spec

**Status:** Draft  
**Version:** 1.0  
**Scope:** UI for selecting harness before starting a new chat  
**Dependencies:** Phase 2 (Compatibility Layer)  

---

## Overview

When the user clicks "New Chat", display a harness selection panel to choose the AI backend:

- **Robin** → Vercel AI SDK (BYOK/OpenAI/Anthropic/etc.) - API-based, no CLI
- **KIMI CLI** → Original KIMI CLI tool with wire protocol - local subprocess

The selection is locked in for that thread's lifetime.

### Architecture Reality Check

**Phase 1 extracted:** KIMI CLI handling → `lib/harness/kimi/` (currently misnamed as `robin/`)

**Phase 2C needs to:** Create actual `lib/harness/robin/` with Vercel AI SDK

See `PHASE-2C-VERCEL-SDK-INTEGRATION.md` for implementation details.

---

## User Flow

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  User clicks    │────▶│  Harness Selector   │────▶│  Chat starts    │
│  "New Chat"     │     │  Panel (modal)      │     │  with selected  │
│                 │     │                     │     │  harness        │
└─────────────────┘     └─────────────────────┘     └─────────────────┘
                                │
                                ▼
                        ┌───────────────┬───────────────┐
                        │               │               │
                        ▼               ▼               ▼
                   ┌─────────┐    ┌─────────┐    ┌──────────┐
                   │  KIMI   │    │  Robin  │    │  Future  │
                   │  CLI    │    │  BYOK   │    │  ...     │
                   └─────────┘    └─────────┘    └──────────┘
```

---

## UI Specification

### 1. Harness Selector Modal

**Trigger:** Clicking "New Chat" button  
**Dismiss:** Selection made, or click outside/press Escape to cancel  

```
┌─────────────────────────────────────────────────────────────┐
│  ×                                                           │
│                                                              │
│           Choose AI Backend                                 │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🔷                                                 │   │
│  │  Robin (Recommended)                                │   │
│  │  Vercel AI SDK - BYOK                               │   │
│  │  OpenAI, Anthropic, Ollama, etc.                    │   │
│  │                                                     │   │
│  │  [Select]                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🤖                                                 │   │
│  │  KIMI CLI                                           │   │
│  │  Local CLI with wire protocol                       │   │
│  │  Extracted harness architecture                     │   │
│  │                                                     │   │
│  │  [Select]                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│              [Cancel]                                       │
└─────────────────────────────────────────────────────────────┘
```

### 2. Card Component Structure

```typescript
interface HarnessOption {
  id: string;           // 'kimi' | 'robin' | etc.
  name: string;         // Display name
  description: string;  // Short subtitle
  icon: string;         // Emoji or icon component
  details: {
    provider: string;   // 'kimi' | 'byok' | 'ollama' | etc.
    model: string;      // 'k1.6' | 'configurable' | 'llama3.1'
    features: string[]; // ['tools', 'streaming', 'thinking']
  };
  enabled: boolean;     // Can user select this?
  comingSoon?: boolean; // Show "Coming Soon" badge
  recommended?: boolean; // Show "Recommended" badge
}

// Initial options
const HARNESS_OPTIONS: HarnessOption[] = [
  {
    id: 'robin',
    name: 'Robin',
    description: 'AI assistant via Vercel AI SDK',
    icon: '🔷',
    details: {
      provider: 'byok',
      model: 'configurable',
      features: ['tools', 'streaming', 'thinking', 'plan_mode']
    },
    enabled: true,
    recommended: true
  },
  {
    id: 'kimi',
    name: 'Legacy KIMI',
    description: 'KIMI CLI with inline wire handling',
    icon: '🤖',
    details: {
      provider: 'kimi',
      model: 'k1.6',
      features: ['tools', 'streaming', 'thinking', 'plan_mode']
    },
    enabled: true
  }
];
```

---

## Frontend Implementation

### 3. Component: `HarnessSelector.svelte`

```svelte
<!-- ai/views/capture-viewer/src/components/HarnessSelector.svelte -->

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { HarnessOption } from '../types/harness';
  
  export let options: HarnessOption[];
  export let isOpen = false;
  
  const dispatch = createEventDispatcher<{
    select: { harnessId: string };
    cancel: void;
  }>();
  
  function selectHarness(option: HarnessOption) {
    if (!option.enabled) return;
    dispatch('select', { harnessId: option.id });
    isOpen = false;
  }
  
  function cancel() {
    dispatch('cancel');
    isOpen = false;
  }
  
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel();
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div 
    class="modal-backdrop"
    on:click={cancel}
    on:keydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-labelledby="harness-selector-title"
  >
    <div class="modal-content" on:click|stopPropagation>
      <button class="close-btn" on:click={cancel} aria-label="Close">×</button>
      
      <h2 id="harness-selector-title">Choose AI Backend</h2>
      
      <div class="harness-grid">
        {#each options as option}
          <button 
            class="harness-card"
            class:disabled={!option.enabled}
            class:coming-soon={option.comingSoon}
            on:click={() => selectHarness(option)}
            disabled={!option.enabled}
          >
            <div class="card-header">
              <span class="icon">{option.icon}</span>
              <h3>{option.name}</h3>
              {#if option.recommended}
                <span class="badge recommended">Recommended</span>
              {:else if option.comingSoon}
                <span class="badge">Soon</span>
              {/if}
            </div>
            
            <p class="description">{option.description}</p>
            
            <div class="details">
              <span class="detail-pill">{option.details.provider}</span>
              <span class="detail-pill">{option.details.model}</span>
            </div>
            
            <div class="features">
              {#each option.details.features as feature}
                <span class="feature-tag">{feature}</span>
              {/each}
            </div>
            
            {#if option.enabled}
              <span class="select-indicator">Select →</span>
            {/if}
          </button>
        {/each}
      </div>
      
      <button class="cancel-btn" on:click={cancel}>Cancel</button>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  
  .modal-content {
    background: var(--bg-primary, #1e1e1e);
    border-radius: 12px;
    padding: 24px;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    position: relative;
  }
  
  .close-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    background: none;
    border: none;
    color: var(--text-secondary, #888);
    font-size: 24px;
    cursor: pointer;
  }
  
  h2 {
    margin: 0 0 24px 0;
    font-size: 20px;
    text-align: center;
  }
  
  .harness-grid {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 24px;
  }
  
  .harness-card {
    background: var(--bg-secondary, #2d2d2d);
    border: 2px solid transparent;
    border-radius: 8px;
    padding: 20px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }
  
  .harness-card:hover:not(:disabled) {
    border-color: var(--accent, #007acc);
    transform: translateY(-2px);
  }
  
  .harness-card.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  
  .icon {
    font-size: 24px;
  }
  
  .card-header h3 {
    margin: 0;
    flex: 1;
  }
  
  .badge {
    background: var(--accent-secondary, #666);
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    text-transform: uppercase;
  }
  
  .badge.recommended {
    background: var(--success, #4caf50);
  }
  
  .description {
    color: var(--text-secondary, #888);
    margin: 0 0 12px 0;
    font-size: 14px;
  }
  
  .details {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }
  
  .detail-pill {
    background: var(--bg-tertiary, #3d3d3d);
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-tertiary, #aaa);
  }
  
  .features {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  
  .feature-tag {
    background: rgba(0, 122, 204, 0.2);
    color: var(--accent, #007acc);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
  }
  
  .select-indicator {
    position: absolute;
    bottom: 20px;
    right: 20px;
    color: var(--accent, #007acc);
    font-size: 14px;
    font-weight: 500;
  }
  
  .cancel-btn {
    width: 100%;
    padding: 12px;
    background: transparent;
    border: 1px solid var(--border, #444);
    border-radius: 6px;
    color: var(--text-secondary, #888);
    cursor: pointer;
  }
  
  .cancel-btn:hover {
    background: var(--bg-secondary, #2d2d2d);
  }
</style>
```

---

## Backend Integration

### 4. API Changes

#### 4.1 Create Thread with Harness Selection

**Current:**
```javascript
// POST /api/threads
// Body: { name: string }
```

**New:**
```javascript
// POST /api/threads
// Body: { 
//   name: string,
//   harnessId: string  // 'kimi' | 'robin' | etc.
// }
```

#### 4.2 Store Harness in Thread Record

**SQLite Schema Update:**
```sql
-- Add harness column to threads table
ALTER TABLE threads ADD COLUMN harness_id TEXT DEFAULT 'kimi';
ALTER TABLE threads ADD COLUMN harness_config TEXT; -- JSON for BYOK settings
```

**Thread object:**
```typescript
interface Thread {
  thread_id: string;
  panel_id: string;
  name: string;
  harness_id: string;      // NEW
  harness_config?: {       // NEW - for BYOK
    provider?: string;     // 'openai' | 'anthropic' | 'ollama'
    model?: string;
    baseUrl?: string;
    apiKey?: string;       // Stored securely or referenced
  };
  created_at: string;
  // ... other fields
}
```

### 5. Server.js Integration

```javascript
// Around line 280 - handle 'thread:create'

case 'thread:create': {
  const { name, harnessId = 'kimi' } = data; // Default to 'kimi' if not specified
  
  const threadId = generateId();
  const thread = {
    thread_id: threadId,
    panel_id: data.panelId,
    name: name || 'New Chat',
    harness_id: harnessId,  // Store the selection
    created_at: new Date().toISOString(),
    // ...
  };
  
  // Save to database
  await db.run(
    'INSERT INTO threads (thread_id, panel_id, name, harness_id, created_at) VALUES (?, ?, ?, ?, ?)',
    [thread.thread_id, thread.panel_id, thread.name, thread.harness_id, thread.created_at]
  );
  
  // Set the harness mode for this thread
  const { setThreadMode } = require('./lib/harness/feature-flags');
  setThreadMode(threadId, harnessId === 'kimi' ? 'legacy' : 'new');
  
  ws.send(JSON.stringify({
    type: 'thread:created',
    thread
  }));
  break;
}
```

### 6. Resume Thread with Harness

When resuming an existing thread, use its stored harness:

```javascript
// Around line 320 - handle 'thread:resume'

case 'thread:resume': {
  const { threadId } = data;
  
  const thread = await db.get(
    'SELECT * FROM threads WHERE thread_id = ?',
    [threadId]
  );
  
  if (!thread) {
    ws.send(JSON.stringify({ type: 'error', message: 'Thread not found' }));
    break;
  }
  
  // Set harness mode based on thread's stored preference
  const { setThreadMode } = require('./lib/harness/feature-flags');
  const mode = thread.harness_id === 'robin' ? 'new' : 'legacy';
  setThreadMode(threadId, mode);
  
  // Continue with existing resume logic...
  break;
}
```

---

## Robin Harness (Vercel AI SDK)

The Robin harness uses Vercel AI SDK to call APIs directly. This is DIFFERENT from the KIMI CLI harness.

**Location:** `lib/harness/robin/` (needs to be created - see Phase 2C)

**Key differences from KIMI harness:**
- No subprocess spawning
- Direct HTTP API calls
- User provides API keys (BYOK)
- Streams via SDK, not wire protocol

```typescript
// lib/harness/robin/index.ts (STUB)

import { AIHarness, HarnessConfig, HarnessSession, CanonicalEvent } from '../types';

/**
 * Robin Harness Implementation - VERCEL AI SDK
 * 
 * This is the REAL Robin - uses Vercel AI SDK for API calls.
 * NOT the KIMI CLI wrapper (that should be in lib/harness/kimi/)
 * 
 * Supports: OpenAI, Anthropic, Ollama, etc.
 */
export class RobinHarness implements AIHarness {
  readonly id = 'robin';
  readonly name = 'Robin';
  readonly provider = 'byok';
  
  async initialize(config: HarnessConfig): Promise<void> {
    console.log('[RobinHarness] Initialized (stub)');
  }
  
  async startThread(threadId: string, projectRoot: string): Promise<HarnessSession> {
    console.log(`[RobinHarness] Starting thread ${threadId} (stub)`);
    
    return {
      threadId,
      async *sendMessage(message: string): AsyncIterable<CanonicalEvent> {
        // Stub: just echo back a message
        yield {
          type: 'turn_begin',
          timestamp: Date.now(),
          turnId: `turn-${Date.now()}`,
          userInput: message
        };
        
        yield {
          type: 'content',
          timestamp: Date.now(),
          text: 'Robin here! Connected via Vercel AI SDK. How can I help you today?'
        };
        
        yield {
          type: 'turn_end',
          timestamp: Date.now(),
          turnId: `turn-${Date.now()}`,
          fullText: 'Robin harness is not yet fully implemented. Please use KIMI CLI for now.',
          hasToolCalls: false
        };
      },
      async stop(): Promise<void> {
        console.log('[RobinHarness] Stopped (stub)');
      }
    };
  }
  
  async dispose(): Promise<void> {
    console.log('[RobinHarness] Disposed (stub)');
  }
}
```

---

## Frontend Flow Integration

### 7. Modify "New Chat" Button Handler

```typescript
// In your main layout or sidebar component

import HarnessSelector from '../components/HarnessSelector.svelte';
import { HARNESS_OPTIONS } from '../config/harness';

let showHarnessSelector = false;

function handleNewChat() {
  showHarnessSelector = true;
}

async function onHarnessSelected(event: CustomEvent<{ harnessId: string }>) {
  const { harnessId } = event.detail;
  
  // Create thread with harness selection
  const response = await fetch('/api/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'New Chat',
      harnessId
    })
  });
  
  const { thread } = await response.json();
  
  // Navigate to new thread
  window.location.href = `/chat/${thread.thread_id}`;
}

function onHarnessCancel() {
  // User cancelled - do nothing
  showHarnessSelector = false;
}
```

### 8. Configuration File

```typescript
// src/config/harness.ts

import type { HarnessOption } from '../types/harness';

export const HARNESS_OPTIONS: HarnessOption[] = [
  {
    id: 'robin',
    name: 'Robin',
    description: 'AI assistant via Vercel AI SDK',
    icon: '🔷',
    details: {
      provider: 'byok',
      model: 'gpt-4, claude-3, etc.',
      features: ['tools', 'streaming', 'thinking']
    },
    enabled: true,
    recommended: true
  },
  {
    id: 'kimi',
    name: 'KIMI CLI',
    description: 'Original KIMI CLI with inline wire handling',
    icon: '🤖',
    details: {
      provider: 'kimi',
      model: 'k1.6',
      features: ['tools', 'streaming', 'thinking', 'plan_mode']
    },
    enabled: true
  }
];

// Default harness - Robin is the primary experience
export const DEFAULT_HARNESS = 'robin';

// System prompt prefix for Robin
export const ROBIN_SYSTEM_PROMPT = `You are Robin, a helpful AI assistant...`;
```

---

## Checklist

### Frontend
- [ ] Create `HarnessSelector.svelte` component
- [ ] Define `HarnessOption` types
- [ ] Create harness configuration
- [ ] Modify "New Chat" button to show selector
- [ ] Handle selection and thread creation

### Backend
- [ ] Update SQLite schema (add `harness_id` column)
- [ ] Modify `thread:create` handler to accept `harnessId`
- [ ] Store harness selection in thread record
- [ ] Set feature flag mode on thread creation/resume
- [ ] Create `RobinHarness` stub

### Integration
- [ ] Thread resumes with correct harness
- [ ] Default remains 'kimi' for backwards compatibility
- [ ] UI shows current harness in thread header (optional)

---

## Future Extensions

1. **Per-thread settings panel:** Change harness config (model, API key) after creation
2. **More harnesses:** Add Ollama, OpenAI, Anthropic options
3. **Favorites:** Remember last-used harness, quick-select
4. **Profiles:** Pre-configured harness + model combinations

---

*Spec Version: 1.0*  
*Created: 2026-04-05*  
*Status: Ready for Implementation*
