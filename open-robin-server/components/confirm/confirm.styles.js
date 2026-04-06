// components/confirm/confirm.styles.js
export const STYLES = `
  .rv-confirm-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: var(--overlay-bg, rgba(0, 0, 0, 0.5));
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: var(--z-modal, 1000);
    opacity: 0;
    transition: opacity var(--transition-fast, 150ms ease);
  }
  .rv-confirm-overlay.active {
    opacity: 1;
  }
  .rv-confirm {
    background: var(--bg-surface, #ffffff);
    border-radius: var(--radius-lg, 8px);
    padding: var(--space-lg, 24px);
    min-width: 320px;
    max-width: 90vw;
    box-shadow: var(--shadow-large, 0 8px 32px rgba(0, 0, 0, 0.2));
    transform: scale(0.95);
    transition: transform var(--transition-fast, 150ms ease);
  }
  .rv-confirm-overlay.active .rv-confirm {
    transform: scale(1);
  }
  .rv-confirm-title {
    margin: 0 0 var(--space-sm, 8px) 0;
    font-size: var(--text-lg, 18px);
    font-weight: 600;
    color: var(--text-primary, #1a1a1a);
  }
  .rv-confirm-message {
    margin: 0 0 var(--space-lg, 24px) 0;
    color: var(--text-secondary, #555555);
    line-height: 1.5;
  }
  .rv-confirm-buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-sm, 8px);
  }
  .rv-confirm-btn {
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    border-radius: var(--radius-md, 6px);
    font-size: var(--text-sm, 14px);
    cursor: pointer;
    border: none;
    transition: background-color var(--transition-fast, 150ms ease);
  }
  .rv-confirm-btn-cancel {
    background: var(--btn-secondary-bg, #f0f0f0);
    color: var(--btn-secondary-text, #333333);
  }
  .rv-confirm-btn-cancel:hover {
    background: var(--btn-secondary-hover, #e0e0e0);
  }
  .rv-confirm-btn-ok {
    background: var(--btn-primary-bg, #007bff);
    color: var(--btn-primary-text, #ffffff);
  }
  .rv-confirm-btn-ok:hover {
    background: var(--btn-primary-hover, #0056b3);
  }
  .rv-confirm-btn-danger {
    background: var(--palette-error, #dc3545);
    color: #ffffff;
  }
  .rv-confirm-btn-danger:hover {
    background: var(--palette-error-hover, #c82333);
  }
`;
