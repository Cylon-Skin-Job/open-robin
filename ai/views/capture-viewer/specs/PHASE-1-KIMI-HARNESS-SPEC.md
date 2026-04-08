# Phase 1: Robin Harness Extraction Spec

**Status:** Draft  
**Version:** 1.0  
**Target Completion:** Week 1  
**Risk Level:** Low (no behavioral changes)

---

## Objective

Extract all inline KIMI CLI wire handling from `server.js` into a dedicated, testable `RobinHarness` class in `lib/harness/robin/` without changing any behavior. Create a compatibility shim to ensure existing code continues to work during the transition.

---

## Success Criteria

1. ✅ All wire-related code removed from `server.js` (only delegation calls remain)
2. ✅ `RobinHarness` class passes integration tests against recorded wire traffic
3. ✅ Zero behavioral changes (byte-for-byte identical output)
4. ✅ Compatibility shim allows instant rollback via feature flag
5. ✅ All existing tests pass without modification

---

## Files to Create

### 1. `lib/harness/robin/types.ts`
**Purpose:** Canonical type definitions shared across all harnesses

```typescript
/**
 * Canonical event types - all harnesses emit these
 */
export type CanonicalEventType = 
  | 'turn_begin'
  | 'content' 
  | 'thinking'
  | 'tool_call'
  | 'tool_call_args'
  | 'tool_result'
  | 'turn_end';

/**
 * Base event interface
 */
export interface CanonicalEvent {
  type: CanonicalEventType;
  timestamp: number;
  turnId?: string;
}

/**
 * Turn begin event
 */
export interface TurnBeginEvent extends CanonicalEvent {
  type: 'turn_begin';
  turnId: string;
  userInput: string;
}

/**
 * Content chunk event (streaming text)
 */
export interface ContentEvent extends CanonicalEvent {
  type: 'content';
  text: string;
}

/**
 * Thinking block event
 */
export interface ThinkingEvent extends CanonicalEvent {
  type: 'thinking';
  text: string;
}

/**
 * Tool call initiation
 */
export interface ToolCallEvent extends CanonicalEvent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;  // Canonical name (read, not ReadFile)
}

/**
 * Tool call arguments (streaming JSON)
 */
export interface ToolCallArgsEvent extends CanonicalEvent {
  type: 'tool_call_args';
  toolCallId: string;
  argsChunk: string;
}

/**
 * Tool execution result
 */
export interface ToolResultEvent extends CanonicalEvent {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  output: string;
  display: unknown[];
  isError: boolean;
  files?: string[];
}

/**
 * Turn completion with metadata
 */
export interface TurnEndEvent extends CanonicalEvent {
  type: 'turn_end';
  turnId: string;
  fullText: string;
  hasToolCalls: boolean;
  _meta?: {
    messageId?: string;
    tokenUsage?: TokenUsage;
    contextUsage?: number;
    planMode?: boolean;
    harnessId?: string;
    provider?: string;
    model?: string;
  };
}

export interface TokenUsage {
  input_other?: number;
  input_cache_read?: number;
  input_cache_creation?: number;
  output?: number;
}

/**
 * AI Harness interface - implemented by all harnesses
 */
export interface AIHarness {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  
  initialize(config: HarnessConfig): Promise<void>;
  startThread(threadId: string, projectRoot: string): Promise<HarnessSession>;
  dispose(): Promise<void>;
}

export interface HarnessConfig {
  cliPath?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxSteps?: number;
}

export interface HarnessSession {
  threadId: string;
  sendMessage(message: string, options?: SendOptions): AsyncIterable<CanonicalEvent>;
  stop(): Promise<void>;
}

export interface SendOptions {
  system?: string;
  history?: ChatMessage[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
```

---

### 2. `lib/harness/robin/tool-mapper.ts`
**Purpose:** Kimi-specific tool name mapping

