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
  | 'panel_changed'
  | 'file_changed'
  | 'file_tree_response'
  | 'file_content_response'
  | 'file_save'
  | 'file_save_response'
  | 'fusion:tabs'
  | 'fusion:items'
  | 'fusion:wiki'
  // Clipboard messages
  | 'clipboard:list'
  | 'clipboard:append'
  | 'clipboard:touch'
  | 'clipboard:use'
  | 'clipboard:delete'
  | 'clipboard:clear'
  | 'clipboard:state'
  | 'clipboard:error'
  // Recent docs messages
  | 'recent_docs:list'
  | 'recent_docs:record'
  | 'recent_docs:clear'
  | 'recent_docs:updated'
  | 'recent_docs:cleared'
  | 'recent_docs:error'
  | 'wire_ready'
  | 'wire_disconnected'
  | 'parse_error'
  | 'thread:create:confirm'
  // View UI state (SPEC-26c-2)
  | 'state:result'
  | 'state:error'
  // Workspace messages (WORKSPACE_CLIENT_UI_SPEC)
  | 'workspace:init'
  | 'workspace:registry_changed'
  | 'workspace:switched'
  | 'workspace:added'
  | 'workspace:removed'
  | 'workspace:add_rejected_duplicate'
  | 'workspace:culled_at_launch'
  | 'thread:state_changed'
  // Harness install-status cache (HARNESS_STATUS_CACHE_SPEC)
  | 'harness:status_changed'
  // Theme picker (THEME_PICKER_SPEC)
  | 'theme:list'
  | 'theme:state'
  | 'theme:activate'
  | 'theme:save'
  | 'theme:delete'
  | 'theme:error'
  // Secrets manager (SECRETS_MANAGER_SPEC §8a)
  | 'secrets:api-keys:state'
  | 'secrets:api-keys:error'
  // Screenshot manager
  | 'screenshot:data'
  | 'screenshot:list'
  | 'screenshot:updated'
  | 'screenshot:missing'
  | 'screenshot:error';

// Slider-only theme model — accent + 4 sliders.
export interface ThemeEntry {
  id:             string;
  label:          string;
  accent:         string;   // hex #RRGGBB
  luminance:      number;   // 0-100
  panelContrast?: number;   // 0-100 (50 = baseline panel deltas; 0 = monotone; 100 = 2× exaggerated)
  bgTint?:        number;   // 0-30 percent accent blended into background surfaces
  contentLuminance?: number; // 0-100 luminance for content/code surfaces only
  contentContrast?: number;  // 0-100 contrast for content/code surfaces (stub)
  contentTint?:   number;   // 0-30 percent accent blended into content/code surfaces
  borders?:       number;   // 0-100 percent accent blended into borders (legacy — replaced by borderLuminance + borderTint)
  borderLuminance?: number; // 0-100 black-to-white base for borders
  borderTint?:    number;   // 0-100 percent accent blended into border base
  chromeLuminance?: number; // 0-100 black-to-white base for chrome accents
  chromeTint?:    number;   // 0-100 percent accent blended into chrome base
  accentLuminance?: number; // 0-100 black-to-white base for muted accent surfaces
  accentTint?:    number;   // 0-100 percent accent blended into muted accent base
  chatBubbleChrome?: boolean; // When true, user chat bubble bg uses --chrome-accent (dim structural chrome color)
  themeCode?:        boolean; // When true, syntax palette hues derive from accent instead of fixed rainbow
  tints?: {
    borders?: { chat?: boolean };
  };
  builtin:        boolean;
  active:         boolean;
  // Schema 2.0 vestigial fields (preserved but unused in slider-only mode)
  mode?:         'light' | 'dark' | 'unknown';
  bgPrimary?:    string | null;
  bgSurface?:    string | null;
  bgDark?:       string | null;
  textPrimary?:  string | null;
  textDim?:      string | null;
  link?:         string | null;
  border?:       string | null;
  focus?:        string | null;
}

