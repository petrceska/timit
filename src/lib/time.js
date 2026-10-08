/** Date/duration helpers. Everything is local-time; no timezone conversion. */

const pad = (n) => String(n).padStart(2, '0');

export function durationOf(entry, now = Date.now()) {
  return Math.max(0, (entry.end ?? now) - entry.start);
}

/** 3725000 -> "01:02:05" */
export function formatClock(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** 3725000 -> "1h 02m" ; 2700000 -> "45m" ; 12000 -> "12s" */
export function formatHuman(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** 3725000 -> "1.03" (decimal duration column) */
export function formatDecimalHours(ms) {
  return (ms / 3600000).toFixed(2);
}

/** "1:23" / "1.5" / "90m" / "1h30" -> milliseconds, or null. */
export function parseDuration(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/))) {
    return ((+m[1] * 60 + +m[2]) * 60 + (+m[3] || 0)) * 1000;
  }
  if ((m = t.match(/^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+(?:[.,]\d+)?)\s*m)?\s*(?:(\d+)\s*s)?$/)) &&
      (m[1] || m[2] || m[3])) {
    const num = (v) => (v ? parseFloat(v.replace(',', '.')) : 0);
    return Math.round((num(m[1]) * 3600 + num(m[2]) * 60 + num(m[3])) * 1000);
  }
  if ((m = t.match(/^(\d+(?:[.,]\d+)?)$/))) {
    return Math.round(parseFloat(m[1].replace(',', '.')) * 3600000);
  }
  return null;
}

export const startOfDay = (d) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
};
export const endOfDay = (d) => {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
};
export function startOfWeek(d, weekStart = 1) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStart + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
export const startOfMonth = (d) => {
  const x = startOfDay(d); x.setDate(1); return x;
};
export const addDays = (d, n) => {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
};

/** Local YYYY-MM-DD — the key used for grouping and for <input type="date">. */
export function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export function fromDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Local HH:MM:SS — the value format of <input type="time" step="1">. */
export function timeInput(d) {
  const x = new Date(d);
  return `${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`;
}

/** Combines a "YYYY-MM-DD" and a "HH:MM[:SS]" into a local Date. */
export function combineDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = String(timeStr || '').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss, 0);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today" / "Yesterday" / "Mon, 12 Aug" */
export function friendlyDate(d) {
  const day = startOfDay(d).getTime();
  const today = startOfDay(new Date()).getTime();
  if (day === today) return 'Today';
  if (day === startOfDay(addDays(new Date(), -1)).getTime()) return 'Yesterday';
  const x = new Date(d);
  const year = x.getFullYear() === new Date().getFullYear() ? '' : ` ${x.getFullYear()}`;
  return `${DAY_NAMES[x.getDay()]}, ${x.getDate()} ${MONTH_NAMES[x.getMonth()]}${year}`;
}

export const shortDate = (d) => {
  const x = new Date(d);
  return `${x.getDate()} ${MONTH_NAMES[x.getMonth()]}`;
};

export const clockTime = (d) => {
  const x = new Date(d);
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
};
