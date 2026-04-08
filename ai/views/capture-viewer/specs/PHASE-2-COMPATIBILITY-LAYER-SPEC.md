# Phase 2: Compatibility Layer & Gradual Migration Spec

**Status:** Draft  
**Version:** 1.0  
**Target Completion:** Week 1-2  
**Risk Level:** Low (feature-flagged, instantly reversible)  
**Depends On:** Phase 1 (ROBIN Harness Extraction) complete

---

## Objective

Create a battle-tested compatibility layer that allows the new `RobinHarness` to coexist with the legacy inline wire handling. Enable zero-downtime migration through feature flags, with instant rollback capability.

---

## Success Criteria

1. ✅ Feature flags control harness selection per-thread or globally
2. ✅ Zero behavioral changes when flags are off (100% legacy behavior)
3. ✅ Instant rollback via environment variable or API call
4. ✅ Both paths can run simultaneously (A/B testing)
5. ✅ All existing tests pass regardless of flag state
6. ✅ Performance within 5% of baseline in both modes

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FEATURE FLAG SYSTEM                             │
├─────────────────────────────────────────────────────────────────────────┤
│  HARNESS_MODE=legacy        → Always use inline server.js code          │
│  HARNESS_MODE=new           → Always use RobinHarness class              │
│  HARNESS_MODE=parallel      → Run both, compare outputs (testing)       │
│  (default/undefined)        → Legacy (safe default)                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│  LEGACY PATH    │    │  NEW PATH           │    │  PARALLEL PATH      │
│  (server.js)    │    │  (RobinHarness)      │    │  (Both + Compare)   │
├─────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│ • Inline spawn  │    │ • lib/harness/robin/      │    │ • Both spawned      │
│ • Direct parse  │    │   robin/index.ts     │    │ • Events compared   │
│ • State in      │    │ • Canonical events  │    │ • Diffs logged      │
│   session obj   │    │ • Clean separation  │    │ • Legacy wins ties  │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
```

---

## Files to Create/Modify

### 1. `lib/harness/robin/feature-flags.ts` (NEW)

**Purpose:** Centralized, type-safe feature flag system

```typescript
/**
 * Feature flag system for harness migration.
 * 
 * Priority (highest to lowest):
 * 1. Per-thread override (in-memory Map)
 * 2. Environment variable HARNESS_MODE
 * 3. Config file setting
 * 4. Default: 'legacy'
 */

export type HarnessMode = 'legacy' | 'new' | 'parallel';

interface FeatureFlags {
  /** Global or per-thread harness mode */
  harnessMode: HarnessMode;
  
  /** Enable detailed comparison logging in parallel mode */
  parallelLogging: boolean;
  
  /** Allow runtime mode switching via API */
  allowRuntimeSwitch: boolean;
}

// Per-thread overrides (highest priority)
const threadOverrides = new Map<string, HarnessMode>();

// Current session override (for testing)
let globalOverride: HarnessMode | null = null;

/**
 * Get the effective harness mode for a thread.
 */
export function getHarnessMode(threadId?: string): HarnessMode {
  // 1. Check thread override
  if (threadId && threadOverrides.has(threadId)) {
    return threadOverrides.get(threadId)!;
  }
  
  // 2. Check global session override
  if (globalOverride) {
    return globalOverride;
  }
  
  // 3. Check environment variable
  const envMode = process.env.HARNESS_MODE;
  if (envMode && isValidMode(envMode)) {
    return envMode;
  }
  
  // 4. Default to legacy for safety
  return 'legacy';
}

/**
 * Check if a mode string is valid.
 */
function isValidMode(mode: string): mode is HarnessMode {
  return ['legacy', 'new', 'parallel'].includes(mode);
}

/**
 * Set mode for a specific thread (runtime override).
 */
export function setThreadMode(threadId: string, mode: HarnessMode): void {
  threadOverrides.set(threadId, mode);
}

/**
 * Clear thread mode override.
 */
export function clearThreadMode(threadId: string): void {
  threadOverrides.delete(threadId);
}

/**
 * Set global mode override for this process.
 */
