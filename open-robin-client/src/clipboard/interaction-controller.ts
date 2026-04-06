/**
 * @module clipboard/interaction-controller
 * @role Vanilla TypeScript state machine for clipboard bubble hover/lock/leave
 *
 * Timing constants:
 * - HOVER_DELAY: 200ms (time before bubble opens on hover)
 * - LOCK_GRACE: 500ms (time before leaving locked bubble actually closes)
 * - LEAVE_DELAY: 500ms (time before dismissed bubble reopens on hover)
 *
 * States: CLOSED → PREVIEW → LOCKED → LEAVING → CLOSED
 */

import type { BubbleState } from './types';
import { useClipboardStore } from './clipboard-store';
import { copyFromHistory, listPage } from './clipboard-api';

// Timing constants (ms)
const HOVER_DELAY = 200;
const LOCK_GRACE = 500;

type StateListener = (state: BubbleState) => void;

class InteractionController {
  private triggerEl: HTMLElement | null = null;
  private popoverEl: HTMLElement | null = null;
  private state: BubbleState = 'CLOSED';
  private listeners: Set<StateListener> = new Set();
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private isInTrigger = false;
  private isInPopover = false;
  private ignoreNextDocumentClick = false;
  
  // Debug mode - set to true to enable console logging
  private debug = false;
  
  private log(...args: any[]) {
    if (this.debug) {
      console.log('[Clipboard Controller]', ...args);
    }
  }

  attach(triggerEl: HTMLElement, popoverEl: HTMLElement) {
    this.detach();
    this.triggerEl = triggerEl;
    this.popoverEl = popoverEl;

    // Trigger events
    triggerEl.addEventListener('mouseenter', this.onTriggerEnter);
    triggerEl.addEventListener('mouseleave', this.onTriggerLeave);
    triggerEl.addEventListener('click', this.onTriggerClick);

    // Popover events
    popoverEl.addEventListener('mouseenter', this.onPopoverEnter);
    popoverEl.addEventListener('mouseleave', this.onPopoverLeave);

    // Global keyboard
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('click', this.onDocumentClick);

    // Load initial data
    this.loadItems();
  }

