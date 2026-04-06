/**
 * @module VoiceRecorder
 * @role Voice recording interface with permission handling, 30s timer and audio visualization
 * 
 * FLOW:
 * 1. First time: Show "Grant Permission" button → click → permission granted → immediately start recording
 * 2. Subsequent: Immediately start recording (no buttons)
 * 3. While recording: Show timer, voice visualization, cancel button
 */

import { useState, useRef, useEffect, useCallback } from 'react';

interface VoiceRecorderProps {
  onTranscribe: (text: string) => void;
  onClose: () => void;
  maxDuration?: number; // seconds, default 30
}

type RecorderState = 'checking_permission' | 'permission_needed' | 'permission_denied' | 'recording' | 'processing';

const MAX_DURATION = 30;

/**
 * Find the best microphone device - prefers built-in Mac microphone over Continuity (iPhone)
 */
async function getBuiltInMicrophoneDeviceId(): Promise<string | undefined> {
  try {
    // We need to request permission first to get device labels
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Get all audio input devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    
    // Stop the temp stream immediately
    tempStream.getTracks().forEach(track => track.stop());
    
    // Look for built-in Mac microphone patterns (exclude Continuity/iPhone devices)
    const builtInPatterns = [
      /macbook.*microphone/i,
      /macbook.*air.*microphone/i,
      /macbook.*pro.*microphone/i,
      /imac.*microphone/i,
      /mac.*studio.*microphone/i,
      /mac.*mini.*microphone/i,
      /built.in.*microphone/i,
      /internal.*microphone/i,
    ];
    
    const continuityPatterns = [
      /iphone/i,
      /ipad/i,
      /continuity/i,
      /belkin/i,  // Some Continuity docks
    ];
    
    // First, try to find a built-in Mac microphone
    for (const device of audioInputs) {
      const label = device.label.toLowerCase();
      const isBuiltIn = builtInPatterns.some(p => p.test(label));
      const isContinuity = continuityPatterns.some(p => p.test(label));
      
      if (isBuiltIn && !isContinuity) {
        console.log('[VoiceRecorder] Using built-in microphone:', device.label);
        return device.deviceId;
      }
    }
    
    // If no built-in found, exclude Continuity devices and pick the first non-Continuity
    for (const device of audioInputs) {
      const label = device.label.toLowerCase();
      const isContinuity = continuityPatterns.some(p => p.test(label));
      
      if (!isContinuity) {
        console.log('[VoiceRecorder] Using external microphone:', device.label);
        return device.deviceId;
      }
    }
    
    // Fall back to default (will likely be iPhone if that's what macOS selected)
    console.log('[VoiceRecorder] No built-in mic found, using system default');
    return undefined;
    
  } catch (error) {
    console.warn('[VoiceRecorder] Could not enumerate devices:', error);
    return undefined;
  }
}