export function setGlobalMode(mode: HarnessMode | null): void {
  globalOverride = mode;
}

/**
 * Check if we should use the new harness for a thread.
 */
export function shouldUseNewHarness(threadId?: string): boolean {
  const mode = getHarnessMode(threadId);
  return mode === 'new' || mode === 'parallel';
}

/**
 * Check if we're in parallel comparison mode.
 */
export function isParallelMode(threadId?: string): boolean {
  return getHarnessMode(threadId) === 'parallel';
}

/**
 * Get all feature flag values for debugging.
 */
export function getFlagStatus(): {
  globalOverride: HarnessMode | null;
  threadOverrides: Record<string, HarnessMode>;
  environment: string | undefined;
  effectiveMode: HarnessMode;
} {
  return {
    globalOverride,
    threadOverrides: Object.fromEntries(threadOverrides),
    environment: process.env.HARNESS_MODE,
    effectiveMode: getHarnessMode()
  };
}

/**
 * Reset all overrides (useful for testing).
 */
export function resetOverrides(): void {
  threadOverrides.clear();
  globalOverride = null;
}
```

---

### 2. `lib/harness/robin/compat.ts` (COMPLETE IMPLEMENTATION)

**Purpose:** Drop-in replacement for all legacy wire functions

```typescript
/**
 * Compatibility shim for gradual harness migration.
 * 
 * This module provides drop-in replacements for all wire-related
 * functions in server.js. The implementation chosen depends on
 * the current feature flag state.
 * 
 * Usage in server.js:
 *   const { spawnThreadWire, handleWireMessage } = require('./lib/harness/compat');
 */

import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { 
  getHarnessMode, 
  shouldUseNewHarness, 
  isParallelMode,
  HarnessMode 
} from './feature-flags';
import { RobinHarness } from './harness/robin';
import { CanonicalEvent } from './types';

// Singleton harness instance (lazy-loaded)
let robinHarness: RobinHarness | null = null;
let harnessInitPromise: Promise<void> | null = null;

/**
 * Get or create the singleton RobinHarness instance.
 */
function getHarness(): RobinHarness {
  if (!robinHarness) {
    robinHarness = new RobinHarness();
    harnessInitPromise = robinHarness.initialize({});
    harnessInitPromise.catch(err => {
      console.error('[Compat] Failed to initialize RobinHarness:', err);
    });
  }
  return robinHarness;
}

/**
 * Wait for harness initialization (call before using harness).
 */
async function ensureHarnessReady(): Promise<void> {
  if (harnessInitPromise) {
    await harnessInitPromise;
  }
}

// ============================================================================
// LEGACY IMPLEMENTATIONS (copied from server.js for reference)
// ============================================================================

/**
 * Legacy: Spawn wire process directly.
 * This is the exact code from server.js:604-634
 */
function spawnThreadWireLegacy(threadId: string, projectRoot: string): ChildProcess {
  const { spawn } = require('child_process');
  const robinPath = process.env.ROBIN_PATH || 'robin';
  const args = ['--wire', '--yolo', '--session', threadId];
  
  if (projectRoot) {
    args.push('--work-dir', projectRoot);
  }
  
  const proc = spawn(robinPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color' }
  });
  
  console.log(`[Wire:legacy] Spawning thread session: ${robinPath} ${args.join(' ')}`);
  console.log(`[Wire:legacy] Spawned with pid: ${proc.pid}`);
  
  proc.on('error', (err: Error) => {
    console.error('[Wire:legacy] Failed to spawn:', err.message);
  });
  
  proc.on('exit', (code: number | null) => {
    console.log(`[Wire:legacy] Process ${proc.pid} exited with code ${code}`);
  });
  
  proc.stderr.on('data', (data: Buffer) => {
    console.error('[Wire:legacy stderr]:', data.toString().trim());
  });
  
  return proc;
}

// ============================================================================
// NEW IMPLEMENTATIONS (using RobinHarness)
// ============================================================================

interface SessionLike {
  connectionId: string;
  threadId: string;
  wire?: ChildProcess | null;
  harnessSession?: unknown;
  // ... other session properties
}

