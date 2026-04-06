/**
 * @module panel-context
 * @role Creates the ctx object passed to runtime panel modules
 *
 * The PanelContext is the ONLY interface between the engine and
 * a panel's ui/module.js. It provides communication, data access,
 * state management, theming, and DOM helpers.
 */

import { usePanelStore } from '../state/panelStore';
import { fetchPanelFile } from '../lib/panels';
import { scopePanelCss } from '../lib/scopePanelCss';
import type { PanelConfig, PanelTheme } from '../lib/panels';

// --- Public types ---

export interface PanelContext {
  /** Panel ID (folder name) */
  panel: string;
  /** Parsed index.json config */
  config: PanelConfig;
  /** Theme from index.json */
  theme: PanelTheme;

  /** Send an event to the WebSocket server */
  emit(type: string, data?: Record<string, unknown>): void;
  /** Listen for WebSocket messages by type. Returns unsubscribe function. */
  on(type: string, handler: (msg: any) => void): () => void;
  /** Remove a specific listener */
  off(type: string, handler: (msg: any) => void): void;

  /** Request a file from this panel. Returns content string. */
  request(path: string): Promise<string>;

  /** Panel-scoped state */
  state: {
    get(key: string): any;
    set(key: string, value: any): void;
    subscribe(key: string, fn: (value: any) => void): () => void;
  };

  /** Inject a scoped <style> tag. Deduped by id. */
  injectStyles(css: string, id?: string): void;
  /** Parse an HTML string into a DocumentFragment */
  parseTemplate(html: string): DocumentFragment;
}

// --- Internal state per panel ---

interface ContextState {
  listeners: Map<string, Set<(msg: any) => void>>;
  wsHandler: ((event: MessageEvent) => void) | null;
  stateData: Map<string, any>;
  stateSubscribers: Map<string, Set<(value: any) => void>>;
  injectedStyleIds: Set<string>;
}

const contextStates = new Map<string, ContextState>();

function getContextState(panelId: string): ContextState {
  let state = contextStates.get(panelId);
  if (!state) {
    state = {
      listeners: new Map(),
      wsHandler: null,
      stateData: new Map(),
      stateSubscribers: new Map(),
      injectedStyleIds: new Set(),
    };
    contextStates.set(panelId, state);
  }
  return state;
}

// --- Factory ---

/**
 * Create a PanelContext for a panel module.
 * Call destroyContext() when the module is unmounted.
 */
export function createContext(config: PanelConfig): PanelContext {
  const ctxState = getContextState(config.id);
  const ws = () => usePanelStore.getState().ws;

  // Set up WebSocket message router if not already done
  if (!ctxState.wsHandler) {
    ctxState.wsHandler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        const type = msg.type as string;
        // Route to type-specific listeners
        const handlers = ctxState.listeners.get(type);
        if (handlers) {
          handlers.forEach((handler) => {
            try { handler(msg); } catch { /* module error */ }
          });
        }
        // Also route to wildcard listeners
        const wildcardHandlers = ctxState.listeners.get('*');
        if (wildcardHandlers) {
          wildcardHandlers.forEach((handler) => {
            try { handler(msg); } catch { /* module error */ }
          });
        }
      } catch { /* parse error */ }
    };
    const socket = ws();
    if (socket) {
      socket.addEventListener('message', ctxState.wsHandler);
    }
  }

  const ctx: PanelContext = {
    panel: config.id,
    config,
    theme: config.theme,

    emit(type: string, data?: Record<string, unknown>) {
      const socket = ws();
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type, panel: config.id, ...data }));
    },

    on(type: string, handler: (msg: any) => void): () => void {
      if (!ctxState.listeners.has(type)) {
        ctxState.listeners.set(type, new Set());
      }
      ctxState.listeners.get(type)!.add(handler);
      return () => ctx.off(type, handler);
    },

    off(type: string, handler: (msg: any) => void) {
      ctxState.listeners.get(type)?.delete(handler);
    },

    async request(path: string): Promise<string> {
      const socket = ws();
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
      }
      return fetchPanelFile(socket, config.id, path);
    },

    state: {
      get(key: string): any {
        return ctxState.stateData.get(key);
      },

      set(key: string, value: any) {
        ctxState.stateData.set(key, value);
        const subscribers = ctxState.stateSubscribers.get(key);
        if (subscribers) {
          subscribers.forEach((fn) => {
            try { fn(value); } catch { /* subscriber error */ }
          });
        }
      },

      subscribe(key: string, fn: (value: any) => void): () => void {
        if (!ctxState.stateSubscribers.has(key)) {
          ctxState.stateSubscribers.set(key, new Set());
        }
        ctxState.stateSubscribers.get(key)!.add(fn);
        return () => {
          ctxState.stateSubscribers.get(key)?.delete(fn);
        };
      },
    },

    injectStyles(css: string, id?: string) {
      const styleId = id || `ws-style-${config.id}-${ctxState.injectedStyleIds.size}`;
      // Remove existing style with same id
      const existing = document.getElementById(styleId);
      if (existing) existing.remove();
      const scoped = scopePanelCss(css, config.id);
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = scoped;
      document.head.appendChild(style);
      ctxState.injectedStyleIds.add(styleId);
    },

    parseTemplate(html: string): DocumentFragment {
      const template = document.createElement('template');
      template.innerHTML = html.trim();
      return template.content;
    },
  };

  return ctx;
}

/**
 * Clean up all listeners, styles, and state for a panel context.
 * Call this when unmounting a runtime module.
 */
export function destroyContext(panelId: string) {
  const ctxState = contextStates.get(panelId);
  if (!ctxState) return;

  // Remove WebSocket listener
  if (ctxState.wsHandler) {
    const socket = usePanelStore.getState().ws;
    if (socket) {
      socket.removeEventListener('message', ctxState.wsHandler);
    }
    ctxState.wsHandler = null;
  }

  // Remove injected styles
  ctxState.injectedStyleIds.forEach((id) => {
    document.getElementById(id)?.remove();
  });

  // Clear all state
  ctxState.listeners.clear();
  ctxState.stateData.clear();
  ctxState.stateSubscribers.clear();
  ctxState.injectedStyleIds.clear();
  contextStates.delete(panelId);
}
