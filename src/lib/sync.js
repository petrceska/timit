/**
 * Per-project file sync.
 *
 * Each project can point at a CSV file on disk (typically inside the project's
 * own git repo). Whenever tracked time changes — a timer stops, an entry is
 * edited, imported or deleted — that file is rewritten so the repo carries its
 * own timesheet. Starting a timer changes nothing: running entries are never
 * written.
 *
 * Row identity is the entry id, written as the first column. That makes the
 * three-way question exact:
 *
 *   id in file + in local          -> UPDATE the row in place
 *   id in local, not in file       -> ADD
 *   id in file, not in local,
 *     but we wrote it last time    -> REMOVE (the entry was deleted or moved)
 *   id in file, not in local,
 *     and we never wrote it        -> FOREIGN: another machine put it there
 *                                     via git. Left completely untouched.
 *
 * Rows without an id (hand-written, or exported from another tool) are matched
 * by start/end/description; a match adopts the local id, anything else is kept
 * as a foreign row. Nothing is ever deleted just because we don't recognise it.
 *
 * The file is written sorted by start time with LF endings so git diffs stay
 * small and stable, and it is only written when the bytes actually change.
 */

import { Store } from './store.js';
import { parseCSV } from './csv.js';
import { getHandle, setHandle, deleteHandle, handlePermission } from './fsdb.js';

export const SYNC_COLUMNS = [
  'ID', 'Project', 'Client', 'Description', 'Tags', 'Billable',
  'Start Date', 'Start Time', 'End Date', 'End Time',
  'Duration (h)', 'Duration (decimal)',
];

const C = Object.fromEntries(SYNC_COLUMNS.map((name, i) => [name, i]));
const pad = (n) => String(n).padStart(2, '0');

/* ---------------------------------------------------------------- rows ---- */

const isoDate = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const isoTime = (d) => {
  const x = new Date(d);
  return `${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`;
};

