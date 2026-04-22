/**
 * @module useSharedWorkspaceStyles
 * @role Load workspace shared CSS (themes + components + views) and optional
 *       per-view layout CSS from ai/views over WebSocket.
 *
 * - useSharedWorkspaceStyles(): loads themes + components + views globally
 *   (unscoped, since chat chrome applies app-wide). Call once from App.
 * - useViewLayoutStyles(panelId): loads optional ai/views/{panelId}/settings/layout.css
 *   + optional ai/views/{panelId}/settings/themes.css (per-view theme override)
 *   scoped to [data-panel="{panelId}"]. Silently no-ops on ENOENT/timeout.
 * - resetSharedStyles(): clears the shared-load guard + style tags so the next
 *   render reloads from a newly-switched workspace.
 */

import { useEffect } from 'react';
import { usePanelStore } from '../state/panelStore';
import {
  fetchPanelWorkspaceFile,
  fetchViewsRootFile,
  VIEWS_SETTINGS_STYLES_COMPONENTS,
  VIEWS_SETTINGS_STYLES_THEMES,
  VIEWS_SETTINGS_STYLES_VIEWS,
} from '../lib/panels';
import { scopePanelCss } from '../lib/scopePanelCss';

const SHARED_STYLE_PREFIX = 'ws-shared-styles-';
const VIEW_LAYOUT_STYLE_PREFIX = 'ws-view-layout-';

const SHARED_LAYERS: { id: string; path: string }[] = [
  { id: 'themes',     path: VIEWS_SETTINGS_STYLES_THEMES },
  { id: 'components', path: VIEWS_SETTINGS_STYLES_COMPONENTS },
  { id: 'views',      path: VIEWS_SETTINGS_STYLES_VIEWS },
];

// Guard against repeat loads from multiple consumers on the same WS connection.
// Bumped on workspace switch so the hook refetches even when the WS ref is stable.
let loadGeneration = 0;

function fetchAndInject(ws: WebSocket, generation: number): void {
  Promise.all(SHARED_LAYERS.map((layer) => fetchViewsRootFile(ws, layer.path)))
    .then((contents) => {
      // Abort if a newer reload has started (e.g. another workspace switch)
      if (generation !== loadGeneration) return;
      SHARED_LAYERS.forEach((layer, i) => {
        const css = contents[i]?.trim();
        const styleId = `${SHARED_STYLE_PREFIX}${layer.id}`;
        document.getElementById(styleId)?.remove();
        if (!css) return;
        const el = document.createElement('style');
        el.id = styleId;
        el.textContent = css;
        document.head.appendChild(el);
      });
    })
    .catch((err) => {
      console.error('[SharedStyles] Failed to load workspace styles:', err);
    });
}

export function useSharedWorkspaceStyles() {
  const ws = usePanelStore((s) => s.ws);
  const generation = usePanelStore((s) => s.sharedStylesGeneration);

  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    loadGeneration += 1;
    fetchAndInject(ws, loadGeneration);
  }, [ws, generation]);
}

export function useViewLayoutStyles(panelId: string) {
  const ws = usePanelStore((s) => s.ws);

  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    let cancelled = false;
    const layoutStyleId = `${VIEW_LAYOUT_STYLE_PREFIX}${panelId}`;
    const themeStyleId = `${VIEW_LAYOUT_STYLE_PREFIX}${panelId}-theme`;

    // settings/layout.css — structural per-view chrome, scoped.
    fetchPanelWorkspaceFile(ws, panelId, 'settings/layout.css')
      .then((css) => {
        if (cancelled) return;
        const trimmed = css?.trim();
        if (!trimmed) return;
        document.getElementById(layoutStyleId)?.remove();
        const el = document.createElement('style');
        el.id = layoutStyleId;
        el.textContent = scopePanelCss(css, panelId);
        document.head.appendChild(el);
      })
      .catch(() => {
        /* ENOENT / timeout — no layout.css for this view, that's fine */
      });

    // settings/themes.css — optional per-view theme override. Same filename
    // as the workspace theme file; scoped to [data-panel="<id>"] so the
    // workspace cascade remains the default and only this view sees it.
    fetchPanelWorkspaceFile(ws, panelId, 'settings/themes.css')
      .then((css) => {
        if (cancelled) return;
        const trimmed = css?.trim();
        if (!trimmed) return;
        document.getElementById(themeStyleId)?.remove();
        const el = document.createElement('style');
        el.id = themeStyleId;
        el.textContent = scopePanelCss(css, panelId);
        document.head.appendChild(el);
      })
      .catch(() => {
        /* ENOENT — no per-view theme override, that's the common case */
      });

    return () => {
      cancelled = true;
      document.getElementById(layoutStyleId)?.remove();
      document.getElementById(themeStyleId)?.remove();
    };
  }, [panelId, ws]);
}

export function resetSharedStyles() {
  SHARED_LAYERS.forEach((layer) => {
    document.getElementById(`${SHARED_STYLE_PREFIX}${layer.id}`)?.remove();
  });
  // Bump the generation counter so every useSharedWorkspaceStyles consumer
  // re-runs its effect and refetches from the now-active workspace.
  const store = usePanelStore.getState();
  store.bumpSharedStylesGeneration();
}
