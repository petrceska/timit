/** Small DOM helpers shared by the popup and the dashboard. */
import { safeLink } from './store.js';

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

/** Closes whichever bubble is currently on screen — at most one ever is. */
let openBubble = null;

/**
 * An ⓘ marker that reveals an explanation on hover, focus or tap.
 *
 * The bubble is attached to <body> and positioned with fixed coordinates rather
 * than nested in the layout, so it can't be clipped by a scrolling table cell or
 * a narrow popup.
 *
 * @param {Array|string} content  text and/or nodes to show
 * @param {object} opts { label, onClose } accessible name, and a hook the caller
 *        can use to resume work it held back while the bubble was open
 */
export function infoBubble(content, { label = 'What is this?', onClose } = {}) {
  const marker = el('button', {
    type: 'button', class: 'info', 'aria-label': label, 'aria-expanded': 'false',
  }, 'i');

  let bubble = null;
  let hideTimer = null;
  let watchdog = null;

  const place = () => {
    const margin = 8;
    // Measure at the top-left corner first: a bubble sitting near the right edge
    // would otherwise be squeezed narrow (and so measured too tall), which throws
    // off both the centring and the decision to flip above the marker.
    bubble.style.left = '0px';
    bubble.style.top = '0px';
    const box = bubble.getBoundingClientRect();
    const at = marker.getBoundingClientRect();

    const left = Math.max(margin,
      Math.min(at.left + at.width / 2 - box.width / 2, innerWidth - box.width - margin));
    const below = at.bottom + 8;
    const above = at.top - box.height - 8;
    let top = below + box.height > innerHeight - margin && above > margin ? above : below;
    // Whatever happens, keep it inside the window.
    top = Math.max(margin, Math.min(top, innerHeight - box.height - margin));

    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
    bubble.style.visibility = 'visible';
  };

  const show = () => {
    clearTimeout(hideTimer);
    if (bubble) return;
    openBubble?.();              // only ever one bubble on screen
    bubble = el('div', { class: 'info-bubble', role: 'tooltip', style: 'visibility:hidden' },
      Array.isArray(content) ? content : [content]);
    bubble.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    bubble.addEventListener('mouseleave', hideSoon);
    document.body.append(bubble);
    marker.setAttribute('aria-expanded', 'true');
    openBubble = hide;
    // The bubble lives on <body>, so it would outlive its marker when the view
    // re-renders underneath it (the projects table redraws on every sync event).
    watchdog = setInterval(() => { if (!marker.isConnected) hide(); }, 300);
    place();
  };

  const hide = () => {
    clearTimeout(hideTimer);
    clearInterval(watchdog);
    watchdog = null;
    const wasOpen = !!bubble;
    bubble?.remove();
    bubble = null;
    marker.setAttribute('aria-expanded', 'false');
    if (openBubble === hide) openBubble = null;
    if (wasOpen) onClose?.();
  };
  // A moment's grace so the pointer can travel from the marker into the bubble.
  const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 180); };

  marker.addEventListener('mouseenter', show);
  marker.addEventListener('mouseleave', hideSoon);
  marker.addEventListener('focus', show);
  marker.addEventListener('blur', hide);
  marker.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    bubble ? hide() : show();
  });
  marker.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('mousedown', (e) => {
    if (bubble && e.target !== marker && !bubble.contains(e.target)) hide();
  });

  return marker;
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

/**
 * The 🌐 button that opens an entry's link in a new tab, or null when there is
 * no link. The address is checked again here, so a stored value that is not
 * http(s) can never become a clickable href.
 */
export function linkButton(link) {
  const href = safeLink(link);
  if (!href) return null;
  return el('a', {
    class: 'btn icon link', href, target: '_blank', rel: 'noopener noreferrer',
    title: href, 'aria-label': `Open ${href}`,
  }, '🌐');
}
