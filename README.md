# TimIt — local time tracker for Brave / Chrome

A simple time tracker that runs entirely inside your browser profile.
No account, no server, no network requests — the extension has zero host
permissions, so it *cannot* talk to the internet even if it wanted to.

**Help wanted!** TimIt is a small side project and there is a lot that could be
better. If you use it and want to improve it, you are very welcome — see
[Contributing](#contributing).

## Features

- Start and stop a timer from the toolbar popup or with `Alt+Shift+T`.
- Projects, clients, tags and billable flags; create a project just by typing its name.
- A dashboard with all entries, reports with charts, and project management.
- Ready-made task descriptions from the page you are on (GitHub, GitLab, Jira, Linear, …).
- CSV import and export that other time trackers understand, plus full JSON backups.
- Optional sync of each project to a CSV file, so the timesheet can live in git next to the code.
- Light and dark theme. No build step and no dependencies.

## Install (unpacked)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode** (top right).
3. Download this repository (`git clone https://github.com/petrceska/timit.git`,
   or **Code → Download ZIP** on GitHub and unzip it).
4. Click **Load unpacked** and pick the `timit/` folder.
5. Pin TimIt to the toolbar.

Updating the code later: hit the ↻ reload button on the extension card.

## Using it

**Popup** (toolbar icon) — the quick surface: type what you're doing, pick a
project, hit Start. The badge shows elapsed time; `Alt+Shift+T` starts/stops
without opening anything. Recent entries are listed with a ▶ button to restart
the same task.

**Dashboard** (button in the popup, or the extension's Options page) — four tabs:

- **Entries** — everything you've tracked, grouped by day with daily totals.
  Filter by date range, project or text; select rows for bulk move/export/delete;
  add entries by hand for work done offline.
- **Reports** — totals, days tracked, average per day, billable share, a bar
  chart per day, a donut + table per project, and your top activities.
- **Projects** — full CRUD plus per-project [file sync](#syncing-a-project-to-a-file-for-git):
  create, rename, recolour, set a client, archive
  (hides it from pickers without touching history), delete. Deleting a project
  that has entries asks whether to move them elsewhere or leave them
  project-less. Each project shows time tracked, entry count, share and last use.
- **Import / Export** — CSV and JSON, plus settings.

**Projects while tracking** — click the project box and start typing. The list
filters as you type; if the name doesn't exist yet, pick **Create "…"** and it's
created and selected in one step. Arrow keys + Enter work throughout.

**Click any entry to edit it** — in the dashboard list or in the popup's recent
list. The dialog is the same one used to add an entry, pre-filled with
description, project, date, start, end, duration, tags and billable; **Save**
keeps the changes, **Cancel** discards them, **Delete** removes the entry (it
asks for a second click to confirm). The checkbox and the row's own ▶ / ✎ / 🗑
buttons keep working as before. Clicking the entry that's currently running opens
the same dialog without the end time — you can fix its start, description or
project and it keeps running.

**Links** — every entry can carry a link to the task or page you worked on.
Paste it into the *Link* box under the description (in the popup, the dashboard
bar or the entry dialog); `github.com/acme/shop/pull/7` is fine, `https://` is
added for you. In lists the link shows only as a 🌐 icon, which opens it in a
new tab. When a timer starts from a page suggestion, the page's address is put
in the link for you, unless you already set one. Only `http` and `https`
addresses are kept — anything else is refused, wherever it comes from (a typed
value, a backup file), so a link can never run code. Links are kept in JSON
backups and in synced project files (the `Link` column), but not in the
CSV export, whose columns are fixed.

**Durations** are editable in the entry dialog — type `1:30`, `90m`, `1.5` or
`2h15m` and the end time follows.

**Suggestions from the current tab** — open the popup on an issue, a pull
request, a ticket or a file, and up to three ready-made descriptions appear under
the text box, each labelled with where it came from and, when one fits, the
project it belongs to. The best one is also shown greyed out in the empty text
box: press **Start** (or Enter) without typing and the timer starts with it, in
its project if you haven't picked one. Press Tab to put it in the box and change
it first, click another suggestion (or ↓, then Enter) to use that one instead, or
just type your own. `Alt+Shift+T` does the same without opening the popup: it
starts the timer on the best suggestion for the tab you pressed it on.

| On | Suggests |
|---|---|
| a GitHub / GitLab / Bitbucket issue, PR or MR | `timit#42 Add dark mode`, `shop!7 Checkout rework` |
| a branch — PR header, tree/file URL, compare view | `feature/PAY-12-retry-refunds` → `PAY-12 Retry refunds`, `42-dark-mode` → `timit#42 Dark mode` |
| Jira, Linear, Azure DevOps | `PAY-311 Refund fails for split payments`, `#1234 VAT rounding` |
| a file on GitHub/GitLab, vscode.dev, github.dev, Codespaces | `store.js (timit)` |
| anything else | text you've selected, then the page title minus the site's name (`Q3 roadmap - Google Docs` → `Q3 roadmap`), then the heading |

The project is picked from what you've already tracked, in this order: an entry
that mentions this exact ticket or issue; a project named after the repository or
the ticket prefix (`PAY`); wherever earlier tickets of that series, or earlier
work in that repository, went; a project or client named after the repository
owner or the site's subdomain (`acme.atlassian.net` → client *Acme*); a project
whose name contains the repository's. Archived projects are never picked, and a
page can't create one — if nothing fits, the project box is left as it was.

**How the tab is read.** TimIt still has no host permissions. `activeTab` hands
it the current tab only at the moment you click the icon or press the shortcut,
and `scripting` runs one small function there, in the browser's isolated world,
that copies the URL, the title, the first visible `<h1>`, two meta tags, the PR
branch and your selection — nothing else. Nothing runs on pages you merely visit,
nothing is sent anywhere, and nothing about the page is kept unless you use a
suggestion. Page text is clipped and stripped of control and bidi characters
before it's shown. Browser pages (`chrome://`, `brave://`, the Web Store, the PDF
viewer) are off-limits to every extension, so the popup shows no suggestions
there; desktop editors aren't browser tabs, so they're out of reach too. Turn the
whole thing off under *Import / Export → Settings*.

## CSV format

Export uses a common *detailed report* column layout:

```
Project, Client, Description, Task, User, Group, Email, Tags, Billable,
Start Date, Start Time, End Date, End Time, Duration (h), Duration (decimal)
```

That file imports into Toggl / Harvest / most other
trackers through their column-mapping step. Set your name and email under
*Import / Export → Settings* if the target tool requires those columns to be
filled. Dates are `MM/DD/YYYY` (US style) or ISO `YYYY-MM-DD` — your
choice in settings; the same setting decides how ambiguous dates are read on
import.

Import accepts that layout and anything close to it: headers are matched
case-insensitively with common aliases (`Date`, `Notes`, `Hours`, …), quoted
fields and embedded commas are handled, `AM/PM` and 24-hour times both work, and
a row with no end time is accepted if it has a duration. Missing projects are
created automatically, and duplicate rows (same start + project + description)
are skipped by default. Rows that can't be read are reported instead of being
silently dropped.

**JSON backup** round-trips everything including project colours and settings —
use it for real backups, and CSV for talking to other tools.

**Spreadsheet safety.** A cell that begins with `=`, `+`, `-`, `@` or a tab is
executed as a formula by Excel, Sheets and LibreOffice, so an entry described as
`=HYPERLINK("http://…")` would run when someone opened the file. TimIt prefixes
those cells with `'` on the way out and strips it on the way back in, so its own
round-trips are lossless and a committed timesheet is inert for whoever opens it.
Text that doesn't start with one of those characters is untouched.

## Syncing a project to a file (for git)

> **Brave users: turn on file access first.** Brave ships with the File System
> Access API disabled, so no extension or site can be handed a file — the sync
> dialog will tell you so and stay greyed out. Paste `brave://flags/#file-system-access-api`
> into the address bar (Brave blocks links to its own settings pages), set
> **File System Access API** to *Enabled*, and relaunch. Chrome and Edge have it
> on already.


Each project can point at a CSV file on disk — put it inside that project's own
repo and git carries the timesheet along with the code. Set it up in
**Projects → File sync → Sync to file…**: type the file name you want, then
**Create file…** to make it, or **Pick existing file…** to link one that's
already in the repo.

The ⓘ beside the **File sync** heading — and beside each project's own button —
explains what the feature does without leaving the table: hover it, focus it with
the keyboard, or tap it on a touchscreen. The same text heads the setup dialog,
so there's one description to keep true.

**You can't type the folder path into TimIt** — no extension can. Chromium only
grants write access to a file the user chose in the browser's own file dialog, so
the folder is picked there. The name you type is what that dialog opens with, and
inside it you can jump straight to a path: **⌘⇧G** on macOS, or paste the path
into the *File name* box on Windows/Linux. TimIt remembers the last folder you
used, so the second project starts next to the first.

If the dialog doesn't open, the setup dialog names the reason: either the flag
above is off, or the dashboard is running embedded inside `brave://extensions`,
where file dialogs are blocked — open it in its own tab with the **Dashboard**
button in the popup. (The manifest now asks for a real tab, so the second case
shouldn't happen once the extension is reloaded.)

The file is rewritten when time changes: the timer **stops**, an entry is edited,
added, imported or deleted, or the project is renamed. **Starting a timer writes
nothing** — running entries never reach the file.

**How rows are identified.** Every row carries the entry's id in the first
column, which makes the add/change/remove question exact rather than heuristic:

| Situation | What happens to the file |
|---|---|
| id in file, entry exists locally, fields differ | that row is **updated** in place |
| entry exists locally, no row for it | row **added** |
| id in file, entry gone locally, we wrote that row last time | row **removed** |
| id in file, entry not local, we never wrote it | **left alone** — it came from another machine via git |
| row with no id that matches a local entry's start/end/description | **adopted** (gets the id, no duplicate) |
| row with no id matching nothing | kept as-is |

The last two rules are the safety net: TimIt only ever deletes rows it knows it
wrote itself, so pulling a colleague's rows — or your own from another computer —
can't make them disappear on the next sync. Rows kept that way are counted under
the file name in the Projects tab.

The file is sorted by start time with LF endings and is only written when the
bytes actually change, so git diffs stay small and a no-op sync doesn't touch the
mtime. Columns are the export columns plus `ID` first and `Link` last, dates
always ISO (`YYYY-MM-DD`) regardless of your CSV setting.

`node test/merge.test.mjs` runs the decision procedure against all of the cases
above.

### What to expect from the browser

Two limits come from Chrome/Brave, not from TimIt:

- **Sync runs while an extension page is open** — the popup or the dashboard.
  A service worker can't touch the file system. If you stop the timer with the
  keyboard shortcut and never open either, the file is written the next time you
  do; nothing is lost, it's just later. Stopping from the popup writes before the
  popup closes.
- **After a browser restart Brave asks again** for permission to write each file.
  The Projects tab shows a "Reconnect" banner, and the popup shows a one-line
  warning; one click per file restores it. Permission prompts need a real click,
  so this can't be done silently.

If a file goes missing (a fresh clone, `git clean`), it's recreated on the next
sync. If a file exists but has no `Start Date` column, TimIt refuses to touch it
rather than overwrite something that isn't a timesheet.

Deleting a project, or "Delete all data", only unlinks the files — what's on disk
stays.

## Tests

No framework, no dependencies — plain Node:

```bash
node test/merge.test.mjs && node test/injection.test.mjs && node test/context.test.mjs && node test/editor.test.mjs
```

- **`merge.test.mjs`** (19) pins the sync decision procedure: what counts as
  added, updated, removed, adopted or foreign.
- **`context.test.mjs`** (21) pins what each kind of page suggests — issues,
  PRs, MRs, tickets, branches, files, plain titles — which project gets picked and
  in what order, and that `readPage` still works once serialised the way
  `chrome.scripting` ships it.
- **`editor.test.mjs`** (38) fills in the add / edit entry dialog the way a
  person does — typing, pressing keys, clicking — and checks what gets stored:
  seconds survive save and reopen, a typed duration moves the end, Enter and
  Escape in the project picker stay in the picker, and Enter elsewhere saves.
  It also pins the suggestions for descriptions and tags: which recent values
  are offered, and that choosing one never saves the entry by accident.
  It runs on a small DOM stand-in (`test/helpers/dom.mjs`), not a real browser,
  so it checks behaviour, not layout.
- **`injection.test.mjs`** (26) covers input TimIt doesn't control — typed
  descriptions, imported CSVs, JSON backups, sync files edited by hand or pulled
  from git, web pages read for suggestions — and asserts none of it can escape
  the slot it belongs in:
  - **CSV structure** — a description containing quotes or newlines can't forge
    an extra row, an extra column, or another entry's id; a tampered file can't
    delete rows we own; an imported file can't choose entry ids.
  - **Spreadsheet formulas** — formula-leading cells are neutralised in exports
    and in sync files, stay stable across repeated syncs, and read back as the
    original text.
  - **DOM** — a static scan of `src/`: `innerHTML` may only be assigned a literal
    with no interpolation, no `insertAdjacentHTML`/`outerHTML`/`document.write`,
    no `eval`/`new Function`, and `el()` exposes no markup option.
  - **Storage** — only real hex colours can reach an inline style (they end up in
    `style="…"`), and a hostile backup can't pollute `Object.prototype`, smuggle
    unknown fields, store a string where a timestamp belongs, or leave entries
    pointing at projects that don't exist.
  - **Manifest** — permissions stay `storage`, `alarms`, `activeTab` and
    `scripting`, with no host permissions, `tabs`, content scripts,
    web-accessible resources, weakened CSP, remote `<script>`/`<link>`, inline
    scripts, or any network API in the source.
  - **Page context** — `chrome.scripting` is used in one place, as a one-off
    `executeScript` of TimIt's own `readPage` (no files, no main world, no
    frames), and `readPage` only reads. Page text comes back clipped, without
    control or bidi characters, never coerced from non-strings, and can't pick a
    project — let alone an archived one.

Each protection was mutation-tested: removing the escaping, loosening the colour
check, restoring the raw backup import, putting the colour back into markup, or
adding `<all_urls>` to the manifest each make the suite fail — and so do adding
`tabs`, injecting into the main world or into all frames, letting `readPage`
message the extension, dropping the control-character stripping or the length
cap, coercing non-string page fields, allowing archived projects, or letting
`timit#4` match an entry about `timit#42`.

## Data & privacy

Everything is stored in `chrome.storage.local`, inside this browser profile on
this machine. Nothing syncs. Two consequences worth knowing:

- Removing the extension, or wiping browser data for it, deletes your history.
  Take a JSON backup now and then.
- Another Brave profile, or another computer, has its own separate data. Move
  it with a JSON backup.

The tab you're on is read only when you open the popup or press the shortcut,
and what's read is gone when the popup closes — only a suggestion you actually
use ends up in an entry.

## Layout

```
manifest.json          MV3 manifest — permissions: storage, alarms, activeTab, scripting
src/background.js      service worker: badge, timer keep-alive, shortcut
src/popup/             toolbar popup
src/dashboard/         full-page UI (Options page)
  views/               one module per tab
src/lib/
  store.js             storage layer + all data mutations
  time.js              duration/date formatting and parsing
  csv.js               CSV export & tolerant import
  picker.js            type-to-filter / type-to-create project combobox
  charts.js            canvas bar + donut charts (no dependencies)
  sync.js              per-project file sync: merge rules + engine
  fsdb.js              IndexedDB store for file handles & permissions
  range.js             date-range control
  entry-editor.js      add/edit entry dialog
  suggest.js           suggestion list under a text input
  recent.js            recent descriptions and tags to suggest
  ui.js                el(), modal(), toast()
  theme.css            design tokens, light + dark
test/merge.test.mjs    sync merge rules
test/injection.test.mjs  injection regressions (CSV, DOM, storage, manifest)
test/context.test.mjs  task suggestions from the current tab
test/editor.test.mjs   entry dialog, project picker, time helpers
test/helpers/dom.mjs   small DOM stand-in for the editor tests
```

No build step, no dependencies — the source is what runs.

## Contributing

Contributions of any size are welcome: bug reports, ideas, better texts,
design fixes, new features or more tests.

1. **Report a bug or suggest an idea** — open an
   [issue](https://github.com/petrceska/timit/issues). For a bug, write what you
   did, what you expected, what happened, and your browser and its version.
2. **Change the code** — fork the repository, make your change on a new branch,
   run the [tests](#tests), and open a pull request. Please explain what the
   change does and why. For bigger changes, open an issue first, so we can agree
   on the idea before you spend time on it.

A few rules keep TimIt what it is:

- **No network access.** The extension must not get host permissions or send
  data anywhere. `test/injection.test.mjs` checks this.
- **No dependencies and no build step.** The source is what runs.
- **Untrusted input stays safe.** Page text, imported files and backups must
  never be able to run code. Add a test to `test/injection.test.mjs` when you
  touch this area.

## Contact

Do you want to help with TimIt more regularly, or talk about an idea first?
Open an [issue](https://github.com/petrceska/timit/issues) or contact me through
my GitHub profile: [@petrceska](https://github.com/petrceska).

## License

Copyright (c) 2026 petrceska

TimIt is free software: you can redistribute it and/or modify it under the
terms of the GNU Lesser General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. See [COPYING.LESSER](COPYING.LESSER) and [COPYING](COPYING)
(the GNU General Public License, which the LGPL builds on).

In short:

- **You may** use, copy, study, change and share TimIt for any purpose,
  including commercial use.
- **If you share a changed version** of TimIt itself, you must publish the
  source of your changes under the LGPLv3 too, and keep the copyright and
  license notices.
- **Larger works** that only use TimIt's code as a library, without changing
  it, may use any license.

By contributing, you agree that your contribution is released under the same
license.
