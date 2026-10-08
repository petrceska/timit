/**
 * Suggestion list under a text input. Used for descriptions and tags, in the
 * entry dialog and in the tracker bars.
 *
 * The list opens while typing, or on ArrowDown in an empty field. Nothing is
 * highlighted until an arrow key is pressed, so Enter keeps its usual meaning
 * (save, start the timer) unless a suggestion was chosen on purpose.
 */
import { el } from './ui.js';
import { safeColor } from './store.js';

/**
 * @param {HTMLInputElement} input  must already be inside its parent element
 * @param {object} opts
 *   source(value)  rows to show: [{ label, hint?, color? }], or a promise of them
 *   onPick(row)    called when a row is chosen; it updates the input
 *   token(value)   the part of the value being typed (default: all of it)
 */
export function attachSuggest(input, { source, onPick, token = (v) => v.trim() }) {
  const host = input.parentNode;
  const list = el('ul', { class: 'suggest-pop', role: 'listbox', hidden: true });
  host.classList.add('suggest-host');
  host.append(list);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  let rows = [];
  let active = -1;
  // Bumped whenever the list is refreshed or closed, so a slow source can't
  // reopen the list with rows for text that has since changed.
  let request = 0;

  const isOpen = () => !list.hidden;

  function close() {
    request++;
    rows = [];
    active = -1;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  function pick(row) {
    close();
    onPick(row);
  }

  function render() {
    list.textContent = '';
    rows.forEach((row, i) => {
      const dot = row.color ? el('span', { class: 'dot' }) : null;
      if (dot) dot.style.background = safeColor(row.color);
      list.append(el('li', {
        class: 'suggest-row' + (i === active ? ' active' : ''),
        role: 'option',
        // mousedown, not click: it must act before the input loses focus.
        onmousedown: (e) => { e.preventDefault(); pick(row); },
      },
        el('span', { class: 'name', text: row.label }),
        row.hint ? el('span', { class: 'hint' }, dot, el('span', { text: row.hint })) : null));
    });
    // Line the list up with the input, whatever else shares its parent.
    list.style.left = `${input.offsetLeft}px`;
    list.style.top = `${input.offsetTop + input.offsetHeight + 4}px`;
    list.style.minWidth = `${input.offsetWidth}px`;
  }

  /** @param {boolean} force  show recent values even if nothing is typed yet */
  async function refresh(force = false) {
    if (!force && !token(input.value)) return close();
    const mine = ++request;
    const found = await source(input.value);
    if (mine !== request || document.activeElement !== input) return;
    if (!found.length) return close();
    rows = found;
    active = -1;
    render();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function move(dir) {
    active = (active + dir + rows.length) % rows.length;
    render();
    list.querySelector('.suggest-row.active')?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => refresh());
  input.addEventListener('blur', close);
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (isOpen()) {
        e.preventDefault();
        move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        await refresh(true);
        if (isOpen()) move(1);
      }
    } else if (e.key === 'Enter' && isOpen() && active >= 0) {
      // Stop here so the form around the input does not treat this as "save".
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(rows[active]);
    } else if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  });

  return { close, isOpen };
}
