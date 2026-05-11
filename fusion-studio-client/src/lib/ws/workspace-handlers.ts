/**
 * @module workspace-handlers
 * @role Handle workspace-related WebSocket messages (registry, switch, add, remove).
 *
 * Mirrors thread-handlers / stream-handlers / file-handlers pattern: one
 * boolean-returning function, switch on msg.type, early return, final false.
 *
 * Incoming messages:
 *   workspace:init                 — initial registry + active id on connect
 *   workspace:registry_changed     — registry updated (add/remove/rename)
 *   workspace:switched             — active workspace changed
 *   workspace:added                — new workspace joined the registry
 *   workspace:removed              — workspace removed from registry
 *   workspace:add_rejected_duplicate — duplicate path (show modal)
 *   workspace:culled_at_launch     — workspace removed due to missing path (silent)
 *   thread:state_changed           — future use (silent)
 *
 * See docs/WORKSPACE_CLIENT_UI_SPEC.md §3.
 */

import { useWorkspaceStore } from '../../state/workspaceStore';
import { usePanelStore } from '../../state/panelStore';
import { useFileStore } from '../../state/fileStore';
import { useWikiStore } from '../../state/wikiStore';
import { preloadIcons } from '../icon-registry';
import { rediscoverPanels } from '../panels';
import { loadRootTree } from '../file-tree';
import { showModal, onModalAction } from '../modal';
import { resetSharedStyles, injectWorkspaceStyles } from '../../hooks/useSharedWorkspaceStyles';
import type { WebSocketMessage } from '../../types';

