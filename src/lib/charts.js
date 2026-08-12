/** Tiny canvas charts — no libraries, works offline. */

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 220;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  return {
    ctx, w, h,
    ink: css.getPropertyValue('--text').trim() || '#222',
    muted: css.getPropertyValue('--muted').trim() || '#888',
    grid: css.getPropertyValue('--border').trim() || '#ddd',
    accent: css.getPropertyValue('--accent').trim() || '#4f8ef7',
    surface: css.getPropertyValue('--surface').trim() || '#fff',
  };
}

function niceStep(max) {
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const mult = [1, 2, 2.5, 5, 10].find((m) => raw <= m * pow) || 10;
  return mult * pow;
}

/**
 * Vertical bars.
 * @param {object} data { labels:[], values:[], colors?:[], formatValue(fn), yUnit }
 */
export function drawBars(canvas, data) {
  const { ctx, w, h, ink, muted, grid, accent } = setup(canvas);
  const { labels, values, colors, formatValue = String } = data;
  if (!values.length) return drawEmpty(ctx, w, h, muted);

  const padL = 52, padR = 8, padT = 12, padB = 26;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const max = Math.max(...values, 0);
  const step = niceStep(max || 1);
  const top = Math.max(step, Math.ceil((max || 1) / step) * step);

  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= top + 0.0001; v += step) {
    const y = padT + plotH - (v / top) * plotH;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(w - padR, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    ctx.fillText(formatValue(v), padL - 8, y);
  }

  const slot = plotW / values.length;
  const barW = Math.max(3, Math.min(46, slot * 0.62));
  values.forEach((v, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    const barH = top ? (v / top) * plotH : 0;
    const y = padT + plotH - barH;
    ctx.fillStyle = (colors && colors[i]) || accent;
    roundRect(ctx, x, y, barW, Math.max(barH, v > 0 ? 2 : 0), 3);
    ctx.fill();
  });

  // Thin out x labels so they never collide.
  ctx.fillStyle = muted;
  ctx.textAlign = 'center';
  const every = Math.ceil((labels.length * 34) / plotW);
  labels.forEach((lab, i) => {
    if (i % every) return;
    ctx.fillText(lab, padL + slot * i + slot / 2, h - padB / 2 + 2);
  });
}

/** @param {Array<{label,value,color}>} slices */
export function drawDonut(canvas, slices) {
  const { ctx, w, h, ink, muted, surface } = setup(canvas);
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((a, s) => a + s.value, 0);
  if (!total) return drawEmpty(ctx, w, h, muted);

  const cx = w / 2, cy = h / 2;
  const outer = Math.min(w, h) / 2 - 6;
  const inner = outer * 0.62;
  let angle = -Math.PI / 2;

  for (const s of data) {
    const sweep = (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, angle, angle + sweep);
    ctx.arc(cx, cy, inner, angle + sweep, angle, true);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.strokeStyle = surface;
    ctx.lineWidth = 2;
    ctx.stroke();
    angle += sweep;
  }

  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText(data.length === 1 ? '100%' : `${data.length}`, cx, cy - 7);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText(data.length === 1 ? data[0].label.slice(0, 14) : 'projects', cx, cy + 10);
}

function drawEmpty(ctx, w, h, muted) {
  ctx.fillStyle = muted;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('No data in this range', w / 2, h / 2);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
