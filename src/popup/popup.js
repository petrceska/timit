import { Store, onDataChanged } from '../lib/store.js';
import { ProjectPicker } from '../lib/picker.js';
import { openEntryEditor } from '../lib/entry-editor.js';
import { el, toast, linkButton } from '../lib/ui.js';
import { flushSync, syncAll } from '../lib/sync.js';
import { readActiveTab, suggestTasks } from '../lib/context.js';
import { attachSuggest } from '../lib/suggest.js';
import { descriptionRows } from '../lib/recent.js';
import {
  formatClock, formatHuman, durationOf, friendlyDate, clockTime,
  startOfDay, startOfWeek,
} from '../lib/time.js';

const $ = (sel) => document.querySelector(sel);
const descInput = $('#description');
const linkInput = $('#link');
const suggestionsEl = $('#suggestions');
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
let allEntries = [];
// What the current tab showed when the popup opened; read once, never stored.
let page = null;
// Suggestions for that page, best first. The first one is used when Start is
// pressed with an empty description.
let suggestions = [];
let ticker = null;
// Our own writes (e.g. typing a description) come back as storage events; ignore
// those briefly so the UI doesn't re-render under the user's cursor.
let mutedUntil = 0;
const mute = () => { mutedUntil = Date.now() + 500; };
// True once the user typed in the description box. Until then the box shows
// what is stored; the box is focused from the start, so focus can't tell us.
let descEdited = false;
let linkEdited = false; // the same, for the link box

function openDashboard(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html' + hash) });
  window.close();
}

async function refresh() {
  projects = await Store.getProjectMap();
  const entries = await Store.getEntries();
  allEntries = entries;
  running = entries.find((e) => e.end === null) || null;
  await picker.refresh();

  if (running) {
    toggleBtn.textContent = 'Stop';
    toggleBtn.classList.remove('primary');
    toggleBtn.classList.add('stop');
    if (!descEdited) descInput.value = running.description || '';
    if (!linkEdited) linkInput.value = running.link || '';
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
  renderSuggestions();
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
    listEl.append(el('li', {
      class: 'entry clickable', title: 'Click to edit',
      onclick: (ev) => { if (!ev.target.closest('a, button')) editEntry(e); },
    },
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
      linkButton(e.link),
      el('span', { class: 'dur mono', text: formatHuman(durationOf(e)) }),
      el('button', {
        class: 'btn icon resume', title: 'Start this again',
        onclick: () => resume(e),
      }, '▶')));
  }
}

/** Reads the tab the popup was opened on — the click is what grants access. */
async function loadSuggestions() {
  if (!(await Store.getSettings()).pageSuggestions) return;
  page = await readActiveTab();
  renderSuggestions();
}

function renderSuggestions() {
  suggestionsEl.innerHTML = '';
  suggestions = page ? suggestTasks(page, { projects: [...projects.values()], entries: allEntries }) : [];
  // Show what Start will use; the placeholder is hidden as soon as you type.
  const auto = running ? null : suggestions[0];
  descInput.placeholder = auto ? auto.description : 'What are you working on?';
  suggestions.forEach((s, i) => {
    const project = s.projectId ? projects.get(s.projectId) : null;
    const isAuto = i === 0 && auto;
    suggestionsEl.append(el('button', {
      type: 'button', class: 'suggestion' + (isAuto ? ' auto' : ''),
      title: (isAuto ? 'Start uses this when the box is empty. Click or press Tab to edit it first.\n' : '') +
        `Use “${s.description}”` + (project ? ` in ${project.name}` : ''),
      onclick: () => applySuggestion(s),
      onkeydown: moveBetweenSuggestions,
    },
      el('span', { class: 'src', text: s.source }),
      el('span', { class: 'text', text: s.description }),
      project ? el('span', { class: 'proj' },
        el('span', { class: 'dot', style: `background:${project.color}` }),
        el('span', { text: project.name })) : null));
  });
  toggleSuggestions();
}

/** Suggestions are for an empty box; once there's a description they step aside. */
function toggleSuggestions() {
  suggestionsEl.classList.toggle('hidden',
    !suggestionsEl.childElementCount || descInput.value.trim() !== '');
}

/** The address of the tab the popup was opened on, or '' if it can't be linked. */
const pageLink = () => Store.safeLink(page?.url);

/**
 * Fills the form (and a running entry) — starting is still your call.
 * A suggestion read from the page also links that page, unless a link is set.
 */