function rowForEntry(entry, project) {
  const ms = entry.end - entry.start;
  const secs = Math.floor(ms / 1000);
  const cells = new Array(SYNC_COLUMNS.length).fill('');
  cells[C.ID] = entry.id;
  cells[C.Project] = project.name;
  cells[C.Client] = project.client || '';
  cells[C.Description] = entry.description || '';
  cells[C.Tags] = (entry.tags || []).join(', ');
  cells[C.Billable] = entry.billable ? 'Yes' : 'No';
  cells[C['Start Date']] = isoDate(entry.start);
  cells[C['Start Time']] = isoTime(entry.start);
  cells[C['End Date']] = isoDate(entry.end);
  cells[C['End Time']] = isoTime(entry.end);
  cells[C['Duration (h)']] =
    `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
  cells[C['Duration (decimal)']] = (ms / 3600000).toFixed(2);
  return cells;
}

/** Identity for id-less rows: when did it happen and what was it called. */
const contentKey = (cells) => [
  cells[C['Start Date']], cells[C['Start Time']],
  cells[C['End Date']], cells[C['End Time']],
  (cells[C.Description] || '').trim().toLowerCase(),
].join('|');

const sortKey = (cells) =>
  `${cells[C['Start Date']]}T${cells[C['Start Time']]}#${cells[C.ID] || ''}`;

const escapeCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function serialize(rows) {
  const sorted = rows.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return [SYNC_COLUMNS.join(','), ...sorted.map((r) => r.map(escapeCell).join(','))]
    .join('\n') + '\n';
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Reads an existing file into our column space. Unknown columns are dropped,
 * known ones are matched by name so a file written by an older version (or
 * lightly reordered by hand) still lines up.
 * @throws if the file has content but no recognisable header
 */
function parseExisting(text) {
  const table = parseCSV(text);
  if (!table.length) return [];
  const header = table[0];
  const map = SYNC_COLUMNS.map((name) => header.findIndex((h) => norm(h) === norm(name)));
  if (map[C['Start Date']] < 0) {
    throw new Error('the file exists but has no "Start Date" column');
  }
  return table.slice(1).map((row) => {
    const cells = new Array(SYNC_COLUMNS.length).fill('');
    map.forEach((src, i) => { if (src >= 0 && row[src] !== undefined) cells[i] = row[src].trim(); });
    return cells;
  });
}

/**
 * The whole decision procedure, kept pure so it can be tested without a disk.
 * @param {string} text        current file contents ('' when the file is new)
 * @param {Array} entries      completed local entries for this project
 * @param {object} project
 * @param {string[]} lastWritten ids this project wrote to this file last time
 * @returns {{text:string, rows, added, updated, removed, foreign, adopted, ids}}
 */
export function mergeRows(text, entries, project, lastWritten = []) {
  const existing = parseExisting(text);
  const mine = new Map(entries.map((e) => [e.id, rowForEntry(e, project)]));
  const written = new Set(lastWritten);
  const byContent = new Map();
  for (const [id, cells] of mine) {
    const k = contentKey(cells);
    if (!byContent.has(k)) byContent.set(k, id);
  }

  const out = [];
  const emitted = new Set();
  let added = 0, updated = 0, removed = 0, foreign = 0, adopted = 0;

  for (const row of existing) {
    const id = row[C.ID];

    if (!id) {
      // No id: is this the same entry we already track, written by someone else?
      const match = byContent.get(contentKey(row));
      if (match && !emitted.has(match)) {
        out.push(mine.get(match));
        emitted.add(match);
        adopted++;
      } else if (!match) {
        out.push(row);
        foreign++;
      }
      // A match we've already emitted is a duplicate line — drop it.
      continue;
    }

    if (mine.has(id)) {
      if (emitted.has(id)) continue; // duplicate id in the file: keep one
      const fresh = mine.get(id);
      if (fresh.join('') !== row.join('')) updated++;
      out.push(fresh);
      emitted.add(id);
    } else if (written.has(id)) {
      removed++; // we put it there, it's gone locally -> take it out
    } else {
      out.push(row); // someone else's row, arrived via git
      foreign++;
    }
  }

  for (const [id, cells] of mine) {
    if (emitted.has(id)) continue;
    out.push(cells);
    emitted.add(id);
    added++;
  }

  return {
    text: serialize(out),
    added, updated, removed, foreign, adopted,
    ids: [...emitted],
  };
}

/* ------------------------------------------------------------- engine ---- */

const listeners = new Set();
/** Subscribe to sync results: fn({projectId, status, ...counts}). */
export function onSyncEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (event) => listeners.forEach((fn) => fn(event));

const fingerprints = new Map();

function fingerprint(project, entries) {
  const parts = [project.name, project.client || ''];
  for (const e of entries.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    parts.push(e.id, e.start, e.end, e.description || '',
      (e.tags || []).join('|'), e.billable ? '1' : '0');
  }
  let h = 0x811c9dc5;
  const s = parts.join('');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const syncableEntries = (entries, projectId) =>
  entries.filter((e) => e.projectId === projectId && e.end !== null);

async function record(project, patch) {
  await Store.updateProject(project.id, { sync: { ...project.sync, ...patch } });
}

// One sync at a time per project: an auto-sync and a "Sync now" click must not
// interleave, or the second could write stale bookkeeping over the first.
const queues = new Map();

/**
 * Syncs one project's file.
 * @param {string} projectId
 * @param {object} opts interactive: allowed to show a permission prompt
 *                     (only true when called straight from a click)
 */
export function syncProject(projectId, opts = {}) {
  const previous = queues.get(projectId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => runSync(projectId, opts));
  queues.set(projectId, next);
  return next;
}

async function runSync(projectId, { interactive = false } = {}) {
  const project = (await Store.getProjects()).find((p) => p.id === projectId);
  if (!project?.sync?.enabled) return { projectId, status: 'off' };

  const finish = async (result, patch = {}) => {
    await record(project, { lastStatus: result.status, ...patch });
    emit(result);
    return result;
  };

  const handle = await getHandle(projectId);
  if (!handle) {
    return finish({
      projectId, status: 'disconnected',
      message: 'The file link was lost — choose the file again.',
    }, { lastError: 'File link lost' });
  }

  const permission = await handlePermission(handle, { request: interactive });
  if (permission !== 'granted') {
    return finish({
      projectId, status: 'needs-permission',
      message: 'Brave needs your OK to write this file again.',
    }, { lastError: 'Permission needed' });
  }

  try {
    let text = '';
    try {
      text = await (await handle.getFile()).text();
    } catch (err) {
      if (err.name !== 'NotFoundError') throw err;
      text = ''; // file was deleted or hasn't been created yet — write it fresh
    }

    const entries = syncableEntries(await Store.getEntries(), projectId);
    const merged = mergeRows(text, entries, project, project.sync.syncedIds || []);
    const changed = merged.text !== text;

    if (changed) {
      const writable = await handle.createWritable();
      await writable.write(merged.text);
      await writable.close();
    }

    fingerprints.set(projectId, fingerprint(project, entries));
    return finish({
      projectId,
      status: changed ? 'written' : 'unchanged',
      added: merged.added,
      updated: merged.updated,
      removed: merged.removed,
      foreign: merged.foreign,
      adopted: merged.adopted,
      rows: merged.ids.length,
    }, {
      syncedIds: merged.ids,
      lastSyncedAt: Date.now(),
      lastError: null,
      foreignRows: merged.foreign,
    });
  } catch (err) {
    return finish({
      projectId, status: 'error', message: err.message,
    }, { lastError: err.message });
  }
}

/**
 * Syncs every project that has a file configured.
 * Skips projects whose tracked data hasn't changed since this page last synced
 * them, so an ordinary edit doesn't touch unrelated files.
 */
export async function syncAll({ force = false, interactive = false } = {}) {
  const projects = (await Store.getProjects()).filter((p) => p.sync?.enabled);
  if (!projects.length) return [];
  const entries = await Store.getEntries();
  const results = [];
  for (const p of projects) {
    const fp = fingerprint(p, syncableEntries(entries, p.id));
    if (!force && fingerprints.get(p.id) === fp) continue;
    results.push(await syncProject(p.id, { interactive }));
  }
  return results;
}

let timer = null;
let pending = null;

/** Debounced auto-sync. Safe to call on every data change. */
export function scheduleSync({ delay = 1200 } = {}) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    pending = syncAll({ interactive: false }).finally(() => { pending = null; });
  }, delay);
}

