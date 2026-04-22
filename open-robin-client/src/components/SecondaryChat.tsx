/**
 * @module SecondaryChat
 * @role Singleton secondary chat popup (SECONDARY_CHAT_SPEC).
 *
 * Replaces SPEC-26d's view-scoped floating popup. Three display modes
 * (floating / minimized / sticky-right) cycled via traffic-light controls
 * in SecondaryHeader. When minimized, SecondaryDockButton renders instead.
 *
 * PER_THREAD_CHAT_STATE: each ChatArea reads a specific threadId via
 * threadIdOverride, so the secondary displays its own thread while the
 * primary stays on currentThreadIds.project.
 *
 * Minimize/restore animations: both floating and sticky play a genie-style
 * shrink to the dock button (MINIMIZE_ANIMATION_MS). Restore plays the same
 * keyframe in reverse, triggered by secondary.justRestored set by the store.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { usePanelStore } from '../state/panelStore';
import { ChatArea } from './ChatArea';
import { SecondaryHeader } from './SecondaryHeader';
import { RightSecondaryResize } from './ResizeHandle';

const MIN_W = 300;
const MIN_H = 300;
const MAX_W = 800;
const MAX_H = 700;
const DEFAULT_PADDING = 24;

// 550ms genie shape + 100ms fade crossfade = 650ms total.
const MINIMIZE_ANIMATION_MS = 650;
const DOCK_OFFSET = 24;
const DOCK_SIZE = 48;

/**
 * Shared genie-animation orchestration for both floating and sticky popups.
 * Returns the className/style additions to apply to the popup's root, plus
 * a handleMinimize callback to pass down to SecondaryHeader.
 *
 * - Minimize: on user click, set local isMinimizing → CSS class triggers
 *   the forward keyframe → after MINIMIZE_ANIMATION_MS, dispatch
 *   minimizeSecondary() to the store.
 * - Restore: on mount, if secondary.justRestored is true, play the reverse
 *   keyframe → clear justRestored after the animation.
 *
 * The translate delta (dock center − popup bottom-right) is recomputed
 * from the supplied element ref whenever an animation begins, so it works
 * in both floating (user-positioned) and sticky (right-anchored) modes.
 */
function useGenieAnimation(rootRef: React.RefObject<HTMLElement | null>) {
  const minimizeSecondary = usePanelStore((s) => s.minimizeSecondary);
  const clearJustRestored = usePanelStore((s) => s.clearJustRestored);
  const justRestored = usePanelStore((s) => s.secondary?.justRestored ?? false);

  const [isMinimizing, setIsMinimizing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [deltas, setDeltas] = useState<{ dx: number; dy: number; sx: number; sy: number } | null>(null);
  const timerRef = useRef<number | null>(null);

  // Cleanup any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  // Compute the translate delta + per-axis scale so the final keyframe lands
  // the popup as a 48×48 disk with its bottom-right pinned to the dock
  // button's bottom-right corner (same spot as the actual dock button, so
  // the crossfade aligns pixel-for-pixel).
  const computeDeltas = useCallback(() => {
    const el = rootRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const dockBRx = window.innerWidth - DOCK_OFFSET;
    const dockBRy = window.innerHeight - DOCK_OFFSET;
    return {
      dx: dockBRx - rect.right,
      dy: dockBRy - rect.bottom,
      sx: DOCK_SIZE / rect.width,
      sy: DOCK_SIZE / rect.height,
    };
  }, [rootRef]);

  const handleMinimize = useCallback(() => {
    if (isMinimizing || isRestoring) return;
    const d = computeDeltas();
    if (d) setDeltas(d);
    setIsMinimizing(true);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      minimizeSecondary();
      setIsMinimizing(false);
      setDeltas(null);
      timerRef.current = null;
    }, MINIMIZE_ANIMATION_MS);
  }, [isMinimizing, isRestoring, computeDeltas, minimizeSecondary]);

  // Restore: use useLayoutEffect so deltas + class are committed in the
  // SAME paint cycle as the popup's initial mount. Using useEffect or rAF
  // would let the browser paint one frame of the popup at full size before
  // the reverse animation takes hold — a visible flicker.
  useLayoutEffect(() => {
    if (!justRestored || isRestoring) return;
    const d = computeDeltas();
    if (d) setDeltas(d);
    setIsRestoring(true);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      clearJustRestored();
      setIsRestoring(false);
      setDeltas(null);
      timerRef.current = null;
    }, MINIMIZE_ANIMATION_MS);
  }, [justRestored, isRestoring, computeDeltas, clearJustRestored]);

  const animating = isMinimizing || isRestoring;
  const modifier = isMinimizing ? '--minimizing' : isRestoring ? '--restoring' : '';
  const styleVars: CSSProperties & Record<string, string | number> = {};
  if (animating && deltas) {
    styleVars['--minimize-dx'] = `${deltas.dx}px`;
    styleVars['--minimize-dy'] = `${deltas.dy}px`;
    styleVars['--minimize-scale-x'] = String(deltas.sx);
    styleVars['--minimize-scale-y'] = String(deltas.sy);
  }

  return { handleMinimize, modifier, styleVars, animating };
}

