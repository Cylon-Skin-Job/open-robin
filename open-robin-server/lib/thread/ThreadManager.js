/**
 * ThreadManager - Main thread management orchestrator
 *
 * Combines ThreadIndex and ChatFile to provide full thread lifecycle management.
 * Delegates session management to SessionManager and auto-rename to AutoRename.
 * Handles session lifecycle: active → grace-period → suspended
 */

const path = require('path');
const { ThreadIndex } = require('./ThreadIndex');
const { ChatFile, getUsername } = require('./ChatFile');
const { HistoryFile } = require('./HistoryFile');
const { SessionManager } = require('./session-manager');
const { AutoRename } = require('./auto-rename');

// Default configuration
const DEFAULT_CONFIG = {
  maxActiveSessions: 10,
  idleTimeoutMinutes: 9
};

class ThreadManager {
  /**
   * @param {string} panelId - Panel identifier (e.g., 'code-viewer', 'agent:bot-name')
   * @param {object} [config]
   * @param {string} [config.panelPath] - Filesystem path for legacy ChatFile fallback
   * @param {string} [config.projectRoot] - Project root for per-user views path
   * @param {number} [config.maxActiveSessions]
   * @param {number} [config.idleTimeoutMinutes]
   */
  constructor(panelId, config = {}) {
    this.panelId = panelId;
    this.panelPath = config.panelPath || null;
    this.threadsDir = this.panelPath ? path.join(this.panelPath, 'threads') : null;
    this.projectRoot = config.projectRoot || null;
    this.config = { ...DEFAULT_CONFIG, ...config };

    /** @type {ThreadIndex} */
    this.index = new ThreadIndex(panelId);

    /** @type {SessionManager} */
    this.sessionManager = new SessionManager(
      {
        maxActiveSessions: this.config.maxActiveSessions,
        idleTimeoutMinutes: this.config.idleTimeoutMinutes
      },
      (threadId) => this.index.suspend(threadId)
    );

    /** @type {AutoRename} */
    this.autoRenamer = new AutoRename((threadId) => this.getHistory(threadId));
  }

  /**
   * Build the per-user views directory for chat markdown.
   * Returns null if projectRoot is not set (falls back to legacy UUID dirs).
   * @returns {string|null}
   */
  _getViewsDir() {
    if (!this.projectRoot) return null;
    // Use panelPath directly if available (it's already the chat folder path)
    if (this.panelPath) {
      return path.join(this.panelPath, 'threads', getUsername());
    }
    // Fallback: derive from panelId
    const workspace = this.panelId.startsWith('agent:') ? 'agents-viewer' : this.panelId;
    return path.join(this.projectRoot, 'ai', 'views', workspace, 'chat', 'threads', getUsername());
  }

  /**
   * Ensure the threads/index.json exists in the views directory.
   * @private
   */
  async _ensureThreadsIndex() {
    if (!this.projectRoot) return;
    // Use panelPath directly if available, otherwise derive from panelId
    const threadsDir = this.panelPath
      ? path.join(this.panelPath, 'threads')
      : path.join(this.projectRoot, 'ai', 'views', this.panelId.startsWith('agent:') ? 'agents-viewer' : this.panelId, 'chat', 'threads');
    const indexPath = path.join(threadsDir, 'index.json');
    const fs = require('fs').promises;
    try {
      await fs.access(indexPath);
    } catch {
      await fs.mkdir(threadsDir, { recursive: true });
      await fs.writeFile(indexPath, JSON.stringify({ sort: 'last-active', order: 'desc' }, null, 2));
    }
  }

  /**
   * Create a ChatFile for the given thread.
   * Uses per-user views path if projectRoot is set, otherwise legacy UUID dir.
   * @param {string} threadId
   * @param {string} threadName
   * @returns {ChatFile}
   */
  _createChatFile(threadId, threadName) {
    const viewsDir = this._getViewsDir();
    if (viewsDir) {
      return new ChatFile({ viewsDir, threadName });
    }
    if (this.threadsDir) {
      return new ChatFile(path.join(this.threadsDir, threadId));
    }
    return new ChatFile({ threadDir: null });
  }

