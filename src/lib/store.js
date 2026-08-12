/**
 * Storage layer. Everything lives in chrome.storage.local — no network, ever.
 *
 * Shapes:
 *   project = { id, name, color, client, archived, createdAt }
 *   entry   = { id, projectId|null, description, start, end|null, tags[], billable }
 *             start/end are epoch milliseconds. end === null means "running".
 *   settings= { csvDateFormat, weekStart, userName, userEmail }
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
};

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
  async getProjects() {
    const list = await read(K.projects, []);
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
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
      color: color || PALETTE[projects.length % PALETTE.length],
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
  async importBackup(data, { replace = false } = {}) {
    if (!data || data.format !== 'timit-backup') throw new Error('Not a TimIt backup file');
    if (replace) {
      await write(K.projects, data.projects || []);
      await write(K.entries, data.entries || []);
    } else {
      const projects = await read(K.projects, []);
      const entries = await read(K.entries, []);
      const known = new Set(projects.map((p) => p.id));
      const knownE = new Set(entries.map((e) => e.id));
      for (const p of data.projects || []) if (!known.has(p.id)) projects.push(p);
      for (const e of data.entries || []) if (!knownE.has(e.id)) entries.push(e);
      await write(K.projects, projects);
      await write(K.entries, entries);
    }
    if (data.settings) await this.saveSettings(data.settings);
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
