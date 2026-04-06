/**
 * @typedef {Object} PendingToolCall
 * @property {string} toolCallId
 * @property {string} toolName
 * @property {string} argsBuffer
 */

/**
 * @typedef {Object} AssistantPart
 * @property {'text' | 'think' | 'tool_call'} type
 * @property {string} [content]
 * @property {string} [toolCallId]
 * @property {string} [name]
 * @property {Record<string, unknown>} [arguments]
 * @property {{output: string, display: unknown[], error?: string, files?: string[]}} [result]
 */

/**
 * @typedef {Object} CurrentTurn
 * @property {string} id
 * @property {string} text
 * @property {string} userInput
 */

/**
 * Session state for a single thread.
 * Mirrors server.js:666-680 exactly.
 */
class KimiSessionState {
  constructor() {
    /** @type {CurrentTurn | null} */
    this.currentTurn = null;
    /** @type {AssistantPart[]} */
    this.assistantParts = [];
    /** @type {Record<string, string>} */
    this.toolArgs = {};
    /** @type {string | null} */
    this.activeToolId = null;
    this.hasToolCalls = false;
    
    // Metadata accumulation
    /** @type {number | null} */
    this.contextUsage = null;
    /** @type {{input_other?: number, input_cache_read?: number, input_cache_creation?: number, output?: number} | null} */
    this.tokenUsage = null;
    /** @type {string | null} */
    this.messageId = null;
    this.planMode = false;
  }

  /**
   * Reset for a new turn
   */
  resetTurn() {
    this.currentTurn = null;
    this.assistantParts = [];
    this.toolArgs = {};
    this.activeToolId = null;
    this.hasToolCalls = false;
    // Note: contextUsage, tokenUsage, messageId, planMode are reset on TurnEnd
  }

  /**
   * Reset metadata (called after TurnEnd)
   */
  resetMetadata() {
    this.contextUsage = null;
    this.tokenUsage = null;
    this.messageId = null;
    this.planMode = false;
  }

  /**
   * Accumulate text content
   * @param {string} text
   */
  addText(text) {
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
   */
  startToolCall(toolCallId, toolName) {
    this.hasToolCalls = true;
    this.activeToolId = toolCallId;
    this.toolArgs[toolCallId] = '';
    this.assistantParts.push({
      type: 'tool_call',
      toolCallId,
      name: toolName,
      arguments: {},
      result: { output: '', display: [] }
    });
  }

  /**
   * Accumulate tool call arguments
   * @param {string} toolCallId
   * @param {string} argsChunk
   */
  addToolArgs(toolCallId, argsChunk) {
    if (this.toolArgs[toolCallId] !== undefined) {
      this.toolArgs[toolCallId] += argsChunk;
    }
  }

  /**
   * Complete a tool call with result
   * @param {string} toolCallId
   * @param {string} toolName
   * @param {{output: string, display: unknown[], is_error?: boolean, files?: string[]}} result
   */
  completeToolCall(toolCallId, toolName, result) {
    const toolPart = this.assistantParts.find(
      p => p.type === 'tool_call' && p.name === toolName
    );
    
    if (toolPart) {
      try {
        toolPart.arguments = JSON.parse(this.toolArgs[toolCallId] || '{}');
      } catch {
        toolPart.arguments = {};
      }
      toolPart.result = {
        output: result.output,
        display: result.display,
        error: result.is_error ? result.output : undefined,
        files: result.files
      };
    }
    
    delete this.toolArgs[toolCallId];
  }
}

module.exports = { KimiSessionState };
