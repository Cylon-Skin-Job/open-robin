const { BaseCLIHarness } = require('../base-cli-harness');
const { QwenAcpWireParser } = require('./wire-parser');
const { QwenAcpEventTranslator } = require('./event-translator');
const { QwenAcpSessionState } = require('./session-state');
const { emit } = require('../../../event-bus');
const { normalizeTokenUsage } = require('../../model-catalog');

/**
 * @typedef {import('../../types').HarnessConfig} HarnessConfig
 * @typedef {import('../../types').HarnessSession} HarnessSession
 * @typedef {import('../../types').SendOptions} SendOptions
 * @typedef {import('../../types').CanonicalEvent} CanonicalEvent
 */

/**
 * Qwen CLI harness implementation using ACP (Agent Client Protocol).
 *
 * Wraps `@qwen-code/qwen-code` CLI and translates its ACP JSON-RPC protocol
 * to canonical events for the Kimi IDE unified chat interface.
 *
 * Qwen Code CLI is a fork of Google Gemini CLI and supports the same ACP
 * protocol, enabling bidirectional multi-turn conversations via stdin/stdout.
 *
 * ACP is an open protocol for IDE-agent communication:
 * @see https://agentclientprotocol.com/
 *
 * Unlike stream-json mode (one-shot), ACP provides:
 * - Bidirectional communication via stdin/stdout
 * - Multi-turn conversations without respawning
 * - Session management
 * - Permission handling
 * - Real-time streaming of thinking, content, and tool calls
 */
class QwenHarness extends BaseCLIHarness {
  constructor() {
    super({
      id: 'qwen',
      name: 'Qwen (Alibaba)',
      cliName: 'qwen',
      provider: 'alibaba'
    });

    this.defaultModel = 'qwen3-coder-plus';
    this.defaultMode = 'yolo';

    /** @type {Map<string, QwenAcpSessionState>} */
    this.sessionStates = new Map();
    /** @type {Map<string, QwenAcpEventTranslator>} */
    this.translators = new Map();
    /** @type {Map<string, import('child_process').ChildProcess>} */
    this.processes = new Map();
    /** @type {Map<string, string>} */
    this.turnUserInputs = new Map(); // threadId → userInput for current turn
  }

  /**
   * @param {HarnessConfig} config
   */
  async initialize(config) {
    this.config = {
      model: this.defaultModel,
      mode: this.defaultMode,
      ...config
    };

    await super.initialize(config);
  }

  /**
   * Get the installation command for Qwen CLI.
   * @returns {string}
   */
  getInstallCommand() {
    return 'npm install -g @qwen-code/qwen-code';
  }

