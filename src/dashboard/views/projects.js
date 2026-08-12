import { Store, PALETTE } from '../../lib/store.js';
import { el, toast, modal, confirmDialog } from '../../lib/ui.js';
import { durationOf, formatHuman, friendlyDate } from '../../lib/time.js';

export function createProjectsView(root, app) {
  let showArchived = false;
  const table = el('div');

  root.append(
    el('div', { class: 'toolbar' },
      el('label', { class: 'row' },
        el('input', {
          type: 'checkbox',
          onchange: (e) => { showArchived = e.target.checked; refresh(); },
        }), ' Show archived'),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn primary',
        onclick: async () => { if (await editProject(null)) app.refreshAll(); },
      }, '+ New project')),
    table);

  async function refresh() {
    const projects = await Store.getProjects();
    const entries = await Store.getEntries();

    const stats = new Map();
    let unassigned = { ms: 0, count: 0, last: 0 };
    for (const e of entries) {
      const ms = durationOf(e);
      if (!e.projectId) {
        unassigned.ms += ms; unassigned.count++;
        unassigned.last = Math.max(unassigned.last, e.start);
        continue;
      }
      const s = stats.get(e.projectId) || { ms: 0, count: 0, last: 0 };
      s.ms += ms; s.count++; s.last = Math.max(s.last, e.start);
      stats.set(e.projectId, s);
    }
    const grandTotal = entries.reduce((a, e) => a + durationOf(e), 0) || 1;

    const shown = projects.filter((p) => showArchived || !p.archived);
    table.innerHTML = '';
    if (!shown.length) {
      table.append(el('div', { class: 'empty-state' },
        el('p', {}, 'No projects yet.'),
        el('p', { class: 'muted' }, 'Create one here, or just type a new name in the project picker while tracking.')));
      return;
    }

    const rows = shown.map((p) => {
      const s = stats.get(p.id) || { ms: 0, count: 0, last: 0 };
      const share = (s.ms / grandTotal) * 100;
      return el('tr', {},
        el('td', {},
          el('span', { class: 'row' },
            el('span', { class: 'swatch', style: `background:${p.color}` }),
            el('b', { text: p.name }),
            p.archived ? el('span', { class: 'archived-chip' }, 'archived') : null)),
        el('td', { class: 'muted', text: p.client || '—' }),
        el('td', { class: 'num mono', text: formatHuman(s.ms) }),
        el('td', { class: 'num mono', text: String(s.count) }),
        el('td', { class: 'bar-cell' },
          el('div', { class: 'bar-track' },
            el('div', { class: 'bar-fill', style: `width:${share.toFixed(1)}%;background:${p.color}` })),
          el('span', { class: 'muted', style: 'font-size:11px' }, `${share.toFixed(1)}%`)),
        el('td', { class: 'muted', text: s.last ? friendlyDate(s.last) : '—' }),
        el('td', { class: 'num' },
          el('button', {
            class: 'btn icon', title: 'Edit',
            onclick: async () => { if (await editProject(p)) app.refreshAll(); },
          }, '✎'),
          el('button', {
            class: 'btn icon', title: p.archived ? 'Unarchive' : 'Archive',
            onclick: async () => {
              await Store.updateProject(p.id, { archived: !p.archived });
              toast(p.archived ? 'Unarchived' : 'Archived');
              app.refreshAll();
            },
          }, p.archived ? '⇧' : '⇩'),
          el('button', {
            class: 'btn icon', title: 'Delete',
            onclick: () => removeProject(p, s.count),
          }, '🗑')));
    });

    table.append(el('div', { class: 'card' },
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Project'),
          el('th', {}, 'Client'),
          el('th', { class: 'num' }, 'Tracked'),
          el('th', { class: 'num' }, 'Entries'),
          el('th', {}, 'Share'),
          el('th', {}, 'Last used'),
          el('th', {}, ''))),
        el('tbody', {}, rows))));

    if (unassigned.count) {
      table.append(el('div', { class: 'card' },
        el('div', { class: 'row' },
          el('span', { class: 'dot empty-dot' }),
          el('b', {}, 'No project'),
          el('span', { class: 'spacer' }),
          el('span', { class: 'mono' }, formatHuman(unassigned.ms)),
          el('span', { class: 'muted' }, `${unassigned.count} entries`))));
    }
  }

  async function removeProject(project, entryCount) {
    if (!entryCount) {
      const ok = await confirmDialog({
        title: `Delete "${project.name}"?`,
        body: 'It has no time entries.',
      });
      if (!ok) return;
      await Store.deleteProject(project.id);
      toast('Project deleted');
      return app.refreshAll();
    }

    const others = (await Store.getProjects()).filter((p) => p.id !== project.id);
    const choice = await modal((close) => {
      const sel = el('select', {},
        el('option', { value: '' }, 'Leave them without a project'),
        others.map((p) => el('option', { value: p.id }, `Move to “${p.name}”`)));
      return el('div', {},
        el('h2', {}, `Delete "${project.name}"?`),
        el('p', { class: 'muted' },
          `${entryCount} time ${entryCount === 1 ? 'entry uses' : 'entries use'} this project. What should happen to them?`),
        el('div', { class: 'field' }, sel),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', onclick: () => close(undefined) }, 'Cancel'),
          el('button', { class: 'btn danger', onclick: () => close(sel.value || null) }, 'Delete project')));
    });
    if (choice === undefined) return;
    await Store.deleteProject(project.id, { reassignTo: choice });
    toast('Project deleted');
    app.refreshAll();
  }

  return { refresh, onSettings: () => {} };
}

/** Create/edit dialog. Resolves truthy when something was saved. */
export function editProject(project) {
  return modal((close) => {
    const name = el('input', { type: 'text', value: project?.name || '', placeholder: 'Project name' });
    const client = el('input', { type: 'text', value: project?.client || '', placeholder: 'Optional' });
    const archived = el('input', { type: 'checkbox' });
    archived.checked = !!project?.archived;
    let color = project?.color || PALETTE[0];
    const err = el('div', { class: 'error' });

    const swatches = el('div', { class: 'colors' }, PALETTE.map((c) =>
      el('button', {
        type: 'button', style: `background:${c}`,
        class: c === color ? 'sel' : '',
        onclick: (ev) => {
          color = c;
          swatches.querySelectorAll('button').forEach((b) => b.classList.remove('sel'));
          ev.currentTarget.classList.add('sel');
        },
      })));

    const save = async () => {
      try {
        if (project) {
          await Store.updateProject(project.id, {
            name: name.value, client: client.value.trim(), color, archived: archived.checked,
          });
        } else {
          const created = await Store.addProject({ name: name.value, client: client.value.trim(), color });
          if (!created) throw new Error('Could not create project');
        }
        close(true);
      } catch (e) {
        err.textContent = e.message;
      }
    };

    const content = el('div', {},
      el('h2', {}, project ? 'Edit project' : 'New project'),
      el('div', { class: 'field' }, el('label', {}, 'Name'), name),
      el('div', { class: 'field' }, el('label', {}, 'Client'), client),
      el('div', { class: 'field' }, el('label', {}, 'Colour'), swatches),
      project ? el('label', { class: 'row' }, archived, ' Archived (hidden from pickers)') : null,
      err,
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: save }, 'Save')));
    content.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') {
        e.preventDefault(); save();
      }
    });
    return content;
  });
}
