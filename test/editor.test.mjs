/**
 * The add / edit entry dialog, the project picker inside it, and the time
 * helpers they rely on.
 *
 * These are the parts a person types into, so the tests act like a person:
 * they fill fields, press keys and click buttons, then look at what was stored.
 * The DOM is the small stand-in from test/helpers/dom.mjs — no browser needed.
 *
 * Run: node test/editor.test.mjs
 */
import assert from 'node:assert/strict';
import { installDom, Event } from './helpers/dom.mjs';

/* ---- module loading (the store touches chrome.* at import time) ---------- */

const store = {};
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
installDom();

const { Store } = await import(new URL('../src/lib/store.js', import.meta.url));
const { ProjectPicker } = await import(new URL('../src/lib/picker.js', import.meta.url));
const { openEntryEditor } = await import(new URL('../src/lib/entry-editor.js', import.meta.url));
const {
  timeInput, combineDateTime, dayKey, formatClock, parseDuration,
} = await import(new URL('../src/lib/time.js', import.meta.url));
const {
  recentDescriptions, descriptionRows, recentTags, applyTag,
} = await import(new URL('../src/lib/recent.js', import.meta.url));

/* ---- harness ------------------------------------------------------------ */

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const at = (h, m, s, day = 1) => new Date(2026, 8, day, h, m, s).getTime();

/** Lets stored data load and queued focus / key handlers finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

const press = (target, key) => {
  const event = new Event('keydown', { key });
  target.dispatchEvent(event);
  return event;
};
const type = (input, value, eventName = 'change') => {
  input.value = value;
  input.dispatchEvent(new Event(eventName));
};

/** Opens the dialog and returns handles to the things a person would touch. */
async function openEditor(entry) {
  let result;
  let closed = false;
  openEntryEditor(entry).then((value) => { result = value; closed = true; });
  await settle();
  const dialog = document.querySelector('.modal');
  const field = (label) => dialog.querySelectorAll('.field')
    .find((f) => f.querySelector('label').textContent === label)
    .querySelector('input');
  const button = (label) => dialog.querySelectorAll('button')
    .find((b) => b.textContent === label);
  return {
    dialog, field, button,
    picker: {
      button: dialog.querySelector('.picker-btn'),
      search: dialog.querySelector('.picker-search'),
      label: dialog.querySelector('.picker-label'),
      pop: dialog.querySelector('.picker-pop'),
    },
    isOpen: () => !closed,
    result: () => result,
    save: async () => { button('Save').click(); await settle(); },
  };
}

/** Stores one finished entry and returns it. */
const seedEntry = (over = {}) => Store.addEntry({
  description: 'Write report', start: at(9, 5, 42), end: at(10, 20, 7), ...over,
});
const onlyEntry = async () => {
  const entries = await Store.getEntries();
  assert.equal(entries.length, 1, 'expected exactly one stored entry');
  return entries[0];
};

/* ================= time helpers ========================================== */

test('timeInput keeps the seconds', () => {
  assert.equal(timeInput(at(9, 5, 42)), '09:05:42');
  assert.equal(timeInput(at(0, 0, 0)), '00:00:00');
});

test('a time written into a field and read back is the same moment', () => {
  for (const ms of [at(9, 5, 42), at(23, 59, 59), at(0, 0, 1)]) {
    assert.equal(combineDateTime(dayKey(ms), timeInput(ms)).getTime(), ms);
  }
});

test('combineDateTime accepts a time without seconds', () => {
  assert.equal(combineDateTime('2026-09-01', '09:05').getTime(), at(9, 5, 0));
});

test('formatClock and parseDuration agree, seconds included', () => {
  assert.equal(formatClock(3725000), '01:02:05');
  assert.equal(parseDuration('01:02:05'), 3725000);
  assert.equal(parseDuration('1:30'), 5400000);
  assert.equal(parseDuration('90m'), 5400000);
  assert.equal(parseDuration('1h 30m 15s'), 5415000);
  assert.equal(parseDuration('1.5'), 5400000);
  assert.equal(parseDuration('soon'), null);
});

/* ================= project picker ======================================== */

/** A picker inside a wrapper that counts the key presses that reach it. */
async function mountPicker(opts = {}) {
  const host = document.createElement('div');
  const wrapper = document.createElement('div');
  wrapper.append(host);
  document.body.append(wrapper);
  const reached = [];
  wrapper.addEventListener('keydown', (e) => reached.push(e.key));
  const picker = new ProjectPicker(host, opts);
  await picker.open();
  return { picker, reached, search: host.querySelector('.picker-search'), host };
}

