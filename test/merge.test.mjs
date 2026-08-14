/**
 * Tests for the sync merge decision procedure. Imports the real module with a
 * minimal chrome.storage stub (mergeRows itself is pure, but the module's
 * top-level imports touch chrome).
 */
import assert from 'node:assert/strict';

globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    onChanged: { addListener() {} } },
};
globalThis.indexedDB = { open: () => ({}) };

const { mergeRows, SYNC_COLUMNS } = await import(
  new URL('../src/lib/sync.js', import.meta.url));

const project = { id: 'p1', name: 'Acme', client: 'Acme Ltd' };
const T = (h) => new Date(2026, 7, 3, h, 0, 0).getTime();
const entry = (id, h, desc, over = {}) => ({
  id, projectId: 'p1', description: desc, start: T(h), end: T(h + 1),
  tags: [], billable: false, ...over,
});

const lines = (text) => text.trim().split('\n');
const rows = (text) => lines(text).slice(1);
const idsOf = (text) => rows(text).map((l) => l.split(',')[0]);
const cols = (line) => {
  const out = []; let cell = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out;
};
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

/* ------------------------------------------------------------------ */

test('creates a file from nothing', () => {
  const r = mergeRows('', [entry('a', 9, 'Work')], project, []);
  assert.equal(lines(r.text)[0], SYNC_COLUMNS.join(','));
  assert.deepEqual([r.added, r.updated, r.removed, r.foreign], [1, 0, 0, 0]);
  const c = cols(rows(r.text)[0]);
  assert.deepEqual(c.slice(0, 6), ['a', 'Acme', 'Acme Ltd', 'Work', '', 'No']);
  assert.deepEqual(c.slice(6, 12),
    ['2026-08-03', '09:00:00', '2026-08-03', '10:00:00', '01:00:00', '1.00']);
});

test('is idempotent — a second pass writes nothing new', () => {
  const first = mergeRows('', [entry('a', 9, 'Work')], project, []);
  const second = mergeRows(first.text, [entry('a', 9, 'Work')], project, first.ids);
  assert.equal(second.text, first.text);
  assert.deepEqual([second.added, second.updated, second.removed], [0, 0, 0]);
});

test('adds new entries and keeps existing rows byte-identical', () => {
  const a = mergeRows('', [entry('a', 9, 'Work')], project, []);
  const b = mergeRows(a.text, [entry('a', 9, 'Work'), entry('b', 14, 'More')], project, a.ids);
  assert.equal(b.added, 1);
  assert.equal(rows(b.text).length, 2);
  assert.equal(rows(b.text)[0], rows(a.text)[0]);
});

test('updates the right row in place when an entry changes', () => {
  const a = mergeRows('', [entry('a', 9, 'Work'), entry('b', 14, 'More')], project, []);
  const edited = [entry('a', 9, 'Work'), entry('b', 14, 'More', { end: T(17) })];
  const b = mergeRows(a.text, edited, project, a.ids);
  assert.deepEqual([b.added, b.updated, b.removed], [0, 1, 0]);
  assert.deepEqual(idsOf(b.text), ['a', 'b']);
  assert.equal(cols(rows(b.text)[1])[10], '03:00:00');
});

test('removes a row when its entry was deleted locally', () => {
  const a = mergeRows('', [entry('a', 9, 'Work'), entry('b', 14, 'More')], project, []);
  const b = mergeRows(a.text, [entry('a', 9, 'Work')], project, a.ids);
  assert.deepEqual([b.added, b.updated, b.removed], [0, 0, 1]);
  assert.deepEqual(idsOf(b.text), ['a']);
});

test('removes a row when its entry moved to another project', () => {
  const a = mergeRows('', [entry('a', 9, 'Work'), entry('b', 14, 'More')], project, []);
  // 'b' now belongs to another project, so it is no longer in this project's list
  const b = mergeRows(a.text, [entry('a', 9, 'Work')], project, a.ids);
  assert.equal(b.removed, 1);
  assert.deepEqual(idsOf(b.text), ['a']);
});

test('NEVER deletes rows another machine added through git', () => {
  const mine = mergeRows('', [entry('a', 9, 'Work')], project, []);
  const teammate = mine.text.trimEnd() +
    '\nzz9,Acme,Acme Ltd,Laptop work,,No,2026-08-04,09:00:00,2026-08-04,11:30:00,02:30:00,2.50\n';
  const after = mergeRows(teammate, [entry('a', 9, 'Work')], project, mine.ids);
  assert.equal(after.foreign, 1);
  assert.equal(after.removed, 0);
  assert.deepEqual(idsOf(after.text), ['a', 'zz9']);
  // ...and it still isn't deleted on later passes
  const again = mergeRows(after.text, [entry('a', 9, 'Work')], project, after.ids);
  assert.equal(again.text, after.text);
});

test('a foreign row stays foreign even after we sync our own deletions', () => {
  const mine = mergeRows('', [entry('a', 9, 'A'), entry('b', 14, 'B')], project, []);
  const withTheirs = mine.text.trimEnd() +
    '\nzz9,Acme,Acme Ltd,Theirs,,No,2026-08-05,09:00:00,2026-08-05,10:00:00,01:00:00,1.00\n';
  const after = mergeRows(withTheirs, [entry('a', 9, 'A')], project, mine.ids);
  assert.deepEqual(idsOf(after.text), ['a', 'zz9']);
  assert.deepEqual([after.removed, after.foreign], [1, 1]);
});

