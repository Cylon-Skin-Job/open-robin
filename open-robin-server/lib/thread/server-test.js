/**
 * Integration Test for server-with-threads.js
 * 
 * Tests the WebSocket protocol with actual server
 * Run with: node lib/thread/server-test.js
 * 
 * Note: This requires the server to be running on localhost:3001
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs').promises;

const SERVER_URL = 'ws://localhost:3001';
const TEST_TIMEOUT = 30000;

// Test utilities
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    
    const timeout = setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 5000);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForMessage(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${type}`));
    }, timeout);
    
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    
    ws.on('message', handler);
  });
}

async function testConnection() {
  console.log('\n🔌 Testing connection...');
  
  const ws = await createWebSocket();
  
  const connected = await waitForMessage(ws, 'connected');
  if (!connected.connectionId) throw new Error('No connectionId received');
  
  console.log('✅ Connected:', connected.connectionId);
  
  ws.close();
}

async function testThreadCreate() {
  console.log('\n📝 Testing thread:open-assistant (create)...');
  
  const ws = await createWebSocket();
  await waitForMessage(ws, 'connected');
  
  // Create thread (no threadId → dispatcher creates new)
  ws.send(JSON.stringify({ type: 'thread:open-assistant' }));

  const created = await waitForMessage(ws, 'thread:created');
  if (!created.threadId) throw new Error('No threadId received');
  
  console.log('✅ Thread created:', created.threadId);
  
  // Should also get thread:list
  const list = await waitForMessage(ws, 'thread:list');
  if (!list.threads || list.threads.length === 0) {
    throw new Error('Thread list empty');
  }
  
  console.log('✅ Thread list received:', list.threads.length, 'threads');
  
  ws.close();
  return created.threadId;
}

async function testThreadRename(threadId) {
  console.log('\n✏️ Testing thread:rename...');
  
  const ws = await createWebSocket();
  await waitForMessage(ws, 'connected');
  
  ws.send(JSON.stringify({
    type: 'thread:rename',
    threadId,
    name: 'Renamed Thread'
  }));
  
  const renamed = await waitForMessage(ws, 'thread:renamed');
  if (renamed.name !== 'Renamed Thread') {
    throw new Error('Rename failed');
  }
  
  console.log('✅ Thread renamed');
  
  ws.close();
}

async function testThreadOpen(threadId) {
  console.log('\n📂 Testing thread:open-assistant (resume)...');

  const ws = await createWebSocket();
  await waitForMessage(ws, 'connected');

  ws.send(JSON.stringify({ type: 'thread:open-assistant', threadId }));

  const opened = await waitForMessage(ws, 'thread:opened');
  if (opened.threadId !== threadId) {
    throw new Error('Wrong thread opened');
  }
  
  console.log('✅ Thread opened:', opened.thread?.name);
  
  ws.close();
}

async function testMessageSend(threadId) {
  console.log('\n💬 Testing message:send...');
  
  const ws = await createWebSocket();
  await waitForMessage(ws, 'connected');
  
  // Open thread first
  ws.send(JSON.stringify({ type: 'thread:open-assistant', threadId }));
  await waitForMessage(ws, 'thread:opened');
  
  // Send a prompt (which triggers message tracking)
  ws.send(JSON.stringify({ type: 'prompt', user_input: 'Hello from test' }));
  
  // Wait for turn_begin
  const turnBegin = await waitForMessage(ws, 'turn_begin');
  console.log('✅ Turn started:', turnBegin.turnId);
  
  // Wait for turn_end or timeout
  try {
    const turnEnd = await waitForMessage(ws, 'turn_end', 10000);
    console.log('✅ Turn completed:', turnEnd.fullText?.slice(0, 50));
  } catch (e) {
    console.log('⚠️  Turn timeout (expected if no API key)');
  }
  
  ws.close();
}

async function testThreadDelete(threadId) {
  console.log('\n🗑️ Testing thread:delete...');
  
  const ws = await createWebSocket();
  await waitForMessage(ws, 'connected');
  
  ws.send(JSON.stringify({ type: 'thread:delete', threadId }));
  
  const deleted = await waitForMessage(ws, 'thread:deleted');
  if (deleted.threadId !== threadId) {
    throw new Error('Wrong thread deleted');
  }
  
  console.log('✅ Thread deleted');
  
  ws.close();
}

async function runTests() {
  console.log('🧪 Server Integration Tests');
  console.log('===========================');
  console.log('Make sure server-with-threads.js is running on port 3001');
  console.log('');
  
  let threadId = null;
  
  try {
    await testConnection();
    threadId = await testThreadCreate();
    await testThreadRename(threadId);
    await testThreadOpen(threadId);
    await testMessageSend(threadId);
    await testThreadDelete(threadId);
    
    console.log('\n===========================');
    console.log('✅ All server tests passed!');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    
    if (err.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Make sure to start the server first:');
      console.log('   node server-with-threads.js');
    }
    
    process.exit(1);
  }
}

// Cleanup function for test data
async function cleanup() {
  const testDir = path.join(__dirname, '..', '..', '..', '..', 'ai', 'views', 'default');
  try {
    await fs.rm(testDir, { recursive: true, force: true });
    console.log('🧹 Cleaned up test data');
  } catch {}
}

if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };
