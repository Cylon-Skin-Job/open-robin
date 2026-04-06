const { mapQwenToolName } = require('./tool-mapper');

/**
 * Translates ACP (Agent Client Protocol) events from Qwen CLI to canonical events.
 *
 * Qwen uses the same ACP protocol as Gemini (fork heritage), so the event
 * structure is identical. The differences are:
 * - Tool name mapping (handled by mapQwenToolName)
 * - Provider/model metadata in _meta
 * - Potentially different thinking chunk formats
 *
 * ACP is a JSON-RPC protocol used for IDE-agent communication.
 * @see https://agentclientprotocol.com/
 */
class QwenAcpEventTranslator {
  /**
   * @param {import('./session-state').QwenAcpSessionState} state
   */
  constructor(state) {
    this.state = state;
  }

  /**
   * Translate an ACP message to canonical event(s).
   * Returns null if the message type is not handled.
   * @param {import('./wire-parser').AcpMessage} msg
   * @returns {import('../../types').CanonicalEvent | import('../../types').CanonicalEvent[] | null}
   */
  translate(msg) {
    if (!msg || typeof msg !== 'object') {
      return null;
    }

    // Handle responses (result/error)
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      return this.translateResponse(msg);
    }

    // Handle notifications (session/update)
    if (msg.method === 'session/update' && msg.params) {
      return this.translateSessionUpdate(msg.params);
    }

    // Handle permission requests
    if (msg.method === 'session/request_permission') {
      return this.translatePermissionRequest(msg.params);
    }

