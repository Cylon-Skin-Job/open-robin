/**
 * Client Message Router — dispatches incoming WebSocket client messages.
 *
 * Extracted from server.js per SPEC-01f. Handles the client message
 * switch for thread lifecycle (open-assistant / rename / delete /
 * copyLink / list), file explorer (tree / content / recent), panel
 * management (set_panel), wire protocol (initialize / prompt /
 * response), file operations (file:move), robin system panel
 * (robin:*), clipboard (clipboard:*), and harness admin
 * (harness:get_mode / set_mode / rollback / list / check_install).
 *
 * Also handles ws.on('close') for per-connection cleanup.
 *
 * Per-connection factory. Called once per WebSocket connection inside
 * wss.on('connection'), after all the other factories have been
 * created (wire message router, wire lifecycle, file explorer).
 * Closes over ws, session, connectionId, projectRoot, and the
 * per-connection helpers.
 *
 * Architectural note: most of the handlers in this module are thin
 * delegations to already-extracted modules. The five harness:* admin
 * handlers keep their inline require() calls (only paid when the
 * rarely-used admin command arrives) rather than hoisting them to
 * module-level imports.
 */

const path = require('path');
const { v4: generateId } = require('uuid');

const { ThreadWebSocketHandler } = require('../thread');
const { spawnThreadWire } = require('../harness/compat');
const { registerWire, getWireForThread, sendToWire } = require('../wire/process-manager');
const views = require('../views');
const { moveFileWithArchive } = require('../file-ops');
const { emit } = require('../event-bus');

/**
 * Create a per-connection client message router.
 *
 * @param {object} deps
 * @param {import('ws').WebSocket} deps.ws
 * @param {object} deps.session - per-connection session state (mutated)
 * @param {string} deps.connectionId
 * @param {string} deps.projectRoot
 * @param {object} deps.fileExplorer - from createFileExplorerHandlers (01a)
 * @param {{ awaitHarnessReady: Function, initializeWire: Function, setupWireHandlers: Function }} deps.wireLifecycle - from createWireLifecycle (01c)
 * @param {Map} deps.sessions - server.js module-level sessions Map (for close handler)
 * @param {Function} deps.setSessionRoot
 * @param {Function} deps.clearSessionRoot
 * @param {() => string} deps.getDefaultProjectRoot
 * @param {() => object} deps.getRobinHandlers - getter closure over server.js let robinHandlers
 * @param {() => object} deps.getClipboardHandlers - getter closure over server.js let clipboardHandlers
 * @returns {{ handleClientMessage: Function, handleClientClose: Function }}
 */
