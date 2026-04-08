# SPEC-06: VoiceRecorder.tsx Split

## Context for Executing Session

This is a standalone React component refactoring. Extract reusable hooks and sub-components from a 528-line monolithic component. No server changes. No behavior changes.

**Model recommendation: Sonnet 4.6** — mechanical extraction with clear boundaries.

**File:** `open-robin-client/src/mic/VoiceRecorder.tsx` — 528 lines

---

## Problem

VoiceRecorder.tsx manages microphone permissions, device selection, audio recording, KITT visualization, countdown timer, keyboard shortcuts, transcription submission, and cleanup in one file. It has 4 state variables, 8 refs, and renders 5 different states.

---

## What to Create

### File 1: `src/mic/useAudioCapture.ts` — Custom Hook

Extract all Web Audio and MediaRecorder logic into a self-contained hook.

**Move these concerns:**
- `getBuiltInMicrophoneDeviceId()` (lines 26-88) — entire function
- Permission checking: `checkExistingPermission()` (lines 132-159)
- Permission requesting: `requestPermissionAndRecord()` (lines 161-172)
- Recording start: `startRecording()` (lines 174-263) — getUserMedia, MediaRecorder setup, AudioContext creation, AnalyserNode setup, timer setup
- Recording stop: `stopRecording()` (lines 265-300) — cleanup chain
- Transcription: `sendForTranscription()` (lines 302-331)

**Move these state/refs:**
- `recorderState`, `setRecorderState`
- `timeLeft`, `setTimeLeft`
- `audioLevel`, `setAudioLevel`
- `errorMessage`, `setErrorMessage`
- All 8 refs: `mediaRecorderRef`, `audioContextRef`, `analyserRef`, `streamRef`, `chunksRef`, `timerRef`, `animationRef`, `permissionCheckedRef`

**Hook signature:**
```ts
interface UseAudioCaptureOptions {
  maxDuration?: number;
  onTranscribe: (text: string) => void;
  onClose: () => void;
}

interface UseAudioCaptureReturn {
  recorderState: RecorderState;
  timeLeft: number;
  audioLevel: number;
  errorMessage: string | null;
  requestPermissionAndRecord: () => void;
  stopRecording: (cancelled?: boolean) => void;
  handleCancel: () => void;
  handleRetry: () => void;
  circumference: number; // 2 * Math.PI * 45
  maxDuration: number;
}
```

**The hook owns all logic. The component becomes pure JSX rendering.**

**Critical cleanup order — MUST preserve exactly:**
```
1. Clear timer (clearInterval)
2. Cancel animation frame
3. Stop MediaRecorder
4. Stop all stream tracks
5. Close AudioContext
```
If AudioContext closes before tracks stop, microphone light stays on. If animation frame isn't cancelled before refs are nulled, null reference error in updateLevel. This order is in the current code at lines 265-293 — move it byte-for-byte.

---

### File 2: `src/mic/KittVisualizer.tsx` — Pure Component

Extract the KITT bar visualization (3 vertical bars responding to audio level).

**Props:**
```ts
interface KittVisualizerProps {
  audioLevel: number; // 0-1 normalized
}
```

**Extracts from the recording state JSX (lines 468-481):**
```tsx
<div className="voice-recorder__kitt">
  <div className="voice-recorder__kitt-bar" style={{ height: `${barHeight(audioLevel * 0.8)}px` }} />
  <div className="voice-recorder__kitt-bar" style={{ height: `${barHeight(audioLevel)}px` }} />
  <div className="voice-recorder__kitt-bar" style={{ height: `${barHeight(audioLevel * 0.6)}px` }} />
</div>
```

**Include the barHeight calculation:**
```ts
const barHeight = (level: number) => Math.max(4, 4 + level * 106);
```

Dynamic inline styles (bar heights) stay inline — they are calculated per-frame.

---

### File 3: `src/mic/CountdownRing.tsx` — Pure Component

Extract the SVG countdown ring.

**Props:**
```ts
interface CountdownRingProps {
  timeLeft: number;
  maxDuration: number;
  circumference: number;
  children?: React.ReactNode; // KITT visualizer goes inside
}
```