test('picker: Enter on a new name creates the project and selects it', async () => {
  const changes = [];
  const { picker, search, host } = await mountPicker({ onChange: (id) => changes.push(id) });
  type(search, 'Website', 'input');
  press(search, 'Enter');
  await settle();

  const projects = await Store.getProjects();
  assert.deepEqual(projects.map((p) => p.name), ['Website']);
  assert.equal(picker.getValue(), projects[0].id);
  assert.deepEqual(changes, [projects[0].id]);
  assert.equal(host.querySelector('.picker-label').textContent, 'Website');
  assert.equal(host.querySelector('.picker-pop').hidden, true);
});

test('picker: Enter on an existing name selects it and does not create a copy', async () => {
  const existing = await Store.addProject({ name: 'Website' });
  const { picker, search } = await mountPicker();
  type(search, 'website', 'input');
  press(search, 'Enter');
  await settle();

  assert.equal(picker.getValue(), existing.id);
  assert.equal((await Store.getProjects()).length, 1);
});

test('picker: arrow keys move the highlight, Enter takes the highlighted row', async () => {
  const [alpha, beta] = [await Store.addProject({ name: 'Alpha' }), await Store.addProject({ name: 'Beta' })];
  const { picker, search, host } = await mountPicker();
  const active = () => host.querySelector('.picker-row.active').textContent;
  assert.equal(active(), 'No project');
  press(search, 'ArrowDown');
  assert.equal(active(), 'Alpha');
  press(search, 'ArrowDown');
  assert.equal(active(), 'Beta');
  press(search, 'ArrowDown');
  assert.equal(active(), 'No project', 'wraps around');
  press(search, 'ArrowUp');
  press(search, 'Enter');
  await settle();
  assert.equal(picker.getValue(), beta.id);
  assert.notEqual(picker.getValue(), alpha.id);
});

test('picker: Enter and Escape stay inside the picker', async () => {
  const { reached, search, host, picker } = await mountPicker();
  type(search, 'Website', 'input');
  press(search, 'Enter');
  await settle();
  await picker.open();
  press(search, 'Escape');

  assert.deepEqual(reached, [], 'the surrounding dialog must not see these keys');
  assert.equal(host.querySelector('.picker-pop').hidden, true, 'Escape closes the list');
});

/* ================= entry editor: times =================================== */

test('editor shows the stored seconds', async () => {
  const ui = await openEditor(await seedEntry());
  assert.equal(ui.field('Start').value, '09:05:42');
  assert.equal(ui.field('End').value, '10:20:07');
  assert.equal(ui.field('Duration').value, '01:14:25');
});

test('opening and saving without changes keeps start and end exactly', async () => {
  const before = await seedEntry();
  const ui = await openEditor(before);
  await ui.save();

  assert.equal(ui.result().action, 'saved');
  const after = await onlyEntry();
  assert.equal(after.start, before.start);
  assert.equal(after.end, before.end);
});

test('changed seconds are still there after save and reopen', async () => {
  let ui = await openEditor(await seedEntry());
  type(ui.field('Start'), '09:05:13');
  type(ui.field('End'), '10:20:58');
  assert.equal(ui.field('Duration').value, '01:15:45');
  await ui.save();

  const saved = await onlyEntry();
  assert.equal(saved.start, at(9, 5, 13));
  assert.equal(saved.end, at(10, 20, 58));

  ui = await openEditor(saved);
  assert.equal(ui.field('Start').value, '09:05:13');
  assert.equal(ui.field('End').value, '10:20:58');
  await ui.save();
  const again = await onlyEntry();
  assert.equal(again.start, at(9, 5, 13));
  assert.equal(again.end, at(10, 20, 58));
});

test('typing a duration moves the end and keeps the seconds', async () => {
  const ui = await openEditor(await seedEntry());
  type(ui.field('Duration'), '0:30:10');
  assert.equal(ui.field('End').value, '09:35:52');
  await ui.save();

  const saved = await onlyEntry();
  assert.equal(saved.start, at(9, 5, 42));
  assert.equal(saved.end, at(9, 35, 52));
});

test('a duration that cannot be read is put back, nothing changes', async () => {
  const ui = await openEditor(await seedEntry());
  type(ui.field('Duration'), 'soon');
  assert.equal(ui.field('Duration').value, '01:14:25');
  assert.equal(ui.field('End').value, '10:20:07');
});

