/**
 * ChatHarnessPicker
 *
 * Inline harness selector that lives inside the chat area.
 * Shown when no thread is active (currentThreadId === null).
 * Selecting a harness fires thread:create over WebSocket.
 *
 * This is NOT a page-level modal — it's position:absolute inside
 * .chat-messages so it stays within the chat column.
 */

import { useState } from 'react';
import { HARNESS_OPTIONS, type HarnessOption } from '../../config/harness';
import './ChatHarnessPicker.css';

export interface HarnessStatus {
  id: string;
  installed: boolean;
  builtIn: boolean;
  version: string | null;
  action: string | null;
  installCommand: string | null;
}

interface ChatHarnessPickerProps {
  onSelect: (harnessId: string) => void;
  statuses: Record<string, HarnessStatus>;
  isLoading: boolean;
}

export function ChatHarnessPicker({ onSelect, statuses, isLoading }: ChatHarnessPickerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isSelectable = (option: HarnessOption): boolean => {
    const s = statuses[option.id];
    if (s) return s.installed || s.builtIn;
    return option.enabled;
  };

  const copyInstall = (e: React.MouseEvent, cmd: string, id: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(cmd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="rv-chat-harness-picker" role="dialog" aria-label="Choose AI backend">
      <div className="rv-chp-header">
        <h2 className="rv-chp-title">Choose your AI</h2>
        <p className="rv-chp-subtitle">Select a backend to start the conversation</p>
      </div>

      {isLoading && (
        <div className="rv-chp-loading">Checking installed backends…</div>
      )}

      <div className="rv-chp-list">
        {HARNESS_OPTIONS.map((option) => {
          const s = statuses[option.id];
          const selectable = isSelectable(option);
          const needsInstall = s?.action === 'install';
          const isBuiltIn = s?.builtIn;
          const isInstalled = s?.installed && !isBuiltIn;

          return (
            <button
              key={option.id}
              className={`rv-chp-card ${!selectable ? 'rv-chp-card--disabled' : ''} ${needsInstall ? 'rv-chp-card--needs-install' : ''}`}
              onClick={() => selectable && onSelect(option.id)}
              disabled={!selectable}
              aria-label={`Start chat with ${option.name}`}
            >
              <div className="rv-chp-card-left">
                <span className="rv-chp-icon">{option.icon}</span>
              </div>

              <div className="rv-chp-card-body">
                <div className="rv-chp-card-title-row">
                  <span className="rv-chp-name">{option.name}</span>
                  {option.recommended && <span className="rv-chp-badge rv-chp-badge--recommended">Recommended</span>}
                  {isBuiltIn && <span className="rv-chp-badge rv-chp-badge--builtin">Built-in</span>}
                  {isInstalled && <span className="rv-chp-badge rv-chp-badge--installed">Installed</span>}
                  {needsInstall && <span className="rv-chp-badge rv-chp-badge--install">Not installed</span>}
                </div>

                <p className="rv-chp-description">{option.description}</p>

                <div className="rv-chp-pills">
                  <span className="rv-chp-pill">{option.details.provider}</span>
                  <span className="rv-chp-pill">{option.details.model}</span>
                  {option.details.features.map(f => (
                    <span key={f} className="rv-chp-pill rv-chp-pill--feature">{f}</span>
                  ))}
                </div>

                {needsInstall && s?.installCommand && (
                  <div className="rv-chp-install">
                    <code className="rv-chp-install-cmd">{s.installCommand}</code>
                    <button
                      className="rv-chp-install-copy"
                      onClick={(e) => copyInstall(e, s.installCommand!, option.id)}
                    >
                      {copiedId === option.id ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>

              {selectable && (
                <div className="rv-chp-card-right">
                  <span className="material-symbols-outlined rv-chp-arrow">arrow_forward</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ChatHarnessPicker;