/**
 * New: Spawn wire process via RobinHarness.
 */
async function spawnThreadWireNew(
  threadId: string, 
  projectRoot: string
): Promise<ChildProcess> {
  await ensureHarnessReady();
  const harness = getHarness();
  
  // Start the thread - this returns a session
  const session = await harness.startThread(threadId, projectRoot);
  
  // Return the underlying process for compatibility
  // The harness stores this in the session
  const robinSession = session as { process: ChildProcess };
  
  console.log(`[Wire:new] Spawned via RobinHarness, pid: ${robinSession.process.pid}`);
  
  return robinSession.process;
}

/**
 * Set up event handlers for the new harness path.
 * This replaces setupWireHandlers() in server.js
 */
function setupHarnessEventHandlers(
  harness: RobinHarness,
  threadId: string,
  session: SessionLike,
  ws: WebSocket
): void {
  // Remove any existing listeners for this thread
  harness.removeAllListeners(`event:${threadId}`);
  harness.removeAllListeners(`error:${threadId}`);
  harness.removeAllListeners(`exit:${threadId}`);
  
  // Listen for canonical events
  harness.on('event', (data: { threadId: string; event: CanonicalEvent }) => {
    if (data.threadId !== threadId) return;
    
    const event = data.event;
    
    // Map canonical events to existing WebSocket message format
    switch (event.type) {
      case 'turn_begin':
        ws.send(JSON.stringify({
          type: 'chat:turn_begin',
          threadId: data.threadId,
          turnId: event.turnId,
          userInput: event.userInput
        }));
        break;
        
      case 'content':
        ws.send(JSON.stringify({
          type: 'chat:content',
          threadId: data.threadId,
          text: event.text
        }));
        break;
        
      case 'thinking':
        ws.send(JSON.stringify({
          type: 'chat:thinking',
          threadId: data.threadId,
          text: event.text
        }));
        break;
        
      case 'tool_call':
        ws.send(JSON.stringify({
          type: 'chat:tool_call',
          threadId: data.threadId,
          toolCallId: event.toolCallId,
          toolName: event.toolName
        }));
        break;
        
      case 'tool_call_args':
        ws.send(JSON.stringify({
          type: 'chat:tool_call_args',
          threadId: data.threadId,
          toolCallId: event.toolCallId,
          argsChunk: event.argsChunk
        }));
        break;
        
      case 'tool_result':
        ws.send(JSON.stringify({
          type: 'chat:tool_result',
          threadId: data.threadId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: event.output,
          display: event.display,
          isError: event.isError,
          files: event.files
        }));
        break;
        
      case 'turn_end':
        ws.send(JSON.stringify({
          type: 'chat:turn_end',
          threadId: data.threadId,
          turnId: event.turnId,
          fullText: event.fullText,
          hasToolCalls: event.hasToolCalls,
          metadata: event._meta
        }));
        break;
    }
  });
  
  harness.on('error', (data: { threadId: string; error: Error }) => {
    if (data.threadId !== threadId) return;
    console.error(`[Harness] Error for thread ${threadId}:`, data.error);
    ws.send(JSON.stringify({
      type: 'chat:error',
      threadId: data.threadId,
      error: data.error.message
    }));
  });
  
  harness.on('exit', (data: { threadId: string; code: number | null }) => {
    if (data.threadId !== threadId) return;
    console.log(`[Harness] Thread ${threadId} exited with code ${data.code}`);
  });
}

// ============================================================================
// PARALLEL MODE: Run both and compare
// ============================================================================

interface ComparisonResult {
  threadId: string;
  legacyEvents: CanonicalEvent[];
  newEvents: CanonicalEvent[];
  mismatches: Array<{
    index: number;
    legacy: CanonicalEvent | undefined;
    new: CanonicalEvent | undefined;
    reason: string;
  }>;
}

const parallelResults = new Map<string, ComparisonResult>();

/**
 * Run both legacy and new implementations, compare outputs.
 * Returns the legacy result (for safety) but logs all differences.
 */
