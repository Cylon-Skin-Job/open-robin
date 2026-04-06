/**
 * @module usePanelWorkspaceStyles
 * @role Load workspace CSS from ai/views over WebSocket and inject scoped styles
 *
 * - usePanelWorkspaceStyles: single file ai/views/{panelId}/settings/styles.css (other panels).
 * - useCodeViewerWorkspaceStyles: optional workspace themes + file-tree components + code-viewer layout.
 *   Shared code/markdown CSS is bundled in document.css.
 * - Chat + threads: ai/views/settings/styles/views.css (bundled in main.tsx via @views alias).
 *
 * Requires an ancestor with data-panel={panelId} (see App panel wrapper).
 */

import { useEffect } from 'react';
import { usePanelStore } from '../state/panelStore';
import {
  fetchPanelWorkspaceFile,
  fetchViewsRootFile,
  PANEL_WORKSPACE_STYLES_FILENAME,
  VIEWS_SETTINGS_STYLES_COMPONENTS,
  VIEWS_SETTINGS_STYLES_THEMES,
} from '../lib/panels';
import { scopePanelCss } from '../lib/scopePanelCss';

const STYLE_TAG_PREFIX = 'panel-workspace-styles-';

const CODE_VIEWER_ID = 'code-viewer';

const CODE_VIEWER_STYLE_LAYERS: { id: string; fetch: (ws: WebSocket) => Promise<string> }[] = [
  { id: 'themes', fetch: (ws) => fetchViewsRootFile(ws, VIEWS_SETTINGS_STYLES_THEMES) },
  { id: 'components', fetch: (ws) => fetchViewsRootFile(ws, VIEWS_SETTINGS_STYLES_COMPONENTS) },
  {
    id: 'layout',
    fetch: (ws) =>
      fetchPanelWorkspaceFile(ws, CODE_VIEWER_ID, 'settings/styles/layout.css'),
  },
];

/**
 * Pilot: file explorer — loads ai/views/settings/styles/{themes,components}.css
 * and ai/views/code-viewer/settings/styles/layout.css. Other panels still use index.css only.
 */
export function useCodeViewerWorkspaceStyles() {
  const ws = usePanelStore((s) => s.ws);

  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    let cancelled = false;

    Promise.all(CODE_VIEWER_STYLE_LAYERS.map((layer) => layer.fetch(ws)))
      .then((contents) => {
        if (cancelled) return;
        CODE_VIEWER_STYLE_LAYERS.forEach((layer, i) => {
          const css = contents[i];
          const trimmed = css.trim();
          if (!trimmed) return;
          const styleId = `${STYLE_TAG_PREFIX}${CODE_VIEWER_ID}-${layer.id}`;
          document.getElementById(styleId)?.remove();
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = scopePanelCss(css, CODE_VIEWER_ID);
          document.head.appendChild(style);
        });
      })
      .catch((err) => {
        console.error('[code-viewer] Failed to load workspace styles (themes / components / layout)', err);
      });

    return () => {
      cancelled = true;
      CODE_VIEWER_STYLE_LAYERS.forEach((layer) => {
        document.getElementById(`${STYLE_TAG_PREFIX}${CODE_VIEWER_ID}-${layer.id}`)?.remove();
      });
    };
  }, [ws]);
}

export function usePanelWorkspaceStyles(panelId: string) {
  const ws = usePanelStore((s) => s.ws);

  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const styleId = `${STYLE_TAG_PREFIX}${panelId}`;
    let cancelled = false;

    fetchPanelWorkspaceFile(ws, panelId, PANEL_WORKSPACE_STYLES_FILENAME)
      .then((css) => {
        if (cancelled) return;
        const trimmed = css.trim();
        if (!trimmed) return;

        document.getElementById(styleId)?.remove();
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = scopePanelCss(css, panelId);
        document.head.appendChild(style);
      })
      .catch(() => {
        /* ENOENT / timeout — keep bundle defaults */
      });

    return () => {
      cancelled = true;
      document.getElementById(styleId)?.remove();
    };
  }, [panelId, ws]);
}
