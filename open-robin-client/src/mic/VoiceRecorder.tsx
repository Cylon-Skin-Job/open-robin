/**
 * @module VoiceRecorder
 * @role Voice recording interface with permission handling, 30s timer and audio visualization
 *
 * FLOW:
 * 1. First time: Show "Grant Permission" button → click → permission granted → immediately start recording
 * 2. Subsequent: Immediately start recording (no buttons)
 * 3. While recording: Show timer, voice visualization, cancel button
 */

import { useAudioCapture } from './useAudioCapture';
import { KittVisualizer } from './KittVisualizer';
import { CountdownRing } from './CountdownRing';

interface VoiceRecorderProps {
  onTranscribe: (text: string) => void;
  onClose: () => void;
  maxDuration?: number;
}

export function VoiceRecorder({ onTranscribe, onClose, maxDuration }: VoiceRecorderProps) {
  const {
    recorderState,
    timeLeft,
    audioLevel,
    errorMessage,
    requestPermissionAndRecord,
    stopRecording,
    handleCancel,
    handleRetry,
    circumference,
    maxDuration: duration,
  } = useAudioCapture({ maxDuration, onTranscribe, onClose });

  if (recorderState === 'checking_permission') {
    return (
      <div className="rv-voice-recorder">
        <div className="rv-voice-recorder__header">
          <span className="rv-voice-recorder__title">Voice Input</span>
        </div>
        <div className="rv-voice-recorder__content">
          <div className="rv-voice-recorder__spinner" />
          <p className="rv-voice-recorder__status-text">Checking microphone...</p>
        </div>
      </div>
    );
  }

  if (recorderState === 'permission_needed') {
    return (
      <div className="rv-voice-recorder">
        <div className="rv-voice-recorder__header">
          <span className="rv-voice-recorder__title">Voice Input</span>
        </div>
        <div className="rv-voice-recorder__content">
          <span className="material-symbols-outlined rv-voice-recorder__icon-lg">mic</span>
          <p className="rv-voice-recorder__status-text">Allow microphone access</p>
          <button className="rv-voice-recorder__grant-btn" onClick={requestPermissionAndRecord}>
            <span className="material-symbols-outlined">mic</span>
            Grant & Record
          </button>
          <button className="rv-voice-recorder__cancel-link" onClick={onClose}>Cancel</button>
        </div>
      </div>
    );
  }

  if (recorderState === 'permission_denied') {
    return (
      <div className="rv-voice-recorder">
        <div className="rv-voice-recorder__header">
          <span className="rv-voice-recorder__title">Voice Input</span>
        </div>
        <div className="rv-voice-recorder__content">
          <span className="material-symbols-outlined rv-voice-recorder__icon-lg--error">mic_off</span>
          <p className="rv-voice-recorder__error">{errorMessage || 'Microphone access denied'}</p>
          <button className="rv-voice-recorder__grant-btn" onClick={handleRetry}>
            <span className="material-symbols-outlined">refresh</span>
            Try Again
          </button>
          <button className="rv-voice-recorder__cancel-link" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  if (recorderState === 'recording') {
    return (
      <div className="rv-voice-recorder">
        <div className="rv-voice-recorder__header">
          <span className="rv-voice-recorder__title">Recording</span>
        </div>
        <CountdownRing timeLeft={timeLeft} maxDuration={duration} circumference={circumference}>
          <KittVisualizer audioLevel={audioLevel} />
        </CountdownRing>
        <div className="rv-voice-recorder__hint">
          Press <kbd>Enter</kbd> to send
        </div>
        <div className="rv-voice-recorder__footer">
          <button className="rv-voice-recorder__btn rv-voice-recorder__btn--secondary" onClick={handleCancel}>
            Cancel
          </button>
          <button className="rv-voice-recorder__btn rv-voice-recorder__btn--primary" onClick={() => stopRecording()}>
            Send
          </button>
        </div>
      </div>
    );
  }

  if (recorderState === 'processing') {
    return (
      <div className="rv-voice-recorder">
        <div className="rv-voice-recorder__header">
          <span className="rv-voice-recorder__title">Transcribing...</span>
        </div>
        <div className="rv-voice-recorder__content">
          <div className="rv-voice-recorder__spinner" />
          <p className="rv-voice-recorder__status-text">Processing audio...</p>
        </div>
      </div>
    );
  }

  return null;
}
