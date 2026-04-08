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

const fileExplorer = createFileExplorerHandlers({
  getPanelPath,
  getDefaultProjectRoot,
});

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
        await fileExplorer.handleFileTreeRequest(ws, clientMsg);
        return;
      }

      if (clientMsg.type === 'file_content_request') {
        await fileExplorer.handleFileContentRequest(ws, clientMsg);
        return;
      }

      if (clientMsg.type === 'recent_files_request') {
        await fileExplorer.handleRecentFilesRequest(ws, clientMsg);
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

// Module-level mutable handler references. Populated when startServer() resolves.
// The client message router (in the ws.on('message') handler) reads from these.
// See SPEC-01b for the mutable-reference pattern rationale.
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
