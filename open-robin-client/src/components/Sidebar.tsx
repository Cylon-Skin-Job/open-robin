import { useEffect, useState, useCallback, useRef } from 'react';
import { usePanelStore } from '../state/panelStore';
import { logger } from '../lib/logger';

// FLIP animation for thread reordering
function useThreadAnimation(threads: { threadId: string }[]) {
  const threadRefs = useRef<Map<string, HTMLElement>>(new Map());
  const prevOrder = useRef<string[]>([]);
  const isAnimating = useRef(false);

  const setThreadRef = useCallback((threadId: string, el: HTMLElement | null) => {
    if (el) {
      threadRefs.current.set(threadId, el);
    } else {
      threadRefs.current.delete(threadId);
    }
  }, []);

  useEffect(() => {
    if (isAnimating.current) return;
    
    const currentOrder = threads.map(t => t.threadId);
    const prev = prevOrder.current;
    
    // Skip first render or if order hasn't changed
    if (prev.length === 0 || JSON.stringify(prev) === JSON.stringify(currentOrder)) {
      prevOrder.current = currentOrder;
      return;
    }

    // Capture initial positions (First)
    const positions = new Map<string, { top: number; left: number }>();
    threadRefs.current.forEach((el, threadId) => {
      const rect = el.getBoundingClientRect();
      positions.set(threadId, { top: rect.top, left: rect.left });
    });

    // Store previous order and let React update DOM (Last happens after this effect)
    prevOrder.current = currentOrder;
    
    // Next frame: calculate differences and animate (Invert + Play)
    requestAnimationFrame(() => {
      const animations: { el: HTMLElement; dy: number }[] = [];
      
      threadRefs.current.forEach((el, threadId) => {
        const oldPos = positions.get(threadId);
        if (!oldPos) return;
        
        const newRect = el.getBoundingClientRect();
        const dy = oldPos.top - newRect.top;
        
        if (Math.abs(dy) > 1) {
          animations.push({ el, dy });
        }
      });

      if (animations.length === 0) return;

      isAnimating.current = true;

      // Find the thread moving to top (highest upward movement)
      const topMover = animations.reduce((max, curr) => 
        curr.dy > max.dy ? curr : max, animations[0]
      );

      // Apply initial offset (Invert)
      animations.forEach(({ el, dy }) => {
        el.style.transform = `translateY(${dy}px)`;
        el.style.transition = 'none';
        el.style.zIndex = '1';
      });

      // Highlight the thread being promoted to top
      if (topMover && topMover.dy > 50) {
        topMover.el.style.zIndex = '20';
        topMover.el.style.boxShadow = '0 8px 32px rgba(var(--theme-primary-rgb), 0.15), 0 0 0 1px rgba(var(--theme-primary-rgb), 0.3)';
        topMover.el.style.background = 'rgba(var(--theme-primary-rgb), 0.05)';
      }

      // Force reflow
      document.body.offsetHeight;

      // Animate to final position (Play)
      requestAnimationFrame(() => {
        animations.forEach(({ el }) => {
          el.style.transition = 'transform 400ms cubic-bezier(0.2, 0, 0.2, 1), box-shadow 400ms ease, background 400ms ease';
          el.style.transform = 'translateY(0)';
        });

        // Cleanup after animation
        setTimeout(() => {
          animations.forEach(({ el }) => {
            el.style.transition = '';
            el.style.transform = '';
            el.style.zIndex = '';
            el.style.boxShadow = '';
            el.style.background = '';
          });
          isAnimating.current = false;
        }, 400);
      });
    });
  }, [threads]);

  return { setThreadRef };
}

interface SidebarProps {
  panel: string;
}

