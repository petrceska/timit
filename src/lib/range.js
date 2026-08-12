/** Date-range control: preset dropdown + custom from/to inputs. */
import { el } from './ui.js';
import {
  startOfDay, endOfDay, startOfWeek, startOfMonth, addDays, dayKey, fromDayKey,
} from './time.js';

export const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This week'],
  ['lastweek', 'Last week'],
  ['month', 'This month'],
  ['lastmonth', 'Last month'],
  ['30', 'Last 30 days'],
  ['year', 'This year'],
  ['all', 'All time'],
  ['custom', 'Custom…'],
];

export function resolvePreset(preset, weekStart = 1) {
  const now = new Date();
  switch (preset) {
    case 'today': return [startOfDay(now), endOfDay(now)];
    case 'yesterday': {
      const d = addDays(now, -1);
      return [startOfDay(d), endOfDay(d)];
    }
    case 'week': return [startOfWeek(now, weekStart), endOfDay(now)];
    case 'lastweek': {
      const s = addDays(startOfWeek(now, weekStart), -7);
      return [s, endOfDay(addDays(s, 6))];
    }
    case 'month': return [startOfMonth(now), endOfDay(now)];
    case 'lastmonth': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return [startOfDay(s), endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))];
    }
    case '30': return [startOfDay(addDays(now, -29)), endOfDay(now)];
    case 'year': return [startOfDay(new Date(now.getFullYear(), 0, 1)), endOfDay(now)];
    case 'all': return [new Date(0), endOfDay(now)];
    default: return [startOfDay(now), endOfDay(now)];
  }
}

export class RangeControl {
  constructor(root, { preset = 'week', weekStart = 1, onChange } = {}) {
    this.weekStart = weekStart;
    this.onChange = onChange;
    this.preset = preset;
    const [from, to] = resolvePreset(preset, weekStart);
    this.from = from; this.to = to;

    this.select = el('select', {
      onchange: () => {
        this.preset = this.select.value;
        if (this.preset !== 'custom') {
          const [f, t] = resolvePreset(this.preset, this.weekStart);
          this.from = f; this.to = t;
          this._syncInputs();
        }
        this._toggleCustom();
        this.onChange?.(this.get());
      },
    }, PRESETS.map(([v, label]) => el('option', { value: v, selected: v === preset }, label)));

    this.fromIn = el('input', {
      type: 'date',
      onchange: () => { this.from = startOfDay(fromDayKey(this.fromIn.value)); this.onChange?.(this.get()); },
    });
    this.toIn = el('input', {
      type: 'date',
      onchange: () => { this.to = endOfDay(fromDayKey(this.toIn.value)); this.onChange?.(this.get()); },
    });
    this.custom = el('span', { class: 'row' }, this.fromIn, el('span', { class: 'muted' }, '→'), this.toIn);

    root.classList.add('row');
    root.append(this.select, this.custom);
    this._syncInputs();
    this._toggleCustom();
  }

  _syncInputs() {
    this.fromIn.value = dayKey(this.from.getTime() === 0 ? new Date(2000, 0, 1) : this.from);
    this.toIn.value = dayKey(this.to);
  }
  _toggleCustom() {
    this.custom.classList.toggle('hidden', this.preset !== 'custom');
  }
  setWeekStart(ws) {
    this.weekStart = ws;
    if (this.preset !== 'custom') {
      const [f, t] = resolvePreset(this.preset, ws);
      this.from = f; this.to = t;
      this._syncInputs();
    }
  }
  get() { return { from: this.from.getTime(), to: this.to.getTime(), preset: this.preset }; }
  /** True when the entry's start falls inside the range. */
  contains(entry) { return entry.start >= this.from.getTime() && entry.start <= this.to.getTime(); }
}
