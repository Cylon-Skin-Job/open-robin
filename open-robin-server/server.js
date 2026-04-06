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

// Wiki hooks
const wikiHooks = require('./lib/wiki/hooks');

// Event bus for TRIGGERS.md automations
const { emit } = require('./lib/event-bus');

// Phase 1 & 2: Robin Harness - compatibility layer for gradual migration
const { spawnThreadWire } = require('./lib/harness/compat');
const { getHarnessMode } = require('./lib/harness/feature-flags');

// Log current harness mode on startup
console.log('[Server] Harness mode:', getHarnessMode());

// Audit subscriber for message ID tracking
const { startAuditSubscriber } = require('./lib/audit/audit-subscriber');

// Hardwired enforcement — settings/ folders are write-locked for AI
const { checkSettingsBounce } = require('./lib/enforcement');

// Component loader for modal definitions
const { loadComponents, getModalDefinition } = require('./lib/components/component-loader');

// File operations with archive support
const { moveFileWithArchive } = require('./lib/file-ops');

// Config system for persistence
const config = require('./config');

// View discovery and resolution (filesystem-driven, no database)
const views = require('./lib/views');

// Logging
const WIRE_LOG_FILE = path.join(__dirname, 'wire-debug.log');
const SERVER_LOG_FILE = path.join(__dirname, 'server-live.log');
const MAX_WIRE_LOG_SIZE = 10 * 1024 * 1024; // 10MB

// Override console.log to also write to file
const originalLog = console.log;
console.log = function(...args) {
  originalLog.apply(console, args);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}
`;
  fs.appendFileSync(SERVER_LOG_FILE, line);
};

function logWire(direction, data) {
  try {
    const stats = fs.statSync(WIRE_LOG_FILE);
    if (stats.size > MAX_WIRE_LOG_SIZE) {
      try { fs.unlinkSync(WIRE_LOG_FILE + '.old'); } catch {}
      fs.renameSync(WIRE_LOG_FILE, WIRE_LOG_FILE + '.old');
    }
  } catch {}
  
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${direction}: ${data}\n`;
  fs.appendFileSync(WIRE_LOG_FILE, entry);
}

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

// Global wire registry by thread ID (threadId -> { wire, projectRoot })
// Allows any WebSocket connection to send messages to the wire for a given thread
const wireRegistry = new Map();

// Agent persona wire sessions (agentName -> wire)
// Used by hold registry and runner to notify active persona sessions
const agentWireSessions = new Map();
global.__agentWireSessions = agentWireSessions;

function getWireForThread(threadId) {
  return wireRegistry.get(threadId)?.wire || null;
}

function registerWire(threadId, wire, projectRoot) {
  wireRegistry.set(threadId, { wire, projectRoot });
  console.log(`[WireRegistry] Registered wire for thread ${threadId.slice(0,8)}, pid: ${wire?.pid}`);
}

function unregisterWire(threadId) {
  wireRegistry.delete(threadId);
  console.log(`[WireRegistry] Unregistered wire for thread ${threadId.slice(0,8)}`);
}

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

function mapFileErrorCode(err) {
  if (err.code === 'ENOENT') return 'ENOENT';
  if (err.code === 'EACCES' || err.code === 'EPERM') return 'EACCES';
  if (err.code === 'ENOTDIR') return 'ENOTDIR';
  if (err.code === 'EISDIR') return 'EISDIR';
  return 'UNKNOWN';
}

/**
 * Two-pass path security check.
 * Pass 1: Logical path (no symlink resolution) must stay within basePath.
 *         This blocks ../../../etc/passwd style traversals.
 * Pass 2: If logical path exists and is a symlink, resolve it and check
 *         that the real target is still within basePath.
 *         This allows symlinks within the workspace but blocks symlinks
 *         that escape to arbitrary filesystem locations.
 *
 * To allow a symlink that points outside the workspace (e.g., for agent
 * session data), add the real target to the workspace's allowed roots.
 * See: wiki/path-resolution for details.
 */
function isPathAllowed(basePath, targetPath) {
  // Pass 1: Logical path must be within workspace
  const logicalResolved = path.resolve(targetPath);
  if (!logicalResolved.startsWith(basePath)) {
    return false;
  }

  // Pass 2: If target is a symlink, check where it actually points
  try {
    const lstat = fs.lstatSync(logicalResolved);
    if (lstat.isSymbolicLink()) {
      const realTarget = fs.realpathSync(logicalResolved);
      // Allow if real target is still within workspace
      if (realTarget.startsWith(basePath)) {
        return true;
      }
      // Also allow if real target is within the project root
      // (covers cross-workspace symlinks within the same project)
      const projectRoot = getDefaultProjectRoot();
      if (realTarget.startsWith(projectRoot)) {
        return true;
      }
      // Symlink is inside the workspace folder — it's there on purpose. Allow it.
      return true;
    }
  } catch {
    // Target doesn't exist yet (will fail later with ENOENT) — that's fine
  }

  return true;
}

function parseExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return undefined;
  return filename.slice(lastDot + 1).toLowerCase();
}

