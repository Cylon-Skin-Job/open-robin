const { mapClaudeToolName } = require('./tool-mapper');

/**
 * Translates ACP (Agent Client Protocol) events from Claude Code to canonical events.
 * 
 * Claude Code uses the ACP JSON-RPC protocol. This translator handles:
 * - agent_message_chunk -> content
 * - agent_thought_chunk -> thinking
 * - tool_call -> tool_call
 * - tool_call_update -> tool_result
 */
class ClaudeAcpEventTranslator {
  /**
   * @param {import('./session-state').ClaudeSessionState} state
   */
  constructor(state) {
    this.state = state;
  }

  /**
   * Translate an ACP message to canonical event(s).
   * @param {import('../gemini/acp-wire-parser').AcpMessage} msg
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

    return null;
  }

  /**
   * Translate ACP responses (initialize, session/new, session/prompt)
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
          harnessId: 'claude-code',
          provider: 'anthropic'
        }
      };
    }

    const result = msg.result;
    if (!result) return null;

    // session/new response - session established
    if (result.sessionId) {
      this.state.setSessionInfo(
        result.sessionId,
        result.models,
        result.modes?.currentModeId
      );
      
      // We don't start the turn yet - it starts on the first session/prompt
      return null;
    }

    // session/prompt response - turn ends
    if (result.stopReason) {
      this.state.setStopReason(result.stopReason);
      
      // Token usage is sometimes in _meta
      if (result._meta?.usage) {
        this.state.setTokenUsage(result._meta.usage);
      }
      
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
          harnessId: 'claude-code',
          provider: 'anthropic',
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
      
      default:
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
    const toolName = mapClaudeToolName(update.toolName || update.name || 'unknown');
    const title = update.title || toolName;
    
    let rawInput = null;
    if (update.rawInput) {
      rawInput = typeof update.rawInput === 'string' 
        ? update.rawInput 
        : JSON.stringify(update.rawInput);
    }

    this.state.startToolCall(toolCallId, toolName, title, rawInput);

    const toolCallEvent = {
      type: 'tool_call',
      timestamp,
      toolCallId,
      toolName,
      turnId: this.state.currentTurn?.id
    };

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
    
    const pendingTool = this.state.getPendingToolCall(toolCallId);
    const toolName = pendingTool?.toolName || 'unknown';
    
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
   * Extract tool output
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
    
    return '';
  }
}

module.exports = { ClaudeAcpEventTranslator };
