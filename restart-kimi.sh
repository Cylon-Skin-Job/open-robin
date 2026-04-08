#!/bin/bash
# Restart script for Kimi IDE - kills ALL node servers, not just by port

set -e

# Kill ALL node server.js processes (catches worktree zombies)
# Use pgrep to find all 'node server.js' processes and kill them
pkill -9 -f "node.*server\.js" 2>/dev/null || true

# Also kill anything on port 3001 as backup
lsof -ti:3001 | xargs kill -9 2>/dev/null || true

sleep 1

# Verify nothing is left on 3001
if lsof -ti:3001 >/dev/null 2>&1; then
  echo "ERROR: Something is still using port 3001"
  lsof -i:3001
  exit 1
fi

# Build frontend (fails loudly if TypeScript errors)
cd ~/projects/open-robin/open-robin-client && npm run build

# Start server from the MAIN project directory (not a worktree)
cd ~/projects/open-robin/open-robin-server && node server.js &
sleep 2

# Verify server started and is serving correct bundle
echo "Verifying server..."
BUNDLE=$(curl -s http://localhost:3001/index.html | grep -o 'index-.*\.js' | head -1)
echo "Serving bundle: $BUNDLE"

echo ""
echo "READY - Hard refresh browser: Cmd+Shift+R"
echo "http://localhost:3001"
