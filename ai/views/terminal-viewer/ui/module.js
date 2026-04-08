/**
 * Terminal Workspace — Runtime Module
 *
 * Handles split pane switching and terminal list selection.
 * Static mockup for now — will be wired to node-pty/xterm.js later.
 */

let listeners = [];

export function mount(el, ctx) {
  const splits = el.querySelector('.ws-term-splits');
  if (!splits) return;

  // Split control buttons
  el.querySelectorAll('[data-action^="split-"]').forEach(btn => {
    const handler = () => {
      const count = btn.dataset.action.split('-')[1];
      splits.dataset.split = count;
      el.querySelectorAll('[data-action^="split-"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
    btn.addEventListener('click', handler);
    listeners.push({ el: btn, event: 'click', handler });
  });

  // Terminal list item selection
  el.querySelectorAll('.ws-term-list-item').forEach(item => {
    const handler = () => {
      el.querySelectorAll('.ws-term-list-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    };
    item.addEventListener('click', handler);
    listeners.push({ el: item, event: 'click', handler });
  });

  // Pane close buttons
  el.querySelectorAll('.ws-term-pane-close').forEach(btn => {
    const handler = (e) => {
      e.stopPropagation();
      const pane = btn.closest('.ws-term-pane');
      if (pane) pane.remove();

      const remaining = el.querySelectorAll('.ws-term-pane').length;
      const countEl = el.querySelector('[data-count="terminals"]');
      if (countEl) countEl.textContent = remaining;
    };
    btn.addEventListener('click', handler);
    listeners.push({ el: btn, event: 'click', handler });
  });
}

export function unmount(el, ctx) {
  // Clean up all event listeners
  for (const { el: target, event, handler } of listeners) {
    target.removeEventListener(event, handler);
  }
  listeners = [];
}
