import { create } from 'zustand';
import type {
  PanelState,
  Message,
  AssistantTurn,
  StreamSegment,
  Thread
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

  // Per-panel states (dynamically initialized)
  panels: Record<string, PanelState>;

  // Panel actions
  addMessage: (panel: string, message: Message) => void;
  setCurrentTurn: (panel: string, turn: AssistantTurn | null) => void;
  updateTurnContent: (panel: string, content: string) => void;
  appendSegment: (panel: string, segType: StreamSegment['type'], text: string) => void;
  pushSegment: (panel: string, segment: StreamSegment) => void;
  updateLastSegment: (panel: string, updates: Partial<StreamSegment>) => void;
  updateSegmentByToolCallId: (panel: string, toolCallId: string, updates: Partial<StreamSegment>) => void;
  appendSegmentContentByIndex: (panel: string, index: number, text: string) => void;
  resetSegments: (panel: string) => void;
  setPendingTurnEnd: (panel: string, pending: boolean) => void;
  setPendingMessage: (panel: string, message: Message | null) => void;
  finalizeTurn: (panel: string) => void;
  clearPanel: (panel: string) => void;

  // WebSocket
  ws: WebSocket | null;
  setWs: (ws: WebSocket | null) => void;
  sendMessage: (text: string, panel?: string) => void;

  // Project root (absolute path from server)
  projectRoot: string | null;
  setProjectRoot: (root: string) => void;

  // Context usage
  contextUsage: number;
  setContextUsage: (usage: number) => void;

  // Thread management
  threads: Thread[];
  currentThreadId: string | null;
  wireReady: boolean;
  setThreads: (threads: Thread[]) => void;
  setCurrentThreadId: (threadId: string | null) => void;
  setWireReady: (ready: boolean) => void;
  addThread: (thread: Thread) => void;
  updateThread: (threadId: string, updates: Partial<Thread['entry']>) => void;
  removeThread: (threadId: string) => void;
}

/**
 * Helper: get panel state, auto-initializing if needed.
 * This ensures panel actions work even before discovery completes.
 */
