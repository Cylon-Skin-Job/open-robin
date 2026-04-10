/**
 * @module ThreadPickerModal
 * @role Modal for switching between view-scoped threads.
 *
 * SPEC-26d: opened by the menu button in FloatingChat's header.
 * Shows all view-scoped threads for the current panel, MRU sorted.
 * "+ New Chat" at the top creates a new thread via the harness picker.
 */

import { useEffect, useCallback } from 'react';
import { usePanelStore } from '../state/panelStore';
import type { Thread } from '../types';

interface ThreadPickerModalProps {
  onClose: () => void;
}

export function ThreadPickerModal({ onClose }: ThreadPickerModalProps) {
  const threads = usePanelStore((s) => s.threads.view);
  const currentThreadId = usePanelStore((s) => s.currentThreadIds.view);
  const ws = usePanelStore((s) => s.ws);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleNewChat = useCallback(() => {
    // Clear the current view thread so ChatArea shows the harness picker.
    const store = usePanelStore.getState();
    store.setCurrentThreadId('view', null);
    onClose();
  }, [onClose]);

  const handlePick = useCallback((threadId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'thread:open-assistant',
      scope: 'view',
      threadId,
    }));
    onClose();
  }, [ws, onClose]);

  // threads.view is already MRU-sorted from the server
  return (
    <div className="rv-modal-overlay" onClick={onClose}>
      <div
        className="rv-modal-shell rv-thread-picker-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pick a view chat thread"
      >
        <div className="rv-modal-header">
          <span className="rv-modal-title">Switch chat</span>
          <button className="rv-modal-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="rv-modal-body">
          <button className="rv-thread-picker-new" onClick={handleNewChat}>
            <span className="material-symbols-outlined">add</span>
            New chat
          </button>

          <div className="rv-thread-picker-list">
            {threads.length === 0 ? (
              <div className="rv-thread-picker-empty">No previous chats for this view.</div>
            ) : (
              threads.map((thread: Thread) => (
                <button
                  key={thread.threadId}
                  className={`rv-thread-picker-item ${thread.threadId === currentThreadId ? 'rv-thread-picker-item--active' : ''}`}
                  onClick={() => handlePick(thread.threadId)}
                >
                  <span className="rv-thread-picker-name">
                    {thread.entry?.name || thread.threadId.replace(/-\d{3}$/, '')}
                  </span>
                  <span className="rv-thread-picker-meta">
                    {thread.entry?.messageCount || 0} msgs
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
