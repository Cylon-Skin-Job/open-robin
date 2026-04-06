/**
 * @module transcription
 * @role Self-hosted Whisper V3 transcription service
 * @description Standalone voice transcription module using nodejs-whisper
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Lazy-load nodejs-whisper only when needed
let nodewhisper = null;
let modelReady = false;
let modelLoading = false;

const DEFAULT_MODEL = 'large-v3-turbo';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Temp directory for audio uploads
const tempDir = path.join(os.tmpdir(), 'kimi-transcription');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${uniqueName}.webm`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/x-matroska'];
    // Accept audio types, video types (webm), or application/octet-stream (some browsers send this)
    if (allowedTypes.includes(file.mimetype) || 
        file.mimetype.startsWith('audio/') || 
        file.mimetype.startsWith('video/') ||
        file.mimetype === 'application/octet-stream' ||
        file.originalname.endsWith('.webm')) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`), false);
    }
  }
});

/**
 * Initialize the whisper model (lazy loading)
 */
async function initWhisper() {
  if (modelReady || modelLoading) return;
  
  modelLoading = true;
  console.log('[Transcription] Initializing Whisper model...');
  
  try {
    const whisper = require('nodejs-whisper');
    nodewhisper = whisper.nodewhisper;
    
    // Download model if not present
    const modelPath = path.join(require('os').homedir(), '.whisper', `ggml-${DEFAULT_MODEL}.bin`);
    if (!fs.existsSync(modelPath)) {
      console.log(`[Transcription] Downloading ${DEFAULT_MODEL} model...`);
      const { execSync } = require('child_process');
      execSync(`npx nodejs-whisper download ${DEFAULT_MODEL}`, { stdio: 'inherit' });
    }
    
    modelReady = true;
    console.log('[Transcription] Whisper model ready');
  } catch (error) {
    console.error('[Transcription] Failed to initialize Whisper:', error.message);
    throw error;
  } finally {
    modelLoading = false;
  }
}

/**
 * Transcribe audio file using Whisper
 */
async function transcribeAudio(filePath, options = {}) {
  if (!modelReady) {
    await initWhisper();
  }

  const {
    language = 'auto',
    outputFormat = 'txt'
  } = options;

  const whisperOptions = {
    outputInText: outputFormat === 'txt',
    outputInJson: outputFormat === 'json',
    outputInSrt: outputFormat === 'srt',
    language: language === 'auto' ? undefined : language,
  };

  const result = await nodewhisper(filePath, {
    modelName: DEFAULT_MODEL,
    removeWavFileAfterTranscription: false, // We handle cleanup
    whisperOptions,
  });

  return result;
}

/**
 * Extract plain text from Whisper output
 * Removes timestamp tags like [00:00:00.000 --> 00:00:02.000]
 */
function extractText(result, format = 'txt') {
  let text = '';
  
  if (typeof result === 'string') {
    text = result;
  } else if (format === 'json' && result.json) {
    try {
      const data = JSON.parse(result.json);
      text = data.text || '';
    } catch {
      text = '';
    }
  } else {
    text = result.text || result.toString() || '';
  }
  
  // Remove timestamp tags: [00:00:00.000 --> 00:00:02.000]
  text = text.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]/g, '');
  
  // Clean up extra whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Cleanup temp files
 */
function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn('[Transcription] Cleanup failed:', error.message);
  }
}

/**
 * Create Express router with transcription routes
 */
function createRouter() {
  const router = express.Router();

  // Health check
  router.get('/health', (req, res) => {
    res.json({
      status: modelReady ? 'ready' : modelLoading ? 'loading' : 'not_initialized',
      model: DEFAULT_MODEL
    });
  });

  // Main transcription endpoint
  router.post('/transcribe', upload.single('audio'), async (req, res) => {
    const filePath = req.file?.path;
    
    if (!filePath) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    try {
      console.log('[Transcription] Processing:', req.file.originalname);
      
      const result = await transcribeAudio(filePath, {
        language: req.body.language || 'auto',
        outputFormat: 'txt'
      });

      const text = extractText(result, 'txt');
      
      res.json({
        success: true,
        text,
        model: DEFAULT_MODEL,
        duration: req.body.duration || null
      });

    } catch (error) {
      console.error('[Transcription] Error:', error.message);
      res.status(500).json({
        error: 'Transcription failed',
        message: error.message
      });
    } finally {
      cleanup(filePath);
    }
  });

  return router;
}

module.exports = {
  createRouter,
  initWhisper,
  transcribeAudio,
  DEFAULT_MODEL
};
