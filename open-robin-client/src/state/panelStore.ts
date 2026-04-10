import { create } from 'zustand';
import type {
  PanelState,
  Message,
  AssistantTurn,
  StreamSegment,
  Thread,
  Scope
} from '../types';
import type { PanelConfig } from '../lib/panels';

// Initial panel state factory
function createInitialPanelState(): PanelState {
  return {
    messages: [],
    currentTurn: null,
    pendingTurnEnd: false,
    pendingMessage: null,
    segments: [],
    lastReleasedSegmentCount: 0
  };
}

interface AppState {
  // Panel configs (dynamically discovered)
  panelConfigs: PanelConfig[];
  setPanelConfigs: (configs: PanelConfig[]) => void;
  getPanelConfig: (id: string) => PanelConfig | undefined;

  // Current panel
  currentPanel: string;
  setCurrentPanel: (id: string) => void;

  // Per-panel states (dynamically initialized).
  // SPEC-26c: these hold VIEW-scoped chat state. The current panel's view
  // chat lives at panels[state.currentPanel].
  panels: Record<string, PanelState>;

  // SPEC-26c: project-scoped chat state is top-level because the project
  // chat follows the user across panel switches (it is NOT per-panel).
  projectChat: PanelState;

  // Chat state actions — every action takes a scope:
  //  - 'project' routes to state.projectChat
  //  - 'view'    routes to state.panels[state.currentPanel]
  addMessage: (scope: Scope, message: Message) => void;
  setCurrentTurn: (scope: Scope, turn: AssistantTurn | null) => void;
  updateTurnContent: (scope: Scope, content: string) => void;
  appendSegment: (scope: Scope, segType: StreamSegment['type'], text: string) => void;
  pushSegment: (scope: Scope, segment: StreamSegment) => void;
  updateLastSegment: (scope: Scope, updates: Partial<StreamSegment>) => void;
  updateSegmentByToolCallId: (scope: Scope, toolCallId: string, updates: Partial<StreamSegment>) => void;
  appendSegmentContentByIndex: (scope: Scope, index: number, text: string) => void;
  resetSegments: (scope: Scope) => void;
  setPendingTurnEnd: (scope: Scope, pending: boolean) => void;
  setPendingMessage: (scope: Scope, message: Message | null) => void;
  finalizeTurn: (scope: Scope) => void;
  clearChat: (scope: Scope) => void;

  // WebSocket
  ws: WebSocket | null;
  setWs: (ws: WebSocket | null) => void;
  sendMessage: (text: string, scope: Scope) => void;

  // Project root (absolute path from server)
  projectRoot: string | null;
  setProjectRoot: (root: string) => void;

  // Context usage
  contextUsage: number;
  setContextUsage: (usage: number) => void;

  // Thread management — SPEC-26c: dual-scope
  threads: { project: Thread[]; view: Thread[] };
  currentThreadIds: { project: string | null; view: string | null };
  currentScope: Scope | null;  // which scope has the live wire
  wireReady: boolean;

  setThreads: (scope: Scope, threads: Thread[]) => void;
  setCurrentThreadId: (scope: Scope, threadId: string | null) => void;
  setCurrentScope: (scope: Scope | null) => void;
  setWireReady: (ready: boolean) => void;
  addThread: (scope: Scope, thread: Thread) => void;
  updateThread: (scope: Scope, threadId: string, updates: Partial<Thread['entry']>) => void;
  removeThread: (scope: Scope, threadId: string) => void;
}

/**
 * SPEC-26c helper: resolve the chat state slot for a given scope.
 *  - 'project' → top-level state.projectChat
 *  - 'view'    → state.panels[state.currentPanel] (auto-init if missing)
 */
function getChatState(state: AppState, scope: Scope): PanelState {
  if (scope === 'project') return state.projectChat;
  return state.panels[state.currentPanel] || createInitialPanelState();
}

/**
 * SPEC-26c helper: build the partial state update to write a new chat-state
 * slot back to the store, correctly keyed by scope.
 */
function writeChatState(state: AppState, scope: Scope, next: PanelState): Partial<AppState> {
  if (scope === 'project') {
    return { projectChat: next };
  }
  return {
    panels: { ...state.panels, [state.currentPanel]: next }
  };
}

