const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { platform } = require('os');

/**
 * @typedef {import('../types').HarnessConfig} HarnessConfig
 * @typedef {import('../types').HarnessSession} HarnessSession
 */

/**
 * Base class for external CLI harnesses.
 * 
 * External CLI harnesses wrap globally-installed CLI tools (like Codex, Claude Code, etc.)
 * and translate their wire protocols to canonical events.
 * 
 * @abstract
 */
class BaseCLIHarness extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} options.id - Harness ID (e.g., 'codex', 'claude-code')
   * @param {string} options.name - Display name (e.g., 'Codex (OpenAI)')
   * @param {string} options.cliName - CLI binary name (e.g., 'codex')
   * @param {string} options.provider - Provider ID (e.g., 'openai', 'anthropic')
   */
  constructor(options) {
    super();
    this.id = options.id;
    this.name = options.name;
    this.cliName = options.cliName;
    this.provider = options.provider;
    
    /** @type {string | null} */
    this.cliPath = null;
    /** @type {HarnessConfig} */
    this.config = {};
    /** @type {Map<string, HarnessSession>} */
    this.sessions = new Map();
    
    // Detect Windows for command differences
    this.isWindows = platform() === 'win32';
  }

  /**
   * Check if the CLI is installed and available in PATH.
   * Uses `which` (Unix) or `where` (Windows) followed by `--version` check.
   * 
   * @param {number} timeoutMs - Timeout in milliseconds (default: 2000)
   * @returns {Promise<boolean>}
   */
  async isInstalled(timeoutMs = 2000) {
    return new Promise((resolve) => {
      const whichCmd = this.isWindows ? 'where' : 'which';
      const proc = spawn(whichCmd, [this.cliName], {
        shell: true,
        stdio: 'pipe'
      });

      let stdout = '';
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('error', () => resolve(false));
      
      proc.on('exit', (code) => {
        if (code !== 0 || !stdout.trim()) {
          resolve(false);
          return;
        }
        
        // CLI found in PATH, now verify it runs with --version
        this._checkVersion(timeoutMs).then(resolve).catch(() => resolve(false));
      });

      // Timeout fallback
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, timeoutMs);
    });
  }

  /**
   * Internal method to verify CLI works by running --version.
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   * @private
   */
  async _checkVersion(timeoutMs) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.cliName, ['--version'], {
        shell: true,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', reject);
      
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          // Some CLIs may not support --version, but still be valid
          // Check if we got any output at all
          resolve(stdout.length > 0 || stderr.length > 0);
        }
      });

      setTimeout(() => {
        proc.kill();
        reject(new Error('Version check timeout'));
      }, timeoutMs);
    });
  }

  /**
   * Get the CLI version string.
   * 
   * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
   * @returns {Promise<string>}
   * @throws {Error} If CLI is not installed or version check fails
   */
  async getVersion(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let output = '';
      
      const proc = spawn(this.cliName, ['--version'], {
        shell: true,
        stdio: 'pipe'
      });

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run ${this.cliName}: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (code === 0 || output.trim()) {
          resolve(output.trim());
        } else {
          reject(new Error(`${this.cliName} --version exited with code ${code}`));
        }
      });

      setTimeout(() => {
        proc.kill();
        reject(new Error(`Timeout waiting for ${this.cliName} --version`));
      }, timeoutMs);
    });
  }

  /**
   * Find the full path to the CLI binary.
   * 
   * @returns {Promise<string | null>} Full path or null if not found
   */
  async findCLI() {
    return new Promise((resolve) => {
      const whichCmd = this.isWindows ? 'where' : 'which';
      const proc = spawn(whichCmd, [this.cliName], {
        shell: true,
        stdio: 'pipe'
      });

      let stdout = '';
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('error', () => resolve(null));
      
      proc.on('exit', (code) => {
        if (code === 0) {
          // Take first line (Windows where can return multiple paths)
          const path = stdout.trim().split('\n')[0].trim();
          resolve(path);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Initialize the harness with configuration.
   * Validates that the CLI is installed.
   * 
   * @param {HarnessConfig} config
   * @throws {Error} If CLI is not installed
   */
  async initialize(config) {
    this.config = { ...this.config, ...config };
    
    // Allow override via config
    if (config.cliPath) {
      this.cliPath = config.cliPath;
      return;
    }

    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error(
        `${this.name} CLI (${this.cliName}) is not installed. ` +
        `Install it with: ${this.getInstallCommand()}`
      );
    }

    // Try to find full path, fallback to cliName
    const fullPath = await this.findCLI();
    this.cliPath = fullPath || this.cliName;
  }

  /**
   * Get the installation command for this CLI.
   * Override in subclass if different.
   * 
   * @returns {string}
   */
  getInstallCommand() {
    return `npm install -g ${this.cliName}`;
  }

  /**
   * Get spawn arguments for the CLI.
   * Must be implemented by subclasses.
   * 
   * @abstract
   * @param {string} threadId
   * @param {string} projectRoot
   * @returns {string[]}
   */
  getSpawnArgs(threadId, projectRoot) {
    throw new Error(
      `Subclass ${this.constructor.name} must implement getSpawnArgs()`
    );
  }

  /**
   * Create a wire parser for this CLI's protocol.
   * Must be implemented by subclasses.
   * 
   * @abstract
   * @returns {import('events').EventEmitter}
   */
  createWireParser() {
    throw new Error(
      `Subclass ${this.constructor.name} must implement createWireParser()`
    );
  }

  /**
   * Start a new thread with this harness.
   * Spawns the CLI process and sets up wire parsing.
   * 
   * @param {string} threadId
   * @param {string} projectRoot
   * @returns {Promise<HarnessSession>}
   */
  async startThread(threadId, projectRoot) {
    if (!this.cliPath) {
      throw new Error(`Harness not initialized. Call initialize() first.`);
    }

    const args = this.getSpawnArgs(threadId, projectRoot);
    
    const proc = spawn(this.cliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectRoot,
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    console.log(`[${this.name}] Spawned ${this.cliPath} (pid: ${proc.pid})`);

    // Set up wire parsing
    const parser = this.createWireParser();
    
    // Set up stdout parsing
    proc.stdout.on('data', (data) => {
      parser.feed(data.toString());
    });

    // Handle parser events
    parser.on('message', (msg) => {
      const events = this.translateMessage(msg);
      if (events) {
        const eventArray = Array.isArray(events) ? events : [events];
        for (const event of eventArray) {
          this.emit('event', { threadId, event });
        }
      }
    });

    parser.on('parse_error', (line, err, lineNum) => {
      console.error(`[${this.name}] Parse error at line ${lineNum}:`, err.message);
      this.emit('parse_error', { threadId, line, error: err, lineNum });
    });

    // Handle process events
    proc.on('error', (err) => {
      console.error(`[${this.name}] Process error (pid: ${proc.pid}):`, err.message);
      this.emit('error', { threadId, error: err });
    });

    proc.on('exit', (code) => {
      console.log(`[${this.name}] Process exited (pid: ${proc.pid}, code: ${code})`);
      this.sessions.delete(threadId);
      this.emit('exit', { threadId, code });
    });

    proc.stderr.on('data', (data) => {
      console.error(`[${this.name}:stderr] ${data.toString().trim()}`);
    });

    /** @type {HarnessSession} */
    const session = {
      threadId,
      async *sendMessage(message, options) {
        throw new Error('sendMessage not yet implemented');
      },
      async stop() {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      }
    };

    this.sessions.set(threadId, session);
    return session;
  }

  /**
   * Translate a wire message to canonical event(s).
   * Override in subclass for protocol-specific translation.
   * 
   * @param {unknown} msg - Wire protocol message
   * @returns {import('../types').CanonicalEvent | import('../types').CanonicalEvent[] | null}
   */
  translateMessage(msg) {
    // Default: pass through (subclasses should override)
    return null;
  }

  /**
   * Translate a canonical event to Kimi-style wire message.
   * This is the "Compatibility Bridge" for server.js.
   * 
   * @param {import('../types').CanonicalEvent} event
   * @returns {Object | null}
   */
  serializeToKimiWire(event) {
    const method = 'event';
    let type = '';
    let payload = {};

    switch (event.type) {
      case 'turn_begin':
        type = 'TurnBegin';
        payload = { user_input: event.userInput };
        break;
      
      case 'content':
        type = 'ContentPart';
        payload = { type: 'text', text: event.text };
        break;
      
      case 'thinking':
        type = 'ContentPart';
        payload = { type: 'think', think: event.text };
        break;
      
      case 'tool_call':
        type = 'ToolCall';
        payload = { 
          id: event.toolCallId,
          function: { name: event.toolName }
        };
        break;
      
      case 'tool_call_args':
        type = 'ToolCallPart';
        payload = { arguments_part: event.argsChunk };
        break;
      
      case 'tool_result':
        type = 'ToolResult';
        payload = {
          tool_call_id: event.toolCallId,
          function: { name: event.toolName },
          return_value: {
            output: event.output,
            display: event.display,
            is_error: event.isError,
            files: event.files || []
          }
        };
        break;
      
      case 'turn_end':
        type = 'TurnEnd';
        payload = {};
        break;
      
      default:
        return null;
    }

    return {
      jsonrpc: '2.0',
      method,
      params: { type, payload }
    };
  }

  /**
   * Get an active session by thread ID.
   * @param {string} threadId
   * @returns {HarnessSession | undefined}
   */
  getSession(threadId) {
    return this.sessions.get(threadId);
  }

  /**
   * Send a message to a specific thread's wire process.
   * 
   * @param {string} threadId
   * @param {unknown} message
   * @returns {boolean}
   */
  sendToThread(threadId, message) {
    const session = this.sessions.get(threadId);
    if (!session) {
      return false;
    }

    // Find the process from our internal tracking
    // This is a bit hacky - we should store process reference in session
    for (const [id, s] of this.sessions) {
      if (id === threadId) {
        // Access the process through closure - this is messy
        // Better approach: store process reference
        return true;
      }
    }
    return false;
  }

  /**
   * Dispose of all sessions and clean up.
   */
  async dispose() {
    for (const [threadId, session] of this.sessions) {
      await session.stop();
    }
    this.sessions.clear();
  }
}

module.exports = { BaseCLIHarness };
