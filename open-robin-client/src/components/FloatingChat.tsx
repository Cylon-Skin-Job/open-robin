/**
 * @module FloatingChat
 * @role Draggable floating container for the chat engine
 * @reads none — pure wrapper
 *
 * Renders a round chat_bubble button in the bottom-right corner.
 * Click to expand into a floating, draggable chat panel containing
 * the existing ChatArea component. Works with any workspace.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { ChatArea } from './ChatArea';

interface FloatingChatProps {
  panel: string;
}

export function FloatingChat({ panel }: FloatingChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [initialized, setInitialized] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Set initial position to bottom-right on first open
  useEffect(() => {
    if (isOpen && !initialized) {
      const panelWidth = 420;
      const panelHeight = 520;
      setPosition({
        x: window.innerWidth - panelWidth - 80,
        y: window.innerHeight - panelHeight - 80,
      });
      setInitialized(true);
    }
  }, [isOpen, initialized]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from the header bar
    if (!(e.target as HTMLElement).closest('.floating-chat-header')) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: position.x,
      origY: position.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [position]);

  return (
    <>
      {/* Floating chat panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className="floating-chat-panel"
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
          }}
          onMouseDown={handleMouseDown}
        >
          <div className="floating-chat-header">
            <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>chat_bubble</span>
            <span className="floating-chat-title">{panel} assistant</span>
            <button
              className="floating-chat-close"
              onClick={() => setIsOpen(false)}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="floating-chat-body">
            <ChatArea panel={panel} scope="view" />
          </div>
        </div>
      )}

      {/* FAB button */}
      {!isOpen && (
        <button
          className="floating-chat-fab"
          onClick={() => setIsOpen(true)}
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
