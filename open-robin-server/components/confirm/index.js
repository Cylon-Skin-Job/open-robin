// components/confirm/index.js
import { STYLES } from './confirm.styles.js';
import { confirmTemplate } from './confirm.template.js';

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  const tag = document.createElement('style');
  tag.textContent = STYLES;
  document.head.appendChild(tag);
  stylesInjected = true;
}

/**
 * Show a confirmation dialog with OK and Cancel buttons
 * @param {Object} options
 * @param {string} options.message - The message to display (required)
 * @param {string} [options.title='Confirm'] - Dialog title
 * @param {string} [options.okText='OK'] - Text for OK button
 * @param {string} [options.cancelText='Cancel'] - Text for Cancel button
 * @param {boolean} [options.danger=false] - Use danger styling for OK button
 * @param {Function} [options.onConfirm] - Callback when OK is clicked
 * @param {Function} [options.onCancel] - Callback when Cancel is clicked or dismissed
 * @returns {Promise<boolean>} Resolves to true if OK clicked, false if cancelled
 */
export function showConfirm({
  message,
  title = 'Confirm',
  okText = 'OK',
  cancelText = 'Cancel',
  danger = false,
  onConfirm,
  onCancel
}) {
  if (!message) {
    throw new Error('showConfirm: message is required');
  }

  injectStyles();

  return new Promise((resolve) => {
    // Create and insert the dialog
    const wrapper = document.createElement('div');
    wrapper.innerHTML = confirmTemplate({ title, message, okText, cancelText, danger });
    const overlay = wrapper.firstElementChild;
    document.body.appendChild(overlay);

    // Trigger animation
    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    // Focus the OK button for accessibility
    const okButton = overlay.querySelector('[data-action="ok"]');
    okButton?.focus();

    // Handle button clicks
    function handleClick(e) {
      const action = e.target.dataset.action;
      if (!action) return;

      close(action === 'ok');
    }

    // Handle overlay click (cancel)
    function handleOverlayClick(e) {
      if (e.target === overlay) {
        close(false);
      }
    }

    // Handle keyboard (Escape to cancel)
    function handleKeydown(e) {
      if (e.key === 'Escape') {
        close(false);
      }
    }

    // Close and cleanup
    function close(confirmed) {
      // Remove event listeners
      overlay.removeEventListener('click', handleClick);
      overlay.removeEventListener('click', handleOverlayClick);
      document.removeEventListener('keydown', handleKeydown);

      // Animate out
      overlay.classList.remove('active');

      // Remove from DOM after animation
      setTimeout(() => {
        overlay.remove();
      }, 150);

      // Call appropriate callback
      if (confirmed && onConfirm) {
        onConfirm();
      } else if (!confirmed && onCancel) {
        onCancel();
      }

      resolve(confirmed);
    }

    // Attach listeners
    overlay.addEventListener('click', handleClick);
    overlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleKeydown);
  });
}

// Convenience method for destructive actions
export function showDangerConfirm(options) {
  return showConfirm({ ...options, danger: true });
}
