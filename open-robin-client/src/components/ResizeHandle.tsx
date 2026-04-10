import { useRef } from 'react';
import { usePanelStore } from '../state/panelStore';
import type { Pane } from '../types';

interface ResizeHandleProps {
  panel: string;
  pane: Pane;
}

const MIN_WIDTH = 120;
const MAX_WIDTH = 600;

export function ResizeHandle({ panel, pane }: ResizeHandleProps) {
  const setPaneWidth = usePanelStore((s) => s.setPaneWidth);
  const commitPaneWidths = usePanelStore((s) => s.commitPaneWidths);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const vs = usePanelStore.getState().viewStates[panel];
    const startWidth = vs?.widths?.[pane] ?? (pane === 'leftSidebar' ? 220 : 320);

    dragRef.current = {
      startX: e.clientX,
      startWidth,
    };

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const raw = dragRef.current.startWidth + delta;
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
      setPaneWidth(panel, pane, clamped);
    };

    const handleUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      commitPaneWidths(panel);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  return (
    <div
      className="rv-resize-handle"
      data-pane={pane}
      onMouseDown={handleMouseDown}
    />
  );
}
