/**
 * Service worker: keeps the toolbar badge in sync with the running timer and
 * handles the keyboard shortcut. No network access anywhere in this extension.
 */
import { Store, onDataChanged } from './lib/store.js';
import { readActiveTab, suggestTasks } from './lib/context.js';

const ALARM = 'timit-tick';
const RUNNING_COLOR = '#2ec4a6';
const LAST_ALIVE = 'lastAlive'; // when the browser was last seen open with a timer running
const SESSION_FLAG = 'timit-session';

function badgeText(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return h < 10 ? `${h}:${String(mins % 60).padStart(2, '0')}` : `${h}h`;
}

/**
 * Chrome has no "browser is closing" event. Instead, while a timer runs we note
 * the time every 30 seconds. chrome.storage.session is emptied when the browser
 * closes, so a missing flag there means a new browser session: a timer that is
 * still running was left over, and it ends at the last noted time.
 */
async function saveLeftoverTimer() {
  if ((await chrome.storage.session.get(SESSION_FLAG))[SESSION_FLAG]) return;
  await chrome.storage.session.set({ [SESSION_FLAG]: true });
  const running = await Store.getRunning();
  const lastAlive = (await chrome.storage.local.get(LAST_ALIVE))[LAST_ALIVE];
  if (running && typeof lastAlive === 'number' && lastAlive > running.start) {
    await Store.stopTimer(Math.min(lastAlive, Date.now()));
  }
}
// Every event waits for this, so the time is never noted before the check.
const ready = saveLeftoverTimer().catch((err) => console.error('TimIt:', err));

async function refreshBadge() {
  await ready;
  const running = await Store.getRunning();
  if (running) {
    await chrome.storage.local.set({ [LAST_ALIVE]: Date.now() });
    await chrome.action.setBadgeBackgroundColor({ color: RUNNING_COLOR });
    await chrome.action.setBadgeText({ text: badgeText(Date.now() - running.start) });
    await chrome.action.setTitle({
      title: `TimIt — running: ${running.description || 'No description'}`,
    });
    await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  } else {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'TimIt — click to start tracking' });
    await chrome.alarms.clear(ALARM);
  }
}

/** The shortcut grants the tab it was pressed on; start on what that tab is about. */
async function taskFromActiveTab() {
  if (!(await Store.getSettings()).pageSuggestions) return {};
  const page = await readActiveTab();
  if (!page) return {};
  const [top] = suggestTasks(page, {
    projects: await Store.getProjects(),
    entries: await Store.getEntries(),
  });
  return top ? { description: top.description, projectId: top.projectId, link: Store.safeLink(page.url) } : {};
}

chrome.runtime.onStartup.addListener(refreshBadge);
chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) refreshBadge(); });
onDataChanged(refreshBadge);

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-timer') return;
  await ready;
  const running = await Store.getRunning();
  if (running) await Store.stopTimer();
  else {
    const start = Date.now(); // the key press, not whenever the page answered
    await Store.startTimer({ start, ...(await taskFromActiveTab()) });
  }
  await refreshBadge();
});

// Cheap health check used by the dashboard's "Danger zone" reset.
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type === 'refresh-badge') { refreshBadge().then(() => respond({ ok: true })); return true; }
});

refreshBadge();
