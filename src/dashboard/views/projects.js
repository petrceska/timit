import { Store, PALETTE } from '../../lib/store.js';
import { el, toast, modal, confirmDialog, infoBubble } from '../../lib/ui.js';
import { durationOf, formatHuman, friendlyDate } from '../../lib/time.js';
import { fsSupported, fsUnavailableReason, FLAG_URL, deleteHandle } from '../../lib/fsdb.js';
import {
  connectProjectFile, disconnectProjectFile, syncProject, describeResult, onSyncEvent,
} from '../../lib/sync.js';

export function createProjectsView(root, app) {
  let showArchived = false;
  let deferredRefresh = false;
  const table = el('div');
  const banner = el('div');

  onSyncEvent(() => { if (root.classList.contains('active')) refresh(); });

  root.append(
    banner,
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
    // Never redraw out from under an open explanation — see syncInfo().
    if (document.querySelector('.info-bubble')) { deferredRefresh = true; return; }
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
    await renderBanner(projects);
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
        el('td', {}, syncCell(p)),
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
          el('th', {}, 'File sync', syncInfo()),
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

  /* ---------------------------------------------------------- file sync ---- */

  /** The explanation shown by every file-sync ⓘ marker. */
  const syncExplainer = () => [
    el('p', {},
      el('b', {}, 'Keeps a CSV of this project\'s time on your computer.'),
      ' Point it at a file inside the project\'s own git repo and the timesheet ' +
      'travels with the code.'),
    el('p', {},
      el('b', {}, 'Written when time changes'),
      ' — you stop the timer, or edit, add, import or delete an entry. Starting a ' +
      'timer writes nothing.'),
    el('p', {},
      el('b', {}, 'Each row carries its entry id,'),
      ' so an edit updates that row, a deletion removes it, and rows another ' +
      'machine added through git are never touched.'),
    el('p', { class: 'muted' },
      'Runs while the popup or dashboard is open; Brave asks again for permission ' +
      'to write the file after a restart.'),
  ];

  const syncInfo = () => infoBubble(syncExplainer(), {
    label: 'What does file sync do?',
    // Redrawing the table replaces the marker and takes the bubble with it, so
    // any refresh that arrived while it was open runs once it closes.
    onClose: () => { if (deferredRefresh) { deferredRefresh = false; refresh(); } },
  });

  function syncCell(p) {
    if (!p.sync?.enabled) {
      return el('span', { class: 'row' },
        el('button', {
          class: 'btn ghost small',
          onclick: () => setupSync(p),
        }, '＋ Sync to file…'),
        syncInfo());
    }

    const state = p.sync.lastError
      ? (p.sync.lastStatus === 'needs-permission' ? 'warn' : 'bad')
      : 'good';
    const detail = p.sync.lastError
      ? p.sync.lastError
      : p.sync.lastSyncedAt ? `synced ${friendlyDate(p.sync.lastSyncedAt).toLowerCase()} ${
        new Date(p.sync.lastSyncedAt).toTimeString().slice(0, 5)}` : 'waiting for the first change';

    return el('div', { class: 'sync-cell' },
      el('div', { class: 'row' },
        el('span', { class: `sync-dot ${state}` }),
        el('button', {
          class: 'link-btn', title: 'Change the file',
          onclick: () => setupSync(p),
        }, p.sync.fileName || 'file'),
        el('button', {
          class: 'btn icon small', title: 'Sync now',
          onclick: async () => {
            const r = await syncProject(p.id, { interactive: true });
            toast(describeResult(r) || 'Nothing to sync');
            app.refreshAll();
          },
        }, '⟳'),
        el('button', {
          class: 'btn icon small', title: 'Stop syncing this project',
          onclick: async () => {
            const ok = await confirmDialog({
              title: `Stop syncing "${p.name}"?`,
              body: 'The file stays on disk exactly as it is — TimIt just stops writing to it.',
              confirmText: 'Stop syncing',
            });
            if (!ok) return;
            await disconnectProjectFile(p);
            toast('Sync turned off');
            app.refreshAll();
          },
        }, '⨯')),
      el('div', { class: `sync-detail ${state}`, text: detail }),
      p.sync.foreignRows
        ? el('div', { class: 'sync-detail muted' },
          `${p.sync.foreignRows} row${p.sync.foreignRows === 1 ? '' : 's'} from another machine kept as-is`)
        : null);
  }

  async function setupSync(project) {
    const linked = await modal((close) => {
      const nameIn = el('input', {
        type: 'text', value: project.sync?.fileName || suggestedFileName(project.name),
        placeholder: 'time.csv', spellcheck: 'false',
      });
      const err = el('div', { class: 'error' });

      // The picker has to be called straight from the click that opened it —
      // browsers only hand out file access while a user gesture is live.
      const choose = async (mode) => {
        err.textContent = '';
        if (!fsSupported()) return;
        try {
          const ok = await connectProjectFile(project, { mode, fileName: nameIn.value.trim() });
          if (!ok) {
            err.textContent = 'Without write permission the file can\'t be kept up to date.';
            return;
          }
        } catch (e) {
          if (e.name === 'AbortError') return; // the dialog was dismissed
          err.textContent = e.name === 'SecurityError' || e.name === 'NotAllowedError'
            ? 'Brave blocked the file dialog on this page. Open the dashboard in its ' +
              'own tab (the Dashboard button in the popup) and try again.'
            : `Could not link the file: ${e.message}`;
          return;
        }
        close(true);
      };

      const blocked = fsUnavailableReason();
      const content = el('div', {},
        el('h2', {}, `Sync "${project.name}" to a file`),
        // Same wording as the ⓘ bubble, so there is one description to maintain.
        el('div', { class: 'sync-explainer' }, syncExplainer()),
        blocked ? unavailableNotice(blocked) : null,
        el('div', { class: 'field' },
          el('label', {}, 'File name'),
          nameIn,
          el('span', { class: 'help' },
            'Brave only grants access through its own file dialog, so the folder is ' +
            'chosen there — this name is what the dialog starts with. In the dialog, ' +
            'navigate to the project\'s repo (macOS: ⌘⇧G types a path, Windows: paste ' +
            'one into the File name box).')),
        err,
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', onclick: () => close(undefined) }, 'Cancel'),
          el('button', {
            class: 'btn', title: 'Link a CSV that is already in the repo',
            disabled: !!blocked,
            onclick: () => choose('existing'),
          }, 'Pick existing file…'),
          el('button', {
            class: 'btn primary', disabled: !!blocked,
            onclick: () => choose('create'),
          }, 'Create file…')));

      content.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target === nameIn) { e.preventDefault(); choose('create'); }
      });
      return content;
    });
    if (!linked) return;

    const fresh = (await Store.getProjects()).find((p) => p.id === project.id);
    const result = await syncProject(project.id, { interactive: true });
    toast(describeResult(result) || `Syncing to ${fresh.sync.fileName}`);
    app.refreshAll();
  }

  /**
   * Brave keeps the File System Access API switched off unless you enable it,
   * so spell out the fix instead of just reporting that it doesn't work.
   */
  function unavailableNotice(reason) {
    if (reason === 'embedded') {
      return el('div', { class: 'notice warn' },
        el('div', {},
          el('b', {}, 'This page can\'t open a file dialog.'),
          el('div', { class: 'help' },
            'The dashboard is running inside the extensions page. Open it in its own ' +
            'tab with the Dashboard button in the popup, then try again.')));
    }
    const flag = el('code', { class: 'flag' }, FLAG_URL);
    return el('div', { class: 'notice warn' },
      el('div', {},
        el('b', {}, 'Brave has file access switched off.'),
        el('div', { class: 'help' },
          'Brave ships with the File System Access API disabled, so no extension or ' +
          'site can be given a file. To turn it on: open the address below, set ' +
          '“File System Access API” to Enabled, and relaunch Brave. Then reopen this ' +
          'dialog. (Brave blocks links to its own settings pages, so paste it in.)'),
        el('div', { class: 'row' },
          flag,
          el('button', {
            class: 'btn small',
            onclick: async (e) => {
              try {
                await navigator.clipboard.writeText(FLAG_URL);
                e.currentTarget.textContent = 'Copied';
              } catch {
                // Clipboard refused — select it so ⌘C works.
                getSelection().selectAllChildren(flag);
              }
            },
          }, 'Copy'))));
  }

  /** "Acme website" -> "acme-website-time.csv" */
  function suggestedFileName(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${slug || 'project'}-time.csv`;
  }

  async function renderBanner(projects) {
    banner.innerHTML = '';
    const stuck = projects.filter((p) => p.sync?.enabled && p.sync.lastError);
    if (!stuck.length) return;
    const needPermission = stuck.every((p) => p.sync.lastStatus === 'needs-permission');
    banner.append(el('div', { class: 'notice warn' },
      el('span', {},
        needPermission
          ? 'Brave asks again for permission to write these files after a restart: '
          : 'Some project files could not be written: ',
        el('b', {}, stuck.map((p) => p.name).join(', '))),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn',
        onclick: async () => {
          // Each prompt needs its own click, so stop at the first one that is
          // still refused and let the user press again.
          for (const p of stuck) {
            const r = await syncProject(p.id, { interactive: true });
            if (r.status === 'needs-permission') break;
          }
          app.refreshAll();
        },
      }, 'Reconnect')));
  }

  async function removeProject(project, entryCount) {
    if (!entryCount) {
      const ok = await confirmDialog({
        title: `Delete "${project.name}"?`,
        body: 'It has no time entries.',
      });
      if (!ok) return;
      await deleteHandle(project.id);
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
    await deleteHandle(project.id);
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
