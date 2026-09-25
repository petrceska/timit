/**
 * Injection regression tests.
 *
 * Everything here is input TimIt does not control: entry descriptions and
 * project names typed by the user, CSV files imported from other tools, JSON
 * backups, sync files edited by hand or pulled from git, and the web pages it
 * reads suggestions from. Each test pins down one way that input must NOT be
 * able to escape the slot it belongs in:
 *
 *   1. CSV structure  — no forging extra rows, columns or ids
 *   2. CSV formulas   — no executable cells in files we write
 *   3. DOM            — no markup sinks anywhere in src/
 *   4. Storage        — no unsafe values reaching inline styles or storage
 *   5. Manifest       — no widening of what the extension may touch
 *   6. Page context   — no reaching past the tab, no page text choosing anything
 *
 * Run: node test/injection.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');

/* ---- module loading (the store touches chrome.* at import time) ---------- */

const store = { projects: [], entries: [], settings: {} };
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = keys == null ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys]);
        const out = {};
        for (const k of list) if (store[k] !== undefined) out[k] = structuredClone(store[k]);
        return out;
      },
      async set(obj) { Object.assign(store, structuredClone(obj)); },
      async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
    },
    onChanged: { addListener() {} },
  },
};
globalThis.indexedDB = { open: () => ({}) };

const { Store, safeColor, PALETTE } = await import(new URL('../src/lib/store.js', import.meta.url));
const { toCSV, fromCSV, parseCSV, neutralizeFormula, restoreFormula } =
  await import(new URL('../src/lib/csv.js', import.meta.url));
const { mergeRows, SYNC_COLUMNS } = await import(new URL('../src/lib/sync.js', import.meta.url));
const { suggestTasks, DESCRIPTION_LIMIT, MAX_SUGGESTIONS } =
  await import(new URL('../src/lib/context.js', import.meta.url));

/* ---- harness ------------------------------------------------------------ */

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const project = { id: 'p1', name: 'Acme', client: 'Acme Ltd', color: '#4f8ef7' };
const T = (h) => new Date(2026, 7, 3, h, 0, 0).getTime();
const entry = (id, h, desc, over = {}) => ({
  id, projectId: 'p1', description: desc, start: T(h), end: T(h + 1),
  tags: [], billable: false, ...over,
});
// Row counting must go through the CSV parser: a newline inside a quoted cell
// is legal and does NOT make a new record, which is exactly what these tests
// are checking. Splitting on '\n' would hide the very bug we care about.
const dataRows = (text) => parseCSV(text).slice(1);
const dataLines = (text) => text.trim().split('\n').slice(1);

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const sourceFiles = walk(SRC).filter((f) => f.endsWith('.js'));

/* ================= 1. CSV structure: no forged rows ====================== */

test('a description cannot forge extra rows in an export', () => {
  const evil = 'lunch\n2026-08-04,09:00:00,2026-08-04,17:00:00,08:00:00,8.00';
  const csv = toCSV([entry('a', 9, evil)], new Map([['p1', project]]), {});
  assert.equal(dataRows(csv).length, 1, 'newline in a description created a second row');
  const back = fromCSV(csv, {});
  assert.equal(back.rows.length, 1);
  assert.equal(back.rows[0].description, evil, 'description did not survive intact');
});

test('a description cannot forge extra columns in an export', () => {
  const evil = 'a","b","c';
  const csv = toCSV([entry('a', 9, evil)], new Map([['p1', project]]), {});
  const table = parseCSV(csv);
  assert.equal(table[1].length, table[0].length, 'quotes in a description shifted the columns');
  assert.equal(fromCSV(csv, {}).rows[0].description, evil);
});

test('a description cannot forge a row in the sync file', () => {
  const evil = 'ok\nzz9,Acme,Acme Ltd,Injected,,No,2026-08-09,09:00:00,2026-08-09,10:00:00,01:00:00,1.00';
  const r = mergeRows('', [entry('a', 9, evil)], project, []);
  assert.equal(dataRows(r.text).length, 1);
  assert.deepEqual(r.ids, ['a']);
  // and re-reading it back sees exactly one entry, still owned by 'a'
  const again = mergeRows(r.text, [entry('a', 9, evil)], project, r.ids);
  assert.equal(dataRows(again.text).length, 1);
  assert.equal(again.foreign, 0, 'a forged row appeared as a foreign row');
});

