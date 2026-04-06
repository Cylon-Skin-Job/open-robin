/**
 * @module ws-client
 * @role Standalone WebSocket client — no React dependency
 *
 * Manages connection, reconnection, discovery, and message routing.
 * Writes directly to the Zustand store. React components read from the store only.
 */

import { usePanelStore } from '../state/panelStore';
import { toolNameToSegmentType, SEGMENT_ICONS } from '../lib/instructions';
import { getSummaryField } from '../lib/catalog-visual';
import {
  onToolCall,
  getGroupForResult,
  breakSequence,
  reset as resetGrouper,
} from '../lib/tool-grouper';
import { setLoggerWs, captureConsoleLogs } from '../lib/logger';
import { loadRootTree } from '../lib/file-tree';
import { showToast } from '../lib/toast';
import { useActiveResourceStore } from '../state/activeResourceStore';
import { useFileDataStore } from '../state/fileDataStore';
import { showModal } from '../lib/modal';
import { loadAllPanels } from '../lib/panels';
import type { WebSocketMessage, ExchangeData, AssistantPart, StreamSegment } from '../types';

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
    resetGrouper();
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
  const store = usePanelStore.getState();
  const panel = store.currentPanel;

  switch (msg.type) {
    case 'connected':
      console.log('[WS] Session:', msg.sessionId);
      break;

    case 'turn_begin': {
      console.log('[WS] Turn begin');
      // Safety net: if the previous turn wasn't finalized (edge case —
      // finalizeTurn normally handles this), snapshot it now. In the
      // normal flow, currentTurn is already null by this point because
      // finalizeTurn cleared it.
      const panelState = store.panels[panel];
      if (panelState) {
        const prevTurn = panelState.currentTurn;
        const segments = panelState.segments;

        if (prevTurn) {
          console.warn('[WS] turn_begin: previous turn was not finalized — snapshotting now');
          store.addMessage(panel, {
            id: prevTurn.id,
            type: 'assistant',
            content: prevTurn.content,
            timestamp: Date.now(),
            segments: segments.length > 0 ? [...segments] : undefined,
          });
        }
      }

      store.resetSegments(panel);
      resetGrouper();

      // CRITICAL: Clear pendingTurnEnd from the PREVIOUS turn.
      //
      // If the old turn's renderer hadn't finished revealing when this
      // turn_begin arrives, pendingTurnEnd is still true. Without this
      // clear, the NEW turn would inherit it — causing premature
      // finalization as soon as the first segment of the new turn
      // finishes revealing.
      //
      // KNOWN PAST BUG (DO NOT REMOVE):
      // Omitting this line caused new turns to finalize immediately
      // after their first segment, because the stale pendingTurnEnd
      // from the previous turn was still set.
      store.setPendingTurnEnd(panel, false);

      store.setCurrentTurn(panel, {
        id: msg.turnId || '',
        content: '',
        status: 'streaming',
        hasThinking: false,
        thinkingContent: '',
      });

      break;
    }

    case 'content':
      if (msg.text) {
        const t = (window as any).__TIMING;
        if (t && !t.firstTokenAt) {
          t.firstTokenAt = performance.now();
          t.firstTokenType = 'content';
          const ttft = t.firstTokenAt - t.sendAt;
          console.log(`[TIMING] FIRST TOKEN (content) at ${t.firstTokenAt.toFixed(1)}ms — TTFT: ${ttft.toFixed(1)}ms`);
        }
        breakSequence();
        store.appendSegment(panel, 'text', msg.text);

        const turn = usePanelStore.getState().panels[panel]?.currentTurn;
        if (turn) {
          store.updateTurnContent(panel, turn.content + msg.text);
        }
      }
      break;

    case 'thinking':
      if (msg.text) {
        const t = (window as any).__TIMING;
        if (t && !t.firstTokenAt) {
          t.firstTokenAt = performance.now();
          t.firstTokenType = 'thinking';
          const ttft = t.firstTokenAt - t.sendAt;
          console.log(`[TIMING] FIRST TOKEN (thinking) at ${t.firstTokenAt.toFixed(1)}ms — TTFT: ${ttft.toFixed(1)}ms`);
        }
        breakSequence();
        store.appendSegment(panel, 'think', msg.text);
      }
      break;

    case 'tool_call': {
      const segType = toolNameToSegmentType(msg.toolName || '');
      const toolCallId = msg.toolCallId || '';
      const segCount = usePanelStore.getState().panels[panel]?.segments.length ?? 0;

      const action = onToolCall(segType, toolCallId, segCount);

      if (action.action === 'new') {
        store.pushSegment(panel, {
          type: segType,
          content: '',
          toolCallId,
          toolArgs: msg.toolArgs,
        });
      }
      // 'extend' = tool was added to existing group segment. No store action needed.

      break;
    }

    case 'tool_result': {
      const toolCallId = msg.toolCallId || '';
      const groupLookup = getGroupForResult(toolCallId);

      if (groupLookup) {
        // Grouped tool — append summary line to the group's segment.
        // Uses layer 2 (toolCallMap) which survives thinking interleaving.
        const summaryFieldName = getSummaryField(groupLookup.type);
        const summaryValue = summaryFieldName && msg.toolArgs?.[summaryFieldName];
        const summaryLine = typeof summaryValue === 'string'
          ? summaryValue
          : msg.toolOutput?.slice(0, 80) || groupLookup.type;
        const existing = usePanelStore.getState().panels[panel]?.segments[groupLookup.segmentIndex]?.content;
        const prefix = existing ? '\n' : '';
        store.appendSegmentContentByIndex(panel, groupLookup.segmentIndex, prefix + summaryLine);
      } else if (toolCallId) {
        // Non-grouped tool — set full content on the segment.
        store.updateSegmentByToolCallId(panel, toolCallId, {
          content: msg.toolOutput || '',
          toolArgs: msg.toolArgs,
          toolDisplay: msg.toolDisplay,
          isError: msg.isError,
          complete: true,
        });
      }

      break;
    }

    case 'turn_end': {
      // turn_end signals that the API has finished producing content.
      // All segments and their content have been delivered.
      //
      // We do NOT finalize the turn here. Instead we set pendingTurnEnd,
      // which tells the renderer "whenever you finish revealing, call
      // finalizeTurn." This decouples stream completion from render
      // completion — the renderer might be far behind the stream.
      //
      // LIFECYCLE:
      //   turn_end arrives → setPendingTurnEnd(true)
      //                    → MessageList passes onRevealComplete to LiveSegmentRenderer
      //                    → LiveSegmentRenderer's completion effect checks:
      //                        revealedCount >= segments.length AND onRevealComplete defined
      //                    → When both true: finalizeTurn() fires ONCE
      //                    → currentTurn.status = 'complete', pendingTurnEnd = false
      //
      // EITHER ORDER IS SAFE:
      //   Stream finishes first: pendingTurnEnd set, renderer catches up later, effect fires.
      //   Renderer catches up first: all revealed, then turn_end arrives, effect fires.
      //
      // See LiveSegmentRenderer.tsx completion detection comments for the
      // full explanation of why this is an effect and not a callback.
      const currentTurn = usePanelStore.getState().panels[panel]?.currentTurn;

      if (currentTurn) {
        // Mark last segment complete (closing tag) so reveal knows it's done
        const segs = usePanelStore.getState().panels[panel]?.segments || [];
        if (segs.length > 0) {
          const lastSeg = segs[segs.length - 1];
          if (!lastSeg.complete) {
            store.updateSegmentByToolCallId(panel, lastSeg.toolCallId || '', {
              complete: true,
            });
            if (!lastSeg.toolCallId) {
              store.updateLastSegment(panel, { complete: true });
            }
          }
        }
        store.setPendingTurnEnd(panel, true);
      }

      break;
    }

    case 'status_update':
      if (msg.contextUsage !== undefined) {
        store.setContextUsage(msg.contextUsage);
      }
      break;

    case 'request':
      console.log('[WS] Agent request:', msg.requestType);
      break;

    case 'auth_error':
      showToast(msg.message || 'Authentication failed. Run `kimi login` in your terminal.');
      break;

    case 'error':
      console.error('[WS] Wire error:', msg.error);
      break;

    // Thread management
    case 'thread:list':
      console.log('[WS] thread:list received:', msg.threads?.length, 'threads');
      if (msg.threads) {
        store.setThreads(msg.threads);
      }
      break;

    case 'thread:created':
      console.log('[WS] thread:created received:', msg.threadId, msg.thread);
      if (msg.thread && msg.threadId) {
        store.addThread({ threadId: msg.threadId, entry: msg.thread });
        store.setCurrentThreadId(msg.threadId);
        store.clearPanel(panel);
        loadRootTree();
      } else {
        console.error('[WS] thread:created missing data:', msg);
      }
      break;

    case 'thread:opened': {
      // Use the panel from the message if available, otherwise fall back to currentPanel.
      // This prevents cross-panel pollution (e.g., issues daily thread writing to explorer).
      const targetPanel = msg.panel || panel;
      console.log('[WS] thread:opened:', msg.threadId?.slice(0, 8), 'panel:', targetPanel, 'exchanges:', msg.exchanges?.length, 'history:', msg.history?.length, 'contextUsage:', msg.contextUsage);
      if (msg.threadId && msg.thread) {
        // Only update current thread if this is the active panel
        if (targetPanel === panel) {
          store.setCurrentThreadId(msg.threadId);
        }
        store.clearPanel(targetPanel);

        if (msg.exchanges && msg.exchanges.length > 0) {
          console.log('[WS] Loading', msg.exchanges.length, 'exchanges (rich format)');
          convertExchangesToMessages(targetPanel, msg.exchanges);
        } else if (msg.history && msg.history.length > 0) {
          console.log('[WS] Loading', msg.history.length, 'messages (legacy format)');
          convertHistoryToMessages(targetPanel, msg.history);
        }

        // Restore context usage from last exchange if available
        if (msg.contextUsage !== undefined && msg.contextUsage !== null) {
          console.log('[WS] Restoring context usage:', msg.contextUsage);
          store.setContextUsage(msg.contextUsage);
        } else {
          console.log('[WS] No contextUsage to restore - msg.contextUsage:', msg.contextUsage);
        }
      }
      break;
    }

    case 'wire_ready':
      store.setWireReady(true);
      break;

    case 'thread:renamed':
      if (msg.threadId && msg.name) {
        store.updateThread(msg.threadId, { name: msg.name });
      }
      break;

    case 'thread:deleted':
      if (msg.threadId) {
        store.removeThread(msg.threadId);
      }
      break;

    case 'message:sent':
      console.log('[WS] Message saved to thread');
      break;

    case 'modal:show':
      showModal(msg as unknown as import('../lib/modal').ModalConfig);
      break;

    case 'panel_config':
      if ((msg as any).projectRoot) {
        store.setProjectRoot((msg as any).projectRoot);
      }
      break;

    case 'file_changed': {
      // Invalidate central cache — triggers re-fetch for affected entries
      const fileData = useFileDataStore.getState();
      const changedPath = (msg as any).filePath || '';
      const changedPanel = (msg as any).panel;
      if (changedPanel && changedPath) {
        fileData.invalidate(changedPanel, changedPath);
      }

      // Also re-fetch if the active resource matches (page view live update)
      const activeRes = useActiveResourceStore.getState().activeResource;
      if (activeRes && changedPath.endsWith(activeRes.relativePath)) {
        const ws = store.ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'file_content_request',
            panel: activeRes.panel,
            path: activeRes.relativePath,
          }));
        }
      }
      break;
    }

    // --- Central file data cache population ---
    case 'file_tree_response': {
      const m = msg as any;
      if (m.panel && m.path) {
        useFileDataStore.getState().handleTreeResponse(m.panel, m.path, m.nodes || []);
      }
      break;
    }

    case 'file_content_response': {
      const m = msg as any;
      if (m.panel && m.path && m.success) {
        useFileDataStore.getState().handleContentResponse(m.panel, m.path, m.content || '');
      }
      break;
    }

    case 'file:moved':
      console.log('[WS] File moved:', msg);
      break;

    case 'file:move_error':
      showToast(`File move failed: ${(msg as any).error}`);
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

