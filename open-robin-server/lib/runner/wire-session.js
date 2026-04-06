/**
 * Wire Session — spawns and communicates with the Kimi CLI wire process.
 *
 * Each run gets a fresh session (no --session flag). The run folder is persistence.
 * Communication uses JSON-RPC 2.0 over stdin/stdout.
 */

const { spawn } = require('child_process');

let nextId = 1;
function rpcId() {
  return `runner-${nextId++}`;
}

/**
 * Build a JSON-RPC 2.0 message.
 */
function rpcMessage(method, params, id) {
  const msg = { jsonrpc: '2.0', method, params };
  if (id) msg.id = id;
  return JSON.stringify(msg);
}

/**
 * Write a JSON-RPC message to the process stdin.
 */
function writeToProc(proc, json) {
  if (proc && proc.stdin && !proc.killed) {
    proc.stdin.write(json + '\n');
    return true;
  }
  return false;
}

/**
 * Spawn a Kimi CLI wire process.
 *
 * @param {string} projectRoot - Working directory for the process
 * @returns {ChildProcess}
 */
function spawnSession(projectRoot) {
  const kimiPath = process.env.KIMI_PATH || 'kimi';
  const args = ['--wire', '--yolo', '--work-dir', projectRoot];

  console.log(`[Runner:Wire] Spawning: ${kimiPath} ${args.join(' ')}`);

  const proc = spawn(kimiPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  console.log(`[Runner:Wire] Spawned pid: ${proc.pid}`);

  proc.on('error', (err) => {
    console.error(`[Runner:Wire] Spawn error: ${err.message}`);
  });

  proc.on('exit', (code) => {
    console.log(`[Runner:Wire] pid ${proc.pid} exited with code ${code}`);
  });

  proc.stderr.on('data', (data) => {
    console.error(`[Runner:Wire:stderr] ${data.toString().trim()}`);
  });

  return proc;
}

/**
 * Send the JSON-RPC initialize handshake and wait for the response.
 *
 * @param {ChildProcess} proc
 * @returns {Promise<Object>} - Resolves with the init result
 */
function initializeWire(proc) {
  return new Promise((resolve, reject) => {
    const id = rpcId();
    let buffer = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Wire initialize timed out after 30s'));
      }
    }, 30000);

    function onData(chunk) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id && msg.result !== undefined) {
            settled = true;
            cleanup();
            resolve(msg.result);
            return;
          }
          if (msg.id === id && msg.error !== undefined) {
            settled = true;
            cleanup();
            reject(new Error(msg.error.message || 'Initialize failed'));
            return;
          }
        } catch {
          // Not JSON or not our message — ignore
        }
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      proc.stdout.removeListener('data', onData);
    }

    proc.stdout.on('data', onData);

    const json = rpcMessage('initialize', {
      protocol_version: '1.4',
      client: { name: 'kimi-runner', version: '0.1.0' },
      capabilities: { supports_question: false },
    }, id);

    const ok = writeToProc(proc, json);
    if (!ok) {
      settled = true;
      cleanup();
      reject(new Error('Wire process not writable'));
    }
  });
}

/**
 * Send the first prompt (system + user) via JSON-RPC.
 *
 * @param {ChildProcess} proc
 * @param {string} systemContext
 * @param {string} userMessage
 */
function sendPrompt(proc, systemContext, userMessage) {
  const id = rpcId();
  const json = rpcMessage('prompt', {
    system: systemContext,
    user_input: userMessage,
  }, id);

  console.log(`[Runner:Wire] Sending prompt (id: ${id}, len: ${json.length})`);
  writeToProc(proc, json);
}

/**
 * Inject a continue/nudge message.
 *
 * @param {ChildProcess} proc
 * @param {string} message
 */
function sendContinue(proc, message) {
  const id = rpcId();
  const json = rpcMessage('prompt', { user_input: message }, id);

  console.log(`[Runner:Wire] Sending continue (id: ${id})`);
  writeToProc(proc, json);
}

/**
 * Clean SIGTERM shutdown of the wire process.
 *
 * @param {ChildProcess} proc
 */
function killSession(proc) {
  if (!proc || proc.killed) return;
  console.log(`[Runner:Wire] Killing pid ${proc.pid}`);
  proc.kill('SIGTERM');
}

module.exports = { spawnSession, initializeWire, sendPrompt, sendContinue, killSession };
