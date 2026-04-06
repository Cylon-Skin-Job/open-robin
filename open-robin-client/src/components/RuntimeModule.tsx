/**
 * @module RuntimeModule
 * @role React wrapper for runtime-loaded panel ui/ modules
 *
 * Renders a container div, loads the panel's ui/ folder contents
 * (template.html, styles.css, module.js), and manages the mount/unmount
 * lifecycle of the vanilla JS module.
 */

import { useEffect, useRef } from 'react';
import type { PanelConfig } from '../lib/panels';
import { loadAndMount, unmountModule } from '../engine/runtime-module';
import { usePanelStore } from '../state/panelStore';

interface RuntimeModuleProps {
  panel: string;
  config: PanelConfig;
}

export function RuntimeModule({ panel, config }: RuntimeModuleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ws = usePanelStore((s) => s.ws);
  const mountedRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ws || ws.readyState !== WebSocket.OPEN) return;
    // mountedRef prevents double-load within the same mount cycle.
    // Reset on cleanup so strict-mode remount can re-trigger the load.
    if (mountedRef.current) return;

    mountedRef.current = true;

    loadAndMount(config, el).catch((err) => {
      console.error(`[RuntimeModule] Failed to load ${panel}:`, err);
      el.innerHTML = `
        <div style="padding: 24px; color: var(--text-dim, #888);">
          <p>Failed to load panel plugin</p>
          <p style="font-size: 0.8rem; opacity: 0.6;">${err.message}</p>
        </div>
      `;
    });

    return () => {
      mountedRef.current = false;
      unmountModule(panel);
    };
  }, [ws, panel, config]);

  return (
    <div
      ref={containerRef}
      className="runtime-module-container"
      data-panel={panel}
      style={{ width: '100%', height: '100%', overflow: 'auto' }}
    />
  );
}
