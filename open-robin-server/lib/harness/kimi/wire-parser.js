const { EventEmitter } = require('events');

/**
 * @typedef {Object} WireMessage
 * @property {'2.0'} jsonrpc
 * @property {string} [method]
 * @property {string} [id]
 * @property {{type?: string, payload?: unknown}} [params]
 * @property {unknown} [result]
 * @property {{code: number, message: string}} [error]
 */

/**
 * Parses newline-delimited JSON-RPC from Robin CLI.
 * 
 * Mirrors current behavior in server.js:714-734 exactly.
 */
class WireParser extends EventEmitter {
  constructor() {
    super();
    this.buffer = '';
    this.lineCount = 0;
  }

  /**
   * Feed data from stdout into the parser.
   * Emits 'message' for each complete JSON-RPC message.
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
      } catch (err) {
        this.emit('parse_error', line, err, this.lineCount);
      }
    }
  }

  /**
   * Get any remaining buffered content.
   * Useful for debugging incomplete messages.
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
}

module.exports = { WireParser };
