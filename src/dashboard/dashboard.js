import { Store, onDataChanged } from '../lib/store.js';
import { ProjectPicker } from '../lib/picker.js';
import { openEntryEditor } from '../lib/entry-editor.js';
import { toast } from '../lib/ui.js';
import { formatClock, formatHuman } from '../lib/time.js';
import { createEntriesView } from './views/entries.js';
import { createReportsView } from './views/reports.js';
import { createProjectsView } from './views/projects.js';
import { createDataView } from './views/data.js';
import { scheduleSync, syncAll } from '../lib/sync.js';
import { attachSuggest } from '../lib/suggest.js';
import { descriptionRows } from '../lib/recent.js';

const $ = (sel) => document.querySelector(sel);
const descInput = $('#description');
const linkInput = $('#link');
const timerEl = $('#timer');
const toggleBtn = $('#toggle');

const app = {
  settings: await Store.getSettings(),
  refreshAll,
  reloadSettings: async () => {
    app.settings = await Store.getSettings();
    for (const v of Object.values(views)) v.onSettings?.();
    refreshAll();
  },
};

const picker = new ProjectPicker($('#project-picker'), {
  onChange: (projectId) => {
    if (running) { mute(); Store.updateEntry(running.id, { projectId }); }
  },
});

const views = {
  entries: createEntriesView($('#view-entries'), app),
  reports: createReportsView($('#view-reports'), app),
  projects: createProjectsView($('#view-projects'), app),
  data: createDataView($('#view-data'), app),
};

let current = 'entries';
let running = null;
let ticker = null;
let mutedUntil = 0;
const mute = () => { mutedUntil = Date.now() + 500; };

/* ---------- tabs ---------- */
function show(name) {
  if (!views[name]) name = 'entries';
  current = name;
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) =>
    v.classList.toggle('active', v.id === `view-${name}`));
  history.replaceState(null, '', `#${name}`);
  views[name].refresh();
  views[name].redraw?.();
}
document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => show(tab.dataset.view)));

/* ---------- tracker bar ---------- */
async function refreshTracker() {
  running = await Store.getRunning();
  await picker.refresh();
  if (running) {
    toggleBtn.textContent = 'Stop';
    toggleBtn.classList.remove('primary');
    toggleBtn.classList.add('stop');
    if (document.activeElement !== descInput) descInput.value = running.description || '';
    if (document.activeElement !== linkInput) linkInput.value = running.link || '';
    picker.setValue(running.projectId);
    tick();
    clearInterval(ticker);
    ticker = setInterval(tick, 1000);
  } else {
    toggleBtn.textContent = 'Start';
    toggleBtn.classList.add('primary');
    toggleBtn.classList.remove('stop');
    clearInterval(ticker);
    ticker = null;
    timerEl.textContent = '00:00:00';
  }
  document.title = running
    ? `${formatClock(Date.now() - running.start)} · TimIt`
    : 'TimIt';
}
function tick() {
  if (!running) return;
  timerEl.textContent = formatClock(Date.now() - running.start);
  document.title = `${formatClock(Date.now() - running.start)} · TimIt`;
}

toggleBtn.addEventListener('click', async () => {
  if (running) {
    await Store.updateEntry(running.id, {
      description: descInput.value.trim(),
      projectId: picker.getValue(),
      link: linkInput.value,
    });
    const stopped = await Store.stopTimer();
    toast(stopped ? `Saved ${formatHuman(stopped.end - stopped.start)}` : 'Entry discarded (too short)');
    descInput.value = '';
    linkInput.value = '';
    linkInput.classList.remove('invalid');
    picker.setValue(null);
  } else {
    await Store.startTimer({
      description: descInput.value.trim(),
      projectId: picker.getValue(),
      link: linkInput.value,
    });
  }
  refreshAll();
});
// Attached before the handlers below, so choosing a recent description with
// Enter does not also start or stop the timer.
attachSuggest(descInput, {
  source: async (value) =>
    descriptionRows(await Store.getEntries(), await Store.getProjectMap(), value),
  onPick: async (row) => {
    descInput.value = row.label;
    if (row.projectId && !picker.getValue()) await picker.setValue(row.projectId);
    if (running) {
      mute();
      Store.updateEntry(running.id, { description: row.label, projectId: picker.getValue() });
    }
  },
});
descInput.addEventListener('input', () => {
  if (running) { mute(); Store.updateEntry(running.id, { description: descInput.value.trim() }); }
});
descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') toggleBtn.click(); });
linkInput.addEventListener('input', () => {
  // Only web addresses are kept; say so instead of dropping it silently on Stop.
  const bad = linkInput.value.trim() !== '' && !Store.safeLink(linkInput.value);
  linkInput.classList.toggle('invalid', bad);
  linkInput.title = bad ? 'Not a web address — it will not be saved' : '';
  if (running) { mute(); Store.updateEntry(running.id, { link: linkInput.value }); }
});
linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') toggleBtn.click(); });
$('#add-manual').addEventListener('click', async () => {
  if (await openEntryEditor(null)) { toast('Entry added'); refreshAll(); }
});

/* ---------- refresh ---------- */
async function refreshAll() {
  await refreshTracker();
  await views[current].refresh();
  views[current].redraw?.();
}

onDataChanged(() => {
  // Files are only rewritten for projects whose tracked time actually changed,
  // so this is a no-op while a timer is merely running.
  scheduleSync();
  if (Date.now() >= mutedUntil) refreshAll();
});
window.addEventListener('hashchange', () => show(location.hash.slice(1) || 'entries'));

show(location.hash.slice(1) || 'entries');
refreshTracker();
// Catch up on anything that changed while no extension page was open.
syncAll({ interactive: false });
