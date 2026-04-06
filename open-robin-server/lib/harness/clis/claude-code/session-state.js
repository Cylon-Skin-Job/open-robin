/**
 * @typedef {Object} PendingToolCall
 * @property {string} toolCallId
 * @property {string} toolName
 * @property {string} title
 * @property {string} [rawInput]
 */

/**
 * @typedef {Object} AssistantPart
 * @property {'text' | 'think' | 'tool_call'} type
 * @property {string} [content]
 * @property {string} [toolCallId]
 * @property {string} [name]
 * @property {Record<string, unknown>} [arguments]
 * @property {{output: string, isError: boolean}} [result]
 */

/**
 * @typedef {Object} CurrentTurn
 * @property {string} id
 * @property {string} text
 * @property {string} userInput
 */

/**
 * Session state for a single Claude Code ACP thread.
 * Tracks conversation state, tool calls, and content accumulation.
 */
class ClaudeSessionState {
  constructor() {
    /** @type {CurrentTurn | null} */
    this.currentTurn = null;
    /** @type {AssistantPart[]} */
    this.assistantParts = [];
    /** @type {Map<string, PendingToolCall>} */
    this.pendingToolCalls = new Map();
    /** @type {string | null} */
    this.activeToolId = null;
    this.hasToolCalls = false;
    
    // ACP-specific session metadata
    /** @type {string | null} */
    this.sessionId = null;
    /** @type {string | null} */
    this.currentModel = null;
    /** @type {string | null} */
    this.currentMode = null;
    
    // Token usage from final response
    /** @type {number | null} */
    this.inputTokens = null;
    /** @type {number | null} */
    this.outputTokens = null;
    
    // Stop reason
    /** @type {string | null} */
    this.stopReason = null;
  }

  /**
   * Initialize a new turn
   * @param {string} turnId
   * @param {string} userInput
   */
  startTurn(turnId, userInput) {
    this.currentTurn = {
      id: turnId,
      text: '',
      userInput
    };
    this.assistantParts = [];
    this.pendingToolCalls.clear();
    this.activeToolId = null;
    this.hasToolCalls = false;
    this.inputTokens = null;
    this.outputTokens = null;
    this.stopReason = null;
  }

  /**
   * Reset for a new turn
   */
  resetTurn() {
    this.currentTurn = null;
    this.assistantParts = [];
    this.pendingToolCalls.clear();
    this.activeToolId = null;
    this.hasToolCalls = false;
  }

  /**
   * Accumulate text content
   * @param {string} text
   */
  addText(text) {
    if (this.currentTurn) {
      this.currentTurn.text += text;
    }
    
    const lastPart = this.assistantParts[this.assistantParts.length - 1];
    if (lastPart?.type === 'text') {
      lastPart.content = (lastPart.content || '') + text;
    } else {
      this.assistantParts.push({ type: 'text', content: text });
    }
  }

  /**
   * Accumulate thinking content
   * @param {string} text
   */
  addThinking(text) {
    const lastPart = this.assistantParts[this.assistantParts.length - 1];
    if (lastPart?.type === 'think') {
      lastPart.content = (lastPart.content || '') + text;
    } else {
      this.assistantParts.push({ type: 'think', content: text });
    }
  }

  /**
   * Start tracking a tool call
   * @param {string} toolCallId
   * @param {string} toolName
   * @param {string} title
   * @param {string} [rawInput]
   */
  startToolCall(toolCallId, toolName, title, rawInput) {
    this.hasToolCalls = true;
    this.activeToolId = toolCallId;
    this.pendingToolCalls.set(toolCallId, {
      toolCallId,
      toolName,
      title,
      rawInput
    });
    this.assistantParts.push({
      type: 'tool_call',
      toolCallId,
      name: toolName,
      arguments: rawInput ? JSON.parse(rawInput || '{}') : {},
      result: { output: '', isError: false }
    });
  }

  /**
   * Complete a tool call with result
   * @param {string} toolCallId
   * @param {string} output
   * @param {boolean} isError
   */
  completeToolCall(toolCallId, output, isError = false) {
    const toolPart = this.assistantParts.find(
      p => p.type === 'tool_call' && p.toolCallId === toolCallId
    );
    
    if (toolPart) {
      toolPart.result = { output, isError };
    }
    
    this.pendingToolCalls.delete(toolCallId);
    if (this.activeToolId === toolCallId) {
      this.activeToolId = null;
    }
  }

  /**
   * Set session metadata from session/new response
   * @param {string} sessionId
   * @param {Object} [models]
   * @param {string} [currentMode]
   */
  setSessionInfo(sessionId, models, currentMode) {
    this.sessionId = sessionId;
    this.currentModel = models?.currentModelId || null;
    this.currentMode = currentMode || null;
  }

  /**
   * Set token usage from prompt response
   * @param {Object} usage
   * @param {number} usage.inputTokens
   * @param {number} usage.outputTokens
   */
  setTokenUsage(usage) {
    if (usage) {
      this.inputTokens = usage.inputTokens || null;
      this.outputTokens = usage.outputTokens || null;
    }
  }

  /**
   * Set the stop reason
   * @param {string} reason
   */
  setStopReason(reason) {
    this.stopReason = reason;
  }

  /**
   * Get the full accumulated text
   * @returns {string}
   */
  getFullText() {
    return this.currentTurn?.text || '';
  }

  /**
   * Check if there are pending tool calls
   * @returns {boolean}
   */
  hasPendingToolCalls() {
    return this.pendingToolCalls.size > 0;
  }

  /**
   * Get a pending tool call by ID
   * @param {string} toolCallId
   * @returns {PendingToolCall | undefined}
   */
  getPendingToolCall(toolCallId) {
    return this.pendingToolCalls.get(toolCallId);
  }
}

module.exports = { ClaudeSessionState };