export const usePanelStore = create<AppState>((set, get) => ({
  // Panel configs — empty until discovery populates them
  panelConfigs: [],
  setPanelConfigs: (configs) => {
    const existing = get().panels;
    const panels: Record<string, PanelState> = { ...existing };
    for (const config of configs) {
      if (!panels[config.id]) {
        panels[config.id] = createInitialPanelState();
      }
    }
    set({ panelConfigs: configs, panels });
  },
  getPanelConfig: (id) => get().panelConfigs.find((c) => c.id === id),

  // Initial state — empty until discovery populates
  currentPanel: 'code-viewer',
  panels: {},
  projectChat: createInitialPanelState(),  // SPEC-26c
  ws: null,
  projectRoot: null,
  contextUsage: 0,
  threads: { project: [], view: [] },
  currentThreadIds: { project: null, view: null },
  currentScope: null,
  wireReady: false,

  // Actions
  setCurrentPanel: (id) => {
    // Auto-initialize panel state if not yet created
    const state = get();
    const base: Partial<AppState> = {
      currentPanel: id,
      // SPEC-26c: view thread resets on panel switch (server kills the wire
      // when panel changes); project thread persists across panels.
      currentThreadIds: { ...state.currentThreadIds, view: null },
      currentScope: null,
    };
    if (!state.panels[id]) {
      set({
        ...base,
        panels: { ...state.panels, [id]: createInitialPanelState() },
      });
    } else {
      set(base);
    }
    // Tell the server so ThreadManager scopes to this panel's threads
    const ws = state.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_panel', panel: id }));
    }
  },

  addMessage: (scope, message) => set((state) => {
    const cs = getChatState(state, scope);
    return writeChatState(state, scope, { ...cs, messages: [...cs.messages, message] });
  }),

  setCurrentTurn: (scope, turn) => set((state) => {
    const cs = getChatState(state, scope);
    return writeChatState(state, scope, { ...cs, currentTurn: turn });
  }),

  updateTurnContent: (scope, content) => set((state) => {
    const cs = getChatState(state, scope);
    if (!cs.currentTurn) return state;
    return writeChatState(state, scope, {
      ...cs,
      currentTurn: { ...cs.currentTurn, content }
    });
  }),

  appendSegment: (scope, segType, text) => set((state) => {
    const cs = getChatState(state, scope);
    const segments = [...cs.segments];
    const last = segments[segments.length - 1];
    if (last && last.type === segType) {
      // Same type — append content
      segments[segments.length - 1] = { ...last, content: last.content + text };
    } else {
      // New type — mark prior segment complete (closing tag), push new one
      if (last && !last.complete) {
        segments[segments.length - 1] = { ...last, complete: true };
      }
      segments.push({ type: segType, content: text });
    }
    return writeChatState(state, scope, { ...cs, segments });
  }),

  pushSegment: (scope, segment) => set((state) => {
    const cs = getChatState(state, scope);
    const segments = [...cs.segments];
    // Mark prior segment complete before pushing new one
    const last = segments[segments.length - 1];
    if (last && !last.complete) {
      segments[segments.length - 1] = { ...last, complete: true };
    }
    segments.push(segment);
    return writeChatState(state, scope, { ...cs, segments });
  }),

  updateLastSegment: (scope, updates) => set((state) => {
    const cs = getChatState(state, scope);
    const segments = [...cs.segments];
    const last = segments[segments.length - 1];
    if (last) {
      segments[segments.length - 1] = { ...last, ...updates };
    }
    return writeChatState(state, scope, { ...cs, segments });
  }),

  updateSegmentByToolCallId: (scope, toolCallId, updates) => set((state) => {
    const cs = getChatState(state, scope);
    const idx = cs.segments.findIndex((s) => s.toolCallId === toolCallId);
    if (idx < 0) return state;
    const segments = [...cs.segments];
    segments[idx] = { ...segments[idx], ...updates };
    return writeChatState(state, scope, { ...cs, segments });
  }),

  appendSegmentContentByIndex: (scope, index, text) => set((state) => {
    const cs = getChatState(state, scope);
    if (index < 0 || index >= cs.segments.length) return state;
    const segments = [...cs.segments];
    segments[index] = { ...segments[index], content: segments[index].content + text };
    return writeChatState(state, scope, { ...cs, segments });
  }),

  resetSegments: (scope) => set((state) => {
    const cs = getChatState(state, scope);
    return writeChatState(state, scope, { ...cs, segments: [] });
  }),

  setPendingTurnEnd: (scope, pending) => set((state) => {
    const cs = getChatState(state, scope);
    return writeChatState(state, scope, { ...cs, pendingTurnEnd: pending });
  }),

  setPendingMessage: (scope, message) => set((state) => {
    const cs = getChatState(state, scope);
    return writeChatState(state, scope, { ...cs, pendingMessage: message });
  }),

  // TURN FINALIZATION — completes the full turn lifecycle in one atomic update.
  // Called exactly once per turn, by LiveSegmentRenderer's completion effect,
  // when BOTH conditions are met:
  //   1. All segments have been revealed (revealedCount >= segments.length)
  //   2. turn_end has arrived (pendingTurnEnd is true → onRevealComplete is defined)
  //
  // This does THREE things atomically:
  //   1. Snapshots the turn into messages[] (moves from live to history)
  //   2. Clears currentTurn (LiveSegmentRenderer unmounts)
  //   3. Clears segments and pendingTurnEnd
  //
  // After this fires, the turn renders via InstantSegmentRenderer (history).
  // There is NO limbo state. The turn goes directly from live → history.
  //
  // KNOWN PAST BUG (DO NOT REINTRODUCE):
  // The old finalizeTurn only set status='complete' but left the turn in
  // currentTurn. The turn stayed in limbo — still rendered by LiveSegment-
  // Renderer — until the next turn_begin snapshotted it. This caused:
  //   - User bubble appearing above the live response on mid-stream send
  //   - Turn never moving to history if no follow-up message was sent
  //   - Stale LiveSegmentRenderer state persisting after animation completed
  finalizeTurn: (scope) => {
    const state = get();
    const cs = getChatState(state, scope);
    const turn = cs.currentTurn;
    if (turn) {
      const segments = cs.segments;
      const newMessages = [
        ...cs.messages,
        {
          id: turn.id || `turn-${Date.now()}`,
          type: 'assistant' as const,
          content: turn.content,
          timestamp: Date.now(),
          segments: segments.length > 0 ? [...segments] : undefined,
        },
      ];
      set((s) => writeChatState(s, scope, {
        ...getChatState(s, scope),
        messages: newMessages,
        currentTurn: null,
        segments: [],
        pendingTurnEnd: false,
        pendingMessage: null,
        lastReleasedSegmentCount: 0,
      }));
    }
  },

  clearChat: (scope) => set((state) =>
    writeChatState(state, scope, createInitialPanelState())
  ),

  setWs: (ws) => set({ ws }),
  sendMessage: (text, scope) => {
    const state = get();
    const socket = state.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const threadId = state.currentThreadIds[scope];
    if (!threadId) {
      console.error(`[Store] sendMessage: no active thread in scope=${scope}`);
      return;
    }
    const now = performance.now();
    (window as any).__TIMING = { sendAt: now, firstTokenAt: 0, firstTokenType: '' };
    console.log(`[TIMING] SEND at ${now.toFixed(1)}ms scope=${scope}`);
    socket.send(JSON.stringify({
      type: 'prompt',
      scope,
      threadId,
      user_input: text,
    }));
  },
  setProjectRoot: (root) => set({ projectRoot: root }),
  setContextUsage: (usage) => set({ contextUsage: usage }),

  // Thread actions — SPEC-26c: scope-aware
  setThreads: (scope, threads) => set((state) => ({
    threads: { ...state.threads, [scope]: threads },
  })),
  setCurrentThreadId: (scope, threadId) => set((state) => ({
    currentThreadIds: { ...state.currentThreadIds, [scope]: threadId },
  })),
  setCurrentScope: (scope) => set({ currentScope: scope }),
  setWireReady: (ready) => set({ wireReady: ready }),
  addThread: (scope, thread) => set((state) => ({
    threads: {
      ...state.threads,
      [scope]: [thread, ...state.threads[scope]],
    },
  })),
  updateThread: (scope, threadId, updates) => set((state) => ({
    threads: {
      ...state.threads,
      [scope]: state.threads[scope].map(t =>
        t.threadId === threadId ? { ...t, entry: { ...t.entry, ...updates } } : t
      ),
    },
  })),
  removeThread: (scope, threadId) => set((state) => ({
    threads: {
      ...state.threads,
      [scope]: state.threads[scope].filter(t => t.threadId !== threadId),
    },
    currentThreadIds: {
      ...state.currentThreadIds,
      [scope]: state.currentThreadIds[scope] === threadId ? null : state.currentThreadIds[scope],
    },
  })),

}));
