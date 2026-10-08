/**
 * Page context: what the popup suggests for a tab, and which project it files
 * the suggestion under. A page is the plain object `readPage` returns, so no
 * browser is needed.
 *
 * Run: node test/context.test.mjs
 */
import assert from 'node:assert/strict';

const { suggestTasks, readPage, describeBranch, MAX_SUGGESTIONS } =
  await import(new URL('../src/lib/context.js', import.meta.url));

/* ---- harness ------------------------------------------------------------ */

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const projects = [
  { id: 'timit', name: 'TimIt', client: '', archived: false },
  { id: 'shop', name: 'Shop', client: 'Acme', archived: false },
  { id: 'pay', name: 'Payments', client: 'Acme', archived: false },
  { id: 'old', name: 'Legacy', client: '', archived: true },
];
const T0 = new Date(2026, 8, 1, 9).getTime();
let n = 0;
const entry = (description, projectId) => {
  n++;
  return { id: `e${n}`, description, projectId, start: T0 - n * 3600e3, end: T0 - n * 3600e3 + 1800e3 };
};
const page = (over) => ({
  url: '', title: '', heading: '', ogTitle: '', siteName: '', branch: '', selection: '', ...over,
});
const suggest = (over, ctx = {}) => suggestTasks(page(over), { projects, ...ctx });
const pairs = (list) => list.map((s) => [s.source, s.description]);

/* ================= code hosts ============================================ */

test('GitHub issue → repo#number and its title, under the repo\'s project', () => {
  const [s, ...more] = suggest({
    url: 'https://github.com/octocat/timit/issues/42',
    title: 'Add dark mode · Issue #42 · octocat/timit · GitHub',
  });
  assert.deepEqual(s, { description: 'timit#42 Add dark mode', source: 'Issue', projectId: 'timit' });
  assert.equal(more.length, 0);
});

test('GitHub pull request → title without the author, plus its branch', () => {
  const list = suggest({
    url: 'https://github.com/octocat/timit/pull/12/files',
    title: 'Keep stand by mode by octocat · Pull Request #12 · octocat/timit · GitHub',
    branch: 'octocat:feature/PAY-7-retry-refunds',
  });
  assert.deepEqual(pairs(list), [
    ['Pull request', 'timit#12 Keep stand by mode'],
    ['Branch', 'PAY-7 Retry refunds'],
  ]);
});

test('GitHub file on a branch with slashes → file and branch', () => {
  const list = suggest({
    url: 'https://github.com/octocat/timit/blob/feature/login-form/src/lib/store.js',
    title: 'timit/src/lib/store.js at feature/login-form · octocat/timit · GitHub',
  });
  assert.deepEqual(pairs(list), [['File', 'store.js (timit)'], ['Branch', 'Login form']]);
  assert.ok(list.every((s) => s.projectId === 'timit'));
});

test('a branch created from an issue reads as that issue', () => {
  const list = suggest({
    url: 'https://github.com/octocat/timit/tree/42-add-dark-mode',
    title: 'octocat/timit at 42-add-dark-mode · GitHub',
  });
  assert.deepEqual(pairs(list), [['Branch', 'timit#42 Add dark mode']]);
});

test('the default branch says nothing, so the repository is offered', () => {
  const list = suggest({
    url: 'https://github.com/octocat/timit/tree/main',
    title: 'octocat/timit at main · GitHub',
  });
  assert.deepEqual(pairs(list), [['Repository', 'timit']]);
});

test('GitLab merge request and file on a branch', () => {
  const [mr] = suggest({
    url: 'https://gitlab.com/acme/web/shop/-/merge_requests/7',
    title: 'Checkout rework (!7) · Merge requests · acme / web / shop · GitLab',
  });
  assert.deepEqual(mr, { description: 'shop!7 Checkout rework', source: 'Merge request', projectId: 'shop' });

  const list = suggest({
    url: 'https://gitlab.com/acme/shop/-/blob/fix/SHOP-31-vat-rounding/app/cart.rb',
    title: 'cart.rb · fix/SHOP-31-vat-rounding · acme / shop · GitLab',
  });
  assert.deepEqual(pairs(list), [['File', 'cart.rb (shop)'], ['Branch', 'SHOP-31 Vat rounding']]);
});

test('Azure DevOps work item', () => {
  const [s] = suggest({
    url: 'https://dev.azure.com/acme/Shop/_workitems/edit/1234',
    title: 'Bug 1234: VAT rounding - on totals - Boards',
  });
  assert.deepEqual(s, { description: '#1234 VAT rounding - on totals', source: 'Work item', projectId: 'shop' });
});

test('web editors: the open file and its workspace', () => {
  const [s] = suggest({
    url: 'https://vscode.dev/github/octocat/timit',
    title: '● store.js — timit [Codespaces] — Visual Studio Code',
  });
  assert.deepEqual(s, { description: 'store.js (timit)', source: 'File', projectId: 'timit' });
});

/* ================= trackers ============================================== */

test('Jira ticket, filed where earlier tickets of that series went', () => {
  const [s] = suggest({
    url: 'https://acme.atlassian.net/browse/PAY-311',
    title: '[PAY-311] Refund fails for split payments - Jira',
  }, { entries: [entry('PAY-290 Webhook signatures', 'pay')] });
  assert.deepEqual(s, {
    description: 'PAY-311 Refund fails for split payments', source: 'Ticket', projectId: 'pay',
  });
});

test('Linear issue, with the URL slug when the title is missing', () => {
  const url = 'https://linear.app/acme/issue/ENG-88/flaky-login-test';
  assert.equal(suggest({ url, title: 'ENG-88 Flaky login test' })[0].description, 'ENG-88 Flaky login test');
  assert.equal(suggest({ url, title: '' })[0].description, 'ENG-88 Flaky login test');
});

