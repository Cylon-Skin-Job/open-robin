import { useRef, useEffect, useState, useCallback } from 'react';
import { usePanelStore } from '../state/panelStore';
import { MessageList } from './MessageList';
import { ChatInput, type ChatInputRef } from './ChatInput';
import { ClipboardTrigger } from '../clipboard';
import { ScreenshotsTrigger } from '../screenshots';
import { RecentFilesTrigger } from '../recent-files';
import { EmojiTrigger } from '../emojis';
import { MicTrigger } from '../mic';
import {
  useHoverIconModal,
  HoverIconModalContainer,
  HoverIconModalList,
} from './hover-icon-modal';
import { ChatHarnessPicker, type HarnessStatus } from './ChatHarnessPicker';
import { ConnectingOverlay } from './ConnectingOverlay';
import { getHarnessOption } from '../config/harness';

interface ChatAreaProps {
  panel: string;
}

export function ChatArea({ panel }: ChatAreaProps) {
  const lastUserMsgRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputRef>(null);
  const justSentRef = useRef(false);
  const [isSending, setIsSending] = useState(false);
  const [connectingHarnessId, setConnectingHarnessId] = useState<string | null>(null);
  const [harnessStatuses, setHarnessStatuses] = useState<Record<string, HarnessStatus>>({});
  const [harnessLoading, setHarnessLoading] = useState(false);

  const handleInsertText = (text: string) => {
    chatInputRef.current?.insertText(text);
  };

  // Store data
  const messages = usePanelStore((state) => state.panels[panel]?.messages || []);
  const currentTurn = usePanelStore((state) => state.panels[panel]?.currentTurn || null);
  const segments = usePanelStore((state) => state.panels[panel]?.segments || []);
  const contextUsage = usePanelStore((state) => state.contextUsage);
  const currentThreadId = usePanelStore((state) => state.currentThreadId);
  const ws = usePanelStore((state) => state.ws);
  const wireReady = usePanelStore((state) => state.wireReady);
  const setWireReady = usePanelStore((state) => state.setWireReady);

  const addMessage = usePanelStore((state) => state.addMessage);
  const sendMessage = usePanelStore((state) => state.sendMessage);

  // No thread active → show inline harness picker
  const noThread = !currentThreadId;

  const handleHarnessSelect = useCallback((harnessId: string) => {
    setWireReady(false);
    setConnectingHarnessId(harnessId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'thread:create', harnessId }));
    }
  }, [ws, setWireReady]);

  // Fetch harness install statuses once on mount — passed to ChatHarnessPicker as props
  const fetchHarnessStatuses = useCallback(async () => {
    setHarnessLoading(true);
    try {
      const res = await fetch('/api/harnesses');
      if (!res.ok) return;
      const list: HarnessStatus[] = await res.json();
      const map = list.reduce((acc, s) => { acc[s.id] = s; return acc; }, {} as Record<string, HarnessStatus>);
      setHarnessStatuses(map);
    } catch {
      // silent — show local config as fallback
    } finally {
      setHarnessLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHarnessStatuses();
  }, [fetchHarnessStatuses]);

  // Clear overlay once wire is ready
  useEffect(() => {
    if (wireReady && connectingHarnessId) {
      setConnectingHarnessId(null);
      setWireReady(false);
    }
  }, [wireReady, connectingHarnessId, setWireReady]);

  // On send: scroll user bubble to top of viewport
  useEffect(() => {
    if (justSentRef.current && lastUserMsgRef.current) {
      justSentRef.current = false;
      lastUserMsgRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [messages.length]);

  // Hide orb state when first segment arrives
  useEffect(() => {
    if (segments.length > 0) {
      setIsSending(false);
    }
  }, [segments.length]);

  // Show orb if: local sending state OR streaming with no segments yet
  const showOrb = (isSending || currentTurn?.status === 'streaming') && segments.length === 0;

  const finalizeTurn = usePanelStore((state) => state.finalizeTurn);

  // Turn is active if there's a currentTurn (streaming or revealing).
  // This drives the send/stop button toggle.
  const isTurnActive = !!currentTurn || isSending;

  const handleSend = (text: string) => {
    setIsSending(true);

    // If there's an active turn, finalize it BEFORE adding the user
    // message. finalizeTurn snapshots to messages[], clears currentTurn.
    //
    // KNOWN PAST BUG (DO NOT REINTRODUCE):
    // User bubble appeared above the live assistant response mid-stream.
    const ps = usePanelStore.getState().panels[panel];
    if (ps?.currentTurn) {
      finalizeTurn(panel);
    }

    justSentRef.current = true;
    addMessage(panel, {
      id: Date.now().toString(),
      type: 'user',
      content: text,
      timestamp: Date.now()
    });

    sendMessage(text, panel);
  };

  // Stop: immediately finalize the turn — snap all remaining content
  // to display, move to history. The AI may keep running server-side
  // but the client moves on.
  const handleStop = () => {
    const ps = usePanelStore.getState().panels[panel];
    if (ps?.currentTurn) {
      finalizeTurn(panel);
    }
    setIsSending(false);
  };

  return (
    <section className="chat-area">
      <div className="chat-messages" ref={chatContainerRef} style={{ position: 'relative' }}>
        {connectingHarnessId ? (
          <ConnectingOverlay harnessName={getHarnessOption(connectingHarnessId)?.name} />
        ) : noThread ? (
          <ChatHarnessPicker
            onSelect={handleHarnessSelect}
            statuses={harnessStatuses}
            isLoading={harnessLoading}
          />
        ) : messages.length === 0 && !currentTurn && !showOrb ? (
          <div className="message message-system">
            Start a conversation
          </div>
        ) : (
          <MessageList
            panel={panel}
            messages={messages}
            currentTurn={currentTurn}
            segments={segments}
            lastUserMsgRef={lastUserMsgRef}
            showOrb={showOrb}
          />
        )}

        {/* Fixed spacer — always present, never changes size.
            Provides scroll room so user bubble can scroll to top of viewport. */}
        {!noThread && <div style={{ minHeight: '80vh' }} />}
      </div>

      <div className={`chat-footer${noThread ? ' rv-chat-footer--disabled' : ''}`}>
        <ChatInput
          ref={chatInputRef}
          onSend={handleSend}
          onStop={handleStop}
          disabled={noThread}
          panel={panel}
          isTurnActive={isTurnActive}
        />
        <div className="rv-chat-composer-meta-row">
          <div style={{ display: 'flex', gap: '4px' }}>
            <ClipboardTrigger onInsert={handleInsertText} />
            <ScreenshotsTrigger onInsert={handleInsertText} />
            <RecentFilesTrigger onInsert={handleInsertText} />
            <EmojiTrigger onInsert={handleInsertText} />
            <MicTrigger onInsert={handleInsertText} />
          </div>
          {isTurnActive ? (
            <button
              className="rv-chat-footer-btn stop-btn"
              onClick={handleStop}
              title="Stop generating"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                stop
              </span>
            </button>
          ) : (
            <SendButtonGroup 
              chatInputRef={chatInputRef}
              onSend={handleSend}
            />
          )}
        </div>
        <div className="rv-context-usage-container">
          <div className="rv-context-usage-bar-standalone">
            <div
              className="rv-context-usage-fill"
              style={{ width: `${Math.min(contextUsage * 100, 100)}%` }}
            />
          </div>
          <span className="rv-context-usage-text">{Math.round(contextUsage * 100)}%</span>
        </div>
      </div>
    </section>
  );
}

// Send button group with dropdown modal - following MicTrigger pattern
interface SendButtonGroupProps {
  chatInputRef: React.RefObject<ChatInputRef | null>;
  onSend: (text: string) => void;
}

function SendButtonGroup({ chatInputRef, onSend }: SendButtonGroupProps) {
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(null);

  const {
    isOpen,
    state,
    triggerRef,
    popoverRef,
    triggerProps,
    popoverProps,
    close,
  } = useHoverIconModal({
    id: 'send-dropdown',
    triggerMode: 'click', // Click only, no hover preview (like MicTrigger)
    stayOpenOnLeave: true, // Stays open until Escape/click outside
  });

  // Position the modal above the dropdown button (right-aligned)
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const modalWidth = 200; // Fixed width for dropdown menu
      setPopoverPos({
        left: rect.right - modalWidth,
        bottom: window.innerHeight - rect.top + 8,
      });
    }
  }, [isOpen, triggerRef]);

  const handleSendClick = () => {
    const text = chatInputRef.current?.getText();
    if (text?.trim()) {
      onSend(text.trim());
      chatInputRef.current?.clearText();
    }
  };

  return (
    <>
      <div className="rv-send-button-group">
        <button
          className="rv-send-btn-main"
          onClick={handleSendClick}
          title="Send message"
        >
          Send
        </button>
        <div className="rv-send-btn-divider" />
        <button
          ref={triggerRef}
          className="rv-send-btn-secondary"
          title="More options"
          {...triggerProps}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
            arrow_drop_down
          </span>
        </button>
      </div>

      <HoverIconModalContainer
        isOpen={isOpen}
        state={state}
        position={popoverPos ?? { left: 0, bottom: 0 }}
        popoverRef={popoverRef}
        popoverProps={popoverProps}
        className="rv-send-dropdown-modal"
      >
        <HoverIconModalList>
          <div className="rv-send-dropdown-content">
            <button className="rv-send-dropdown-item" onClick={() => { close(); }}>
              <span className="material-symbols-outlined">chat</span>
              <span>Send as chat</span>
            </button>
            <button className="rv-send-dropdown-item" onClick={() => { close(); }}>
              <span className="material-symbols-outlined">code</span>
              <span>Send as code block</span>
            </button>
            <button className="rv-send-dropdown-item" onClick={() => { close(); }}>
              <span className="material-symbols-outlined">terminal</span>
              <span>Send as command</span>
            </button>
          </div>
        </HoverIconModalList>
      </HoverIconModalContainer>
    </>
  );
}
