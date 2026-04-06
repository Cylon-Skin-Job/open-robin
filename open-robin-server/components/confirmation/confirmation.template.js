// components/confirmation/confirmation.template.js
export function confirmationTemplate({ title = "Confirm", message, okText = "OK", cancelText = "Cancel", isDanger = false }) {
  return `
    <div class="rv-confirmation-overlay" role="dialog" aria-modal="true" aria-labelledby="rv-confirm-title">
      <div class="rv-confirmation">
        <h3 class="rv-confirmation-title" id="rv-confirm-title">${escapeHtml(title)}</h3>
        <p class="rv-confirmation-message">${escapeHtml(message)}</p>
        <div class="rv-confirmation-actions">
          <button class="rv-confirmation-btn rv-confirmation-btn-cancel" data-action="cancel">
            ${escapeHtml(cancelText)}
          </button>
          <button class="rv-confirmation-btn rv-confirmation-btn-ok ${isDanger ? 'danger' : ''}" data-action="ok">
            ${escapeHtml(okText)}
          </button>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
