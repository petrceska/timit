/**
 * Page context: what you're probably working on, read from the tab in front of
 * you — an issue or pull request, a ticket key, a branch, a file open in a web
 * editor, or failing those the page's own title and heading.
 *
 * Access. There are still no host permissions. `activeTab` grants the current
 * tab only at the moment you click the toolbar icon or press the shortcut, and
 * `scripting` runs `readPage` there once, in Chrome's isolated world, so the
 * page's own scripts can neither see it nor tamper with the DOM methods it uses.
 * Nothing runs on pages you merely browse, and nothing about them is stored.
 *
 * Trust. Everything a page returns is text the page controls: `sanitizePage`
 * clips it and strips control and bidi characters, the popup only ever shows it
 * through textContent, and a suggestion can only point at a project that already
 * exists — nothing on a page can name or create one.
 */

const FIELD_LIMIT = 300;
const URL_LIMIT = 2000;
export const DESCRIPTION_LIMIT = 140;
export const MAX_SUGGESTIONS = 3;

/* ---------- reading the tab ---------- */

/**
 * Runs inside the page. chrome.scripting serialises the function's source, so it
 * must stay self-contained: no imports and nothing from module scope.
 */
export function readPage(limit = 300, urlLimit = 2000) {
  const clip = (value, max = limit) =>
    (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const meta = (selector) => clip(document.querySelector(selector)?.getAttribute('content'));
  const firstVisible = (selector) => {
    for (const node of document.querySelectorAll(selector)) {
      if (node.getClientRects().length && node.textContent.trim()) return clip(node.textContent);
    }
    return '';
  };
  let selection = '';
  try { selection = clip(String(window.getSelection() || '')); } catch { /* some viewers throw */ }
  return {
    url: clip(location.href, urlLimit),
    title: clip(document.title),
    heading: firstVisible('h1'),
    ogTitle: meta('meta[property="og:title"]'),
    siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'),
    // GitHub's pull request header: "… wants to merge into main from owner:branch"
    branch: firstVisible('.head-ref'),
    selection,
  };
}

/**
 * Reads the active tab. Resolves null whenever it can't be read — chrome:// and
 * brave:// pages, the web store, the PDF viewer, or no activeTab grant.
 */
export async function readActiveTab({ timeoutMs = 1500 } = {}) {
  if (!globalThis.chrome?.scripting || !chrome.tabs) return null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id == null) return null;
    const injection = chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPage,
      args: [FIELD_LIMIT, URL_LIMIT],
    });
    // A page busy with its own scripts mustn't hold up the popup or the shortcut.
    const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs, null));
    const results = await Promise.race([injection, timeout]);
    return results?.[0]?.result ?? null;
  } catch {
    return null;
  }
}

/* ---------- untrusted text ---------- */

// C0/C1 controls, zero-width marks, line separators and bidi overrides: nothing a
// task description needs, and the bidi ones can make text read as something else.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
const PAGE_FIELDS = ['url', 'title', 'heading', 'ogTitle', 'siteName', 'branch', 'selection'];

const cut = (s, max) => (s.length <= max ? s : [...s].slice(0, max).join(''));
const clean = (value, max = FIELD_LIMIT) => (typeof value === 'string'
  ? cut(value.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim(), max)
  : '');

/** Rebuilds what a page sent back, known fields only, as bounded plain text. */
function sanitizePage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const page = {};
  for (const field of PAGE_FIELDS) {
    page[field] = clean(raw[field], field === 'url' ? URL_LIMIT : FIELD_LIMIT);
  }
  return page;
}

