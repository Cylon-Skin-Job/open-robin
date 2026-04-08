const { BaseCLIHarness } = require('../base-cli-harness');
const { AcpWireParser } = require('./acp-wire-parser');
const { ClaudeAcpEventTranslator } = require('./acp-event-translator');
const { ClaudeSessionState } = require('./session-state');
const { PassThrough } = require('stream');
const { emit } = require('../../../event-bus');
const { normalizeTokenUsage } = require('../../model-catalog');

/**
 * @typedef {import('../../types').HarnessConfig} HarnessConfig
 * @typedef {import('../../types').HarnessSession} HarnessSession
 * @typedef {import('../../types').SendOptions} SendOptions
 * @typedef {import('../../types').CanonicalEvent} CanonicalEvent
 */

/**
 * Claude Code CLI harness implementation using ACP (Agent Client Protocol).
 * 
 * Wraps `claude --acp` and translates the JSON-RPC protocol to canonical events.
 */
class ClaudeCodeHarness extends BaseCLIHarness {
  constructor() {
    super({
      id: 'claude-code',
      name: 'Claude Code (Anthropic)',
      cliName: 'claude',
      provider: 'anthropic'
    });

    this.defaultModel = 'claude-3-5-sonnet-latest';
    this.defaultMode = 'auto';
    
    /** @type {Map<string, ClaudeSessionState>} */
    this.sessionStates = new Map();
    /** @type {Map<string, ClaudeAcpEventTranslator>} */
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

    await super.initialize(config);
  }

  /**
   * Get the installation command for Claude Code CLI.
   * @returns {string}
   */
  getInstallCommand() {
    return 'npm install -g @anthropic-ai/claude-code';
  }

  /**
   * Get spawn arguments for Claude Code CLI in ACP mode.
   * 
   * @param {string} threadId
   * @param {string} projectRoot
   * @returns {string[]}
   */
  getSpawnArgs(threadId, projectRoot) {
    const args = [
      '--acp',
      '--approval-mode', this.config.mode || this.defaultMode
    ];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    return args;
  }

  /**
   * Create an ACP wire parser.
   * @returns {AcpWireParser}
   */
  createWireParser() {
    return new AcpWireParser();
  }

  /**
   * Start a new thread with this harness.
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
    const state = new ClaudeSessionState();
    this.sessionStates.set(threadId, state);
    
    const translator = new ClaudeAcpEventTranslator(state);
    this.translators.set(threadId, translator);

    // Set up wire parsing
    const parser = this.createWireParser();
    
    // Create a compatible stdout stream for server.js
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
          // Emit canonical event for bus
          this.emit('event', { threadId, event });
          this.bridgeToEventBus(threadId, event);

          // Emit Kimi-compatible JSON on compatibleStdout for server.js
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
      compatibleStdout.end();
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.error(`[${this.name}:stderr] ${text}`);
      }
    });

    // Initialize ACP session
    await this.initializeAcpSession(proc, threadId, projectRoot);

    /** @type {HarnessSession & {process: import('child_process').ChildProcess, compatibleStdout: PassThrough}} */
    const session = {
      threadId,
      process: proc,
      compatibleStdout,
      async *sendMessage(message, options = {}) {
        // Start turn in state
        const turnId = `turn-${Date.now()}`;
        state.startTurn(turnId, message);
        
        // Emit TurnBegin compatible message
        compatibleStdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'event',
          params: { type: 'TurnBegin', payload: { user_input: message } }
        }) + '\n');

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

        // Simple wait-for-completion (caller should listen to events)
        while (state.currentTurn) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      },
      async stop() {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
        this.cleanupSession(threadId);
      }
    };

    this.sessions.set(threadId, session);
    return session;
  }

  /**
   * Initialize the ACP session.
   * @private
   */
  async initializeAcpSession(proc, threadId, projectRoot) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Claude Code ACP initialization timeout'));
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

      // Send initialize
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

      // Send session/new
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
   * Translate an ACP message to canonical event(s).
   */
  translateMessage(msg, threadId) {
    const translator = this.translators.get(threadId);
    if (!translator) return null;
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
      'claude-code', meta.model, meta.tokenUsage, null
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

module.exports = { ClaudeCodeHarness };
