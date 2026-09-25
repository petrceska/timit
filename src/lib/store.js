/**
 * Storage layer. Everything lives in chrome.storage.local — no network, ever.
 *
 * Shapes:
 *   project = { id, name, color, client, archived, createdAt }
 *   entry   = { id, projectId|null, description, start, end|null, tags[], billable }
 *             start/end are epoch milliseconds. end === null means "running".
 *   settings= { csvDateFormat, weekStart, userName, userEmail, pageSuggestions }
 */

const K = { projects: 'projects', entries: 'entries', settings: 'settings' };

export const PALETTE = [
  '#4f8ef7', '#2ec4a6', '#f2a03d', '#ef5d8f', '#9b7cf7',
  '#39b6e8', '#7bc043', '#f26d5b', '#c08cf7', '#e8b93b',
];

export const DEFAULT_SETTINGS = {
  csvDateFormat: 'clockify', // 'clockify' (MM/DD/YYYY) | 'iso' (YYYY-MM-DD)
  weekStart: 1, // 0 = Sunday, 1 = Monday
  userName: '',
  userEmail: '',
  pageSuggestions: true, // suggest tasks from the current tab (popup + shortcut)
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Colours end up in inline styles, so only real hex values are allowed through.
 * Anything else (from a hand-edited or hostile backup file) falls back to the
 * palette instead of being handed to the DOM.
 */
export function safeColor(value, fallback = PALETTE[0]) {
  return typeof value === 'string' && HEX_COLOR.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

// Only primitives are converted. String(someObject) can throw (a crafted
// backup with {"toString": 1} does exactly that), so objects become ''/null
// rather than being coerced.
const str = (v) => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Rebuilds a project from untrusted input, field by field. */
function cleanProject(raw, i = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name).trim();
  if (!name) return null;
  return {
    id: str(raw.id) || uid(),
    name,
    color: safeColor(raw.color, PALETTE[i % PALETTE.length]),
    client: str(raw.client),
    archived: !!raw.archived,
    createdAt: num(raw.createdAt) ?? Date.now(),
  };
}

/** Rebuilds an entry from untrusted input; returns null if it can't be trusted. */
function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const start = num(raw.start);
  if (start === null) return null;
  const end = raw.end === null || raw.end === undefined ? null : num(raw.end);
  if (end !== null && end < start) return null;
  return {
    id: str(raw.id) || uid(),
    projectId: raw.projectId == null ? null : str(raw.projectId),
    description: str(raw.description),
    start,
    end,
    tags: Array.isArray(raw.tags) ? raw.tags.map(str).filter(Boolean) : [],
    billable: !!raw.billable,
  };
}

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function read(key, fallback) {
  const got = await chrome.storage.local.get(key);
  return got[key] === undefined ? fallback : got[key];
}

