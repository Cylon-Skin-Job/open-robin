const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { WireParser } = require('./wire-parser');
const { EventTranslator } = require('./event-translator');
const { KimiSessionState } = require('./session-state');
const { emit } = require('../../event-bus');
const { normalizeTokenUsage } = require('../model-catalog');

/**
 * @typedef {Object} KimiSession
 * @property {string} threadId
 * @property {import('child_process').ChildProcess} process
 * @property {KimiSessionState} state
 * @property {WireParser} parser
 * @property {(message: string, options?: import('../types').SendOptions) => AsyncIterable<import('../types').CanonicalEvent>} sendMessage
 * @property {() => Promise<void>} stop
 */

/**
 * KIMI CLI harness implementation.
 * 
 * Wraps `kimi --wire --yolo` and translates JSON-RPC protocol
 * to canonical events.
 */
class KimiHarness extends EventEmitter {
  constructor() {
    super();
    this.id = 'kimi';
    this.name = 'KIMI CLI';
    this.provider = 'kimi';
    
    /** @type {import('../types').HarnessConfig} */
    this.config = {};
    /** @type {Map<string, RobinSession>} */
    this.sessions = new Map();
  }

  /**
   * @param {import('../types').HarnessConfig} config
   */
  async initialize(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * @param {string} threadId
   * @param {string} projectRoot
   * @returns {Promise<import('../types').HarnessSession>}
   */
  async startThread(threadId, projectRoot) {
    const robinPath = this.config.cliPath || process.env.KIMI_PATH || 'kimi';
    const args = ['--wire', '--yolo', '--session', threadId];
    
    if (projectRoot) {
      args.push('--work-dir', projectRoot);
    }

    const proc = spawn(robinPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    // Log spawn for debugging
    console.log(`[KimiHarness] Spawned ${robinPath} ${args.join(' ')} (pid: ${proc.pid})`);

    const state = new KimiSessionState();
    const parser = new WireParser();
    const translator = new EventTranslator(state);

    const session = {
      threadId,
      process: proc,
      state,
      parser,
      async *sendMessage(message, options) {
        // Send initialize handshake if needed
        // Send prompt
        // Yield events as they arrive
        // This will be implemented when we switch to the new harness
        throw new Error('sendMessage not yet implemented - use legacy flow');
      },
      async stop() {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      }
    };

    // Set up stdout parsing
    proc.stdout.on('data', (data) => {
      parser.feed(data.toString());
    });

    // Handle parse errors
    parser.on('parse_error', (line, err, lineNum) => {
      console.error(`[KimiHarness] Parse error at line ${lineNum}:`, err.message);
      this.emit('parse_error', { threadId, line, error: err, lineNum });
    });

    // Handle wire messages
    parser.on('message', (msg) => {
      const events = translator.translate(msg);
      if (events) {
        const eventArray = Array.isArray(events) ? events : [events];
        for (const event of eventArray) {
          this.emit('event', { threadId, event });
          this.bridgeToEventBus(threadId, event, state);
        }
      }
    });

    // Handle process events
    proc.on('error', (err) => {
      console.error(`[KimiHarness] Process error (pid: ${proc.pid}):`, err.message);
      this.emit('error', { threadId, error: err });
    });

    proc.on('exit', (code) => {
      console.log(`[KimiHarness] Process exited (pid: ${proc.pid}, code: ${code})`);
      this.sessions.delete(threadId);
      this.emit('exit', { threadId, code });
    });

    proc.stderr.on('data', (data) => {
      console.error(`[KimiHarness:stderr] ${data.toString().trim()}`);
    });

    this.sessions.set(threadId, session);
    return session;
  }

  /**
   * Bridge canonical events to the shared event bus for audit persistence.
   * @private
   */
  bridgeToEventBus(threadId, event, state) {
    if (event.type === 'turn_end') {
      const meta = event._meta || {};
      const normalized = normalizeTokenUsage(
        'kimi', meta.model, meta.tokenUsage, meta.contextUsage
      );

      emit('chat:status_update', {
        threadId,
        messageId: meta.messageId,
        planMode: meta.planMode,
        contextUsage: meta.contextUsage ?? null,
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
  }

  async dispose() {
    // Kill all active sessions
    for (const [threadId, session] of this.sessions) {
      await session.stop();
    }
    this.sessions.clear();
  }

  /**
   * Get an active session by thread ID.
   * @param {string} threadId
   * @returns {RobinSession | undefined}
   */
  getSession(threadId) {
    return this.sessions.get(threadId);
  }

  /**
   * Send a message to a specific thread's wire process.
   * This is the low-level method; most callers should use session.sendMessage().
   * @param {string} threadId
   * @param {string} method
   * @param {unknown} params
   * @param {string} [id]
   * @returns {boolean}
   */
  sendToThread(threadId, method, params, id) {
    const session = this.sessions.get(threadId);
    if (!session || session.process.killed) {
      return false;
    }

    const message = {
      jsonrpc: '2.0',
      method,
      params,
      ...(id && { id })
    };

    const json = JSON.stringify(message);
    session.process.stdin.write(json + '\n');
    return true;
  }
}

module.exports = { KimiHarness };
