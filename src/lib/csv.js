/**
 * CSV import/export in Clockify's "Detailed report" column layout, which is what
 * Clockify (and, with a column mapping step, Toggl/Harvest/Jira worklogs) accepts
 * on import.
 */
import { formatClock, formatDecimalHours } from './time.js';

export const EXPORT_COLUMNS = [
  'Project', 'Client', 'Description', 'Task', 'User', 'Group', 'Email', 'Tags',
  'Billable', 'Start Date', 'Start Time', 'End Date', 'End Time',
  'Duration (h)', 'Duration (decimal)',
];

const pad = (n) => String(n).padStart(2, '0');

function fmtDate(d, style) {
  const x = new Date(d);
  return style === 'iso'
    ? `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
    : `${pad(x.getMonth() + 1)}/${pad(x.getDate())}/${x.getFullYear()}`;
}
function fmtTime(d) {
  const x = new Date(d);
  return `${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`;
}

function escapeCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** entries -> CSV text. `projects` is a Map(id -> project). */
export function toCSV(entries, projects, settings = {}) {
  const style = settings.csvDateFormat === 'iso' ? 'iso' : 'clockify';
  const rows = [EXPORT_COLUMNS.join(',')];
  for (const e of entries) {
    if (e.end == null) continue; // never export a running entry
    const p = e.projectId ? projects.get(e.projectId) : null;
    const ms = e.end - e.start;
    rows.push([
      p ? p.name : '',
      p ? p.client || '' : '',
      e.description || '',
      '',
      settings.userName || '',
      '',
      settings.userEmail || '',
      (e.tags || []).join(', '),
      e.billable ? 'Yes' : 'No',
      fmtDate(e.start, style),
      fmtTime(e.start),
      fmtDate(e.end, style),
      fmtTime(e.end),
      formatClock(ms),
      formatDecimalHours(ms),
    ].map(escapeCell).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

/** RFC-4180-ish parser: quotes, embedded commas/newlines, CRLF. */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Finds a column index by any of the given header aliases. */
function col(headers, ...aliases) {
  const wanted = aliases.map(norm);
  return headers.findIndex((h) => wanted.includes(norm(h)));
}

function parseDate(str, prefer = 'clockify') {
  const s = String(str || '').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    return { y: +m[1], mo: +m[2], d: +m[3] };
  }
  if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/))) {
    const a = +m[1], b = +m[2];
    let y = +m[3]; if (y < 100) y += 2000;
    // Disambiguate DD/MM vs MM/DD: a value > 12 settles it, otherwise use the setting.
    if (a > 12) return { y, mo: b, d: a };
    if (b > 12) return { y, mo: a, d: b };
    return prefer === 'iso' ? { y, mo: b, d: a } : { y, mo: a, d: b };
  }
  const fallback = new Date(s);
  if (!isNaN(fallback)) {
    return { y: fallback.getFullYear(), mo: fallback.getMonth() + 1, d: fallback.getDate() };
  }
  return null;
}

function parseTime(str) {
  const s = String(str || '').trim();
  if (!s) return { h: 0, m: 0, s: 0 };
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return { h: 0, m: 0, s: 0 };
  let h = +m[1];
  const ampm = (m[4] || '').toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return { h, m: +m[2], s: +m[3] || 0 };
}

function hmsToMs(str) {
  const m = String(str || '').trim().match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (m) return ((+m[1] * 60 + +m[2]) * 60 + (+m[3] || 0)) * 1000;
  const dec = parseFloat(String(str).replace(',', '.'));
  return isNaN(dec) ? null : Math.round(dec * 3600000);
}

/**
 * CSV text -> { rows: [{projectName, client, description, tags, billable, start, end}],
 *               skipped: [{line, reason}] }
 * Nothing is written to storage here; the caller decides what to keep.
 */
export function fromCSV(text, settings = {}) {
  const table = parseCSV(text);
  if (!table.length) return { rows: [], skipped: [], headers: [] };
  const headers = table[0];
  const idx = {
    project: col(headers, 'Project', 'Project Name'),
    client: col(headers, 'Client'),
    description: col(headers, 'Description', 'Notes', 'Comment'),
    tags: col(headers, 'Tags', 'Tag'),
    billable: col(headers, 'Billable'),
    startDate: col(headers, 'Start Date', 'Startdate', 'Date'),
    startTime: col(headers, 'Start Time', 'Starttime'),
    endDate: col(headers, 'End Date', 'Enddate'),
    endTime: col(headers, 'End Time', 'Endtime'),
    duration: col(headers, 'Duration (h)', 'Duration', 'Duration (decimal)', 'Hours'),
  };
  if (idx.startDate < 0) {
    throw new Error('No "Start Date" (or "Date") column found in this CSV.');
  }

  const prefer = settings.csvDateFormat === 'iso' ? 'iso' : 'clockify';
  const at = (row, i) => (i >= 0 && row[i] !== undefined ? row[i].trim() : '');
  const rows = [], skipped = [];

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const sd = parseDate(at(row, idx.startDate), prefer);
    if (!sd) { skipped.push({ line: r + 1, reason: 'unreadable start date' }); continue; }
    const st = parseTime(at(row, idx.startTime));
    const start = new Date(sd.y, sd.mo - 1, sd.d, st.h, st.m, st.s).getTime();

    let end = null;
    const ed = parseDate(at(row, idx.endDate), prefer) || sd;
    const endTimeRaw = at(row, idx.endTime);
    if (endTimeRaw) {
      const et = parseTime(endTimeRaw);
      end = new Date(ed.y, ed.mo - 1, ed.d, et.h, et.m, et.s).getTime();
      if (end < start) end += 86400000; // crossed midnight without an end date
    } else {
      const ms = hmsToMs(at(row, idx.duration));
      if (ms != null) end = start + ms;
    }
    if (end == null) {
      skipped.push({ line: r + 1, reason: 'no end time or duration' });
      continue;
    }

    rows.push({
      projectName: at(row, idx.project),
      client: at(row, idx.client),
      description: at(row, idx.description),
      tags: at(row, idx.tags).split(',').map((t) => t.trim()).filter(Boolean),
      billable: /^(yes|true|1)$/i.test(at(row, idx.billable)),
      start,
      end,
    });
  }
  return { rows, skipped, headers };
}

export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