test('an end before the start means the entry runs past midnight', async () => {
  const ui = await openEditor(await seedEntry());
  type(ui.field('Start'), '23:30:00');
  type(ui.field('End'), '00:15:30');
  assert.equal(ui.field('Duration').value, '00:45:30');
  await ui.save();

  const saved = await onlyEntry();
  assert.equal(saved.start, at(23, 30, 0));
  assert.equal(saved.end, at(0, 15, 30, 2));
});

test('an entry with no length is refused and the dialog stays open', async () => {
  const before = await seedEntry();
  const ui = await openEditor(before);
  type(ui.field('End'), ui.field('Start').value);
  await ui.save();

  assert.equal(ui.isOpen(), true);
  assert.equal(ui.dialog.querySelector('.error').textContent, 'End must be after start.');
  assert.deepEqual(await onlyEntry(), before);
});

test('a new entry is stored with what was typed', async () => {
  const ui = await openEditor(null);
  type(ui.field('Description'), '  Plan sprint  ');
  type(ui.field('Date'), '2026-09-01');
  type(ui.field('Start'), '14:00:05');
  type(ui.field('End'), '14:45:50');
  type(ui.field('Tags'), 'planning, , team ');
  ui.field('Billable').checked = true;
  await ui.save();

  const saved = await onlyEntry();
  assert.equal(saved.description, 'Plan sprint');
  assert.equal(saved.start, at(14, 0, 5));
  assert.equal(saved.end, at(14, 45, 50));
  assert.deepEqual(saved.tags, ['planning', 'team']);
  assert.equal(saved.billable, true);
  assert.equal(saved.projectId, null);
});

test('a running entry keeps running; only its start is corrected', async () => {
  const start = Date.now() - 3600e3;
  const running = await Store.addEntry({ description: 'Live', start, end: null });
  const ui = await openEditor(running);
  assert.equal(ui.field('Started at').value, timeInput(start));
  type(ui.field('Description'), 'Live, renamed');
  await ui.save();

  const saved = await onlyEntry();
  assert.equal(saved.end, null);
  assert.equal(saved.start, Math.floor(start / 1000) * 1000, 'same second as before');
  assert.equal(saved.description, 'Live, renamed');
});

/* ================= entry editor: keys ==================================== */

test('Enter in the project search creates the project but does not save the entry', async () => {
  const before = await seedEntry();
  const ui = await openEditor(before);
  type(ui.field('Description'), 'Changed but not saved yet');
  ui.picker.button.click();
  await settle();
  type(ui.picker.search, 'Website', 'input');
  press(ui.picker.search, 'Enter');
  await settle();

  assert.equal(ui.isOpen(), true, 'the dialog must stay open');
  assert.ok(document.querySelector('.modal-backdrop'), 'the dialog is still on screen');
  assert.deepEqual(await onlyEntry(), before, 'the entry must not be written yet');
  const [project] = await Store.getProjects();
  assert.equal(project.name, 'Website');
  assert.equal(ui.picker.label.textContent, 'Website');

  await ui.save();
  const saved = await onlyEntry();
  assert.equal(saved.projectId, project.id);
  assert.equal(saved.description, 'Changed but not saved yet');
});

test('Escape in the project search closes the list, not the dialog', async () => {
  const ui = await openEditor(await seedEntry());
  ui.picker.button.click();
  await settle();
  press(ui.picker.search, 'Escape');
  await settle();

  assert.equal(ui.picker.pop.hidden, true);
  assert.equal(ui.isOpen(), true);
});

test('Enter in a text or time field saves the entry', async () => {
  for (const label of ['Description', 'Start', 'Tags']) {
    reset();
    await seedEntry();
    const ui = await openEditor(await onlyEntry());
    type(ui.field('Description'), `Saved from ${label}`);
    press(ui.field(label), 'Enter');
    await settle();
    assert.equal(ui.result()?.action, 'saved', `Enter in ${label}`);
    assert.equal((await onlyEntry()).description, `Saved from ${label}`);
  }
});

test('Enter on the Billable checkbox does not save', async () => {
  const ui = await openEditor(await seedEntry());
  press(ui.field('Billable'), 'Enter');
  await settle();
  assert.equal(ui.isOpen(), true);
});

test('Escape and Cancel close the dialog without saving', async () => {
  const before = await seedEntry();
  for (const leave of [(ui) => press(ui.field('Description'), 'Escape'), (ui) => ui.button('Cancel').click()]) {
    const ui = await openEditor(before);
    type(ui.field('Description'), 'Thrown away');
    leave(ui);
    await settle();
    assert.equal(ui.isOpen(), false);
    assert.equal(ui.result(), undefined);
    assert.equal(document.querySelector('.modal-backdrop'), null);
    assert.deepEqual(await onlyEntry(), before);
  }
});

