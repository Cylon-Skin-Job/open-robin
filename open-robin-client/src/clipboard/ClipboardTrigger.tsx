/**
 * @module ClipboardTrigger
 * @role Icon button that triggers the clipboard popover
 */

import { useEffect, useState, useRef } from 'react';
import {
  useHoverIconModal,
  useListNavigation,
  HoverIconTrigger,
  HoverIconModalContainer,
  HoverIconModalRow,
  HoverIconModalList,
  HoverIconModalContent,
  HoverIconModalLoading,
  HoverIconModalEmpty,
} from '../components/hover-icon-modal';
import { useClipboardStore } from './clipboard-store';
import { listPage } from './clipboard-api';
import type { ClipboardEntry } from './types';

interface ClipboardTriggerProps {
  onInsert?: (text: string) => void;
}

export function ClipboardTrigger({ onInsert }: ClipboardTriggerProps) {
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useClipboardStore((s) => s.items);
  const isLoading = useClipboardStore((s) => s.isLoading);
  const error = useClipboardStore((s) => s.error);

  const handleOpen = () => {
    if (items.length === 0) {
      loadItems();
    }
  };

  const loadItems = async () => {
    try {
      useClipboardStore.getState().setLoading(true);
      const { items: newItems } = await listPage(0, 50);
      useClipboardStore.getState().setItems(newItems, newItems.length);
    } catch (err) {
      console.error('[Clipboard] Failed to load items:', err);
      useClipboardStore.getState().setError('Failed to load clipboard history');
    } finally {
      useClipboardStore.getState().setLoading(false);
    }
  };

  const {
    isOpen,
    state,
    triggerRef,
    popoverRef,
    triggerProps,
    popoverProps,
    close,
  } = useHoverIconModal({
    onOpen: handleOpen,
    id: 'clipboard',
  });

  // Reverse items so newest is at bottom
  const displayItems = [...items].reverse();

  const {
    selectedIndex,
    handleItemClick,
    handleItemHover,
  } = useListNavigation<ClipboardEntry>({
    items: displayItems,
    isOpen,
    onSelect: (entry) => onInsert?.(entry.text),
    onClose: close,
    selectFromBottom: true,
  });

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopoverPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 12,
      });
      // Scroll to bottom to show newest
      setTimeout(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      }, 0);
    }
  }, [isOpen, triggerRef]);

  return (
    <>
      <HoverIconTrigger
        icon="content_paste"
        title="Clipboard history (click to open)"
        isOpen={isOpen}
        triggerRef={triggerRef}
        triggerProps={triggerProps}
      />

      <HoverIconModalContainer
        isOpen={isOpen}
        state={state}
        position={popoverPos ?? { left: 0, bottom: 0 }}
        popoverRef={popoverRef}
        popoverProps={popoverProps}
      >
        {isLoading && items.length === 0 ? (
          <HoverIconModalLoading />
        ) : error ? (
          <HoverIconModalEmpty icon="error" message={error} />
        ) : items.length === 0 ? (
          <HoverIconModalEmpty message="No clipboard history" />
        ) : (
          <HoverIconModalList listRef={listRef}>
            {displayItems.map((entry, index) => (
              <HoverIconModalRow
                key={entry.id}
                onClick={() => handleItemClick(entry)}
                onMouseEnter={() => handleItemHover(index)}
                isSelected={index === selectedIndex}
              >
                <HoverIconModalContent
                  primary={entry.preview}
                  secondary={formatDate(entry.last_used_at)}
                />
              </HoverIconModalRow>
            ))}
          </HoverIconModalList>
        )}
      </HoverIconModalContainer>
    </>
  );
}

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
