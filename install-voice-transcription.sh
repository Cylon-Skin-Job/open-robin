#!/bin/bash
#
# Voice Transcription Setup Script
# Installs Whisper V3 (large-v3-turbo) for local voice input
#

set -e

echo "🎙️  Setting up Voice Transcription for kimi-claude"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -d "kimi-ide-server" ] || [ ! -d "kimi-ide-client" ]; then
    echo -e "${RED}Error: Run this from the kimi-claude project root${NC}"
    exit 1
fi

echo "Step 1/4: Installing server dependencies..."
cd kimi-ide-server
npm install
if ! npm list nodejs-whisper >/dev/null 2>&1; then
    npm install nodejs-whisper multer
fi
cd ..
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

echo "Step 2/4: Checking for FFmpeg..."
if command -v ffmpeg &> /dev/null; then
    echo -e "${GREEN}✓ FFmpeg found:${NC} $(ffmpeg -version | head -1)"
else
    echo -e "${YELLOW}⚠ FFmpeg not found. Installing...${NC}"
    if command -v brew &> /dev/null; then
        brew install ffmpeg
    else
        echo -e "${RED}Please install FFmpeg manually:${NC}"
        echo "  macOS: brew install ffmpeg"
        echo "  Ubuntu: sudo apt install ffmpeg"
        exit 1
    fi
fi
echo ""

echo "Step 3/4: Downloading Whisper V3 Turbo model..."
echo "   (This is ~1.5GB and will take a few minutes)"
echo ""
cd kimi-ide-server
node lib/transcription/setup.js
cd ..
echo ""

echo "Step 4/4: Rebuilding client and restarting server..."
./restart-kimi.sh &
echo ""

echo -e "${GREEN}🎉 Voice transcription is ready!${NC}"
echo ""
echo "How to use:"
echo "  1. Click the 🎙️ microphone button below chat input"
echo "  2. Click 'Click to start' and speak (max 30s)"
echo "  3. Watch the pulsing red indicator and countdown"
echo "  4. Text appears automatically in your chat input"
echo ""
echo "The server is restarting in the background."
echo "Wait 5 seconds, then refresh your browser."
