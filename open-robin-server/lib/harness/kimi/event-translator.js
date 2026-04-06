const { mapRobinToolName } = require('./tool-mapper');

/**
 * Translates Robin wire protocol events to canonical events.
 * 
 * This is the core transformation logic extracted from server.js:761-982.
 */
class EventTranslator {
  /**
   * @param {import('./session-state').KimiSessionState} state
   * @param {string} [model] - Model identifier (e.g. 'k2.5')
   */
  constructor(state, model) {
    this.state = state;
    this.model = model || null;
  }

  /**
   * Translate a wire message to canonical event(s).
   * Returns null if the message type is not handled.
   * @param {import('./wire-parser').WireMessage} msg
   * @returns {import('../types').CanonicalEvent | import('../types').CanonicalEvent[] | null}
   */
  translate(msg) {
    if (msg.method !== 'event' || !msg.params) {
      return null;
    }

    const { type: eventType, payload } = msg.params;
    const timestamp = Date.now();

    switch (eventType) {
      case 'TurnBegin':
        return this.handleTurnBegin(payload, timestamp);
      
      case 'ContentPart':
        return this.handleContentPart(payload, timestamp);
      
      case 'ToolCall':
        return this.handleToolCall(payload, timestamp);
      
      case 'ToolCallPart':
        return this.handleToolCallPart(payload, timestamp);
      
      case 'ToolResult':
        return this.handleToolResult(payload, timestamp);
      
      case 'TurnEnd':
        return this.handleTurnEnd(timestamp);
      
      case 'StatusUpdate':
        return this.handleStatusUpdate(payload);
      
      default:
        return null;
    }
  }

  /**
   * @param {Record<string, unknown> | undefined} payload
   * @param {number} timestamp
   * @returns {import('../types').TurnBeginEvent}
   */
  handleTurnBegin(payload, timestamp) {
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const userInput = String(payload?.user_input || '');

    this.state.resetTurn();
    this.state.currentTurn = {
      id: turnId,
      text: '',
      userInput
    };

    return {
      type: 'turn_begin',
      timestamp,
      turnId,
      userInput
    };
  }

  /**
   * @param {Record<string, unknown> | undefined} payload
   * @param {number} timestamp
   * @returns {import('../types').ContentEvent | import('../types').ThinkingEvent | null}
   */
  handleContentPart(payload, timestamp) {
    const contentType = payload?.type;

    if (contentType === 'text') {
      const text = String(payload?.text || '');
      if (this.state.currentTurn) {
        this.state.currentTurn.text += text;
      }
      this.state.addText(text);
      return { type: 'content', timestamp, text };
    }

    if (contentType === 'think') {
      const text = String(payload?.think || '');
      this.state.addThinking(text);
      return { type: 'thinking', timestamp, text };
    }

    return null;
  }

  /**
   * @param {Record<string, unknown> | undefined} payload
   * @param {number} timestamp
   * @returns {import('../types').ToolCallEvent}
   */
  handleToolCall(payload, timestamp) {
    const toolCallId = String(payload?.id || '');
    const robinToolName = String(payload?.function?.name || 'unknown');
    const toolName = mapRobinToolName(robinToolName);

    this.state.startToolCall(toolCallId, toolName);

    return {
      type: 'tool_call',
      timestamp,
      toolCallId,
      toolName
    };
  }

  /**
   * @param {Record<string, unknown> | undefined} payload
   * @param {number} timestamp
   * @returns {import('../types').ToolCallArgsEvent | null}
   */
  handleToolCallPart(payload, timestamp) {
    const toolCallId = this.state.activeToolId;
    const argsChunk = String(payload?.arguments_part || '');

    if (toolCallId && argsChunk) {
      this.state.addToolArgs(toolCallId, argsChunk);
      return {
        type: 'tool_call_args',
        timestamp,
        toolCallId,
        argsChunk
      };
    }

    return null;
  }

  /**
   * @param {Record<string, unknown> | undefined} payload
   * @param {number} timestamp
   * @returns {import('../types').ToolResultEvent}
   */
  handleToolResult(payload, timestamp) {
    const toolCallId = String(payload?.tool_call_id || '');
    const robinToolName = String(payload?.function?.name || 'unknown');
    const toolName = mapRobinToolName(robinToolName);
    const returnValue = payload?.return_value || {};

    this.state.completeToolCall(toolCallId, toolName, {
      output: String(returnValue.output || ''),
      display: returnValue.display || [],
      is_error: Boolean(returnValue.is_error),
      files: returnValue.files || []
    });

    return {
      type: 'tool_result',
      timestamp,
      toolCallId,
      toolName,
      output: String(returnValue.output || ''),
      display: returnValue.display || [],
      isError: Boolean(returnValue.is_error),
      files: returnValue.files || []
    };
  }

  /**
   * @param {number} timestamp
   * @returns {import('../types').TurnEndEvent | null}
   */
  handleTurnEnd(timestamp) {
    if (!this.state.currentTurn) {
      return null;
    }

    const turnId = this.state.currentTurn.id;
    const fullText = this.state.currentTurn.text;
    const hasToolCalls = this.state.hasToolCalls;

    const event = {
      type: 'turn_end',
      timestamp,
      turnId,
      fullText,
      hasToolCalls,
      _meta: {
        messageId: this.state.messageId || undefined,
        tokenUsage: this.state.tokenUsage || undefined,
        contextUsage: this.state.contextUsage || undefined,
        planMode: this.state.planMode,
        harnessId: 'kimi',
        provider: 'moonshot',
        model: this.model || 'k2.5'
      }
    };

    this.state.resetMetadata();
    // Note: state.resetTurn() is called on next TurnBegin

    return event;
  }

  /**
   * @param {Record<string, unknown> | undefined} payload
   * @returns {null}
   */
  handleStatusUpdate(payload) {
    // StatusUpdate doesn't emit a canonical event directly
    // Instead, it updates state for the next TurnEnd
    this.state.contextUsage = payload?.context_usage ?? null;
    this.state.tokenUsage = payload?.token_usage ?? null;
    this.state.messageId = String(payload?.message_id || '');
    this.state.planMode = Boolean(payload?.plan_mode);
    return null;
  }
}

module.exports = { EventTranslator };
