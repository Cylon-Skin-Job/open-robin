# Transcription Module Integration

## Quick Setup

### 1. Install Dependencies

```bash
cd kimi-ide-server
npm install nodejs-whisper multer
```

### 2. Download the Model (One-time)

```bash
node lib/transcription/setup.js
```

Or manually:
```bash
npx nodejs-whisper download large-v3-turbo
```

### 3. Add to Server

Add these **3 lines** to `server.js` after creating the Express app:

```javascript
// Add at the top with other requires
const transcription = require('./lib/transcription');

// Add after: const app = express();
app.use('/api', transcription.createRouter());
```

That's it. The module handles everything else internally.

## API Endpoints

- `GET /api/health` - Check if model is loaded
- `POST /api/transcribe` - Upload audio file, get transcription

## Testing

```bash
curl -X POST http://localhost:3001/api/transcribe \
  -F "audio=@test.webm" \
  -F "language=en"
```

Response:
```json
{
  "success": true,
  "text": "Transcribed text here...",
  "model": "large-v3-turbo"
}
```
