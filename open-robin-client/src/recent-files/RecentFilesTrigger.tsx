/**
 * @module RecentFilesTrigger
 * @role Icon button showing recently edited files
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { usePanelStore } from '../state/panelStore';
import {
  useHoverIconModal,
  useListNavigation,
  HoverIconTrigger,
  HoverIconModalContainer,
  HoverIconModalList,
  HoverIconModalContent,
  HoverIconModalLoading,
  HoverIconModalEmpty,
} from '../components/hover-icon-modal';

interface RecentFile {
  name: string;
  path: string;
  mtime: number;
  size: number;
}

interface RecentFilesTriggerProps {
  onInsert?: (text: string) => void;
}

export function RecentFilesTrigger({ onInsert }: RecentFilesTriggerProps) {
  const [files, setFiles] = useState<RecentFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ws = usePanelStore((state) => state.ws);
  const panel = usePanelStore((state) => state.currentPanel);

  const loadRecentFiles = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    setLoading(true);

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'recent_files_response' && msg.panel === panel) {
          ws.removeEventListener('message', handleMessage);
          if (msg.success) {
            setFiles(msg.files || []);
          }
          setLoading(false);
        }
      } catch {
        // Ignore
      }
    };

    ws.addEventListener('message', handleMessage);
    ws.send(JSON.stringify({
      type: 'recent_files_request',
      panel,
      limit: 30,
    }));

    // Timeout after 5 seconds
    setTimeout(() => {
      ws.removeEventListener('message', handleMessage);
      setLoading(false);
    }, 5000);
  }, [ws, panel]);

  const handleOpen = useCallback(() => {
    if (files.length === 0) {
      loadRecentFiles();
    }
  }, [files.length, loadRecentFiles]);

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
    id: 'recent-files',
  });

  const {
    selectedIndex,
    handleItemClick,
    handleItemHover,
  } = useListNavigation<RecentFile>({
    items: files,
    isOpen,
    onSelect: (file) => onInsert?.(file.path),
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

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const formatTime = (mtime: number): string => {
    const date = new Date(mtime);
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
  };

  return (
    <>
      <HoverIconTrigger
        icon="save_clock"
        title="Recent files (click to open)"
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
        {loading && files.length === 0 ? (
          <HoverIconModalLoading />
        ) : files.length === 0 ? (
          <HoverIconModalEmpty message="No recent files" />
        ) : (
          <HoverIconModalList listRef={listRef}>
            {files.map((file, index) => (
              <div
                key={file.path}
                className={`rv-hover-icon-modal-row ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleItemClick(file)}
                onMouseEnter={() => handleItemHover(index)}
              >
                <HoverIconModalContent
                  primary={file.name}
                  secondary={`${formatSize(file.size)} • ${formatTime(file.mtime)}`}
                />
              </div>
            ))}
          </HoverIconModalList>
        )}
      </HoverIconModalContainer>
    </>
  );
}