export function SecondaryChat() {
  const secondary = usePanelStore((s) => s.secondary);
  const currentPanel = usePanelStore((s) => s.currentPanel);
  const setSecondaryFloat = usePanelStore((s) => s.setSecondaryFloat);

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const { handleMinimize, modifier, styleVars } = useGenieAnimation(popupRef);

  // Resolve -1 sentinels to lower-right default (§7a).
  const popupWidth = secondary?.float.width ?? 380;
  const popupHeight = secondary?.float.height ?? 520;
  let posX = secondary?.float.x ?? -1;
  let posY = secondary?.float.y ?? -1;
  if (posX < 0 || posY < 0) {
    posX = window.innerWidth - popupWidth - DEFAULT_PADDING;
    posY = window.innerHeight - popupHeight - DEFAULT_PADDING;
  }

  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    // Drag starts only from the dedicated grab zone inside the header.
    if (!(e.target as HTMLElement).closest('.rv-secondary-drag-zone')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: posX, origY: posY };

    const handleMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setSecondaryFloat(
        d.origX + (ev.clientX - d.startX),
        d.origY + (ev.clientY - d.startY),
        popupWidth,
        popupHeight,
      );
    };
    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [posX, posY, popupWidth, popupHeight, setSecondaryFloat]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: popupWidth, origH: popupHeight };
    document.body.style.userSelect = 'none';

    const handleMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const newW = Math.max(MIN_W, Math.min(MAX_W, r.origW + (ev.clientX - r.startX)));
      const newH = Math.max(MIN_H, Math.min(MAX_H, r.origH + (ev.clientY - r.startY)));
      setSecondaryFloat(posX, posY, newW, newH);
    };
    const handleUp = () => {
      resizeRef.current = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [posX, posY, popupWidth, popupHeight, setSecondaryFloat]);

  if (!secondary) return null;
  if (secondary.mode === 'minimized') return null;

  if (secondary.mode === 'sticky-right') {
    // Sticky-right renders as a grid child inside the panel's layout,
    // injected by PanelContent (see App.tsx). This branch renders nothing
    // at the app shell level.
    return null;
  }

  const popupStyle: CSSProperties & Record<string, string | number> = {
    left: `${posX}px`,
    top: `${posY}px`,
    width: `${popupWidth}px`,
    height: `${popupHeight}px`,
    ...styleVars,
  };

  return (
    <div
      ref={popupRef}
      className={`rv-secondary-popup${modifier ? ` rv-secondary-popup${modifier}` : ''}`}
      style={popupStyle}
      onMouseDown={handleDragMouseDown}
    >
      <SecondaryHeader onMinimize={handleMinimize} />
      <div className="rv-secondary-body">
        <ChatArea panel={currentPanel} scope="project" threadIdOverride={secondary.threadId} />
      </div>
      <div
        className="rv-secondary-resize-handle"
        onMouseDown={handleResizeMouseDown}
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * Variant rendered inside the panel grid when mode === 'sticky-right'.
 * Same genie animation on minimize / restore — shrinks to the dock and
 * grows back from it.
 */
export function SecondaryChatSticky() {
  const currentPanel = usePanelStore((s) => s.currentPanel);
  const secondary = usePanelStore((s) => s.secondary);
  const asideRef = useRef<HTMLElement | null>(null);
  const { handleMinimize, modifier, styleVars } = useGenieAnimation(asideRef);

  if (!secondary) return null;

  return (
    <aside
      ref={asideRef}
      className={`rv-secondary-sticky${modifier ? ` rv-secondary-sticky${modifier}` : ''}`}
      style={styleVars}
    >
      {/* Resize handle on the left edge — shares pane='rightSecondary' with
       * the file tree's handle, so both move the same width variable. */}
      <RightSecondaryResize panel={currentPanel} />
      <SecondaryHeader onMinimize={handleMinimize} />
      <div className="rv-secondary-body">
        <ChatArea panel={currentPanel} scope="project" threadIdOverride={secondary.threadId} />
      </div>
    </aside>
  );
}