async function applySuggestion(s, { fromPage = true } = {}) {
  descInput.value = s.description;
  if (s.projectId && !picker.getValue()) await picker.setValue(s.projectId);
  if (fromPage && !linkInput.value.trim()) linkInput.value = pageLink();
  if (running) {
    mute();
    await Store.updateEntry(running.id, {
      description: s.description, projectId: picker.getValue(), link: linkInput.value,
    });
  }
  toggleSuggestions();
  descInput.focus();
}

function moveBetweenSuggestions(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const buttons = [...suggestionsEl.children];
  const i = buttons.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1);
  (i < 0 ? descInput : buttons[i])?.focus();
}

/** Sync only runs while an extension page is open, so say when it's stuck. */
async function renderSyncNotice() {
  const notice = $('#sync-notice');
  const stuck = (await Store.getProjects()).filter((p) => p.sync?.enabled && p.sync.lastError);
  notice.classList.toggle('hidden', !stuck.length);
  if (!stuck.length) return;
  notice.textContent = stuck.length === 1
    ? `⚠ ${stuck[0].name}: ${stuck[0].sync.lastError.toLowerCase()} — open dashboard`
    : `⚠ ${stuck.length} project files aren't syncing — open dashboard`;
  notice.onclick = () => openDashboard('#projects');
}

async function editEntry(entry) {
  const result = await openEntryEditor(entry);
  if (!result) return;
  toast(result.action === 'deleted' ? 'Entry deleted' : 'Saved');
  await refresh();
  await flushSync();
}

async function resume(entry) {
  await Store.startTimer({ description: entry.description, projectId: entry.projectId, link: entry.link });
  descInput.value = entry.description || '';
  linkInput.value = entry.link || '';
  await refresh();
}

/**
 * What a new timer starts with: what you typed, or else the page's best
 * suggestion. Waits for the page (at most a moment) if it has not answered yet.
 */
async function newEntryFields() {
  if (!descInput.value.trim()) await pageLoaded;
  const description = descInput.value.trim();
  const projectId = picker.getValue();
  const link = linkInput.value;
  const auto = suggestions[0];
  if (description || !auto) return { description, projectId, link };
  return {
    description: auto.description,
    projectId: projectId ?? auto.projectId ?? null,
    link: link.trim() ? link : pageLink(),
  };
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
    descEdited = linkEdited = false;
    picker.setValue(null);
    // Write the project's file before this popup can be dismissed.
    await flushSync();
    await renderSyncNotice();
  } else {
    const start = Date.now(); // the click, not whenever the page answered
    await Store.startTimer({ start, ...(await newEntryFields()) });
    descEdited = linkEdited = false;
  }
  await refresh();
});

// Attached before the handlers below, so choosing a recent description with
// Enter does not also start or stop the timer.
attachSuggest(descInput, {
  source: (value) => descriptionRows(allEntries, projects, value),
  onPick: (row) => applySuggestion({ description: row.label, projectId: row.projectId }, { fromPage: false }),
});
descInput.addEventListener('input', () => {
  descEdited = true;
  toggleSuggestions();
  if (running) { mute(); Store.updateEntry(running.id, { description: descInput.value.trim() }); }
});
descInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') toggleBtn.click();
  else if (e.key === 'Tab' && !e.shiftKey && !descInput.value && !running && suggestions[0]) {
    // Take the suggestion into the box, to change it before starting.
    e.preventDefault();
    applySuggestion(suggestions[0]);
  }
  else if (e.key === 'ArrowDown' && !suggestionsEl.classList.contains('hidden')) {
    e.preventDefault();
    suggestionsEl.firstElementChild?.focus();
  }
});

linkInput.addEventListener('input', () => {
  linkEdited = true;
  // Only web addresses are kept; say so instead of dropping it silently on Stop.
  const bad = linkInput.value.trim() !== '' && !Store.safeLink(linkInput.value);
  linkInput.classList.toggle('invalid', bad);
  linkInput.title = bad ? 'Not a web address — it will not be saved' : '';
  if (running) { mute(); Store.updateEntry(running.id, { link: linkInput.value }); }
});
linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') toggleBtn.click(); });

$('#add-manual').addEventListener('click', async () => {
  const saved = await openEntryEditor(null);
  if (saved) { toast('Entry added'); await refresh(); await flushSync(); }
});
$('#open-dashboard').addEventListener('click', () => openDashboard());
$('#see-all').addEventListener('click', () => openDashboard('#entries'));

onDataChanged(() => { if (Date.now() >= mutedUntil) refresh(); });
refresh();
const pageLoaded = loadSuggestions().catch(() => {});
descInput.focus();
// Catch up on changes made while no extension page was open (e.g. the timer was
// stopped with the keyboard shortcut), then report anything that stayed stuck.
syncAll({ interactive: false }).then(renderSyncNotice);