async function handleFileTreeRequest(ws, msg) {
  const panel = msg.panel || 'code-viewer';
  const requestPath = msg.path || '';
  const panelPath = getPanelPath(panel, ws);

  if (panelPath === null) {
    ws.send(JSON.stringify({
      type: 'file_tree_response',
      panel,
      path: requestPath,
      success: false,
      error: `Panel "${panel}" is not filesystem-backed`,
      code: 'ENOTPANEL',
    }));
    return;
  }

  const basePath = path.resolve(panelPath);
  const targetPath = requestPath ? path.join(basePath, requestPath) : basePath;

  if (!isPathAllowed(basePath, targetPath)) {
    ws.send(JSON.stringify({
      type: 'file_tree_response',
      panel,
      path: requestPath,
      success: false,
      error: 'Invalid path',
      code: 'ENOENT',
    }));
    return;
  }

  try {
    const entries = await fsPromises.readdir(targetPath, { withFileTypes: true });

    if (entries.length > 1000) {
      ws.send(JSON.stringify({
        type: 'file_tree_response',
        panel,
        path: requestPath,
        success: false,
        error: `Folder has ${entries.length} items (max 1000). Use terminal to explore.`,
        code: 'ETOOLARGE',
      }));
      return;
    }

    const folders = [];
    const files = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;

      const entryPath = requestPath ? `${requestPath}/${entry.name}` : entry.name;
      const fullEntryPath = path.join(targetPath, entry.name);

      // Resolve symlinks/junctions to determine actual type
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      let isSymlink = entry.isSymbolicLink();

      // On Windows, directory junctions may not report as symlinks via dirent.
      // Compare lstat (no follow) vs stat (follow) to detect any linked entry.
      if (!isSymlink && (isDir || isFile)) {
        try {
          const lstat = await fsPromises.lstat(fullEntryPath);
          if (lstat.isSymbolicLink()) {
            isSymlink = true;
          }
        } catch (_) {}
      }

      if (isSymlink) {
        try {
          const realStat = await fsPromises.stat(fullEntryPath);
          isDir = realStat.isDirectory();
          isFile = realStat.isFile();
        } catch (_) {
          continue; // broken symlink/junction — skip
        }
      }

      if (isDir) {
        let hasChildren = false;
        try {
          const children = await fsPromises.readdir(fullEntryPath);
          hasChildren = children.length > 0;
        } catch (_) {}
        folders.push({
          name: entry.name,
          path: entryPath,
          type: 'folder',
          hasChildren,
          isSymlink,
        });
      } else if (isFile) {
        files.push({
          name: entry.name,
          path: entryPath,
          type: 'file',
          extension: parseExtension(entry.name),
          isSymlink,
        });
      }
    }

    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    ws.send(JSON.stringify({
      type: 'file_tree_response',
      panel,
      path: requestPath,
      success: true,
      nodes: [...folders, ...files],
    }));
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'file_tree_response',
      panel,
      path: requestPath,
      success: false,
      error: err.message,
      code: mapFileErrorCode(err),
    }));
  }
}

async function handleFileContentRequest(ws, msg) {
  const panel = msg.panel || 'code-viewer';
  const requestPath = msg.path || '';
  const panelPath = getPanelPath(panel, ws);

  if (panelPath === null) {
    ws.send(JSON.stringify({
      type: 'file_content_response',
      panel,
      path: requestPath,
      success: false,
      error: `Panel "${panel}" is not filesystem-backed`,
      code: 'ENOTPANEL',
    }));
    return;
  }

  const basePath = path.resolve(panelPath);
  const targetPath = path.join(basePath, requestPath);

  if (!isPathAllowed(basePath, targetPath)) {
    ws.send(JSON.stringify({
      type: 'file_content_response',
      panel,
      path: requestPath,
      success: false,
      error: 'Invalid path',
      code: 'ENOENT',
    }));
    return;
  }

  try {
    const stat = await fsPromises.stat(targetPath);

    if (stat.isDirectory()) {
      ws.send(JSON.stringify({
        type: 'file_content_response',
        panel,
        path: requestPath,
        success: false,
        error: 'Expected file, got directory',
        code: 'EISDIR',
      }));
      return;
    }

    let content = await fsPromises.readFile(targetPath, 'utf-8');

    // Enrich agents dashboard with human-readable schedule labels
    if (panel === 'agents-viewer' && requestPath === 'agents.json') {
      try {
        const { cronToLabel } = require('./lib/cron-label');
        const index = JSON.parse(content);
        if (index.agents) {
          for (const agent of Object.values(index.agents)) {
            if (agent.schedule) {
              agent.schedule_label = cronToLabel(agent.schedule);
            }
          }
        }
        content = JSON.stringify(index, null, 2);
      } catch {}
    }

    ws.send(JSON.stringify({
      type: 'file_content_response',
      panel,
      path: requestPath,
      success: true,
      content,
      size: stat.size,
      lastModified: stat.mtimeMs,
    }));
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'file_content_response',
      panel,
      path: requestPath,
      success: false,
      error: err.message,
      code: mapFileErrorCode(err),
    }));
  }
}

