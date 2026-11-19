/* Linear Motion Lab — high school physics
 * Piecewise motion for one or several objects. Each object has a list of
 * "studied intervals", each with its own duration, initial position x,
 * initial velocity v and acceleration a.
 * a = 0  -> constant velocity,  a != 0 -> constant acceleration.
 * Continuity: interval i+1 starts where interval i ends (same x).
 * Velocity may jump abruptly at an interval boundary (independent v per interval).
 * Colours: Okabe-Ito palette (colour-blind friendly). */
"use strict";

// ---------------------------------------------------------------------------
// Constants & state
// ---------------------------------------------------------------------------
const MIN_DT = 0.5;
const MAX_INTERVALS = 8;
const MAX_OBJECTS = 4;
const OBJ_NAMES = ["Α", "Β", "Γ", "Δ"];
const COLORS = ["#0072B2", "#E69F00", "#009E73", "#D55E00"]; // Okabe-Ito
const SUP = ["", "ᵃ", "ᵇ", "ᶜ", "ᵈ"];
const INK = "#1c2333";   // timeline knob
const GRAY = "#8b93a7"; // interval boundaries and t1, dashed verticals
const MUTE = "#5b6478";
const PANELS = ["x", "u", "a", "track"];
const COARSE = window.matchMedia("(pointer: coarse)");

// the scenario the app falls back to (and what "Reset everything" restores)
const DEFAULT_STATE = {
  t0: 0,
  t1: 5,
  axisZero: true,
  show: { x: true, u: true, a: true, track: false },
  objects: [
    { name: "Α", intervals: [{ dt: 5, x: 0, v: 4, a: 0 }, { dt: 5, x: 0, v: 4, a: 0 }] },
  ],
};
const defaultState = () => JSON.parse(JSON.stringify(DEFAULT_STATE));

const state = defaultState();

// ---------------------------------------------------------------------------
// Physics (per object)
// ---------------------------------------------------------------------------
// Enforce position continuity: initial x of interval i+1 = final x of interval i.
// Velocity is NOT propagated: each interval may start with a different v
// (abrupt velocity change at the boundary).
function propagateIntervals(obj) {
  let x = obj.intervals[0].x;
  for (let i = 0; i < obj.intervals.length; i++) {
    const iv = obj.intervals[i];
    if (i > 0) iv.x = x;
    x = iv.x + iv.v * iv.dt + 0.5 * iv.a * iv.dt * iv.dt;
  }
}
function propagateAll() { state.objects.forEach(propagateIntervals); }

function objDuration(obj) { return obj.intervals.reduce((s, iv) => s + iv.dt, 0); }
function clampT1(t) { return Math.min(Math.max(t, state.t0), tEnd()); }
function objTEnd(obj) { return state.t0 + objDuration(obj); }
function tEnd() { return state.t0 + Math.max(...state.objects.map(objDuration)); }

function intervalBounds(obj) {
  let cum = state.t0;
  return obj.intervals.map((iv) => {
    const start = cum;
    cum += iv.dt;
    return { start, end: cum };
  });
}

