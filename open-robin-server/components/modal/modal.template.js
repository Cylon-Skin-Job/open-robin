// components/modal/modal.template.js
export function modalTemplate({ title = "", content = "", okText = "OK", cancelText = "Cancel", isDanger = false }) {
  const titleSection = title ? `
    <div class="rv-modal-header">
      <h3 class="rv-modal-title" id="rv-modal-title">${escapeHtml(title)}</h3>
    </div>
  ` : '';

  return `
    <div class="rv-modal-overlay" role="dialog" aria-modal="true" ${title ? 'aria-labelledby="rv-modal-title"' : ''}>
      <div class="rv-modal">
        ${titleSection}
        <div class="rv-modal-body">
          ${content}
        </div>
        <div class="rv-modal-footer">
          <button class="rv-modal-btn rv-modal-btn-cancel" data-action="cancel">
            ${escapeHtml(cancelText)}
          </button>
          <button class="rv-modal-btn rv-modal-btn-ok ${isDanger ? 'danger' : ''}" data-action="ok">
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
