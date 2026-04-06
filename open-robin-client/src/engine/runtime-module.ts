/**
 * @module runtime-module
 * @role Loads panel ui/module.js at runtime via WebSocket fetch
 *
 * Fetches module.js as text, creates a Blob URL, and dynamically imports it.
 * Manages the mount/unmount lifecycle for panel plugin modules.
 *
 * When Electron is available, this can be swapped to use fs.readFileSync
 * for faster loading. The module contract stays the same.
 */

import { fetchPanelFile } from '../lib/panels';
import { createContext, destroyContext, type PanelContext } from './panel-context';
import type { PanelConfig } from '../lib/panels';
import { usePanelStore } from '../state/panelStore';

/** The interface a panel ui/module.js must export */
export interface PanelModule {
  mount(el: HTMLElement, ctx: PanelContext): void;
  unmount(el: HTMLElement, ctx: PanelContext): void;
  onData?(el: HTMLElement, ctx: PanelContext, msg: any): void;
}

/** Tracks a loaded runtime module instance */
interface LoadedModule {
  module: PanelModule;
  ctx: PanelContext;
  el: HTMLElement;
  blobUrl: string | null;
}

const loadedModules = new Map<string, LoadedModule>();

/**
 * Load and mount a panel's ui/ folder contents.
 *
 * 1. Fetches ui/template.html, ui/styles.css, ui/module.js via WebSocket
 * 2. Injects template HTML into the container element
 * 3. Injects scoped CSS via ctx.injectStyles()
 * 4. Loads module.js via Blob URL + dynamic import
 * 5. Calls module.mount(el, ctx)
 */
export async function loadAndMount(
  config: PanelConfig,
  containerEl: HTMLElement
): Promise<void> {
  const ws = usePanelStore.getState().ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket not connected');
  }

  // Unmount existing module for this panel if any
  await unmountModule(config.id);

  // Create context
  const ctx = createContext(config);

  // Set data-panel attribute for CSS scoping
  containerEl.setAttribute('data-panel', config.id);

  // Load all three files in parallel (template and styles are optional)
  const [templateResult, stylesResult, moduleResult] = await Promise.allSettled([
    fetchPanelFile(ws, config.id, 'ui/template.html'),
    fetchPanelFile(ws, config.id, 'ui/styles.css'),
    fetchPanelFile(ws, config.id, 'ui/module.js'),
  ]);

  // Inject template HTML (optional — module can build DOM itself)
  if (templateResult.status === 'fulfilled') {
    containerEl.innerHTML = templateResult.value;
  }

  // Inject scoped styles (optional)
  if (stylesResult.status === 'fulfilled') {
    ctx.injectStyles(stylesResult.value, `ws-plugin-${config.id}`);
  }

  // Module is required
  if (moduleResult.status === 'rejected') {
    containerEl.innerHTML = `
      <div style="padding: 24px; color: var(--text-dim, #888);">
        <p>Failed to load module for panel "${config.name}"</p>
        <p style="font-size: 0.8rem; opacity: 0.6;">${moduleResult.reason?.message || 'Unknown error'}</p>
      </div>
    `;
    return;
  }

  // Load module.js via Blob URL + dynamic import
  const moduleCode = moduleResult.value;
  const blob = new Blob([moduleCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  let mod: PanelModule;
  try {
    const imported = await import(/* @vite-ignore */ blobUrl);
    mod = imported as PanelModule;
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    containerEl.innerHTML = `
      <div style="padding: 24px; color: var(--text-dim, #888);">
        <p>Error loading module for "${config.name}"</p>
        <p style="font-size: 0.8rem; opacity: 0.6;">${err instanceof Error ? err.message : 'Unknown error'}</p>
      </div>
    `;
    return;
  }

  // Verify module exports
  if (typeof mod.mount !== 'function') {
    URL.revokeObjectURL(blobUrl);
    containerEl.innerHTML = `
      <div style="padding: 24px; color: var(--text-dim, #888);">
        <p>Module for "${config.name}" is missing mount() export</p>
      </div>
    `;
    return;
  }

  // Track the loaded module
  loadedModules.set(config.id, {
    module: mod,
    ctx,
    el: containerEl,
    blobUrl,
  });

  // Mount
  try {
    mod.mount(containerEl, ctx);
  } catch (err) {
    console.error(`[RuntimeModule] mount() error for ${config.id}:`, err);
  }

  // If module has onData, wire it up as a listener
  if (typeof mod.onData === 'function') {
    ctx.on('file_content_response', (msg: any) => {
      if (msg.panel === config.id) {
        try {
          mod.onData!(containerEl, ctx, msg);
        } catch (err) {
          console.error(`[RuntimeModule] onData() error for ${config.id}:`, err);
        }
      }
    });
  }
}

/**
 * Unmount and clean up a panel's runtime module.
 */
export async function unmountModule(panelId: string): Promise<void> {
  const loaded = loadedModules.get(panelId);
  if (!loaded) return;

  // Call unmount
  if (typeof loaded.module.unmount === 'function') {
    try {
      loaded.module.unmount(loaded.el, loaded.ctx);
    } catch (err) {
      console.error(`[RuntimeModule] unmount() error for ${panelId}:`, err);
    }
  }

  // Revoke Blob URL
  if (loaded.blobUrl) {
    URL.revokeObjectURL(loaded.blobUrl);
  }

  // Destroy context (removes WS listeners, injected styles, state)
  destroyContext(panelId);

  // Clear container
  loaded.el.innerHTML = '';

  loadedModules.delete(panelId);
}

/**
 * Reload a panel module (for hot reload support).
 * Unmounts current module, re-fetches files, mounts fresh.
 */
export async function reloadModule(
  config: PanelConfig,
  containerEl: HTMLElement
): Promise<void> {
  await unmountModule(config.id);
  await loadAndMount(config, containerEl);
}

/**
 * Check if a panel has an active runtime module.
 */
export function isModuleLoaded(panelId: string): boolean {
  return loadedModules.has(panelId);
}