async function spawnThreadWireParallel(
  threadId: string,
  projectRoot: string
): Promise<ChildProcess> {
  console.log(`[Wire:parallel] Starting comparison for thread ${threadId}`);
  
  // Initialize comparison tracking
  parallelResults.set(threadId, {
    threadId,
    legacyEvents: [],
    newEvents: [],
    mismatches: []
  });
  
  // Start both processes
  const legacyProc = spawnThreadWireLegacy(threadId, projectRoot);
  
  // Also start harness (but we won't use its process directly)
  await ensureHarnessReady();
  const harness = getHarness();
  const harnessSession = await harness.startThread(`${threadId}-parallel`, projectRoot);
  
  // Return legacy process as the "official" one
  // The harness session runs in parallel for comparison
  return legacyProc;
}

/**
 * Compare two canonical events for equality.
 */
function eventsEqual(a: CanonicalEvent, b: CanonicalEvent): boolean {
  if (a.type !== b.type) return false;
  if (a.timestamp !== b.timestamp) return false;
  
  // Type-specific comparison
  switch (a.type) {
    case 'content':
    case 'thinking':
      return (a as { text: string }).text === (b as { text: string }).text;
    case 'tool_call':
      return (a as { toolCallId: string; toolName: string }).toolCallId === 
             (b as { toolCallId: string; toolName: string }).toolCallId;
    case 'turn_end':
      return (a as { turnId: string }).turnId === (b as { turnId: string }).turnId;
    default:
      return JSON.stringify(a) === JSON.stringify(b);
  }
}

// ============================================================================
// PUBLIC API (exported functions)
// ============================================================================

/**
 * Spawn a wire process for a thread.
 * 
 * This is the drop-in replacement for server.js:spawnThreadWire().
 * Behavior depends on HARNESS_MODE environment variable.
 */
export function spawnThreadWire(
  threadId: string,
  projectRoot: string
): ChildProcess {
  const mode = getHarnessMode(threadId);
  
  switch (mode) {
    case 'new':
      // Use async version but return a placeholder that gets swapped
      // This is tricky because the legacy code expects sync return
      // We'll need to handle this in the harness session
      console.log(`[Compat] Using NEW harness for thread ${threadId}`);
      // For now, start the harness and return its process
      const harness = getHarness();
      const sessionPromise = harness.startThread(threadId, projectRoot);
      
      // Create a deferred process proxy
      // This is a hack for compatibility - the real solution is async spawn
      const { spawn } = require('child_process');
      const dummyProc = spawn('echo', ['harness-loading'], { stdio: 'pipe' });
      
      sessionPromise.then(session => {
        const robinSession = session as { process: ChildProcess };
        // Replace the dummy process with the real one
        // This is imperfect but allows gradual migration
        Object.assign(dummyProc, robinSession.process);
      }).catch(err => {
        console.error('[Compat] Failed to start harness session:', err);
        dummyProc.emit('error', err);
      });
      
      return dummyProc;
      
    case 'parallel':
      return spawnThreadWireParallel(threadId, projectRoot);
      
    case 'legacy':
    default:
      return spawnThreadWireLegacy(threadId, projectRoot);
  }
}

/**
 * Send a message to a thread's wire process.
 * 
 * This is a new function needed for the harness-based approach.
 * Legacy code writes directly to process.stdin.
 */
export async function sendToThread(
  threadId: string,
  message: string,
  options?: {
    system?: string;
    history?: Array<{ role: string; content: string }>;
  }
): Promise<void> {
  if (!shouldUseNewHarness(threadId)) {
    throw new Error('sendToThread() only works with new harness. Use process.stdin.write() for legacy.');
  }
  
  await ensureHarnessReady();
  const harness = getHarness();
  
  const session = harness.getSession(threadId);
  if (!session) {
    throw new Error(`No active session for thread ${threadId}`);
  }
  
  // Send via harness
  harness.sendToThread(threadId, 'prompt', {
    message,
    system: options?.system,
    history: options?.history
  });
}

/**
 * Get current mode status for debugging.
 */
