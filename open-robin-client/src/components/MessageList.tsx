/**
 * MessageList — Pure routing between Live and Instant renderers.
 *
 * History messages → InstantSegmentRenderer (collapsed, no animation)
 * Current turn     → LiveSegmentRenderer (orb gatekeeper → animated typing)
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ TURN FINALIZATION HANDOFF                                       │
 * │                                                                 │
 * │ This component bridges the store (pendingTurnEnd) and the       │
 * │ renderer (onRevealComplete callback).                           │
 * │                                                                 │
 * │ When pendingTurnEnd is true (turn_end received from API),       │
 * │ onRevealComplete is set to finalizeTurn. LiveSegmentRenderer    │
 * │ calls it when ALL segments have finished revealing.             │
 * │                                                                 │
 * │ The callback can arrive in EITHER ORDER:                        │
 * │   - turn_end first, then renderer catches up → works           │
 * │   - Renderer done first, then turn_end arrives → works         │
 * │                                                                 │
 * │ See LiveSegmentRenderer.tsx for the completion detection logic  │
 * │ that makes both orderings safe.                                 │
 * │                                                                 │
 * │ CRITICAL: onRevealComplete must be undefined (not a no-op)      │
 * │ when pendingTurnEnd is false. LiveSegmentRenderer uses the      │
 * │ presence/absence of this prop as part of its completion gate.   │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { usePanelStore } from '../state/panelStore';
import type { Message, AssistantTurn, StreamSegment } from '../types';
import { LiveSegmentRenderer } from './LiveSegmentRenderer';
import { InstantSegmentRenderer } from './InstantSegmentRenderer';

interface MessageListProps {
  panel: string;
  messages: Message[];
  currentTurn: AssistantTurn | null;
  segments: StreamSegment[];
  lastUserMsgRef?: React.RefObject<HTMLDivElement | null>;
  showOrb?: boolean;
}

export function MessageList({
  panel,
  messages,
  currentTurn,
  segments,
  lastUserMsgRef,
  showOrb,
}: MessageListProps) {
  const pendingTurnEnd = usePanelStore((s) => s.panels[panel].pendingTurnEnd);
  const finalizeTurn = usePanelStore((s) => s.finalizeTurn);

  // CRITICAL: undefined when not pending, NOT a no-op function.
  // LiveSegmentRenderer's completion effect checks `if (!onRevealComplete) return;`
  const onRevealComplete = pendingTurnEnd ? () => finalizeTurn(panel) : undefined;

  // Find the last user message index for scroll anchoring
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'user') { lastUserIdx = i; break; }
  }

  return (
    <>
      {messages.map((msg, i) => (
        <div
          key={msg.id}
          ref={i === lastUserIdx ? lastUserMsgRef : undefined}
          className={`message message-${msg.type}`}
        >
          {msg.type === 'user' ? (
            <div className="message-user-content">{msg.content}</div>
          ) : (
            <InstantSegmentRenderer segments={msg.segments} />
          )}
        </div>
      ))}

      {(currentTurn || showOrb) && (
        <div className="message message-assistant">
          <LiveSegmentRenderer
            segments={segments}
            onRevealComplete={onRevealComplete}
          />
        </div>
      )}
    </>
  );
}
