// components/confirmation/confirmation.styles.js
export const STYLES = `
  .rv-confirmation-overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay-bg, rgba(0, 0, 0, 0.5));
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal, 500);
    opacity: 0;
    transition: opacity var(--transition-fast, 150ms ease);
  }
  
  .rv-confirmation-overlay.active {
    opacity: 1;
  }
  
  .rv-confirmation {
    background: var(--bg-surface, #ffffff);
    border: 1px solid var(--border-default, #e0e0e0);
    border-radius: var(--radius-lg, 12px);
    padding: var(--space-lg, 24px);
    min-width: 320px;
    max-width: 90vw;
    box-shadow: var(--shadow-large, 0 8px 32px rgba(0, 0, 0, 0.15));
    transform: scale(0.95);
    transition: transform var(--transition-fast, 150ms ease);
  }
  
  .rv-confirmation-overlay.active .rv-confirmation {
    transform: scale(1);
  }
  
  .rv-confirmation-title {
    font-size: var(--text-lg, 18px);
    font-weight: 600;
    color: var(--text-primary, #1a1a1a);
    margin: 0 0 var(--space-sm, 8px) 0;
  }
  
  .rv-confirmation-message {
    font-size: var(--text-base, 14px);
    color: var(--text-secondary, #666666);
    margin: 0 0 var(--space-lg, 24px) 0;
    line-height: 1.5;
  }
  
  .rv-confirmation-actions {
    display: flex;
    gap: var(--space-sm, 8px);
    justify-content: flex-end;
  }
  
  .rv-confirmation-btn {
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    border-radius: var(--radius-md, 8px);
    border: 1px solid transparent;
    font-size: var(--text-base, 14px);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
  }
  
  .rv-confirmation-btn:hover {
    transform: translateY(-1px);
  }
  
  .rv-confirmation-btn:active {
    transform: translateY(0);
  }
  
  .rv-confirmation-btn-cancel {
    background: var(--bg-subtle, #f5f5f5);
    color: var(--text-primary, #1a1a1a);
    border-color: var(--border-default, #e0e0e0);
  }
  
  .rv-confirmation-btn-cancel:hover {
    background: var(--bg-hover, #e8e8e8);
  }
  
  .rv-confirmation-btn-ok {
    background: var(--palette-primary, #3b82f6);
    color: white;
  }
  
  .rv-confirmation-btn-ok:hover {
    background: var(--palette-primary-hover, #2563eb);
  }
  
  .rv-confirmation-btn-ok.danger {
    background: var(--palette-error, #ef4444);
  }
  
  .rv-confirmation-btn-ok.danger:hover {
    background: var(--palette-error-hover, #dc2626);
  }
`;