    return null;
  }

  /**
   * Translate ACP responses (initialize, session/new, session/prompt, etc.)
   * @private
   */
  translateResponse(msg) {
    const timestamp = Date.now();

    // Handle errors
    if (msg.error) {
      return {
        type: 'turn_end',
        timestamp,
        turnId: this.state.currentTurn?.id || `turn-${timestamp}`,
        fullText: `Error: ${msg.error.message || 'Unknown error'}`,
        hasToolCalls: false,
        _meta: {
          error: true,
          errorCode: msg.error.code,
          errorMessage: msg.error.message,
          harnessId: 'qwen',
          provider: 'alibaba'
        }
      };
    }

    const result = msg.result;
    if (!result) return null;

    // session/new response - turn begins
    if (result.sessionId) {
      this.state.setSessionInfo(
        result.sessionId,
        result.models,
        result.modes?.currentModeId
      );

      const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      this.state.startTurn(turnId, '');

      return {
        type: 'turn_begin',
        timestamp,
        turnId,
        userInput: ''
      };
    }

    // session/prompt response - turn ends
    if (result.stopReason) {
      this.state.setStopReason(result.stopReason);
      this.state.setTokenUsage(result._meta?.quota);

      const turnId = this.state.currentTurn?.id || `turn-${timestamp}`;
      const fullText = this.state.getFullText();
      const hasToolCalls = this.state.hasToolCalls;

      const event = {
        type: 'turn_end',
        timestamp,
        turnId,
        fullText,
        hasToolCalls,
        _meta: {
          stopReason: result.stopReason,
          tokenUsage: this.state.inputTokens && this.state.outputTokens ? {
            input_other: this.state.inputTokens,
            output: this.state.outputTokens
          } : undefined,
          modelUsage: this.state.modelUsage,
          harnessId: 'qwen',
          provider: 'alibaba',
          model: this.state.currentModel,
          sessionId: this.state.sessionId
        }
      };

      this.state.resetTurn();
      return event;
    }

    return null;
  }

  /**
   * Translate session/update notifications
   * @private
   */
  translateSessionUpdate(params) {
    const update = params.update;
    if (!update) return null;

    const timestamp = Date.now();
    const sessionUpdateType = update.sessionUpdate || update.type;

    switch (sessionUpdateType) {
      case 'agent_message_chunk':
        return this.translateAgentMessageChunk(update, timestamp);

      case 'agent_thought_chunk':
        return this.translateAgentThoughtChunk(update, timestamp);

      case 'tool_call':
        return this.translateToolCall(update, timestamp);

      case 'tool_call_update':
        return this.translateToolCallUpdate(update, timestamp);

      case 'user_message_chunk':
        // User message - not emitted as canonical event
        return null;

      case 'available_commands_update':
      case 'session_info_update':
      case 'current_mode_update':
      case 'config_option_update':
      case 'plan':
        // Metadata updates - not emitted as canonical events
        return null;

      default:
        // Unknown update type — could be logged for debugging
        return null;
    }
  }

  /**
   * Translate agent message content chunks
   * @private
   */
  translateAgentMessageChunk(update, timestamp) {
    const content = update.content;
    if (!content) return null;

    // Handle text content
    if (content.type === 'text' && content.text) {
      const text = content.text;
      this.state.addText(text);

      return {
        type: 'content',
        timestamp,
        text,
        turnId: this.state.currentTurn?.id
      };
    }

    return null;
  }

  /**
   * Translate agent thought chunks (thinking/reasoning)
   * @private
   */
  translateAgentThoughtChunk(update, timestamp) {
    const content = update.content;
    if (!content || content.type !== 'text') return null;

    const text = content.text || '';
    this.state.addThinking(text);

    return {
      type: 'thinking',
      timestamp,
      text,
      turnId: this.state.currentTurn?.id
    };
  }

  /**
   * Translate tool call initiation
   * @private
   */
  translateToolCall(update, timestamp) {
    const toolCallId = update.toolCallId || update.id;
    const toolName = mapQwenToolName(update.toolName || update.name || 'unknown');
    const title = update.title || toolName;

    // Try to extract raw input from content if available
    let rawInput = null;
    if (update.rawInput) {
      rawInput = typeof update.rawInput === 'string'
        ? update.rawInput
        : JSON.stringify(update.rawInput);
    }

    this.state.startToolCall(toolCallId, toolName, title, rawInput);

    // Emit tool_call event
    const toolCallEvent = {
      type: 'tool_call',
      timestamp,
      toolCallId,
      toolName,
      turnId: this.state.currentTurn?.id
    };

    // If we have raw input, also emit tool_call_args
    if (rawInput) {
      return [
        toolCallEvent,
        {
          type: 'tool_call_args',
          timestamp,
          toolCallId,
          argsChunk: rawInput,
          turnId: this.state.currentTurn?.id
        }
      ];
    }

    return toolCallEvent;
  }

  /**
   * Translate tool call updates (completion, errors)
   * @private
   */
  translateToolCallUpdate(update, timestamp) {
    const toolCallId = update.toolCallId || update.id;
    const status = update.status;

    // Get the pending tool call info
    const pendingTool = this.state.getPendingToolCall(toolCallId);
    const toolName = pendingTool?.toolName || 'unknown';

    // Extract output and error info
    let output = '';
    let isError = false;

    if (status === 'completed') {
      output = this.extractToolOutput(update);
    } else if (status === 'failed' || status === 'error') {
      isError = true;
      output = update.error?.message || update.message || 'Tool execution failed';
    }

    this.state.completeToolCall(toolCallId, output, isError);

    return {
      type: 'tool_result',
      timestamp,
      toolCallId,
      toolName,
      output,
      display: [],
      isError,
      turnId: this.state.currentTurn?.id
    };
  }

  /**
   * Translate permission requests
   * @private
   */
  translatePermissionRequest(params) {
    // Permission requests are handled internally by the CLI in yolo mode
    return null;
  }

  /**
   * Extract tool output from various formats
   * @private
   */
  extractToolOutput(update) {
    if (update.content && Array.isArray(update.content)) {
      return update.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('');
    }

    if (update.output) {
      return typeof update.output === 'string'
        ? update.output
        : JSON.stringify(update.output);
    }

    if (update.result) {
      return typeof update.result === 'string'
        ? update.result
        : JSON.stringify(update.result);
    }

    return '';
  }
}

module.exports = { QwenAcpEventTranslator };