test('a description cannot forge or hijack an entry id in the sync file', () => {
  const evil = 'x","a2","Acme';
  const r = mergeRows('', [entry('a1', 9, 'real'), entry('a2', 11, evil)], project, []);
  assert.deepEqual(dataRows(r.text).map((row) => row[0]), ['a1', 'a2']);
  assert.equal(r.ids.length, 2);
  // the payload stayed in the description column
  assert.equal(dataRows(r.text)[1][3], evil);
});

test('a project name cannot forge columns in the sync file', () => {
  const nasty = { ...project, name: 'Ops","evil', client: 'C\nD' };
  const r = mergeRows('', [entry('a', 9, 'work')], nasty, []);
  const table = parseCSV(r.text);
  assert.equal(table.length, 2);
  assert.equal(table[1].length, SYNC_COLUMNS.length);
  assert.equal(table[1][1], 'Ops","evil');
});

test('a hostile file cannot delete rows we own', () => {
  const mine = mergeRows('', [entry('a', 9, 'A'), entry('b', 11, 'B')], project, []);
  // Someone edits the file: one row is dropped and the other's id is replaced
  const tampered = SYNC_COLUMNS.join(',') + '\n' +
    dataLines(mine.text)[0].replace(/^a,/, 'not-a,') + '\n';
  const r = mergeRows(tampered, [entry('a', 9, 'A'), entry('b', 11, 'B')], project, mine.ids);
  const ids = dataRows(r.text).map((row) => row[0]);
  assert.ok(ids.includes('a') && ids.includes('b'), 'local entries were lost to a tampered file');
});

test('a CSV import cannot choose entry ids', async () => {
  store.projects = []; store.entries = [];
  const csv = 'ID,Project,Description,Start Date,Start Time,End Date,End Time\n' +
    'forged-id,Imported,Work,08/03/2026,09:00:00,08/03/2026,10:00:00\n';
  const { rows } = fromCSV(csv, {});
  assert.equal(rows.length, 1);
  assert.ok(!('id' in rows[0]), 'the importer read an id from the file');
  const created = await Store.addEntries(rows.map((r) => ({ ...r, projectId: null })));
  assert.notEqual(created[0].id, 'forged-id');
});

/* ================= 2. CSV formula injection ============================== */

test('formula-leading cells are neutralised on export', () => {
  const payloads = ['=1+1', '+1', '-1', '@SUM(A1)', '=HYPERLINK("http://x","c")', '\t=cmd', '\r=cmd'];
  for (const payload of payloads) {
    const csv = toCSV([entry('a', 9, payload)], new Map([['p1', project]]), {});
    const cell = parseCSV(csv)[1][2];
    assert.ok(cell.startsWith("'"), `not neutralised: ${JSON.stringify(payload)}`);
    assert.ok(!/^[=+\-@\t\r]/.test(cell), `still executable: ${JSON.stringify(payload)}`);
  }
});

test('a neutralised cell reads back as the original text', () => {
  const payload = '=cmd|"/c calc"!A0';
  const csv = toCSV([entry('a', 9, payload)], new Map([['p1', project]]), {});
  assert.equal(fromCSV(csv, {}).rows[0].description, payload);
});

test('ordinary text is left exactly as typed', () => {
  for (const plain of ['Wrote the docs', 'a - b', 'x=y', 'e@example.com', '3+4 review']) {
    assert.equal(neutralizeFormula(plain), plain, `mangled: ${plain}`);
    assert.equal(restoreFormula(neutralizeFormula(plain)), plain);
  }
});

test('project names, clients and tags are neutralised too', () => {
  const nasty = { ...project, name: '=evil()', client: '@evil' };
  const csv = toCSV([entry('a', 9, 'ok', { tags: ['=BAD()'] })], new Map([['p1', nasty]]), {});
  const row = parseCSV(csv)[1];
  for (const i of [0, 1, 7]) assert.ok(row[i].startsWith("'"), `column ${i} is executable`);
});

