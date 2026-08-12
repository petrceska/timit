import { Store, onDataChanged } from '../lib/store.js';
import { ProjectPicker } from '../lib/picker.js';
import { openEntryEditor } from '../lib/entry-editor.js';
import { toast } from '../lib/ui.js';
import { formatClock, formatHuman } from '../lib/time.js';
import { createEntriesView } from './views/entries.js';
import { createReportsView } from './views/reports.js';
import { createProjectsView } from './views/projects.js';
import { createDataView } from './views/data.js';

const $ = (sel) => document.querySelector(sel);
const descInput = $('#description');
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
    });
    const stopped = await Store.stopTimer();
    toast(stopped ? `Saved ${formatHuman(stopped.end - stopped.start)}` : 'Entry discarded (too short)');
    descInput.value = '';
    picker.setValue(null);
  } else {
    await Store.startTimer({
      description: descInput.value.trim(),
      projectId: picker.getValue(),
    });
  }
  refreshAll();
});
descInput.addEventListener('input', () => {
  if (running) { mute(); Store.updateEntry(running.id, { description: descInput.value.trim() }); }
});
descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') toggleBtn.click(); });
$('#add-manual').addEventListener('click', async () => {
  if (await openEntryEditor(null)) { toast('Entry added'); refreshAll(); }
});

/* ---------- refresh ---------- */
async function refreshAll() {
  await refreshTracker();
  await views[current].refresh();
  views[current].redraw?.();
}

onDataChanged(() => { if (Date.now() >= mutedUntil) refreshAll(); });
window.addEventListener('hashchange', () => show(location.hash.slice(1) || 'entries'));

show(location.hash.slice(1) || 'entries');
refreshTracker();
