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
const MAX_OBJECTS = 4;
const OBJ_NAMES = ["A", "B", "C", "D"];
const COLORS = ["#0072B2", "#E69F00", "#009E73", "#D55E00"]; // Okabe-Ito
const SUP = ["", "ᵃ", "ᵇ", "ᶜ", "ᵈ"];
const INK = "#1c2333"; // t1 marker
const GRAY = "#8b93a7"; // interval boundaries
const MUTE = "#5b6478";

const state = {
  t0: 0,
  t1: 5, // draggable time marker
  speed: 1,
  axisZero: true, // draw the t-axis at the level where the value is 0
  playing: false,
  show: { x: true, u: true, a: true, legend: false, track: false }, // visible panels
  objects: [
    { name: "A", intervals: [{ dt: 5, x: 0, v: 4, a: 0 }, { dt: 5, x: 0, v: 4, a: 0 }] },
  ],
};

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

// Shared plot geometry so all plots align on the time axis
const PAD = { left: 48, right: 18, top: 12, bottom: 22 };

function timeToX(t, w) {
  const span = tEnd() - state.t0;
  return PAD.left + ((t - state.t0) / span) * (w - PAD.left - PAD.right);
}
function xToTime(px, w) {
  const span = tEnd() - state.t0;
  return state.t0 + ((px - PAD.left) / (w - PAD.left - PAD.right)) * span;
}
function valueToY(v, vmin, vmax, h) {
  const span = vmax - vmin || 1;
  return h - PAD.bottom - ((v - vmin) / span) * (h - PAD.top - PAD.bottom);
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

function drawAxes(ctx, w, h, yLabel, y0) {
  ctx.strokeStyle = "#3a4152";
  ctx.fillStyle = "#3a4152";
  ctx.lineWidth = 1.4;

  // t-axis (horizontal, at height y0)
  ctx.beginPath();
  ctx.moveTo(PAD.left - 4, y0);
  ctx.lineTo(w - PAD.right + 6, y0);
  ctx.stroke();
  arrowHead(ctx, w - PAD.right + 6, y0, 0);
  ctx.font = "italic 14px Georgia, serif";
  ctx.fillText("t", w - PAD.right + 10, y0 + 4);

  // value axis (vertical, full plot height, from bottom up)
  ctx.beginPath();
  ctx.moveTo(PAD.left, h - PAD.bottom);
  ctx.lineTo(PAD.left, PAD.top - 6);
  ctx.stroke();
  arrowHead(ctx, PAD.left, PAD.top - 6, -Math.PI / 2);
  ctx.font = "italic 15px Georgia, serif";
  ctx.textAlign = "right";
  ctx.fillText(yLabel, PAD.left - 8, PAD.top + 4);
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
function drawPlot(canvas, yLabel, series) {
  const { ctx, w, h } = setupCanvas(canvas);
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
  const y0 = axisAtBottom ? h - PAD.bottom : valueToY(0, vmin, vmax, h);
  drawAxes(ctx, w, h, yLabel, y0);

  // vertical lines at internal boundaries (union over all objects), dashed, full height
  const bts = [];
  state.objects.forEach((obj) => {
    intervalBounds(obj).forEach((b, i) => {
      if (i < obj.intervals.length - 1 && !bts.some((t) => Math.abs(t - b.end) < 1e-6)) {
        bts.push(b.end);
      }
    });
  });
  ctx.strokeStyle = GRAY;
  ctx.setLineDash([5, 4]);
  for (const bt of bts) {
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
    ctx.moveTo(PAD.left, valueToY(0, vmin, vmax, h));
    ctx.lineTo(w - PAD.right, valueToY(0, vmin, vmax, h));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // dashed reference lines at the special values, with tick + value on the y-axis
  const specials = [];
  series.forEach((s) => specials.push(...s.specials));
  if (specials.length) {
    const ordered = [...specials].sort((p, q) => p.v - q.v);
    const axisNumYs = [], nameYs = [];
    for (const sp of ordered) {
      if (sp.v === null || Math.abs(sp.v) <= 1e-9 || sp.v <= vmin || sp.v >= vmax) continue;
      const py = valueToY(sp.v, vmin, vmax, h);
      ctx.strokeStyle = sp.color;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, py);
      ctx.lineTo(w - PAD.right, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // tick on the y-axis
      ctx.strokeStyle = "#3a4152";
      ctx.beginPath();
      ctx.moveTo(PAD.left - 4, py);
      ctx.lineTo(PAD.left, py);
      ctx.stroke();
      // numeric value on the y-axis (skip if it would overlap another one)
      const ny = py + 4;
      if (!axisNumYs.some((y) => Math.abs(y - ny) < 13)) {
        ctx.fillStyle = "#3a4152";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(fmt(sp.v, 1), PAD.left - 7, ny);
        ctx.textAlign = "start";
        axisNumYs.push(ny);
      }
      // italic name at the right edge (flips below the line if crowded)
      let ly = py - 5;
      if (nameYs.some((y) => Math.abs(y - ly) < 13)) ly = py + 14;
      if (!nameYs.some((y) => Math.abs(y - ly) < 13)) {
        ctx.fillStyle = sp.color;
        ctx.font = "italic 12px Georgia, serif";
        ctx.textAlign = "right";
        ctx.fillText(sp.label, w - PAD.right - 2, ly);
        ctx.textAlign = "start";
        nameYs.push(ly);
      }
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

  // time marker t1: dark dashed line + one dot per object curve
  const tx = xOf(state.t1);
  ctx.strokeStyle = INK;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(tx, PAD.top);
  ctx.lineTo(tx, h - PAD.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
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

  const y = h / 2;

  // main line — same horizontal extent as the plots' t-axis
  ctx.strokeStyle = "#3a4152";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD.left - 4, y);
  ctx.lineTo(w - PAD.right + 6, y);
  ctx.stroke();
  ctx.lineWidth = 1;

  // endpoints t0 and t_end
  ctx.fillStyle = "#3a4152";
  for (const t of [state.t0, tEnd()]) {
    ctx.beginPath();
    ctx.arc(timeToX(t, w), y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = "italic 13px Georgia, serif";
  ctx.textAlign = "left";
  ctx.fillText("t = t₀", timeToX(state.t0, w) - 4, y - 12);
  ctx.textAlign = "right";
  ctx.fillText("t = t_f", timeToX(tEnd(), w) + 4, y - 12);
  ctx.textAlign = "start";

  // Δt labels (only unambiguous with a single object)
  if (state.objects.length === 1) {
    const bounds = intervalBounds(state.objects[0]);
    ctx.fillStyle = MUTE;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    bounds.forEach((b, i) => {
      const cx = (timeToX(b.start, w) + timeToX(b.end, w)) / 2;
      // skip labels that would collide with the t₁ marker label
      if (Math.abs(cx - timeToX(state.t1, w)) < 34) return;
      ctx.fillText("Δt" + (i + 1), cx, y - 8);
    });
    ctx.textAlign = "start";
  }

  // static boundary points (union over all objects) + their t values
  const bts = boundaryTimes();
  const bxs = bts.map((t) => timeToX(t, w));
  const labelYs = [];
  bts.forEach((t, i) => {
    ctx.fillStyle = GRAY;
    ctx.fillRect(bxs[i] - 4, y - 4, 8, 8);
    const ly = y + 20;
    if (!labelYs.some((yy) => Math.abs(yy - ly) < 13) &&
        !bxs.some((bx, j) => j !== i && Math.abs(bx - bxs[i]) < 16)) {
      ctx.fillStyle = MUTE;
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(fmt(t, 1), bxs[i], ly);
      ctx.textAlign = "start";
      labelYs.push(ly);
    }
  });

  // t1 marker (big circle)
  const mx = timeToX(state.t1, w);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(mx, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = INK;
  ctx.font = "italic 13px Georgia, serif";
  // keep the t₁ label clear of the t₀ / t_f corner labels
  const t1w = ctx.measureText("t = t₁").width;
  const tfW = ctx.measureText("t = t_f").width;
  const tfStart = timeToX(tEnd(), w) + 4 - tfW; // t_f label extends leftward
  const t0x = timeToX(state.t0, w);
  const t0End = t0x - 4 + ctx.measureText("t = t₀").width; // t0 label extends rightward
  let lx = mx, align = "center";
  if (lx + t1w / 2 > tfStart - 8) { lx = Math.min(mx - 10, tfStart - 10); align = "right"; }
  if (lx - t1w / 2 < t0End + 8) { lx = Math.max(mx + 10, t0End + 8); align = "left"; }
  ctx.textAlign = align;
  ctx.fillText("t = t₁", lx, y - 12);
  ctx.textAlign = "start";

  // tick marks (labels skipped where a boundary value is shown)
  const span = tEnd() - state.t0;
  const step = span > 20 ? 5 : span > 8 ? 2 : 1;
  ctx.strokeStyle = "#aab1c2";
  ctx.fillStyle = "#6b7280";
  ctx.font = "11px sans-serif";
  for (let t = Math.ceil(state.t0 / step) * step; t <= tEnd() + 1e-9; t += step) {
    const px = timeToX(t, w);
    ctx.beginPath();
    ctx.moveTo(px, y + 5);
    ctx.lineTo(px, y + 9);
    ctx.stroke();
    if (!bxs.some((bx) => Math.abs(bx - px) < 10)) {
      ctx.textAlign = "center";
      ctx.fillText(fmt(t, 0), px, y + 20);
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
function updateReadouts() {
  document.getElementById("out-t1").textContent = `${fmt(state.t1)} s`;
  const el = document.getElementById("readouts");
  el.innerHTML = "";
  state.objects.forEach((obj, i) => {
    const k = kinematics(obj, state.t1);
    const row = document.createElement("div");
    row.className = "readout-line";
    row.innerHTML =
      `<span class="chip" style="background:${COLORS[i]}"></span>` +
      `<b>${obj.name}</b> &nbsp;x = ${fmt(k.x)} m · u = ${fmt(k.u)} m/s · a = ${fmt(k.a)} m/s²`;
    el.appendChild(row);
  });
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
function buildIntervalsTable(table, obj) {
  table.innerHTML = "";
  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>#</th><th>Δt (s)</th><th>x (m)</th><th>v (m/s)</th><th>a (m/s²)</th><th></th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  obj.intervals.forEach((iv, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i + 1}</td>`;
    ["dt", "x", "v", "a"].forEach((key) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.5";
      input.value = numStr(iv[key]);
      if (i > 0 && key === "x") {
        input.disabled = true; // fixed by continuity
        input.title = "Fixed by continuity with the previous interval";
      } else {
        input.addEventListener("change", () => {
          const val = parseFloat(input.value);
          if (!isFinite(val)) return;
          onIntervalChange(obj, i, key, val);
        });
      }
      td.appendChild(input);
      tr.appendChild(td);
    });
    const tdDel = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn-remove";
    btn.textContent = "✕";
    btn.disabled = obj.intervals.length <= 1;
    btn.title = "Remove interval";
    btn.addEventListener("click", () => {
      obj.intervals.splice(i, 1);
      propagateIntervals(obj);
      buildObjectsUI();
      syncUI();
      renderAll();
    });
    tdDel.appendChild(btn);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
}

function buildObjectsUI() {
  const cont = document.getElementById("objects-container");
  cont.innerHTML = "";
  state.objects.forEach((obj, oi) => {
    const card = document.createElement("div");
    card.className = "object-card";

    const head = document.createElement("div");
    head.className = "object-head";
    head.innerHTML = `<span class="chip" style="background:${COLORS[oi]}"></span><b>Object ${obj.name}</b>`;
    const del = document.createElement("button");
    del.className = "btn-remove";
    del.textContent = "✕";
    del.title = "Remove object";
    del.disabled = state.objects.length <= 1;
    del.addEventListener("click", () => {
      state.objects.splice(oi, 1);
      state.t1 = Math.min(state.t1, tEnd());
      buildObjectsUI();
      syncUI();
      renderAll();
    });
    head.appendChild(del);
    card.appendChild(head);

    const table = document.createElement("table");
    table.className = "intervals-table";
    buildIntervalsTable(table, obj);
    card.appendChild(table);

    const addBtn = document.createElement("button");
    addBtn.className = "btn-small";
    addBtn.textContent = "+ Add interval";
    addBtn.addEventListener("click", () => {
      obj.intervals.push({ dt: 5, x: 0, v: 0, a: 0 });
      propagateIntervals(obj);
      buildObjectsUI();
      syncUI();
      renderAll();
    });
    card.appendChild(addBtn);

    const stats = document.createElement("div");
    stats.className = "stats";
    renderIntervalStats(stats, obj);
    card.appendChild(stats);

    cont.appendChild(card);
  });
  document.getElementById("btn-add-object").disabled = state.objects.length >= MAX_OBJECTS;
  buildLegend();
}

function buildLegend() {
  const el = document.getElementById("legend-objects");
  el.innerHTML = "";
  state.objects.forEach((obj, i) => {
    const d = document.createElement("div");
    d.className = "legend-item";
    d.innerHTML = `<span class="lg" style="border-top-color:${COLORS[i]}"></span>Object ${obj.name} — curve, dots and its special values`;
    el.appendChild(d);
  });
}

function onIntervalChange(obj, i, key, val) {
  const iv = obj.intervals[i];
  if (key === "dt") val = Math.max(MIN_DT, val);
  iv[key] = val;
  propagateIntervals(obj);
  state.t1 = Math.min(Math.max(state.t1, state.t0), tEnd());
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
  const n = state.objects.length;
  state.objects.push({
    name: OBJ_NAMES[n],
    intervals: [{ dt: 5, x: 0, v: 2, a: 0 }, { dt: 5, x: 0, v: 2, a: 0 }],
  });
  propagateAll();
  buildObjectsUI();
  syncUI();
  renderAll();
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
  state.t1 = Math.min(Math.max(state.t1, state.t0), tEnd());

  drawTimeline(document.getElementById("timeline"));
  if (state.show.x) drawPlot(document.getElementById("plot-x"), "x", makeSeries("x"));
  if (state.show.u) drawPlot(document.getElementById("plot-u"), "u", makeSeries("u"));
  if (state.show.a) drawPlot(document.getElementById("plot-a"), "a", makeSeries("a"));
  if (state.show.track) drawTrack(document.getElementById("track"));
  updateReadouts();
  scheduleSave();
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
    speed: state.speed,
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
    speed: isFinite(s.speed) ? Math.max(0.25, Math.min(3, s.speed)) : 1,
    axisZero: s.axisZero !== false,
    show: {
      x: sh("x", true), u: sh("u", true), a: sh("a", true),
      legend: sh("legend", false), track: sh("track", false),
    },
    objects: [],
  };
  for (let i = 0; i < Math.min(MAX_OBJECTS, s.objects.length); i++) {
    const o = s.objects[i];
    if (!o || !Array.isArray(o.intervals) || !o.intervals.length) continue;
    out.objects.push({
      name: OBJ_NAMES[i],
      intervals: o.intervals.slice(0, 8).map((iv) => ({
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
  t0El.value = clean.t0;
  speedEl.value = clean.speed;
  document.getElementById("out-speed").textContent = `${fmt(clean.speed, 1)}×`;
  document.getElementById("in-axis-zero").checked = clean.axisZero;
  ["x", "u", "a", "legend", "track"].forEach((k) => {
    document.getElementById("show-" + k).checked = clean.show[k];
    const el = k === "legend" ? document.getElementById("legend-card")
      : k === "track" ? document.getElementById("track-card")
      : document.getElementById("row-" + k);
    el.style.display = clean.show[k] ? "" : "none";
  });
  propagateAll();
  buildObjectsUI();
  syncUI();
  renderAll();
  return true;
}

// ---------------------------------------------------------------------------
// Interaction: dragging on the timeline
// ---------------------------------------------------------------------------
const timelineCanvas = document.getElementById("timeline");
let draggingT1 = false;

timelineCanvas.addEventListener("pointerdown", (e) => {
  draggingT1 = true;
  timelineCanvas.setPointerCapture(e.pointerId);
});
timelineCanvas.addEventListener("pointermove", (e) => {
  const rect = timelineCanvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  if (draggingT1) {
    state.t1 = xToTime(px, rect.width);
    renderAll();
  } else {
    timelineCanvas.style.cursor = Math.abs(px - timeToX(state.t1, rect.width)) < 14 ? "grab" : "default";
  }
});
timelineCanvas.addEventListener("pointerup", () => (draggingT1 = false));

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
const t0El = document.getElementById("in-t0");
t0El.addEventListener("change", () => {
  const v = parseFloat(t0El.value);
  if (!isFinite(v)) return;
  state.t0 = v;
  state.t1 = Math.min(Math.max(state.t1, state.t0), tEnd());
  renderAll();
});


const speedEl = document.getElementById("in-speed");
speedEl.addEventListener("input", () => {
  state.speed = parseFloat(speedEl.value);
  document.getElementById("out-speed").textContent = `${fmt(state.speed, 1)}×`;
});

document.getElementById("in-axis-zero").addEventListener("change", (e) => {
  state.axisZero = e.target.checked;
  renderAll();
});

function setPanelVisible(kind, visible) {
  state.show[kind] = visible;
  const el = kind === "legend" ? document.getElementById("legend-card")
    : kind === "track" ? document.getElementById("track-card")
    : document.getElementById("row-" + kind);
  el.style.display = visible ? "" : "none";
  renderAll();
}
["x", "u", "a", "legend", "track"].forEach((kind) => {
  document.getElementById("show-" + kind).addEventListener("change", (e) =>
    setPanelVisible(kind, e.target.checked));
});

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------
let rafId = null;
let lastTs = null;

function tick(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = ((ts - lastTs) / 1000) * state.speed;
  lastTs = ts;
  state.t1 += dt;
  if (state.t1 >= tEnd()) state.t1 = state.t0; // loop
  renderAll();
  if (state.playing) rafId = requestAnimationFrame(tick);
}

const playBtn = document.getElementById("btn-play");
playBtn.addEventListener("click", () => {
  state.playing = !state.playing;
  playBtn.textContent = state.playing ? "⏸ Pause" : "▶ Play";
  if (state.playing) {
    if (state.t1 >= tEnd() - 1e-9) state.t1 = state.t0;
    lastTs = null;
    rafId = requestAnimationFrame(tick);
  } else {
    cancelAnimationFrame(rafId);
  }
});

document.getElementById("btn-reset").addEventListener("click", () => {
  state.playing = false;
  playBtn.textContent = "▶ Play";
  cancelAnimationFrame(rafId);
  state.t1 = state.t0 + (tEnd() - state.t0) / 2;
  renderAll();
});

// ---------------------------------------------------------------------------
// Share: base64 export / import of the whole scenario
// ---------------------------------------------------------------------------
const codeOut = document.getElementById("out-code");
const codeIn = document.getElementById("in-code");

document.getElementById("btn-export").addEventListener("click", async () => {
  const code = btoa(unescape(encodeURIComponent(serializeState())));
  codeOut.value = code;
  const btn = document.getElementById("btn-export");
  let copied = false;
  try {
    await navigator.clipboard.writeText(code);
    copied = true;
  } catch (e) {
    codeOut.select(); // user can copy manually
  }
  const old = btn.textContent;
  btn.textContent = copied ? "Copied ✓" : "Select & copy";
  setTimeout(() => (btn.textContent = old), 1500);
});

document.getElementById("btn-import").addEventListener("click", () => {
  const code = codeIn.value.trim();
  if (!code) return;
  try {
    const json = decodeURIComponent(escape(atob(code)));
    if (applyState(JSON.parse(json))) codeIn.value = "";
    else alert("Invalid scenario code.");
  } catch (e) {
    alert("Invalid scenario code.");
  }
});

// ---------------------------------------------------------------------------
// Boot: restore the last saved scenario from localStorage (if any)
// ---------------------------------------------------------------------------
let restored = false;
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) restored = applyState(JSON.parse(raw));
} catch (e) { /* corrupted storage: fall back to defaults */ }
if (!restored) {
  propagateAll();
  buildObjectsUI();
  syncUI();
  // legend and track are hidden by default
  ["legend", "track"].forEach((k) => {
    document.getElementById(k === "legend" ? "legend-card" : "track-card").style.display = "none";
  });
}
window.addEventListener("resize", renderAll);
window.addEventListener("pagehide", saveState);
renderAll();