test('the sync file neutralises formulas and stays idempotent', () => {
  const e = entry('a', 9, '=IMPORTXML(1,2)');
  const first = mergeRows('', [e], project, []);
  assert.ok(parseCSV(first.text)[1][3].startsWith("'"));
  const second = mergeRows(first.text, [e], project, first.ids);
  assert.equal(second.text, first.text, 'escaping is not stable across syncs');
  assert.deepEqual([second.added, second.updated, second.removed], [0, 0, 0]);
});

test('an un-escaped row from another tool is matched, not duplicated', () => {
  const e = entry('a', 9, '=total');
  const theirs = SYNC_COLUMNS.join(',') +
    '\n,Acme,Acme Ltd,=total,,No,2026-08-03,09:00:00,2026-08-03,10:00:00,01:00:00,1.00\n';
  const r = mergeRows(theirs, [e], project, []);
  assert.equal(dataRows(r.text).length, 1, 'the same work was written twice');
  assert.equal(r.adopted, 1);
});

/* ================= 3. DOM: no markup sinks =============================== */

test('no source file writes user data into markup', () => {
  const offenders = [];
  for (const file of sourceFiles) {
    const code = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    // innerHTML may only be assigned a literal, and a template literal may not
    // interpolate — that is the line between fixed markup the code author wrote
    // and markup built out of data.
    for (const m of code.matchAll(/\.innerHTML\s*=\s*/g)) {
      const rest = code.slice(m.index + m[0].length);
      const quote = rest[0];
      if (quote !== '`' && quote !== "'" && quote !== '"') {
        offenders.push(`${rel}: innerHTML assigned a non-literal (${rest.slice(0, 40).split('\n')[0]})`);
        continue;
      }
      const literal = rest.slice(0, rest.indexOf(quote, 1) + 1);
      if (literal.includes('${') || literal.includes('" +') || literal.includes("' +")) {
        offenders.push(`${rel}: innerHTML built from data`);
      }
    }
    for (const sink of ['insertAdjacentHTML', 'outerHTML', 'document.write', 'createContextualFragment']) {
      if (code.includes(sink)) offenders.push(`${rel}: uses ${sink}`);
    }
  }
  assert.deepEqual(offenders, [], `markup sinks found:\n${offenders.join('\n')}`);
});

