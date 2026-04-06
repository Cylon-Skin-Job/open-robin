/**
 * @module MicTrigger
 * @role Microphone button with voice input modal
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import {
  useHoverIconModal,
  HoverIconTrigger,
  HoverIconModalContainer,
  HoverIconModalList,
} from '../components/hover-icon-modal';
import { VoiceRecorder } from './VoiceRecorder';
import './VoiceRecorder.css';

interface MicTriggerProps {
  onInsert?: (text: string) => void;
}

export function MicTrigger({ onInsert }: MicTriggerProps) {
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(() => {
    // Modal will handle initialization
  }, []);

  const {
    isOpen,
    state,
    triggerRef,
    popoverRef,
    triggerProps,
    popoverProps,
    close,
  } = useHoverIconModal({
    onOpen: handleOpen,
    id: 'mic',
    triggerMode: 'click', // Mic opens on click only, no hover preview
    stayOpenOnLeave: true, // Once open, stays open until Escape/Enter/click outside
  });

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopoverPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 12,
      });
    }
  }, [isOpen, triggerRef]);

  const handleTranscribe = useCallback((text: string) => {
    if (onInsert && text.trim()) {
      onInsert(text.trim());
    }
    close();
  }, [onInsert, close]);

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  return (
    <>
      <HoverIconTrigger
        icon="mic"
        title="Voice input (click to open)"
        isOpen={isOpen}
        triggerRef={triggerRef}
        triggerProps={triggerProps}
      />

      <HoverIconModalContainer
        isOpen={isOpen}
        state={state}
        position={popoverPos ?? { left: 0, bottom: 0 }}
        popoverRef={popoverRef}
        popoverProps={popoverProps}
      >
        <HoverIconModalList listRef={listRef}>
          <VoiceRecorder
            onTranscribe={handleTranscribe}
            onClose={handleClose}
            maxDuration={30}
          />
        </HoverIconModalList>
      </HoverIconModalContainer>
    </>
  );
}
