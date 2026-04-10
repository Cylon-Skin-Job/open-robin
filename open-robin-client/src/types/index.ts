// Panel Types — PanelId is now a string alias (panels are discovered dynamically)
export type PanelId = string;

// All segment types that can appear in the ordered stream
export type SegmentType =
  | 'think' | 'text'
  | 'shell' | 'read' | 'write' | 'edit'
  | 'glob' | 'grep' | 'web_search' | 'fetch'
  | 'subagent' | 'todo';

// Stream segment — one contiguous block in arrival order
export interface StreamSegment {
  type: SegmentType;
  content: string;
  icon?: string;
  label?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  toolDisplay?: unknown[];
  isError?: boolean;
  /** True when the closing tag has arrived — content is final */
  complete?: boolean;
}

// Message Types
export interface Message {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Ordered segments (think + text inline) for assistant messages */
  segments?: StreamSegment[];
  /** Queue position when added to history; used for consistent render */
  releasedSegmentCount?: number;
}

export interface AssistantTurn {
  id: string;
  content: string;
  status: 'streaming' | 'complete';
  hasThinking: boolean;
  thinkingContent: string;
}

// Panel State
export interface PanelState {
  // Messages
  messages: Message[];
  currentTurn: AssistantTurn | null;

  pendingTurnEnd: boolean;
  /** Message to add when typing completes; set at turn_end, cleared by finalizeTurn */
  pendingMessage: Message | null;

  // Ordered stream of segments (think and text inline, in arrival order)
  segments: StreamSegment[];

  /** Captured at finalize; used when adding to messages at turn_begin */
  lastReleasedSegmentCount: number;

}

// WebSocket Message Types
export type WebSocketMessageType =
  | 'connected'
  | 'turn_begin'
  | 'content'
  | 'thinking'
  | 'turn_end'
  | 'step_begin'
  | 'status_update'
  | 'request'
  | 'response'
  | 'error'
  | 'tool_call'
  | 'tool_result'
  // Thread messages
  | 'thread:list'
  | 'thread:created'
  | 'thread:opened'
  | 'thread:renamed'
  | 'thread:deleted'
  | 'message:sent'
  | 'auth_error'
  // Modal messages
  | 'modal:show'
  | 'file:moved'
  | 'file:move_error'
  | 'panel_config'
  | 'file_changed'
  | 'file_tree_response'
  | 'file_content_response'
  | 'robin:tabs'
  | 'robin:items'
  | 'robin:wiki'
  | 'robin:theme-data'
  // Clipboard messages
  | 'clipboard:list'
  | 'clipboard:append'
  | 'clipboard:touch'
  | 'clipboard:clear'
  | 'wire_ready'
  | 'wire_disconnected'
  | 'parse_error'
  | 'thread:create:confirm'
  // View UI state (SPEC-26c-2)
  | 'state:result'
  | 'state:error';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  turnId?: string;
  text?: string;
  userInput?: string;
  fullText?: string;
  stepNumber?: number;
  contextUsage?: number;
  tokenUsage?: number;
  requestType?: string;
  payload?: any;
  requestId?: string;
  id?: string;
  result?: any;
  error?: any;
  sessionId?: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  toolOutput?: string;
  toolDisplay?: unknown[];
  isError?: boolean;
  // Thread fields
  panel?: string;
  threadId?: string;
  thread?: ThreadEntry;
  threads?: Thread[];
  history?: { role: 'user' | 'assistant'; content: string; hasToolCalls?: boolean }[];
  exchanges?: ExchangeData[];  // Rich format with tool calls
  name?: string;
  content?: string;
  message?: string;
  // SPEC-26b: every thread:* response and wire_ready carries scope
  scope?: Scope;
  viewId?: string | null;
}

// SPEC-26c-2: per-view UI state (collapse + pane widths)
export type Pane = 'leftSidebar' | 'leftChat';

export interface ViewUIState {
  collapsed: {
    leftSidebar: boolean;
    leftChat: boolean;
  };
  widths: {
    leftSidebar: number;
    leftChat: number;
  };
}

// SPEC-26: dual-chat paradigm. Every thread lives in one of two scopes.
//  - 'project': follows the user across panel switches
//  - 'view': bound to a specific view panel
export type Scope = 'project' | 'view';

// Thread Types
export interface ThreadEntry {
  // null when the thread has no display name yet. SPEC-24e: UI falls back
  // to the thread ID with milliseconds stripped (e.g. 2026-04-09T14-30-22).
  name: string | null;
  createdAt: string;
  resumedAt?: string;
  messageCount: number;
  status: 'active' | 'suspended';
  // SPEC-26a: server returns scope + viewId on every thread entry
  scope?: Scope;
  viewId?: string | null;
}

export interface Thread {
  threadId: string;
  entry: ThreadEntry;
}

// Rich History Format (from history.json)
export interface ToolCallPart {
  type: 'tool_call';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  result: {
    output?: string;
    display?: unknown[];
    error?: string;
    files?: string[];
  };
  duration_ms?: number;
}

export interface TextPart {
  type: 'text';
  content: string;
}

export interface ThinkPart {
  type: 'think';
  content: string;
}

export type AssistantPart = TextPart | ThinkPart | ToolCallPart;

export interface ExchangeData {
  seq: number;
  ts: number;
  user: string;
  assistant: {
    parts: AssistantPart[];
  };
  metadata?: unknown[];
}

// Timing Constants
export const TIMING = {
  RIBBON_ENTER: 150,
  RIBBON_EXIT: 200,
  PRE_THINKING_PAUSE: 200,
  THINKING_MIN_DURATION: 800,
  TEXT_TYPEWRITER: 5,
  CODE_TYPEWRITER: 2,
  PULSE_SINGLE: 800,
  CODE_TRANSITION_DELAY: 400,
  CODE_RESUME_DELAY: 300,
} as const;

// PANEL_CONFIGS removed — panels are now discovered dynamically.
// Use usePanelStore().panelConfigs instead.
// See lib/panels.ts for PanelConfig type.
