# Server Integration Guide

This document shows how to integrate the thread management system into `server.js`.

## Step 1: Add Import

At the top of `server.js`, add:

```javascript
const { ThreadWebSocketHandler } = require('./lib/thread');
const { createWebSocketHandler } = require('./lib/thread/server-integration');
```

## Step 2: Replace WebSocket Handler

Replace the existing `wss.on('connection', ...)` handler:

**Before:**
```javascript
wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  
  // Spawn wire process for this client
  const projectRoot = getDefaultProjectRoot();
  const wire = spawnWireSession(projectRoot);
  const sessionId = generateId();
  
  const session = {
    wire,
    sessionId,
    currentTurn: null,
    buffer: '',
    toolArgs: {},
    activeToolId: null
  };
  sessions.set(ws, session);
  
  // ... rest of handler
});
```

**After:**
```javascript
// Create thread-enabled WebSocket handler
const handleConnection = createWebSocketHandler({
  sessions,
  getDefaultProjectRoot,
  logWire
});

wss.on('connection', handleConnection);
```

## Step 3: Handle set_workspace Message

In the message handler, add thread workspace setup:

```javascript
else if (clientMsg.type === 'set_workspace') {
  const { workspace, rootFolder } = clientMsg;
  if (workspace) {
    setSessionRoot(ws, workspace, rootFolder || null);
    
    // Set up thread management for this workspace
    const aiWorkspacesPath = path.join(__dirname, '..', '..', 'ai', 'workspaces');
    ThreadWebSocketHandler.setWorkspace(ws, workspace, aiWorkspacesPath);
    
    // Send thread list
    await ThreadWebSocketHandler.sendThreadList(ws);
    
    ws.send(JSON.stringify({
      type: 'workspace_changed',
      workspace,
      rootFolder: rootFolder || getDefaultProjectRoot()
    }));
  }
}
```

## Step 4: Remove Old Session Code

Remove the old `sessions` Map and related code since the new handler manages sessions.

## Complete Integration Patch

```diff
--- a/kimi-ide-server/server.js
+++ b/kimi-ide-server/server.js
@@ -6,6 +6,8 @@ const http = require('http');
 const { spawn } = require('child_process');
 const { v4: uuidv4 } = require('uuid');
 const fs = require('fs');
 const fsPromises = require('fs').promises;
+const { ThreadWebSocketHandler } = require('./lib/thread');
+const { createWebSocketHandler } = require('./lib/thread/server-integration');
 
 // Config system for persistence
 const config = require('./config');
@@ -350,187 +352,9 @@ async function handleFileContentRequest(ws, msg) {
 
 // WebSocket connection handling
-wss.on('connection', (ws) => {
-  console.log('[WS] Client connected');
-  
-  // Spawn wire process for this client
-  // Use the same project root that the file viewer uses (kimi-claude, not kimi-ide-server)
-  const projectRoot = getDefaultProjectRoot();
-  const wire = spawnWireSession(projectRoot);
-  const sessionId = generateId();
-  
-  // Session state
-  const session = {
-    wire,
-    sessionId,
-    currentTurn: null, // { id, text, status }
-    buffer: '',
-    toolArgs: {},       // accumulate ToolCallPart args per tool_call_id
-    activeToolId: null   // track which tool_call_id is currently streaming args
-  };
-  sessions.set(ws, session);
-  
-  // Forward wire stdout to WebSocket
-  wire.stdout.on('data', (data) => {
-    // ... existing wire handling code
-  });
-  
-  // Handle messages from client
-  ws.on('message', (message) => {
-    // ... existing message handling
-  });
-  
-  // Handle disconnect
-  ws.on('close', () => {
-    console.log('[WS] Client disconnected');
-    if (session.wire && !session.wire.killed) {
-      session.wire.kill('SIGTERM');
-    }
-    sessions.delete(ws);
-  });
-});
+const handleConnection = createWebSocketHandler({
+  sessions,
+  getDefaultProjectRoot,
+  logWire
+});
+
+wss.on('connection', handleConnection);
```

## Alternative: Minimal Integration

If you want to keep the existing server structure and just add thread support:

```javascript
// At the top
const { ThreadWebSocketHandler } = require('./lib/thread');

// In wss.on('connection', ...)
// Add after set_workspace handling:
if (clientMsg.type === 'set_workspace') {
  const { workspace, rootFolder } = clientMsg;
  
  // Existing code...
  setSessionRoot(ws, workspace, rootFolder || null);
  
  // Add thread support
  const aiWorkspacesPath = path.join(__dirname, '..', '..', 'ai', 'workspaces');
  ThreadWebSocketHandler.setWorkspace(ws, workspace, aiWorkspacesPath);
  
  // Send thread list to client
  ThreadWebSocketHandler.sendThreadList(ws).catch(console.error);
}

// Add new message handlers:
else if (clientMsg.type === 'thread:create') {
  await ThreadWebSocketHandler.handleThreadCreate(ws, clientMsg);
}
else if (clientMsg.type === 'thread:open') {
  // Close existing wire if any
  const session = sessions.get(ws);
  if (session?.wire) {
    session.wire.kill('SIGTERM');
    session.wire = null;
  }
  
  // Open thread
  await ThreadWebSocketHandler.handleThreadOpen(ws, clientMsg);
  
  // Spawn new wire with --session
  const state = ThreadWebSocketHandler.getState(ws);
  const projectRoot = getDefaultProjectRoot();
  session.wire = spawnThreadWire(clientMsg.threadId, projectRoot);
  
  // Set up wire handlers (existing code)
  setupWireHandlers(session.wire, ws, session);
  
  // Register with ThreadManager
  await state.threadManager.openSession(clientMsg.threadId, session.wire, ws);
}
// ... other thread handlers

// On disconnect:
ws.on('close', () => {
  ThreadWebSocketHandler.cleanup(ws);
  // ... existing cleanup
});
```

## Testing the Integration

1. Start the server: `node server.js`
2. Open the client in browser
3. Switch to a workspace
4. You should receive `thread:list` message (may be empty initially)
5. Send `thread:create` to create a new thread
6. The thread should auto-open
7. Send `prompt` messages - they go to the current thread
8. Try `thread:open` with a different thread ID to switch

## Debugging

Enable verbose logging:

```javascript
// In server-integration.js
const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log('[Thread]', ...args);
}
```

Check thread storage:

```bash
# List all threads
ls ai/workspaces/{workspace}/threads/

# View thread index
cat ai/workspaces/{workspace}/threads/threads.json

# View chat history
cat ai/workspaces/{workspace}/threads/{thread-id}/CHAT.md
```