export function VoiceRecorder({ onTranscribe, onClose, maxDuration = MAX_DURATION }: VoiceRecorderProps) {
  const [recorderState, setRecorderState] = useState<RecorderState>('checking_permission');
  const [timeLeft, setTimeLeft] = useState(maxDuration);
  const [audioLevel, setAudioLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animationRef = useRef<number | null>(null);
  const permissionCheckedRef = useRef(false);

  // Check permission on mount
  useEffect(() => {
    if (permissionCheckedRef.current) return;
    permissionCheckedRef.current = true;
    
    checkExistingPermission();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopRecording(true);
  }, []);

  // Keyboard shortcut: Enter to stop recording and submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (recorderState === 'recording' && e.key === 'Enter' && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        stopRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recorderState]);

  const checkExistingPermission = async () => {
    try {
      // Try to query permission status
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        
        if (result.state === 'granted') {
          // Permission already granted, start recording immediately
          startRecording();
          return;
        } else if (result.state === 'prompt') {
          // Permission not yet requested, show grant button
          setRecorderState('permission_needed');
          return;
        } else {
          // Permission denied
          setRecorderState('permission_denied');
          return;
        }
      }
      
      // Fallback: try to get permission directly
      setRecorderState('permission_needed');
    } catch {
      // If query fails, show grant button
      setRecorderState('permission_needed');
    }
  };

  const requestPermissionAndRecord = useCallback(async () => {
    setErrorMessage(null);
    
    try {
      // Request microphone permission and start recording immediately
      await startRecording();
    } catch (error) {
      console.error('Permission error:', error);
      setRecorderState('permission_denied');
      setErrorMessage('Microphone access was denied. Please enable it in your browser settings.');
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setRecorderState('recording');
      setTimeLeft(maxDuration);
      setAudioLevel(0);
      chunksRef.current = [];

      // Get the built-in microphone device ID (avoids Continuity/iPhone)
      const deviceId = await getBuiltInMicrophoneDeviceId();

      // Get microphone access - prefer built-in Mac mic
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        } 
      });
      streamRef.current = stream;

      // Set up audio visualization
      audioContextRef.current = new AudioContext();
      
      // CRITICAL: Resume AudioContext after user interaction (browser requirement)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.8; // Smoother animation
      source.connect(analyserRef.current);

      // Start visualization loop - focus on voice frequencies (bins 0-20 of 128)
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      const updateLevel = () => {
        if (!analyserRef.current || !streamRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Voice lives in lower frequencies (bins 0-20 of 128 total)
        const voiceBins = dataArray.slice(0, 20);
        const average = voiceBins.reduce((a, b) => a + b) / voiceBins.length;
        // Scale: whisper ~20, normal speech ~80, loud ~150, yelling ~200+
        // We want normal speech to hit around 0.6-0.8 range
        const normalizedLevel = Math.min(average / 235, 1);
        
        setAudioLevel(normalizedLevel);
        animationRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // Set up MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : 'audio/mp4';
      
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await sendForTranscription(blob);
      };

      mediaRecorderRef.current.start(100); // Collect in 100ms chunks

      // Start countdown timer
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } catch (error) {
      console.error('Failed to start recording:', error);
      setRecorderState('permission_denied');
      setErrorMessage('Could not access microphone. Please check permissions.');
    }
  }, [maxDuration]);

  const stopRecording = useCallback((cancelled = false) => {
    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setAudioLevel(0);

    if (cancelled) {
      onClose();
    }
  }, [onClose]);

  const sendForTranscription = async (audioBlob: Blob) => {
    setRecorderState('processing');

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('language', 'auto');
      formData.append('duration', String(maxDuration - timeLeft));

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.text) {
        onTranscribe(result.text);
      } else {
        throw new Error(result.error || 'Transcription failed');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      setRecorderState('permission_denied');
      setErrorMessage('Transcription failed. Please try again.');
    }
  };

  const handleCancel = () => {
    stopRecording(true);
  };

  const handleRetry = () => {
    setErrorMessage(null);
    setRecorderState('permission_needed');
  };

  // Calculate progress ring circumference
  const circumference = 2 * Math.PI * 45;

  // Checking permission state (brief loading state)
  if (recorderState === 'checking_permission') {
    return (
      <div className="voice-recorder">
        <div className="voice-recorder__header">
          <span className="voice-recorder__title">Voice Input</span>
        </div>
        <div className="voice-recorder__content">
          <div className="voice-recorder__spinner" />
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
            Checking microphone...
          </p>
        </div>
      </div>
    );
  }

  // Permission needed state - show grant button
  if (recorderState === 'permission_needed') {
    return (
      <div className="voice-recorder">
        <div className="voice-recorder__header">
          <span className="voice-recorder__title">Voice Input</span>
        </div>
        
        <div className="voice-recorder__content">
          <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--text-dim)' }}>
            mic
          </span>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
            Allow microphone access
          </p>
          <button 
            className="voice-recorder__grant-btn"
            onClick={requestPermissionAndRecord}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>mic</span>
            Grant & Record
          </button>
          <button 
            className="voice-recorder__cancel-link"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Permission denied state
  if (recorderState === 'permission_denied') {
    return (
      <div className="voice-recorder">
        <div className="voice-recorder__header">
          <span className="voice-recorder__title">Voice Input</span>
        </div>
        
        <div className="voice-recorder__content">
          <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--text-error, #ff4444)' }}>
            mic_off
          </span>
          <p className="voice-recorder__error">
            {errorMessage || 'Microphone access denied'}
          </p>
          <button 
            className="voice-recorder__grant-btn"
            onClick={handleRetry}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
            Try Again
          </button>
          <button 
            className="voice-recorder__cancel-link"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Recording state
  if (recorderState === 'recording') {
    // K.I.T.T. style: three vertical bars that rise/fall with voice
    // Range: 4px (silence) to 110px (max) - fills most of the 140px ring
    const barHeight = (level: number) => Math.max(4, 4 + level * 106);
    const progress = ((maxDuration - timeLeft) / maxDuration) * 100;
    const strokeDashoffset = circumference - (progress / 100) * circumference;
    
    return (
      <div className="voice-recorder">
        {/* Header */}
        <div className="voice-recorder__header">
          <span className="voice-recorder__title">Recording</span>
        </div>

        {/* Ring with K.I.T.T. visualizer in center */}
        <div className="voice-recorder__ring-container">
          {/* Progress ring - THIS is the timer */}
          <svg className="voice-recorder__ring" viewBox="0 0 100 100">
            <circle
              className="voice-recorder__ring-bg"
              cx="50"
              cy="50"
              r="45"
            />
            <circle
              className="voice-recorder__ring-fill"
              cx="50"
              cy="50"
              r="45"
              style={{
                strokeDasharray: circumference,
                strokeDashoffset,
                transition: 'stroke-dashoffset 1s linear'
              }}
            />
          </svg>

          {/* K.I.T.T. bars in center - voice synthesizer */}
          <div className="voice-recorder__kitt">
            <div 
              className="voice-recorder__kitt-bar"
              style={{ height: `${barHeight(audioLevel * 0.8)}px` }}
            />
            <div 
              className="voice-recorder__kitt-bar"
              style={{ height: `${barHeight(audioLevel)}px` }}
            />
            <div 
              className="voice-recorder__kitt-bar"
              style={{ height: `${barHeight(audioLevel * 0.6)}px` }}
            />
          </div>
        </div>

        {/* Keyboard hint */}
        <div className="voice-recorder__hint">
          Press <kbd>Enter</kbd> to send
        </div>

        {/* Action buttons */}
        <div className="voice-recorder__footer">
          <button 
            className="voice-recorder__btn voice-recorder__btn--secondary"
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button 
            className="voice-recorder__btn voice-recorder__btn--primary"
            onClick={() => stopRecording()}
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  // Processing state
  if (recorderState === 'processing') {
    return (
      <div className="voice-recorder">
        <div className="voice-recorder__header">
          <span className="voice-recorder__title">Transcribing...</span>
        </div>

        <div className="voice-recorder__content">
          <div className="voice-recorder__spinner" />
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
            Processing audio...
          </p>
        </div>
      </div>
    );
  }

  return null;
}
