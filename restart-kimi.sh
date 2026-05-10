#!/bin/bash
# Restart script for fusion-studio — project-scoped.
# Kills only this project's server (by pidfile + full path), never generic node server.js.

set -e

PROJECT_DIR="$HOME/projects/open-robin"
SERVER_PATH="$PROJECT_DIR/open-robin-server/server.js"
PID_FILE="/tmp/fusion-studio.pid"
LOG_FILE="/tmp/fusion-studio.log"
PORT=3001

# 1. Kill previous instance by pidfile, if present.
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# 2. Fallback: kill any stray process running THIS project's server.js (by full path).
pkill -9 -f "open-robin-server/server\.js" 2>/dev/null || true

# 3. Last-resort: kill anything still holding our port.
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

sleep 1

# Verify port is free
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "ERROR: Something is still using port $PORT"
  lsof -i:$PORT
  exit 1
fi

# Build frontend (fails loudly if TypeScript errors)
cd "$PROJECT_DIR/open-robin-client" && npm run build

# Start server from the main project directory. Capture stdout+stderr to log file;
# record PID for next restart. Disown so the process outlives this shell.
cd "$PROJECT_DIR/open-robin-server"
: > "$LOG_FILE"
nohup node server.js >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"
disown "$SERVER_PID" 2>/dev/null || true

sleep 2

# Verify server is actually up
if ! curl -sf -o /dev/null "http://localhost:$PORT"; then
  echo "ERROR: Server did not come up. Last 30 lines of $LOG_FILE:"
  tail -30 "$LOG_FILE"
  exit 1
fi

BUNDLE=$(curl -s "http://localhost:$PORT/index.html" | grep -o 'index-.*\.js' | head -1)

echo "PID:    $SERVER_PID  (written to $PID_FILE)"
echo "Log:    $LOG_FILE"
echo "Bundle: $BUNDLE"
echo "URL:    http://localhost:$PORT"
