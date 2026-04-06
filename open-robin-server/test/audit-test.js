/**
 * Audit Logging Test
 * 
 * Tests that message_id and plan_mode are captured from StatusUpdate
 * and persisted to the exchanges table via the audit subscriber.
 */

const WebSocket = require('ws');
const { initDb, getDb } = require('../lib/db');
const path = require('path');

const SERVER_URL = 'ws://localhost:3001';
const TEST_TIMEOUT = 90000;

// Test configuration - use an existing panel
const TEST_PANEL = 'code-viewer';
const TEST_THREAD_NAME = `audit-test-${Date.now()}`;
const TEST_MESSAGE = 'Hello, this is an audit test. Please respond with a short greeting.';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryLatestExchange(threadId) {
  const db = getDb();
  const row = await db('exchanges')
    .where('thread_id', threadId)
    .orderBy('seq', 'desc')
    .first();
  
  if (!row) return null;
  
  // Parse metadata
  let metadata = {};
  try {
    metadata = JSON.parse(row.metadata || '{}');
    if (Array.isArray(metadata)) metadata = {};
  } catch {
    metadata = {};
  }
  
  return {
    seq: row.seq,
    user: row.user_input,
    metadata
  };
}

async function runTest() {
  // Initialize DB connection first
  await initDb('/Users/rccurtrightjr./projects/kimi-claude');
  console.log('[DB] Initialized\n');
  
  console.log('=== Audit Logging Test ===\n');
  console.log(`Panel: ${TEST_PANEL}`);
  console.log(`Server: ${SERVER_URL}\n`);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    let testThreadId = null;
    let state = 'connecting'; // connecting -> panel_set -> thread_created -> thread_opened -> prompt_sent -> done
    let statusUpdateReceived = false;
    let turnEndReceived = false;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Test timeout after ${TEST_TIMEOUT}ms (state: ${state})`));
    }, TEST_TIMEOUT);

    ws.on('open', () => {
      console.log('[WS] Connected to server');
    });

    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      
      // Only log important messages
      if (!['content', 'status_update'].includes(msg.type)) {
        console.log(`[WS] Received: ${msg.type}`);
      }
      
      // State machine
      if (msg.type === 'connected' && state === 'connecting') {
        // Send set_panel now that we're connected
        ws.send(JSON.stringify({
          type: 'set_panel',
          panel: TEST_PANEL
        }));
        return;
      }
      
      if (msg.type === 'panel_changed' && state === 'connecting') {
        state = 'panel_set';
        console.log('[WS] Panel set, creating thread...');
        ws.send(JSON.stringify({
          type: 'thread:create',
          name: TEST_THREAD_NAME
        }));
        return;
      }
      
      if (msg.type === 'thread:created' && state === 'panel_set') {
        testThreadId = msg.threadId;
        state = 'thread_created';
        console.log(`[WS] Thread created: ${testThreadId}`);
        
        // Open the thread
        ws.send(JSON.stringify({
          type: 'thread:open',
          threadId: testThreadId
        }));
        return;
      }
      
      if (msg.type === 'thread:opened' && state === 'thread_created') {
        state = 'thread_opened';
        console.log('[WS] Thread opened, waiting for wire...');
        await sleep(2000); // Wait for wire to fully initialize
        
        console.log('[WS] Sending prompt...');
        state = 'prompt_sent';
        ws.send(JSON.stringify({
          type: 'prompt',
          user_input: TEST_MESSAGE,
          threadId: testThreadId
        }));
        return;
      }
      
      if (msg.type === 'status_update' && state === 'prompt_sent') {
        if (!statusUpdateReceived) {
          statusUpdateReceived = true;
          console.log('[WS] StatusUpdate received (first)');
        }
        return;
      }
      
      if (msg.type === 'content' && state === 'prompt_sent') {
        process.stdout.write('.');
        return;
      }
      
      if (msg.type === 'turn_end' && state === 'prompt_sent' && !turnEndReceived) {
        turnEndReceived = true;
        console.log('\n[WS] TurnEnd received');
        
        // Wait a bit for the subscriber to persist
        await sleep(1000);
        
        // Query the database
        const exchange = await queryLatestExchange(testThreadId);
        
        if (!exchange) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error('No exchange found in database'));
          return;
        }
        
        console.log('\n=== Database Query Result ===');
        console.log(`Thread ID: ${testThreadId}`);
        console.log(`Sequence: ${exchange.seq}`);
        console.log(`User input: ${exchange.user.substring(0, 50)}...`);
        console.log(`Metadata:`);
        console.log(`  messageId: ${exchange.metadata.messageId || 'NOT CAPTURED ❌'}`);
        console.log(`  planMode: ${exchange.metadata.planMode !== undefined ? exchange.metadata.planMode : 'NOT CAPTURED ❌'}`);
        console.log(`  contextUsage: ${exchange.metadata.contextUsage !== undefined ? exchange.metadata.contextUsage : 'N/A'}`);
        console.log(`  capturedAt: ${exchange.metadata.capturedAt ? new Date(exchange.metadata.capturedAt).toISOString() : 'N/A'}`);
        
        // Verify results
        const hasMessageId = !!exchange.metadata.messageId;
        const hasPlanMode = exchange.metadata.planMode !== undefined;
        
        clearTimeout(timeout);
        ws.close();
        
        if (hasMessageId && hasPlanMode) {
          console.log('\n✅ TEST PASSED: message_id and plan_mode captured successfully');
          resolve({
            messageId: exchange.metadata.messageId,
            planMode: exchange.metadata.planMode,
            exchange
          });
        } else {
          reject(new Error(
            `TEST FAILED: Missing fields - ` +
            `messageId: ${hasMessageId ? 'OK' : 'MISSING'}, ` +
            `planMode: ${hasPlanMode ? 'OK' : 'MISSING'}`
          ));
        }
        return;
      }
      
      if (msg.type === 'error') {
        // Ignore errors during setup, but fail if we're in prompt_sent state
        if (state === 'prompt_sent') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`Server error: ${msg.message || JSON.stringify(msg)}`));
        }
        return;
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err.message}`));
    });

    ws.on('close', () => {
      console.log('[WS] Connection closed');
    });
  });
}

// Run the test
runTest()
  .then((result) => {
    console.log('\n=== Test Summary ===');
    console.log(`Message ID: ${result.messageId}`);
    console.log(`Plan Mode: ${result.planMode}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n=== Test Failed ===');
    console.error(err.message);
    process.exit(1);
  });
