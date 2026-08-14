/** Small DOM helpers shared by the popup and the dashboard. */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    // Deliberately no `html:` option — everything user-supplied (descriptions,
    // project names, imported CSV cells) goes through textContent or setAttribute,
    // so there is no way to hand this helper markup to parse.
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer;
export function toast(message) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 2200);
}

/**
 * Opens a modal. `render(close)` returns the modal's inner content.
 * Resolves with whatever `close(value)` was called with.
 */
export function modal(render) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root') || document.body;
    const backdrop = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: 'modal' });
    const close = (value) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(undefined); });
    document.addEventListener('keydown', onKey);
    box.append(render(close));
    backdrop.append(box);
    root.append(backdrop);
    setTimeout(() => box.querySelector('input, select, textarea, button')?.focus(), 0);
  });
}

export async function confirmDialog({ title, body, confirmText = 'Delete', danger = true }) {
  return modal((close) => el('div', {},
    el('h2', { text: title }),
    typeof body === 'string' ? el('p', { class: 'muted', text: body }) : body,
    el('div', { class: 'modal-actions' },
      el('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      el('button', {
        class: `btn ${danger ? 'danger' : 'primary'}`,
        onclick: () => close(true),
      }, confirmText))
  )) === true;
}