  detach() {
    this.clearTimers();

    if (this.triggerEl) {
      this.triggerEl.removeEventListener('mouseenter', this.onTriggerEnter);
      this.triggerEl.removeEventListener('mouseleave', this.onTriggerLeave);
      this.triggerEl.removeEventListener('click', this.onTriggerClick);
    }

    if (this.popoverEl) {
      this.popoverEl.removeEventListener('mouseenter', this.onPopoverEnter);
      this.popoverEl.removeEventListener('mouseleave', this.onPopoverLeave);
    }

    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('click', this.onDocumentClick);

    this.triggerEl = null;
    this.popoverEl = null;
    this.state = 'CLOSED';
    this.isInTrigger = false;
    this.isInPopover = false;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    // Immediately notify of current state
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(state: BubbleState) {
    this.log('STATE TRANSITION:', this.state, '→', state);
    this.state = state;
    useClipboardStore.getState().setBubbleState(state);
    for (const fn of this.listeners) {
      fn(state);
    }
  }

  private clearTimers() {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  private async loadItems() {
    try {
      useClipboardStore.getState().setLoading(true);
      const { items, total } = await listPage(0, 30);
      useClipboardStore.getState().setItems(items, total);
    } catch (err) {
      console.error('[Clipboard] Failed to load items:', err);
      useClipboardStore.getState().setError('Failed to load clipboard history');
    } finally {
      useClipboardStore.getState().setLoading(false);
    }
  }

  // --- Event handlers ---

  private onTriggerEnter = () => {
    this.log('MOUSEENTER trigger, state:', this.state);
    this.isInTrigger = true;

    if (this.state === 'CLOSED') {
      this.clearTimers();
      this.hoverTimer = setTimeout(() => {
        this.emit('PREVIEW');
      }, HOVER_DELAY);
    }
  };

  handleTriggerLeave() {
    this.log('MOUSELEAVE trigger, state:', this.state);
    this.isInTrigger = false;

    if (this.state === 'PREVIEW') {
      this.clearTimers();
      this.hoverTimer = setTimeout(() => {
        if (!this.isInTrigger && !this.isInPopover) {
          this.emit('CLOSED');
        }
      }, HOVER_DELAY);
    }
  }

  private onTriggerLeave = () => {
    this.handleTriggerLeave();
  };

  private onTriggerClick = (e: MouseEvent) => {
    e.stopPropagation(); // Prevent document click from closing immediately
    this.ignoreNextDocumentClick = true;
    setTimeout(() => { this.ignoreNextDocumentClick = false; }, 100);
    if (this.state === 'CLOSED' || this.state === 'LEAVING') {
      this.emit('LOCKED');
      // Select first item if none selected
      const { selectedIndex, items } = useClipboardStore.getState();
      if (selectedIndex < 0 && items.length > 0) {
        useClipboardStore.getState().setSelected(0);
      }
    } else if (this.state === 'PREVIEW' || this.state === 'LOCKED') {
      this.emit('CLOSED');
    }
  };

  handlePopoverEnter() {
    this.log('MOUSEENTER popover, state:', this.state);
    this.isInPopover = true;
    // Cancel any pending close timers when re-entering
    if (this.state === 'PREVIEW' || this.state === 'LOCKED') {
      this.clearTimers();
    }
  }

  private onPopoverEnter = () => {
    this.handlePopoverEnter();
  };

  handlePopoverLeave() {
    this.log('MOUSELEAVE popover, state:', this.state);
    this.isInPopover = false;

    if (this.state === 'LOCKED') {
      this.clearTimers();
      this.leaveTimer = setTimeout(() => {
        if (!this.isInTrigger && !this.isInPopover) {
          this.emit('CLOSED');
        }
      }, LOCK_GRACE);
    } else if (this.state === 'PREVIEW') {
      this.clearTimers();
      this.hoverTimer = setTimeout(() => {
        if (!this.isInTrigger && !this.isInPopover) {
          this.emit('CLOSED');
        }
      }, HOVER_DELAY);
    }
  }

  private onPopoverLeave = () => {
    this.handlePopoverLeave();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.state === 'CLOSED') return;

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
        this.handleEnter();
        break;
      case 'Escape':
        e.preventDefault();
        this.emit('CLOSED');
        break;
    }
  };

  private async handleEnter() {
    const { items, selectedIndex } = useClipboardStore.getState();
    if (selectedIndex >= 0 && selectedIndex < items.length) {
      const entry = items[selectedIndex];
      await copyFromHistory(entry);
      this.emit('CLOSED');
    }
  }

  private onDocumentClick = (e: MouseEvent) => {
    if (this.ignoreNextDocumentClick) {
      return;
    }
    if (this.state === 'CLOSED') {
      return;
    }

    const target = e.target as Node;
    const inTrigger = this.triggerEl?.contains(target) ?? false;
    const inPopover = this.popoverEl?.contains(target) ?? false;

    if (!inTrigger && !inPopover) {
      this.emit('CLOSED');
    }
  };

  // --- Public actions ---

  open() {
    this.emit('LOCKED');
  }

  preview() {
    if (this.state === 'CLOSED') {
      this.emit('PREVIEW');
    }
  }

  close() {
    this.emit('CLOSED');
  }

  toggle() {
    if (this.state === 'CLOSED' || this.state === 'LEAVING') {
      this.open(); // Open locked
    } else if (this.state === 'PREVIEW') {
      this.open(); // Lock from preview
    } else {
      this.close();
    }
  }

  getState(): BubbleState {
    return this.state;
  }
}

// Singleton instance
const controller = new InteractionController();

export function getClipboardController(): InteractionController {
  return controller;
}

export function attachClipboardController(triggerEl: HTMLElement, popoverEl: HTMLElement) {
  controller.attach(triggerEl, popoverEl);
}

export function detachClipboardController() {
  controller.detach();
}

export function subscribeClipboardController(listener: (state: BubbleState) => void): () => void {
  return controller.subscribe(listener);
}

export { controller };
