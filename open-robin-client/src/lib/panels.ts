/**
 * @module panels
 * @role Shared panel discovery and config loading
 * @reads ai/views/index.json, ai/views/{id}/index.json, ai/views/{id}/content.json,
 *        layout: ai/views/{id}/settings/layout.json (most panels) or
 *        ai/views/code-viewer/settings/styles/layout.json (code-viewer)
 * Workspace CSS: fetchPanelWorkspaceFile / fetchViewsRootFile (__panels__ → ai/views/…).
 * Chat/thread styles: settings/styles/views.css (see VIEWS_SETTINGS_STYLES_VIEWS; bundled in client).
 *
 * Loads panel definitions from the repo filesystem via WebSocket.
 * Knows nothing about any specific panel type — content.json declares
 * the display type, chat config, and layout.
 */

// --- Types ---

export interface PanelTheme {
  primary: string;
  sidebar_bg: string;
  content_bg: string;
  panel_border: string;
}

export type PanelLayout = 'full' | 'chat-content' | 'sidebar-chat-content';

export interface ChatConfig {
  type: 'threaded' | 'rolling-daily';
  position: 'left' | 'right' | 'popup';
}

export interface ContentConfig {
  display: string;
  chat: ChatConfig | null;
}

export interface LayoutConfig {
  chatPosition: 'left' | 'right' | 'popup' | null;
  chatWidth: number | null;
  chatHeight: number | null;
  threadListWidth: number | null;
  threadListVisible: boolean;
  popup: {
    x: number | null;
    y: number | null;
    width: number;
    height: number;
  } | null;
}

export interface PanelConfig {
  id: string;
  name: string;
  description?: string;
  type: string;
  icon: string;
  hasChat: boolean;
  chatConfig: ChatConfig | null;
  layout: PanelLayout;
  layoutConfig: LayoutConfig | null;
  contentConfig: ContentConfig | null;
  theme: PanelTheme;
  rank?: number;
  /** True if panel has a ui/ folder with module.js (runtime-loaded plugin) */
  hasUiFolder?: boolean;
}

// --- Helpers ---

/**
 * Request a file from a panel via WebSocket.
 * Returns a promise that resolves with the file content or rejects on error.
 */
/** Relative to ai/views/{panelId}/ (e.g. settings/styles.css). Uses __panels__ resolver — not the file-explorer content root. */
export const PANEL_WORKSPACE_STYLES_FILENAME = 'settings/styles.css' as const;

/** Under ai/views/ — shared across panels (pilot: code-viewer loads these + per-panel layout). */
export const VIEWS_SETTINGS_STYLES_THEMES = 'settings/styles/themes.css' as const;
export const VIEWS_SETTINGS_STYLES_COMPONENTS = 'settings/styles/components.css' as const;
/** Chat + thread list + composer (bundled via main.tsx; same path over __panels__ for optional runtime fetch). */
export const VIEWS_SETTINGS_STYLES_VIEWS = 'settings/styles/views.css' as const;

/** Fetch a file under ai/views/ (same mechanism as panel discovery). */
export function fetchViewsRootFile(ws: WebSocket, pathUnderViews: string): Promise<string> {
  return fetchPanelFile(ws, '__panels__', pathUnderViews);
}

/**
 * Read a file from under ai/views/{panelId}/ regardless of display type.
 * Use this for settings/styles.css, index.json, etc. (Not for browsing project files on code-viewer.)
 */
export function fetchPanelWorkspaceFile(
  ws: WebSocket,
  panelId: string,
  pathUnderView: string
): Promise<string> {
  return fetchPanelFile(ws, '__panels__', `${panelId}/${pathUnderView}`);
}

export function fetchPanelFile(ws: WebSocket, panel: string, filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'file_content_response' && msg.panel === panel && msg.path === filePath) {
          ws.removeEventListener('message', handleMessage);
          if (msg.success) {
            resolve(msg.content);
          } else {
            reject(new Error(msg.error || `Failed to load ${panel}/${filePath}`));
          }
        }
      } catch { /* ignore */ }
    };

    ws.addEventListener('message', handleMessage);
    ws.send(JSON.stringify({
      type: 'file_content_request',
      panel,
      path: filePath,
    }));

    setTimeout(() => {
      ws.removeEventListener('message', handleMessage);
      reject(new Error(`Timeout loading ${panel}/${filePath}`));
    }, 5000);
  });
}

