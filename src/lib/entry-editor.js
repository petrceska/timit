/** Add / edit dialog for a single time entry. Shared by popup and dashboard. */
import { el, modal } from './ui.js';
import { ProjectPicker } from './picker.js';
import { Store } from './store.js';
import {
  dayKey, timeInput, combineDateTime, formatClock, parseDuration,
} from './time.js';

/**
 * @param {object|null} entry existing entry, or null for a new one
 * @returns {Promise<object|undefined>} the saved entry, or undefined if cancelled
 */
export function openEntryEditor(entry = null) {
  const now = new Date();
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
      const e = new Date(s.getTime() + ms);
      endIn.value = timeInput(e);
      syncDuration();
    });
    syncDuration();

    const save = async () => {
      const [s, e] = bounds();
      if (e - s <= 0) { err.textContent = 'End must be after start.'; return; }
      const data = {
        description: desc.value.trim(),
        projectId: picker.getValue(),
        start: s.getTime(),
        end: e.getTime(),
        billable: billable.checked,
        tags: tagsIn.value.split(',').map((t) => t.trim()).filter(Boolean),
      };
      const saved = entry
        ? await Store.updateEntry(entry.id, data)
        : await Store.addEntry(data);
      close(saved);
    };

    const content = el('div', {},
      el('h2', { text: entry ? 'Edit entry' : 'Add entry' }),
      el('div', { class: 'field' }, el('label', { text: 'Description' }), desc),
      el('div', { class: 'field' }, el('label', { text: 'Project' }), pickerHost),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { text: 'Date' }), dateIn),
        el('div', { class: 'field' }, el('label', { text: 'Start' }), startIn),
        el('div', { class: 'field' }, el('label', { text: 'End' }), endIn),
        el('div', { class: 'field' }, el('label', { text: 'Duration' }), durIn)),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { text: 'Tags' }), tagsIn),
        el('div', { class: 'field' },
          el('label', { text: 'Billable' }),
          el('label', { class: 'row', style: 'padding-top:6px' }, billable, ' Billable'))),
      err,
      el('div', { class: 'modal-actions' },
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