function kinematicsIn(obj, t) {
  let cum = state.t0;
  for (const iv of obj.intervals) {
    const end = cum + iv.dt;
    if (t <= end + 1e-9) {
      const tau = t - cum;
      return {
        x: iv.x + iv.v * tau + 0.5 * iv.a * tau * tau,
        u: iv.v + iv.a * tau,
        a: iv.a,
      };
    }
    cum = end;
  }
  const iv = obj.intervals[obj.intervals.length - 1];
  const tau = t - cum;
  return {
    x: iv.x + iv.v * tau + 0.5 * iv.a * tau * tau,
    u: iv.v + iv.a * tau,
    a: iv.a,
  };
}
// Beyond its own last interval an object simply stays put (a = 0).
function kinematics(obj, t) {
  if (t >= objTEnd(obj)) {
    const k = kinematicsIn(obj, objTEnd(obj) - 1e-9);
    return { x: k.x, u: k.u, a: 0 };
  }
  return kinematicsIn(obj, Math.max(state.t0, t));
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

function fmt(v, digits = 2) {
  if (!isFinite(v)) return "";
  const r = Number(v.toFixed(digits));
  return (Object.is(r, -0) ? 0 : r).toString().replace(".", ",");
}
function numStr(v) {
  return String(Number(v.toFixed(2)));
}
// accepts "3.5" and the comma form "3,5" that the readouts use
function parseNum(s) {
  return parseFloat(String(s).trim().replace(",", "."));
}

// ---------------------------------------------------------------------------
// Plot geometry — shared so every plot aligns on the same time axis.
// The left gutter shrinks on narrow canvases so the curves keep room to breathe.
// ---------------------------------------------------------------------------
const PAD_WIDE = { left: 48, right: 18, top: 12, bottom: 22 };
const PAD_NARROW = { left: 40, right: 12, top: 12, bottom: 20 };
function padFor(w) { return w < 430 ? PAD_NARROW : PAD_WIDE; }

function timeToX(t, w) {
  const p = padFor(w);
  const span = tEnd() - state.t0;
  return p.left + ((t - state.t0) / span) * (w - p.left - p.right);
}
function xToTime(px, w) {
  const p = padFor(w);
  const span = tEnd() - state.t0;
  return state.t0 + ((px - p.left) / (w - p.left - p.right)) * span;
}
function valueToY(v, vmin, vmax, h) {
  const span = vmax - vmin || 1;
  return h - PAD_WIDE.bottom - ((v - vmin) / span) * (h - PAD_WIDE.top - PAD_WIDE.bottom);
}

function niceRange(min, max, padFrac = 0.15) {
  if (min === max) {
    // don't invent values on the side where nothing exists
    if (min >= 0) max = min + 1;
    else min = min - 1;
  }
  const pad = (max - min) * padFrac;
  return [min - pad, max + pad];
}

function drawAxes(ctx, w, h, symbol, unit, y0) {
  const p = padFor(w);
  ctx.strokeStyle = "#3a4152";
  ctx.fillStyle = "#3a4152";
  ctx.lineWidth = 1.4;

  // t-axis (horizontal, at height y0)
  ctx.beginPath();
  ctx.moveTo(p.left - 4, y0);
  ctx.lineTo(w - p.right + 6, y0);
  ctx.stroke();
  arrowHead(ctx, w - p.right + 6, y0, 0);
  // the letter sits in the right margin above the axis - right aligned so it
  // never gets cut off by the edge of the canvas
  ctx.textAlign = "right";
  ctx.font = "italic 14px Georgia, serif";
  ctx.fillText("t", w - 2, Math.max(p.top + 11, y0 - 8));
  ctx.textAlign = "start";

  // value axis (vertical, full plot height, from bottom up)
  ctx.beginPath();
  ctx.moveTo(p.left, h - p.bottom);
  ctx.lineTo(p.left, p.top - 6);
  ctx.stroke();
  arrowHead(ctx, p.left, p.top - 6, -Math.PI / 2);
  // quantity symbol + its unit
  ctx.textAlign = "right";
  ctx.font = "italic 15px Georgia, serif";
  ctx.fillText(symbol, p.left - 8, p.top + 5);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = MUTE;
  ctx.fillText(unit, p.left - 8, p.top + 19);
  ctx.textAlign = "start";
  ctx.lineWidth = 1;
}

function arrowHead(ctx, x, y, angle) {
  const s = 6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - s * Math.cos(angle - 0.4), y - s * Math.sin(angle - 0.4));
  ctx.moveTo(x, y);
  ctx.lineTo(x - s * Math.cos(angle + 0.4), y - s * Math.sin(angle + 0.4));
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Plot rendering
// ---------------------------------------------------------------------------
// series: [{ color, fn, tEnd, stepSegs (null for x/u), specials: [{v,label,color}] }]
function drawPlot(canvas, symbol, unit, series) {
  const { ctx, w, h } = setupCanvas(canvas);
  const p = padFor(w);
  ctx.clearRect(0, 0, w, h);

  // y-range over all series
  let mn = Infinity, mx = -Infinity;
  for (const s of series) {
    for (let i = 0; i <= 100; i++) {
      const t = state.t0 + ((s.tEnd - state.t0) * i) / 100;
      const v = s.fn(t);
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
  }
  if (state.axisZero) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
  const [vmin, vmax] = niceRange(mn, mx);

  const axisAtBottom = !state.axisZero;
  const y0 = axisAtBottom ? h - p.bottom : valueToY(0, vmin, vmax, h);
  drawAxes(ctx, w, h, symbol, unit, y0);

  // vertical dashed lines at the internal boundaries (union over all objects)
  // plus one at t₁: the current time is drawn exactly like a boundary
  const vlines = boundaryTimes();
  if (!vlines.some((t) => Math.abs(t - state.t1) < 1e-6)) vlines.push(state.t1);
  ctx.strokeStyle = GRAY;
  ctx.setLineDash([5, 4]);
  for (const bt of vlines) {
    const bx = timeToX(bt, w);
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // dashed zero line (only when the t-axis is at the bottom)
  if (axisAtBottom && vmin < 0 && vmax > 0) {
    ctx.strokeStyle = "#c9cfdb";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p.left, valueToY(0, vmin, vmax, h));
    ctx.lineTo(w - p.right, valueToY(0, vmin, vmax, h));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // dashed reference lines at the special values, with tick + value on the y-axis
  const specials = [];
  series.forEach((s) => specials.push(...s.specials));
  if (specials.length) {
    const ordered = [...specials].sort((p, q) => p.v - q.v);
    // the symbol and unit rows above the value axis are off limits to numbers
    const axisNumYs = [p.top + 5, p.top + 19], nameYs = [];
    for (const sp of ordered) {
      if (sp.v === null || Math.abs(sp.v) <= 1e-9 || sp.v <= vmin || sp.v >= vmax) continue;
      const py = valueToY(sp.v, vmin, vmax, h);
      ctx.strokeStyle = sp.color;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(p.left, py);
      ctx.lineTo(w - p.right, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // tick on the y-axis
      ctx.strokeStyle = "#3a4152";
      ctx.beginPath();
      ctx.moveTo(p.left - 4, py);
      ctx.lineTo(p.left, py);
      ctx.stroke();
      // numeric value on the y-axis: slide it a little off the line when the
      // slot there is taken (by another value or by the unit above), and only
      // leave it out when nothing fits
      const taken = (y) => axisNumYs.some((n) => Math.abs(n - y) < 13);
      const ny = [py + 4, py + 16, py - 8].find((y) => !taken(y));
      if (ny !== undefined) {
        ctx.fillStyle = "#3a4152";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(fmt(sp.v, 1), p.left - 7, ny);
        ctx.textAlign = "start";
        axisNumYs.push(ny);
      }
      // italic name at the right edge. Slots sit on one shared 13px ladder, so
      // labels of different lines can never land on each other: pick the slot
      // nearest the line that nobody has claimed yet.
      const step = 13, lo = p.top + 11, hi = h - 6;
      const target = py - 5;
      const ladder = [];
      for (let y = lo + (((target - lo) % step) + step) % step; y <= hi; y += step) ladder.push(y);
      ladder.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
      const ly = ladder.find((y) => !nameYs.some((n) => Math.abs(n - y) < step)) ?? target;
      nameYs.push(ly);
      ctx.fillStyle = sp.color;
      ctx.font = "italic 12px Georgia, serif";
      ctx.textAlign = "right";
      ctx.fillText(sp.label, w - p.right - 2, ly);
      ctx.textAlign = "start";
    }
  }

  const xOf = (t) => timeToX(t, w);
  const yVal = (v) => valueToY(v, vmin, vmax, h);

  // curves, one per object
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    if (s.stepSegs) {
      // piecewise-constant (acceleration): flat segments, jumps left open
      // (no vertical lines), same convention as the velocity plot
      for (const sg of s.stepSegs) {
        ctx.beginPath();
        ctx.moveTo(xOf(sg.s), yVal(sg.y));
        ctx.lineTo(xOf(sg.e), yVal(sg.y));
        ctx.stroke();
      }
    } else {
      // sample each interval separately so that a jump at a boundary
      // starts at this interval's value (jump left open, no vertical line)
      const bounds = s.bounds || [];
      const ranges = bounds.length
        ? bounds.map((b) => [b.start, b.end])
        : [[state.t0, s.tEnd]];
      const total = s.tEnd - state.t0;
      ranges.forEach((rg, ri) => {
        const N = Math.max(2, Math.round(300 * (rg[1] - rg[0]) / total));
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          // first sample of a non-initial interval sits just after the boundary
          // so it uses this interval's (possibly jumped) value; the jump itself
          // is left unconnected (no vertical line)
          const t = ri === 0
            ? rg[0] + ((rg[1] - rg[0]) * i) / N
            : rg[0] + 1e-6 + ((rg[1] - rg[0] - 1e-6) * i) / N;
          const px = xOf(t), py = yVal(s.fn(t));
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
    }
    ctx.lineWidth = 1;
  }

  // dots mark where t₁ meets each curve (the dashed vertical above is the line itself)
  const tx = xOf(state.t1);
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(tx, yVal(s.fn(state.t1)), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
function boundaryTimes() {
  const bts = [];
  state.objects.forEach((obj) => {
    intervalBounds(obj).forEach((b, i) => {
      if (i < obj.intervals.length - 1 && !bts.some((t) => Math.abs(t - b.end) < 1e-6)) {
        bts.push(b.end);
      }
    });
  });
  return bts.sort((a, b) => a - b);
}

function drawTimeline(canvas) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const p = padFor(w);
  const coarse = COARSE.matches;
  const y = h / 2;
  const R = coarse ? 9 : 7;              // knob radius (touch needs more grip)
  const labY = y + (coarse ? 26 : 20);   // tick / boundary values, below the line
  const italicY = y - (coarse ? 19 : 10);// t₀, t₁, t_f band
  const dtY = y - (coarse ? 30 : 22);    // Δt band, above the italic one
  const xOf = (t) => timeToX(t, w);

  // main line — same horizontal extent as the plots' t-axis
  ctx.strokeStyle = "#3a4152";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.left - 4, y);
  ctx.lineTo(w - p.right + 6, y);
  ctx.stroke();
  ctx.lineWidth = 1;

  // endpoints t₀ and t_f
  ctx.fillStyle = "#3a4152";
  for (const t of [state.t0, tEnd()]) {
    ctx.beginPath();
    ctx.arc(xOf(t), y, coarse ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `italic ${coarse ? 14 : 13}px Georgia, serif`;
  ctx.textAlign = "left";
  ctx.fillText("t₀", xOf(state.t0) - 4, italicY);
  ctx.textAlign = "right";
  ctx.fillText("t_f", xOf(tEnd()) + 4, italicY);
  ctx.textAlign = "start";

  // Δt labels (only unambiguous when there is a single object)
  if (state.objects.length === 1) {
    const bounds = intervalBounds(state.objects[0]);
    ctx.fillStyle = MUTE;
    ctx.font = `${coarse ? 13 : 12}px sans-serif`;
    ctx.textAlign = "center";
    bounds.forEach((b, i) => {
      const cx = (xOf(b.start) + xOf(b.end)) / 2;
      // Δt labels live on their own band, so the knob never has to hide one
      if (bounds.some((o, j) => j !== i &&
          Math.abs((xOf(o.start) + xOf(o.end)) / 2 - cx) < (coarse ? 34 : 28))) return;
      ctx.fillText("Δt" + (i + 1), cx, dtY);
    });
    ctx.textAlign = "start";
  }

  // internal boundary marks and their t values (union over all objects)
  const bts = boundaryTimes();
  const bxs = bts.map(xOf);
  bts.forEach((t, i) => {
    const s = coarse ? 5 : 4;
    ctx.fillStyle = GRAY;
    ctx.beginPath();
    ctx.moveTo(bxs[i], y - s - 1);
    ctx.lineTo(bxs[i] - s, y - 1);
    ctx.lineTo(bxs[i] + s, y - 1);
    ctx.closePath();
    ctx.fill();
    if (bxs.some((bx, j) => j !== i && Math.abs(bx - bxs[i]) < 22)) return; // too crowded
    ctx.fillStyle = MUTE;
    ctx.font = `${coarse ? 12 : 11}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(fmt(t, 1), bxs[i], labY);
    ctx.textAlign = "start";
  });

  // t₁ marker: a draggable knob, with a halo on touch screens
  const mx = xOf(state.t1);
  if (coarse) {
    ctx.fillStyle = "rgba(28,35,51,0.18)";
    ctx.beginPath();
    ctx.arc(mx, y, R + 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(mx, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineWidth = 1;

  // the t₁ label slides away from the t₀ / t_f corner labels
  ctx.fillStyle = INK;
  ctx.font = `italic ${coarse ? 14 : 13}px Georgia, serif`;
  const t1W = ctx.measureText("t₁").width;
  const t0End = xOf(state.t0) - 4 + ctx.measureText("t₀").width;
  const tfStart = xOf(tEnd()) + 4 - ctx.measureText("t_f").width;
  let lx = mx, align = "center";
  if (lx + t1W / 2 > tfStart - 8) { lx = Math.min(mx - 12, tfStart - 10); align = "right"; }
  if (lx - t1W / 2 < t0End + 8) { lx = Math.max(mx + 12, t0End + 10); align = "left"; }
  ctx.textAlign = align;
  ctx.fillText("t₁", lx, italicY);
  ctx.textAlign = "start";

  // ticks (a label is skipped where a boundary value already sits)
  const span = tEnd() - state.t0;
  let step = span > 20 ? 5 : span > 8 ? 2 : 1;
  if (coarse) step *= 2;                       // fewer, roomier labels on a phone
  ctx.strokeStyle = "#aab1c2";
  ctx.fillStyle = "#6b7280";
  ctx.font = `${coarse ? 12 : 11}px sans-serif`;
  for (let t = Math.ceil(state.t0 / step) * step; t <= tEnd() + 1e-9; t += step) {
    const px = xOf(t);
    ctx.beginPath();
    ctx.moveTo(px, y + 5);
    ctx.lineTo(px, y + (coarse ? 11 : 9));
    ctx.stroke();
    if (!bxs.some((bx) => Math.abs(bx - px) < 10)) {
      ctx.textAlign = "center";
      ctx.fillText(fmt(t, 0), px, labY);
      ctx.textAlign = "start";
    }
  }
}

// ---------------------------------------------------------------------------
// Track (real movement on a line)
// ---------------------------------------------------------------------------
function drawTrack(canvas) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const midY = h / 2;
  const margin = 40;

  // x-range over all objects and the whole time span
  let xmin = Infinity, xmax = -Infinity;
  for (const obj of state.objects) {
    for (let i = 0; i <= 100; i++) {
      const t = state.t0 + ((objTEnd(obj) - state.t0) * i) / 100;
      const x = kinematics(obj, t).x;
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
    }
  }
  if (xmax - xmin < 1e-9) { xmin -= 1; xmax += 1; }
  const pad = (xmax - xmin) * 0.08;
  xmin -= pad; xmax += pad;

  const xToPx = (x) => margin + ((x - xmin) / (xmax - xmin)) * (w - 2 * margin);

  // track line
  ctx.strokeStyle = "#3a4152";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin - 14, midY);
  ctx.lineTo(w - margin + 14, midY);
  ctx.stroke();
  ctx.lineWidth = 1;

  // origins x0 (label only the first one)
  ctx.fillStyle = "#aab1c2";
  state.objects.forEach((obj, i) => {
    ctx.beginPath();
    ctx.arc(xToPx(obj.intervals[0].x), midY, 4, 0, Math.PI * 2);
    ctx.fill();
    if (i === 0) {
      ctx.fillStyle = "#6b7280";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("x₀", xToPx(obj.intervals[0].x), midY + 22);
      ctx.textAlign = "start";
      ctx.fillStyle = "#aab1c2";
    }
  });

  const multi = state.objects.length > 1;
  state.objects.forEach((obj, i) => {
    const cur = kinematics(obj, state.t1);
    const px = xToPx(cur.x);

    // velocity arrow
    const vLen = Math.max(-70, Math.min(70, cur.u * 6));
    if (Math.abs(vLen) > 4) {
      ctx.strokeStyle = "#3a4152";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, midY - 18);
      ctx.lineTo(px + vLen, midY - 18);
      ctx.stroke();
      arrowHead(ctx, px + vLen, midY - 18, vLen > 0 ? 0 : Math.PI);
      ctx.lineWidth = 1;
    }

    // dot
    ctx.fillStyle = COLORS[i];
    ctx.beginPath();
    ctx.arc(px, midY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;

    // labels
    ctx.fillStyle = INK;
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    if (multi) {
      ctx.fillText(`${obj.name}: x = ${fmt(cur.x)} m · u = ${fmt(cur.u)} m/s`, px, midY - 26 - i * 15);
    } else {
      ctx.fillText(`x = ${fmt(cur.x)} m`, px, midY - 26);
      ctx.fillText(`u = ${fmt(cur.u)} m/s`, px, midY + 26);
    }
    ctx.textAlign = "start";
  });
}

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------
// Widest string fmt() could ever show for a value that keeps changing: a minus
// if it ever goes negative, all the integer digits of its biggest magnitude and
// the two decimals fmt() may add.
function widestChanging(mag, neg) {
  const digits = Math.min(22, String(Math.floor(mag)).length);
  return `${neg ? "-" : ""}${"9".repeat(digits)},99`;
}

// Widest text each readout field can become over the object's whole motion. A
// field that never changes prints one exact number; a moving one is bounded by
// its extremes - interval endpoints plus the u = 0 turning point of x.
function widestStrings(obj) {
  const best = { x: "0", u: "0", a: "0" };
  const keep = (key, s) => { if (s.length > best[key].length) best[key] = s; };
  for (const iv of obj.intervals) {
    keep("a", fmt(iv.a));                       // a is constant inside an interval

    const uEnd = iv.v + iv.a * iv.dt;
    if (iv.a === 0) keep("u", fmt(iv.v));       // u never moves here
    else keep("u", widestChanging(Math.max(Math.abs(iv.v), Math.abs(uEnd)), iv.v < 0 || uEnd < 0));

    const xEnd = iv.x + iv.v * iv.dt + 0.5 * iv.a * iv.dt * iv.dt;
    if (iv.a === 0 && iv.v === 0) keep("x", fmt(iv.x));   // it stands still here
    else {
      const xs = [iv.x, xEnd];
      if (iv.a !== 0) {
        const tv = -iv.v / iv.a;                 // x turns around where u = 0
        if (tv > 0 && tv < iv.dt) xs.push(iv.x + iv.v * tv + 0.5 * iv.a * tv * tv);
      }
      keep("x", widestChanging(Math.max(...xs.map(Math.abs)), xs.some((v) => v < 0)));
    }
  }
  keep("a", "0");                               // and after the last interval a = 0
  return best;
}

// t₁ may be any time between t₀ and t_end, so its label is bounded by the
// larger of those two magnitudes.
function widestTime() {
  return widestChanging(Math.max(Math.abs(state.t0), Math.abs(tEnd())), state.t0 < 0) + " s";
}

// One hidden element, laid out with the real styles, says how wide or tall the
// widest possible text is.
let barProbe = null;
function probeBox(cls, html, width) {
  if (!barProbe) {
    barProbe = document.createElement("div");
    barProbe.id = "bar-probe";
    barProbe.setAttribute("aria-hidden", "true");
    document.body.appendChild(barProbe);
  }
  barProbe.className = cls;
  barProbe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden";
  if (width !== undefined) barProbe.style.width = `${width}px`;
  barProbe.innerHTML = html;
  return barProbe.getBoundingClientRect();
}

// The t₁ value inside the heading changes width while you drag. Giving the
// heading the width of its widest possible value stops the row under it from
// sliding sideways, which is what made the readouts wrap on and off.
let titleSig = "";
function stabiliseTitle() {
  const sig = [state.t0, state.objects.map(objDuration).join(",")].join("|");
  if (sig === titleSig) return;
  titleSig = sig;
  const w = probeBox("t1-title", `Στη στιγμή t₁ — <b>${widestTime()}</b>`).width;
  document.querySelector(".t1-title").style.minWidth = `${Math.ceil(w)}px`;
}

// A readout line wraps once its widest possible text no longer fits. Measuring
// that (not the current text) lets us reserve the height up front, so the bar
// above the timeline keeps one height while t₁ is dragged.
let wrapSig = "";
let wrapHeights = [];
function readoutReserve(el) {
  const avail = el.clientWidth;
  const sig = [avail, state.t0, state.objects.map((o) =>
    o.intervals.map((iv) => `${iv.dt},${iv.x},${iv.v},${iv.a}`).join(";")).join("&")].join("|");
  if (sig === wrapSig) return wrapHeights;
  wrapSig = sig;
  // one line of the same markup gives the line height, then the widest text
  const lineHeight = probeBox("readout-line", `<span class="chip"></span><b>Α</b> x = 0 m`, avail).height;
  wrapHeights = state.objects.map((obj) => {
    const w = widestStrings(obj);
    const h = probeBox(
      "readout-line",
      `<span class="chip"></span>` +
      `<b>${obj.name}</b> x = ${w.x} m · u = ${w.u} m/s · a = ${w.a} m/s²`,
      avail).height;
    // the probe wraps exactly like the real row, so its height is the reserve
    return h > lineHeight + 0.5 ? Math.ceil(h) : 0;
  });
  return wrapHeights;
}

function updateReadouts() {
  document.getElementById("out-t1").textContent = `${fmt(state.t1)} s`;
  const el = document.getElementById("readouts");
  el.innerHTML = "";
  const rows = state.objects.map((obj, i) => {
    const k = kinematics(obj, state.t1);
    const row = document.createElement("div");
    row.className = "readout-line";
    row.innerHTML =
      `<span class="chip" style="background:${COLORS[i]}"></span>` +
      `<b>${obj.name}</b> x = ${fmt(k.x)} m · u = ${fmt(k.u)} m/s · a = ${fmt(k.a)} m/s²`;
    el.appendChild(row);
    return row;
  });
  // fix the heading's width first, then see what room the readouts keep
  stabiliseTitle();
  const reserve = readoutReserve(el);
  rows.forEach((row, i) => { if (reserve[i]) row.style.minHeight = `${reserve[i]}px`; });
  syncTimelineAria();
}

// keep the timeline's slider semantics in sync with t₁
function syncTimelineAria() {
  const hi = tEnd();
  setAttr(timelineCanvas, "aria-valuemin", numStr(state.t0));
  setAttr(timelineCanvas, "aria-valuemax", numStr(hi));
  setAttr(timelineCanvas, "aria-valuenow", numStr(state.t1));
  setAttr(timelineCanvas, "aria-valuetext", `t₁ = ${fmt(state.t1)} s`);
}
function setAttr(el, name, val) {
  if (el.getAttribute(name) !== val) el.setAttribute(name, val);
}

function renderIntervalStats(el, obj) {
  el.innerHTML = "";
  obj.intervals.forEach((iv, i) => {
    const dx = iv.v * iv.dt + 0.5 * iv.a * iv.dt * iv.dt;
    const du = iv.a * iv.dt;
    const row = document.createElement("div");
    row.className = "stat-line";
    row.innerHTML =
      `<b>I${i + 1}</b> &nbsp;Δx = ${fmt(dx)} m · v̄ = ${fmt(dx / iv.dt)} m/s · Δu = ${fmt(du)} m/s · ā = ${fmt(iv.a)} m/s²`;
    el.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Objects & intervals UI (DOM)
// ---------------------------------------------------------------------------
const IV_FIELDS = [
  { key: "dt", label: "Δt (s)" },
  { key: "x", label: "x (m)" },
  { key: "v", label: "v (m/s)" },
  { key: "a", label: "a (m/s²)" },
];

function buildIntervalsTable(table, obj) {
  table.innerHTML = "";
  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>#</th><th>Δt (s)</th><th>x (m)</th><th>v (m/s)</th><th>a (m/s²)</th><th></th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  obj.intervals.forEach((iv, i) => {
    const tr = document.createElement("tr");
    const idx = document.createElement("td");
    idx.className = "idx";
    idx.textContent = "I" + (i + 1);
    tr.appendChild(idx);

    IV_FIELDS.forEach((f) => {
      const td = document.createElement("td");
      td.className = "f-" + f.key;
      td.dataset.label = f.label;          // shown on narrow screens
      const input = document.createElement("input");
      // text + inputmode="decimal" instead of type="number": phones show the
      // decimal keypad, and a comma ("3,5") stays editable instead of being
      // wiped out by the browser's number parser
      input.type = "text";
      input.inputMode = "decimal";
      input.enterKeyHint = "done";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.title = f.label;
      input.setAttribute("aria-label", `Σώμα ${obj.name}, διάστημα ${i + 1}: ${f.label}`);
      input.value = numStr(iv[f.key]);
      if (i > 0 && f.key === "x") {
        input.disabled = true; // fixed by continuity
        input.title = "Σταθερό από συνέχεια με το προηγούμενο διάστημα";
        td.classList.add("locked");
      } else {
        input.addEventListener("change", () => {
          const val = parseNum(input.value);
          if (!isFinite(val)) { input.value = numStr(iv[f.key]); return; }
          onIntervalChange(obj, i, f.key, val);
        });
        // Enter dismisses the phone keyboard instead of adding a phantom value
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        });
      }
      td.appendChild(input);
      tr.appendChild(td);
    });

    const tdDel = document.createElement("td");
    tdDel.className = "del";
    const btn = document.createElement("button");
    btn.className = "btn-remove";
    btn.textContent = "✕";
    btn.disabled = obj.intervals.length <= 1;
    btn.title = "Αφαίρεση διαστήματος";
    btn.setAttribute("aria-label", `Αφαίρεση διαστήματος ${i + 1} του σώματος ${obj.name}`);
    btn.addEventListener("click", () => {
      obj.intervals.splice(i, 1);
      propagateIntervals(obj);
      state.t1 = clampT1(state.t1);
      refresh();
    });
    tdDel.appendChild(btn);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
}

// one call for "the scenario changed structurally, repaint everything"
function refresh() {
  buildObjectsUI();
  syncUI();
  renderAll();
}

// object letters always follow the list order, so deleting one never leaves
// two objects sharing a name (or a colour index)
function renumberObjects() {
  state.objects.forEach((o, i) => (o.name = OBJ_NAMES[i]));
}

function buildObjectsUI() {
  const cont = document.getElementById("objects-container");
  cont.innerHTML = "";
  state.objects.forEach((obj, oi) => {
    const card = document.createElement("div");
    card.className = "object-card";

    const head = document.createElement("div");
    head.className = "object-head";
    head.innerHTML = `<span class="chip" style="background:${COLORS[oi]}"></span><b>Σώμα ${obj.name}</b>`;
    const del = document.createElement("button");
    del.className = "btn-remove";
    del.textContent = "✕";
    del.title = "Αφαίρεση σώματος";
    del.setAttribute("aria-label", `Αφαίρεση σώματος ${obj.name}`);
    del.disabled = state.objects.length <= 1;
    del.addEventListener("click", () => {
      state.objects.splice(oi, 1);
      renumberObjects();
      state.t1 = clampT1(state.t1);
      refresh();
    });
    head.appendChild(del);
    card.appendChild(head);

    const table = document.createElement("table");
    table.className = "intervals-table";
    buildIntervalsTable(table, obj);
    card.appendChild(table);

    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-primary btn-sm";
    addBtn.textContent = "+ Προσθήκη διαστήματος";
    addBtn.disabled = obj.intervals.length >= MAX_INTERVALS;
    addBtn.title = obj.intervals.length >= MAX_INTERVALS ? `Το πολύ ${MAX_INTERVALS} διαστήματα ανά σώμα` : "";
    addBtn.addEventListener("click", () => {
      if (obj.intervals.length >= MAX_INTERVALS) return;
      // start the new interval at the previous interval's final velocity,
      // so adding one does not invent a velocity jump by default
      const last = obj.intervals[obj.intervals.length - 1];
      obj.intervals.push({ dt: 5, x: 0, v: last.v, a: 0 });
      propagateIntervals(obj);
      refresh();
    });
    card.appendChild(addBtn);

    const stats = document.createElement("div");
    stats.className = "stats";
    renderIntervalStats(stats, obj);
    card.appendChild(stats);

    cont.appendChild(card);
  });

  const addObj = document.getElementById("btn-add-object");
  const full = state.objects.length >= MAX_OBJECTS;
  addObj.disabled = full;
  addObj.title = full ? `Το πολύ ${MAX_OBJECTS} σώματα` : "";
}

function onIntervalChange(obj, i, key, val) {
  const iv = obj.intervals[i];
  if (key === "dt") val = Math.max(MIN_DT, val);
  iv[key] = val;
  propagateIntervals(obj);
  state.t1 = clampT1(state.t1);
  syncUI();
  renderAll();
}

// refresh auto-computed x values, dt values after drags, and the stats
function syncUI() {
  propagateAll();
  document.querySelectorAll("#objects-container .object-card").forEach((card, oi) => {
    const obj = state.objects[oi];
    const rows = card.querySelectorAll(".intervals-table tbody tr");
    rows.forEach((tr, i) => {
      const iv = obj.intervals[i];
      const inputs = tr.querySelectorAll("input");
      if (document.activeElement !== inputs[0]) inputs[0].value = numStr(iv.dt);
      if (i > 0) inputs[1].value = numStr(iv.x);
    });
    renderIntervalStats(card.querySelector(".stats"), obj);
  });
}

document.getElementById("btn-add-object").addEventListener("click", () => {
  if (state.objects.length >= MAX_OBJECTS) return;
  const prev = state.objects[state.objects.length - 1];
  const v = prev.intervals[prev.intervals.length - 1].v;
  state.objects.push({
    name: OBJ_NAMES[state.objects.length],
    intervals: [{ dt: 5, x: 0, v, a: 0 }, { dt: 5, x: 0, v, a: 0 }],
  });
  propagateAll();
  refresh();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function makeSeries(kind) {
  return state.objects.map((obj, i) => {
    const s = {
      color: COLORS[i],
      fn: (t) => kinematics(obj, t)[kind],
      tEnd: objTEnd(obj),
      stepSegs: null,
      specials: [],
    };
    if (kind === "a") {
      s.stepSegs = intervalBounds(obj).map((b, j) => ({ s: b.start, e: b.end, y: obj.intervals[j].a }));
      obj.intervals.forEach((iv, j) => {
        if (Math.abs(iv.a) > 1e-9 && !s.specials.some((sp) => Math.abs(sp.v - iv.a) < 1e-9)) {
          s.specials.push({ v: iv.a, label: "a" + (j + 1) + SUP[i], color: COLORS[i] });
        }
      });
    } else {
      // per-interval ranges: used to draw jumps as exactly vertical segments
      s.bounds = intervalBounds(obj);
      // special values: initial and final value of every interval (deduplicated).
      // If v jumps at a boundary, the post-jump value gets a primed label (x₁′).
      const seen = [];
      const push = (v, label) => {
        if (Math.abs(v) <= 1e-9) return; // zero is already marked by the axis
        if (!seen.some((sp) => Math.abs(sp.v - v) < 1e-6)) {
          seen.push({ v, label: label + SUP[i], color: COLORS[i] });
        }
      };
      const bounds = intervalBounds(obj);
      push(obj.intervals[0][kind === "u" ? "v" : "x"], kind + "₀");
      obj.intervals.forEach((iv, j) => {
        push(kinematics(obj, bounds[j].end)[kind], kind + (j + 1));
        if (j + 1 < obj.intervals.length) {
          push(obj.intervals[j + 1][kind === "u" ? "v" : "x"], kind + (j + 1) + "′");
        }
      });
      s.specials = seen;
    }
    return s;
  });
}

function renderAll() {
  state.t1 = clampT1(state.t1);

  drawTimeline(document.getElementById("timeline"));
  if (state.show.x) drawPlot(document.getElementById("plot-x"), "x", "m", makeSeries("x"));
  if (state.show.u) drawPlot(document.getElementById("plot-u"), "u", "m/s", makeSeries("u"));
  if (state.show.a) drawPlot(document.getElementById("plot-a"), "a", "m/s²", makeSeries("a"));
  if (state.show.track) drawTrack(document.getElementById("track"));
  updateReadouts();
  scheduleSave();
}

// repaint at most once per frame (resize / panel toggles arrive in bursts)
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

// ---------------------------------------------------------------------------
// Panel visibility
// ---------------------------------------------------------------------------
function panelEl(kind) {
  return kind === "track" ? document.getElementById("track-card")
    : document.getElementById("row-" + kind);
}
function applyVisibility() {
  PANELS.forEach((k) => { panelEl(k).style.display = state.show[k] ? "" : "none"; });
}
function setPanelVisible(kind, visible) {
  state.show[kind] = visible;
  applyVisibility();
  renderAll();
}

// ---------------------------------------------------------------------------
// Persistence: the scenario is auto-saved in localStorage.
// Sharing happens through an exported base64 code (see the Share card).
// ---------------------------------------------------------------------------
const LS_KEY = "linear-motion-lab";

function serializeState() {
  return JSON.stringify({
    t0: state.t0,
    t1: state.t1,
    axisZero: state.axisZero,
    show: state.show,
    objects: state.objects.map((o) => ({
      name: o.name,
      intervals: o.intervals.map((iv) => ({ dt: iv.dt, x: iv.x, v: iv.v, a: iv.a })),
    })),
  });
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}
function saveState() {
  try { localStorage.setItem(LS_KEY, serializeState()); } catch (e) { /* storage unavailable */ }
}

// validate + clamp arbitrary data coming from storage / an imported code
function sanitizeState(s) {
  if (!s || typeof s !== "object" || !Array.isArray(s.objects) || !s.objects.length) return null;
  const sh = (k, d) => (s.show && typeof s.show[k] === "boolean") ? s.show[k] : d;
  const out = {
    t0: isFinite(s.t0) ? s.t0 : 0,
    t1: isFinite(s.t1) ? s.t1 : 5,
    axisZero: s.axisZero !== false,
    show: {
      x: sh("x", true), u: sh("u", true), a: sh("a", true), track: sh("track", false),
    },
    objects: [],
  };
  for (let i = 0; i < Math.min(MAX_OBJECTS, s.objects.length); i++) {
    const o = s.objects[i];
    if (!o || !Array.isArray(o.intervals) || !o.intervals.length) continue;
    out.objects.push({
      name: OBJ_NAMES[i],
      intervals: o.intervals.slice(0, MAX_INTERVALS).map((iv) => ({
        dt: Math.max(MIN_DT, isFinite(iv.dt) ? iv.dt : 5),
        x: isFinite(iv.x) ? iv.x : 0,
        v: isFinite(iv.v) ? iv.v : 0,
        a: isFinite(iv.a) ? iv.a : 0,
      })),
    });
  }
  return out.objects.length ? out : null;
}

function applyState(s) {
  const clean = sanitizeState(s);
  if (!clean) return false;
  Object.assign(state, clean);
  renumberObjects();
  t0El.value = numStr(clean.t0);
  document.getElementById("in-axis-zero").checked = clean.axisZero;
  PANELS.forEach((k) => { document.getElementById("show-" + k).checked = clean.show[k]; });
  applyVisibility();
  propagateAll();
  refresh();
  return true;
}

// ---------------------------------------------------------------------------
// Interaction: dragging on the timeline
// ---------------------------------------------------------------------------
const timelineCanvas = document.getElementById("timeline");
let draggingT1 = false;
let touchDown = null;   // where a finger landed, until we know what it wants

// landing close to t₀, an interval boundary or t_end snaps exactly onto it
function snapTime(t) {
  const rect = timelineCanvas.getBoundingClientRect();
  const p = padFor(rect.width);
  const span = tEnd() - state.t0 || 1;
  const tol = (6 / Math.max(1, rect.width - p.left - p.right)) * span;
  for (const bt of [state.t0, ...boundaryTimes(), tEnd()]) {
    if (Math.abs(t - bt) <= tol) return bt;
  }
  return t;
}

function timeAtClientX(clientX) {
  const rect = timelineCanvas.getBoundingClientRect();
  return xToTime(clientX - rect.left, rect.width);
}

function setT1(t, snap) {
  state.t1 = clampT1(snap ? snapTime(t) : t);
  renderAll();
}

timelineCanvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") {
    // A finger on the canvas may just be swiping the page up or down (vertical
    // panning is allowed there), so nothing changes yet. Sideways travel starts
    // a drag, a tap commits on lift-off, and a page scroll cancels both.
    touchDown = { x: e.clientX, y: e.clientY };
    return;
  }
  draggingT1 = true;
  timelineCanvas.setPointerCapture(e.pointerId);
  timelineCanvas.style.cursor = "grabbing";
  setT1(timeAtClientX(e.clientX), true);  // a click moves the marker too, not only a drag
  e.preventDefault();
});

timelineCanvas.addEventListener("pointermove", (e) => {
  if (!draggingT1 && touchDown && e.pointerType === "touch") {
    const dx = e.clientX - touchDown.x, dy = e.clientY - touchDown.y;
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;   // still undecided
    draggingT1 = true;
    timelineCanvas.setPointerCapture(e.pointerId);
    timelineCanvas.style.cursor = "grabbing";
  }
  if (draggingT1) {
    setT1(timeAtClientX(e.clientX), true);
  } else if (e.pointerType === "mouse") {
    const rect = timelineCanvas.getBoundingClientRect();
    timelineCanvas.style.cursor =
      Math.abs(e.clientX - rect.left - timeToX(state.t1, rect.width)) < 14 ? "grab" : "default";
  }
});

function endDrag(e) {
  if (!draggingT1 && touchDown && e.type === "pointerup" && e.pointerType === "touch") {
    setT1(timeAtClientX(e.clientX), true);   // it was a tap: move the marker there
    touchDown = null;
    scheduleSave();
  } else {
    touchDown = null;
  }
  if (!draggingT1) return;
  draggingT1 = false;
  timelineCanvas.style.cursor = "default";
  scheduleSave();
}
timelineCanvas.addEventListener("pointerup", endDrag);
timelineCanvas.addEventListener("pointercancel", endDrag);

// keyboard nudging of t₁ — the canvas advertises role="slider"
timelineCanvas.addEventListener("keydown", (e) => {
  const span = tEnd() - state.t0 || 1;
  const fine = Math.max(0.1, Math.round((span / 100) * 10) / 10);
  const coarse = Math.max(0.5, Math.round((span / 20) * 10) / 10);
  const small = e.shiftKey ? coarse : fine;
  let t;
  switch (e.key) {
    case "ArrowLeft": case "ArrowDown": t = state.t1 - small; break;
    case "ArrowRight": case "ArrowUp": t = state.t1 + small; break;
    case "PageDown": t = state.t1 - coarse; break;
    case "PageUp": t = state.t1 + coarse; break;
    case "Home": t = state.t0; break;
    case "End": t = tEnd(); break;
    default: return;
  }
  e.preventDefault();
  setT1(t, false);
  scheduleSave();   // keyboard moves are kept like dragged ones
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
const t0El = document.getElementById("in-t0");
t0El.addEventListener("change", () => {
  const v = parseNum(t0El.value);
  if (!isFinite(v)) { t0El.value = numStr(state.t0); return; }
  state.t0 = v;
  state.t1 = clampT1(state.t1);
  renderAll();
});
t0El.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); t0El.blur(); }   // closes the phone keypad
});

document.getElementById("in-axis-zero").addEventListener("change", (e) => {
  state.axisZero = e.target.checked;
  renderAll();
});

PANELS.forEach((kind) => {
  document.getElementById("show-" + kind).addEventListener("change", (e) =>
    setPanelVisible(kind, e.target.checked));
});

// ---------------------------------------------------------------------------
// Back to the start
// ---------------------------------------------------------------------------
document.getElementById("btn-reset").addEventListener("click", () => {
  state.t1 = state.t0;
  renderAll();
});

// ---------------------------------------------------------------------------
// Share: base64 export / import of the whole scenario
// ---------------------------------------------------------------------------
const codeOut = document.getElementById("out-code");
const codeIn = document.getElementById("in-code");
const toastEl = document.getElementById("toast");
let toastTimer = null;

// a toast instead of alert(): non-blocking and legible on a phone
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

// unicode-safe base64, without the deprecated escape/unescape pair
function encodeCode(json) {
  let bin = "";
  for (const b of new TextEncoder().encode(json)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function decodeCode(code) {
  const bin = atob(code.trim().replace(/\s+/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

document.getElementById("btn-export").addEventListener("click", async () => {
  const code = encodeCode(serializeState());
  codeOut.value = code;
  let copied = false;
  try {
    await navigator.clipboard.writeText(code);
    copied = true;
  } catch (e) {
    codeOut.select(); // clipboard blocked: the code is selected, copy it by hand
  }
  toast(copied ? "Αντιγραφή κωδικού σεναρίου ✓" : "Έτοιμο το κωδικό — επιλέξτε και αντιγράψτε");
});

document.getElementById("btn-import").addEventListener("click", () => {
  const code = codeIn.value.trim();
  if (!code) { toast("Βάλε πρώτα κωδικό σεναρίου"); return; }
  let ok = false;
  try { ok = applyState(JSON.parse(decodeCode(code))); } catch (e) { ok = false; }
  if (ok) { codeIn.value = ""; toast("Εισαγωγή σεναρίου"); }
  else toast("Δεν είναι έγκυρος κωδικός σεναρίου");
});

document.getElementById("btn-clear").addEventListener("click", () => {
  if (!confirm("Απορρίπτεις αυτό το σενάριο και επιστρέφεις στο προεπιλεγμένο;")) return;
  try { localStorage.removeItem(LS_KEY); } catch (e) { /* nothing stored */ }
  codeOut.value = "";
  codeIn.value = "";
  applyState(defaultState());
  toast("Επαναφορά στο προεπιλεγμένο σενάριο");
});

// ---------------------------------------------------------------------------
// Boot: restore the last saved scenario from localStorage (if any)
// ---------------------------------------------------------------------------
let restored = false;
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) restored = applyState(JSON.parse(raw));
} catch (e) { /* corrupted storage: fall back to the default scenario */ }
if (!restored) applyState(defaultState());

// repaint when the layout changes: panels toggled, on-screen keyboard, page zoom,
// orientation change — all of them arrive as a size change on the containers
if (window.ResizeObserver) {
  const watcher = new ResizeObserver(scheduleRender);
  watcher.observe(document.querySelector(".plots-card"));
  watcher.observe(document.getElementById("track-card"));
}
window.addEventListener("resize", scheduleRender);
window.addEventListener("pagehide", saveState);
COARSE.addEventListener("change", scheduleRender);   // marker size tracks touch / mouse