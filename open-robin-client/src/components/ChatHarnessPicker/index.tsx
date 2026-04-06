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

import { useEffect, useCallback, useState } from 'react';
import { HARNESS_OPTIONS, type HarnessOption } from '../../config/harness';
import './ChatHarnessPicker.css';

interface HarnessStatus {
  id: string;
  installed: boolean;
  builtIn: boolean;
  version: string | null;
  action: string | null;
  installCommand: string | null;
}

interface ChatHarnessPickerProps {
  onSelect: (harnessId: string) => void;
}

export function ChatHarnessPicker({ onSelect }: ChatHarnessPickerProps) {
  const [statuses, setStatuses] = useState<Record<string, HarnessStatus>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchStatuses = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/harnesses');
      if (!res.ok) return;
      const list: HarnessStatus[] = await res.json();
      const map = list.reduce((acc, s) => { acc[s.id] = s; return acc; }, {} as Record<string, HarnessStatus>);
      setStatuses(map);
    } catch {
      // silent — show local config as fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

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
    <div className="chat-harness-picker" role="dialog" aria-label="Choose AI backend">
      <div className="chp-header">
        <h2 className="chp-title">Choose your AI</h2>
        <p className="chp-subtitle">Select a backend to start the conversation</p>
      </div>

      {isLoading && (
        <div className="chp-loading">Checking installed backends…</div>
      )}

      <div className="chp-list">
        {HARNESS_OPTIONS.map((option) => {
          const s = statuses[option.id];
          const selectable = isSelectable(option);
          const needsInstall = s?.action === 'install';
          const isBuiltIn = s?.builtIn;
          const isInstalled = s?.installed && !isBuiltIn;

          return (
            <button
              key={option.id}
              className={`chp-card ${!selectable ? 'chp-card--disabled' : ''} ${needsInstall ? 'chp-card--needs-install' : ''}`}
              onClick={() => selectable && onSelect(option.id)}
              disabled={!selectable}
              aria-label={`Start chat with ${option.name}`}
            >
              <div className="chp-card-left">
                <span className="chp-icon">{option.icon}</span>
              </div>

              <div className="chp-card-body">
                <div className="chp-card-title-row">
                  <span className="chp-name">{option.name}</span>
                  {option.recommended && <span className="chp-badge chp-badge--recommended">Recommended</span>}
                  {isBuiltIn && <span className="chp-badge chp-badge--builtin">Built-in</span>}
                  {isInstalled && <span className="chp-badge chp-badge--installed">Installed</span>}
                  {needsInstall && <span className="chp-badge chp-badge--install">Not installed</span>}
                </div>

                <p className="chp-description">{option.description}</p>

                <div className="chp-pills">
                  <span className="chp-pill">{option.details.provider}</span>
                  <span className="chp-pill">{option.details.model}</span>
                  {option.details.features.map(f => (
                    <span key={f} className="chp-pill chp-pill--feature">{f}</span>
                  ))}
                </div>

                {needsInstall && s?.installCommand && (
                  <div className="chp-install">
                    <code className="chp-install-cmd">{s.installCommand}</code>
                    <button
                      className="chp-install-copy"
                      onClick={(e) => copyInstall(e, s.installCommand!, option.id)}
                    >
                      {copiedId === option.id ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>

              {selectable && (
                <div className="chp-card-right">
                  <span className="material-symbols-outlined chp-arrow">arrow_forward</span>
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