function createClientMessageRouter({
  ws,
  session,
  connectionId,
  projectRoot,
  fileExplorer,
  wireLifecycle,
  sessions,
  setSessionRoot,
  clearSessionRoot,
  getDefaultProjectRoot,
  getRobinHandlers,
  getClipboardHandlers,
}) {

  const { awaitHarnessReady, initializeWire, setupWireHandlers } = wireLifecycle;

  async function handleClientMessage(message) {
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

      if (clientMsg.type === 'thread:open-assistant') {
        // SPEC-26b: extract scope early; used throughout this case to route
        // state access to the correct manager/thread. Defaults to 'view' for
        // backward compat with pre-26b clients.
        const scope = clientMsg.scope === 'project' ? 'project' : 'view';
        console.log('[WS] thread:open-assistant received, threadId:', clientMsg.threadId?.slice(0, 8) || '(new)', 'scope:', scope);

        // Close current wire if one is open (switching threads or reopening).
        // Single-wire model preserved in 26b — see SPEC. 26d adds dual-wire.
        if (session.wire) {
          console.log('[WS] Closing previous wire before opening assistant thread');
          session.wire.kill('SIGTERM');
          session.wire = null;
        }

        // Dispatcher: create or resume based on whether msg.threadId exists.
        await ThreadWebSocketHandler.handleThreadOpenAssistant(ws, clientMsg);

        // After the handler runs, the per-ws state should have the current
        // thread ID for the requested scope.
        const state = ThreadWebSocketHandler.getState(ws);
        const threadId = state?.threadIds?.[scope];
        if (!threadId) {
          console.error(`[WS] No threadId for scope=${scope} after handleThreadOpenAssistant — dispatch failed`);
          return;
        }

        console.log(`[WS] Spawning wire for ${scope} thread:`, threadId);
        session.currentThreadId = threadId;
        session.currentScope = scope;  // SPEC-26b: track which scope owns the active wire
        const wire = spawnThreadWire(threadId, projectRoot);
        session.wire = wire;
        registerWire(threadId, wire, projectRoot, ws);

        console.log('[WS] Wire spawned, awaiting harness ready...');
        await awaitHarnessReady(wire);
        console.log('[WS] Setting up handlers...');
        setupWireHandlers(wire, threadId);
        session.wire = wire;  // Re-assign in case exit handler cleared it
        console.log('[WS] Initializing wire...');
        initializeWire(wire);
        console.log('[WS] Wire initialization complete');

        // Fire wire_ready for BOTH create and resume — this harmonizes the two
        // paths (previously only thread:create sent it, which was a latent bug
        // in the resume flow: the connecting overlay would not clear).
        ws.send(JSON.stringify({ type: 'wire_ready', threadId, scope }));

        // Register with the scope-appropriate ThreadManager
        const manager = state?.threadManagers?.[scope];
        if (manager) {
          console.log('[WS] Registering with ThreadManager...');
          await manager.openSession(threadId, wire, ws);
          console.log('[WS] ThreadManager registration complete');
        }
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
        // SPEC-26b: forward optional scope field; sendThreadList defaults to 'view'.
        await ThreadWebSocketHandler.sendThreadList(ws, clientMsg.scope);
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
            ThreadWebSocketHandler.setPanel(ws, panel, {
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
        // SPEC-26b: scope comes from clientMsg or the session's active scope.
        const scope = clientMsg.scope === 'project' ? 'project' : (session.currentScope || 'view');
        console.log('[WS] PROMPT received:', clientMsg.user_input?.slice(0, 50), 'threadId:', clientMsg.threadId?.slice(0,8), 'scope:', scope);

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
        if (threadState && threadId && !threadState.threadIds?.[scope]) {
          // This connection doesn't have this thread open for this scope - set it
          console.log(`[WS] Setting ${scope} thread for this connection:`, threadId.slice(0,8));
          threadState.threadIds[scope] = threadId;
        }

        await ThreadWebSocketHandler.handleMessageSend(ws, {
          content: clientMsg.user_input,
          scope
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
        // SPEC-26b: scope-aware lookup of active thread for wire routing.
        const scope = session.currentScope || 'view';
        const threadState = ThreadWebSocketHandler.getState(ws);
        const threadId = threadState?.threadIds?.[scope];
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
        const handler = getRobinHandlers()[clientMsg.type];
        if (handler) {
          await handler(ws, clientMsg);
          return;
        }
      }

      // ---- Clipboard manager (delegated to lib/clipboard/ws-handlers.js) ----

      if (clientMsg.type.startsWith('clipboard:')) {
        const handler = getClipboardHandlers()[clientMsg.type];
        if (handler) {
          await handler(ws, clientMsg);
          return;
        }
      }

      // ---- Harness mode management (Phase 2 compatibility layer) ----

      if (clientMsg.type === 'harness:get_mode') {
        const { getModeStatus } = require('../harness/compat');
        const { getHarnessMode } = require('../harness/feature-flags');
        ws.send(JSON.stringify({
          type: 'harness:mode_status',
          threadId: clientMsg.threadId,
          data: getModeStatus(clientMsg.threadId),
          mode: getHarnessMode(clientMsg.threadId)
        }));
        return;
      }

      if (clientMsg.type === 'harness:set_mode') {
        const { setThreadMode } = require('../harness/feature-flags');
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
        const { emergencyRollback } = require('../harness/compat');
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
        const { registry } = require('../harness');
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
        const { registry } = require('../harness');
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
  }

  function handleClientClose() {
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
  }

  return { handleClientMessage, handleClientClose };
}

module.exports = { createClientMessageRouter };