```typescript
/**
 * Kimi CLI uses PascalCase tool names.
 * We map to canonical lowercase for consistent UI handling.
 */
export const KIMI_TO_CANONICAL_MAP: Record<string, string> = {
  'ReadFile': 'read',
  'WriteFile': 'write',
  'EditFile': 'edit',
  'Bash': 'shell',
  'Glob': 'glob',
  'Grep': 'grep',
  'WebSearch': 'web_search',
  'WebFetch': 'fetch',
  'Agent': 'subagent',
  'TodoWrite': 'todo'
};

/**
 * Map a Kimi tool name to its canonical form.
 * Unknown tools are lowercased but preserve their original name.
 */
export function mapKimiToolName(kimiName: string): string {
  return KIMI_TO_CANONICAL_MAP[kimiName] || kimiName.toLowerCase();
}

/**
 * Check if a tool name is a valid Kimi tool.
 */
export function isKimiTool(name: string): boolean {
  return name in KIMI_TO_CANONICAL_MAP;
}
```

---

### 3. `lib/harness/robin/wire-parser.ts`
**Purpose:** Line-buffered JSON-RPC parser for Kimi wire protocol

```typescript
import { EventEmitter } from 'events';

/**
 * Raw wire message from Kimi CLI (JSON-RPC 2.0)
 */
export interface WireMessage {
  jsonrpc: '2.0';
  method?: string;
  id?: string;
  params?: {
    type?: string;
    payload?: unknown;
  };
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Parses newline-delimited JSON-RPC from Kimi CLI.
 * 
 * Mirrors current behavior in server.js:714-734 exactly.
 */
export class WireParser extends EventEmitter {
  private buffer = '';
  private lineCount = 0;

  /**
   * Feed data from stdout into the parser.
   * Emits 'message' for each complete JSON-RPC message.
   * Emits 'parse_error' for invalid JSON.
   */
  feed(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      this.lineCount++;
      if (!line.trim()) continue;
      
      try {
        const msg = JSON.parse(line) as WireMessage;
        this.emit('message', msg);
      } catch (err) {
        this.emit('parse_error', line, err, this.lineCount);
      }
    }
  }

  /**
   * Get any remaining buffered content.
   * Useful for debugging incomplete messages.
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.buffer = '';
    this.lineCount = 0;
  }
}
```

---

### 4. `lib/harness/robin/session-state.ts`
**Purpose:** Session state management (extracted from server.js session object)

```typescript
import { CanonicalEvent } from '../types';

/**
 * Tool call in progress
 */
export interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  argsBuffer: string;
}

/**
 * Assistant response part (mirrors current server.js structure)
 */
export interface AssistantPart {
  type: 'text' | 'think' | 'tool_call';
  content?: string;
  toolCallId?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  result?: {
    output: string;
    display: unknown[];
    error?: string;
    files?: string[];
  };
}

/**
 * Current turn tracking
 */
export interface CurrentTurn {
  id: string;
  text: string;
  userInput: string;
}

/**
 * Session state for a single thread.
 * Mirrors server.js:666-680 exactly.
 */
export class RobinSessionState {
  currentTurn: CurrentTurn | null = null;
  assistantParts: AssistantPart[] = [];
  toolArgs: Record<string, string> = {};
  activeToolId: string | null = null;
  hasToolCalls = false;
  
  // Metadata accumulation
  contextUsage: number | null = null;
  tokenUsage: { input_other?: number; input_cache_read?: number; input_cache_creation?: number; output?: number } | null = null;
  messageId: string | null = null;
  planMode = false;

  /**
   * Reset for a new turn
   */
  resetTurn(): void {
    this.currentTurn = null;
    this.assistantParts = [];
    this.toolArgs = {};
    this.activeToolId = null;
    this.hasToolCalls = false;
    // Note: contextUsage, tokenUsage, messageId, planMode are reset on TurnEnd
  }

  /**
   * Reset metadata (called after TurnEnd)
   */
  resetMetadata(): void {
    this.contextUsage = null;
    this.tokenUsage = null;
    this.messageId = null;
    this.planMode = false;
  }

  /**
   * Accumulate text content
   */
  addText(text: string): void {
    const lastPart = this.assistantParts[this.assistantParts.length - 1];
    if (lastPart?.type === 'text') {
      lastPart.content = (lastPart.content || '') + text;
    } else {
      this.assistantParts.push({ type: 'text', content: text });
    }
  }

  /**
   * Accumulate thinking content
   */
  addThinking(text: string): void {
    const lastPart = this.assistantParts[this.assistantParts.length - 1];
    if (lastPart?.type === 'think') {
      lastPart.content = (lastPart.content || '') + text;
    } else {
      this.assistantParts.push({ type: 'think', content: text });
    }
  }

  /**
   * Start tracking a tool call
   */
  startToolCall(toolCallId: string, toolName: string): void {
    this.hasToolCalls = true;
    this.activeToolId = toolCallId;
    this.toolArgs[toolCallId] = '';
    this.assistantParts.push({
      type: 'tool_call',
      toolCallId,
      name: toolName,
      arguments: {},
      result: { output: '', display: [] }
    });
  }

  /**
   * Accumulate tool call arguments
   */
  addToolArgs(toolCallId: string, argsChunk: string): void {
    if (this.toolArgs[toolCallId] !== undefined) {
      this.toolArgs[toolCallId] += argsChunk;
    }
  }

  /**
   * Complete a tool call with result
   */
  completeToolCall(toolCallId: string, toolName: string, result: {
    output: string;
    display: unknown[];
    is_error?: boolean;
    files?: string[];
  }): void {
    const toolPart = this.assistantParts.find(
      p => p.type === 'tool_call' && p.name === toolName
    );
    
    if (toolPart) {
      try {
        toolPart.arguments = JSON.parse(this.toolArgs[toolCallId] || '{}');
      } catch {
        toolPart.arguments = {};
      }
      toolPart.result = {
        output: result.output,
        display: result.display,
        error: result.is_error ? result.output : undefined,
        files: result.files
      };
    }
    
    delete this.toolArgs[toolCallId];
  }
}
```

