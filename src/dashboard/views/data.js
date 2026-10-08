import { Store, DEFAULT_SETTINGS } from '../../lib/store.js';
import { el, toast, confirmDialog, modal } from '../../lib/ui.js';
import { toCSV, fromCSV, downloadText, EXPORT_COLUMNS } from '../../lib/csv.js';
import { formatHuman, dayKey, clockTime } from '../../lib/time.js';
import { listHandleKeys, deleteHandle } from '../../lib/fsdb.js';

export function createDataView(root, app) {
  const stats = el('p', { class: 'help' });

  /* ---------- export ---------- */
  const exportCard = el('div', { class: 'card' },
    el('h3', {}, 'Export'),
    el('p', { class: 'help' },
      'CSV uses a common detailed-report column layout, so it imports into most time trackers — ' +
      'usually through their column mapping step.'),
    stats,
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', onclick: exportCSV }, '⭳ Export all entries (CSV)'),
      el('button', { class: 'btn', onclick: exportJSON }, '⭳ Backup (JSON)')),
    el('pre', { class: 'preview', text: EXPORT_COLUMNS.join(', ') }));

  /* ---------- import ---------- */
  const csvInput = el('input', { type: 'file', accept: '.csv,text/csv', class: 'hidden' });
  const jsonInput = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
  const drop = el('div', { class: 'drop' }, 'Drop a CSV here, or click to choose a file');

  drop.addEventListener('click', () => csvInput.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) readCSV(file);
  });
  csvInput.addEventListener('change', () => {
    if (csvInput.files[0]) readCSV(csvInput.files[0]);
    csvInput.value = '';
  });
  jsonInput.addEventListener('change', async () => {
    const file = jsonInput.files[0];
    jsonInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const replace = await confirmDialog({
        title: 'Restore backup',
        body: 'Replace everything currently stored? Choose Cancel to merge instead (existing data is kept).',
        confirmText: 'Replace all',
      });
      await Store.importBackup(data, { replace });
      toast(replace ? 'Backup restored' : 'Backup merged');
      app.refreshAll();
    } catch (err) {
      toast(`Could not read backup: ${err.message}`);
    }
  });

  const importCard = el('div', { class: 'card' },
    el('h3', {}, 'Import'),
    el('p', { class: 'help' },
      'Accepts detailed-report CSVs and anything with Start Date / Start Time / ' +
      'End Time (or a Duration) columns. Missing projects are created automatically.'),
    drop, csvInput, jsonInput,
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'btn', onclick: () => jsonInput.click() }, '⭱ Restore JSON backup')));

  /* ---------- settings ---------- */
  const dateFmt = el('select', {},
    el('option', { value: 'us' }, 'MM/DD/YYYY (US)'),
    el('option', { value: 'iso' }, 'YYYY-MM-DD (ISO)'));
  const weekStart = el('select', {},
    el('option', { value: '1' }, 'Monday'),
    el('option', { value: '0' }, 'Sunday'));
  const userName = el('input', { type: 'text', placeholder: 'Your name (CSV "User" column)' });
  const userEmail = el('input', { type: 'email', placeholder: 'you@example.com (CSV "Email" column)' });
  const pageSuggestions = el('input', { type: 'checkbox' });

  for (const node of [dateFmt, weekStart, userName, userEmail, pageSuggestions]) {
    node.addEventListener('change', saveSettings);
  }

  const settingsCard = el('div', { class: 'card' },
    el('h3', {}, 'Settings'),
    el('div', { class: 'settings-grid' },
      el('div', { class: 'field' }, el('label', {}, 'CSV date format'), dateFmt),
      el('div', { class: 'field' }, el('label', {}, 'Week starts on'), weekStart),
      el('div', { class: 'field' }, el('label', {}, 'User name'), userName),
      el('div', { class: 'field' }, el('label', {}, 'Email'), userEmail)),
    el('label', { class: 'row', style: 'margin-top:12px' }, pageSuggestions,
      ' Suggest tasks from the current tab'),
    el('p', { class: 'help' },
      'Issues, tickets, branches, files and page titles. The tab is read only when you open ' +
      'the popup or press the shortcut, and nothing about it is stored.'));

  /* ---------- danger zone ---------- */
  const dangerCard = el('div', { class: 'card danger-zone' },
    el('h3', {}, 'Danger zone'),
    el('p', { class: 'help' }, 'Everything lives in this browser profile only. Deleting it here deletes it for good.'),
    el('button', {
      class: 'btn danger',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Delete all entries and projects?',
          body: 'Export a backup first if you might want this data back. This cannot be undone.',
          confirmText: 'Delete everything',
        });
        if (!ok) return;
        // Drop the file links too — the files themselves are left on disk.
        for (const key of await listHandleKeys()) await deleteHandle(key);
        await Store.wipe();
        toast('All data deleted');
        app.refreshAll();
      },
    }, 'Delete all data'));

  root.append(
    el('div', { class: 'data-grid' },
      el('div', {}, exportCard, settingsCard),
      el('div', {}, importCard, dangerCard)));

  /* ---------- actions ---------- */
  async function exportCSV() {
    const projects = await Store.getProjectMap();
    const entries = (await Store.getEntries()).filter((e) => e.end !== null);
    if (!entries.length) return toast('No entries to export yet');
    downloadText(`timit-export-${dayKey(new Date())}.csv`, toCSV(entries, projects, app.settings));
    toast(`Exported ${entries.length} entries`);
  }

  async function exportJSON() {
    const backup = await Store.exportBackup();
    downloadText(
      `timit-backup-${dayKey(new Date())}.json`,
      JSON.stringify(backup, null, 2),
      'application/json');
    toast('Backup saved');
  }

  async function readCSV(file) {
    let parsed;
    try {
      parsed = fromCSV(await file.text(), app.settings);
    } catch (err) {
      return toast(err.message);
    }
    if (!parsed.rows.length) {
      return toast(`Nothing importable found in ${file.name}`);
    }

    const existingNames = new Set((await Store.getProjects()).map((p) => p.name.toLowerCase()));
    const newProjects = [...new Set(parsed.rows
      .map((r) => r.projectName)
      .filter((n) => n && !existingNames.has(n.toLowerCase())))];
    const totalMs = parsed.rows.reduce((a, r) => a + (r.end - r.start), 0);

    const confirmed = await modal((close) => {
      const skipDupes = el('input', { type: 'checkbox' });
      skipDupes.checked = true;
      const preview = parsed.rows.slice(0, 6).map((r) =>
        `${dayKey(r.start)} ${clockTime(r.start)}–${clockTime(r.end)}  ` +
        `${(r.projectName || 'No project').padEnd(14)}  ${r.description || ''}`).join('\n');
      return el('div', {},
        el('h2', {}, `Import ${parsed.rows.length} entries?`),
        el('p', { class: 'help' },
          `${formatHuman(totalMs)} total · ${newProjects.length} new project(s) will be created` +
          (parsed.skipped.length ? ` · ${parsed.skipped.length} row(s) skipped` : '')),
        newProjects.length
          ? el('p', { class: 'muted', style: 'font-size:12px' }, newProjects.join(', '))
          : null,
        el('label', { class: 'row' }, skipDupes, ' Skip entries that already exist (same start, project and description)'),
        el('pre', { class: 'preview', text: preview }),
        parsed.skipped.length
          ? el('p', { class: 'muted', style: 'font-size:11px' },
              `Skipped rows: ${parsed.skipped.slice(0, 5).map((s) => `line ${s.line} (${s.reason})`).join('; ')}`)
          : null,
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
          el('button', { class: 'btn primary', onclick: () => close({ skipDupes: skipDupes.checked }) }, 'Import')));
    });
    if (!confirmed) return;

    // Resolve/create projects
    const byName = new Map();
    for (const p of await Store.getProjects()) byName.set(p.name.toLowerCase(), p);
    for (const name of newProjects) {
      const created = await Store.addProject({ name });
      byName.set(name.toLowerCase(), created);
    }

    const existing = new Set((await Store.getEntries())
      .map((e) => `${e.start}|${e.projectId || ''}|${e.description || ''}`));

    const toAdd = [];
    let duplicates = 0;
    for (const r of parsed.rows) {
      const project = r.projectName ? byName.get(r.projectName.toLowerCase()) : null;
      const key = `${r.start}|${project?.id || ''}|${r.description || ''}`;
      if (confirmed.skipDupes && existing.has(key)) { duplicates++; continue; }
      existing.add(key);
      toAdd.push({
        projectId: project?.id || null,
        description: r.description,
        start: r.start,
        end: r.end,
        tags: r.tags,
        billable: r.billable,
      });
    }
    if (toAdd.length) await Store.addEntries(toAdd);
    toast(`Imported ${toAdd.length} entries` + (duplicates ? ` · skipped ${duplicates} duplicates` : ''));
    app.refreshAll();
  }

  async function saveSettings() {
    await Store.saveSettings({
      csvDateFormat: dateFmt.value,
      weekStart: Number(weekStart.value),
      userName: userName.value.trim(),
      userEmail: userEmail.value.trim(),
      pageSuggestions: pageSuggestions.checked,
    });
    toast('Settings saved');
    app.reloadSettings();
  }

  async function refresh() {
    const s = { ...DEFAULT_SETTINGS, ...app.settings };
    dateFmt.value = s.csvDateFormat === 'iso' ? 'iso' : 'us';
    weekStart.value = String(s.weekStart);
    if (document.activeElement !== userName) userName.value = s.userName || '';
    if (document.activeElement !== userEmail) userEmail.value = s.userEmail || '';
    pageSuggestions.checked = s.pageSuggestions !== false;

    const entries = await Store.getEntries();
    const projects = await Store.getProjects();
    const done = entries.filter((e) => e.end !== null);
    const total = done.reduce((a, e) => a + (e.end - e.start), 0);
    stats.textContent = `${done.length} entries · ${projects.length} projects · ${formatHuman(total)} tracked in total.`;
  }

  return { refresh, onSettings: () => {} };
}
