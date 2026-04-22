import { useEffect, useRef } from 'react';
import { usePanelStore, clampPaneWidth } from '../state/panelStore';
import type { Pane } from '../types';

/**
 * Resize handles — split into three concern-specific components.
 *
 * All three share a common drag primitive (`useResizeDrag`) that captures
 * pointer events, coalesces via requestAnimationFrame, and writes through
 * panelStore.setPaneWidth. Each wrapper supplies its own:
 *   - `pane`: which width slot in viewStates[panel].widths it writes to.
 *   - `edge`: which edge the handle sits on (determines the sign of the
 *     drag delta — RIGHT-edge handles grow with +delta, LEFT-edge handles
 *     grow with -delta).
 *   - `defaultWidth`: initial width if nothing is stored for this pane.
 *
 * Keeping these as three separate components means there's no
 * cross-contamination between primary-chat, sidebar, and secondary-chat
 * resize logic — each one is independently testable.
 */

type Edge = 'right' | 'left';

interface ResizeDragConfig {
  panel: string;
  pane: Pane;
  edge: Edge;
  defaultWidth: number;
}

interface DragState {
  startX: number;
  startWidth: number;
  pointerId: number;
  pendingWidth: number | null;
  rafId: number | null;
}

function useResizeDrag({ panel, pane, edge, defaultWidth }: ResizeDragConfig) {
  const setPaneWidth = usePanelStore((s) => s.setPaneWidth);
  const commitPaneWidths = usePanelStore((s) => s.commitPaneWidths);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    return () => {
      const d = dragRef.current;
      if (d?.rafId != null) cancelAnimationFrame(d.rafId);
      if (d != null) document.body.style.userSelect = '';
      dragRef.current = null;
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const vs = usePanelStore.getState().viewStates[panel];
    const startWidth = vs?.widths?.[pane] ?? defaultWidth;

    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startWidth,
      pointerId: e.pointerId,
      pendingWidth: null,
      rafId: null,
    };

    document.body.style.userSelect = 'none';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;

    const delta = e.clientX - d.startX;
    // Right-edge handles (sidebar, primary chat): +delta grows the pane.
    // Left-edge handles (secondary chat, file tree): -delta grows the pane
    // (the left edge moves outward as the pointer moves leftward).
    const signedDelta = edge === 'right' ? delta : -delta;
    d.pendingWidth = clampPaneWidth(pane, d.startWidth + signedDelta);

    if (d.rafId != null) return;
    d.rafId = requestAnimationFrame(() => {
      const curr = dragRef.current;
      if (!curr) return;
      curr.rafId = null;
      if (curr.pendingWidth != null) {
        setPaneWidth(panel, pane, curr.pendingWidth);
        curr.pendingWidth = null;
      }
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;

    if (d.rafId != null) {
      cancelAnimationFrame(d.rafId);
      d.rafId = null;
    }
    if (d.pendingWidth != null) {
      setPaneWidth(panel, pane, d.pendingWidth);
      d.pendingWidth = null;
    }

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    dragRef.current = null;
    document.body.style.userSelect = '';
    commitPaneWidths(panel);
  };

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    'data-pane': pane as string,
    className: 'rv-resize-handle',
  };
}

// --- Concern-specific wrappers ---

/** Threads sidebar (left column). Right-edge handle: drag right grows. */
export function LeftSidebarResize({ panel }: { panel: string }) {
  const props = useResizeDrag({ panel, pane: 'leftSidebar', edge: 'right', defaultWidth: 220 });
  return <div {...props} />;
}

/** Primary chat column. Right-edge handle: drag right grows. */
export function LeftChatResize({ panel }: { panel: string }) {
  const props = useResizeDrag({ panel, pane: 'leftChat', edge: 'right', defaultWidth: 320 });
  return <div {...props} />;
}

/** Sticky secondary chat column. Left-edge handle: drag left grows.
 *  Writes to widths.rightSecondary (chat-only slot). */
export function RightSecondaryResize({ panel }: { panel: string }) {
  const props = useResizeDrag({ panel, pane: 'rightSecondary', edge: 'left', defaultWidth: 300 });
  return <div {...props} />;
}

/** View's right column (e.g. code-viewer file tree). Left-edge handle.
 *  Writes to widths.rightCol, independent of the sticky chat's width so the
 *  file tree returns to its own size when the chat undocks. */
export function RightColResize({ panel }: { panel: string }) {
  const props = useResizeDrag({ panel, pane: 'rightCol', edge: 'left', defaultWidth: 220 });
  return <div {...props} />;
}

// --- Legacy compatibility shim ---
// Old callers passed <ResizeHandle panel={...} pane="..." />. Route to the
// correct wrapper so we can remove this once all call sites are migrated.
interface LegacyProps {
  panel: string;
  pane: Pane;
}

export function ResizeHandle({ panel, pane }: LegacyProps) {
  if (pane === 'leftSidebar') return <LeftSidebarResize panel={panel} />;
  if (pane === 'leftChat') return <LeftChatResize panel={panel} />;
  return <RightSecondaryResize panel={panel} />;
}
