/**
 * @module thread-handlers
 * @role Handle thread-related WebSocket messages (CRUD, history conversion).
 *
 * Extracted from ws-client.ts (spec 05b) so thread logic is isolated.
 */

import { usePanelStore } from '../../state/panelStore';
import { toolNameToSegmentType, SEGMENT_ICONS } from '../instructions';
import { loadRootTree } from '../file-tree';
import type { WebSocketMessage, ExchangeData, AssistantPart, StreamSegment } from '../../types';

/**
 * Handle thread-related WebSocket messages.
 * Returns true if the message was handled, false if not recognized.
 */
export function handleThreadMessage(msg: WebSocketMessage): boolean {
  const store = usePanelStore.getState();
  const panel = store.currentPanel;

  switch (msg.type) {
    case 'thread:list':
      console.log('[WS] thread:list received:', msg.threads?.length, 'threads');
      if (msg.threads) {
        store.setThreads(msg.threads);
      }
      return true;

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
      return true;

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
      return true;
    }

    case 'wire_ready':
      store.setWireReady(true);
      return true;

    case 'thread:renamed':
      if (msg.threadId && msg.name) {
        store.updateThread(msg.threadId, { name: msg.name });
      }
      return true;

    case 'thread:deleted':
      if (msg.threadId) {
        store.removeThread(msg.threadId);
      }
      return true;

    case 'message:sent':
      console.log('[WS] Message saved to thread');
      return true;

    default:
      return false;
  }
}

// --- History conversion helpers (private to this module) ---

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