---

### 5. `lib/harness/robin/event-translator.ts`
**Purpose:** Translate Kimi wire events to canonical events

```typescript
import {
  CanonicalEvent,
  TurnBeginEvent,
  ContentEvent,
  ThinkingEvent,
  ToolCallEvent,
  ToolCallArgsEvent,
  ToolResultEvent,
  TurnEndEvent
} from '../types';
import { WireMessage } from './wire-parser';
import { RobinSessionState } from './session-state';
import { mapKimiToolName } from './tool-mapper';

/**
 * Translates Kimi wire protocol events to canonical events.
 * 
 * This is the core transformation logic extracted from server.js:761-982.
 */
export class EventTranslator {
  private state: RobinSessionState;

  constructor(state: RobinSessionState) {
    this.state = state;
  }

  /**
   * Translate a wire message to canonical event(s).
   * Returns null if the message type is not handled.
   */
  translate(msg: WireMessage): CanonicalEvent | CanonicalEvent[] | null {
    if (msg.method !== 'event' || !msg.params) {
      return null;
    }

    const { type: eventType, payload } = msg.params as {
      type: string;
      payload?: Record<string, unknown>;
    };

    const timestamp = Date.now();

    switch (eventType) {
      case 'TurnBegin':
        return this.handleTurnBegin(payload, timestamp);
      
      case 'ContentPart':
        return this.handleContentPart(payload, timestamp);
      
      case 'ToolCall':
        return this.handleToolCall(payload, timestamp);
      
      case 'ToolCallPart':
        return this.handleToolCallPart(payload, timestamp);
      
      case 'ToolResult':
        return this.handleToolResult(payload, timestamp);
      
      case 'TurnEnd':
        return this.handleTurnEnd(timestamp);
      
      case 'StatusUpdate':
        return this.handleStatusUpdate(payload);
      
      default:
        return null;
    }
  }

  private handleTurnBegin(
    payload: Record<string, unknown> | undefined,
    timestamp: number
  ): TurnBeginEvent {
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const userInput = String(payload?.user_input || '');

    this.state.resetTurn();
    this.state.currentTurn = {
      id: turnId,
      text: '',
      userInput
    };

    return {
      type: 'turn_begin',
      timestamp,
      turnId,
      userInput
    };
  }

  private handleContentPart(
    payload: Record<string, unknown> | undefined,
    timestamp: number
  ): ContentEvent | ThinkingEvent | null {
    const contentType = payload?.type as string;

    if (contentType === 'text') {
      const text = String(payload?.text || '');
      if (this.state.currentTurn) {
        this.state.currentTurn.text += text;
      }
      this.state.addText(text);
      return { type: 'content', timestamp, text };
    }

    if (contentType === 'think') {
      const text = String(payload?.think || '');
      this.state.addThinking(text);
      return { type: 'thinking', timestamp, text };
    }

    return null;
  }

  private handleToolCall(
    payload: Record<string, unknown> | undefined,
    timestamp: number
  ): ToolCallEvent {
    const toolCallId = String(payload?.id || '');
    const kimiToolName = String((payload?.function as Record<string, unknown>)?.name || 'unknown');
    const toolName = mapKimiToolName(kimiToolName);

    this.state.startToolCall(toolCallId, toolName);

    return {
      type: 'tool_call',
      timestamp,
      toolCallId,
      toolName
    };
  }

  private handleToolCallPart(
    payload: Record<string, unknown> | undefined,
    timestamp: number
  ): ToolCallArgsEvent | null {
    const toolCallId = this.state.activeToolId;
    const argsChunk = String(payload?.arguments_part || '');

    if (toolCallId && argsChunk) {
      this.state.addToolArgs(toolCallId, argsChunk);
      return {
        type: 'tool_call_args',
        timestamp,
        toolCallId,
        argsChunk
      };
    }

    return null;
  }

  private handleToolResult(
    payload: Record<string, unknown> | undefined,
    timestamp: number
  ): ToolResultEvent {
    const toolCallId = String(payload?.tool_call_id || '');
    const kimiToolName = String((payload?.function as Record<string, unknown>)?.name || 'unknown');
    const toolName = mapKimiToolName(kimiToolName);
    const returnValue = payload?.return_value as Record<string, unknown> || {};

    this.state.completeToolCall(toolCallId, toolName, {
      output: String(returnValue.output || ''),
      display: (returnValue.display as unknown[]) || [],
      is_error: Boolean(returnValue.is_error),
      files: (returnValue.files as string[]) || []
    });

    // Parse accumulated args for the event
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(this.state.toolArgs[toolCallId] || '{}');
    } catch {
      // Leave as empty object on parse failure
    }

    return {
      type: 'tool_result',
      timestamp,
      toolCallId,
      toolName,
      output: String(returnValue.output || ''),
      display: (returnValue.display as unknown[]) || [],
      isError: Boolean(returnValue.is_error),
      files: (returnValue.files as string[]) || []
    };
  }

  private handleTurnEnd(timestamp: number): TurnEndEvent | null {
    if (!this.state.currentTurn) {
      return null;
    }

    const turnId = this.state.currentTurn.id;
    const fullText = this.state.currentTurn.text;
    const hasToolCalls = this.state.hasToolCalls;

    const event: TurnEndEvent = {
      type: 'turn_end',
      timestamp,
      turnId,
      fullText,
      hasToolCalls,
      _meta: {
        messageId: this.state.messageId || undefined,
        tokenUsage: this.state.tokenUsage || undefined,
        contextUsage: this.state.contextUsage || undefined,
        planMode: this.state.planMode,
        harnessId: 'kimi',
        provider: 'kimi',
        model: 'k1.6'
      }
    };

    this.state.resetMetadata();
    // Note: state.resetTurn() is called on next TurnBegin

    return event;
  }

  private handleStatusUpdate(
    payload: Record<string, unknown> | undefined
  ): null {
    // StatusUpdate doesn't emit a canonical event directly
    // Instead, it updates state for the next TurnEnd
    this.state.contextUsage = payload?.context_usage as number ?? null;
    this.state.tokenUsage = payload?.token_usage as RobinSessionState['tokenUsage'] ?? null;
    this.state.messageId = String(payload?.message_id || '');
    this.state.planMode = Boolean(payload?.plan_mode);
    return null;
  }
}
```

