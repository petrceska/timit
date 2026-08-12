import { Store, onDataChanged } from '../lib/store.js';
import { ProjectPicker } from '../lib/picker.js';
import { openEntryEditor } from '../lib/entry-editor.js';
import { el, toast } from '../lib/ui.js';
import {
  formatClock, formatHuman, durationOf, friendlyDate, clockTime,
  startOfDay, startOfWeek,
} from '../lib/time.js';

const $ = (sel) => document.querySelector(sel);
const descInput = $('#description');
const timerEl = $('#timer');
const toggleBtn = $('#toggle');
const listEl = $('#recent-list');

const picker = new ProjectPicker($('#project-picker'), {
  onChange: (projectId) => {
    if (running) { mute(); Store.updateEntry(running.id, { projectId }); }
  },
});

let running = null;
let projects = new Map();
let ticker = null;
// Our own writes (e.g. typing a description) come back as storage events; ignore
// those briefly so the UI doesn't re-render under the user's cursor.
let mutedUntil = 0;
const mute = () => { mutedUntil = Date.now() + 500; };

function openDashboard(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html' + hash) });
  window.close();
}

async function refresh() {
  projects = await Store.getProjectMap();
  const entries = await Store.getEntries();
  running = entries.find((e) => e.end === null) || null;
  await picker.refresh();

  if (running) {
    toggleBtn.textContent = 'Stop';
    toggleBtn.classList.remove('primary');
    toggleBtn.classList.add('stop');
    if (document.activeElement !== descInput) descInput.value = running.description || '';
    picker.setValue(running.projectId);
    startTicking();
  } else {
    toggleBtn.textContent = 'Start';
    toggleBtn.classList.add('primary');
    toggleBtn.classList.remove('stop');
    stopTicking();
    timerEl.textContent = '00:00:00';
  }

  renderTotals(entries);
  renderRecent(entries.filter((e) => e.end !== null).slice(0, 25));
}

function startTicking() {
  stopTicking();
  const tick = () => { timerEl.textContent = formatClock(Date.now() - running.start); };
  tick();
  ticker = setInterval(tick, 1000);
}
function stopTicking() { if (ticker) clearInterval(ticker); ticker = null; }

async function renderTotals(entries) {
  const settings = await Store.getSettings();
  const dayFrom = startOfDay(new Date()).getTime();
  const weekFrom = startOfWeek(new Date(), settings.weekStart).getTime();
  const sum = (from) => entries
    .filter((e) => e.start >= from)
    .reduce((a, e) => a + durationOf(e), 0);
  $('#total-today').textContent = formatHuman(sum(dayFrom));
  $('#total-week').textContent = formatHuman(sum(weekFrom));
}

function renderRecent(entries) {
  listEl.innerHTML = '';
  if (!entries.length) {
    listEl.append(el('li', { class: 'empty' },
      'No entries yet. Hit Start, or add one manually.'));
    return;
  }
  let lastDay = null;
  for (const e of entries) {
    const key = friendlyDate(e.start);
    if (key !== lastDay) {
      lastDay = key;
      const dayTotal = entries
        .filter((x) => friendlyDate(x.start) === key)
        .reduce((a, x) => a + durationOf(x), 0);
      listEl.append(el('li', { class: 'day' },
        el('span', { text: key }),
        el('span', { class: 'mono', text: formatHuman(dayTotal) })));
    }
    const project = e.projectId ? projects.get(e.projectId) : null;
    listEl.append(el('li', { class: 'entry' },
      el('div', { class: 'meta' },
        el('div', {
          class: 'desc' + (e.description ? '' : ' none'),
          text: e.description || 'No description',
          title: e.description || '',
        }),
        el('div', { class: 'sub' },
          project ? el('span', { class: 'dot', style: `background:${project.color}` }) : null,
          el('span', { text: project ? project.name : 'No project' }),
          el('span', { text: '·' }),
          el('span', { class: 'mono', text: `${clockTime(e.start)}–${clockTime(e.end)}` }))),
      el('span', { class: 'dur mono', text: formatHuman(durationOf(e)) }),
      el('button', {
        class: 'btn icon resume', title: 'Start this again',
        onclick: () => resume(e),
      }, '▶')));
  }
}

async function resume(entry) {
  await Store.startTimer({ description: entry.description, projectId: entry.projectId });
  descInput.value = entry.description || '';
  await refresh();
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
  await refresh();
});

descInput.addEventListener('input', () => {
  if (running) { mute(); Store.updateEntry(running.id, { description: descInput.value.trim() }); }
});
descInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') toggleBtn.click();
});

$('#add-manual').addEventListener('click', async () => {
  const saved = await openEntryEditor(null);
  if (saved) { toast('Entry added'); await refresh(); }
});
$('#open-dashboard').addEventListener('click', () => openDashboard());
$('#see-all').addEventListener('click', () => openDashboard('#entries'));

onDataChanged(() => { if (Date.now() >= mutedUntil) refresh(); });
refresh();
descInput.focus();
