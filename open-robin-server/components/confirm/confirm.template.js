// components/confirm/confirm.template.js
export function confirmTemplate({ title = 'Confirm', message, okText = 'OK', cancelText = 'Cancel', danger = false }) {
  return `
    <div class="rv-confirm-overlay" id="rv-confirm-overlay">
      <div class="rv-confirm" role="dialog" aria-modal="true" aria-labelledby="rv-confirm-title">
        <h3 class="rv-confirm-title" id="rv-confirm-title">${escapeHtml(title)}</h3>
        <p class="rv-confirm-message">${escapeHtml(message)}</p>
        <div class="rv-confirm-buttons">
          <button class="rv-confirm-btn rv-confirm-btn-cancel" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="rv-confirm-btn rv-confirm-btn-ok ${danger ? 'rv-confirm-btn-danger' : ''}" data-action="ok">${escapeHtml(okText)}</button>
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
