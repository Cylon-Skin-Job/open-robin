/**
 * @module transcription/setup
 * @role One-time setup script for transcription service
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODEL = 'large-v3-turbo';

function checkDependencies() {
  console.log('Checking dependencies...\n');
  
  // Check Node version
  const nodeVersion = process.version;
  console.log(`Node.js: ${nodeVersion}`);
  
  // Check if ffmpeg is installed
  try {
    const ffmpegVersion = execSync('ffmpeg -version 2>/dev/null | head -1', { encoding: 'utf8' });
    console.log(`FFmpeg: ${ffmpegVersion.trim()}`);
  } catch {
    console.warn('⚠️  FFmpeg not found. Install it with: brew install ffmpeg');
    process.exit(1);
  }
  
  console.log('');
}

function downloadModel() {
  console.log(`Downloading ${MODEL} model...`);
  console.log('This will take a few minutes...\n');
  
  try {
    execSync(`npx nodejs-whisper download ${MODEL}`, { stdio: 'inherit' });
    console.log('\n✅ Model downloaded successfully');
  } catch (error) {
    console.error('\n❌ Failed to download model:', error.message);
    process.exit(1);
  }
}

function main() {
  console.log('=== Whisper V3 Transcription Setup ===\n');
  
  checkDependencies();
  downloadModel();
  
  console.log('\n🎙️  Transcription service is ready!');
  console.log(`Model: ${MODEL}`);
  console.log('Start the server and test with the microphone button.');
}

if (require.main === module) {
  main();
}

module.exports = { checkDependencies, downloadModel };