export function handleWorkspaceMessage(msg: WebSocketMessage): boolean {
  const store = useWorkspaceStore.getState();

  switch (msg.type) {
    case 'workspace:init': {
      const workspaces = msg.workspaces ?? [];
      store.setWorkspaces(workspaces);
      store.setActiveWorkspaceId(msg.activeWorkspaceId ?? null);
      store.setWorkspaceType((msg as any).workspaceType ?? 'code');
      if (msg.homePath) store.setHomePath(msg.homePath);
      usePanelStore.getState().hydrateCliConfig(msg.cliConfig ?? {});
      usePanelStore.getState().hydrateThemes((msg as any).themes ?? [], (msg as any).activeThemeId ?? null);
      // INSTANT_THEME_SWITCH: inject pre-loaded CSS synchronously if available
      if ((msg as any).styles) {
        injectWorkspaceStyles((msg as any).styles);
      }
      // WORKSPACE_CACHE_PERSISTENCE: hydrate cached workspace states from server
      const cachedStates = (msg as any).cachedStates ?? {};
      for (const [wsId, cached] of Object.entries(cachedStates)) {
        if (typeof cached === 'object' && cached !== null) {
          // Strip internal server metadata before seeding
          const { _savedAt, ...state } = cached as any;
          usePanelStore.getState().seedWorkspaceState(wsId, state);
        }
      }
      // If there's an active workspace on init, activate it so the cached
      // state loads immediately (avoids a blank-first-load after refresh).
      const activeId = msg.activeWorkspaceId ?? null;
      const panelBefore = usePanelStore.getState().currentPanel;
      if (activeId) {
        usePanelStore.getState().activateWorkspace(activeId);
        useFileStore.getState().activateWorkspace(activeId);
        useWikiStore.getState().activateWorkspace(activeId);
      }
      // Sync panel with server if the cached panel differs from the default
      // that was already sent in ws.onopen (set_panel is idempotent-ish).
      const panelStore = usePanelStore.getState();
      const wsConn = panelStore.ws;
      if (wsConn && wsConn.readyState === WebSocket.OPEN && panelStore.currentPanel && panelStore.currentPanel !== panelBefore) {
        wsConn.send(JSON.stringify({ type: 'set_panel', panel: panelStore.currentPanel }));
      }
      // Preload workspace icon SVGs from Fusion Home so the ribbon
      // renders inline SVGs instead of font glyphs on first paint.
      const iconNames = workspaces.map((w: any) => w.icon || 'folder').filter(Boolean);
      if (iconNames.length > 0) {
        preloadIcons(iconNames).catch(() => {});
      }

      store.markInit();
      return true;
    }

    case 'workspace:registry_changed': {
      const updatedWorkspaces = msg.workspaces ?? [];
      store.setWorkspaces(updatedWorkspaces);
      // Preload any newly added workspace icons
      const updatedIcons = updatedWorkspaces.map((w: any) => w.icon || 'folder').filter(Boolean);
      if (updatedIcons.length > 0) {
        preloadIcons(updatedIcons).catch(() => {});
      }
      return true;
    }

    case 'workspace:switched': {
      const workspaceId = msg.to ?? null;
      store.setActiveWorkspaceId(workspaceId);
      store.setWorkspaceType((msg as any).workspaceType ?? 'code');
      store.closeSwitcher();

      // WORKSPACE_ISOLATION_SPEC: swap to cached workspace state (or empty)
      usePanelStore.getState().activateWorkspace(workspaceId);
      useFileStore.getState().activateWorkspace(workspaceId);
      useWikiStore.getState().activateWorkspace(workspaceId);

      // Re-read stores AFTER activateWorkspace so we use the NEW workspace's state
      const panelStore = usePanelStore.getState();

      // Use repoPath from the switch message to seed projectRoot if the cache
      // is empty. panel_config will arrive shortly after with the canonical value.
      if (msg.repoPath && !panelStore.projectRoot) {
        panelStore.setProjectRoot(msg.repoPath);
      }

      // INSTANT_THEME_SWITCH: if the server sent pre-loaded CSS, inject it
      // synchronously instead of triggering 7 async WebSocket fetches.
      if ((msg as any).styles) {
        injectWorkspaceStyles((msg as any).styles);
      } else {
        // Fallback for older servers: invalidate cache so the hook refetches
        resetSharedStyles();
      }

      // SECONDARY_CHAT_SPEC §7d: secondary chat is workspace-scoped — blanket close.
      panelStore.closeSecondary();

      // If this workspace has never been visited, request panels and file tree.
      // If cached, render immediately without blocking.
      const isCached = workspaceId && panelStore.workspaceState[workspaceId];
      const ws = panelStore.ws;

      if (!isCached && ws && workspaceId) {
        // First visit: discover panels from the new workspace
        rediscoverPanels(ws).then(() => {
          // After discovery, load file tree in the background
          loadRootTree();
        }).catch((err) => {
          console.error('[workspace] rediscover failed:', err);
        });
      } else if (ws && workspaceId) {
        // Cached visit: panels already known; tell the server which panel we're on
        // so it can set up the correct view manager and thread scope.
        if (panelStore.panelConfigs.length === 0) {
          // Edge case: cache exists but has no panels (shouldn't happen, but safe)
          rediscoverPanels(ws).catch((err) => {
            console.error('[workspace] rediscover failed:', err);
          });
        } else if (panelStore.currentPanel) {
          ws.send(JSON.stringify({ type: 'set_panel', panel: panelStore.currentPanel }));
        }
        loadRootTree();
      }

      return true;
    }

    case 'workspace:added':
      // Registry will update via workspace:registry_changed, which arrives
      // immediately after. Just close the add/switcher UI.
      store.closeAddModal();
      store.closeSwitcher();
      return true;

    case 'workspace:removed':
      // Registry will update via workspace:registry_changed.
      return true;

    case 'workspace:add_rejected_duplicate': {
      store.closeAddModal();
      const existing = msg.existingWorkspace;
      const label = existing?.label ?? 'unknown';
      // One-shot action listener: on 'confirm', switch to the existing
      // workspace; on 'cancel' or dismiss, do nothing. Reset the listener
      // to a noop afterwards so later modals don't inherit this behavior.
      onModalAction((action) => {
        if (action === 'confirm' && existing) {
          useWorkspaceStore.getState().requestSwitch(existing.id);
        }
        onModalAction(() => {});
      });
      showModal({
        modalType: 'alert',
        config: { type: 'alert' },
        styles: '',
        data: {
          title: 'Workspace already registered',
          message: `This repo is already registered as "${label}". Switch to it?`,
        },
      });
      return true;
    }

    case 'workspace:culled_at_launch':
      // Silent — logged server-side.
      return true;

    case 'thread:state_changed':
      // Available for future UI (activity indicators). No-op today.
      return true;

    default:
      return false;
  }
}
