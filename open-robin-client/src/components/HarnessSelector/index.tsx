/**
 * HarnessSelector Component
 * 
 * Modal for selecting AI backend (harness) when creating a new chat.
 * Shows available harness options with details, badges, and installation status.
 */

import { useEffect, useCallback, useState } from 'react';
import { HARNESS_OPTIONS, type HarnessOption } from '../../config/harness';
import './HarnessSelector.css';

interface HarnessStatus {
  id: string;
  name: string;
  provider: string;
  installed: boolean;
  builtIn: boolean;
  version: string | null;
  action: string | null;
  installCommand: string | null;
  error: string | null;
}

interface HarnessSelectorProps {
  isOpen: boolean;
  onSelect: (harnessId: string) => void;
  onCancel: () => void;
}

export function HarnessSelector({ isOpen, onSelect, onCancel }: HarnessSelectorProps) {
  const [harnessStatuses, setHarnessStatuses] = useState<Record<string, HarnessStatus>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch harness installation status
  const fetchHarnessStatus = useCallback(async () => {
    if (!isOpen) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/harnesses');
      if (!response.ok) {
        throw new Error(`Failed to fetch harness status: ${response.statusText}`);
      }
      
      const statuses: HarnessStatus[] = await response.json();
      const statusMap = statuses.reduce((acc, status) => {
        acc[status.id] = status;
        return acc;
      }, {} as Record<string, HarnessStatus>);
      
      setHarnessStatuses(statusMap);
    } catch (err) {
      console.error('[HarnessSelector] Failed to fetch status:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch harness status');
    } finally {
      setIsLoading(false);
    }
  }, [isOpen]);

  // Fetch status when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchHarnessStatus();
    }
  }, [isOpen, fetchHarnessStatus]);

  // Handle escape key to close modal
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  }, [onCancel]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // Handle backdrop click to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  // Handle harness selection
  const handleSelect = (option: HarnessOption) => {
    const status = harnessStatuses[option.id];
    const isSelectable = status?.installed || status?.builtIn || option.enabled;
    
    if (!isSelectable) return;
    onSelect(option.id);
  };

  // Copy install command to clipboard
  const copyInstallCommand = (e: React.MouseEvent, command: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(command);
    // Could show a toast here
  };

  // Get effective enabled status combining config and API status
  const getIsEnabled = (option: HarnessOption): boolean => {
    const status = harnessStatuses[option.id];
    if (status) {
      return status.installed || status.builtIn;
    }
    return option.enabled;
  };

  if (!isOpen) return null;

  return (
    <div 
      className="rv-harness-modal-overlay"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rv-harness-selector-title"
    >
      <div className="rv-harness-modal-content">
        <button 
          className="rv-harness-modal-close"
          onClick={onCancel}
          aria-label="Close"
        >
          ×
        </button>
        
        <h2 id="rv-harness-selector-title" className="rv-harness-modal-title">
          Choose AI Backend
        </h2>
        <p className="rv-harness-modal-subtitle">
          Select the assistant identity for this conversation
        </p>
        
        {isLoading && (
          <div className="rv-harness-loading">Checking available backends...</div>
        )}
        
        {error && (
          <div className="rv-harness-error">
            {error}
            <button onClick={fetchHarnessStatus} className="rv-harness-retry-btn">
              Retry
            </button>
          </div>
        )}
        
        <div className="rv-harness-grid">
          {HARNESS_OPTIONS.map((option) => {
            const status = harnessStatuses[option.id];
            const isEnabled = getIsEnabled(option);
            const isInstalled = status?.installed;
            const isBuiltIn = status?.builtIn;
            const needsInstall = status?.action === 'install';
            
            return (
              <button
                key={option.id}
                className={`rv-harness-card ${!isEnabled ? 'disabled' : ''} ${option.comingSoon ? 'coming-soon' : ''} ${needsInstall ? 'needs-install' : ''}`}
                onClick={() => handleSelect(option)}
                disabled={!isEnabled}
                aria-label={`Select ${option.name}`}
              >
                <div className="rv-harness-card-header">
                  <span className="rv-harness-card-icon" role="img" aria-label={option.name}>
                    {option.icon}
                  </span>
                  <h3 className="rv-harness-card-name">{option.name}</h3>
                  {option.recommended && (
                    <span className="rv-harness-card-badge recommended">Recommended</span>
                  )}
                  {option.comingSoon && (
                    <span className="rv-harness-card-badge soon">Soon</span>
                  )}
                  {isInstalled && !isBuiltIn && (
                    <span className="rv-harness-card-badge installed">Installed</span>
                  )}
                  {isBuiltIn && (
                    <span className="rv-harness-card-badge builtin">Built-in</span>
                  )}
                </div>
                
                <p className="rv-harness-card-description">{option.description}</p>
                
                {status?.version && (
                  <p className="rv-harness-card-version">{status.version}</p>
                )}
                
                <div className="rv-harness-card-details">
                  <span className="rv-harness-detail-pill">{option.details.provider}</span>
                  <span className="rv-harness-detail-pill">{option.details.model}</span>
                </div>
                
                <div className="rv-harness-card-features">
                  {option.details.features.map((feature) => (
                    <span key={feature} className="rv-harness-feature-tag">
                      {feature}
                    </span>
                  ))}
                </div>
                
                {needsInstall && status?.installCommand && (
                  <div className="rv-harness-install-section">
                    <code className="rv-harness-install-command">{status.installCommand}</code>
                    <button
                      className="rv-harness-copy-btn"
                      onClick={(e) => copyInstallCommand(e, status.installCommand!)}
                      title="Copy install command"
                    >
                      Copy
                    </button>
                    <p className="rv-harness-install-hint">
                      Run this command to install, then refresh
                    </p>
                  </div>
                )}
                
                {isEnabled && (
                  <span className="rv-harness-select-indicator">Select →</span>
                )}
                
                {!isEnabled && needsInstall && (
                  <span className="rv-harness-select-indicator disabled">Not Installed</span>
                )}
              </button>
            );
          })}
        </div>
        
        <button className="rv-harness-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default HarnessSelector;
