#!/usr/bin/env node
/**
 * Simulation of Codex chat exchange.
 * Mocks the CLI process to verify streaming content and tool calls.
 */

const { CodexHarness } = require('./index');
const { EventEmitter } = require('events');
const path = require('path');

// Mock child_process.spawn
const child_process = require('child_process');
const originalSpawn = child_process.spawn;

function mockSpawn(command, args, options) {
  const proc = new EventEmitter();
  proc.pid = 9999;
  proc.stdin = {
    write: (data) => {
      console.log(`[MOCK STDIN] ${data.trim()}`);
      
      // Auto-respond to initialize and session/new
      try {
        const msg = JSON.parse(data);
        if (msg.method === 'initialize') {
          setTimeout(() => {
            proc.stdout.emit('data', JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { protocolVersion: 1 }
            }) + '\n');
          }, 10);
        } else if (msg.method === 'session/new') {
          setTimeout(() => {
            proc.stdout.emit('data', JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { 
                sessionId: 'sess-test-123',
                models: { currentModelId: 'gpt-4o' },
                modes: { currentModeId: 'full-auto' }
              }
            }) + '\n');
          }, 20);
        } else if (msg.method === 'session/prompt') {
          // Simulate the chat exchange
          simulateChatFlow(proc, 'sess-test-123', msg.id);
        }
      } catch (e) {}
    }
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {
    proc.killed = true;
    proc.emit('exit', 0);
  };

  return proc;
}

function simulateChatFlow(proc, sessionId, promptId) {
  const send = (msg) => {
    proc.stdout.emit('data', JSON.stringify(msg) + '\n');
  };

  // 1. Thinking
  setTimeout(() => {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'I will check the current directory...' }
        }
      }
    });
  }, 100);

  // 2. Tool Call
  setTimeout(() => {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-abc-123',
          toolName: 'listDirectory',
          title: 'Listing files',
          rawInput: '{"dir_path": "."}'
        }
      }
    });
  }, 200);

  // 3. Tool Result (simulated as if the CLI executed it)
  setTimeout(() => {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-abc-123',
          status: 'completed',
          content: [{ type: 'text', text: 'file1.js\nfile2.js' }]
        }
      }
    });
  }, 300);

  // 4. Content Chunks (Streaming)
  const chunks = ['I ', 'found ', 'two ', 'files: ', 'file1.js ', 'and ', 'file2.js.'];
  chunks.forEach((text, i) => {
    setTimeout(() => {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text }
          }
        }
      });
    }, 400 + (i * 50));
  });

  // 5. Turn End with Token Usage
  setTimeout(() => {
    send({
      jsonrpc: '2.0',
      id: promptId,
      result: {
        stopReason: 'end_turn',
        _meta: {
          usage: {
            inputTokens: 150,
            outputTokens: 75
          }
        }
      }
    });
  }, 400 + (chunks.length * 50) + 100);
}

// Override spawn
child_process.spawn = mockSpawn;

async function runSimulation() {
  console.log('=== Codex CLI Harness Simulation ===\n');

  const harness = new CodexHarness();
  
  // Mock isInstalled to return true
  harness.isInstalled = async () => true;
  harness.cliPath = 'codex-acp';

  const threadId = 'thread-sim-123';
  const projectRoot = '/tmp/test-project';

  await harness.initialize({
    model: 'gpt-4o',
    mode: 'full-auto'
  });

  console.log('1. Starting thread and initializing session...');
  
  const recordedEvents = [];
  harness.on('event', ({ event }) => {
    recordedEvents.push(event);
    console.log(`[EVENT] ${event.type.padEnd(15)} | ${JSON.stringify(event).substring(0, 100)}${JSON.stringify(event).length > 100 ? '...' : ''}`);
  });

  const session = await harness.startThread(threadId, projectRoot);
  
  console.log('\n2. Sending prompt: "What files are here?"');
  
  // Use the async generator
  const iterator = session.sendMessage("What files are here?");
  
  for await (const event of iterator) {
    // Events are already being logged by the harness.on('event') listener
  }

  console.log('\n3. Simulation complete. Verifying results...');

  const hasThinking = recordedEvents.some(e => e.type === 'thinking');
  const hasContent = recordedEvents.some(e => e.type === 'content');
  const hasToolCall = recordedEvents.some(e => e.type === 'tool_call');
  const hasToolResult = recordedEvents.some(e => e.type === 'tool_result');
  const hasTurnEnd = recordedEvents.some(e => e.type === 'turn_end');
  
  console.log(`   Thinking:    ${hasThinking ? '✅' : '❌'}`);
  console.log(`   Content:     ${hasContent ? '✅' : '❌'}`);
  console.log(`   Tool Call:   ${hasToolCall ? '✅' : '❌'}`);
  console.log(`   Tool Result: ${hasToolResult ? '✅' : '❌'}`);
  console.log(`   Turn End:    ${hasTurnEnd ? '✅' : '❌'}`);

  const turnEndEvent = recordedEvents.find(e => e.type === 'turn_end');
  if (turnEndEvent && turnEndEvent._meta?.tokenUsage) {
    console.log(`   Token Usage: ✅ (${JSON.stringify(turnEndEvent._meta.tokenUsage)})`);
  } else {
    console.log(`   Token Usage: ❌`);
  }

  if (hasThinking && hasContent && hasToolCall && hasToolResult && hasTurnEnd) {
    console.log('\n✅ ALL VERIFICATIONS PASSED');
  } else {
    console.log('\n❌ SOME VERIFICATIONS FAILED');
    process.exit(1);
  }
}

runSimulation().catch(err => {
  console.error(err);
  process.exit(1);
});