test('adopts an id-less row that is the same work (no duplicate)', () => {
  const handWritten = SYNC_COLUMNS.join(',') +
    '\n,Acme,Acme Ltd,Work,,No,2026-08-03,09:00:00,2026-08-03,10:00:00,01:00:00,1.00\n';
  const r = mergeRows(handWritten, [entry('a', 9, 'Work')], project, []);
  assert.deepEqual([r.added, r.adopted, r.foreign], [0, 1, 0]);
  assert.deepEqual(idsOf(r.text), ['a']);
});

test('keeps an id-less row that matches nothing', () => {
  const handWritten = SYNC_COLUMNS.join(',') +
    '\n,Acme,,Meeting someone,,No,2026-08-02,09:00:00,2026-08-02,09:30:00,00:30:00,0.50\n';
  const r = mergeRows(handWritten, [entry('a', 9, 'Work')], project, []);
  assert.deepEqual([r.added, r.foreign], [1, 1]);
  assert.equal(rows(r.text).length, 2);
});

test('collapses duplicate lines for the same entry', () => {
  const one = mergeRows('', [entry('a', 9, 'Work')], project, []);
  const doubled = one.text.trimEnd() + '\n' + rows(one.text)[0] + '\n';
  const r = mergeRows(doubled, [entry('a', 9, 'Work')], project, one.ids);
  assert.deepEqual(idsOf(r.text), ['a']);
});

test('rewrites every row when the project is renamed', () => {
  const a = mergeRows('', [entry('a', 9, 'Work'), entry('b', 14, 'More')], project, []);
  const renamed = { ...project, name: 'Acme Rebrand' };
  const b = mergeRows(a.text, [entry('a', 9, 'Work'), entry('b', 14, 'More')], renamed, a.ids);
  assert.equal(b.updated, 2);
  assert.ok(rows(b.text).every((l) => cols(l)[1] === 'Acme Rebrand'));
});

test('sorts by start time so git diffs stay minimal', () => {
  const r = mergeRows('', [entry('c', 16, 'C'), entry('a', 9, 'A'), entry('b', 11, 'B')], project, []);
  assert.deepEqual(idsOf(r.text), ['a', 'b', 'c']);
  // inserting an earlier entry only adds one line
  const r2 = mergeRows(r.text, [entry('c', 16, 'C'), entry('a', 9, 'A'), entry('b', 11, 'B'),
    entry('d', 8, 'D')], project, r.ids);
  const before = rows(r.text), after = rows(r2.text);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.slice(1), before);
});

test('quotes commas, quotes and newlines', () => {
  const r = mergeRows('', [entry('a', 9, 'Fixed "the, thing"\nand more')], project, []);
  const round = mergeRows(r.text, [entry('a', 9, 'Fixed "the, thing"\nand more')], project, r.ids);
  assert.equal(round.text, r.text);
  assert.deepEqual([round.added, round.updated], [0, 0]);
});

test('tags and billable round-trip', () => {
  const e = entry('a', 9, 'Work', { tags: ['ops', 'urgent'], billable: true });
  const r = mergeRows('', [e], project, []);
  const c = cols(rows(r.text)[0]);
  assert.equal(c[4], 'ops, urgent');
  assert.equal(c[5], 'Yes');
  assert.equal(mergeRows(r.text, [e], project, r.ids).text, r.text);
});

test('reads a file whose columns were reordered by hand', () => {
  const reordered = 'Description,ID,Start Date,Start Time,End Date,End Time,Project\n' +
    'Work,a,2026-08-03,09:00:00,2026-08-03,10:00:00,Acme\n';
  const r = mergeRows(reordered, [entry('a', 9, 'Work')], project, ['a']);
  assert.deepEqual([r.added, r.removed], [0, 0]);
  assert.deepEqual(idsOf(r.text), ['a']);
});

test('refuses to touch a file it cannot understand', () => {
  assert.throws(() => mergeRows('total nonsense\n1,2,3\n', [entry('a', 9, 'W')], project, []),
    /Start Date/);
});

test('an empty project empties its rows but keeps foreign ones', () => {
  const mine = mergeRows('', [entry('a', 9, 'A')], project, []);
  const withTheirs = mine.text.trimEnd() +
    '\nzz,Acme,,Theirs,,No,2026-08-06,09:00:00,2026-08-06,10:00:00,01:00:00,1.00\n';
  const r = mergeRows(withTheirs, [], project, mine.ids);
  assert.deepEqual(idsOf(r.text), ['zz']);
  assert.equal(r.removed, 1);
});

test('a re-linked file is not wiped when we have forgotten what we wrote', () => {
  const old = mergeRows('', [entry('a', 9, 'A'), entry('b', 14, 'B')], project, []);
  // lastWritten = [] simulates linking the file on a fresh install
  const r = mergeRows(old.text, [entry('a', 9, 'A')], project, []);
  assert.deepEqual(idsOf(r.text), ['a', 'b']);
  assert.equal(r.removed, 0);
  assert.equal(r.foreign, 1);
});

console.log(`\n${n} tests passed`);