test('branch names: ticket keys, prefixes and things that only look like keys', () => {
  assert.equal(describeBranch('users/jan/eng-12-fix-login')?.description, 'ENG-12 Fix login');
  assert.equal(describeBranch('7-typo', 'docs')?.description, 'docs#7 Typo');
  assert.equal(describeBranch('feature/utf-8-cleanup')?.description, 'Utf 8 cleanup');
  assert.equal(describeBranch('main'), null);
  assert.equal(describeBranch('feature'), null);
  assert.equal(describeBranch('a1b2c3d4'), null, 'a commit sha is not a task');
});

/* ================= any other page ======================================== */

test('the part of the title the heading agrees with, without the site name', () => {
  const list = suggest({
    url: 'https://stackoverflow.com/questions/1/how-do-i-debounce',
    title: 'javascript - How do I debounce input? - Stack Overflow',
    heading: 'How do I debounce input?',
  });
  assert.deepEqual(pairs(list), [['Page', 'How do I debounce input?']]);
  assert.deepEqual(pairs(suggest({
    url: 'https://docs.google.com/document/d/abc/edit', title: 'Q3 roadmap - Google Docs',
  })), [['Page', 'Q3 roadmap']]);
});

test('selected text comes first', () => {
  const list = suggest({
    url: 'https://docs.google.com/document/d/abc/edit',
    title: 'Q3 roadmap - Google Docs',
    selection: 'Draft the pricing section',
  });
  assert.deepEqual(pairs(list), [['Selection', 'Draft the pricing section'], ['Page', 'Q3 roadmap']]);
});

test('a page that only names its site suggests nothing', () => {
  assert.deepEqual(suggest({ url: 'https://github.com/', title: 'GitHub' }), []);
  assert.deepEqual(suggestTasks(null), []);
  assert.deepEqual(suggestTasks(page({ title: '   ' })), []);
});

test('never more than MAX_SUGGESTIONS', () => {
  const list = suggest({
    url: 'https://github.com/octocat/timit/pull/12',
    title: 'Keep stand by mode by octocat · Pull Request #12 · octocat/timit · GitHub',
    branch: 'feature/PAY-7-retry', selection: 'something else entirely',
  });
  assert.equal(list.length, MAX_SUGGESTIONS);
});

/* ================= choosing a project ==================================== */

test('the same ticket tracked before beats a project named after the repo', () => {
  const [s] = suggest({
    url: 'https://github.com/octocat/timit/issues/42',
    title: 'Add dark mode · Issue #42 · octocat/timit · GitHub',
  }, { entries: [entry('timit#42 first look', 'shop')] });
  assert.equal(s.projectId, 'shop');
});

const issue4 = {
  url: 'https://github.com/nobody/unknown/issues/4',
  title: 'X · Issue #4 · nobody/unknown · GitHub',
};

test('an issue reference matches exactly: #4 is not #42', () => {
  const entries = [entry('unknown#42 newer, other issue', 'pay'), entry('unknown#4 this one', 'shop')];
  assert.equal(suggest(issue4, { entries })[0].projectId, 'shop');
});

test('earlier work in the same repository is the next best signal', () => {
  assert.equal(suggest(issue4, { entries: [entry('unknown#42 other', 'pay')] })[0].projectId, 'pay');
  assert.equal(suggest(issue4, { entries: [entry('unknownish#42 other', 'pay')] })[0].projectId, null,
    'a repository whose name merely starts the same is someone else\'s');
});

test('the site or repository owner can match a client', () => {
  const [s] = suggest({
    url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/1/Runbook',
    title: 'Runbook - Engineering - Confluence',
  });
  assert.deepEqual([s.source, s.description], ['Page', 'Runbook']);
  assert.ok(['shop', 'pay'].includes(s.projectId));
});

test('names that contain one another match; archived projects never do', () => {
  const [s] = suggestTasks(page({
    url: 'https://github.com/octocat/timit', title: 'octocat/timit: local time tracker',
  }), { projects: [{ id: 'x', name: 'TimIt Extension', client: '' }] });
  assert.equal(s.projectId, 'x');

  const [legacy] = suggest({
    url: 'https://github.com/nobody/legacy/issues/3', title: 'X · Issue #3 · nobody/legacy · GitHub',
  }, { entries: [entry('legacy#3 before archiving', 'old')] });
  assert.equal(legacy.projectId, null);
});

/* ================= readPage ============================================== */

test('readPage still works once serialised, and reads only visible, bounded text', () => {
  // chrome.scripting ships the function's source, not the closure.
  const fn = new Function(`return (${readPage.toString()})`)();
  const metas = {
    'meta[property="og:title"]': 'OG title',
    'meta[property="og:site_name"]': 'Site',
  };
  globalThis.document = {
    title: 'x'.repeat(5000),
    querySelector: (sel) => (sel in metas ? { getAttribute: () => metas[sel] } : null),
    querySelectorAll: (sel) => (sel === 'h1'
      ? [
          { textContent: 'Hidden', getClientRects: () => [] },
          { textContent: '  Visible \n heading ', getClientRects: () => [{}] },
        ]
      : []),
  };
  globalThis.location = { href: 'https://example.com/a' };
  globalThis.window = { getSelection: () => ({ toString: () => 'picked text' }) };
  try {
    assert.deepEqual(fn(300, 2000), {
      url: 'https://example.com/a',
      title: 'x'.repeat(300),
      heading: 'Visible heading',
      ogTitle: 'OG title',
      siteName: 'Site',
      branch: '',
      selection: 'picked text',
    });
  } finally {
    delete globalThis.document;
    delete globalThis.location;
    delete globalThis.window;
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
console.log(`\n${passed}/${tests.length} context tests passed`);
