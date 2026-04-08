/**
 * @module ws-client
 * @role Standalone WebSocket client — no React dependency
 *
 * Manages connection, reconnection, discovery, and message routing.
 * Writes directly to the Zustand store. React components read from the store only.
 */

import { usePanelStore } from '../state/panelStore';
import { handleStreamMessage, resetStreamState } from './ws/stream-handlers';
import { handleThreadMessage } from './ws/thread-handlers';
import { handleFileMessage } from './ws/file-handlers';
import { setLoggerWs, captureConsoleLogs } from '../lib/logger';
import { showModal } from '../lib/modal';
import { loadAllPanels } from '../lib/panels';
import type { WebSocketMessage } from '../types';

// --- Module state ---

const WS_URL = 'ws://localhost:3001';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// --- Robin message listeners ---
// Components subscribe to specific message types for robin: responses.

type RobinListener = (msg: any) => void;
const robinListeners: Map<string, Set<RobinListener>> = new Map();

export function sendRobinMessage(msg: Record<string, unknown>) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export function onRobinMessage(type: string, listener: RobinListener): () => void {
  if (!robinListeners.has(type)) robinListeners.set(type, new Set());
  robinListeners.get(type)!.add(listener);
  return () => { robinListeners.get(type)?.delete(listener); };
}

function emitRobin(type: string, msg: any) {
  const listeners = robinListeners.get(type);
  if (listeners) {
    for (const fn of listeners) fn(msg);
  }
}

// --- Public API ---

export function connectWs() {
  // Guard against double-connect (HMR, React Strict Mode)
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log('[WS] Connecting...');
  const ws = new WebSocket(WS_URL);
  socket = ws;

  ws.onopen = () => {
    console.log('[WS] Connected');
    resetStreamState();
    const store = usePanelStore.getState();
    store.setWs(ws);
    setLoggerWs(ws);
    captureConsoleLogs();
    ws.send(JSON.stringify({ type: 'initialize' }));

    // Tell server which panel we're using
    const currentPanel = store.currentPanel;
    if (currentPanel) {
      console.log('[WS] Sending set_panel for:', currentPanel);
      ws.send(JSON.stringify({ type: 'set_panel', panel: currentPanel }));
    }

    // Discover panels
    loadAllPanels(ws).then((configs) => {
      console.log(`[WS] Discovered ${configs.length} panels`);
      usePanelStore.getState().setPanelConfigs(configs);
    }).catch((err) => {
      console.error('[WS] Panel discovery failed:', err);
    });
  };

  ws.onmessage = (event) => {
    try {
      const msg: WebSocketMessage = JSON.parse(event.data);
      handleMessage(msg);
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected');
    usePanelStore.getState().setWs(null);
    reconnectTimer = setTimeout(connectWs, 3000);
  };

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
  };
}

export function disconnectWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
}

// --- Message handling ---
// Every store read uses getState() — always fresh, no stale closures.

function handleMessage(msg: WebSocketMessage) {
  if (handleStreamMessage(msg)) return;
  if (handleThreadMessage(msg)) return;
  if (handleFileMessage(msg)) return;

  const store = usePanelStore.getState();

  switch (msg.type) {
    case 'connected':
      console.log('[WS] Session:', msg.sessionId);
      break;

    case 'modal:show':
      showModal(msg as unknown as import('../lib/modal').ModalConfig);
      break;

    case 'panel_config':
      if ((msg as any).projectRoot) {
        store.setProjectRoot((msg as any).projectRoot);
      }
      break;

    // Robin system panel responses
    case 'robin:tabs':
    case 'robin:items':
    case 'robin:wiki':
    case 'robin:theme-data':
      emitRobin(msg.type, msg);
      break;

    // Clipboard manager responses
    case 'clipboard:list':
    case 'clipboard:append':
    case 'clipboard:touch':
    case 'clipboard:clear':
      emitRobin(msg.type, msg);
      break;

    default:
      break;
  }
}

