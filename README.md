# TimIt — local time tracker for Brave / Chrome

A Clockify-style time tracker that runs entirely inside your browser profile.
No account, no server, no network requests — the extension has zero host
permissions, so it *cannot* talk to the internet even if it wanted to.

## Install (unpacked)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder (`timit/`).
4. Pin TimIt to the toolbar.

Updating the code later: hit the ↻ reload button on the extension card.

## Using it

**Popup** (toolbar icon) — the quick surface: type what you're doing, pick a
project, hit Start. The badge shows elapsed time; `Alt+Shift+T` starts/stops
without opening anything. Recent entries are listed with a ▶ button to restart
the same task.

**Dashboard** (button in the popup, or the extension's Options page) — four tabs:

- **Entries** — everything you've tracked, grouped by day with daily totals.
  Filter by date range, project or text; select rows for bulk move/export/delete;
  edit or delete any single entry; add entries by hand for work done offline.
- **Reports** — totals, days tracked, average per day, billable share, a bar
  chart per day, a donut + table per project, and your top activities.
- **Projects** — full CRUD: create, rename, recolour, set a client, archive
  (hides it from pickers without touching history), delete. Deleting a project
  that has entries asks whether to move them elsewhere or leave them
  project-less. Each project shows time tracked, entry count, share and last use.
- **Import / Export** — CSV and JSON, plus settings.

**Projects while tracking** — click the project box and start typing. The list
filters as you type; if the name doesn't exist yet, pick **Create "…"** and it's
created and selected in one step. Arrow keys + Enter work throughout.

**Durations** are editable in the entry dialog — type `1:30`, `90m`, `1.5` or
`2h15m` and the end time follows.

## CSV format

Export uses Clockify's *detailed report* columns:

```
Project, Client, Description, Task, User, Group, Email, Tags, Billable,
Start Date, Start Time, End Date, End Time, Duration (h), Duration (decimal)
```

That file imports directly into Clockify, and into Toggl / Harvest / most other
trackers through their column-mapping step. Set your name and email under
*Import / Export → Settings* if the target tool requires those columns to be
filled. Dates are `MM/DD/YYYY` (Clockify's default) or ISO `YYYY-MM-DD` — your
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

## Data & privacy

Everything is stored in `chrome.storage.local`, inside this browser profile on
this machine. Nothing syncs. Two consequences worth knowing:

- Removing the extension, or wiping browser data for it, deletes your history.
  Take a JSON backup now and then.
- Another Brave profile, or another computer, has its own separate data. Move
  it with a JSON backup.

## Layout

```
manifest.json          MV3 manifest — permissions: storage, alarms only
src/background.js      service worker: badge, timer keep-alive, shortcut
src/popup/             toolbar popup
src/dashboard/         full-page UI (Options page)
  views/               one module per tab
src/lib/
  store.js             storage layer + all data mutations
  time.js              duration/date formatting and parsing
  csv.js               Clockify-compatible export & tolerant import
  picker.js            type-to-filter / type-to-create project combobox
  charts.js            canvas bar + donut charts (no dependencies)
  range.js             date-range control
  entry-editor.js      add/edit entry dialog
  ui.js                el(), modal(), toast()
  theme.css            design tokens, light + dark
```

No build step, no dependencies — the source is what runs.
