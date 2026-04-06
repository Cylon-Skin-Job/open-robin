// components/confirmation/index.js
import { STYLES } from './confirmation.styles.js';
import { confirmationTemplate } from './confirmation.template.js';

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  const tag = document.createElement('style');
  tag.textContent = STYLES;
  document.head.appendChild(tag);
  stylesInjected = true;
}

/**
 * Shows a confirmation dialog with OK and Cancel buttons.
 * Returns a Promise that resolves to true (OK) or false (Cancel).
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.message - The message to display (required)
 * @param {string} [options.title="Confirm"] - Dialog title
 * @param {string} [options.okText="OK"] - Text for OK button
 * @param {string} [options.cancelText="Cancel"] - Text for Cancel button
 * @param {boolean} [options.isDanger=false] - Style OK button as dangerous action
 * @returns {Promise<boolean>} Resolves to true if OK clicked, false if Cancel
 * 
 * @example
 * // Basic usage
 * const confirmed = await showConfirmation({ 
 *   message: "Are you sure?" 
 * });
 * if (confirmed) { 
 *   // User clicked OK 
 * }
 * 
 * @example
 * // Dangerous action
 * const confirmed = await showConfirmation({
 *   title: "Delete File",
 *   message: "This action cannot be undone.",
 *   okText: "Delete",
 *   isDanger: true
 * });
 */
export function showConfirmation({
  message,
  title = "Confirm",
  okText = "OK",
  cancelText = "Cancel",
  isDanger = false
}) {
  if (!message) {
    throw new Error('showConfirmation: message is required');
  }

  injectStyles();

  return new Promise((resolve) => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = confirmationTemplate({ title, message, okText, cancelText, isDanger });
    const overlay = wrapper.firstElementChild;
    document.body.appendChild(overlay);

    // Focus trap - focus the OK button by default
    const okButton = overlay.querySelector('[data-action="ok"]');
    const cancelButton = overlay.querySelector('[data-action="cancel"]');
    
    setTimeout(() => {
      overlay.classList.add('active');
      okButton.focus();
    }, 10);

    function close(result) {
      overlay.classList.remove('active');
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 150);
    }

    // Button click handlers
    okButton.addEventListener('click', () => close(true));
    cancelButton.addEventListener('click', () => close(false));

    // Click outside to cancel
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        close(false);
      }
    });

    // Escape key to cancel
    function handleKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Enter' && document.activeElement !== cancelButton) {
        e.preventDefault();
        close(true);
      }
    }
    document.addEventListener('keydown', handleKeydown);

    // Cleanup handler
    const originalClose = close;
    function closeWithCleanup(result) {
      document.removeEventListener('keydown', handleKeydown);
      originalClose(result);
    }
    
    // Re-bind close function
    okButton.onclick = () => closeWithCleanup(true);
    cancelButton.onclick = () => closeWithCleanup(false);
    overlay.onclick = (e) => {
      if (e.target === overlay) closeWithCleanup(false);
    };
  });
}
