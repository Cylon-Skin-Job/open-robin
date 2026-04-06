// Kimi IDE Server
// Replaces CLI wire mode with direct Claude API calls
// WebSocket bridge between React frontend and Claude agentic loop

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import { runAgentLoop } from './agent.js';
import { createCheckpoint, rollback, acceptCheckpoint, getCheckpointDiff } from './checkpoint.js';

const PORT = process.env.PORT || 3001;
const PROJECT_CWD = process.env.PROJECT_CWD || process.cwd();

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', cwd: PROJECT_CWD });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// --- Per-thread state ---

/** @type {Map<string, ThreadState>} */
const threads = new Map();

/**
 * @typedef {object} ThreadState
 * @property {string} id
 * @property {Array} messages - Conversation history for Claude API
 * @property {object|null} checkpoint - Active git checkpoint
 * @property {AbortController|null} abort - Abort controller for current turn
 * @property {'idle'|'running'|'awaiting_decision'} status
 * @property {((decision: string) => void)|null} pendingDecision - Resolver for rollback/accept
 */

function getOrCreateThread(threadId) {
  if (!threads.has(threadId)) {
    threads.set(threadId, {
      id: threadId,
      messages: [],
      checkpoint: null,
      abort: null,
      status: 'idle',
      pendingDecision: null,
    });
  }
  return threads.get(threadId);
}

// --- WebSocket handling ---

wss.on('connection', (ws) => {
  console.log('Client connected');
  let activeThreadId = null;

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const { type, threadId, payload } = msg;
    activeThreadId = threadId || activeThreadId;

    switch (type) {
      case 'prompt':
        await handlePrompt(ws, activeThreadId, payload);
        break;

      case 'accept':
        handleDecision(activeThreadId, 'accept');
        break;

      case 'rollback':
        handleDecision(activeThreadId, 'rollback');
        break;

      case 'abort':
        handleAbort(activeThreadId);
        break;

      case 'get_threads':
        ws.send(JSON.stringify({
          type: 'threads',
          payload: Array.from(threads.entries()).map(([id, t]) => ({
            id,
            status: t.status,
            messageCount: t.messages.length,
          })),
        }));
        break;

      default:
        ws.send(JSON.stringify({ error: `Unknown message type: ${type}` }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// --- Core handlers ---

async function handlePrompt(ws, threadId, payload) {
  const thread = getOrCreateThread(threadId);

  if (thread.status !== 'idle') {
    sendEvent(ws, 'error', { message: 'Thread is busy' });
    return;
  }

  const userInput = payload?.user_input || payload?.message;
  if (!userInput) {
    sendEvent(ws, 'error', { message: 'No user_input provided' });
    return;
  }

  // Add user message to history
  thread.messages.push({ role: 'user', content: userInput });
  thread.status = 'running';
  thread.abort = new AbortController();

  // Create git checkpoint before the turn
  thread.checkpoint = createCheckpoint(PROJECT_CWD);
  if (thread.checkpoint) {
    sendEvent(ws, 'CheckpointCreated', { id: thread.checkpoint.id });
  }

  try {
    // Run the agentic loop
    const result = await runAgentLoop({
      messages: thread.messages,
      cwd: PROJECT_CWD,
      emit: (event) => sendEvent(ws, event.type, event.payload),
      waitForApproval: null, // No per-tool approval - we use end-of-turn checkpoint
      signal: thread.abort.signal,
    });

    thread.messages = result.messages;

    // If there's a checkpoint with changes, enter awaiting_decision state
    if (thread.checkpoint) {
      const diff = getCheckpointDiff(thread.checkpoint);
      const hasChanges = diff !== '(no changes)';

      if (hasChanges) {
        thread.status = 'awaiting_decision';

        // Send the diff and signal frontend to show rollback/accept overlay
        sendEvent(ws, 'AwaitingDecision', {
          checkpoint_id: thread.checkpoint.id,
          diff,
          status: result.status,
        });

        // Wait for user decision
        const decision = await new Promise((resolve) => {
          thread.pendingDecision = resolve;
        });

        if (decision === 'rollback') {
          // Rollback git state
          rollback(thread.checkpoint);

          // Remove the assistant messages and tool results from this turn
          // (everything after the user message we added at the top)
          const userMsgIndex = thread.messages.length - 1;
          // Walk backwards to find our user message
          for (let i = thread.messages.length - 1; i >= 0; i--) {
            if (thread.messages[i].role === 'user' &&
                thread.messages[i].content === userInput) {
              // Remove everything from this user message onwards
              thread.messages.splice(i);
              break;
            }
          }

          sendEvent(ws, 'RolledBack', { checkpoint_id: thread.checkpoint.id });
        } else {
          // Accept - just clean up the checkpoint tag
          acceptCheckpoint(thread.checkpoint);
          sendEvent(ws, 'Accepted', { checkpoint_id: thread.checkpoint.id });
        }
      } else {
        // No file changes - just clean up
        acceptCheckpoint(thread.checkpoint);
      }
    }
  } catch (err) {
    sendEvent(ws, 'error', { message: err.message });

    // Rollback on error
    if (thread.checkpoint) {
      rollback(thread.checkpoint);
      sendEvent(ws, 'RolledBack', {
        checkpoint_id: thread.checkpoint.id,
        reason: 'error',
      });
    }
  } finally {
    thread.checkpoint = null;
    thread.abort = null;
    thread.status = 'idle';
    thread.pendingDecision = null;
  }
}

function handleDecision(threadId, decision) {
  const thread = threads.get(threadId);
  if (!thread || !thread.pendingDecision) return;
  thread.pendingDecision(decision);
}

function handleAbort(threadId) {
  const thread = threads.get(threadId);
  if (!thread || !thread.abort) return;
  thread.abort.abort();
}

// --- Helpers ---

function sendEvent(ws, type, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, payload }));
}

// --- Start ---

server.listen(PORT, () => {
  console.log(`Kimi IDE server listening on :${PORT}`);
  console.log(`Project CWD: ${PROJECT_CWD}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