test('no source file can execute a string', () => {
  const offenders = [];
  for (const file of sourceFiles) {
    const code = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    if (/\beval\s*\(/.test(code)) offenders.push(`${rel}: eval()`);
    if (/new\s+Function\s*\(/.test(code)) offenders.push(`${rel}: new Function()`);
    if (/setTimeout\s*\(\s*['"`]/.test(code)) offenders.push(`${rel}: setTimeout("string")`);
  }
  assert.deepEqual(offenders, []);
});

test('the el() helper has no markup option', () => {
  const ui = readFileSync(path.join(SRC, 'lib/ui.js'), 'utf8');
  assert.ok(!/k === 'html'/.test(ui), 'el() can still be handed raw HTML');
  const usesHtmlKey = sourceFiles.filter((f) => /\bhtml:\s/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(usesHtmlKey, []);
});

/* ================= 4. Storage: colours and untrusted backups ============= */

test('only real hex colours reach an inline style', () => {
  const attacks = [
    '#fff" onload="alert(1)',
    'red;position:fixed;inset:0',
    'url(javascript:alert(1))',
    'expression(alert(1))',
    '#4f8ef7; background-image: url(https://evil.example/x.png)',
    '', null, undefined, 42, {},
  ];
  for (const bad of attacks) {
    const out = safeColor(bad);
    assert.ok(PALETTE.includes(out) || /^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(out),
      `unsafe colour survived: ${JSON.stringify(bad)} -> ${JSON.stringify(out)}`);
    assert.ok(!/["'<>;()]|\s/.test(out), `colour can break out: ${JSON.stringify(out)}`);
  }
  assert.equal(safeColor('#ABCDEF'), '#abcdef');
  assert.equal(safeColor('  #fff  '), '#fff');
});

test('a project cannot be saved with an unsafe colour', async () => {
  store.projects = []; store.entries = [];
  const p = await Store.addProject({ name: 'Evil', color: '#fff" onmouseover="alert(1)' });
  assert.ok(!p.color.includes('"'));
  const updated = await Store.updateProject(p.id, { color: 'javascript:alert(1)' });
  assert.ok(!updated.color.includes(':'));
});

test('an unsafe colour already in storage is neutralised when read', async () => {
  store.projects = [{ id: 'x', name: 'Old', color: '#fff" onload="alert(1)', client: '', archived: false }];
  const [p] = await Store.getProjects();
  assert.ok(!p.color.includes('"'), 'a stored payload was handed straight to the UI');
});

test('a hostile backup cannot pollute Object.prototype', async () => {
  store.projects = []; store.entries = [];
  const hostile = JSON.parse(`{
    "format": "timit-backup",
    "projects": [{"id":"p","name":"P","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}],
    "entries": [{"id":"e","projectId":"p","start":1,"end":2,"__proto__":{"polluted":"yes"}}],
    "settings": {"__proto__":{"polluted":"yes"}}
  }`);
  await Store.importBackup(hostile, { replace: true });
  assert.equal({}.polluted, undefined, 'Object.prototype was polluted by an import');
  assert.equal(Object.prototype.polluted, undefined);
});

test('a backup cannot smuggle unexpected fields or shapes into storage', async () => {
  store.projects = []; store.entries = [];
  await Store.importBackup({
    format: 'timit-backup',
    projects: [{ id: 'p1', name: 'Ok', color: 'red;x:1', evil: '<script>', archived: 'truthy' }],
    entries: [
      { id: 'e1', projectId: 'p1', start: '1700000000000', end: 1700003600000, tags: 'not-an-array', evil: 1 },
      { id: 'e2', projectId: 'p1', start: 'nonsense', end: 5 },        // dropped: no start
      { id: 'e3', projectId: 'p1', start: 900, end: 100 },             // dropped: ends before it starts
      { id: 'e4', projectId: 'ghost', start: 1700000000000, end: 1700001000000 },
    ],
    settings: { csvDateFormat: 'evil', weekStart: 99, userName: { toString: 1 }, extra: 'nope' },
  }, { replace: true });

  const [p] = await Store.getProjects();
  assert.ok(!('evil' in p), 'an unknown field was written to storage');
  assert.equal(p.archived, true);
  assert.ok(!p.color.includes(';'));

  const entries = await Store.getEntries();
  assert.deepEqual(entries.map((e) => e.id).sort(), ['e1', 'e4']);
  const e1 = entries.find((e) => e.id === 'e1');
  assert.equal(typeof e1.start, 'number');
  assert.deepEqual(e1.tags, []);
  assert.ok(!('evil' in e1));
  assert.equal(entries.find((e) => e.id === 'e4').projectId, null, 'entry kept a dangling project id');

  const settings = await Store.getSettings();
  assert.equal(settings.csvDateFormat, 'clockify');
  assert.equal(settings.weekStart, 1);
  assert.ok(!('extra' in settings));
});

test('imported CSV text stays text all the way into storage', async () => {
  store.projects = []; store.entries = [];
  const csv = 'Project,Description,Start Date,Start Time,End Date,End Time\n' +
    '"<img src=x onerror=alert(1)>","</script><script>alert(1)</script>",' +
    '08/03/2026,09:00:00,08/03/2026,10:00:00\n';
  const { rows } = fromCSV(csv, {});
  const p = await Store.addProject({ name: rows[0].projectName });
  const [e] = await Store.addEntries([{ ...rows[0], projectId: p.id }]);
  assert.equal(p.name, '<img src=x onerror=alert(1)>');
  assert.equal(e.description, '</script><script>alert(1)</script>');
  // ...and comes back out of a re-export unchanged, still as one row
  const csv2 = toCSV([e], new Map([[p.id, p]]), {});
  assert.equal(dataRows(csv2).length, 1);
  assert.equal(fromCSV(csv2, {}).rows[0].description, e.description);
});

/* ================= 5. Manifest: nothing widened ========================== */

test('the extension asks for local storage and the tab you invoke it on, nothing more', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  // activeTab + scripting reach only the tab you clicked the icon or pressed the
  // shortcut on, and only at that moment. "tabs" or host permissions would reach
  // every page you visit.
  assert.deepEqual([...(manifest.permissions || [])].sort(),
    ['activeTab', 'alarms', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined, 'host permissions would allow network access');
  assert.equal(manifest.content_scripts, undefined, 'content scripts would run on pages');
  assert.equal(manifest.web_accessible_resources, undefined, 'pages could reach into the extension');
  assert.equal(manifest.externally_connectable, undefined, 'sites could message the extension');
  assert.equal(manifest.sandbox, undefined);
  const csp = JSON.stringify(manifest.content_security_policy || {});
  assert.ok(!/unsafe-eval|unsafe-inline|https?:/.test(csp), `CSP was weakened: ${csp}`);
});

test('no page loads code or data from the network', () => {
  const html = walk(SRC).filter((f) => f.endsWith('.html'));
  assert.ok(html.length >= 2);
  for (const file of html) {
    const text = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    assert.ok(!/src\s*=\s*["']https?:/i.test(text), `${rel} loads a remote script`);
    assert.ok(!/href\s*=\s*["']https?:/i.test(text), `${rel} loads a remote stylesheet`);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(text),
      `${rel} has an inline script`);
  }
  for (const file of sourceFiles) {
    const code = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    for (const sink of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon']) {
      assert.ok(!code.includes(sink), `${rel} can reach the network (${sink})`);
    }
  }
});

/* ================= 6. Page context: the tab you're on ==================== */

test('a tab is read only by our own function, once, in an isolated world', () => {
  const callers = sourceFiles
    .filter((f) => /\bscripting\./.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f));
  assert.deepEqual(callers, [path.join('lib', 'context.js')], 'chrome.scripting used outside context.js');
  const code = readFileSync(path.join(SRC, 'lib/context.js'), 'utf8');
  assert.deepEqual([...code.matchAll(/scripting\.(\w+)\(/g)].map((m) => m[1]), ['executeScript'],
    'only one-off injection: no registered content scripts, no CSS');
  const at = code.indexOf('executeScript(');
  const call = code.slice(at, code.indexOf('});', at));
  assert.match(call, /func: readPage,/);
  for (const widened of ['files:', 'world:', 'allFrames', 'frameIds', 'documentIds']) {
    assert.ok(!call.includes(widened), `executeScript was widened with ${widened}`);
  }
  // The injected function reads and reports back; it never acts on the page.
  const from = code.indexOf('export function readPage');
  const body = code.slice(from, code.indexOf('export async function readActiveTab'));
  assert.ok(from >= 0 && body.length > 100);
  for (const action of ['chrome.', 'postMessage', 'cookie', 'Storage', 'dispatchEvent', '.click(',
    'setAttribute', 'textContent =', '.value =', '.remove(', 'open(']) {
    assert.ok(!body.includes(action), `readPage does more than read: ${action}`);
  }
});

test('text read from a page stays bounded, inert and unable to choose a project', () => {
  const hidden = String.fromCharCode(0x202e, 0x0000, 0x200b, 0x2028, 0x0007);
  const markup = '<img src=x onerror=alert(1)>';
  const [flood] = suggestTasks({
    url: 'https://example.com/',
    title: `${hidden}${markup} `.repeat(400),
    heading: { toString() { throw new Error('page text was coerced'); } },
    selection: ['not', 'text'],
    branch: 42,
  });
  assert.ok([...flood.description].length <= DESCRIPTION_LIMIT, 'a flood of text was not clipped');
  // Still just characters: the popup puts them in textContent (see section 3).
  assert.ok(flood.description.startsWith(markup));
  assert.ok(![...hidden].some((c) => flood.description.includes(c)), 'control or bidi characters survived');

  const projects = [
    { id: 'p1', name: 'Shop', client: '' },
    { id: 'p2', name: 'Old', client: '', archived: true },
  ];
  const list = suggestTasks({
    url: 'https://github.com/acme/old/issues/1',
    title: 'X · Issue #1 · acme/old · GitHub',
    projectId: 'p1',
    project: 'Shop',
  }, { projects, entries: [] });
  assert.ok(list.length >= 1 && list.length <= MAX_SUGGESTIONS);
  for (const s of list) {
    assert.deepEqual(Object.keys(s).sort(), ['description', 'projectId', 'source']);
    assert.equal(s.projectId, null, 'a page chose a project, or an archived one was picked');
  }
});

/* ---- run ---------------------------------------------------------------- */

for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('  FAIL ' + name + '\n       ' + err.message);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} injection tests passed`);
