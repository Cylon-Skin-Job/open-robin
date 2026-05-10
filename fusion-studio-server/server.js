/**
 * Fusion Studio Server with Thread Management
 * 
 * This version includes persistent, named conversations with lifecycle management.
 * 
 * @see lib/thread/README.md - Thread management documentation
 * @see ../ai/views/capture-viewer/specs/SPEC.md - Full specification
 */

const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const { spawn } = require('child_process');
const { v4: uuidv4, v4: generateId } = require('uuid');
const fs = require('fs');
const fsPromises = require('fs').promises;

// Thread management
const { ThreadWebSocketHandler } = require('./lib/thread');
const { initDb, getDb } = require('./lib/db');

// Fusion system panel
const createFusionHandlers = require('./lib/fusion/ws-handlers');

// Clipboard manager
const createClipboardHandlers = require('./lib/secrets/clipboard/handlers');

// File explorer handlers
const { createFileExplorerHandlers } = require('./lib/file-explorer');

// Wiki hooks
const wikiHooks = require('./lib/wiki/hooks');

// Event bus for TRIGGERS.md automations
const { emit, on } = require('./lib/event-bus');
const workspaceController = require('./lib/workspace/workspace-controller');

// Harness compatibility layer for external CLI harnesses
const { spawnThreadWire } = require('./lib/harness/compat');
const { getHarnessMode } = require('./lib/harness/feature-flags');

// Log current harness mode on startup
console.log('[Server] Harness mode:', getHarnessMode());

// Hardwired enforcement — settings/ folders are write-locked for AI
const { checkSettingsBounce } = require('./lib/enforcement');

// Server startup orchestrator (DB init, handlers, listen, watcher, triggers, shutdown)
const { start: startServer } = require('./lib/startup');

// Wire process manager — registry, marshalling, and per-connection lifecycle
const {
  createWireLifecycle,
  sendToWire,
  registerWire,
  unregisterWire,
  getWireForThread,
} = require('./lib/wire/process-manager');

// Wire message router — per-connection event switch (extracted per SPEC-01d)
const { createWireMessageRouter } = require('./lib/wire/message-router');

// Client message router — per-connection dispatch factory (extracted per SPEC-01f).
const { createClientMessageRouter } = require('./lib/ws/client-message-router');

// File operations with archive support
const { moveFileWithArchive } = require('./lib/file-ops');

// Config system for persistence
const config = require('./config');

// View discovery and resolution (filesystem-driven, no database)
const views = require('./lib/views');

// Logging
const SERVER_LOG_FILE = path.join(__dirname, 'server-live.log');

// Override console.log to also write to file
const originalLog = console.log;
console.log = function(...args) {
  originalLog.apply(console, args);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}
