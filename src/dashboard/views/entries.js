import { Store } from '../../lib/store.js';
import { el, toast, confirmDialog } from '../../lib/ui.js';
import { openEntryEditor } from '../../lib/entry-editor.js';
import { RangeControl } from '../../lib/range.js';
import { toCSV, downloadText } from '../../lib/csv.js';
import {
  durationOf, formatHuman, formatClock, friendlyDate, clockTime, dayKey, fromDayKey,
} from '../../lib/time.js';

export function createEntriesView(root, app) {
  const selected = new Set();
  let search = '';
  let projectFilter = 'all';

  const rangeHost = el('div');
  const searchIn = el('input', {
    type: 'search', class: 'search', placeholder: 'Search descriptions…',
    oninput: () => { search = searchIn.value.trim().toLowerCase(); refresh(); },
  });
  const projectSel = el('select', {
    onchange: () => { projectFilter = projectSel.value; refresh(); },
  });
  const bulkBar = el('div', { class: 'bulk-bar hidden' });
  const list = el('div');

  root.append(
    el('div', { class: 'toolbar' },
      rangeHost,
      projectSel,
      searchIn,
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn', onclick: () => exportVisible(),
      }, '⭳ Export CSV'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          if (await openEntryEditor(null)) { toast('Entry added'); app.refreshAll(); }
        },
      }, '+ Add entry')),
    bulkBar,
    list);

  const range = new RangeControl(rangeHost, {
    preset: 'week',
    weekStart: app.settings.weekStart,
    onChange: () => { selected.clear(); refresh(); },
  });

  let visible = [];
  let projects = new Map();

  async function refresh() {
    projects = await Store.getProjectMap();
    const all = await Store.getEntries();

    // project filter dropdown
    const keep = projectSel.value;
    projectSel.innerHTML = '';
    projectSel.append(el('option', { value: 'all' }, 'All projects'));
    projectSel.append(el('option', { value: 'none' }, 'No project'));
    for (const p of projects.values()) {
      projectSel.append(el('option', { value: p.id, selected: p.id === keep }, p.name));
    }
    projectSel.value = [...projects.keys(), 'all', 'none'].includes(keep) ? keep : 'all';
    projectFilter = projectSel.value;

    visible = all.filter((e) => {
      if (!range.contains(e)) return false;
      if (projectFilter === 'none' && e.projectId) return false;
      if (projectFilter !== 'all' && projectFilter !== 'none' && e.projectId !== projectFilter) return false;
      if (search) {
        const p = e.projectId ? projects.get(e.projectId) : null;
        const hay = `${e.description || ''} ${p ? p.name : ''} ${(e.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    renderBulk();
    renderList();
  }

  function renderBulk() {
    bulkBar.classList.toggle('hidden', selected.size === 0);
    if (!selected.size) return;
    const chosen = visible.filter((e) => selected.has(e.id));
    const total = chosen.reduce((a, e) => a + durationOf(e), 0);
    bulkBar.innerHTML = '';
    bulkBar.append(
      el('b', {}, `${selected.size} selected`),
      el('span', { class: 'muted mono' }, formatHuman(total)),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn', onclick: async () => {
          const target = await pickProject(projects);
          if (target === undefined) return;
          for (const id of selected) await Store.updateEntry(id, { projectId: target });
          toast('Moved');
          app.refreshAll();
        },
      }, 'Move to project…'),
      el('button', {
        class: 'btn', onclick: () => {
          downloadText(csvName(), toCSV(chosen, projects, app.settings));
        },
      }, '⭳ Export selection'),
      el('button', {
        class: 'btn danger', onclick: async () => {
          const ok = await confirmDialog({
            title: `Delete ${selected.size} entries?`,
            body: 'This cannot be undone.',
          });
          if (!ok) return;
          await Store.deleteEntries([...selected]);
          selected.clear();
          toast('Deleted');
          app.refreshAll();
        },
      }, 'Delete'),
      el('button', { class: 'btn ghost', onclick: () => { selected.clear(); refresh(); } }, 'Clear'));
  }

  function renderList() {
    list.innerHTML = '';
    if (!visible.length) {
      list.append(el('div', { class: 'empty-state' },
        el('p', {}, 'No entries in this range.'),
        el('p', { class: 'muted' }, 'Change the date range, or add an entry manually.')));
      return;
    }

    const byDay = new Map();
    for (const e of visible) {
      const key = dayKey(e.start);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    }

    for (const [key, items] of byDay) {
      const total = items.reduce((a, e) => a + durationOf(e), 0);
      const allChecked = items.every((e) => selected.has(e.id));
      const group = el('div', { class: 'day-group' },
        el('div', { class: 'day-head' },
          el('input', {
            type: 'checkbox', checked: allChecked,
            title: 'Select this day',
            onchange: (ev) => {
              for (const e of items) {
                if (ev.target.checked) selected.add(e.id); else selected.delete(e.id);
              }
              refresh();
            },
          }),
          el('span', {}, friendlyDate(fromDayKey(key))),
          el('span', { class: 'total mono' }, formatHuman(total))));

      for (const e of items) group.append(entryRow(e));
      list.append(group);
    }
  }

  async function editEntry(e) {
    const result = await openEntryEditor(e);
    if (!result) return;
    if (result.action === 'deleted') { selected.delete(e.id); toast('Entry deleted'); }
    else toast('Saved');
    app.refreshAll();
  }

  function entryRow(e) {
    const p = e.projectId ? projects.get(e.projectId) : null;
    const running = e.end === null;
    return el('div', {
      class: 'entry-row clickable' + (running ? ' running' : ''),
      title: 'Click to edit',
      onclick: (ev) => {
        // The checkbox and the action buttons keep their own behaviour.
        if (ev.target.closest('button, input, .picker')) return;
        editEntry(e);
      },
    },
      el('input', {
        type: 'checkbox', checked: selected.has(e.id),
        onchange: (ev) => {
          if (ev.target.checked) selected.add(e.id); else selected.delete(e.id);
          renderBulk();
        },
      }),
      el('span', {
        class: 'desc' + (e.description ? '' : ' none'),
        text: e.description || 'No description',
        title: e.description || '',
      }),
      (e.tags || []).length ? el('span', { class: 'badge-billable', text: e.tags.join(', ') }) : null,
      e.billable ? el('span', { class: 'badge-billable' }, '$') : null,
      el('span', { class: 'proj' },
        el('span', { class: 'dot' + (p ? '' : ' empty-dot'), style: p ? `background:${p.color}` : '' }),
        el('span', { class: 'name', text: p ? p.name : 'No project' })),
      el('span', { class: 'times mono' },
        running ? 'running…' : `${clockTime(e.start)} – ${clockTime(e.end)}`),
      el('span', { class: 'dur mono' }, running ? '—' : formatClock(durationOf(e))),
      el('span', { class: 'actions' },
        el('button', {
          class: 'btn icon', title: 'Start again',
          onclick: async () => {
            await Store.startTimer({ description: e.description, projectId: e.projectId });
            app.refreshAll();
          },
        }, '▶'),
        el('button', {
          class: 'btn icon', title: 'Edit',
          onclick: () => editEntry(e),
        }, '✎'),
        el('button', {
          class: 'btn icon', title: 'Delete',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Delete this entry?',
              body: `${e.description || 'No description'} — ${formatHuman(durationOf(e))}`,
            });
            if (!ok) return;
            await Store.deleteEntry(e.id);
            selected.delete(e.id);
            toast('Deleted');
            app.refreshAll();
          },
        }, '🗑')));
  }

  function csvName() {
    const r = range.get();
    return `timit-${dayKey(r.from === 0 ? new Date() : r.from)}_${dayKey(r.to)}.csv`;
  }

  function exportVisible() {
    const done = visible.filter((e) => e.end !== null);
    if (!done.length) return toast('Nothing to export in this range');
    downloadText(csvName(), toCSV(done, projects, app.settings));
    toast(`Exported ${done.length} entries`);
  }

  return {
    refresh,
    onSettings: () => range.setWeekStart(app.settings.weekStart),
    getRange: () => range.get(),
  };
}

/** Little "choose a project" prompt used by bulk actions. */
async function pickProject(projects) {
  const { modal } = await import('../../lib/ui.js');
  const { ProjectPicker } = await import('../../lib/picker.js');
  return modal((close) => {
    const host = el('div');
    const content = el('div', {},
      el('h2', {}, 'Move entries to project'),
      el('div', { class: 'field' }, host),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: () => close(undefined) }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: () => close(picker.getValue()) }, 'Move')));
    const picker = new ProjectPicker(host, {});
    picker.refresh();
    return content;
  });
}