---

### 6. `lib/harness/robin/index.ts`
**Purpose:** Main KIMI harness implementation

```typescript
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
  AIHarness,
  HarnessConfig,
  HarnessSession,
  CanonicalEvent,
  SendOptions
} from '../types';
import { WireParser, WireMessage } from './wire-parser';
import { EventTranslator } from './event-translator';
import { RobinSessionState } from './session-state';

interface RobinSession extends HarnessSession {
  process: ChildProcess;
  state: RobinSessionState;
  parser: WireParser;
}

/**
 * KIMI CLI harness implementation.
 * 
 * Wraps `kimi --wire --yolo` and translates JSON-RPC protocol
 * to canonical events.
 */
export class RobinHarness extends EventEmitter implements AIHarness {
  readonly id = 'kimi';
  readonly name = 'Kimi CLI';
  readonly provider = 'kimi';
  
  private config: HarnessConfig = {};
  private sessions = new Map<string, RobinSession>();

  async initialize(config: HarnessConfig): Promise<void> {
    this.config = { ...this.config, ...config };
  }

  async startThread(threadId: string, projectRoot: string): Promise<HarnessSession> {
    const kimiPath = this.config.cliPath || process.env.KIMI_PATH || 'kimi';
    const args = ['--wire', '--yolo', '--session', threadId];
    
    if (projectRoot) {
      args.push('--work-dir', projectRoot);
    }

    const proc = spawn(kimiPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    // Log spawn for debugging
    console.log(`[RobinHarness] Spawned ${kimiPath} ${args.join(' ')} (pid: ${proc.pid})`);

    const state = new RobinSessionState();
    const parser = new WireParser();
    const translator = new EventTranslator(state);

    const session: RobinSession = {
      threadId,
      process: proc,
      state,
      parser,
      async *sendMessage(message: string, options?: SendOptions): AsyncIterable<CanonicalEvent> {
        // Send initialize handshake if needed
        // Send prompt
        // Yield events as they arrive
      },
      async stop(): Promise<void> {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      }
    };

    // Set up stdout parsing
    proc.stdout.on('data', (data: Buffer) => {
      parser.feed(data.toString());
    });

    // Handle parse errors
    parser.on('parse_error', (line: string, err: Error, lineNum: number) => {
      console.error(`[RobinHarness] Parse error at line ${lineNum}:`, err.message);
      this.emit('parse_error', { threadId, line, error: err, lineNum });
    });

    // Handle wire messages
    parser.on('message', (msg: WireMessage) => {
      const events = translator.translate(msg);
      if (events) {
        const eventArray = Array.isArray(events) ? events : [events];
        for (const event of eventArray) {
          this.emit('event', { threadId, event });
        }
      }
    });

    // Handle process events
    proc.on('error', (err) => {
      console.error(`[RobinHarness] Process error (pid: ${proc.pid}):`, err.message);
      this.emit('error', { threadId, error: err });
    });

    proc.on('exit', (code) => {
      console.log(`[RobinHarness] Process exited (pid: ${proc.pid}, code: ${code})`);
      this.sessions.delete(threadId);
      this.emit('exit', { threadId, code });
    });

    proc.stderr.on('data', (data: Buffer) => {
      console.error(`[RobinHarness:stderr] ${data.toString().trim()}`);
    });

    this.sessions.set(threadId, session);
    return session;
  }

  async dispose(): Promise<void> {
    // Kill all active sessions
    for (const [threadId, session] of this.sessions) {
      await session.stop();
    }
    this.sessions.clear();
  }

  /**
   * Get an active session by thread ID.
   */
  getSession(threadId: string): RobinSession | undefined {
    return this.sessions.get(threadId);
  }

  /**
   * Send a message to a specific thread's wire process.
   * This is the low-level method; most callers should use session.sendMessage().
   */
  sendToThread(threadId: string, method: string, params: unknown, id?: string): boolean {
    const session = this.sessions.get(threadId);
    if (!session || session.process.killed) {
      return false;
    }

    const message = {
      jsonrpc: '2.0',
      method,
      params,
      ...(id && { id })
    };

    const json = JSON.stringify(message);
    session.process.stdin.write(json + '\n');
    return true;
  }
}
```