interface ConfirmationModal {
  show: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Sidebar({ panel }: SidebarProps) {
  const config = usePanelStore((s) => s.getPanelConfig(panel));
  const ws = usePanelStore((state) => state.ws);
  const threads = usePanelStore((state) => state.threads);
  const currentThreadId = usePanelStore((state) => state.currentThreadId);
  const { setThreadRef } = useThreadAnimation(threads);
  
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmationModal>({
    show: false,
    message: '',
    onConfirm: () => {},
    onCancel: () => {}
  });
  const setCurrentThreadId = usePanelStore((state) => state.setCurrentThreadId);
  
  // Request thread list when connected
  useEffect(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'thread:list' }));
    }
  }, [ws, panel]);

  // Handle WebSocket messages for confirmation modal and copy link
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'thread:create:confirm') {
          setConfirmModal({
            show: true,
            message: msg.message,
            onConfirm: () => {
              sendMessage({ type: 'thread:create', confirmed: true });
              setConfirmModal(prev => ({ ...prev, show: false }));
            },
            onCancel: () => {
              setConfirmModal(prev => ({ ...prev, show: false }));
            }
          });
        } else if (msg.type === 'thread:link') {
          // Copy the file path to clipboard
          if (msg.filePath) {
            navigator.clipboard.writeText(msg.filePath).then(() => {
              // Show a brief success indicator (could be enhanced with a toast)
              console.log('[Sidebar] Copied link to clipboard:', msg.filePath);
            }).catch(err => {
              console.error('[Sidebar] Failed to copy link:', err);
            });
          }
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);
  
  const sendMessage = useCallback((msg: object) => {
    console.log('[Sidebar] Sending:', msg, 'WS state:', ws?.readyState);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      console.error('[Sidebar] WebSocket not connected! State:', ws?.readyState);
    }
  }, [ws]);
  
  const handleCreateThread = () => {
    logger.info('[Sidebar] New Thread — clearing thread to show harness picker');
    setCurrentThreadId(null);
  };
  
  const handleOpenThread = (threadId: string) => {
    sendMessage({ type: 'thread:open', threadId });
  };
  
  const handleRenameStart = (threadId: string, currentName: string) => {
    setRenamingId(threadId);
    setRenameValue(currentName);
  };
  
  const handleRenameSubmit = (threadId: string) => {
    if (renameValue.trim()) {
      sendMessage({ 
        type: 'thread:rename', 
        threadId, 
        name: renameValue.trim() 
      });
    }
    setRenamingId(null);
    setRenameValue('');
  };
  
  const handleRenameCancel = () => {
    setRenamingId(null);
    setRenameValue('');
  };
  
  const handleDeleteThread = (threadId: string) => {
    if (confirm('Delete this conversation?')) {
      sendMessage({ type: 'thread:delete', threadId });
    }
  };
  
  const handleCopyLink = (threadId: string) => {
    sendMessage({ type: 'thread:copyLink', threadId });
  };
  
  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'unknown';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return 'unknown';
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch (e) {
      return 'unknown';
    }
  };
  
  return (
    <aside className="sidebar">
      <div className="sidebar-header">{config?.name || panel}</div>
      
      <button 
        className="new-chat-btn"
        onClick={handleCreateThread}
      >
        <span className="material-symbols-outlined">add</span>
        New Thread
      </button>
      
      <div className="thread-list">
        {!threads || threads.length === 0 ? (
          <div className="chat-item">
            <span className="chat-item-text">No threads yet</span>
          </div>
        ) : (
          threads.filter(t => t && t.threadId && t.entry).map((thread) => (
            <div 
              key={thread.threadId}
              ref={(el) => setThreadRef(thread.threadId, el)}
              className={`chat-item ${currentThreadId === thread.threadId ? 'active' : ''}`}
              onClick={() => handleOpenThread(thread.threadId)}
            >
              {renamingId === thread.threadId ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit(thread.threadId);
                    if (e.key === 'Escape') handleRenameCancel();
                  }}
                  onBlur={() => handleRenameSubmit(thread.threadId)}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    padding: '2px 4px',
                    fontSize: '12px',
                    border: '1px solid var(--theme-border)',
                    borderRadius: '4px',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)'
                  }}
                />
              ) : (
                <>
                  <div className="thread-row thread-row-top">
                    <span className="chat-item-text" title={thread.entry?.name || 'Unnamed'}>
                      {thread.entry?.name || 'Unnamed'}
                      {thread.entry?.status === 'active' && (
                        <span style={{ color: '#4caf50', marginLeft: '4px', fontSize: '8px' }}>●</span>
                      )}
                    </span>
                    <button 
                      className="thread-menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === thread.threadId ? null : thread.threadId);
                      }}
                      title="More options"
                    >
                      ⋮
                    </button>
                    {menuOpenId === thread.threadId && (
                      <div className="thread-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                        <button 
                          onClick={() => {
                            handleRenameStart(thread.threadId, thread.entry?.name || 'Unnamed');
                            setMenuOpenId(null);
                          }}
                        >
                          ✎ Rename
                        </button>
                        <button 
                          onClick={() => {
                            handleCopyLink(thread.threadId);
                            setMenuOpenId(null);
                          }}
                        >
                          ⎘ Copy Link
                        </button>
                        <button 
                          onClick={() => {
                            handleDeleteThread(thread.threadId);
                            setMenuOpenId(null);
                          }}
                        >
                          × Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="thread-row thread-row-bottom">
                    <span className="chat-item-meta">
                      {thread.entry?.messageCount || 0} msgs · {formatDate(thread.entry?.createdAt)}
                    </span>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmModal.show && (
        <div className="rv-confirm-modal-overlay" onClick={confirmModal.onCancel}>
          <div className="rv-confirm-modal-content" onClick={(e) => e.stopPropagation()}>
            <p className="rv-confirm-modal-message">{confirmModal.message}</p>
            <div className="rv-confirm-modal-buttons">
              <button className="rv-confirm-modal-btn rv-confirm-modal-btn-secondary" onClick={confirmModal.onCancel}>
                Cancel
              </button>
              <button className="rv-confirm-modal-btn rv-confirm-modal-btn-primary" onClick={confirmModal.onConfirm}>
                Create Anyway
              </button>
            </div>
          </div>
        </div>
      )}

    </aside>
  );
}
