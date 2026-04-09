/**
 * Kimi IDE Server with Thread Management
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

// Robin system panel
const createRobinHandlers = require('./lib/robin/ws-handlers');

// Clipboard manager
const createClipboardHandlers = require('./lib/clipboard/ws-handlers');

// File explorer handlers
const { createFileExplorerHandlers } = require('./lib/file-explorer');

// Wiki hooks
const wikiHooks = require('./lib/wiki/hooks');

// Event bus for TRIGGERS.md automations
const { emit } = require('./lib/event-bus');

// Phase 1 & 2: Robin Harness - compatibility layer for gradual migration
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
const clientDistPath = path.join(__dirname, '..', 'open-robin-client', 'dist');
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
  const dirPath = path.join(getDefaultProjectRoot(), 'ai', 'views', panel, path.dirname(filePath));
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
  const { registry } = require('./lib/harness');
  try {
    const harnesses = await registry.getAvailableHarnesses();
    res.json(harnesses);
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

// Fallback to index.html for SPA routing
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Store active sessions (ws -> session state)
const sessions = new Map();

// ============================================================================
// Project Root & Path Resolution
// ============================================================================

function getDefaultProjectRoot() {
  const cfg = config.getConfig();
  if (cfg.lastProject && fs.existsSync(cfg.lastProject)) {
    return path.resolve(cfg.lastProject);
  }
  return path.resolve(path.join(__dirname, '..'));
}

// AI panels path for thread storage
// Relative to PROJECT ROOT (not server directory)
// This allows the IDE to work with any project, not just kimi-claude
const AI_PANELS_PATH = path.join(getDefaultProjectRoot(), 'ai', 'views');
console.log(`[Server] AI views path: ${AI_PANELS_PATH}`);

// ============================================================================
// File Explorer Functions (unchanged from original)
// ============================================================================

const sessionRoots = new Map();

function setSessionRoot(ws, panel, rootFolder) {
  sessionRoots.set(ws, { panel, rootFolder });
  console.log(`[Session] Panel '${panel}' root set to: ${rootFolder}`);
}

function getSessionRoot(ws, panel) {
  const session = sessionRoots.get(ws);
  if (session && session.panel === panel && session.rootFolder) {
    return session.rootFolder;
  }
  return getDefaultProjectRoot();
}

function clearSessionRoot(ws) {
  sessionRoots.delete(ws);
}

function getPanelPath(panel, ws) {
  const projectRoot = getDefaultProjectRoot();

  // __panels__ pseudo-panel: resolves to ai/views/ (for client discovery)
  if (panel === '__panels__') {
    const viewsRoot = views.getViewsRoot(projectRoot);
    if (fs.existsSync(viewsRoot)) return viewsRoot;
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
  getDefaultProjectRoot,
});

// ============================================================================
// Wire Process Functions
// ============================================================================

// NOTE: spawnThreadWire is now imported from ./lib/harness/compat
// The implementation has been moved there for gradual migration to RobinHarness
// NOTE: sendToWire is now imported from ./lib/wire/process-manager

// ============================================================================
// WebSocket Connection Handler with Thread Support
// ============================================================================

wss.on('connection', (ws) => {
  console.log('[WS] Client connected (thread-enabled)');
  
  const projectRoot = getDefaultProjectRoot();
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
    planMode: false      // Whether turn was in plan mode
  };
  sessions.set(ws, session);
  
  // Set up a default panel so ThreadManager exists for wire spawning.
  // Don't send the thread list yet — wait for the client's set_panel message
  // to avoid cross-contamination (e.g., issues-viewer seeing code-viewer threads).
  // Only set up threads if the default view has chat.
  // panelId = view name ('code-viewer'), panelPath = absolute chat folder path
  const defaultChatConfig = views.resolveChatConfig(projectRoot, 'code-viewer');
  if (defaultChatConfig) {
    // panelId = view name ('code-viewer'), panelPath = full chat folder path
    ThreadWebSocketHandler.setPanel(ws, 'code-viewer', {
      panelPath: defaultChatConfig.chatPath,
      projectRoot,
      viewName: 'code-viewer',
    });
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
  // robinHandlers / clipboardHandlers are injected as getter closures to
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
    getDefaultProjectRoot,
    getRobinHandlers: () => robinHandlers,
    getClipboardHandlers: () => clipboardHandlers,
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

  // Send project root info without assuming a panel — the client will
  // send set_panel to identify itself.
  const initialProjectName = path.basename(projectRoot);
  ws.send(JSON.stringify({
    type: 'panel_config',
    projectRoot,
    projectName: initialProjectName
  }));
});


// ============================================================================
// Server Startup
// ============================================================================

// Module-level mutable handler references. Populated when startServer() resolves.
// The client message router (lib/ws/client-message-router.js) reads from these
// via getRobinHandlers / getClipboardHandlers getter closures injected into
// createClientMessageRouter. See SPEC-01b for the mutable-reference rationale.
let robinHandlers = {};
let clipboardHandlers = {};

startServer({
  server,
  sessions,
  getDefaultProjectRoot,
  AI_PANELS_PATH,
})
  .then(result => {
    robinHandlers = result.robinHandlers;
    clipboardHandlers = result.clipboardHandlers;
  })
  .catch(err => {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  });
