const { BaseCLIHarness } = require('../base-cli-harness');
const { AcpWireParser } = require('./acp-wire-parser');
const { CodexEventTranslator } = require('./acp-event-translator');
const { CodexSessionState } = require('./session-state');
const { emit } = require('../../../event-bus');
const { normalizeTokenUsage } = require('../../model-catalog');

/**
 * @typedef {import('../../types').HarnessConfig} HarnessConfig
 * @typedef {import('../../types').HarnessSession} HarnessSession
 * @typedef {import('../../types').CanonicalEvent} CanonicalEvent
 */

/**
 * Codex CLI harness implementation using ACP (Agent Client Protocol).
 * 
 * Wraps `codex-acp` (Zed's adapter) and translates the JSON-RPC protocol to canonical events.
 * 
 * ACP is an open protocol for IDE-agent communication:
 * @see https://agentclientprotocol.com/
 * 
 * Unlike the direct app-server mode, ACP provides:
 * - Standardized tool call lifecycle
 * - Session management
 * - Multi-turn conversation support
 */
class CodexHarness extends BaseCLIHarness {
  constructor() {
    super({
      id: 'codex',
      name: 'Codex (OpenAI)',
      cliName: 'codex-acp',
      provider: 'openai'
    });

    this.defaultModel = 'gpt-4o';
    this.defaultMode = 'full-auto';
    
    /** @type {Map<string, CodexSessionState>} */
    this.sessionStates = new Map();
    /** @type {Map<string, CodexEventTranslator>} */
    this.translators = new Map();
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

    // If cliName is explicitly provided in config, use it
    if (config.cliName) {
      this.cliName = config.cliName;
    }

    await super.initialize(config);
  }

  /**
   * Get the installation command for Codex ACP adapter.
   * @returns {string}
   */
  getInstallCommand() {
    return 'npm install -g @openai/codex-acp';
  }

  /**
   * Get spawn arguments for Codex CLI in ACP mode.
   * 
   * @param {string} threadId
   * @param {string} projectRoot
   * @returns {string[]}
   */
  getSpawnArgs(threadId, projectRoot) {
    const args = [
      '--mode', this.config.mode || this.defaultMode,
      '--model', this.config.model || this.defaultModel
    ];

    // Note: codex-acp might not need --acp flag as it IS the acp adapter
    // but some versions might use it. Following spec examples:
    // codex-acp --mode full-auto --model gpt-4o

    return args;
  }

  /**
   * Create an ACP wire parser for Codex's protocol.
   * @returns {AcpWireParser}
   */
  createWireParser() {
    return new AcpWireParser();
  }

  /**
   * Start a new thread with this harness.
   * Spawns the Codex-ACP process and sets up ACP wire parsing.
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

    // Set up session state and translator
    const state = new CodexSessionState();
    this.sessionStates.set(threadId, state);
    
    const translator = new CodexEventTranslator(state);
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

          // Bridge to event bus for turn_end and status updates
          if (event.type === 'turn_end') {
            this.bridgeToEventBus(threadId, event);
          }

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
      console.error(`[${this.name}:stderr] ${data.toString().trim()}`);
    });

    // Initialize ACP session
    await this.initializeAcpSession(proc, threadId, projectRoot);

    const self = this;
    /** @type {HarnessSession} */
    const session = {
      threadId,
      process: proc,
      compatibleStdout,
      async *sendMessage(message, options = {}) {
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

        // Yield events as they arrive
        const events = [];
        const eventHandler = ({ threadId: tid, event }) => {
          if (tid === threadId) {
            events.push(event);
          }
        };
        
        self.on('event', eventHandler);
        
        try {
          while (true) {
            await new Promise(resolve => setTimeout(resolve, 50));
            const turnEndIndex = events.findIndex(e => e.type === 'turn_end');
            if (turnEndIndex >= 0) {
              yield* events;
              break;
            }
            if (events.length > 0) {
              yield* events.splice(0, events.length);
            }
          }
        } finally {
          self.off('event', eventHandler);
        }
      },
      async stop() {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
        self.cleanupSession(threadId);
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
        reject(new Error('Codex ACP initialization timeout'));
      }, 30000);

      let initComplete = false;
      let sessionCreated = false;

      const checkComplete = () => {
        if (initComplete && sessionCreated) {
          clearTimeout(timeout);
          resolve();
        }
      };

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

      // Step 1: Initialize
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientInfo: { name: 'open-robin', version: '1.0.0' }
        }
      };
      proc.stdin.write(JSON.stringify(initRequest) + '\n');

      // Step 2: Session/new
      setTimeout(() => {
        const sessionRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'session/new',
          params: {
            cwd: projectRoot
          }
        };
        proc.stdin.write(JSON.stringify(sessionRequest) + '\n');
      }, 100);
    });
  }

  /**
   * Translate an ACP message to canonical event(s).
   * 
   * @param {any} msg
   * @param {string} threadId
   * @returns {import('../../types').CanonicalEvent | import('../../types').CanonicalEvent[] | null}
   */
  translateMessage(msg, threadId) {
    const translator = this.translators.get(threadId);
    if (!translator) {
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
      'codex', meta.model, meta.tokenUsage, null
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
    this.sessions.delete(threadId);
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
  }
}

module.exports = { CodexHarness };
