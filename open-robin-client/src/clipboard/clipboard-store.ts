/**
 * @module clipboard/clipboard-store
 * @role Zustand store for clipboard state
 */

import { create } from 'zustand';
import type { ClipboardEntry, BubbleState } from './types';

interface ClipboardState {
  items: ClipboardEntry[];
  total: number;
  selectedIndex: number;
  bubbleState: BubbleState;
  isLoading: boolean;
  error: string | null;
}

interface ClipboardActions {
  setItems: (items: ClipboardEntry[], total: number) => void;
  prependItem: (item: ClipboardEntry) => void;
  updateItem: (item: ClipboardEntry) => void;
  setSelected: (index: number) => void;
  setBubbleState: (state: BubbleState) => void;
  clearItems: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectNext: () => void;
  selectPrev: () => void;
  close: () => void;
}

export const useClipboardStore = create<ClipboardState & ClipboardActions>((set, get) => ({
  // State
  items: [],
  total: 0,
  selectedIndex: -1,
  bubbleState: 'CLOSED',
  isLoading: false,
  error: null,

  // Actions
  setItems: (items, total) => set({ items, total, selectedIndex: items.length > 0 ? 0 : -1 }),

  prependItem: (item) => {
    const { items, total } = get();
    // Check if item already exists by id
    const exists = items.find((i) => i.id === item.id);
    if (exists) {
      // Move to top by reordering
      const filtered = items.filter((i) => i.id !== item.id);
      set({ items: [item, ...filtered], selectedIndex: 0 });
    } else {
      set({ items: [item, ...items], total: total + 1, selectedIndex: 0 });
    }
  },

  updateItem: (item) => {
    const { items } = get();
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      const newItems = [...items];
      newItems[idx] = item;
      // If touched, move to top
      if (item.last_used_at > items[idx].last_used_at) {
        newItems.splice(idx, 1);
        newItems.unshift(item);
        set({ items: newItems, selectedIndex: 0 });
      } else {
        set({ items: newItems });
      }
    }
  },

  setSelected: (index) => set({ selectedIndex: index }),

  setBubbleState: (state) => set({ bubbleState: state }),

  clearItems: () => set({ items: [], total: 0, selectedIndex: -1 }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  selectNext: () => {
    const { items, selectedIndex } = get();
    if (items.length === 0) return;
    const next = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
    set({ selectedIndex: next });
  },

  selectPrev: () => {
    const { items, selectedIndex } = get();
    if (items.length === 0) return;
    const prev = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
    set({ selectedIndex: prev });
  },

  close: () => set({ bubbleState: 'CLOSED' }),
}));