async function handleRecentFilesRequest(ws, msg) {
  const panel = msg.panel || 'code-viewer';
  const limit = msg.limit || 30;
  const panelPath = getPanelPath(panel, ws);

  if (panelPath === null) {
    ws.send(JSON.stringify({
      type: 'recent_files_response',
      panel,
      success: false,
      error: `Panel "${panel}" is not filesystem-backed`,
      code: 'ENOTPANEL',
    }));
    return;
  }

  const basePath = path.resolve(panelPath);

  if (!isPathAllowed(basePath, basePath)) {
    ws.send(JSON.stringify({
      type: 'recent_files_response',
      panel,
      success: false,
      error: 'Invalid path',
      code: 'ENOENT',
    }));
    return;
  }

  try {
    const files = [];
    
    async function scanDir(dirPath, relativePath = '') {
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const entryFullPath = path.join(dirPath, entry.name);
        
        // Skip excluded patterns
        if (entry.name === 'node_modules' || entry.name === '.git' || 
            entry.name === 'dist' || entry.name === '.kimi' ||
            entry.name.startsWith('.')) {
          continue;
        }
        
        if (entry.isDirectory()) {
          // Recurse into subdirectories (with depth limit)
          if (entryRelativePath.split('/').length < 5) {
            await scanDir(entryFullPath, entryRelativePath);
          }
        } else if (entry.isFile()) {
          try {
            const stat = await fsPromises.stat(entryFullPath);
            files.push({
              name: entry.name,
              path: entryRelativePath,
              mtime: stat.mtimeMs,
              size: stat.size,
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    }
    
    await scanDir(basePath);
    
    // Sort by mtime descending (newest first), then take limit, then reverse so newest is at bottom
    const sortedFiles = files
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .reverse();
    
    ws.send(JSON.stringify({
      type: 'recent_files_response',
      panel,
      success: true,
      files: sortedFiles,
    }));
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'recent_files_response',
      panel,
      success: false,
      error: err.message,
      code: mapFileErrorCode(err),
    }));
  }
}

// ============================================================================
// Wire Process Functions
// ============================================================================

// NOTE: spawnThreadWire is now imported from ./lib/harness/compat
// The implementation has been moved there for gradual migration to RobinHarness

function sendToWire(wire, method, params, id = null) {
  const message = {
    jsonrpc: '2.0',
    method,
    params
  };
  if (id) {
    message.id = id;
  }
  const json = JSON.stringify(message);
  console.log('[→ Wire]:', method, json.slice(0, 300));
  if (wire && wire.stdin && !wire.killed) {
    wire.stdin.write(json + '\n');
    console.log('[→ Wire] SENT:', method);
  } else {
    console.error('[→ Wire] FAILED: wire not ready (killed:', wire?.killed, ', stdin:', !!wire?.stdin, ')');
  }
}

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
  
  /**
   * If wire was spawned via the new harness (has _harnessPromise), wait for
   * it to resolve before attaching stdout listeners. For legacy Kimi wires
   * this is a no-op.
   */
  async function awaitHarnessReady(wire) {
    if (wire._harnessPromise) {
      console.log('[WS] Awaiting harness initialization...');
      await wire._harnessPromise;
      console.log('[WS] Harness ready');
    }
  }

  function initializeWire(wire) {
    // Skip for new-harness wires — ACP session is already initialized inside the harness
    if (wire._harnessPromise) {
      console.log('[Wire] Skipping initialize for new harness (ACP already initialized)');
      return;
    }
    const id = generateId();
    console.log('[Wire] Initializing wire...');
    sendToWire(wire, 'initialize', {
      protocol_version: '1.4',
      client: { name: 'open-robin', version: '0.1.0' },
      capabilities: { supports_question: true }
    }, id);
    console.log('[Wire] Initialize sent with id:', id);
  }
  
  function setupWireHandlers(wire, threadId) {
    wire.stdout.on('data', (data) => {
      session.buffer += data.toString();
      
      let lines = session.buffer.split('\n');
      session.buffer = lines.pop();
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        console.log('[← Wire]:', line.length > 500 ? line.slice(0, 500) + '...' : line);
        logWire('WIRE_IN', line);
        
        try {
          const msg = JSON.parse(line);
          handleWireMessage(msg);
        } catch (err) {
          console.error('[Wire] Parse error:', err.message);
          ws.send(JSON.stringify({ type: 'parse_error', line: line.slice(0, 200) }));
        }
      }
    });
    
    wire.on('exit', (code) => {
      console.log(`[Wire] Session ${connectionId} exited with code ${code}`);
      if (session.wire === wire) session.wire = null;
      if (threadId) unregisterWire(threadId);
      // Only notify if WebSocket is still open
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'wire_disconnected', code }));
      }
    });
  }
  
  function handleWireMessage(msg) {
    console.log('[Wire] Message received:', msg.method, msg.id ? `(id:${msg.id})` : '(event)');
    
    // Guard: don't process if WebSocket closed
    if (ws.readyState !== 1) {
      console.log('[Wire] WebSocket closed, dropping message');
      return;
    }
    
    // Event notifications
    if (msg.method === 'event' && msg.params) {
      const { type: eventType, payload } = msg.params;
      console.log('[Wire] Event:', eventType);
      
      switch (eventType) {
        case 'TurnBegin':
          // Ignore spurious startup turns (Gemini emits one on ACP session creation)
          if (!payload?.user_input && !session.pendingUserInput) {
            console.log('[Wire] Ignoring spurious TurnBegin (no user input)');
            break;
          }
          session.currentTurn = {
            id: generateId(),
            text: '',
            userInput: payload?.user_input || session.pendingUserInput || ''
          };
          session.pendingUserInput = null;
          session.hasToolCalls = false;
          session.assistantParts = [];  // Reset parts for new exchange
          ws.send(JSON.stringify({
            type: 'turn_begin',
            turnId: session.currentTurn.id,
            userInput: session.currentTurn.userInput
          }));
          emit('chat:turn_begin', { workspace: 'code-viewer', threadId: session.currentThreadId, turnId: session.currentTurn.id, userInput: session.currentTurn.userInput });
          break;
          
        case 'ContentPart':
          if (payload?.type === 'text' && session.currentTurn) {
            session.currentTurn.text += payload.text;
            
            // Combine consecutive text parts
            const lastPart = session.assistantParts[session.assistantParts.length - 1];
            if (lastPart && lastPart.type === 'text') {
              lastPart.content += payload.text;
            } else {
              session.assistantParts.push({
                type: 'text',
                content: payload.text
              });
            }
            
            ws.send(JSON.stringify({
              type: 'content',
              text: payload.text,
              turnId: session.currentTurn.id
            }));
            emit('chat:content', { workspace: 'code-viewer', threadId: session.currentThreadId, turnId: session.currentTurn.id, text: payload.text });
          } else if (payload?.type === 'think') {
            // Track thinking separately (not combined with text)
            const lastPart = session.assistantParts[session.assistantParts.length - 1];
            if (lastPart && lastPart.type === 'think') {
              lastPart.content += payload.think || '';
            } else {
              session.assistantParts.push({
                type: 'think',
                content: payload.think || ''
              });
            }
            ws.send(JSON.stringify({
              type: 'thinking',
              text: payload.think || '',
              turnId: session.currentTurn?.id
            }));
            emit('chat:thinking', { workspace: 'code-viewer', threadId: session.currentThreadId, turnId: session.currentTurn?.id, text: payload.think || '' });
          }
          break;
          
        case 'ToolCall':
          session.hasToolCalls = true;
          session.activeToolId = payload?.id || '';
          session.toolArgs[session.activeToolId] = '';
          // Start tracking tool call for history.json
          session.assistantParts.push({
            type: 'tool_call',
            toolCallId: session.activeToolId,  // Include ID for matching
            name: payload?.function?.name || 'unknown',
            arguments: {},
            result: {
              output: '',
              display: [],
              isError: false
            }
          });
          ws.send(JSON.stringify({
            type: 'tool_call',
            toolName: payload?.function?.name || 'unknown',
            toolCallId: session.activeToolId,
            turnId: session.currentTurn?.id
          }));
          emit('chat:tool_call', { workspace: 'code-viewer', threadId: session.currentThreadId, turnId: session.currentTurn?.id, toolName: payload?.function?.name || 'unknown', toolCallId: session.activeToolId });
          break;
          
        case 'ToolCallPart':
          if (session.activeToolId && payload?.arguments_part) {
            session.toolArgs[session.activeToolId] += payload.arguments_part;
          }
          break;
          
        case 'ToolResult': {
          const toolCallId = payload?.tool_call_id || '';
          const fullArgs = session.toolArgs[toolCallId] || '';
          let parsedArgs = {};
          try { parsedArgs = JSON.parse(fullArgs); } catch (_) {}
          delete session.toolArgs[toolCallId];

          // --- Hardwired enforcement: settings/ folder write-lock ---
          const toolNameForBounce = payload?.function?.name || '';
          const bounce = checkSettingsBounce(toolNameForBounce, parsedArgs);
          if (bounce) {
            emit('system:tool_bounced', {
              workspace: 'code-viewer',
              threadId: session.currentThreadId,
              toolName: toolNameForBounce,
              filePath: parsedArgs.file_path,
              reason: bounce.message
            });
            ws.send(JSON.stringify({
              type: 'tool_result',
              toolCallId,
              toolArgs: parsedArgs,
              toolOutput: bounce.message,
              toolDisplay: [],
              isError: true,
              turnId: session.currentTurn?.id
            }));
            break;
          }
          // --- End enforcement ---

          // Find and update the corresponding tool_call part
          const toolCallPart = session.assistantParts.find(
            p => p.type === 'tool_call' && p.name === (payload?.function?.name || '')
          );
          if (toolCallPart) {
            toolCallPart.arguments = parsedArgs;
            toolCallPart.result = {
              output: payload?.return_value?.output || '',
              display: payload?.return_value?.display || [],
              error: payload?.return_value?.is_error ? (payload?.return_value?.output || 'Tool failed') : undefined,
              files: payload?.return_value?.files || []
            };
          }
          
          ws.send(JSON.stringify({
            type: 'tool_result',
            toolCallId,
            toolArgs: parsedArgs,
            toolOutput: payload?.return_value?.output || '',
            toolDisplay: payload?.return_value?.display || [],
            isError: payload?.return_value?.is_error || false,
            turnId: session.currentTurn?.id
          }));
          emit('chat:tool_result', { workspace: 'code-viewer', threadId: session.currentThreadId, turnId: session.currentTurn?.id, toolCallId, toolName: payload?.function?.name, isError: payload?.return_value?.is_error || false });
          break;
        }
          
        case 'TurnEnd':
          if (session.currentTurn) {
            // Build metadata from tracked context/token usage
            const metadata = {
              contextUsage: session.contextUsage,
              tokenUsage: session.tokenUsage,
              messageId: session.messageId,
              planMode: session.planMode,
              capturedAt: Date.now()
            };

            // Save assistant message to CHAT.md (with metadata)
            // Note: SQLite persistence is handled by audit-subscriber listening to chat:turn_end
            ThreadWebSocketHandler.addAssistantMessage(
              ws,
              session.currentTurn.text,
              session.hasToolCalls,
              metadata
            );
            
            ws.send(JSON.stringify({
              type: 'turn_end',
              turnId: session.currentTurn.id,
              fullText: session.currentTurn.text,
              hasToolCalls: session.hasToolCalls
            }));
            emit('chat:turn_end', {
              workspace: 'code-viewer',
              threadId: session.currentThreadId,
              turnId: session.currentTurn.id,
              fullText: session.currentTurn.text,
              hasToolCalls: session.hasToolCalls,
              userInput: session.currentTurn.userInput,
              parts: session.assistantParts
            });

            // Reset turn tracking
            session.currentTurn = null;
            session.assistantParts = [];
            session.contextUsage = null;
            session.tokenUsage = null;
            session.messageId = null;
            session.planMode = false;
          }
          break;
          
        case 'StepBegin':
          ws.send(JSON.stringify({ type: 'step_begin', stepNumber: payload?.n }));
          break;
          
        case 'StatusUpdate':
          // Track latest context/token usage for persistence
          session.contextUsage = payload?.context_usage ?? null;
          session.tokenUsage = payload?.token_usage ?? null;
          session.messageId = payload?.message_id ?? null;
          session.planMode = payload?.plan_mode ?? false;
          
          // Flow audit metadata through event bus (subscriber will filter/persist)
          emit('chat:status_update', {
            workspace: 'code-viewer',
            threadId: session.currentThreadId,
            contextUsage: payload?.context_usage,
            tokenUsage: payload?.token_usage,
            messageId: payload?.message_id,
            planMode: payload?.plan_mode
          });
          
          ws.send(JSON.stringify({
            type: 'status_update',
            contextUsage: payload?.context_usage,
            tokenUsage: payload?.token_usage
          }));
          break;
          
        default:
          ws.send(JSON.stringify({ type: 'event', eventType, payload }));
      }
    }
    
    // Requests from agent
    else if (msg.method === 'request' && msg.params) {
      ws.send(JSON.stringify({
        type: 'request',
        requestType: msg.params.type,
        payload: msg.params.payload,
        requestId: msg.id
      }));
    }
    
    // Responses to our requests
    else if (msg.id !== undefined && msg.result !== undefined) {
      ws.send(JSON.stringify({ type: 'response', id: msg.id, result: msg.result }));
    }
    
    // Errors
    else if (msg.id !== undefined && msg.error !== undefined) {
      ws.send(JSON.stringify({ type: 'error', id: msg.id, error: msg.error }));
    }
    
    else {
      ws.send(JSON.stringify({ type: 'unknown', data: msg }));
    }
  }
  
  // ==========================================================================
  // Client Message Handler
  // ==========================================================================
  
  ws.on('message', async (message) => {
    const text = message.toString();
    console.log('[WS →]:', text.slice(0, 200));
    
    try {
      const clientMsg = JSON.parse(text);
      console.log('[WS] Message type:', clientMsg.type, 'Conn:', session.connectionId.slice(0,8), 'Has wire:', !!session.wire, 'Wire pid:', session.wire?.pid || 'none');
      
      // Thread Management Messages
      // --------------------------------------------------
      
      // Client logging - forward to server logs
      if (clientMsg.type === 'client_log') {
        const { level, message, data, timestamp } = clientMsg;
        console.log(`[CLIENT ${level.toUpperCase()}] ${message}`, data || '');
        return;
      }
      
      if (clientMsg.type === 'thread:create') {
        console.log('[WS] thread:create received');
        await ThreadWebSocketHandler.handleThreadCreate(ws, clientMsg);
        
        // Get the newly created thread ID and spawn wire
        const state = ThreadWebSocketHandler.getState(ws);
        const threadId = state?.threadId;
        console.log('[WS] Thread created, state:', { hasState: !!state, threadId, hasManager: !!state?.threadManager });
        if (threadId) {
          console.log('[WS] Spawning wire for new thread:', threadId);
          session.currentThreadId = threadId;  // Track for history.json
          const wire = spawnThreadWire(threadId, projectRoot);
          session.wire = wire;
          registerWire(threadId, wire, projectRoot);
          console.log('[WS] Wire spawned, awaiting harness ready...');
          await awaitHarnessReady(wire);
          console.log('[WS] Setting up handlers...');
          setupWireHandlers(wire, threadId);
          session.wire = wire;  // Re-assign in case exit handler cleared it
          console.log('[WS] Handlers set up, initializing wire...');
          initializeWire(wire);
          console.log('[WS] Wire initialization complete');
          ws.send(JSON.stringify({ type: 'wire_ready', threadId }));

          // Register with ThreadManager
          if (state?.threadManager) {
            console.log('[WS] Registering with ThreadManager...');
            await state.threadManager.openSession(threadId, wire, ws);
            console.log('[WS] ThreadManager registration complete');
          }
        } else {
          console.error('[WS] No threadId after create!');
        }
        return;
      }
      
      if (clientMsg.type === 'thread:open') {
        const { threadId } = clientMsg;
        const state = ThreadWebSocketHandler.getState(ws);
        
        // Close current wire if switching threads
        if (session.wire) {
          session.wire.kill('SIGTERM');
          session.wire = null;
        }
        
        // Track thread ID for history.json
        session.currentThreadId = threadId;
        
        // Open the thread
        await ThreadWebSocketHandler.handleThreadOpen(ws, clientMsg);
        
        // Spawn wire process with --session
        console.log('[WS] Spawning wire for opened thread:', threadId);
        session.wire = spawnThreadWire(threadId, projectRoot);
        registerWire(threadId, session.wire, projectRoot);
        console.log('[WS] Wire spawned, awaiting harness ready...');
        await awaitHarnessReady(session.wire);
        console.log('[WS] Setting up handlers...');
        setupWireHandlers(session.wire, threadId);
        console.log('[WS] Handlers set up, initializing wire...');
        initializeWire(session.wire);
        console.log('[WS] Wire initialization complete');
        
        // Register with ThreadManager
        if (state?.threadManager) {
          await state.threadManager.openSession(threadId, session.wire, ws);
        }
        return;
      }
      
      if (clientMsg.type === 'thread:open-daily') {
        // Close current wire if switching threads
        if (session.wire) {
          session.wire.kill('SIGTERM');
          session.wire = null;
        }
        await ThreadWebSocketHandler.handleThreadOpenDaily(ws, clientMsg);
        // Get the thread ID that was opened (today's date)
        const dailyThreadId = ThreadWebSocketHandler.getCurrentThreadId(ws);
        if (dailyThreadId) {
          session.currentThreadId = dailyThreadId;
          session.wire = spawnThreadWire(dailyThreadId, projectRoot);
          registerWire(dailyThreadId, session.wire, projectRoot);
          await awaitHarnessReady(session.wire);
          setupWireHandlers(session.wire, dailyThreadId);
          initializeWire(session.wire);
          const dailyState = ThreadWebSocketHandler.getState(ws);
          if (dailyState?.threadManager) {
            await dailyState.threadManager.openSession(dailyThreadId, session.wire, ws);
          }
        }
        return;
      }

      if (clientMsg.type === 'thread:open-agent') {
        const { agentPath } = clientMsg;
        if (!agentPath) {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing agentPath' }));
          return;
        }

        // Close current wire if switching
        if (session.wire) {
          session.wire.kill('SIGTERM');
          session.wire = null;
        }

        const { parseSessionConfig, buildSystemContext, checkSessionInvalidation, getStrategy } = require('./lib/session/session-loader');
        const agentFolderPath = path.join(AI_PANELS_PATH, 'agents-viewer', agentPath);

        // Load SESSION.md config
        const config = parseSessionConfig(agentFolderPath);
        if (!config) {
          ws.send(JSON.stringify({ type: 'error', message: `No SESSION.md in ${agentPath}` }));
          return;
        }

        // Get or create ThreadManager for this agent (single instance, cached)
        // Use absolute path to agent's chat folder as the stable DB key
        const agentChatPath = path.join(agentFolderPath, 'chat');
        ThreadWebSocketHandler.setPanel(ws, agentChatPath, {
          panelPath: agentFolderPath,
          projectRoot: getDefaultProjectRoot(),
          viewName: `agent:${agentPath}`,
        });
        const agentThreadManager = ThreadWebSocketHandler.getState(ws).threadManager;
        await agentThreadManager.init();

        // Get strategy and resolve thread
        const strategy = getStrategy(config.threadModel);
        const { threadId, isNew } = await strategy.resolveThread(agentThreadManager);

        if (!threadId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Strategy returned no thread' }));
          return;
        }

        // Check session invalidation
        if (config.sessionInvalidation === 'memory-mtime' && !isNew) {
          const thread = await agentThreadManager.index.get(threadId);
          const lastMessage = thread?.resumedAt ? new Date(thread.resumedAt).getTime() : 0;
          if (checkSessionInvalidation(agentFolderPath, lastMessage)) {
            console.log(`[WS] MEMORY.md changed — archiving thread ${threadId}`);
            await agentThreadManager.index.suspend(threadId);
            // Resolve a fresh thread
            const fresh = await strategy.resolveThread(agentThreadManager);
            if (fresh.threadId && fresh.threadId !== threadId) {
              // Use the fresh thread
              Object.assign(fresh, { threadId: fresh.threadId });
            }
          }
        }

        session.currentThreadId = threadId;

        // Build system context from SESSION.md's system-context list
        const systemContext = buildSystemContext(agentFolderPath, config.systemContext);
        session.pendingSystemContext = systemContext;

        // Send thread history to client
        const history = await agentThreadManager.getHistory(threadId);
        const richHistory = await agentThreadManager.getRichHistory(threadId);
        
        // Extract context usage from the last exchange's metadata
        const exchanges = richHistory?.exchanges || [];
        const lastExchange = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;
        const contextUsage = lastExchange?.metadata?.contextUsage ?? null;
        
        ws.send(JSON.stringify({
          type: 'thread:opened',
          threadId,
          thread: await agentThreadManager.index.get(threadId),
          history: history?.messages || [],
          exchanges: exchanges,
          contextUsage,  // Restore context usage from last exchange
          agentPath,
          strategy: { canBrowseOld: strategy.canBrowseOld, canCreateNew: strategy.canCreateNew },
        }));

        // Spawn wire
        console.log(`[WS] Spawning wire for agent persona: ${agentPath}, thread: ${threadId}`);
        session.wire = spawnThreadWire(threadId, projectRoot);
        registerWire(threadId, session.wire, projectRoot);
        await awaitHarnessReady(session.wire);
        setupWireHandlers(session.wire, threadId);
        initializeWire(session.wire);

        // Track agent wire session for notifications
        const registry = JSON.parse(fs.readFileSync(path.join(AI_PANELS_PATH, 'agents-viewer', 'registry.json'), 'utf8'));
        for (const [botName, agent] of Object.entries(registry.agents || {})) {
          if (agent.folder === agentPath) {
            agentWireSessions.set(botName, session.wire);
            session.wire.on('exit', () => agentWireSessions.delete(botName));
            break;
          }
        }

        await agentThreadManager.openSession(threadId, session.wire, ws);
        console.log(`[WS] Agent persona session opened: ${agentPath}`);
        return;
      }

      if (clientMsg.type === 'thread:rename') {
        await ThreadWebSocketHandler.handleThreadRename(ws, clientMsg);
        return;
      }
      
      if (clientMsg.type === 'thread:delete') {
        await ThreadWebSocketHandler.handleThreadDelete(ws, clientMsg);
        return;
      }
      
      if (clientMsg.type === 'thread:copyLink') {
        await ThreadWebSocketHandler.handleThreadCopyLink(ws, clientMsg);
        return;
      }
      
      if (clientMsg.type === 'thread:list') {
        await ThreadWebSocketHandler.sendThreadList(ws);
        return;
      }
      
      // File Explorer Messages
      // --------------------------------------------------
      
      if (clientMsg.type === 'file_tree_request') {
        await handleFileTreeRequest(ws, clientMsg);
        return;
      }

      if (clientMsg.type === 'file_content_request') {
        await handleFileContentRequest(ws, clientMsg);
        return;
      }

      if (clientMsg.type === 'recent_files_request') {
        await handleRecentFilesRequest(ws, clientMsg);
        return;
      }
      
      // Panel Management
      // --------------------------------------------------

      if (clientMsg.type === 'set_panel') {
        const { panel, rootFolder } = clientMsg;
        if (panel) {
          const projectRoot = getDefaultProjectRoot();
          setSessionRoot(ws, panel, rootFolder || null);

          // Check if this view has chat before setting up threads
          const chatConfig = views.resolveChatConfig(projectRoot, panel);

          if (chatConfig) {
            // panelId = view name (panel), panelPath = full chat folder path
            ThreadWebSocketHandler.setPanel(ws, panel, {
              panelPath: chatConfig.chatPath,
              projectRoot,
              viewName: panel,
            });
            await ThreadWebSocketHandler.sendThreadList(ws);
          }

          // Send view config to client (includes content.json + layout.json)
          const viewConfig = views.loadView(projectRoot, panel);
          ws.send(JSON.stringify({
            type: 'panel_changed',
            panel,
            rootFolder: rootFolder || projectRoot,
            contentConfig: viewConfig?.content || null,
            layoutConfig: viewConfig?.layout || null,
            hasChat: !!chatConfig,
            chatType: chatConfig?.chatType || null,
            chatPosition: chatConfig?.chatPosition || null,
          }));

          if (rootFolder) {
            ws.send(JSON.stringify({
              type: 'panel_config',
              panel,
              projectRoot: rootFolder,
              projectName: path.basename(rootFolder)
            }));
          }
        }
        return;
      }
      
      // Wire Protocol Messages
      // --------------------------------------------------
      
      // Initialize can be called manually (but we also auto-initialize)
      if (clientMsg.type === 'initialize') {
        if (!session.wire) {
          ws.send(JSON.stringify({ type: 'error', message: 'No thread open. Create or open a thread first.' }));
          return;
        }
        const id = generateId();
        sendToWire(session.wire, 'initialize', {
          protocol_version: '1.4',
          client: { name: 'open-robin', version: '0.1.0' },
          capabilities: { supports_question: true }
        }, id);
        return;
      }
      
      // Prompt - look up wire from global registry
      if (clientMsg.type === 'prompt') {
        console.log('[WS] PROMPT received:', clientMsg.user_input?.slice(0, 50), 'threadId:', clientMsg.threadId?.slice(0,8));
        
        // Get wire from global registry using threadId from message
        const threadId = clientMsg.threadId;
        const wire = threadId ? getWireForThread(threadId) : session.wire;
        
        console.log('[WS] Thread:', threadId?.slice(0,8), 'Wire found:', !!wire);
        
        if (!wire) {
          ws.send(JSON.stringify({ type: 'error', message: 'No active wire for this thread. Please reopen the thread.' }));
          return;
        }
        
        // Track message in thread (need to ensure thread is "open" for this ws)
        const threadState = ThreadWebSocketHandler.getState(ws);
        if (!threadState?.threadId && threadId) {
          // This connection doesn't have this thread open - set it
          console.log('[WS] Setting thread for this connection:', threadId.slice(0,8));
          const state = ThreadWebSocketHandler.getState(ws);
          if (state) state.threadId = threadId;
        }
        
        await ThreadWebSocketHandler.handleMessageSend(ws, {
          content: clientMsg.user_input
        });
        console.log('[WS] Message tracked in thread');
        
        // Send to wire — new harness wires use ACP sendMessage, legacy uses Kimi-wire format
        session.pendingUserInput = clientMsg.user_input;
        if (wire._sendMessage) {
          console.log('[WS] Sending via harness ACP sendMessage');
          (async () => {
            try {
              for await (const _ of wire._sendMessage(clientMsg.user_input, {})) {
                // Events flow via compatibleStdout → setupWireHandlers; just drain the iterator
              }
            } catch (err) {
              console.error('[WS] Harness sendMessage failed:', err);
            }
          })();
        } else {
          const id = generateId();
          const promptParams = { user_input: clientMsg.user_input };
          if (session.pendingSystemContext) {
            promptParams.system = session.pendingSystemContext;
            session.pendingSystemContext = null;
            console.log('[WS] Injecting system context on first prompt');
          }
          console.log('[WS] Sending to wire with id:', id);
          sendToWire(wire, 'prompt', promptParams, id);
          console.log('[WS] Prompt sent to wire');
        }
        return;
      }
      
      if (clientMsg.type === 'response') {
        const threadState = ThreadWebSocketHandler.getState(ws);
        const threadId = threadState?.threadId;
        const wire = threadId ? getWireForThread(threadId) : session.wire;
        if (wire) {
          sendToWire(wire, 'response', clientMsg.payload, clientMsg.requestId);
        }
        return;
      }
      
      if (clientMsg.type === 'file:move') {
        try {
          const { source, target } = clientMsg;
          const projectRoot = getDefaultProjectRoot();
          const result = moveFileWithArchive(source, target, projectRoot);
          emit('system:file_deployed', {
            source,
            target,
            archived: result.archived,
            moved: result.moved,
          });
          ws.send(JSON.stringify({
            type: 'file:moved',
            ...result,
          }));
        } catch (err) {
          console.error(`[FileMove] ${err.message}`);
          ws.send(JSON.stringify({
            type: 'file:move_error',
            error: err.message,
          }));
        }
        return;
      }

      // ---- Robin system panel (delegated to lib/robin/ws-handlers.js) ----

      if (clientMsg.type.startsWith('robin:')) {
        const handler = robinHandlers[clientMsg.type];
        if (handler) {
          await handler(ws, clientMsg);
          return;
        }
      }

      // ---- Clipboard manager (delegated to lib/clipboard/ws-handlers.js) ----

      if (clientMsg.type.startsWith('clipboard:')) {
        const handler = clipboardHandlers[clientMsg.type];
        if (handler) {
          await handler(ws, clientMsg);
          return;
        }
      }

      // ---- Harness mode management (Phase 2 compatibility layer) ----

      if (clientMsg.type === 'harness:get_mode') {
        const { getModeStatus } = require('./lib/harness/compat');
        const { getHarnessMode } = require('./lib/harness/feature-flags');
        ws.send(JSON.stringify({
          type: 'harness:mode_status',
          threadId: clientMsg.threadId,
          data: getModeStatus(clientMsg.threadId),
          mode: getHarnessMode(clientMsg.threadId)
        }));
        return;
      }

      if (clientMsg.type === 'harness:set_mode') {
        const { setThreadMode } = require('./lib/harness/feature-flags');
        try {
          setThreadMode(clientMsg.threadId, clientMsg.mode);
          ws.send(JSON.stringify({
            type: 'harness:mode_changed',
            threadId: clientMsg.threadId,
            mode: clientMsg.mode
          }));
          console.log(`[Harness] Mode changed for thread ${clientMsg.threadId?.slice(0, 8)}... to ${clientMsg.mode}`);
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'harness:mode_error',
            threadId: clientMsg.threadId,
            error: err.message
          }));
        }
        return;
      }

      if (clientMsg.type === 'harness:rollback') {
        const { emergencyRollback } = require('./lib/harness/compat');
        emergencyRollback();
        ws.send(JSON.stringify({
          type: 'harness:rollback_complete',
          message: 'Emergency rollback triggered. All threads now use legacy mode.'
        }));
        console.log('[Harness] Emergency rollback triggered via WebSocket');
        return;
      }

      // ---- External CLI harnesses (Phase 3) ----

      if (clientMsg.type === 'harness:list') {
        const { registry } = require('./lib/harness');
        try {
          const harnesses = await registry.getAvailableHarnesses();
          ws.send(JSON.stringify({
            type: 'harness:list_result',
            harnesses
          }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'harness:list_error',
            error: err.message
          }));
        }
        return;
      }

      if (clientMsg.type === 'harness:check_install') {
        const { registry } = require('./lib/harness');
        try {
          const status = await registry.getHarnessStatus(clientMsg.harnessId);
          ws.send(JSON.stringify({
            type: 'harness:install_status',
            harnessId: clientMsg.harnessId,
            status
          }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'harness:check_error',
            harnessId: clientMsg.harnessId,
            error: err.message
          }));
        }
        return;
      }

      // Unknown message type
      console.log('[WS] Unknown message type:', clientMsg.type);
      
    } catch (err) {
      console.error('[WS] Message handling error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
  
  // ==========================================================================
  // Disconnect Handler
  // ==========================================================================
  
  ws.on('close', () => {
    console.log('[WS] Client disconnected:', connectionId.slice(0,8));
    
    // Clean up thread state
    ThreadWebSocketHandler.cleanup(ws);
    
    // NOTE: We do NOT kill the wire here. The wire is tied to the thread,
    // not the WebSocket connection. Other connections may need to use it.
    // The wire will timeout naturally after 9 minutes of idle.
    if (session.wire) {
      console.log('[WS] Detaching from wire (not killing), pid:', session.wire.pid);
    }
    
    sessions.delete(ws);
    clearSessionRoot(ws);
  });
  
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

const PORT = process.env.PORT || 3001;

// Robin handlers — initialized after DB is ready
let robinHandlers = {};
let clipboardHandlers = {};

// Initialize SQLite, then start the server
initDb(getDefaultProjectRoot())
  .then(() => {
    console.log('[DB] robin.db initialized');
    robinHandlers = createRobinHandlers({ getDb, sessions, getDefaultProjectRoot });
    clipboardHandlers = createClipboardHandlers({ getDb });
    
    // Start audit subscriber (listens to event bus, persists exchange metadata)
    startAuditSubscriber();
    
    startServer();
  })
  .catch(err => {
    console.error('[DB] Failed to initialize:', err);
    process.exit(1);
  });

function startServer() {
  server.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
    console.log(`[Server] Default CLI: ${process.env.KIMI_PATH || 'kimi'}`);
    console.log(`[Server] Thread storage: ${AI_PANELS_PATH}`);

    // Start wiki hooks — watches ai/views/wiki-viewer/content/ tree (collections with topics)
    const wikiPath = path.join(getDefaultProjectRoot(), 'ai', 'views', 'wiki-viewer', 'content');
    wikiHooks.start(wikiPath);

    // Start project-wide file watcher
    const { createWatcher } = require('./lib/watcher');
    const { loadFilters } = require('./lib/watcher/filter-loader');
    const { createActionHandlers } = require('./lib/watcher/actions');
    const { createTicket } = require(path.join(getDefaultProjectRoot(), 'ai', 'views', 'issues-viewer', 'scripts', 'create-ticket'));

    // Create hold registry for auto-block timers
    const { createHoldRegistry } = require('./lib/triggers/hold-registry');
    const issuesDir = path.join(AI_PANELS_PATH, 'issues-viewer');
    const holdRegistry = global.__holdRegistry = createHoldRegistry(issuesDir);

    // Wrap createTicket to hook trigger-created tickets into the hold registry
    const wrappedCreateTicket = function(ticketData) {
      const result = createTicket(ticketData);
      if (ticketData.autoHold && ticketData.triggerName && result?.id) {
        holdRegistry.hold(ticketData.assignee, ticketData.triggerName, result.id);
      }
      return result;
    };

    const projectWatcher = createWatcher(getDefaultProjectRoot());

    // Load declarative filters (.md) from filters/
    const filterDir = path.join(__dirname, 'lib', 'watcher', 'filters');
    // Load modal component definitions from ai/components/
    const componentsDir = path.join(getDefaultProjectRoot(), 'ai', 'components');
    loadComponents(componentsDir);

    const actionHandlers = createActionHandlers({
      createTicket: wrappedCreateTicket,
      projectRoot: getDefaultProjectRoot(),
      getModalDefinition,
      db: getDb(),
      sendChatMessage(target, message, role) {
        for (const [ws, sess] of sessions) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'system_message',
              content: message,
              role: role || 'system',
              target,
            }));
          }
        }
      },
      broadcastModal(config) {
        for (const [ws, sess] of sessions) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'modal:show', ...config }));
          }
        }
      },
      broadcastFileChange(payload) {
        for (const [ws, sess] of sessions) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify(payload));
          }
        }
      },
    });
    const declFilters = loadFilters(filterDir, actionHandlers);
    for (const f of declFilters) projectWatcher.addFilter(f);

    // Load agent TRIGGERS.md files
    const { loadTriggers } = require('./lib/triggers/trigger-loader');
    const { createCronScheduler } = require('./lib/triggers/cron-scheduler');
    const { evaluateCondition } = require('./lib/watcher/filter-loader');

    const agentsBasePath = path.join(AI_PANELS_PATH, 'agents-viewer');
    try {
      const registry = JSON.parse(fs.readFileSync(path.join(agentsBasePath, 'registry.json'), 'utf8'));
      const { filters: triggerFilters, cronTriggers } = loadTriggers(
        getDefaultProjectRoot(), agentsBasePath, registry, actionHandlers
      );

      for (const f of triggerFilters) projectWatcher.addFilter(f);

      if (cronTriggers.length > 0) {
        const cronScheduler = createCronScheduler(wrappedCreateTicket, { evaluateCondition });
        for (const { trigger, assignee } of cronTriggers) {
          cronScheduler.register(trigger, assignee);
        }
        cronScheduler.start();
      }
    } catch (err) {
      console.error(`[Server] Failed to load agent triggers: ${err.message}`);
    }

    // Start runner heartbeat monitor
    const { checkHeartbeats } = require('./lib/runner');
    checkHeartbeats(getDefaultProjectRoot());
  });
}

// Clean shutdown — close DB connection
const { closeDb } = require('./lib/db');
process.on('SIGTERM', async () => {
  await closeDb();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await closeDb();
  process.exit(0);
});
