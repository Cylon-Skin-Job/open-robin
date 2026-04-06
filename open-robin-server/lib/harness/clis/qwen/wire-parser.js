const { EventEmitter } = require('events');

/**
 * @typedef {Object} AcpMessage
 * @property {'2.0'} jsonrpc
 * @property {string} [method]
 * @property {string|number} [id]
 * @property {unknown} [params]
 * @property {unknown} [result]
 * @property {{code: number, message: string, data?: unknown}} [error]
 */

/**
 * Parses ACP (Agent Client Protocol) JSON-RPC messages.
 *
 * Qwen Code CLI uses the same ACP protocol as Gemini CLI (fork heritage).
 * This is identical to Gemini's AcpWireParser — we keep it separate for
 * potential future divergence, but currently delegates to the same logic.
 *
 * ACP is newline-delimited JSON-RPC 2.0 over stdio.
 * @see https://agentclientprotocol.com/
 */
class QwenAcpWireParser extends EventEmitter {
  constructor() {
    super();
    this.buffer = '';
    this.lineCount = 0;
  }

  /**
   * Feed data from stdout into the parser.
   * Emits 'message' for each complete JSON-RPC message.
   * Emits 'response' for agent->client responses (has id, has result/error).
   * Emits 'request' for client->agent requests (has id, no result/error).
   * Emits 'notification' for server notifications (no id).
   * Emits 'parse_error' for invalid JSON.
   * @param {string} data
   */
  feed(data) {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      this.lineCount++;
      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line);
        this.emit('message', msg);

        // Classify message type
        if (msg.id !== undefined) {
          if (msg.result !== undefined || msg.error !== undefined) {
            this.emit('response', msg);
          } else {
            this.emit('request', msg);
          }
        } else if (msg.method) {
          this.emit('notification', msg);
        }
      } catch (err) {
        this.emit('parse_error', line, err, this.lineCount);
      }
    }
  }

  /**
   * Get any remaining buffered content.
   * @returns {string}
   */
  getBuffer() {
    return this.buffer;
  }

  /**
   * Clear the buffer.
   */
  clear() {
    this.buffer = '';
    this.lineCount = 0;
  }

  /**
   * Process any remaining buffer content.
   * Call this when the stream ends to handle trailing data.
   */
  flush() {
    if (this.buffer.trim()) {
      this.lineCount++;
      try {
        const msg = JSON.parse(this.buffer);
        this.emit('message', msg);

        if (msg.id !== undefined) {
          if (msg.result !== undefined || msg.error !== undefined) {
            this.emit('response', msg);
          } else {
            this.emit('request', msg);
          }
        } else if (msg.method) {
          this.emit('notification', msg);
        }
      } catch (err) {
        this.emit('parse_error', this.buffer, err, this.lineCount);
      }
      this.buffer = '';
    }
  }
}

module.exports = { QwenAcpWireParser };
