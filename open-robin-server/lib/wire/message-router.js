/**
 * Wire Message Router — per-connection router for wire protocol messages.
 *
 * Extracted from server.js per SPEC-01d. Handles the 10-case event switch
 * (TurnBegin, ContentPart, ToolCall, ToolCallPart, ToolResult, TurnEnd,
 * StepBegin, StatusUpdate, default), plus the four non-event fallthroughs
 * (request, response result, response error, unknown).
 *
 * Chat events (turn_begin, content, thinking, tool_call, tool_result,
 * turn_end, status_update) are emitted to the event bus only — the
 * wire-broadcaster in lib/wire/wire-broadcaster.js subscribes and handles
 * client fan-out via threadId routing through wireRegistry.
 *
 * Non-chat events (step_begin, request, response, error, unknown) are
 * sent directly to the injected ws. They are per-connection transport
 * messages and do not flow through the bus.
 *
 * Created once per WebSocket connection inside wss.on('connection').
 * Closes over the per-connection session and ws.
 *
 * SECURITY: checkSettingsBounce runs atomically inside the ToolResult
 * case. The bounce path now emits chat:tool_result (with isError: true)
 * so the broadcaster handles bounced tools uniformly — no more inline
 * ws.send in the bounce path.
 */

const { v4: generateId } = require('uuid');

/**
 * Create a per-connection wire message router.
 *
 * @param {object} deps
 * @param {object} deps.session - per-connection session state (mutated)
 * @param {import('ws').WebSocket} deps.ws - for non-chat direct sends
 * @param {object} deps.threadWebSocketHandler - for TurnEnd assistant-message persistence
 * @param {(type: string, payload: object) => void} deps.emit - event bus emit
 * @param {(toolName: string, args: object) => {message: string}|null} deps.checkSettingsBounce
 * @returns {{ handleMessage: (msg: object) => void }}
 */
function createWireMessageRouter({ session, ws, threadWebSocketHandler, emit, checkSettingsBounce }) {

  function handleMessage(msg) {
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
            // Emit chat:tool_result for bounced tools so the broadcaster
            // handles delivery uniformly. Same shape as a normal tool_result
            // but with isError=true and the bounce message as output.
            emit('chat:tool_result', {
              workspace: 'code-viewer',
              threadId: session.currentThreadId,
              turnId: session.currentTurn?.id,
              toolCallId,
              toolName: toolNameForBounce,
              toolArgs: parsedArgs,
              toolOutput: bounce.message,
              toolDisplay: [],
              isError: true
            });
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

          emit('chat:tool_result', {
            workspace: 'code-viewer',
            threadId: session.currentThreadId,
            turnId: session.currentTurn?.id,
            toolCallId,
            toolName: payload?.function?.name,
            toolArgs: parsedArgs,
            toolOutput: payload?.return_value?.output || '',
            toolDisplay: payload?.return_value?.display || [],
            isError: payload?.return_value?.is_error || false
          });
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
            threadWebSocketHandler.addAssistantMessage(
              ws,
              session.currentTurn.text,
              session.hasToolCalls,
              metadata
            );

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
          // Non-chat event — direct ws.send, not routed through the bus
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
          break;

        default:
          // Non-chat: unknown event type — forward raw to client
          ws.send(JSON.stringify({ type: 'event', eventType, payload }));
      }
    }

    // Non-chat: requests from agent
    else if (msg.method === 'request' && msg.params) {
      ws.send(JSON.stringify({
        type: 'request',
        requestType: msg.params.type,
        payload: msg.params.payload,
        requestId: msg.id
      }));
    }

    // Non-chat: responses to our requests
    else if (msg.id !== undefined && msg.result !== undefined) {
      ws.send(JSON.stringify({ type: 'response', id: msg.id, result: msg.result }));
    }

    // Non-chat: errors
    else if (msg.id !== undefined && msg.error !== undefined) {
      ws.send(JSON.stringify({ type: 'error', id: msg.id, error: msg.error }));
    }

    // Non-chat: unknown
    else {
      ws.send(JSON.stringify({ type: 'unknown', data: msg }));
    }
  }

  return { handleMessage };
}

module.exports = { createWireMessageRouter };
