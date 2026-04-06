/**
 * @module ClipboardPopover
 * @role Presentational list of clipboard entries
 */

import { useEffect, useRef, useCallback, forwardRef } from 'react';
import { useClipboardStore } from './clipboard-store';
import { copyFromHistory, clearHistory, listPage } from './clipboard-api';
import type { ClipboardEntry } from './types';

type PopoverState = 'CLOSED' | 'PREVIEW' | 'LOCKED';

interface ClipboardPopoverProps {
  state: PopoverState;
  position: { left: number; bottom: number };
  popoverProps?: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
}

export const ClipboardPopover = forwardRef<HTMLDivElement, ClipboardPopoverProps>(
  ({ state, position, popoverProps }, ref) => {
  const items = useClipboardStore((s) => s.items);
  const total = useClipboardStore((s) => s.total);
  const selectedIndex = useClipboardStore((s) => s.selectedIndex);
  const isLoading = useClipboardStore((s) => s.isLoading);
  const error = useClipboardStore((s) => s.error);
  const close = useClipboardStore((s) => s.close);

  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          useClipboardStore.getState().selectNext();
          break;
        case 'ArrowUp':
          e.preventDefault();
          useClipboardStore.getState().selectPrev();
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < items.length) {
            handleItemClick(items[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [items, selectedIndex, close]);

  // Load more handler
  const handleLoadMore = useCallback(async () => {
    try {
      useClipboardStore.getState().setLoading(true);
      const { items: newItems, total: newTotal } = await listPage(items.length, 30);
      useClipboardStore.getState().setItems([...items, ...newItems], newTotal);
    } catch (err) {
      console.error('[Clipboard] Failed to load more:', err);
    } finally {
      useClipboardStore.getState().setLoading(false);
    }
  }, [items]);

  // Handle item click
  const handleItemClick = useCallback(async (entry: ClipboardEntry) => {
    await copyFromHistory(entry);
    close();
  }, [close]);

  // Handle clear
  const handleClear = useCallback(async () => {
    if (confirm('Clear all clipboard history?')) {
      await clearHistory();
      useClipboardStore.getState().clearItems();
    }
  }, []);

  const hasMore = total > items.length;

  return (
    <div
      ref={ref}
      className={`clipboard-bubble open ${state === 'LOCKED' ? 'locked' : ''}`}
      style={{
        position: 'fixed',
        left: position.left,
        bottom: position.bottom,
      }}
      {...popoverProps}
    >
      <div className="clipboard-bubble-header">
        <span className="clipboard-bubble-title">History</span>
        {items.length > 0 && (
          <button
            className="clipboard-clear-btn"
            onClick={handleClear}
            title="Clear history"
          >
            <span className="material-symbols-outlined">delete</span>
          </button>
        )}
      </div>

      {isLoading && items.length === 0 ? (
        <div className="clipboard-bubble-loading">Loading...</div>
      ) : error ? (
        <div className="clipboard-bubble-error">{error}</div>
      ) : items.length === 0 ? (
        <div className="clipboard-bubble-empty">No clipboard history</div>
      ) : (
        <>
          {hasMore && (
            <button className="clipboard-load-more" onClick={handleLoadMore}>
              See more ({total - items.length} remaining)
            </button>
          )}

          <div ref={listRef} className="clipboard-list">
            {items.map((entry, index) => (
              <div
                key={entry.id}
                ref={index === selectedIndex ? selectedRef : null}
                className={`clipboard-entry ${index === selectedIndex ? 'clipboard-entry-selected' : ''}`}
                onClick={() => handleItemClick(entry)}
                onMouseEnter={() => useClipboardStore.getState().setSelected(index)}
              >
                <div className="clipboard-entry-preview">{entry.preview}</div>
                <div className="clipboard-entry-meta">
                  <span className="clipboard-entry-date">
                    {formatDate(entry.last_used_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="clipboard-hint">
            <span className="material-symbols-outlined">keyboard</span>
            <span>↑↓ to navigate, Enter to copy, Esc to close</span>
          </div>
        </>
      )}
    </div>
  );
});

ClipboardPopover.displayName = 'ClipboardPopover';

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60 * 1000) return 'Just now';
  if (diff < 60 * 60 * 1000) {
    const mins = Math.floor(diff / (60 * 1000));
    return `${mins}m ago`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}h ago`;
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
