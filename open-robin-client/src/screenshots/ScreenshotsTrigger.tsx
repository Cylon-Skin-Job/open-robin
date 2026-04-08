/**
 * @module ScreenshotsTrigger
 * @role Icon button showing screenshots from capture-viewer/content/screenshots
 */

import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { usePanelStore } from '../state/panelStore';
import {
  useHoverIconModal,
  useListNavigation,
  HoverIconTrigger,
  HoverIconModalContainer,
  HoverIconModalList,
  HoverIconModalThumb,
  HoverIconModalContent,
  HoverIconModalLoading,
  HoverIconModalEmpty,
  HoverIconModalPreview,
} from '../components/hover-icon-modal';
import type { FileTreeNode } from '../types/file-explorer';

interface ScreenshotItem {
  name: string;
  path: string;
  url: string;
  timestamp: number;
  displayName: string;
}

const SCREENSHOTS_PATH = 'screenshots';
const PANEL = 'capture-viewer';

interface ScreenshotsTriggerProps {
  onInsert?: (text: string) => void;
}

export function ScreenshotsTrigger({ onInsert }: ScreenshotsTriggerProps) {
  const [screenshots, setScreenshots] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [hoveredItem, setHoveredItem] = useState<ScreenshotItem | null>(null);
  const [previewPos, setPreviewPos] = useState<{ left: number; top: number } | null>(null);
  const ws = usePanelStore((state) => state.ws);

  const loadScreenshots = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    setLoading(true);

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'file_tree_response' && msg.panel === PANEL && msg.path === SCREENSHOTS_PATH) {
          ws.removeEventListener('message', handleMessage);
          if (msg.success) {
            const images = msg.nodes.filter((n: FileTreeNode) =>
              n.type === 'file' && /\.(png|jpg|jpeg|gif|webp)$/i.test(n.name)
            );
            setScreenshots(images);
          }
          setLoading(false);
        }
      } catch {
        // Ignore
      }
    };

    ws.addEventListener('message', handleMessage);
    ws.send(JSON.stringify({
      type: 'file_tree_request',
      panel: PANEL,
      path: SCREENSHOTS_PATH,
    }));

    setTimeout(() => {
      ws.removeEventListener('message', handleMessage);
      setLoading(false);
    }, 5000);
  }, [ws]);

  const handleOpen = useCallback(() => {
    if (screenshots.length === 0) {
      loadScreenshots();
    }
  }, [screenshots.length, loadScreenshots]);

  const getImageUrl = (filename: string) => {
    return `/api/panel-file/capture-viewer/content/screenshots/${encodeURIComponent(filename)}`;
  };

  const parseScreenshotName = (filename: string): { displayName: string; timestamp: number } => {
    const baseName = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
    const match = baseName.match(/^Screenshot (\d{4})-(\d{2})-(\d{2}) at (\d{1,2})\.(\d{2})\.(\d{2}) (AM|PM)$/i);
    
    if (match) {
      const [, year, month, day, hour, minute, second, meridian] = match;
      let hours = parseInt(hour, 10);
      if (meridian.toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (meridian.toUpperCase() === 'AM' && hours === 12) hours = 0;
      
      const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hours, parseInt(minute, 10), parseInt(second, 10));
      
      return {
        displayName: baseName,
        timestamp: date.getTime()
      };
    }
    
    return {
      displayName: baseName,
      timestamp: 0
    };
  };

  const screenshotItems: ScreenshotItem[] = useMemo(() => {
    const items = screenshots.map((s) => {
      const parsed = parseScreenshotName(s.name);
      return {
        name: s.name,
        path: s.path,
        url: getImageUrl(s.name),
        timestamp: parsed.timestamp,
        displayName: parsed.displayName
      };
    });
    // Sort: oldest first, newest last (so we can show oldest at top, newest at bottom)
    items.sort((a, b) => a.timestamp - b.timestamp);
    return items;
  }, [screenshots]);

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
    id: 'screenshots',
  });

  // Take 20 most recent (last 20 since sorted oldest-first)
  const visibleItems = useMemo(() => screenshotItems.slice(-20), [screenshotItems]);

  const {
    selectedIndex,
    handleItemClick,
    handleItemHover,
  } = useListNavigation<ScreenshotItem>({
    items: visibleItems,
    isOpen,
    onSelect: (item) => onInsert?.(item.url),
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

  const handleMouseEnter = useCallback((item: ScreenshotItem, index: number, e: React.MouseEvent) => {
    handleItemHover(index);
    setHoveredItem(item);
    const rect = e.currentTarget.getBoundingClientRect();
    setPreviewPos({
      left: rect.right + 12,
      top: rect.top
    });
  }, [handleItemHover]);

  return (
    <>
      <HoverIconTrigger
        icon="photo_size_select_large"
        title="Screenshots gallery (click to lock)"
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
        {loading && screenshots.length === 0 ? (
          <HoverIconModalLoading />
        ) : screenshots.length === 0 ? (
          <HoverIconModalEmpty
            icon="image_not_supported"
            message="No screenshots found"
            hint="ai/views/capture-viewer/content/screenshots/"
          />
        ) : (
          <>
            <HoverIconModalList listRef={listRef}>
              {visibleItems.map((item, index) => (
                <div
                  key={item.path}
                  className={`rv-hover-icon-modal-row ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleItemClick(item)}
                  onMouseEnter={(e) => handleMouseEnter(item, index, e)}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  <HoverIconModalThumb src={item.url} alt={item.displayName} />
                  <HoverIconModalContent primary={item.displayName} />
                </div>
              ))}
            </HoverIconModalList>

            {hoveredItem && previewPos && (
              <HoverIconModalPreview
                src={hoveredItem.url}
                label={hoveredItem.displayName}
                position={previewPos}
              />
            )}
          </>
        )}
      </HoverIconModalContainer>
    </>
  );
}