/**
 * Load a JSON file from a panel, returning null on failure.
 */
async function fetchPanelJson(ws: WebSocket, panelId: string, filePath: string): Promise<any | null> {
  try {
    const raw = await fetchPanelFile(ws, '__panels__', `${panelId}/${filePath}`);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Load a single panel's config from its index.json + content.json + layout JSON.
 */
export async function loadPanelConfig(ws: WebSocket, panelId: string): Promise<PanelConfig | null> {
  try {
    const json = await fetchPanelJson(ws, panelId, 'index.json');
    if (!json) return null;

    // Load content.json — declares display type and chat config
    const contentConfig: ContentConfig | null = await fetchPanelJson(ws, panelId, 'content.json');

    const layoutPath =
      panelId === 'code-viewer'
        ? 'settings/styles/layout.json'
        : 'settings/layout.json';
    let layoutConfig: LayoutConfig | null = await fetchPanelJson(ws, panelId, layoutPath);
    if (panelId === 'code-viewer' && !layoutConfig) {
      layoutConfig = await fetchPanelJson(ws, panelId, 'settings/layout.json');
    }

    // Chat is determined by content.json, not by probing the filesystem
    const chatConfig = contentConfig?.chat || null;
    const hasChat = chatConfig !== null;

    // Check if panel has a ui/ folder with module.js
    const hasUiFolder = await fetchPanelFile(ws, '__panels__', `${panelId}/ui/module.js`)
      .then(() => true)
      .catch(() => false);

    return {
      id: json.id || panelId,
      name: json.label || panelId,
      description: json.description,
      type: contentConfig?.display || json.type || 'placeholder',
      icon: json.icon || 'folder',
      hasChat,
      chatConfig,
      layout: json.settings?.layout || (hasChat ? 'sidebar-chat-content' : 'full') as PanelLayout,
      layoutConfig,
      contentConfig,
      theme: {
        primary: json.settings?.theme?.primary || '#888888',
        sidebar_bg: json.settings?.theme?.sidebar_bg || '#111111',
        content_bg: json.settings?.theme?.content_bg || '#0d0d0d',
        panel_border: json.settings?.theme?.panel_border || '#88888833',
      },
      rank: json.rank,
      hasUiFolder,
    };
  } catch {
    return null;
  }
}

/**
 * Discover all panels by requesting the folder listing of ai/views/.
 * Returns panel IDs (folder names).
 */
export function discoverPanels(ws: WebSocket): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'file_tree_response' && msg.panel === '__panels__') {
          ws.removeEventListener('message', handleMessage);
          if (msg.success) {
            const folders = (msg.nodes || [])
              .filter((n: { type: string }) => n.type === 'directory' || n.type === 'folder')
              .map((n: { name: string }) => n.name);
            resolve(folders);
          } else {
            reject(new Error(msg.error || 'Failed to discover panels'));
          }
        }
      } catch { /* ignore */ }
    };

    ws.addEventListener('message', handleMessage);
    ws.send(JSON.stringify({
      type: 'file_tree_request',
      panel: '__panels__',
      path: '',
    }));

    setTimeout(() => {
      ws.removeEventListener('message', handleMessage);
      reject(new Error('Timeout discovering panels'));
    }, 5000);
  });
}

/**
 * Load all panel configs. Discovers panel folders, loads each config,
 * returns sorted by rank (from index.json rank field).
 */
export async function loadAllPanels(ws: WebSocket): Promise<PanelConfig[]> {
  const ids = await discoverPanels(ws);
  const configs = await Promise.all(
    ids.map((id) => loadPanelConfig(ws, id))
  );
  // Filter nulls and sort by rank (panels without rank go last)
  return configs
    .filter((c): c is PanelConfig => c !== null)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
}

/**
 * Apply a panel theme as CSS custom properties on a target element.
 */
export function applyPanelTheme(el: HTMLElement, theme: PanelTheme) {
  el.style.setProperty('--ws-primary', theme.primary);
  el.style.setProperty('--ws-sidebar-bg', theme.sidebar_bg);
  el.style.setProperty('--ws-content-bg', theme.content_bg);
  el.style.setProperty('--ws-panel-border', theme.panel_border);
}