**Extracts from the recording state JSX (lines 445-482):**
```tsx
<div className="voice-recorder__ring-container">
  <svg className="voice-recorder__ring" viewBox="0 0 100 100">
    <circle className="voice-recorder__ring-bg" cx="50" cy="50" r="45" />
    <circle
      className="voice-recorder__ring-fill"
      cx="50" cy="50" r="45"
      style={{
        strokeDasharray: circumference,
        strokeDashoffset: circumference - (((maxDuration - timeLeft) / maxDuration) * 100 / 100) * circumference,
        transition: 'stroke-dashoffset 1s linear'
      }}
    />
  </svg>
  {children}
</div>
```

---

### Result: VoiceRecorder.tsx becomes composition (~80 lines)

```tsx
import { useAudioCapture } from './useAudioCapture';
import { KittVisualizer } from './KittVisualizer';
import { CountdownRing } from './CountdownRing';

export function VoiceRecorder({ onTranscribe, onClose, maxDuration = 30 }: VoiceRecorderProps) {
  const {
    recorderState, timeLeft, audioLevel, errorMessage,
    requestPermissionAndRecord, stopRecording, handleCancel, handleRetry,
    circumference, maxDuration: duration
  } = useAudioCapture({ maxDuration, onTranscribe, onClose });

  // 5 state renders using the extracted components
  if (recorderState === 'checking_permission') { ... }
  if (recorderState === 'permission_needed') { ... }
  if (recorderState === 'permission_denied') { ... }
  if (recorderState === 'recording') {
    return (
      <div className="voice-recorder">
        <CountdownRing timeLeft={timeLeft} maxDuration={duration} circumference={circumference}>
          <KittVisualizer audioLevel={audioLevel} />
        </CountdownRing>
        ...
      </div>
    );
  }
  if (recorderState === 'processing') { ... }
}
```

---

## Gotchas — Handle These During Implementation

### 1. Cleanup chain order is CRITICAL
Lines 265-293: timer → animation → MediaRecorder → tracks → AudioContext. This exact order must be preserved in the hook's `stopRecording`. If AudioContext closes before tracks stop, microphone hardware stays active (light stays on, battery drain). If animation frame fires after refs are nulled, null reference crash.

### 2. Enter key listener uses capture phase
Lines 120-129: `window.addEventListener('keydown', handleKeyDown, true)` — the `true` flag means capture phase. This must stay in the hook. If the `true` is accidentally dropped, the Enter key may be consumed by other handlers (composer, editor) before reaching the voice recorder.

### 3. MediaRecorder MIME type fallback has an untested edge case
Lines 228-230: Falls back from `audio/webm` to `audio/mp4`. If NEITHER is supported, `mimeType` is `audio/mp4` but MediaRecorder constructor may still fail. The existing try/catch at line 258 catches this — make sure the hook preserves that error path.

### 4. permissionCheckedRef prevents double-initialization
Lines 107-111: `permissionCheckedRef` ensures `checkExistingPermission` runs exactly once. This ref must be in the hook, not the component. If it's in the component and the hook re-mounts, permission is checked twice.

### 5. Keyboard handler depends on recorderState
Line 121: `if (recorderState === 'recording' && e.key === 'Enter')`. The effect re-registers when `recorderState` changes. This dependency must travel with the hook.

---

## What NOT to Do

- Do not change VoiceRecorder.css — it's already tokenized (SPEC-17)
- Do not change the transcription API call or endpoint
- Do not change the microphone device selection logic
- Do not change the permission flow
- Do not add error handling beyond what exists
- Do not change MicTrigger.tsx (the parent that renders VoiceRecorder)

---

## Verification

1. VoiceRecorder renders identically in all 5 states
2. Permission check runs exactly once on mount
3. Recording starts, KITT bars respond to voice, countdown ring progresses
4. Enter key stops recording and submits
5. Cancel stops recording and closes
6. Timer auto-stops at 0
7. After recording stops, microphone light turns off (cleanup order)
8. Processing state shows spinner during transcription
9. Error state allows retry

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Cleanup order reversed | Microphone stays active | System mic light on after close |
| Enter key loses capture flag | Other handler consumes Enter | Enter does nothing during recording |
| permissionCheckedRef in wrong scope | Permission checked twice | Double getUserMedia prompt |
| MIME type fallback fails | Recording hangs | Spinner never stops |
