/**
 * @module HoverIconModal
 * @role Universal hover-triggered icon modal component
 * 
 * All hover icon modals use this component for consistent behavior.
 * Only the content rendering differs between instances.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import './HoverIconModal.css';

// Timing constants (ms)
const HOVER_DELAY = 200;
const LOCK_GRACE = 500;

// Shared state across all instances
let activeInstance: string | null = null;
const listeners = new Set<(id: string | null) => void>();

function notifyInstanceChange(id: string | null) {
  activeInstance = id;
  listeners.forEach(fn => fn(id));
}

function subscribeToInstanceChanges(fn: (id: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type ModalState = 'CLOSED' | 'PREVIEW' | 'LOCKED';

type TriggerMode = 'hover' | 'click';

interface UseHoverIconModalOptions {
  onOpen?: () => void;
  onClose?: () => void;
  id?: string;
  /** 'hover' = hover to preview, click to lock (default). 'click' = click to open only. */
  triggerMode?: TriggerMode;
  /** If true, modal stays open when mouse leaves (until Escape/Enter/click outside). Default false. */
  stayOpenOnLeave?: boolean;
}

interface UseHoverIconModalReturn {
  state: ModalState;
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  triggerProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onClick: () => void;
  };
  popoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function useHoverIconModal(options: UseHoverIconModalOptions = {}): UseHoverIconModalReturn {
  const [state, setState] = useState<ModalState>('CLOSED');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInTrigger = useRef(false);
  const isInPopover = useRef(false);
  const instanceId = useRef(options.id || Math.random().toString(36).slice(2, 9));
  const triggerMode = options.triggerMode ?? 'hover';
  const stayOpenOnLeave = options.stayOpenOnLeave ?? false;

  const clearTimers = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const open = useCallback(() => {
    if (activeInstance && activeInstance !== instanceId.current) {
      notifyInstanceChange(null);
    }
    clearTimers();
    setState('LOCKED');
    notifyInstanceChange(instanceId.current);
    options.onOpen?.();
  }, [clearTimers, options]);

  const close = useCallback(() => {
    clearTimers();
    isInTrigger.current = false;
    isInPopover.current = false;
    setState('CLOSED');
    if (activeInstance === instanceId.current) {
      notifyInstanceChange(null);
    }
    options.onClose?.();
  }, [clearTimers, options]);

  const toggle = useCallback(() => {
    if (state === 'CLOSED') {
      open();
    } else {
      close();
    }
  }, [state, open, close]);

  // Document click to close
  useEffect(() => {
    if (state === 'CLOSED') return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = triggerRef.current?.contains(target) ?? false;
      const inPopover = popoverRef.current?.contains(target) ?? false;

      if (!inTrigger && !inPopover) {
        close();
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [state, close]);

  // Listen for other instances
  useEffect(() => {
    const unsubscribe = subscribeToInstanceChanges((activeId) => {
      if (activeId && activeId !== instanceId.current && state !== 'CLOSED') {
        clearTimers();
        setState('CLOSED');
        options.onClose?.();
      }
    });
    return unsubscribe;
  }, [state, clearTimers, options]);

  // Escape to close
  useEffect(() => {
    if (state === 'CLOSED') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, close]);

  const handleTriggerEnter = useCallback(() => {
    isInTrigger.current = true;

    // Always close other modals on hover (cross-instance coordination)
    if (activeInstance && activeInstance !== instanceId.current) {
      notifyInstanceChange(null);
    }

    // Only preview on hover if in hover mode
    if (triggerMode === 'hover' && state === 'CLOSED') {
      clearTimers();
      hoverTimer.current = setTimeout(() => {
        setState('PREVIEW');
        notifyInstanceChange(instanceId.current);
        options.onOpen?.();
      }, HOVER_DELAY);
    }
  }, [state, clearTimers, options, triggerMode]);

  const handleTriggerLeave = useCallback(() => {
    isInTrigger.current = false;

    // Only auto-close on leave if in hover mode and previewing
    if (triggerMode === 'hover' && state === 'PREVIEW') {
      clearTimers();
      hoverTimer.current = setTimeout(() => {
        if (!isInTrigger.current && !isInPopover.current) {
          setState('CLOSED');
          if (activeInstance === instanceId.current) {
            notifyInstanceChange(null);
          }
          options.onClose?.();
        }
      }, HOVER_DELAY);
    }
  }, [state, clearTimers, options, triggerMode]);

  const handlePopoverEnter = useCallback(() => {
    isInPopover.current = true;
    clearTimers();
  }, [clearTimers]);

  const handlePopoverLeave = useCallback(() => {
    isInPopover.current = false;

    if (state === 'LOCKED') {
      // If stayOpenOnLeave is true, don't auto-close on mouse leave
      if (stayOpenOnLeave) {
        clearTimers();
        return;
      }
      clearTimers();
      leaveTimer.current = setTimeout(() => {
        if (!isInTrigger.current && !isInPopover.current) {
          setState('CLOSED');
          if (activeInstance === instanceId.current) {
            notifyInstanceChange(null);
          }
          options.onClose?.();
        }
      }, LOCK_GRACE);
    } else if (state === 'PREVIEW') {
      clearTimers();
      setState('CLOSED');
      if (activeInstance === instanceId.current) {
        notifyInstanceChange(null);
      }
      options.onClose?.();
    }
  }, [state, clearTimers, options, stayOpenOnLeave]);

  return {
    state,
    isOpen: state === 'PREVIEW' || state === 'LOCKED',
    triggerRef,
    popoverRef,
    triggerProps: {
      onMouseEnter: handleTriggerEnter,
      onMouseLeave: handleTriggerLeave,
      onClick: toggle,
    },
    popoverProps: {
      onMouseEnter: handlePopoverEnter,
      onMouseLeave: handlePopoverLeave,
    },
    open,
    close,
    toggle,
  };
}

// Trigger button component
interface HoverIconTriggerProps {
  icon: string;
  title: string;
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  triggerProps: {
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onClick: () => void;
  };
}

export function HoverIconTrigger({ icon, title, isOpen, triggerRef, triggerProps }: HoverIconTriggerProps) {
  return (
    <button
      ref={triggerRef}
      className={`hover-icon-trigger ${isOpen ? 'open' : ''}`}
      title={title}
      aria-label={title}
      aria-expanded={isOpen}
      {...triggerProps}
    >
      <span className="material-symbols-outlined">{icon}</span>
    </button>
  );
}

// Modal container component
interface HoverIconModalContainerProps {
  children: React.ReactNode;
  isOpen: boolean;
  state: ModalState;
  position: { left: number; bottom: number };
  popoverRef: React.RefObject<HTMLDivElement | null>;
  popoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  className?: string;
}

export function HoverIconModalContainer({
  children,
  isOpen,
  state,
  position,
  popoverRef,
  popoverProps,
  className = '',
}: HoverIconModalContainerProps) {
  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className={`hover-icon-modal ${isOpen ? 'open' : ''} ${state === 'LOCKED' ? 'locked' : ''} ${className}`}
      style={{
        position: 'fixed',
        left: position.left,
        bottom: position.bottom,
      }}
      {...popoverProps}
    >
      {children}
    </div>
  );
}

// Modal header component
interface HoverIconModalHeaderProps {
  title: string;
  action?: {
    icon: string;
    title: string;
    onClick: () => void;
  };
}

export function HoverIconModalHeader({ title, action }: HoverIconModalHeaderProps) {
  return (
    <div className="hover-icon-modal-header">
      <span className="hover-icon-modal-title">{title}</span>
      {action && (
        <button
          className="hover-icon-modal-action"
          onClick={action.onClick}
          title={action.title}
        >
          <span className="material-symbols-outlined">{action.icon}</span>
        </button>
      )}
    </div>
  );
}

// Modal row component
interface HoverIconModalRowProps {
  children: React.ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isSelected?: boolean;
}

export function HoverIconModalRow({
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  isSelected,
}: HoverIconModalRowProps) {
  return (
    <div
      className={`hover-icon-modal-row ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}

// Modal list container
interface HoverIconModalListProps {
  children: React.ReactNode;
  listRef?: React.RefObject<HTMLDivElement | null>;
}

export function HoverIconModalList({ children, listRef }: HoverIconModalListProps) {
  return <div ref={listRef} className="hover-icon-modal-list">{children}</div>;
}

// Thumbnail component
interface HoverIconModalThumbProps {
  src: string;
  alt: string;
}

export function HoverIconModalThumb({ src, alt }: HoverIconModalThumbProps) {
  return (
    <div className="hover-icon-modal-thumb">
      <img src={src} alt={alt} loading="lazy" />
    </div>
  );
}

// Content area
interface HoverIconModalContentProps {
  primary: string;
  secondary?: string;
}

export function HoverIconModalContent({ primary, secondary }: HoverIconModalContentProps) {
  return (
    <div className="hover-icon-modal-content">
      <div className="hover-icon-modal-content-primary">{primary}</div>
      {secondary && (
        <div className="hover-icon-modal-content-secondary">{secondary}</div>
      )}
    </div>
  );
}

// Loading state
export function HoverIconModalLoading({ message = 'Loading...' }: { message?: string }) {
  return <div className="hover-icon-modal-loading">{message}</div>;
}

// Empty state
interface HoverIconModalEmptyProps {
  icon?: string;
  message: string;
  hint?: string;
}

export function HoverIconModalEmpty({ icon = 'inbox', message, hint }: HoverIconModalEmptyProps) {
  return (
    <div className="hover-icon-modal-empty">
      <span className="material-symbols-outlined">{icon}</span>
      <div>{message}</div>
      {hint && <div>{hint}</div>}
    </div>
  );
}

// Keyboard hint
export function HoverIconModalHint({ message }: { message: string }) {
  return (
    <div className="hover-icon-modal-hint">
      <span className="material-symbols-outlined">keyboard</span>
      <span>{message}</span>
    </div>
  );
}

// Preview popover
interface HoverIconModalPreviewProps {
  src: string;
  label: string;
  position: { left: number; top: number };
}

export function HoverIconModalPreview({ src, label, position }: HoverIconModalPreviewProps) {
  return (
    <div
      className="hover-icon-modal-preview"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
      }}
    >
      <img src={src} alt={label} />
      <div className="hover-icon-modal-preview-label">{label}</div>
    </div>
  );
}

// Re-export type
export type { ModalState };