function getPs(state: AppState, panel: string): PanelState {
  return state.panels[panel] || createInitialPanelState();
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
  ws: null,
  projectRoot: null,
  contextUsage: 0,
  threads: [],
  currentThreadId: null,
  wireReady: false,

  // Actions
  setCurrentPanel: (id) => {
    // Auto-initialize panel state if not yet created
    const state = get();
    if (!state.panels[id]) {
      set({
        currentPanel: id,
        panels: { ...state.panels, [id]: createInitialPanelState() }
      });
    } else {
      set({ currentPanel: id });
    }
    // Tell the server so ThreadManager scopes to this panel's threads
    const ws = state.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_panel', panel: id }));
    }
  },

  addMessage: (panel, message) => set((state) => {
    const ps = getPs(state, panel);
    return {
      panels: {
        ...state.panels,
        [panel]: { ...ps, messages: [...ps.messages, message] }
      }
    };
  }),

  setCurrentTurn: (panel, turn) => set((state) => ({
    panels: {
      ...state.panels,
      [panel]: { ...getPs(state, panel), currentTurn: turn }
    }
  })),

  updateTurnContent: (panel, content) => set((state) => {
    const ps = getPs(state, panel);
    if (!ps.currentTurn) return state;
    return {
      panels: {
        ...state.panels,
        [panel]: { ...ps, currentTurn: { ...ps.currentTurn, content } }
      }
    };
  }),

  appendSegment: (panel, segType, text) => set((state) => {
    const ps = getPs(state, panel);
    const segments = [...ps.segments];
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
    return {
      panels: { ...state.panels, [panel]: { ...ps, segments } }
    };
  }),

  pushSegment: (panel, segment) => set((state) => {
    const ps = getPs(state, panel);
    const segments = [...ps.segments];
    // Mark prior segment complete before pushing new one
    const last = segments[segments.length - 1];
    if (last && !last.complete) {
      segments[segments.length - 1] = { ...last, complete: true };
    }
    segments.push(segment);
    return {
      panels: { ...state.panels, [panel]: { ...ps, segments } }
    };
  }),

  updateLastSegment: (panel, updates) => set((state) => {
    const ps = getPs(state, panel);
    const segments = [...ps.segments];
    const last = segments[segments.length - 1];
    if (last) {
      segments[segments.length - 1] = { ...last, ...updates };
    }
    return {
      panels: { ...state.panels, [panel]: { ...ps, segments } }
    };
  }),

  updateSegmentByToolCallId: (panel, toolCallId, updates) => set((state) => {
    const ps = getPs(state, panel);
    const idx = ps.segments.findIndex((s) => s.toolCallId === toolCallId);
    if (idx < 0) return state;
    const segments = [...ps.segments];
    segments[idx] = { ...segments[idx], ...updates };
    return {
      panels: { ...state.panels, [panel]: { ...ps, segments } }
    };
  }),

  appendSegmentContentByIndex: (panel, index, text) => set((state) => {
    const ps = getPs(state, panel);
    if (index < 0 || index >= ps.segments.length) return state;
    const segments = [...ps.segments];
    segments[index] = { ...segments[index], content: segments[index].content + text };
    return {
      panels: { ...state.panels, [panel]: { ...ps, segments } }
    };
  }),

  resetSegments: (panel) => set((state) => ({
    panels: {
      ...state.panels,
      [panel]: { ...getPs(state, panel), segments: [] }
    }
  })),

  setPendingTurnEnd: (panel, pending) => set((state) => ({
    panels: {
      ...state.panels,
      [panel]: { ...getPs(state, panel), pendingTurnEnd: pending }
    }
  })),

  setPendingMessage: (panel, message) => set((state) => ({
    panels: {
      ...state.panels,
      [panel]: { ...getPs(state, panel), pendingMessage: message }
    }
  })),

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
  finalizeTurn: (panel) => {
    const state = get();
    const ps = getPs(state, panel);
    const turn = ps.currentTurn;
    if (turn) {
      const segments = ps.segments;
      const newMessages = [
        ...ps.messages,
        {
          id: turn.id || `turn-${Date.now()}`,
          type: 'assistant' as const,
          content: turn.content,
          timestamp: Date.now(),
          segments: segments.length > 0 ? [...segments] : undefined,
        },
      ];
      set((s) => ({
        panels: {
          ...s.panels,
          [panel]: {
            ...getPs(s, panel),
            messages: newMessages,
            currentTurn: null,
            segments: [],
            pendingTurnEnd: false,
            pendingMessage: null,
            lastReleasedSegmentCount: 0,
          }
        }
      }));
    }
  },

  clearPanel: (panel) => set((state) => ({
    panels: {
      ...state.panels,
      [panel]: createInitialPanelState()
    }
  })),

  setWs: (ws) => set({ ws }),
  sendMessage: (text, panel) => {
    const state = get();
    const socket = state.ws;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const now = performance.now();
      (window as any).__TIMING = { sendAt: now, firstTokenAt: 0, firstTokenType: '' };
      console.log(`[TIMING] SEND at ${now.toFixed(1)}ms`);
      socket.send(JSON.stringify({
        type: 'prompt',
        user_input: text,
        panel: panel || state.currentPanel,
        threadId: state.currentThreadId,
      }));
    }
  },
  setProjectRoot: (root) => set({ projectRoot: root }),
  setContextUsage: (usage) => set({ contextUsage: usage }),

  // Thread actions
  setThreads: (threads) => set({ threads }),
  setCurrentThreadId: (threadId) => set({ currentThreadId: threadId }),
  setWireReady: (ready) => set({ wireReady: ready }),
  addThread: (thread) => set((state) => ({
    threads: [thread, ...state.threads]
  })),
  updateThread: (threadId, updates) => set((state) => ({
    threads: state.threads.map(t =>
      t.threadId === threadId ? { ...t, entry: { ...t.entry, ...updates } } : t
    )
  })),
  removeThread: (threadId) => set((state) => ({
    threads: state.threads.filter(t => t.threadId !== threadId),
    currentThreadId: state.currentThreadId === threadId ? null : state.currentThreadId
  })),

}));
