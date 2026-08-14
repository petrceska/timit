/**
 * Add / edit dialog for a single time entry. Shared by the popup and the
 * dashboard, and opened by clicking an entry in any list.
 *
 * Resolves with { action: 'saved' | 'deleted', entry } or undefined if the
 * dialog was cancelled.
 */
import { el, modal } from './ui.js';
import { ProjectPicker } from './picker.js';
import { Store } from './store.js';
import {
  dayKey, timeInput, combineDateTime, formatClock, parseDuration,
} from './time.js';

export function openEntryEditor(entry = null) {
  const now = new Date();
  const isRunning = !!entry && entry.end === null;
  const start = entry ? new Date(entry.start) : new Date(now.getTime() - 3600000);
  const end = entry?.end ? new Date(entry.end) : now;

  return modal((close) => {
    const desc = el('input', {
      type: 'text', value: entry?.description || '',
      placeholder: 'What did you work on?',
    });
    const pickerHost = el('div');
    const dateIn = el('input', { type: 'date', value: dayKey(start) });
    const startIn = el('input', { type: 'time', step: '1', value: timeInput(start) });
    const endIn = el('input', { type: 'time', step: '1', value: timeInput(end) });
    const durIn = el('input', { type: 'text', class: 'mono', placeholder: '1:30' });
    const billable = el('input', { type: 'checkbox' });
    if (entry?.billable) billable.checked = true;
    const tagsIn = el('input', {
      type: 'text', value: (entry?.tags || []).join(', '), placeholder: 'comma, separated',
    });
    const err = el('div', { class: 'error' });

    const bounds = () => {
      const s = combineDateTime(dateIn.value, startIn.value);
      let e = combineDateTime(dateIn.value, endIn.value);
      if (e.getTime() < s.getTime()) e = new Date(e.getTime() + 86400000); // over midnight
      return [s, e];
    };
    const syncDuration = () => {
      if (isRunning) return;
      const [s, e] = bounds();
      durIn.value = formatClock(e - s);
    };
    dateIn.addEventListener('change', syncDuration);
    startIn.addEventListener('change', syncDuration);
    endIn.addEventListener('change', syncDuration);
    durIn.addEventListener('change', () => {
      const ms = parseDuration(durIn.value);
      if (ms == null) return syncDuration();
      const [s] = bounds();
      endIn.value = timeInput(new Date(s.getTime() + ms));
      syncDuration();
    });
    syncDuration();

    const save = async () => {
      const data = {
        description: desc.value.trim(),
        projectId: picker.getValue(),
        billable: billable.checked,
        tags: tagsIn.value.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (isRunning) {
        // The end time belongs to the timer — only the start can be corrected.
        const s = combineDateTime(dateIn.value, startIn.value);
        if (s.getTime() > Date.now()) {
          err.textContent = 'A running entry cannot start in the future.';
          return;
        }
        data.start = s.getTime();
      } else {
        const [s, e] = bounds();
        if (e - s <= 0) { err.textContent = 'End must be after start.'; return; }
        data.start = s.getTime();
        data.end = e.getTime();
      }
      const saved = entry
        ? await Store.updateEntry(entry.id, data)
        : await Store.addEntry(data);
      close({ action: 'saved', entry: saved });
    };

    // Two-step delete: the second click confirms. Keeps the confirmation inside
    // this dialog instead of stacking a second modal on top of it.
    let armed = null;
    const deleteBtn = entry ? el('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!armed) {
          armed = setTimeout(() => {
            armed = null;
            deleteBtn.textContent = 'Delete';
            deleteBtn.classList.remove('armed');
          }, 4000);
          deleteBtn.textContent = 'Click again to delete';
          deleteBtn.classList.add('armed');
          return;
        }
        clearTimeout(armed);
        await Store.deleteEntry(entry.id);
        close({ action: 'deleted', entry });
      },
    }, 'Delete') : null;

    const content = el('div', {},
      el('h2', { text: entry ? (isRunning ? 'Edit running entry' : 'Edit entry') : 'Add entry' }),
      el('div', { class: 'field' }, el('label', { text: 'Description' }), desc),
      el('div', { class: 'field' }, el('label', { text: 'Project' }), pickerHost),
      isRunning
        ? el('div', { class: 'field-row' },
          el('div', { class: 'field' }, el('label', { text: 'Date' }), dateIn),
          el('div', { class: 'field' }, el('label', { text: 'Started at' }), startIn))
        : el('div', { class: 'field-row' },
          el('div', { class: 'field' }, el('label', { text: 'Date' }), dateIn),
          el('div', { class: 'field' }, el('label', { text: 'Start' }), startIn),
          el('div', { class: 'field' }, el('label', { text: 'End' }), endIn),
          el('div', { class: 'field' }, el('label', { text: 'Duration' }), durIn)),
      isRunning
        ? el('p', { class: 'help' }, 'Still running — the end time is set when you stop the timer.')
        : null,
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { text: 'Tags' }), tagsIn),
        el('div', { class: 'field' },
          el('label', { text: 'Billable' }),
          el('label', { class: 'row', style: 'padding-top:6px' }, billable, ' Billable'))),
      err,
      el('div', { class: 'modal-actions' },
        deleteBtn,
        deleteBtn ? el('span', { class: 'spacer' }) : null,
        el('button', { class: 'btn', onclick: () => close(undefined) }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: save }, 'Save'))
    );

    const picker = new ProjectPicker(pickerHost, {});
    picker.refresh().then(() => picker.setValue(entry?.projectId || null));
    content.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        e.preventDefault();
        save();
      }
    });
    return content;
  });
}