/** Runs any pending sync right now — call before a page that might close. */
export async function flushSync() {
  if (timer) { clearTimeout(timer); timer = null; }
  pending = syncAll({ interactive: false });
  await pending;
  pending = null;
}

/* --------------------------------------------------------- connecting ---- */

const slug = (name) => (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project');

/**
 * Asks for a file and links it to the project. Must be called from a click.
 * @param {object} project
 * @param {'create'|'existing'} mode  'create' names a new file (and can pick an
 *        existing one), 'existing' opens a file that is already in the repo.
 * @returns {Promise<boolean>} false if the user cancelled
 */
export async function connectProjectFile(project, { mode = 'create', fileName = '' } = {}) {
  const types = [{ description: 'CSV timesheet', accept: { 'text/csv': ['.csv'] } }];
  let suggestedName = fileName.trim().replace(/[/\\]/g, '-') || `${slug(project.name)}-time.csv`;
  if (!/\.csv$/i.test(suggestedName)) suggestedName += '.csv';
  // Called synchronously from a click: browsers only open this while the user
  // gesture that requested it is still live.
  const handle = mode === 'existing'
    ? (await window.showOpenFilePicker({ id: 'timit-sync', multiple: false, types }))[0]
    : await window.showSaveFilePicker({ id: 'timit-sync', suggestedName, types });
  if (await handlePermission(handle, { request: true }) !== 'granted') return false;

  await setHandle(project.id, handle);
  await Store.updateProject(project.id, {
    sync: {
      ...(project.sync || {}),
      enabled: true,
      fileName: handle.name,
      // A fresh link must not assume it wrote anything: rows already in the file
      // are treated as foreign until they're matched by content or by id.
      syncedIds: project.sync?.fileName === handle.name ? (project.sync.syncedIds || []) : [],
      connectedAt: Date.now(),
      lastError: null,
    },
  });
  fingerprints.delete(project.id);
  return true;
}

/** Unlinks the file. The file itself is left exactly as it is. */
export async function disconnectProjectFile(project) {
  await deleteHandle(project.id);
  await Store.updateProject(project.id, { sync: null });
  fingerprints.delete(project.id);
}

/** Human-readable one-liner for a sync result. */
export function describeResult(r) {
  if (!r) return '';
  switch (r.status) {
    case 'written': {
      const bits = [];
      if (r.added) bits.push(`${r.added} added`);
      if (r.updated) bits.push(`${r.updated} updated`);
      if (r.removed) bits.push(`${r.removed} removed`);
      if (r.adopted) bits.push(`${r.adopted} matched`);
      return `Synced — ${bits.join(', ') || 'rewritten'}` +
        (r.foreign ? ` (${r.foreign} row${r.foreign === 1 ? '' : 's'} from elsewhere kept)` : '');
    }
    case 'unchanged': return 'Already up to date';
    case 'needs-permission': return 'Needs permission';
    case 'disconnected': return 'File link lost';
    case 'error': return `Sync failed: ${r.message}`;
    default: return '';
  }
}