async function write(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export const Store = {
  uid,

  /* ---------- settings ---------- */
  async getSettings() {
    return { ...DEFAULT_SETTINGS, ...(await read(K.settings, {})) };
  },
  async saveSettings(patch) {
    const next = { ...(await this.getSettings()), ...patch };
    await write(K.settings, next);
    return next;
  },

  /* ---------- projects ---------- */
  safeColor,

  async getProjects() {
    const list = await read(K.projects, []);
    // Neutralise anything unsafe that an older import may have stored.
    return list
      .map((p) => ({ ...p, color: safeColor(p.color) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async getProjectMap() {
    const map = new Map();
    for (const p of await this.getProjects()) map.set(p.id, p);
    return map;
  },
  async addProject({ name, color, client = '' }) {
    const projects = await read(K.projects, []);
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Project name is required');
    const dupe = projects.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (dupe) return dupe;
    const project = {
      id: uid(),
      name: trimmed,
      color: safeColor(color, PALETTE[projects.length % PALETTE.length]),
      client,
      archived: false,
      createdAt: Date.now(),
    };
    projects.push(project);
    await write(K.projects, projects);
    return project;
  },
  async updateProject(id, patch) {
    const projects = await read(K.projects, []);
    const i = projects.findIndex((p) => p.id === id);
    if (i < 0) return null;
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw new Error('Project name is required');
      const clash = projects.find(
        (p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase());
      if (clash) throw new Error(`A project named "${name}" already exists`);
      patch = { ...patch, name };
    }
    if (patch.color !== undefined) patch = { ...patch, color: safeColor(patch.color) };
    projects[i] = { ...projects[i], ...patch };
    await write(K.projects, projects);
    return projects[i];
  },
  /** Deletes a project. Entries are moved to `reassignTo` (null = "no project"). */
  async deleteProject(id, { reassignTo = null } = {}) {
    const projects = (await read(K.projects, [])).filter((p) => p.id !== id);
    await write(K.projects, projects);
    const entries = await read(K.entries, []);
    let touched = false;
    for (const e of entries) {
      if (e.projectId === id) { e.projectId = reassignTo; touched = true; }
    }
    if (touched) await write(K.entries, entries);
  },

  /* ---------- entries ---------- */
  async getEntries() {
    const list = await read(K.entries, []);
    return list.slice().sort((a, b) => b.start - a.start);
  },
  async addEntry(entry) {
    const entries = await read(K.entries, []);
    const full = {
      id: uid(),
      projectId: entry.projectId ?? null,
      description: entry.description ?? '',
      start: entry.start,
      end: entry.end ?? null,
      tags: entry.tags ?? [],
      billable: entry.billable ?? false,
    };
    entries.push(full);
    await write(K.entries, entries);
    return full;
  },
  async addEntries(list) {
    const entries = await read(K.entries, []);
    const created = list.map((entry) => ({
      id: uid(),
      projectId: entry.projectId ?? null,
      description: entry.description ?? '',
      start: entry.start,
      end: entry.end ?? null,
      tags: entry.tags ?? [],
      billable: entry.billable ?? false,
    }));
    entries.push(...created);
    await write(K.entries, entries);
    return created;
  },
  async updateEntry(id, patch) {
    const entries = await read(K.entries, []);
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return null;
    entries[i] = { ...entries[i], ...patch };
    await write(K.entries, entries);
    return entries[i];
  },
  async deleteEntry(id) {
    const entries = (await read(K.entries, [])).filter((e) => e.id !== id);
    await write(K.entries, entries);
  },
  async deleteEntries(ids) {
    const drop = new Set(ids);
    const entries = (await read(K.entries, [])).filter((e) => !drop.has(e.id));
    await write(K.entries, entries);
  },

  /* ---------- timer ---------- */
  async getRunning() {
    const entries = await read(K.entries, []);
    return entries.find((e) => e.end === null) || null;
  },
  /** Starts a new entry, stopping whatever was running. */
  async startTimer({ description = '', projectId = null, start = Date.now() } = {}) {
    await this.stopTimer();
    return this.addEntry({ description, projectId, start, end: null });
  },
  async stopTimer(at = Date.now()) {
    const running = await this.getRunning();
    if (!running) return null;
    // A sub-second entry is almost certainly a mis-click — drop it.
    if (at - running.start < 1000) {
      await this.deleteEntry(running.id);
      return null;
    }
    return this.updateEntry(running.id, { end: at });
  },

  /* ---------- bulk ---------- */
  async exportBackup() {
    return {
      format: 'timit-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: await read(K.projects, []),
      entries: await read(K.entries, []),
      settings: await this.getSettings(),
    };
  },
  /**
   * Restores a backup. The file is untrusted input: every record is rebuilt
   * field by field (see cleanProject/cleanEntry) so nothing unexpected — a
   * colour carrying markup, a "__proto__" key, a string where a timestamp
   * belongs — is ever written back to storage.
   */
  async importBackup(data, { replace = false } = {}) {
    if (!data || data.format !== 'timit-backup') throw new Error('Not a TimIt backup file');
    const incomingProjects = (Array.isArray(data.projects) ? data.projects : [])
      .map(cleanProject).filter(Boolean);
    const incomingEntries = (Array.isArray(data.entries) ? data.entries : [])
      .map(cleanEntry).filter(Boolean);
    // Entries may only point at projects that actually exist after the import.
    const keepIds = new Set(incomingProjects.map((p) => p.id));

    if (replace) {
      for (const e of incomingEntries) if (!keepIds.has(e.projectId)) e.projectId = null;
      await write(K.projects, incomingProjects);
      await write(K.entries, incomingEntries);
    } else {
      const projects = await read(K.projects, []);
      const entries = await read(K.entries, []);
      const known = new Set(projects.map((p) => p.id));
      const knownE = new Set(entries.map((e) => e.id));
      for (const p of incomingProjects) if (!known.has(p.id)) { projects.push(p); known.add(p.id); }
      for (const e of incomingEntries) {
        if (knownE.has(e.id)) continue;
        if (e.projectId && !known.has(e.projectId)) e.projectId = null;
        entries.push(e);
        knownE.add(e.id);
      }
      await write(K.projects, projects);
      await write(K.entries, entries);
    }

    if (data.settings && typeof data.settings === 'object') {
      // Only known settings keys, with values coerced to the expected shape.
      const s = data.settings;
      await this.saveSettings({
        csvDateFormat: s.csvDateFormat === 'iso' ? 'iso' : 'clockify',
        weekStart: s.weekStart === 0 ? 0 : 1,
        userName: str(s.userName).slice(0, 200),
        userEmail: str(s.userEmail).slice(0, 200),
        pageSuggestions: s.pageSuggestions !== false,
      });
    }
  },
  async wipe() {
    await chrome.storage.local.remove([K.projects, K.entries]);
  },
};

/** Calls `fn` whenever projects/entries/settings change in any extension page. */
export function onDataChanged(fn) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[K.projects] || changes[K.entries] || changes[K.settings]) fn(changes);
  });
}
