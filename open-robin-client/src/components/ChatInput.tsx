/**
 * ChatInput — Send button + Stop button in the same position.
 *
 * Send: visible when no turn is active. Sends user message.
 * Stop: visible when a turn is active (streaming or revealing).
 *       Immediately ends the turn — renders all remaining content
 *       instantly and finalizes to history.
 *
 * The stop button has a spinning 3/4-circle border to indicate
 * the AI is working. Clicking it kills the turn cleanly.
 */

import { useState, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { usePanelStore } from '../state/panelStore';

export interface ChatInputRef {
  insertText: (text: string) => void;
  getText: () => string;
  clearText: () => void;
}

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  disabled: boolean;
  panel: string;
  /** Optional placeholder override (SPEC-26c: set when chat is inactive). */
  placeholder?: string;
  /** True when the AI is streaming or the renderer is still revealing. */
  isTurnActive: boolean;
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(function ChatInput(
  { onSend, onStop, disabled, panel, placeholder, isTurnActive },
  ref
) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const config = usePanelStore((s) => s.getPanelConfig(panel));

  useImperativeHandle(ref, () => ({
    insertText: (newText: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentText = textarea.value;
      
      // Insert at cursor position, or append if no cursor
      const before = currentText.substring(0, start);
      const after = currentText.substring(end);
      const updatedText = before + newText + after;
      
      setText(updatedText);
      
      // Set cursor position after inserted text
      setTimeout(() => {
        if (textarea) {
          textarea.focus();
          const newCursorPos = start + newText.length;
          textarea.setSelectionRange(newCursorPos, newCursorPos);
          // Adjust height
          textarea.style.height = 'auto';
          textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
        }
      }, 0);
    },
    getText: () => text,
    clearText: () => {
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }));

  const handleSend = useCallback(() => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isTurnActive) {
        onStop();
      } else {
        handleSend();
      }
    }
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
  };

  return (
    <div className="rv-chat-input-container">
      <div className="chat-input-wrapper">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={placeholder ?? `Ask about ${(config?.name || panel).toLowerCase()}...`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={disabled}
          rows={5}
        />

      </div>
    </div>
  );
});