  /**
   * Initialize the thread manager
   */
  async init() {
    await this.index.init();

    // On startup, mark all threads as suspended
    // (Kimi CLI processes would have been killed by 9min timeout)
    const threads = await this.index.list();
    for (const { threadId, entry } of threads) {
      if (entry.status === 'active') {
        await this.index.suspend(threadId);
      }
    }
  }

  /**
   * Create a new thread
   * @param {string} threadId - Thread ID (should be Kimi session ID)
   * @param {string} [name='New Chat']
   * @param {object} [options]
   * @param {string} [options.harnessId='kimi']
   * @param {object} [options.harnessConfig]
   * @returns {Promise<{threadId: string, entry: import('./types').ThreadEntry}>}
   */
  async createThread(threadId, name = 'New Chat', options = {}) {
    // Check for FIFO eviction
    await this._enforceSessionLimit();

    // Create index entry (SQLite)
    const entry = await this.index.create(threadId, name, options);

    // Create chat markdown file
    await this._ensureThreadsIndex();
    const chatFile = this._createChatFile(threadId, name);
    if (chatFile.filePath) {
      await chatFile.write(name, []);
    }

    return { threadId, entry };
  }

  /**
   * Get thread info
   * @param {string} threadId
   */
  async getThread(threadId) {
    const entry = await this.index.get(threadId);
    if (!entry) return null;

    // Get the chat file path for this thread
    const chatFile = this._createChatFile(threadId, entry.name);

    return { threadId, entry, filePath: chatFile.filePath };
  }

  /**
   * List all threads (MRU order)
   * @returns {Promise<Array<{threadId: string, entry: import('./types').ThreadEntry}>>}
   */
  async listThreads() {
    return this.index.list();
  }

  /**
   * Rename a thread
   * @param {string} threadId
   * @param {string} newName
   */
  async renameThread(threadId, newName) {
    const oldEntry = await this.index.get(threadId);
    if (!oldEntry) return null;

    const entry = await this.index.rename(threadId, newName);
    if (!entry) return null;

    // Update chat markdown: rename file + rewrite title
    const chatFile = this._createChatFile(threadId, oldEntry.name);
    if (chatFile.filePath) {
      if (chatFile.viewsDir) {
        // Views mode: rename the file, then rewrite with new title
        await chatFile.renameFile(newName);
      }
      const parsed = await chatFile.read();
      if (parsed) {
        await chatFile.write(newName, parsed.messages);
      }
    }

    return { threadId, entry };
  }

  /**
   * Delete a thread (hard delete)
   * @param {string} threadId
   */
  async deleteThread(threadId) {
    // Kill active session if any
    await this.closeSession(threadId);

    // Get entry before deleting (need name for file path)
    const entry = await this.index.get(threadId);

    // Remove from index (CASCADE deletes exchanges)
    const deleted = await this.index.delete(threadId);
    if (!deleted) return false;

    // Delete chat markdown file
    const fsPromises = require('fs').promises;
    if (entry) {
      const chatFile = this._createChatFile(threadId, entry.name);
      if (chatFile.filePath) {
        try {
          await fsPromises.rm(chatFile.filePath, { force: true });
        } catch (err) {
          console.error(`Failed to delete chat file for ${threadId}:`, err);
        }
      }
    }

    // Clean up legacy UUID directory if it exists
    if (this.threadsDir) {
      const threadPath = path.join(this.threadsDir, threadId);
      try {
        await fsPromises.rm(threadPath, { recursive: true, force: true });
      } catch {
        // Ignore — may not exist
      }
    }

    return true;
  }

  /**
   * Add a message to a thread
   * @param {string} threadId
   * @param {import('./types').ChatMessage} message
   */
  async addMessage(threadId, message) {
    const entry = await this.index.get(threadId);
    if (!entry) throw new Error(`Thread not found: ${threadId}`);

    // Append to chat markdown
    const chatFile = this._createChatFile(threadId, entry.name);
    if (chatFile.filePath) {
      await chatFile.appendMessage(entry.name, message);
    }

    // Update message count
    await this.index.incrementMessageCount(threadId);

    // Move to front of MRU
    await this.index.touch(threadId);

    return { threadId, messageCount: entry.messageCount + 1 };
  }

