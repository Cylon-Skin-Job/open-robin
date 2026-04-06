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
      className="harness-modal-overlay"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="harness-selector-title"
    >
      <div className="harness-modal-content">
        <button 
          className="harness-modal-close"
          onClick={onCancel}
          aria-label="Close"
        >
          ×
        </button>
        
        <h2 id="harness-selector-title" className="harness-modal-title">
          Choose AI Backend
        </h2>
        <p className="harness-modal-subtitle">
          Select the assistant identity for this conversation
        </p>
        
        {isLoading && (
          <div className="harness-loading">Checking available backends...</div>
        )}
        
        {error && (
          <div className="harness-error">
            {error}
            <button onClick={fetchHarnessStatus} className="harness-retry-btn">
              Retry
            </button>
          </div>
        )}
        
        <div className="harness-grid">
          {HARNESS_OPTIONS.map((option) => {
            const status = harnessStatuses[option.id];
            const isEnabled = getIsEnabled(option);
            const isInstalled = status?.installed;
            const isBuiltIn = status?.builtIn;
            const needsInstall = status?.action === 'install';
            
            return (
              <button
                key={option.id}
                className={`harness-card ${!isEnabled ? 'disabled' : ''} ${option.comingSoon ? 'coming-soon' : ''} ${needsInstall ? 'needs-install' : ''}`}
                onClick={() => handleSelect(option)}
                disabled={!isEnabled}
                aria-label={`Select ${option.name}`}
              >
                <div className="harness-card-header">
                  <span className="harness-card-icon" role="img" aria-label={option.name}>
                    {option.icon}
                  </span>
                  <h3 className="harness-card-name">{option.name}</h3>
                  {option.recommended && (
                    <span className="harness-card-badge recommended">Recommended</span>
                  )}
                  {option.comingSoon && (
                    <span className="harness-card-badge soon">Soon</span>
                  )}
                  {isInstalled && !isBuiltIn && (
                    <span className="harness-card-badge installed">Installed</span>
                  )}
                  {isBuiltIn && (
                    <span className="harness-card-badge builtin">Built-in</span>
                  )}
                </div>
                
                <p className="harness-card-description">{option.description}</p>
                
                {status?.version && (
                  <p className="harness-card-version">{status.version}</p>
                )}
                
                <div className="harness-card-details">
                  <span className="harness-detail-pill">{option.details.provider}</span>
                  <span className="harness-detail-pill">{option.details.model}</span>
                </div>
                
                <div className="harness-card-features">
                  {option.details.features.map((feature) => (
                    <span key={feature} className="harness-feature-tag">
                      {feature}
                    </span>
                  ))}
                </div>
                
                {needsInstall && status?.installCommand && (
                  <div className="harness-install-section">
                    <code className="harness-install-command">{status.installCommand}</code>
                    <button
                      className="harness-copy-btn"
                      onClick={(e) => copyInstallCommand(e, status.installCommand!)}
                      title="Copy install command"
                    >
                      Copy
                    </button>
                    <p className="harness-install-hint">
                      Run this command to install, then refresh
                    </p>
                  </div>
                )}
                
                {isEnabled && (
                  <span className="harness-select-indicator">Select →</span>
                )}
                
                {!isEnabled && needsInstall && (
                  <span className="harness-select-indicator disabled">Not Installed</span>
                )}
              </button>
            );
          })}
        </div>
        
        <button className="harness-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default HarnessSelector;