const shorten = (s) => {
  const chars = [...s];
  return chars.length <= DESCRIPTION_LIMIT
    ? s
    : `${chars.slice(0, DESCRIPTION_LIMIT - 1).join('').trimEnd()}…`;
};
/** Case, accents and punctuation don't make two names different. */
const norm = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const humanize = (slug) => {
  const words = slug.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function parseUrl(href) {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/* ---------- tickets and branches ---------- */

const TICKET = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g;
const TICKET_EXACT = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/;
// Shaped like ticket keys, but aren't.
const NOT_A_TICKET = /^(?:UTF|ISO|RFC|SHA|MD|CVE|COVID|GPT|IPV|TLS|SSL|HTTP|ES|ECMA|WCAG|PEP|MP|AES|RSA|USB|HDMI)$/;

function ticketKeys(...texts) {
  const keys = [];
  for (const text of texts) {
    for (const m of text.matchAll(TICKET)) {
      const key = `${m[1]}-${m[2]}`;
      if (!NOT_A_TICKET.test(m[1]) && !keys.includes(key)) keys.push(key);
    }
  }
  return keys.slice(0, 5);
}

const MAIN_BRANCHES = /^(?:main|master|develop|development|dev|trunk|staging|production|gh-pages|HEAD)$/i;
const BRANCH_KINDS = /^(?:feature|feat|fix|bugfix|hotfix|chore|refactor|docs|test|task|story|bug|spike|wip|release)$/i;

/**
 * "feature/PAY-12-retry-refunds" → "PAY-12 Retry refunds",
 * "jan/eng-7-flaky-test" → "ENG-7 Flaky test", "42-dark-mode" → "timit#42 Dark mode".
 * Returns null for branches that say nothing about the task (main, a commit sha).
 */
export function describeBranch(branch, repo = '') {
  const name = clean(branch).replace(/^[\w.-]+:/, ''); // "owner:branch" from a fork
  if (!name || MAIN_BRANCHES.test(name) || /^(?=.*\d)[0-9a-f]{7,40}$/i.test(name)) return null;
  let rest = name.split('/').filter(Boolean).at(-1) || '';
  let key = null;
  let ref = null;
  // Upper-case keys can sit anywhere; lower-case ones (Linear, GitLab) only lead
  // the last segment, where "eng-7-…" can't be an ordinary word.
  const hit = name.match(/\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/) ||
    rest.match(/^([a-z][a-z0-9]{1,9})-(\d{1,7})(?=[-_]|$)/);
  if (hit && !NOT_A_TICKET.test(hit[1].toUpperCase())) {
    key = ref = `${hit[1].toUpperCase()}-${hit[2]}`;
    rest = rest.replace(hit[0], '');
  } else {
    const issue = rest.match(/^(\d{1,7})(?:[-_]|$)/); // GitHub's "Create a branch" from an issue
    if (issue) {
      ref = `${repo}#${issue[1]}`;
      rest = rest.slice(issue[0].length);
    }
  }
  let words = humanize(rest);
  if (BRANCH_KINDS.test(words)) words = '';
  const description = [ref, words].filter(Boolean).join(' ');
  return description ? { description, key, ref } : null;
}

/* ---------- page titles ---------- */

const APP_NAMES = /^(?:google (?:docs|sheets|slides|drive)|microsoft (?:word|excel|powerpoint)|word|excel|powerpoint|notion|confluence|jira|linear|trello|asana|figma|miro|clickup|airtable|coda|slack|stack overflow|youtube|github|gitlab|bitbucket|sharepoint|outlook|gmail)$/i;

/** The part of a page title that names the page rather than the site. */
function cleanTitle(page, url) {
  const raw = (page.title || page.ogTitle).replace(/^\(\d+\+?\)\s*/, ''); // "(3) Inbox"
  const labels = url ? url.hostname.split('.') : [];
  const site = norm(page.siteName);
  const isSiteName = (s) => {
    const n = norm(s);
    return !n || APP_NAMES.test(s) || n === site || labels.includes(n) || n === norm(url?.hostname);
  };
  const parts = raw.split(/\s+[|·•—–-]\s+|\s+::\s+/).map((s) => s.trim()).filter((s) => !isSiteName(s));
  if (!parts.length) return '';
  // "javascript - How do I debounce? - Stack Overflow": the heading says which part.
  const heading = norm(page.heading);
  const echoed = heading && parts.find((s) => {
    const n = norm(s);
    return n === heading ||
      (heading.includes(n) && n.length * 2 >= heading.length) ||
      (heading.length >= 6 && n.includes(heading));
  });
  return echoed || parts[0];
}

/* ---------- sites ---------- */
// Each recognizer returns true when it understood the page, which skips the
// generic title/heading fallback. It may fill `hints` either way.

const GITHUB_RESERVED = new Set([
  'about', 'apps', 'codespaces', 'collections', 'dashboard', 'enterprise', 'explore', 'features',
  'issues', 'login', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing',
  'pulls', 'search', 'settings', 'sponsors', 'stars', 'topics', 'trending',
]);

function github({ page, url, parts, hints, tasks, add, branch }) {
  if (url.hostname !== 'github.com') return false;
  const [owner, repo, kind, ...rest] = parts;
  if (!owner || !repo || GITHUB_RESERVED.has(owner)) return false;
  Object.assign(hints, { owner, repo });
  const before = tasks.length;
  const number = /^\d+$/.test(rest[0] || '') ? rest[0] : null;

  if (kind === 'issues' && number) {
    // "Add dark mode · Issue #42 · owner/repo · GitHub"
    const name = page.title.match(/^(.*) · Issue #\d+ · /)?.[1] ?? page.heading.replace(/\s*#\d+$/, '');
    add('Issue', `${repo}#${number} ${name}`, { ref: `${repo}#${number}` });
  } else if (kind === 'pull' && number) {
    // "Fix login by octocat · Pull Request #12 · owner/repo · GitHub"
    const name = page.title.match(/^(.*) by [\w-]+(?:\[bot\])? · Pull Request #\d+ · /)?.[1] ??
      page.title.match(/^(.*) · Pull Request #\d+ · /)?.[1] ??
      page.heading.replace(/\s*#\d+$/, '');
    add('Pull request', `${repo}#${number} ${name}`, { ref: `${repo}#${number}` });
    branch(page.branch);
  } else if (kind === 'blob' || kind === 'tree' || kind === 'edit') {
    // The URL can't tell "feature/x/src" apart; the title can: "… at feature/x · owner/repo".
    const [, fromTitle] = page.title.match(/ at ([^\s·]+)(?: · |$)/) || [];
    if (kind !== 'tree' && rest.length > 1) add('File', `${rest.at(-1)} (${repo})`);
    branch(fromTitle || rest[0]);
  } else if (kind === 'compare' && rest.length) {
    branch(rest.join('/').split('...').at(-1));
  }
  if (tasks.length === before) add('Repository', repo);
  return true;
}

function gitlab({ page, url, parts, hints, add, branch }) {
  if (!/(?:^|\.)gitlab\./.test(url.hostname) && norm(page.siteName) !== 'gitlab') return false;
  const dash = parts.indexOf('-'); // group/sub/project/-/issues/42
  if (dash < 2) return false;
  const repo = parts[dash - 1];
  Object.assign(hints, { owner: parts[0], repo });
  const [kind, ...rest] = parts.slice(dash + 1);
  const number = /^\d+$/.test(rest[0] || '') ? rest[0] : null;

  if ((kind === 'issues' || kind === 'work_items') && number) {
    const name = page.title.match(/^(.*) \(#\d+\) · /)?.[1] ?? page.heading;
    add('Issue', `${repo}#${number} ${name}`, { ref: `${repo}#${number}` });
  } else if (kind === 'merge_requests' && number) {
    const name = page.title.match(/^(.*) \(!\d+\) · /)?.[1] ?? page.heading;
    add('Merge request', `${repo}!${number} ${name}`, { ref: `${repo}!${number}` });
  } else if ((kind === 'blob' || kind === 'tree') && rest.length) {
    // "cart.rb · fix/SHOP-31-vat · acme / shop · GitLab": the segment the path starts with.
    const path = rest.join('/');
    const ref = page.title.split(' · ').find((s) => path === s || path.startsWith(`${s}/`));
    if (kind === 'blob' && rest.length > 1) add('File', `${rest.at(-1)} (${repo})`);
    branch(ref || rest[0]);
  } else {
    add('Repository', repo);
  }
  return true;
}

function bitbucket({ page, url, parts, hints, add, branch }) {
  if (url.hostname !== 'bitbucket.org') return false;
  const [owner, repo, kind, id] = parts;
  if (!owner || !repo) return false;
  Object.assign(hints, { owner, repo });
  if (kind === 'pull-requests' && /^\d+$/.test(id || '')) {
    add('Pull request', `${repo}#${id} ${page.heading}`, { ref: `${repo}#${id}` });
  } else if (kind === 'branch' && parts.length > 3) {
    branch(parts.slice(3).join('/'));
  } else {
    add('Repository', repo);
  }
  return true;
}

function azureDevOps({ page, url, parts, hints, add }) {
  let segments = parts;
  if (url.hostname === 'dev.azure.com') {
    hints.owner = parts[0];
    segments = parts.slice(1);
  } else if (url.hostname.endsWith('.visualstudio.com')) {
    hints.owner = url.hostname.split('.')[0];
  } else {
    return false;
  }
  hints.repo = segments[0] || '';
  // "Bug 1234: VAT rounding - Boards", "Pull request 45: Fix login - Repos"
  const summary = page.title.match(/\b\d+:\s*(.+?)(?:\s+-\s+[^-]+)?$/)?.[1] ?? page.heading;
  const edit = segments.indexOf('edit');
  if (segments.includes('_workitems') && /^\d+$/.test(segments[edit + 1] || '')) {
    const id = segments[edit + 1];
    add('Work item', `#${id} ${summary}`, { ref: `#${id}` });
    return true;
  }
  const git = segments.indexOf('_git');
  if (git >= 0 && segments[git + 2] === 'pullrequest' && /^\d+$/.test(segments[git + 3] || '')) {
    hints.repo = segments[git + 1];
    const ref = `${hints.repo}!${segments[git + 3]}`;
    add('Pull request', `${ref} ${summary}`, { ref });
    return true;
  }
  return false;
}

function linear({ page, url, parts, hints, add }) {
  if (url.hostname !== 'linear.app') return false;
  const at = parts.indexOf('issue'); // team/issue/ENG-88/flaky-login-test
  const key = parts[at + 1];
  if (at < 0 || !TICKET_EXACT.test(key || '')) return false;
  hints.owner = parts[0];
  const summary = page.title
    .replace(/\s*[|·–—-]\s*Linear\s*$/i, '')
    .replace(key, '')
    .replace(/^[\s:|·–—-]+|[\s:|·–—-]+$/g, '') || humanize(parts[at + 2] || '');
  add('Issue', `${key} ${summary}`, { key });
  return true;
}

function jira({ page, url, add }) {
  const fromPath = url.pathname.match(/\/browse\/([A-Z][A-Z0-9]{1,9}-\d{1,7})(?:\/|$)/)?.[1];
  const selected = /atlassian\.net$|jira/i.test(url.hostname) ? url.searchParams.get('selectedIssue') : null;
  const key = fromPath || (TICKET_EXACT.test(selected || '') ? selected : null);
  if (!key) return false;
  let summary = '';
  // "[PAY-311] Refund fails for split payments - Jira"
  if (page.title.startsWith(`[${key}]`)) {
    summary = page.title.slice(key.length + 2).replace(/\s+-\s+[^-]*Jira[^-]*$/i, '');
  } else if (fromPath) {
    summary = page.heading; // on a board with ?selectedIssue= the heading is the board's
  }
  add('Ticket', `${key} ${summary}`, { key });
  return true;
}

function webEditor({ page, url, parts, hints, add }) {
  const host = url.hostname;
  const known = host === 'vscode.dev' || host === 'github.dev' ||
    host.endsWith('.github.dev') || host.endsWith('.gitpod.io');
  if (!known) return false;
  if (host === 'github.dev' && parts.length >= 2) Object.assign(hints, { owner: parts[0], repo: parts[1] });
  // "● store.js — timit [Codespaces] — Visual Studio Code"
  const [first = '', second = ''] = page.title
    .replace(/^[●•]\s*/, '')
    .split(/\s+[—–-]\s+/)
    .map((s) => s.replace(/\s*\[[^\]]*\]$/, '').trim())
    .filter((s) => s && !/^(?:visual studio code|vs code|code - oss|gitpod)$/i.test(s));
  const isFile = /\.\w+$/.test(first);
  const workspace = second || (isFile ? '' : first);
  if (workspace) hints.repo ||= workspace;
  if (isFile) add('File', workspace ? `${first} (${workspace})` : first);
  else if (workspace) add('Workspace', workspace);
  return true;
}

const RECOGNIZERS = [github, gitlab, bitbucket, azureDevOps, linear, webEditor, jira];

// Host labels that name a platform rather than a customer or team.
const PLATFORM_LABELS = new Set([
  'www', 'app', 'apps', 'dev', 'docs', 'github', 'gitlab', 'bitbucket', 'atlassian', 'jira',
  'linear', 'azure', 'visualstudio', 'google', 'notion', 'trello', 'figma', 'slack', 'co',
]);

/** Candidate tasks for a sanitised page, plus hints for choosing a project. */
function analyzePage(page) {
  const url = parseUrl(page.url);
  const tasks = [];
  const hints = {
    repo: '',
    owner: '',
    keys: ticketKeys(page.title, page.url, page.branch, page.heading),
    hosts: url ? url.hostname.split('.').slice(0, -1).filter((l) => l.length > 1 && !PLATFORM_LABELS.has(l)) : [],
  };
  const add = (source, description, extra = {}) => {
    const text = shorten(clean(description, 1000));
    if (norm(text).length >= 2) tasks.push({ source, description: text, ...extra });
  };
  const branch = (name) => {
    const found = describeBranch(name, hints.repo);
    if (found) add('Branch', found.description, { key: found.key, ref: found.ref });
  };

  // Text you highlighted is the most direct statement of intent there is.
  if (page.selection) add('Selection', page.selection);
  const ctx = { page, url, parts: url ? url.pathname.split('/').filter(Boolean).map(decode) : [], hints, tasks, add, branch };
  const understood = url && RECOGNIZERS.some((recognize) => recognize(ctx));
  if (!understood) {
    add('Page', cleanTitle(page, url));
    add('Heading', page.heading);
  }

  // Drop anything already said by an earlier suggestion.
  const kept = [];
  for (const task of tasks) {
    const n = norm(task.description);
    if (!kept.some((k) => norm(k.description).includes(n))) kept.push(task);
  }
  return { tasks: kept, hints };
}

/* ---------- projects ---------- */

/**
 * The project a suggestion most likely belongs to, or null. `entries` must be
 * newest first (as Store.getEntries returns them) so history favours what you
 * did last. Only existing, unarchived projects are ever returned.
 */
function matchProject(task, hints, projects, entries) {
  const active = projects.filter((p) => p && !p.archived);
  if (!active.length) return null;
  const ids = new Set(active.map((p) => p.id));
  const { repo, owner } = hints;

  const fromHistory = (pattern) =>
    entries.find((e) => ids.has(e.projectId) && pattern.test(e.description || ''))?.projectId ?? null;
  const mentions = (token) => new RegExp(`(?:^|[^\\w-])${escapeRegExp(token)}(?![\\w-])`, 'i');
  const named = (value, { client = false } = {}) => {
    const n = norm(value);
    if (n.length < 2) return null;
    return active.find((p) => norm(p.name) === n || (client && norm(p.client) === n))?.id ?? null;
  };
  const overlapping = (value) => {
    const n = norm(value);
    if (n.length < 4) return null;
    return active.find((p) => {
      const m = norm(p.name);
      return m.length >= 4 && (m.includes(n) || n.includes(m));
    })?.id ?? null;
  };
  const prefixes = [...new Set([task.key, ...hints.keys].filter(Boolean).map((k) => k.split('-')[0]))];

  const steps = [
    // 1. This very ticket, issue or pull request was tracked before.
    () => task.key && fromHistory(mentions(task.key)),
    () => task.ref && fromHistory(mentions(task.ref)),
    // 2. A project named after the repository or the ticket prefix.
    () => named(repo),
    ...prefixes.map((p) => () => named(p)),
    // 3. Earlier work in the same ticket series or repository.
    ...prefixes.map((p) => () => fromHistory(new RegExp(`(?:^|[^\\w-])${escapeRegExp(p)}-\\d+(?![\\w-])`, 'i'))),
    () => repo && fromHistory(new RegExp(`(?:^|[^\\w-])${escapeRegExp(repo)}[#!]\\d|\\(${escapeRegExp(repo)}\\)`, 'i')),
    // 4. A project or client named after the repository owner or the site.
    ...[owner, ...hints.hosts].map((v) => () => named(v, { client: true })),
    // 5. Names that contain one another: "timit" ↔ "TimIt extension".
    () => overlapping(repo),
  ];
  for (const step of steps) {
    const id = step();
    if (id) return id;
  }
  return null;
}

/**
 * What the popup offers for a page: up to MAX_SUGGESTIONS of
 * { description, source, projectId|null }, best first.
 *
 * @param raw  whatever readPage/readActiveTab returned — treated as untrusted
 * @param opts { projects, entries } entries newest first
 */
export function suggestTasks(raw, { projects = [], entries = [] } = {}) {
  const page = sanitizePage(raw);
  if (!page) return [];
  const { tasks, hints } = analyzePage(page);
  return tasks.slice(0, MAX_SUGGESTIONS).map((task) => ({
    description: task.description,
    source: task.source,
    projectId: matchProject(task, hints, projects, entries),
  }));
}