  /**
   * Add a message to a thread with metadata
   * @param {string} threadId
   * @param {import('./types').ChatMessage} message
   * @param {object} [metadata] - Optional metadata (contextUsage, tokenUsage, etc.)
   */
  async addMessageWithMetadata(threadId, message, metadata = null) {
    const entry = await this.index.get(threadId);
    if (!entry) throw new Error(`Thread not found: ${threadId}`);

    // Append to chat markdown (with metadata)
    const chatFile = this._createChatFile(threadId, entry.name);
    if (chatFile.filePath) {
      const messageWithMetadata = metadata ? { ...message, metadata } : message;
      await chatFile.appendMessage(entry.name, messageWithMetadata);
    }

    // Update message count
    await this.index.incrementMessageCount(threadId);

    // Move to front of MRU
    await this.index.touch(threadId);

    return { threadId, messageCount: entry.messageCount + 1 };
  }

  /**
   * Get thread history (CHAT.md format - legacy)
   * @param {string} threadId
   * @returns {Promise<import('./types').ParsedChat|null>}
   */
  async getHistory(threadId) {
    const entry = await this.index.get(threadId);
    if (!entry) return null;
    const chatFile = this._createChatFile(threadId, entry.name);
    return chatFile.read();
  }

  /**
   * Get rich thread history (SQLite exchanges)
   * @param {string} threadId
   * @returns {Promise<object|null>}
   */
  async getRichHistory(threadId) {
    const historyFile = new HistoryFile(threadId);
    return historyFile.read();
  }

  // ── Session delegation (preserves public API) ──

  /**
   * Register an active session
   * @param {string} threadId
   * @param {import('child_process').ChildProcess} wireProcess
   * @param {import('ws').WebSocket} [ws]
   */
  async openSession(threadId, wireProcess, ws = null) {
    // Check for FIFO eviction
    await this._enforceSessionLimit();

    // Mark as active in index
    await this.index.activate(threadId);
    await this.index.markResumed(threadId);

    // Delegate session state to SessionManager
    const session = this.sessionManager.openSession(threadId, this.panelId, wireProcess, ws);

    return session;
  }

  /**
   * Close a session (kill process, mark suspended)
   * @param {string} threadId
   */
  async closeSession(threadId) {
    const closed = this.sessionManager.closeSession(threadId);
    if (!closed) return false;

    // Mark as suspended in index
    await this.index.suspend(threadId);
    return true;
  }

  /**
   * Get active session
   * @param {string} threadId
   * @returns {import('./types').ThreadSession|undefined}
   */
  getSession(threadId) {
    return this.sessionManager.getSession(threadId);
  }

  /**
   * Update session activity (reset idle timer)
   * @param {string} threadId
   */
  touchSession(threadId) {
    this.sessionManager.touchSession(threadId);
  }

  /**
   * Update session WebSocket
   * @param {string} threadId
   * @param {import('ws').WebSocket} ws
   */
  attachWebSocket(threadId, ws) {
    this.sessionManager.attachWebSocket(threadId, ws);
  }

  /**
   * Remove WebSocket from session
   * @param {string} threadId
   */
  detachWebSocket(threadId) {
    this.sessionManager.detachWebSocket(threadId);
  }

  /**
   * Check if thread is currently active
   * @param {string} threadId
   */
  isActive(threadId) {
    return this.sessionManager.isActive(threadId);
  }

  /**
   * Get count of active sessions
   */
  getActiveSessionCount() {
    return this.sessionManager.getActiveSessionCount();
  }

  /**
   * Enforce max active sessions limit (FIFO eviction)
   * @private
   */
  async _enforceSessionLimit() {
    if (this.sessionManager.getActiveSessionCount() >= this.sessionManager.maxActiveSessions) {
      // Find oldest active session by MRU order (last in list = least recently used)
      const threads = await this.index.list();
      const activeThreads = threads.filter(t => this.sessionManager.isActive(t.threadId));
      const oldest = activeThreads[activeThreads.length - 1];
      if (oldest) {
        console.log(`[ThreadManager] LRU eviction: closing ${oldest.threadId}`);
        await this.closeSession(oldest.threadId);
      }
    }
  }

  // ── Auto-rename delegation ──

  /**
   * Auto-rename thread after first assistant response
   * @param {string} threadId
   */
  async autoRename(threadId) {
    await this.autoRenamer.autoRename(
      threadId,
      this.index,
      this.sessionManager,
      (tid, name) => this.renameThread(tid, name)
    );
  }
}

module.exports = { ThreadManager };
