# Voice Transcription Module

Self-hosted Whisper V3 transcription for kimi-claude. Fast, local, private.

## What You Get

- **30-second voice recordings** with visual countdown timer
- **Real-time audio visualization** (waveform + level indicator)
- **large-v3-turbo model** (~8x faster than standard large-v3)
- **Automatic transcription** pasted into chat input
- **100% offline** - no API keys, no cloud, no costs

## Quick Start

### 1. Install Dependencies

```bash
cd /Users/rccurtrightjr./projects/kimi-claude/kimi-ide-server
npm install
```

### 2. Download the Model (One-time, ~1.5GB)

```bash
npm run setup-transcription
```

This downloads the `large-v3-turbo` model. It takes a few minutes.

### 3. Rebuild & Restart

```bash
cd /Users/rccurtrightjr./projects/kimi-claude
./restart-kimi.sh
```

### 4. Test It

1. Click the **microphone button** below the chat input
2. Click **"Click to start"** in the modal
3. Speak for up to 30 seconds
4. Watch the **red recording indicator** pulse with your voice
5. See the **countdown timer** and **waveform** respond to audio
6. Either:
   - Let it auto-stop at 0:00
   - Click **"Done"** to stop early
7. Transcribed text appears in your chat input

## How It Works

```
┌─────────────────────────────────────────┐
│  🎙️ Voice Input              0:28       │  ← 30s countdown
│                                         │
│       ╭─────────────╮                   │
│      ╱   🔴         ╲                  │  ← Pulsing red
│     │    🎤         │                  │     indicator
│      ╲   ▓▓▓▓▓▓▓   ╱                  │  ← Waveform bars
│       ╰─────────────╯                   │    (react to voice)
│                                         │
│            [ Done ]                     │  ← Manual stop
│                                         │
│  Recording... Auto-stops at 0:00        │
└─────────────────────────────────────────┘
```

## Model Info

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| `large-v3-turbo` | 1.5 GB | ~8x faster than large-v3 | ~95% of large-v3 |

- **Apple Silicon optimized** (uses Neural Engine when available)
- **First transcription** takes ~5s (model warmup)
- **Subsequent transcriptions** are near real-time

## File Structure

```
kimi-ide-server/lib/transcription/
├── index.js          # Main module - creates Express routes
├── setup.js          # One-time model download
├── INTEGRATION.md    # How to add to server.js
└── README.md         # This file

kimi-ide-client/src/mic/
├── MicTrigger.tsx       # Microphone button + modal
├── VoiceRecorder.tsx    # Recording UI with timer
├── VoiceRecorder.css    # Styles
└── index.ts             # Exports
```

## Troubleshooting

### "Model not found"
Run `npm run setup-transcription` to download the model.

### "FFmpeg not found"
```bash
brew install ffmpeg
```

### "Microphone permission denied"
- macOS: Go to **System Settings > Privacy & Security > Microphone**
- Enable for your browser

### First transcription is slow
This is normal. The model loads into memory on first use (~2-3 seconds).

### Transcription quality issues
- Speak clearly, closer to microphone
- Reduce background noise
- The turbo model trades some accuracy for speed - if you need maximum accuracy, edit `lib/transcription/index.js` and change `DEFAULT_MODEL` to `'large-v3'`

## API Reference

### `POST /api/transcribe`

Upload audio file, get transcription.

**Request:**
```bash
curl -X POST http://localhost:3001/api/transcribe \
  -F "audio=@recording.webm" \
  -F "language=en"
```

**Response:**
```json
{
  "success": true,
  "text": "This is what you said...",
  "model": "large-v3-turbo"
}
```

### `GET /api/health`

Check if transcription service is ready.

**Response:**
```json
{
  "status": "ready",
  "model": "large-v3-turbo"
}
```
