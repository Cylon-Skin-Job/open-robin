/**
 * @module ContentArea
 * @role Routes panel ID to the correct content component
 *
 * Priority order:
 * 1. If panel has ui/ folder (hasUiFolder) → RuntimeModule (plugin)
 * 2. If panel has built-in component → static component
 * 3. Otherwise → placeholder
 */

import type { ComponentType } from 'react';
import { usePanelStore } from '../state/panelStore';
import { RuntimeModule } from './RuntimeModule';
import { FileExplorer } from './file-explorer/FileExplorer';
import { WikiExplorer } from './wiki/WikiExplorer';
import { TicketBoard } from './tickets/TicketBoard';
import { AgentTiles } from './agents/AgentTiles';
import { CaptureTiles } from './capture/CaptureTiles';

/** Built-in component map: panel ID → content component */
const CONTENT_COMPONENTS: Record<string, ComponentType> = {
  'capture-viewer': CaptureTiles,
  'code-viewer': FileExplorer,
  'wiki-viewer': WikiExplorer,
  'issues-viewer': TicketBoard,
  'agents-viewer': AgentTiles,
};

interface ContentAreaProps {
  panel: string;
}

export function ContentArea({ panel }: ContentAreaProps) {
  const config = usePanelStore((s) => s.getPanelConfig(panel));

  // Priority 1: Runtime-loaded plugin (ui/ folder exists)
  if (config?.hasUiFolder) {
    return (
      <main className="rv-content-area">
        <RuntimeModule panel={panel} config={config} />
      </main>
    );
  }

  // Priority 2: Built-in component
  const Component = CONTENT_COMPONENTS[panel];
  if (Component) {
    return (
      <main className="rv-content-area">
        <Component />
      </main>
    );
  }

  // Priority 3: Placeholder
  return (
    <main className="rv-content-area">
      <div className="rv-panel-placeholder">
        <h3 style={{ color: 'var(--theme-primary)', marginBottom: '16px' }}>
          {config?.name || panel}
        </h3>
        <p style={{ color: 'var(--text-dim)' }}>
          Content area for {(config?.name || panel).toLowerCase()} panel.
        </p>
      </div>
    </main>
  );
}
