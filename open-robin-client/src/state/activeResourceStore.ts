/**
 * Active Resource Store — tracks what the user is currently viewing.
 *
 * Used by the live refresh bridge to know which file to re-fetch
 * when a file_changed event arrives from the server.
 */

import { create } from 'zustand';

interface ActiveResource {
  panel: string;
  relativePath: string;
}

interface ActiveResourceState {
  activeResource: ActiveResource | null;
  setActiveResource: (panel: string, relativePath: string) => void;
  clearActiveResource: () => void;
}

export const useActiveResourceStore = create<ActiveResourceState>((set) => ({
  activeResource: null,
  setActiveResource: (panel, relativePath) => set({ activeResource: { panel, relativePath } }),
  clearActiveResource: () => set({ activeResource: null }),
}));