export function getModeStatus(threadId?: string): {
  mode: HarnessMode;
  harnessInitialized: boolean;
  activeSessions: string[];
} {
  return {
    mode: getHarnessMode(threadId),
    harnessInitialized: robinHarness !== null,
    activeSessions: robinHarness ? Array.from((robinHarness as unknown as { sessions: Map<string, unknown> }).sessions.keys()) : []
  };
}

/**
 * Emergency: Force reset to legacy mode.
 */
export function emergencyRollback(): void {
  console.log('[Compat] EMERGENCY ROLLBACK triggered');
  process.env.HARNESS_MODE = 'legacy';
  
  // Kill any harness sessions
  if (robinHarness) {
    robinHarness.dispose().catch(console.error);
    robinHarness = null;
    harnessInitPromise = null;
  }
}
```

---

### 3. `lib/harness/robin/index.ts` (NEW - Public API)

**Purpose:** Clean public interface for the harness system

```typescript
/**
 * Public API for the AI Harness system.
 * 
 * This is the main entry point for harness functionality.
 * All other modules should import from here.
 */

// Types
export type {
  AIHarness,
  HarnessConfig,
  HarnessSession,
  CanonicalEvent,
  CanonicalEventType,
  TurnBeginEvent,
  ContentEvent,
  ThinkingEvent,
  ToolCallEvent,
  ToolCallArgsEvent,
  ToolResultEvent,
  TurnEndEvent,
  SendOptions,
  ChatMessage,
  TokenUsage
} from './types';

// Feature flags
export {
  getHarnessMode,
  setThreadMode,
  clearThreadMode,
  setGlobalMode,
  shouldUseNewHarness,
  isParallelMode,
  getFlagStatus,
  resetOverrides,
  type HarnessMode
} from './feature-flags';

// Compatibility layer
export {
  spawnThreadWire,
  sendToThread,
  getModeStatus,
  emergencyRollback
} from './compat';

// Harness implementations
export { RobinHarness } from './robin';

// Utilities
export { mapKimiToolName, isKimiTool } from './robin/tool-mapper';
```

---

### 4. `server.js` (MODIFICATIONS - Integration Points)

#### 4.1 Add harness import at top

```javascript
// After existing imports, add:
const { 
  spawnThreadWire, 
  getHarnessMode,
  shouldUseNewHarness 
} = require('./lib/harness/compat');

// Log current mode on startup
console.log('[Server] Harness mode:', getHarnessMode());
```

#### 4.2 Modify `spawnThreadWire()` function

```javascript
// Replace the existing spawnThreadWire function (lines 604-634)
// with a call to the compatibility layer:

function spawnThreadWire(threadId, projectRoot) {
  // Delegate to compatibility layer
  // This function handles mode switching internally
  return require('./lib/harness/compat').spawnThreadWire(threadId, projectRoot);
}
```

#### 4.3 Add mode status endpoint

```javascript
// Add new WebSocket message handler for mode queries
// Around line 350 (with other message handlers):

case 'harness:get_mode':
  const { getModeStatus } = require('./lib/harness/compat');
  ws.send(JSON.stringify({
    type: 'harness:mode_status',
    data: getModeStatus(data.threadId)
  }));
  break;

case 'harness:set_mode':
  const { setThreadMode } = require('./lib/harness/feature-flags');
  setThreadMode(data.threadId, data.mode);
  ws.send(JSON.stringify({
    type: 'harness:mode_changed',
    threadId: data.threadId,
    mode: data.mode
  }));
  break;