`;
  fs.appendFileSync(SERVER_LOG_FILE, line);
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the React client dist folder
const clientDistPath = path.join(__dirname, '..', 'fusion-studio-client', 'dist');
app.use(
  express.static(clientDistPath, {
    setHeaders(res, filePath) {
      // Always revalidate HTML so new builds (new hashed JS/CSS names) load after refresh
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

// Voice transcription API (Whisper V3)
const transcription = require('./lib/transcription');
app.use('/api', transcription.createRouter());

// Serve panel files (images, etc.) via HTTP
// Uses fuzzy filename matching to handle macOS Unicode spaces in screenshot names
app.get('/api/panel-file/:panel/{*filePath}', (req, res) => {
  const panel = req.params.panel;
  const rawPath = req.params.filePath;
  const filePath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;
  const root = getProjectRoot();
  if (!root) return res.status(503).send('No active workspace');
  // Resolve via the same view resolver the file-tree WS handler uses, so
  // tiled-rows views (doc-viewer / agents-viewer) correctly point at
  // ai/views/{panel}/content/ instead of the bare ai/views/{panel}/.
  const panelPath = getPanelPath(panel);
  const baseDir = panelPath || path.join(root, 'ai', 'views', panel);
  const dirPath = path.join(baseDir, path.dirname(filePath));
  const fileName = path.basename(filePath);

  try {
    const realDir = fs.realpathSync(dirPath);
    // Try direct match first
    const directPath = path.join(realDir, fileName);
    if (fs.existsSync(directPath)) {
      return res.sendFile(directPath);
    }

    // Fuzzy match: normalize Unicode spaces for macOS screenshot filenames
    const entries = fs.readdirSync(realDir);
    const normalizedTarget = fileName.replace(/[\s\u00a0\u202f\u2009]/g, ' ');
    const match = entries.find(e => e.replace(/[\s\u00a0\u202f\u2009]/g, ' ') === normalizedTarget);

    if (match) {
      return res.sendFile(path.join(realDir, match));
    }

    res.status(404).send('Not found');
  } catch {
    res.status(404).send('Not found');
  }
});

// ---- External CLI harnesses API (Phase 3) ----

app.get('/api/harnesses', async (req, res) => {
  const service = require('./lib/harness/harness-status-service');
  try {
    const harnesses = await service.getAll();
    res.json(harnesses);
    // Fire-and-forget revalidation so repeated hits stay sub-ms while
    // the cache converges on real state. Debounced internally.
    service.revalidateAll().catch(() => {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/harnesses/:id/status', async (req, res) => {
  const { registry } = require('./lib/harness');
  try {
    const status = await registry.getHarnessStatus(req.params.id);
    if (!status) {
      return res.status(404).json({ error: 'Harness not found' });
    }
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const layoutService = require('./lib/theme/layout-service');

app.get('/api/view-config', async (req, res) => {
  try {
    const projectRoot = getProjectRoot();
    const viewName = req.query.panel;
    if (!viewName) {
      return res.status(400).json({ error: 'Missing panel query param' });
    }
    if (!projectRoot) {
      return res.status(503).json({ error: 'No active workspace' });
    }

    let globalCss = '';
    try {
      const globalCssPath = path.join(projectRoot, 'ai', 'settings', 'themes.css');
      globalCss = await fsPromises.readFile(globalCssPath, 'utf8');
    } catch {
      globalCss = '';
    }

    let viewCss = '';
    try {
      const viewCssPath = path.join(projectRoot, 'ai', 'views', viewName, 'settings', 'themes.css');
      viewCss = await fsPromises.readFile(viewCssPath, 'utf8');
    } catch {
      viewCss = '';
    }

    const viewStateService = require('./lib/view-state');
    const layout = await viewStateService.resolveViewState(projectRoot, viewName);

    res.json({ globalCss, viewCss, layout });
  } catch (err) {
    console.error('[ViewConfig] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index.html for SPA routing
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Store active sessions (ws -> session state)
const sessions = new Map();

// ============================================================================
// Project Root & Path Resolution
// ============================================================================

/**
 * Resolve the project root for a given connection, or the server-wide
 * active workspace root when no connection context is available.
 *
 * Returns null when no workspace is active (empty state). Callers must
 * handle null — boot pipeline skips, per-connection handlers send an error.
 *
 * @param {import('ws').WebSocket} [ws] - connection context (optional)
 * @returns {string|null}
 */
function getProjectRoot(ws) {
  if (ws) {
    const session = sessions.get(ws);
    if (session && session.projectRoot) return session.projectRoot;
  }
  const active = workspaceController.getActiveWorkspaceSync();
  return active ? active.repo_path : null;
}

// ============================================================================
// File Explorer Functions (unchanged from original)
// ============================================================================

const sessionRoots = new Map();

function setSessionRoot(ws, panel, rootFolder) {
  sessionRoots.set(ws, { panel, rootFolder });
  console.log(`[Session] Panel '${panel}' root set to: ${rootFolder}`);
}

function getSessionRoot(ws, panel) {
  const sessionRoot = sessionRoots.get(ws);
  if (sessionRoot && sessionRoot.panel === panel && sessionRoot.rootFolder) {
    return sessionRoot.rootFolder;
  }
  // Per-connection projectRoot is the only source of truth; null = empty state.
  const connSession = sessions.get(ws);
  return (connSession && connSession.projectRoot) || null;
}

function clearSessionRoot(ws) {
  sessionRoots.delete(ws);
}

function getPanelPath(panel, ws) {
  const projectRoot = getProjectRoot(ws);
  if (!projectRoot) return null;

  // __panels__ pseudo-panel: resolves to ai/views/ (for client discovery)
  if (panel === '__panels__') {
    const viewsRoot = views.getViewsRoot(projectRoot);
    if (fs.existsSync(viewsRoot)) return viewsRoot;
    return null;
  }

  // __apps__ pseudo-panel: resolves to ai/apps/ (for client app discovery)
  if (panel === '__apps__') {
    const appsRoot = path.join(projectRoot, 'ai', 'apps');
    if (fs.existsSync(appsRoot)) return appsRoot;
    return null;
  }

  // __settings__ pseudo-panel: resolves to ai/settings/ (for global theme/settings)
  if (panel === '__settings__') {
    const settingsRoot = path.join(projectRoot, 'ai', 'settings');
    if (fs.existsSync(settingsRoot)) return settingsRoot;
    return null;
  }

  // Delegate to the view resolver system.
  // Each display type has its own resolver module that knows where
  // the content root is for that view type.
  const context = { sessionRoot: getSessionRoot(ws, panel) };
  const resolved = views.resolveContentPath(projectRoot, panel, context);
  if (resolved && fs.existsSync(resolved)) return resolved;

  // Fallback: raw ai/views/{id}/ folder (for views not yet in the system)
  const fallback = path.join(views.getViewsRoot(projectRoot), panel);
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

const fileExplorer = createFileExplorerHandlers({
  getPanelPath,
  getProjectRoot,
});

// ============================================================================
// Wire Process Functions
// ============================================================================

// NOTE: spawnThreadWire is now imported from ./lib/harness/compat
// The implementation has been moved to lib/harness/compat for external CLI harness support
// NOTE: sendToWire is now imported from ./lib/wire/process-manager

// ============================================================================
// WebSocket Connection Handler with Thread Support
// ============================================================================

wss.on('connection', async (ws) => {
  console.log('[WS] Client connected (thread-enabled)');

  const activeWs = workspaceController.getActiveWorkspaceSync();
  const projectRoot = activeWs ? activeWs.repo_path : null;
  const connectionId = generateId();

  // Session state
  const session = {
    connectionId,
    wire: null,
    currentTurn: null,
    buffer: '',
    toolArgs: {},
    activeToolId: null,
    hasToolCalls: false,
    currentThreadId: null,
    assistantParts: [],  // For exchange tracking (SQLite)
    contextUsage: null,  // Latest context usage from wire (0-1 decimal)
    tokenUsage: null,    // Latest token usage from wire
    messageId: null,     // OpenAI message ID from StatusUpdate
    planMode: false,     // Whether turn was in plan mode
    projectRoot,         // Mutable per-connection root; updated on workspace:switched. null when no active workspace.
    currentWorkspaceId: activeWs ? activeWs.id : null,
    currentViewId: null  // CHAT_SCOPE_SPEC: set when scope='view'
  };
  sessions.set(ws, session);

  // Per-connection workspace switch listener: every connection tracks the
  // server-wide active workspace and mirrors its repoPath into its own
  // session so subsequent router/file/thread operations resolve against
  // the new root. One-active-workspace-server-wide model (see plan §1).
  const unsubscribeWorkspaceSwitched = on('workspace:switched', (event) => {
    if (event && event.repoPath) {
      session.projectRoot = event.repoPath;
      session.currentWorkspaceId = event.to;
    }
  });
  ws.on('close', unsubscribeWorkspaceSwitched);
  
  // Set up a default panel so ThreadManager exists for wire spawning.
  // Don't send the thread list yet — wait for the client's set_panel message
  // to avoid cross-contamination (e.g., issues-viewer seeing code-viewer threads).
  // Only set up threads if the default view has chat (SPEC-24c: storage is
  // unified at ai/views/chat/threads/<user>/, no panelPath needed).
  if (projectRoot) {
    const defaultChatConfig = views.resolveChatConfig(projectRoot, 'file-viewer');
    if (defaultChatConfig) {
      ThreadWebSocketHandler.setPanel(ws, 'file-viewer', {
        projectRoot,
        viewName: 'file-viewer',
        workspaceId: activeWs ? activeWs.id : null,
      });
    }
  }
  
  // ==========================================================================
  // Wire Process Handlers
  // ==========================================================================

  // Per-connection wire message router (extracted per SPEC-01d).
  // Emits chat:* events to the bus (wire-broadcaster handles client
  // delivery); sends non-chat events directly via ws.
  const { handleMessage } = createWireMessageRouter({
    session,
    ws,
    threadWebSocketHandler: ThreadWebSocketHandler,
    emit,
    checkSettingsBounce,
  });

  // Per-connection wire lifecycle helpers.
  const { awaitHarnessReady, initializeWire, setupWireHandlers } = createWireLifecycle({
    session,
    ws,
    connectionId,
    onWireMessage: handleMessage,
  });

  // ==========================================================================
  // Client Message Router (SPEC-01f)
  // ==========================================================================
  //
  // Per-connection client message router. Depends on the wire lifecycle
  // and file explorer — must be created AFTER those factories.
  // fusionHandlers / clipboardHandlers are injected as getter closures to
  // preserve the mutable-reference pattern from SPEC-01b (the
  // module-level `let` bindings are reassigned inside the
  // startServer().then() callback).
  const { handleClientMessage, handleClientClose } = createClientMessageRouter({
    ws,
    session,
    connectionId,
    projectRoot,
    fileExplorer,
    wireLifecycle: { awaitHarnessReady, initializeWire, setupWireHandlers },
    sessions,
    setSessionRoot,
    clearSessionRoot,
    getProjectRoot,
    getFusionHandlers: () => fusionHandlers,
    getClipboardHandlers: () => clipboardHandlers,
    getThemeHandlers: () => themeHandlers,
    getSecretsHandlers: () => secretsHandlers,
  });

  ws.on('message', handleClientMessage);
  ws.on('close', handleClientClose);

  // ==========================================================================
  // Initial Messages
  // ==========================================================================

  ws.send(JSON.stringify({
    type: 'connected',
    connectionId,
    message: 'Thread-enabled connection established'
  }));

  // Send current workspace registry and active workspace so the client
  // can gate its UI (empty state, switcher) before panel discovery runs.
  try {
    const workspaces = await workspaceController.listWorkspaces();
    const activeWorkspaceId = workspaceController.getActiveWorkspaceId();
    const { resolveCliConfig } = require('./lib/cli-config');
    const activeRoot = getProjectRoot();
    const cliConfig = activeRoot ? await resolveCliConfig(activeRoot, null) : {};
    let themes = [];
    let activeThemeId = null;
    let styles = {};
    const stateCache = require('./lib/workspace/state-cache');
    const cachedStates = stateCache.loadAll();
    if (activeRoot) {
      try {
        const themesService = require('./lib/theme/themes-service');
        themes = await themesService.list(activeRoot);
        const active = themes.find(t => t.active);
        activeThemeId = active ? active.id : null;
      } catch (_) {}
      // Pre-read shared CSS layers so the client can inject synchronously
      const styleFiles = [
        'variables.css', 'themes.css', 'components.css', 'views.css',
        'file-viewer.css', 'doc-viewer.css', 'tints.css',
      ];
      const settingsDir = path.join(activeRoot, 'ai', 'settings');
      await Promise.all(
        styleFiles.map(async (file) => {
          try {
            const css = await fsPromises.readFile(path.join(settingsDir, file), 'utf8');
            styles[file] = css;
          } catch {
            styles[file] = '';
          }
        })
      );
    }
    const activeWs = workspaceController.getActiveWorkspaceSync();
    ws.send(JSON.stringify({
      type: 'workspace:init',
      workspaces,
      activeWorkspaceId,
      workspaceType: activeWs ? activeWs.type : 'code',
      homePath: require('os').homedir(),
      cliConfig,
      themes,
      activeThemeId,
      styles,
      cachedStates,
    }));
  } catch (err) {
    console.error('[WS] workspace:init failed:', err);
  }

  // Send project root info without assuming a panel — the client will
  // send set_panel to identify itself. When no workspace is active,
  // projectRoot is null and the client renders the empty state.
  ws.send(JSON.stringify({
    type: 'panel_config',
    projectRoot,
    projectName: projectRoot ? path.basename(projectRoot) : null
  }));
});


// ============================================================================
// Server Startup
// ============================================================================

// Module-level mutable handler references. Populated when startServer() resolves.
// The client message router (lib/ws/client-message-router.js) reads from these
// via getFusionHandlers / getClipboardHandlers getter closures injected into
// createClientMessageRouter. See SPEC-01b for the mutable-reference rationale.
let fusionHandlers = {};
let clipboardHandlers = {};
let themeHandlers = {};
let secretsHandlers = {};

startServer({
  server,
  sessions,
  getProjectRoot,
})
  .then(result => {
    fusionHandlers = result.fusionHandlers;
    clipboardHandlers = result.clipboardHandlers;
    themeHandlers = result.themeHandlers;
    secretsHandlers = result.secretsHandlers;
  })
  .catch(err => {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  });
