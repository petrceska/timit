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
mtime. Columns are the export columns plus `ID`, dates always ISO
(`YYYY-MM-DD`) regardless of your CSV setting.

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
  sync.js              per-project file sync: merge rules + engine
  fsdb.js              IndexedDB store for file handles & permissions
  range.js             date-range control
  entry-editor.js      add/edit entry dialog
  ui.js                el(), modal(), toast()
  theme.css            design tokens, light + dark
test/merge.test.mjs    sync merge rules (node test/merge.test.mjs)
```

No build step, no dependencies — the source is what runs.