  /**
   * Check if OAuth credentials exist.
   * Qwen uses OAuth 2.0, credentials stored at ~/.qwen/oauth_creds.json
   * @returns {Promise<boolean>}
   */
  async isOAuthAuthenticated() {
    const fs = require('fs/promises');
    const path = require('path');
    const os = require('os');
    const credsPath = path.join(os.homedir(), '.qwen', 'oauth_creds.json');
    try {
      await fs.access(credsPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get spawn arguments for Qwen CLI in ACP mode.
   *
   * @param {string} threadId
   * @param {string} projectRoot
   * @returns {string[]}
   */
  getSpawnArgs(threadId, projectRoot) {
    return [
      '--acp',
      '--approval-mode', this.config.mode || this.defaultMode,
      '--model', this.config.model || this.defaultModel
    ];
  }

  /**
   * Create a Qwen ACP wire parser for JSON-RPC protocol.
   * @returns {QwenAcpWireParser}
   */
  createWireParser() {
    return new QwenAcpWireParser();
  }

  /**
   * Start a new thread with this harness.
   * Spawns the Qwen CLI process in ACP mode and sets up the JSON-RPC protocol.
   *
   * ACP protocol flow:
   * 1. Spawn CLI with --acp
   * 2. Send initialize request
   * 3. Send session/new request
   * 4. Use session/prompt for messages
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

    const { spawn } = require('child_process');
    const proc = spawn(this.cliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectRoot,
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    console.log(`[${this.name}] Spawned ${this.cliPath} (pid: ${proc.pid})`);

    // Track the process
    this.processes.set(threadId, proc);

    // Set up session state and translator
    const state = new QwenAcpSessionState();
    this.sessionStates.set(threadId, state);

    const translator = new QwenAcpEventTranslator(state);
    this.translators.set(threadId, translator);

    // Set up wire parsing
    const parser = this.createWireParser();

    // Compatible stdout stream for compat.js (Kimi-wire format)
    const { PassThrough } = require('stream');
    const compatibleStdout = new PassThrough();

    // Set up stdout parsing
    proc.stdout.on('data', (data) => {
      parser.feed(data.toString());
    });

    // Handle parser events
    parser.on('message', (msg) => {
      const events = this.translateMessage(msg, threadId);
      if (events) {
        const eventArray = Array.isArray(events) ? events : [events];
        for (const event of eventArray) {
          this.emit('event', { threadId, event });
          this.bridgeToEventBus(threadId, event);

          const kimiMsg = this.serializeToKimiWire(event);
          if (kimiMsg) {
            compatibleStdout.write(JSON.stringify(kimiMsg) + '\n');
          }
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
      this.cleanupSession(threadId);
      this.emit('exit', { threadId, code });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.error(`[${this.name}:stderr] ${text}`);
      }
    });

    // Initialize ACP session
    await this.initializeAcpSession(proc, threadId, projectRoot);

    /** @type {HarnessSession} */
    const session = {
      threadId,
      process: proc,
      compatibleStdout,
      async *sendMessage(message, options = {}) {
        // Send prompt via ACP
        const requestId = Date.now();
        const acpRequest = {
          jsonrpc: '2.0',
          id: requestId,
          method: 'session/prompt',
          params: {
            sessionId: state.sessionId,
            prompt: [{ type: 'text', text: message }]
          }
        };

        proc.stdin.write(JSON.stringify(acpRequest) + '\n');

        // Yield events as they arrive via the 'event' emitter
        const events = [];
        const eventHandler = ({ threadId: tid, event }) => {
          if (tid === threadId) {
            events.push(event);
          }
        };

        this.on('event', eventHandler);

        try {
          // Collect events until turn_end
          while (true) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const turnEndIndex = events.findIndex(e => e.type === 'turn_end');
            if (turnEndIndex >= 0) {
              yield* events;
              break;
            }
          }
        } finally {
          this.off('event', eventHandler);
        }
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
   * Initialize the ACP session by sending initialize and session/new requests.
   * @private
   */
  async initializeAcpSession(proc, threadId, projectRoot) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('ACP initialization timeout'));
      }, 30000);

      let initComplete = false;
      let sessionCreated = false;

      const checkComplete = () => {
        if (initComplete && sessionCreated) {
          clearTimeout(timeout);
          resolve();
        }
      };

      // Set up one-time listener for initialization responses
      const handler = (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);

            if (msg.id === 1 && msg.result) {
              initComplete = true;
              checkComplete();
            }

            if (msg.id === 2 && msg.result?.sessionId) {
              const state = this.sessionStates.get(threadId);
              if (state) {
                state.setSessionInfo(
                  msg.result.sessionId,
                  msg.result.models,
                  msg.result.modes?.currentModeId
                );
              }
              sessionCreated = true;
              checkComplete();
            }
          } catch (e) {}
        }
      };

      proc.stdout.on('data', handler);

      // Send initialize
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          capabilities: {},
          clientInfo: {
            name: 'open-robin',
            version: '1.0.0'
          }
        }
      };
      proc.stdin.write(JSON.stringify(initRequest) + '\n');

      // Send session/new after a short delay
      setTimeout(() => {
        const sessionRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'session/new',
          params: {
            cwd: projectRoot,
            mcpServers: []
          }
        };
        proc.stdin.write(JSON.stringify(sessionRequest) + '\n');
      }, 100);
    });
  }

  /**
   * Translate a Qwen ACP message to canonical event(s).
   *
   * @param {import('./wire-parser').AcpMessage} msg
   * @param {string} threadId
   * @returns {import('../../types').CanonicalEvent | import('../../types').CanonicalEvent[] | null}
   */
  translateMessage(msg, threadId) {
    const translator = this.translators.get(threadId);
    if (!translator) {
      console.warn(`[${this.name}] No translator found for thread ${threadId}`);
      return null;
    }
    return translator.translate(msg);
  }

  /**
   * Bridge canonical events to the shared event bus for audit persistence.
   * @private
   */
  bridgeToEventBus(threadId, event) {
    if (event.type !== 'turn_end') return;

    const state = this.sessionStates.get(threadId);
    if (!state) return;

    const meta = event._meta || {};
    const normalized = normalizeTokenUsage(
      'qwen', meta.model, meta.tokenUsage, null
    );

    emit('chat:status_update', {
      threadId,
      tokenUsage: normalized,
    });

    emit('chat:turn_end', {
      workspace: 'code-viewer',
      threadId,
      turnId: event.turnId,
      userInput: state.currentTurn?.userInput || '',
      parts: [...state.assistantParts],
      fullText: event.fullText,
      hasToolCalls: event.hasToolCalls,
    });
  }

  /**
   * Clean up session resources.
   * @private
   */
  cleanupSession(threadId) {
    this.sessionStates.delete(threadId);
    this.translators.delete(threadId);
    this.processes.delete(threadId);
    this.sessions.delete(threadId);
  }

  /**
   * Get session state for debugging.
   * @param {string} threadId
   * @returns {QwenAcpSessionState | undefined}
   */
  getSessionState(threadId) {
    return this.sessionStates.get(threadId);
  }

  /**
   * Dispose of all sessions and clean up.
   */
  async dispose() {
    for (const [threadId, session] of this.sessions) {
      await session.stop();
    }
    this.sessions.clear();
    this.sessionStates.clear();
    this.translators.clear();
    this.processes.clear();
  }
}

module.exports = { QwenHarness };