test('Delete needs a second click', async () => {
  const ui = await openEditor(await seedEntry());
  ui.button('Delete').click();
  await settle();
  assert.equal(ui.isOpen(), true);
  assert.equal((await Store.getEntries()).length, 1);

  ui.button('Click again to delete').click();
  await settle();
  assert.equal(ui.result().action, 'deleted');
  assert.equal((await Store.getEntries()).length, 0);
});

/* ================= recent values ========================================= */

const past = (hoursAgo, description, over = {}) => ({
  description, projectId: null, tags: [], start: at(12, 0, 0) - hoursAgo * 3600e3,
  end: at(12, 30, 0) - hoursAgo * 3600e3, ...over,
});

test('recent descriptions: newest first, each one once', () => {
  const entries = [
    past(5, 'Write report', { projectId: 'old' }),
    past(1, 'Review PR'),
    past(2, 'write report', { projectId: 'new' }),
    past(3, ''),
  ];
  assert.deepEqual(recentDescriptions(entries), [
    { description: 'Review PR', projectId: null },
    { description: 'write report', projectId: 'new' },
  ]);
});

test('recent descriptions: matches that start with the text come first', () => {
  const entries = [past(1, 'Fix report export'), past(2, 'Report for Acme'), past(3, 'Standup')];
  assert.deepEqual(recentDescriptions(entries, 'rep').map((d) => d.description),
    ['Report for Acme', 'Fix report export']);
});

test('recent descriptions: what is already typed is not offered, and the list is short', () => {
  const entries = Array.from({ length: 20 }, (_, i) => past(i, `Task ${i}`));
  assert.equal(recentDescriptions(entries, 'Task').length, 6);
  assert.ok(!recentDescriptions(entries, 'Task 3').some((d) => d.description === 'Task 3'));
});

test('an archived project is not offered with a description', () => {
  const projects = new Map([
    ['a', { id: 'a', name: 'Active', color: '#4f8ef7', archived: false }],
    ['z', { id: 'z', name: 'Closed', color: '#4f8ef7', archived: true }],
  ]);
  const rows = descriptionRows(
    [past(1, 'One', { projectId: 'a' }), past(2, 'Two', { projectId: 'z' })], projects, '');
  assert.deepEqual(rows.map((r) => [r.label, r.hint, r.projectId]),
    [['One', 'Active', 'a'], ['Two', '', null]]);
});

test('recent tags: match the tag being typed, skip the ones already there', () => {
  const entries = [
    past(1, 'a', { tags: ['planning', 'team'] }),
    past(2, 'b', { tags: ['Planning', 'travel', 'plan-b'] }),
  ];
  assert.deepEqual(recentTags(entries, ''), ['planning', 'team', 'travel', 'plan-b']);
  assert.deepEqual(recentTags(entries, 'pl'), ['planning', 'plan-b']);
  assert.deepEqual(recentTags(entries, 'Planning, t'), ['team', 'travel']);
  assert.deepEqual(recentTags(entries, 'team, travel, '), ['planning', 'plan-b']);
});

test('applyTag replaces the tag being typed and keeps the others', () => {
  assert.equal(applyTag('pl', 'planning'), 'planning, ');
  assert.equal(applyTag('team ,  tr', 'travel'), 'team, travel, ');
});

/* ================= entry editor: suggestions ============================= */

const suggestions = (input) => {
  const list = input.parentNode.querySelector('.suggest-pop');
  return list.hidden ? null : list.querySelectorAll('.suggest-row').map((r) => r.textContent);
};
const typeInto = async (input, value) => {
  input.focus();
  type(input, value, 'input');
  await settle();
};

/** Two past entries in project "Website", plus a new entry being added. */
async function openEditorWithHistory() {
  const website = await Store.addProject({ name: 'Website' });
  await Store.addEntry({
    description: 'Write report', projectId: website.id, tags: ['writing', 'client'],
    start: at(9, 0, 0), end: at(10, 0, 0),
  });
  await Store.addEntry({
    description: 'Weekly review', projectId: null, tags: ['planning'],
    start: at(11, 0, 0), end: at(12, 0, 0),
  });
  return { website, ui: await openEditor(null) };
}

test('typing a description lists recent ones, with their project', async () => {
  const { ui } = await openEditorWithHistory();
  const desc = ui.field('Description');
  assert.equal(suggestions(desc), null, 'nothing is shown before typing');
  await typeInto(desc, 'w');
  assert.deepEqual(suggestions(desc), ['Weekly review', 'Write reportWebsite']);
  await typeInto(desc, 'wr');
  assert.deepEqual(suggestions(desc), ['Write reportWebsite']);
  await typeInto(desc, 'nothing like this');
  assert.equal(suggestions(desc), null);
});