---

## Files to Modify

### 7. `lib/harness/robin/compat.ts` (NEW - Compatibility Shim)
**Purpose:** Maintain exact same interface as current server.js exports

```typescript
/**
 * Compatibility shim for gradual migration.
 * 
 * This module exports functions with identical signatures to the
 * current inline implementations in server.js.
 * 
 * Set USE_NEW_HARNESS=true to use new implementation.
 * Default is legacy for safety.
 */

import { spawn, ChildProcess } from 'child_process';
import { RobinHarness } from './robin';

const USE_NEW_HARNESS = process.env.USE_NEW_HARNESS === 'true';

// Singleton harness instance
let harness: RobinHarness | null = null;

function getHarness(): RobinHarness {
  if (!harness) {
    harness = new RobinHarness();
    harness.initialize({}).catch(console.error);
  }
  return harness;
}

/**
 * Spawn a wire process for a thread.
 * Signature matches server.js:spawnThreadWire exactly.
 */
export function spawnThreadWire(threadId: string, projectRoot: string): ChildProcess {
  if (USE_NEW_HARNESS) {
    const h = getHarness();
    // Start thread and return the process handle
    const startPromise = h.startThread(threadId, projectRoot);
    // Return a proxy that looks like a ChildProcess
    // This is tricky - we may need to return a promise-wrapped process
    // For now, fall through to legacy
  }

  // Legacy implementation (copied from server.js:604-634)
  const kimiPath = process.env.KIMI_PATH || 'kimi';
  const args = ['--wire', '--yolo', '--session', threadId];
  
  if (projectRoot) {
    args.push('--work-dir', projectRoot);
  }
  
  const { spawn } = require('child_process');
  const proc = spawn(kimiPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color' }
  });
  
  console.log(`[Wire] Spawning thread session: ${kimiPath} ${args.join(' ')}`);
  console.log(`[Wire] Spawned with pid: ${proc.pid}`);
  
  proc.on('error', (err: Error) => {
    console.error('[Wire] Failed to spawn:', err.message);
  });
  
  proc.on('exit', (code: number) => {
    console.log(`[Wire] Process ${proc.pid} exited with code ${code}`);
  });
  
  proc.stderr.on('data', (data: Buffer) => {
    console.error('[Wire stderr]:', data.toString().trim());
  });
  
  return proc;
}

/**
 * Feature flag check.
 */
export function isNewHarnessEnabled(): boolean {
  return USE_NEW_HARNESS;
}
```