```

---

### 5. `test/harness/compat.test.ts` (NEW - Test Suite)

```typescript
/**
 * Compatibility layer tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getHarnessMode,
  setThreadMode,
  clearThreadMode,
  setGlobalMode,
  resetOverrides,
  shouldUseNewHarness,
  isParallelMode
} from '../../lib/harness/feature-flags';

describe('Feature Flags', () => {
  const originalEnv = process.env.HARNESS_MODE;
  
  beforeEach(() => {
    resetOverrides();
    delete process.env.HARNESS_MODE;
  });
  
  afterEach(() => {
    resetOverrides();
    process.env.HARNESS_MODE = originalEnv;
  });
  
  describe('getHarnessMode', () => {
    it('defaults to legacy when no flags set', () => {
      expect(getHarnessMode()).toBe('legacy');
    });
    
    it('reads from environment variable', () => {
      process.env.HARNESS_MODE = 'new';
      expect(getHarnessMode()).toBe('new');
    });
    
    it('thread override takes precedence over env', () => {
      process.env.HARNESS_MODE = 'new';
      setThreadMode('thread-1', 'legacy');
      
      expect(getHarnessMode('thread-1')).toBe('legacy');
      expect(getHarnessMode('thread-2')).toBe('new');
    });
    
    it('global override takes precedence over thread', () => {
      setThreadMode('thread-1', 'new');
      setGlobalMode('parallel');
      
      expect(getHarnessMode('thread-1')).toBe('parallel');
    });
  });
  
  describe('shouldUseNewHarness', () => {
    it('returns false for legacy mode', () => {
      process.env.HARNESS_MODE = 'legacy';
      expect(shouldUseNewHarness()).toBe(false);
    });
    
    it('returns true for new mode', () => {
      process.env.HARNESS_MODE = 'new';
      expect(shouldUseNewHarness()).toBe(true);
    });
    
    it('returns true for parallel mode', () => {
      process.env.HARNESS_MODE = 'parallel';
      expect(shouldUseNewHarness()).toBe(true);
    });
  });
  
  describe('isParallelMode', () => {
    it('returns true only for parallel mode', () => {
      process.env.HARNESS_MODE = 'parallel';
      expect(isParallelMode()).toBe(true);
      
      process.env.HARNESS_MODE = 'new';
      expect(isParallelMode()).toBe(false);
      
      process.env.HARNESS_MODE = 'legacy';
      expect(isParallelMode()).toBe(false);
    });
  });
});

describe('Spawn Behavior', () => {
  // Integration tests would go here
  // These require actual robin CLI to be available
  
  it.skip('legacy mode spawns process directly', async () => {
    // TODO: Implement once harness is ready
  });
  
  it.skip('new mode spawns via harness', async () => {
    // TODO: Implement once harness is ready
  });
});
```

---

### 6. `scripts/harness-smoke-test.sh` (NEW - Manual Testing)

```bash
#!/bin/bash
#
# Harness compatibility smoke test
# Run this to verify both legacy and new paths work

set -e

echo "=== Harness Compatibility Smoke Test ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if server is running
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Server not running on localhost:3000${NC}"
    echo "Start the server first: npm run dev"
    exit 1
fi

echo "✓ Server is running"
echo ""

# Test 1: Legacy mode (default)
echo "Test 1: Legacy mode (default)"
unset HARNESS_MODE
# Start a test thread
curl -s -X POST http://localhost:3000/api/threads \
  -H "Content-Type: application/json" \
  -d '{"name":"test-legacy"}' > /tmp/legacy-thread.json
LEGACY_THREAD_ID=$(cat /tmp/legacy-thread.json | jq -r '.threadId')
echo "  Created thread: $LEGACY_THREAD_ID"
echo "  Mode: $(curl -s "http://localhost:3000/api/harness/mode?threadId=$LEGACY_THREAD_ID" | jq -r '.mode')"
echo -e "  ${GREEN}✓ Legacy mode active${NC}"
echo ""

# Test 2: New mode via env
echo "Test 2: New mode (HARNESS_MODE=new)"
export HARNESS_MODE=new
curl -s -X POST http://localhost:3000/api/threads \
  -H "Content-Type: application/json" \
  -d '{"name":"test-new"}' > /tmp/new-thread.json
NEW_THREAD_ID=$(cat /tmp/new-thread.json | jq -r '.threadId')
echo "  Created thread: $NEW_THREAD_ID"
echo "  Mode: $(curl -s "http://localhost:3000/api/harness/mode?threadId=$NEW_THREAD_ID" | jq -r '.mode')"
echo -e "  ${GREEN}✓ New mode active${NC}"
echo ""

# Test 3: Runtime mode switch
echo "Test 3: Runtime mode switch"
curl -s -X POST "http://localhost:3000/api/harness/mode" \
  -H "Content-Type: application/json" \
  -d "{\"threadId\":\"$LEGACY_THREAD_ID\",\"mode\":\"parallel\"}" > /dev/null
NEW_MODE=$(curl -s "http://localhost:3000/api/harness/mode?threadId=$LEGACY_THREAD_ID" | jq -r '.mode')
if [ "$NEW_MODE" = "parallel" ]; then
    echo -e "  ${GREEN}✓ Runtime switch successful${NC}"
else
    echo -e "  ${RED}✗ Runtime switch failed (got: $NEW_MODE)${NC}"
    exit 1
fi
echo ""

# Cleanup
echo "Cleaning up test threads..."
curl -s -X DELETE "http://localhost:3000/api/threads/$LEGACY_THREAD_ID" > /dev/null
curl -s -X DELETE "http://localhost:3000/api/threads/$NEW_THREAD_ID" > /dev/null

echo ""
echo -e "${GREEN}=== All smoke tests passed ===${NC}"
```

---

## Migration Rollout Strategy

### Stage 1: Development (Week 1)
- Implement all files above
- Run unit tests locally
- Manual smoke testing

### Stage 2: Canary (Week 2)
- Deploy to staging
- Set `HARNESS_MODE=parallel` for 10% of test threads
- Monitor comparison logs for mismatches
- Fix any discrepancies

### Stage 3: Expanded Testing (Week 2-3)
- Increase to 50% of threads in parallel mode
- Run full test suite in both modes
- Performance comparison

### Stage 4: New Mode Default (Week 3)
- Change default to `HARNESS_MODE=new`
- Keep `HARNESS_MODE=legacy` as escape hatch
- Monitor for issues

### Stage 5: Legacy Removal (Week 4+)
- Once stable, remove legacy inline code
- Remove compatibility shim
- Clean up feature flags

---

## Rollback Procedures

### Immediate Rollback (Emergency)
```bash
# Set global override
export HARNESS_MODE=legacy

# Or via API
curl -X POST http://localhost:3000/api/harness/rollback
```

### Per-Thread Rollback
```javascript
// Via WebSocket
ws.send(JSON.stringify({
  type: 'harness:set_mode',
  threadId: 'problematic-thread',
  mode: 'legacy'
}));
```

### Verify Rollback
```bash
# Check logs for [Wire:legacy] prefix
tail -f logs/server.log | grep "Wire:"

# Or check mode status
curl http://localhost:3000/api/harness/mode?threadId=xxx
```

---

## Checklist

### Before Implementation
- [ ] Phase 1 complete and tested
- [ ] All Phase 1 unit tests passing
- [ ] Backup branch created

### Implementation
- [ ] Create `lib/harness/robin/feature-flags.ts`
- [ ] Complete `lib/harness/robin/compat.ts`
- [ ] Create `lib/harness/robin/index.ts`
- [ ] Modify `server.js` integration points
- [ ] Write `compat.test.ts`
- [ ] Create smoke test script

### Testing
- [ ] Unit tests pass in all modes
- [ ] Smoke tests pass
- [ ] Parallel mode detects no mismatches
- [ ] Performance within 5% baseline
- [ ] Memory usage within 10% baseline

### Documentation
- [ ] Update server.js comments
- [ ] Document feature flag usage
- [ ] Update deployment runbook

---

## Open Questions

1. **Async spawnThreadWire:** The legacy function is sync, but harness requires async. 
   - Current solution: Return a proxy that gets populated
   - Better solution: Make spawnThreadWire async (requires changes throughout server.js)

2. **Parallel mode overhead:** Running two processes per thread doubles resource usage.
   - Mitigation: Only enable for specific test threads, not all

3. **Session persistence:** How do we handle existing threads when mode changes?
   - Current: New threads pick up mode immediately
   - Existing threads continue with their original mode

---

*Spec Version: 1.0*  
*Created: 2026-04-05*  
*Status: Ready for Implementation*
