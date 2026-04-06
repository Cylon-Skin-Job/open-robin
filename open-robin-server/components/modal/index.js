// components/modal/index.js
import { STYLES } from './modal.styles.js';
import { modalTemplate } from './modal.template.js';

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  const tag = document.createElement('style');
  tag.textContent = STYLES;
  document.head.appendChild(tag);
  stylesInjected = true;
}

/**
 * Shows a modal dialog with OK and Cancel buttons.
 * Returns a Promise that resolves to true (OK) or false (Cancel).
 * 
 * @param {Object} options - Configuration options
 * @param {string} [options.title] - Modal title (optional)
 * @param {string|HTMLElement} options.content - Content to display (HTML string or DOM element)
 * @param {string} [options.okText="OK"] - Text for OK button
 * @param {string} [options.cancelText="Cancel"] - Text for Cancel button
 * @param {boolean} [options.isDanger=false] - Style OK button as dangerous action
 * @returns {Promise<boolean>} Resolves to true if OK clicked, false if Cancel
 * 
 * @example
 * // Basic usage with HTML content
 * const confirmed = await showModal({ 
 *   title: "Settings",
 *   content: "<p>Your changes have been saved.</p>"
 * });
 * 
 * @example
 * // With DOM element content
 * const div = document.createElement('div');
 * div.innerHTML = '<input type="text" placeholder="Enter name">';
 * const confirmed = await showModal({
 *   title: "Enter Name",
 *   content: div
 * });
 * 
 * @example
 * // Dangerous action
 * const confirmed = await showModal({
 *   title: "Delete Account",
 *   content: "<p>This will permanently delete your account.</p>",
 *   okText: "Delete",
 *   isDanger: true
 * });
 */
export function showModal({
  title = "",
  content,
  okText = "OK",
  cancelText = "Cancel",
  isDanger = false
}) {
  if (content === undefined) {
    throw new Error('showModal: content is required');
  }

  injectStyles();

  return new Promise((resolve) => {
    // Convert content to HTML string if it's a DOM element
    const contentHtml = content instanceof HTMLElement 
      ? content.outerHTML 
      : String(content);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = modalTemplate({ title, content: contentHtml, okText, cancelText, isDanger });
    const overlay = wrapper.firstElementChild;
    document.body.appendChild(overlay);

    // If content was a DOM element, replace the placeholder with the actual element
    const bodyContainer = overlay.querySelector('.rv-modal-body');
    if (content instanceof HTMLElement) {
      bodyContainer.innerHTML = '';
      bodyContainer.appendChild(content);
    }

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

    // Keyboard handlers
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
