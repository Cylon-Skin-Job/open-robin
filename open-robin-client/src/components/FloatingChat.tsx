/**
 * @module FloatingChat
 * @role Universal floating popup for view-scoped chats.
 *
 * SPEC-26d: mounted once at the app shell level (in App.tsx).
 * FAB button always visible on chat-enabled views. Popup opens
 * to the MRU view thread (or harness picker if none exist).
 * Menu button → ThreadPickerModal. X → close with state preserved.
 * Draggable by header. Resizable from bottom-right corner.
 * Position + size persisted per view via viewStates.
 */

import { useState, useRef, useCallback } from 'react';
import { usePanelStore } from '../state/panelStore';
import { ChatArea } from './ChatArea';
import { ThreadPickerModal } from './ThreadPickerModal';

const MIN_WIDTH = 300;
const MIN_HEIGHT = 300;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 700;
const DEFAULT_PADDING = 80;

export function FloatingChat() {
  const currentPanel = usePanelStore((s) => s.currentPanel);
  const hasChat = usePanelStore((s) => {
    const config = s.panelConfigs.find(c => c.id === currentPanel);
    return !!config?.hasChat;
  });
  const popupState = usePanelStore((s) => s.viewStates[currentPanel]?.popup);
  const openFloatingChat = usePanelStore((s) => s.openFloatingChat);
  const closeFloatingChat = usePanelStore((s) => s.closeFloatingChat);
  const setPopupPosition = usePanelStore((s) => s.setPopupPosition);
  const setPopupSize = usePanelStore((s) => s.setPopupSize);
  const commitPopupState = usePanelStore((s) => s.commitPopupState);

  const [modalOpen, setModalOpen] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // Don't render FAB on views without chat
  if (!hasChat) return null;

  const isOpen = popupState?.open ?? false;

  // Resolve position: -1 means "compute default"
  const popupWidth = popupState?.width ?? 420;
  const popupHeight = popupState?.height ?? 520;
  let posX = popupState?.x ?? -1;
  let posY = popupState?.y ?? -1;
  if (posX < 0 || posY < 0) {
    posX = window.innerWidth - popupWidth - DEFAULT_PADDING;
    posY = window.innerHeight - popupHeight - DEFAULT_PADDING;
  }

  // --- Drag handlers ---
  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.floating-chat-header')) return;
    if ((e.target as HTMLElement).closest('button')) return; // don't drag when clicking buttons
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: posX, origY: posY };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPopupPosition(
        currentPanel,
        dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      );
    };

    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      commitPopupState(currentPanel);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [posX, posY, currentPanel, setPopupPosition, commitPopupState]);

  // --- Resize handlers (bottom-right corner) ---
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: popupWidth, origH: popupHeight };
    document.body.style.userSelect = 'none';

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const newW = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH,
        resizeRef.current.origW + (ev.clientX - resizeRef.current.startX)));
      const newH = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT,
        resizeRef.current.origH + (ev.clientY - resizeRef.current.startY)));
      setPopupSize(currentPanel, newW, newH);
    };

    const handleUp = () => {
      resizeRef.current = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      commitPopupState(currentPanel);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [popupWidth, popupHeight, currentPanel, setPopupSize, commitPopupState]);

  return (
    <>
      {/* Floating chat panel */}
      {isOpen && (
        <>
          <div
            className="floating-chat-panel"
            style={{
              left: `${posX}px`,
              top: `${posY}px`,
              width: `${popupWidth}px`,
              height: `${popupHeight}px`,
            }}
            onMouseDown={handleDragMouseDown}
          >
            <div className="floating-chat-header">
              {/* Menu button (upper-left) */}
              <button
                className="floating-chat-menu-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setModalOpen(true);
                }}
                title="Switch thread"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>

              {/* Title */}
              <span className="floating-chat-title">{currentPanel} assistant</span>

              {/* Exit button (upper-right) */}
              <button
                className="floating-chat-close"
                onClick={closeFloatingChat}
                title="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="floating-chat-body">
              <ChatArea panel={currentPanel} scope="view" />
            </div>

            {/* Resize handle (bottom-right corner) */}
            <div
              className="floating-chat-resize-handle"
              onMouseDown={handleResizeMouseDown}
            />
          </div>

          {/* Thread picker modal */}
          {modalOpen && (
            <ThreadPickerModal onClose={() => setModalOpen(false)} />
          )}
        </>
      )}

      {/* FAB button — visible when popup is closed */}
      {!isOpen && (
        <button
          className="floating-chat-fab"
          onClick={openFloatingChat}
          title="Open chat"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            chat_bubble
          </span>
        </button>
      )}
    </>
  );
}