---

### 8. `server.js` (MODIFY - Gradual Migration)

Add at top of file (after imports):
```javascript
// Phase 1: Harness extraction compatibility
const { spawnThreadWire: spawnThreadWireNew, isNewHarnessEnabled } = require('./lib/harness/robin/compat');
const USE_NEW_HARNESS = isNewHarnessEnabled();
```

Replace `spawnThreadWire()` (lines 604-634):
```javascript
function spawnThreadWire(threadId, projectRoot) {
  if (USE_NEW_HARNESS) {
    return spawnThreadWireNew(threadId, projectRoot);
  }
  
  // Legacy implementation stays for now
  // ... (current code remains)
}
```

---

## Testing Strategy

### Unit Tests: `lib/harness/robin/__tests__/`

#### `wire-parser.test.ts`
```typescript
describe('WireParser', () => {
  it('should buffer incomplete lines', () => {
    const parser = new WireParser();
    const messages: WireMessage[] = [];
    parser.on('message', (m) => messages.push(m));
    
    parser.feed('{"jsonrpc":"2.0","method":"eve');
    parser.feed('nt","params":{"type":"TurnBe');
    parser.feed('gin","payload":{}}}\n');
    
    expect(messages).toHaveLength(1);
    expect(messages[0].params?.type).toBe('TurnBegin');
  });

  it('should emit parse_error for invalid JSON', () => {
    const parser = new WireParser();
    const errors: unknown[] = [];
    parser.on('parse_error', (...args) => errors.push(args));
    
    parser.feed('not valid json\n');
    
    expect(errors).toHaveLength(1);
  });
});
```