test('ArrowDown then Enter takes the suggestion and its project, without saving', async () => {
  const { ui, website } = await openEditorWithHistory();
  const desc = ui.field('Description');
  await typeInto(desc, 'wr');
  press(desc, 'ArrowDown');
  press(desc, 'Enter');
  await settle();

  assert.equal(desc.value, 'Write report');
  assert.equal(ui.picker.label.textContent, 'Website');
  assert.equal(suggestions(desc), null);
  assert.equal(ui.isOpen(), true, 'the dialog must stay open');
  assert.equal((await Store.getEntries()).length, 2, 'nothing saved yet');

  await ui.save();
  const [saved] = (await Store.getEntries()).filter((e) => e.start !== at(9, 0, 0) && e.start !== at(11, 0, 0));
  assert.equal(saved.description, 'Write report');
  assert.equal(saved.projectId, website.id);
});

test('Enter with no suggestion highlighted saves what was typed', async () => {
  const { ui } = await openEditorWithHistory();
  const desc = ui.field('Description');
  await typeInto(desc, 'wr');
  press(desc, 'Enter');
  await settle();

  assert.equal(ui.result()?.action, 'saved');
  assert.equal(ui.result().entry.description, 'wr');
});

test('a suggestion does not replace a project that is already chosen', async () => {
  const { ui } = await openEditorWithHistory();
  const other = await Store.addProject({ name: 'Internal' });
  ui.picker.button.click();
  await settle();
  type(ui.picker.search, 'Internal', 'input');
  press(ui.picker.search, 'Enter');
  await settle();

  const desc = ui.field('Description');
  await typeInto(desc, 'wr');
  press(desc, 'ArrowDown');
  press(desc, 'Enter');
  await settle();
  await ui.save();
  assert.equal(ui.result().entry.description, 'Write report');
  assert.equal(ui.result().entry.projectId, other.id);
});

test('clicking a suggestion takes it', async () => {
  const { ui } = await openEditorWithHistory();
  const desc = ui.field('Description');
  await typeInto(desc, 'week');
  desc.parentNode.querySelector('.suggest-row').dispatchEvent(new Event('mousedown'));
  assert.equal(desc.value, 'Weekly review');
  assert.equal(suggestions(desc), null);
});

test('Escape closes the suggestions first, the dialog only after that', async () => {
  const { ui } = await openEditorWithHistory();
  const desc = ui.field('Description');
  await typeInto(desc, 'wr');
  press(desc, 'Escape');
  assert.equal(suggestions(desc), null);
  assert.equal(ui.isOpen(), true);
  press(desc, 'Escape');
  await settle();
  assert.equal(ui.isOpen(), false);
});

test('ArrowDown in an empty field lists the recent values', async () => {
  const { ui } = await openEditorWithHistory();
  const desc = ui.field('Description');
  desc.focus();
  press(desc, 'ArrowDown');
  await settle();
  assert.deepEqual(suggestions(desc), ['Weekly review', 'Write reportWebsite']);
  press(desc, 'Enter');
  assert.equal(desc.value, 'Weekly review', 'the first row was highlighted');
});

test('leaving the field closes the suggestions', async () => {
  const { ui } = await openEditorWithHistory();
  const desc = ui.field('Description');
  await typeInto(desc, 'w');
  ui.field('Tags').focus();
  assert.equal(suggestions(desc), null);
});

test('tags: suggestions complete the tag being typed and keep the earlier ones', async () => {
  const { ui } = await openEditorWithHistory();
  const tags = ui.field('Tags');
  await typeInto(tags, 'planning, wr');
  assert.deepEqual(suggestions(tags), ['writing']);
  press(tags, 'ArrowDown');
  press(tags, 'Enter');
  assert.equal(tags.value, 'planning, writing, ');
  assert.equal(ui.isOpen(), true);

  await typeInto(tags, 'planning, writing, c');
  assert.deepEqual(suggestions(tags), ['client']);
  type(ui.field('Start'), '14:00:00');
  type(ui.field('End'), '15:00:00');
  await ui.save();
  assert.deepEqual(ui.result().entry.tags, ['planning', 'writing', 'c']);
});

/* ---- run ---------------------------------------------------------------- */

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  installDom();
}

for (const [name, fn] of tests) {
  reset();
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('  FAIL ' + name + '\n       ' + err.message);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} editor tests passed`);
