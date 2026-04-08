/**
 * SessionManager - Manages active wire sessions, idle timeouts, and LRU eviction
 *
 * Owns:
 * - activeSessions Map (threadId → ThreadSession)
 * - timeouts Map (threadId → timeout handle)
 * - maxActiveSessions / idleTimeoutMinutes config
 *
 * Does NOT know about ThreadIndex, ChatFile, or thread CRUD.
 * Accepts an onClose callback to notify the owner when a session closes.
 */

class SessionManager {
  /**
   * @param {object} [config]
   * @param {number} [config.maxActiveSessions]
   * @param {number} [config.idleTimeoutMinutes]
   * @param {function} [onClose] - Called with (threadId) when a session closes (explicit or timeout)
   */
  constructor(config = {}, onClose = null) {
    this.maxActiveSessions = config.maxActiveSessions ?? 10;
    this.idleTimeoutMinutes = config.idleTimeoutMinutes ?? 9;

    if (typeof this.idleTimeoutMinutes !== 'number' || this.idleTimeoutMinutes <= 0) {
      throw new Error(`idleTimeoutMinutes must be a positive number, got: ${config.idleTimeoutMinutes}`);
    }

    this._onClose = onClose;

    /** @type {Map<string, import('./types').ThreadSession>} */
    this.activeSessions = new Map();

    /** @type {Map<string, NodeJS.Timeout>} */
    this.timeouts = new Map();
  }

  /**
   * Register an active session
   * @param {string} threadId
   * @param {string} panelId
   * @param {import('child_process').ChildProcess} wireProcess
   * @param {import('ws').WebSocket} [ws]
   * @returns {import('./types').ThreadSession}
   */
  openSession(threadId, panelId, wireProcess, ws = null) {
    /** @type {import('./types').ThreadSession} */
    const session = {
      threadId,
      panelId,
      wireProcess,
      ws,
      lastActivity: Date.now(),
      state: 'active'
    };

    this.activeSessions.set(threadId, session);
    this._setIdleTimeout(threadId);

    return session;
  }

  /**
   * Close a session (kill process, remove from map, clear timeout)
   * @param {string} threadId
   * @returns {boolean} true if session existed and was closed
   */
  closeSession(threadId) {
    const session = this.activeSessions.get(threadId);
    if (!session) return false;

    this._clearIdleTimeout(threadId);

    if (session.wireProcess && !session.wireProcess.killed) {
      session.wireProcess.kill('SIGTERM');
    }

    this.activeSessions.delete(threadId);
    return true;
  }

  /**
   * Get active session
   * @param {string} threadId
   * @returns {import('./types').ThreadSession|undefined}
   */
  getSession(threadId) {
    return this.activeSessions.get(threadId);
  }

  /**
   * Update session activity (reset idle timer)
   * @param {string} threadId
   */
  touchSession(threadId) {
    const session = this.activeSessions.get(threadId);
    if (session) {
      session.lastActivity = Date.now();
      this._setIdleTimeout(threadId);
    }
  }

  /**
   * Update session WebSocket
   * @param {string} threadId
   * @param {import('ws').WebSocket} ws
   */
  attachWebSocket(threadId, ws) {
    const session = this.activeSessions.get(threadId);
    if (session) {
      session.ws = ws;
    }
  }

  /**
   * Remove WebSocket from session
   * @param {string} threadId
   */
  detachWebSocket(threadId) {
    const session = this.activeSessions.get(threadId);
    if (session) {
      session.ws = null;
    }
  }

  /**
   * Check if thread is currently active
   * @param {string} threadId
   * @returns {boolean}
   */
  isActive(threadId) {
    return this.activeSessions.has(threadId);
  }

  /**
   * Get count of active sessions
   * @returns {number}
   */
  getActiveSessionCount() {
    return this.activeSessions.size;
  }

  /**
   * Set idle timeout for a session
   * @private
   * @param {string} threadId
   */
  _setIdleTimeout(threadId) {
    this._clearIdleTimeout(threadId);

    const timeoutMs = this.idleTimeoutMinutes * 60 * 1000;
    const timeout = setTimeout(async () => {
      console.log(`[SessionManager] Idle timeout for ${threadId}`);
      this.closeSession(threadId);
      if (this._onClose) {
        await this._onClose(threadId);
      }
    }, timeoutMs);

    this.timeouts.set(threadId, timeout);
  }

  /**
   * Clear idle timeout for a session
   * @private
   * @param {string} threadId
   */
  _clearIdleTimeout(threadId) {
    const timeout = this.timeouts.get(threadId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(threadId);
    }
  }
}

module.exports = { SessionManager };
