// components/modal/modal.styles.js
export const STYLES = `
  .rv-modal-overlay {
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
  
  .rv-modal-overlay.active {
    opacity: 1;
  }
  
  .rv-modal {
    background: var(--bg-surface, #ffffff);
    border: 1px solid var(--border-default, #e0e0e0);
    border-radius: var(--radius-lg, 12px);
    min-width: 320px;
    max-width: 90vw;
    max-height: 90vh;
    box-shadow: var(--shadow-large, 0 8px 32px rgba(0, 0, 0, 0.15));
    transform: scale(0.95);
    transition: transform var(--transition-fast, 150ms ease);
    display: flex;
    flex-direction: column;
  }
  
  .rv-modal-overlay.active .rv-modal {
    transform: scale(1);
  }
  
  .rv-modal-header {
    padding: var(--space-lg, 24px) var(--space-lg, 24px) var(--space-sm, 8px);
    border-bottom: 1px solid var(--border-subtle, #f0f0f0);
  }
  
  .rv-modal-title {
    font-size: var(--text-lg, 18px);
    font-weight: 600;
    color: var(--text-primary, #1a1a1a);
    margin: 0;
  }
  
  .rv-modal-body {
    padding: var(--space-lg, 24px);
    overflow-y: auto;
    flex: 1;
  }
  
  .rv-modal-footer {
    padding: var(--space-md, 16px) var(--space-lg, 24px);
    border-top: 1px solid var(--border-subtle, #f0f0f0);
    display: flex;
    gap: var(--space-sm, 8px);
    justify-content: flex-end;
  }
  
  .rv-modal-btn {
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    border-radius: var(--radius-md, 8px);
    border: 1px solid transparent;
    font-size: var(--text-base, 14px);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
  }
  
  .rv-modal-btn:hover {
    transform: translateY(-1px);
  }
  
  .rv-modal-btn:active {
    transform: translateY(0);
  }
  
  .rv-modal-btn-cancel {
    background: var(--bg-subtle, #f5f5f5);
    color: var(--text-primary, #1a1a1a);
    border-color: var(--border-default, #e0e0e0);
  }
  
  .rv-modal-btn-cancel:hover {
    background: var(--bg-hover, #e8e8e8);
  }
  
  .rv-modal-btn-ok {
    background: var(--palette-primary, #3b82f6);
    color: white;
  }
  
  .rv-modal-btn-ok:hover {
    background: var(--palette-primary-hover, #2563eb);
  }
  
  .rv-modal-btn-ok.danger {
    background: var(--palette-error, #ef4444);
  }
  
  .rv-modal-btn-ok.danger:hover {
    background: var(--palette-error-hover, #dc2626);
  }
`;