export interface Workspace {
  id: string;
  label: string;
  icon: string;
  description: string | null;
  repoPath: string;
  sortOrder: number;
}

// CLI_CONFIG_SPEC §6: resolved CLI catalog entry (factory + workspace + view).
export interface ResolvedCliEntry {
  id: string;
  name: string;
  description: string;
  materialIcon: string;
  accentColor?: string;
  details: {
    provider: string;
    model: string;
    features: string[];
  };
  enabled: boolean;
  comingSoon?: boolean;
  recommended?: boolean;
  order: number;
}

export type CliEntryOverride = Partial<Pick<ResolvedCliEntry, 'enabled' | 'name' | 'materialIcon' | 'accentColor' | 'order'>>;

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
  // Workspace fields (WORKSPACE_CLIENT_UI_SPEC)
  workspaces?: Workspace[];
  workspace?: Workspace;
  activeWorkspaceId?: string | null;
  workspaceId?: string;
  from?: string | null;
  to?: string | null;
  repoPath?: string | null;
  homePath?: string;
  existingWorkspace?: Workspace;
  reason?: string;
  // Harness status-change fields (HARNESS_STATUS_CACHE_SPEC)
  installed?: boolean;
  version?: string | null;
  binary_path?: string | null;
  // CLI config (CLI_CONFIG_SPEC §7c, §7d)
  cliConfig?: Record<string, ResolvedCliEntry>;
  cliConfigDelta?: Record<string, CliEntryOverride>;
}

// SPEC-26c-2: per-view UI state (collapse + pane widths)
// SECONDARY_CHAT_SPEC: `rightSecondary` added for the sticky-right column.
// `rightCol` is the view's right column (e.g. file-viewer file tree) — kept
// separate from rightSecondary so the file tree retains its own width when
// the sticky chat undocks.
export type Pane = 'leftSidebar' | 'leftChat' | 'rightSecondary' | 'rightCol';
// Only the left panes have collapse state — the secondary has its own
// show/hide via traffic-light modes, not a collapse toggle.
export type CollapsablePane = 'leftSidebar' | 'leftChat';

export interface ViewUIState {
  collapsed: {
    leftSidebar: boolean;
    leftChat: boolean;
  };
  widths: {
    leftSidebar: number;
    leftChat: number;
    rightSecondary?: number;  // sticky secondary chat width (when docked)
    rightCol?: number;        // view's right column (e.g. file-viewer file tree)
  };
  // STATE_OVERRIDE_SPEC §5: persisted popup geometry.
  popup: {
    open: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    threadId: string | null;
  };
  currentThreadId: string | null;
  secondaryThreadId: string | null;
  // TINTS_SPEC §4: per-surface tint toggles. All default false (neutral).
  tints: ViewStateTints;
}

export interface ViewStateTints {
  leftPanel:     boolean;
  rightPanel:    boolean;
  cards:         boolean;
  borders: {
    threads: boolean;
    chat:    boolean;
  };
}

// SECONDARY_CHAT_SPEC: singleton secondary-chat state (replaces SPEC-26d popup).
// Top-level, not per-panel — at most one secondary exists per workspace.
export type SecondaryMode = 'floating' | 'minimized' | 'sticky-right';

export interface SecondaryState {
  threadId: string;
  mode: SecondaryMode;
  previousMode: 'floating' | 'sticky-right';  // where minimize came from
  float: { x: number; y: number; width: number; height: number };
  // Set true by restoreSecondary; read by SecondaryChat/SecondaryChatSticky
  // on mount to play the reverse genie animation. Cleared by the component
  // after the animation finishes.
  justRestored?: boolean;
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
  // CLI_IDENTITY_SPEC: which harness owns this thread
  harnessId?: string;
}

// Moved from ChatHarnessPicker — harness installation status
export interface HarnessStatus {
  id: string;
  installed: boolean;
  builtIn: boolean;
  version: string | null;
  action: string | null;
  installCommand: string | null;
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