// --- History conversion helpers ---

function convertExchangesToMessages(panel: string, exchanges: ExchangeData[]) {
  const store = usePanelStore.getState();
  exchanges.forEach((exchange, idx) => {
    store.addMessage(panel, {
      id: `ex-${idx}-user`,
      type: 'user',
      content: exchange.user,
      timestamp: exchange.ts,
    });

    const segments = exchange.assistant.parts.map((part) => convertPartToSegment(part));
    const assistantContent = exchange.assistant.parts
      .filter((p): p is { type: 'text'; content: string } => p.type === 'text')
      .map((p) => p.content)
      .join('');

    store.addMessage(panel, {
      id: `ex-${idx}-assistant`,
      type: 'assistant',
      content: assistantContent,
      timestamp: exchange.ts,
      segments: segments.length > 0 ? segments : undefined,
    });
  });
}

function convertPartToSegment(part: AssistantPart): StreamSegment {
  if (part.type === 'text') {
    return { type: 'text', content: part.content };
  } else if (part.type === 'think') {
    return { type: 'think', content: part.content };
  } else {
    const segType = toolNameToSegmentType(part.name);
    const info = SEGMENT_ICONS[segType];
    return {
      type: segType,
      content: part.result.output || '',
      toolCallId: part.toolCallId,
      icon: info?.icon,
      toolArgs: part.arguments,
      toolDisplay: part.result.display,
      isError: !!part.result.error,
    };
  }
}

function convertHistoryToMessages(
  panel: string,
  history: { role: 'user' | 'assistant'; content: string; hasToolCalls?: boolean }[],
) {
  const store = usePanelStore.getState();
  history.forEach((h, idx) => {
    store.addMessage(panel, {
      id: `hist-${idx}`,
      type: h.role,
      content: h.content,
      timestamp: Date.now() - (history.length - idx) * 1000,
    });
  });
}
