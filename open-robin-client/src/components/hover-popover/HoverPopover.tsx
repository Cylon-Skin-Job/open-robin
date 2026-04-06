/**
 * @module HoverPopover
 * @role Generic hover-triggered popover with PREVIEW/LOCKED state machine
 *
 * Extracts the interaction pattern from clipboard for reuse.
 * States: CLOSED → PREVIEW → LOCKED → CLOSED
 * 
 * SHARED STATE: All instances coordinate so only one popover is open at a time.
 */

import { useRef, useEffect, useState, useCallback } from 'react';

// Timing constants (ms)
const HOVER_DELAY = 200;
const LOCK_GRACE = 500;

// Shared state across all hook instances
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

type PopoverState = 'CLOSED' | 'PREVIEW' | 'LOCKED';

interface UseHoverPopoverOptions {
  onOpen?: () => void;
  onClose?: () => void;
  id?: string; // Optional identifier for debugging
}

interface UseHoverPopoverReturn {
  state: PopoverState;
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

export function useHoverPopover(options: UseHoverPopoverOptions = {}): UseHoverPopoverReturn {
  const [state, setState] = useState<PopoverState>('CLOSED');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInTrigger = useRef(false);
  const isInPopover = useRef(false);
  
  // Unique ID for this instance
  const instanceId = useRef(options.id || Math.random().toString(36).slice(2, 9));

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
    // Close any other active instance first
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
    setState('CLOSED');
    // Clear active instance if we're the one closing
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

  // Listen for other instances opening/closing
  useEffect(() => {
    const unsubscribe = subscribeToInstanceChanges((activeId) => {
      // If another instance opened and we're open, close ourselves
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

    // Close any other active instance immediately
    if (activeInstance && activeInstance !== instanceId.current) {
      notifyInstanceChange(null);
    }

    if (state === 'CLOSED') {
      clearTimers();
      hoverTimer.current = setTimeout(() => {
        setState('PREVIEW');
        notifyInstanceChange(instanceId.current);
        options.onOpen?.();
      }, HOVER_DELAY);
    }
  }, [state, clearTimers, options]);

  const handleTriggerLeave = useCallback(() => {
    isInTrigger.current = false;

    // In PREVIEW state, give a small delay to allow moving into the popover
    if (state === 'PREVIEW') {
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
  }, [state, clearTimers, options]);

  const handlePopoverEnter = useCallback(() => {
    isInPopover.current = true;
    clearTimers();
  }, [clearTimers]);

  const handlePopoverLeave = useCallback(() => {
    isInPopover.current = false;

    if (state === 'LOCKED') {
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
  }, [state, clearTimers, options]);

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
