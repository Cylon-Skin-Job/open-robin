/**
 * ChatFile - Parser and writer for thread markdown files
 *
 * Writes human-readable chat transcripts to per-user folders:
 *   ai/views/{workspace}/chat/threads/{username}/thread-name.md
 *
 * Falls back to legacy path ({threadDir}/CHAT.md) when viewsDir is not set.
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const TOOL_CALL_MARKER = '**TOOL CALL(S)**';

/**
 * Get the current OS login username, cached per process.
 *
 * Uses os.userInfo().username (the computer login) as the source of truth.
 * Git config user.name was tried first but is too fragile — developers
 * often set it to personas, jokes, or project-specific names.
 *
 * Future: a system panel UI will let the user explicitly set their
 * username; this OS value will become the fallback when no override is set.
 *
 * @returns {string}
 */
let _cachedUsername = null;
function getUsername() {
  if (_cachedUsername) return _cachedUsername;
  try {
    _cachedUsername = os.userInfo().username;
  } catch {
    _cachedUsername = 'local';
  }
  return _cachedUsername;
}

/**
 * Convert a thread name to a safe filename.
 * @param {string} name
 * @returns {string}
 */
function threadNameToFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) + '.md';
}

class ChatFile {
  /**
   * @param {object} opts
   * @param {string} [opts.threadDir] - Legacy: directory containing CHAT.md
   * @param {string} [opts.viewsDir] - New: ai/views/{workspace}/chat/threads/{username}
   * @param {string} [opts.threadName] - Thread name (used for filename in views mode)
   */
  constructor(opts) {
    if (typeof opts === 'string') {
      // Legacy: constructor(threadDir)
      this.threadDir = opts;
      this.filePath = path.join(opts, 'CHAT.md');
      this.viewsDir = null;
      this.threadName = null;
    } else {
      this.viewsDir = opts.viewsDir || null;
      this.threadName = opts.threadName || null;
      this.threadDir = opts.threadDir || null;

      if (this.viewsDir && this.threadName) {
        this.filePath = path.join(this.viewsDir, threadNameToFilename(this.threadName));
      } else if (this.threadDir) {
        this.filePath = path.join(this.threadDir, 'CHAT.md');
      } else {
        this.filePath = null;
      }
    }
  }

  /**
   * Ensure the parent directory exists
   */
  async ensureDir() {
    if (!this.filePath) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
  }

  /**
   * Parse CHAT.md content
   * @param {string} content - File content
   * @returns {{title: string, messages: Array}}
   */
  parse(content) {
    const lines = content.split('\n');

    let title = 'New Chat';
    let startIdx = 0;

    if (lines[0]?.startsWith('# ')) {
      title = lines[0].slice(2).trim();
      startIdx = 1;
    }

    const messages = [];
    let currentRole = null;
    let currentContent = [];
    let currentHasToolCalls = false;
    let currentMetadata = null;

    const flushMessage = () => {
      if (currentRole && currentContent.length > 0) {
        const msg = {
          role: currentRole,
          content: currentContent.join('\n').trim(),
          hasToolCalls: currentHasToolCalls
        };
        if (currentMetadata) {
          msg.metadata = currentMetadata;
        }
        messages.push(msg);
      }
      currentContent = [];
      currentHasToolCalls = false;
      currentMetadata = null;
    };

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];

      if (line === 'User') {
        flushMessage();
        currentRole = 'user';
      } else if (line === 'Assistant') {
        flushMessage();
        currentRole = 'assistant';
      } else if (line === TOOL_CALL_MARKER) {
        currentHasToolCalls = true;
      } else if (line.startsWith('<!-- metadata:') && line.endsWith('-->')) {
        // Parse metadata HTML comment
        try {
          const jsonStart = line.indexOf('{');
          const jsonEnd = line.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1) {
            currentMetadata = JSON.parse(line.slice(jsonStart, jsonEnd + 1));
          }
        } catch {
          // Ignore parse errors for malformed metadata
        }
      } else if (currentRole) {
        currentContent.push(line);
      }
    }

    flushMessage();
    return { title, messages };
  }

  /**
   * Serialize messages to markdown format
   * @param {string} title - Thread title
   * @param {Array} messages
   * @returns {string}
   */
  serialize(title, messages) {
    const lines = [`# ${title}`, ''];

    for (const msg of messages) {
      lines.push(msg.role === 'user' ? 'User' : 'Assistant');
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      if (msg.hasToolCalls) {
        lines.push(TOOL_CALL_MARKER);
        lines.push('');
      }

      // Add metadata as HTML comment after assistant messages
      if (msg.role === 'assistant' && msg.metadata && Object.keys(msg.metadata).length > 0) {
        lines.push(`<!-- metadata: ${JSON.stringify(msg.metadata)} -->`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Read and parse the chat file
   * @returns {Promise<{title: string, messages: Array}|null>}
   */
  async read() {
    if (!this.filePath) return null;
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      return this.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Write messages to file
   * @param {string} title
   * @param {Array} messages
   */
  async write(title, messages) {
    await this.ensureDir();
    const content = this.serialize(title, messages);
    await fs.writeFile(this.filePath, content);
  }

  /**
   * Append a single message to the file
   * @param {string} title - Current thread title
   * @param {object} message
   */
  async appendMessage(title, message) {
    await this.ensureDir();

    let messages = [];
    const existing = await this.read();
    if (existing) {
      messages = existing.messages;
    }

    messages.push(message);
    await this.write(title, messages);
  }

  /**
   * Check if the file exists
   * @returns {Promise<boolean>}
   */
  async exists() {
    if (!this.filePath) return false;
    try {
      await fs.access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get message count
   * @returns {Promise<number>}
   */
  async countMessages() {
    const parsed = await this.read();
    return parsed?.messages.length || 0;
  }

  /**
   * Rename the file on disk (for thread renames in views mode).
   * @param {string} newName - New thread name
   * @returns {Promise<string|null>} New file path, or null if not in views mode
   */
  async renameFile(newName) {
    if (!this.viewsDir || !this.filePath) return null;

    const newPath = path.join(this.viewsDir, threadNameToFilename(newName));
    if (newPath === this.filePath) return this.filePath;

    try {
      await fs.rename(this.filePath, newPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // Old file doesn't exist — nothing to rename
    }

    this.filePath = newPath;
    this.threadName = newName;
    return newPath;
  }
}

module.exports = { ChatFile, TOOL_CALL_MARKER, getUsername, threadNameToFilename };
