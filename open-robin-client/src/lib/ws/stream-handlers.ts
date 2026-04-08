/**
 * @module stream-handlers
 * @role Handle stream-related WebSocket messages (turn lifecycle, tool grouping, timing).
 *
 * Extracted from ws-client.ts (spec 05a) so the most fragile part of the
 * message router is isolated and testable. Everything else stays in ws-client.
 */

import { usePanelStore } from '../../state/panelStore';
import { toolNameToSegmentType } from '../instructions';
import { getSummaryField } from '../catalog-visual';
import {
  onToolCall,
  getGroupForResult,
  breakSequence,
  reset as resetGrouper,
} from '../tool-grouper';
import { showToast } from '../toast';
import type { WebSocketMessage } from '../../types';

/**
 * Handle stream-related WebSocket messages.
 * Returns true if the message was handled, false if not recognized.
 */
export function handleStreamMessage(msg: WebSocketMessage): boolean {
  const store = usePanelStore.getState();
  const panel = store.currentPanel;

  switch (msg.type) {
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

      return true;
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
      return true;

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
      return true;

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

      return true;
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

      return true;
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

      return true;
    }

    case 'status_update':
      if (msg.contextUsage !== undefined) {
        store.setContextUsage(msg.contextUsage);
      }
      return true;

    case 'request':
      console.log('[WS] Agent request:', msg.requestType);
      return true;

    case 'auth_error':
      showToast(msg.message || 'Authentication failed. Run `kimi login` in your terminal.');
      return true;

    case 'error':
      console.error('[WS] Wire error:', msg.error);
      return true;

    default:
      return false;
  }
}

/**
 * Reset stream state (called on reconnect from ws-client.ts).
 * Exported so the connection lifecycle can reset grouper on reconnect.
 */
export { reset as resetStreamState } from '../tool-grouper';