#### `event-translator.test.ts`
```typescript
describe('EventTranslator', () => {
  it('should translate TurnBegin to canonical turn_begin', () => {
    const state = new RobinSessionState();
    const translator = new EventTranslator(state);
    
    const msg = {
      jsonrpc: '2.0' as const,
      method: 'event',
      params: {
        type: 'TurnBegin',
        payload: { user_input: 'Hello' }
      }
    };
    
    const event = translator.translate(msg);
    
    expect(event).toMatchObject({
      type: 'turn_begin',
      userInput: 'Hello'
    });
  });

  it('should map Kimi tool names to canonical', () => {
    const state = new RobinSessionState();
    const translator = new EventTranslator(state);
    
    // First TurnBegin to initialize state
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'TurnBegin', payload: {} }
    });
    
    const msg = {
      jsonrpc: '2.0' as const,
      method: 'event',
      params: {
        type: 'ToolCall',
        payload: {
          id: 'tc-1',
          function: { name: 'ReadFile' }
        }
      }
    };
    
    const event = translator.translate(msg) as ToolCallEvent;
    
    expect(event.toolName).toBe('read'); // Not 'ReadFile'
  });
});
```

### Integration Tests

#### `recorded-traffic.test.ts`
```typescript
/**
 * Replay actual captured wire traffic to verify byte-for-byte compatibility.
 */
describe('RobinHarness with recorded traffic', () => {
  it('should process sample-conversation.jsonl', async () => {
    const lines = fs.readFileSync('fixtures/sample-conversation.jsonl', 'utf-8')
      .split('\n')
      .filter(Boolean);
    
    const state = new RobinSessionState();
    const translator = new EventTranslator(state);
    const events: CanonicalEvent[] = [];
    
    for (const line of lines) {
      const msg = JSON.parse(line);
      const event = translator.translate(msg);
      if (event) {
        events.push(...(Array.isArray(event) ? event : [event]));
      }
    }
    
    // Verify event sequence matches expected
    expect(events.map(e => e.type)).toEqual([
      'turn_begin',
      'content',
      'tool_call',
      'tool_call_args',
      'tool_result',
      'turn_end'
    ]);
  });
});
```

---

## Rollback Procedure

If issues are detected:

1. **Immediate:** Set `USE_NEW_HARNESS=false` (or unset) and restart server
2. **Verify:** Check logs show `[Wire]` instead of `[RobinHarness]`
3. **Debug:** Analyze captured wire traffic vs expected
4. **Fix:** Update harness code
5. **Retry:** Set `USE_NEW_HARNESS=true`

---

## Checklist

### Before Starting
- [ ] Create backup branch: `git checkout -b phase1-kimi-harness-backup`
- [ ] Record sample wire traffic for testing
- [ ] Verify all current tests pass

### Implementation
- [ ] Create `lib/harness/robin/types.ts`
- [ ] Create `lib/harness/robin/tool-mapper.ts`
- [ ] Create `lib/harness/robin/wire-parser.ts`
- [ ] Create `lib/harness/robin/session-state.ts`
- [ ] Create `lib/harness/robin/event-translator.ts`
- [ ] Create `lib/harness/robin/index.ts`
- [ ] Create `lib/harness/robin/compat.ts`
- [ ] Modify `server.js` to use compatibility layer

### Testing
- [ ] Unit tests for WireParser
- [ ] Unit tests for EventTranslator
- [ ] Unit tests for SessionState
- [ ] Integration test with recorded traffic
- [ ] Manual smoke test (basic chat)
- [ ] Manual tool test (ReadFile, Bash)
- [ ] Manual multi-turn test

### Validation
- [ ] All existing tests pass
- [ ] No behavioral changes observed
- [ ] Performance within 5% of baseline
- [ ] Memory usage within 10% of baseline

### Cleanup (after validation)
- [ ] Remove legacy code from `server.js`
- [ ] Remove compatibility shim
- [ ] Update documentation

---

## Timeline

| Day | Task |
|-----|------|
| 1 | Create types.ts, tool-mapper.ts |
| 2 | Create wire-parser.ts, session-state.ts |
| 3 | Create event-translator.ts |
| 4 | Create kimi/index.ts, compat.ts |
| 5 | Modify server.js, unit tests |
| 6 | Integration tests, bug fixes |
| 7 | Validation, documentation |

---

*Spec Version: 1.0*  
*Created: 2026-04-05*  
*Status: Ready for Implementation*
