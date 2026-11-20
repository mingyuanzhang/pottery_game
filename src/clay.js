// Clay on a potter's wheel.
//
// The clay is a stack of thin horizontal rings ("rows"). Each row keeps a fixed
// volume of clay and stores its outer radius (and inner radius, once opened)
// for every angular sector, so the lump can be lopsided or dented. A row's
// thickness is always volume / cross-section area, so clay is incompressible:
// squeeze a row narrower and it grows taller, press it down and it spreads.
// Hands only ever change radii; height follows from the conservation of clay.
// Units are millimetres. Angles are radians in the clay's own (spinning) frame.

export const SECTORS = 72;
export const ROW_H = 2;
export const MIN_WALL = 3;
export const MIN_FLOOR = 6;
export const MIN_HOLE = 0.8;
export const DENSITY = 0.0019; // grams per cubic millimetre, wet clay
export const TOOL_SIZES = { palms: 32, finger: 8, thumb: 8, pull: 7, ribHalf: 28, ribCorner: 6, pressHalf: 55 };

const TAU = Math.PI * 2;
const DTH = TAU / SECTORS;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

export function randomGenerator(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function sectorAngle(k) { return (k + 0.5) * DTH; }

function rowArea(row) {
  let sum = 0;
  const { ro, ri } = row;
  for (let k = 0; k < SECTORS; k++) sum += ro[k] * ro[k] - (ri ? ri[k] * ri[k] : 0);
  return 0.5 * DTH * sum;
}
const mean = a => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k]; return s / a.length; };
const max = a => { let m = -Infinity; for (let k = 0; k < a.length; k++) if (a[k] > m) m = a[k]; return m; };
const min = a => { let m = Infinity; for (let k = 0; k < a.length; k++) if (a[k] < m) m = a[k]; return m; };

export class Clay {
  constructor(options = {}) { this.reset(options); }

  reset({ mass = 1000, seed = 1 } = {}) {
    const random = randomGenerator(seed);
    const R = 56 * Math.cbrt(mass / 1000);
    const n = Math.round(1.05 * R / ROW_H);
    const dir0 = random() * TAU, lean = 0.1 + random() * 0.08;
    const p2 = random() * TAU, p3 = random() * TAU;
    const noise = Array.from({ length: n }, () => Float64Array.from({ length: SECTORS }, () => random() - 0.5));
    this.rows = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      let base = R * (1 - 0.1 * t);
      if (t > 0.4) base *= Math.sqrt(Math.max(0.08, 1 - ((t - 0.4) / 0.64) ** 2));
      const offset = 3 + R * lean * t; // slapped down off-centre, worse toward the top
      const dir = dir0 + t * 1.4;
      const ro = new Float64Array(SECTORS);
      for (let k = 0; k < SECTORS; k++) {
        const a = sectorAngle(k);
        const lumpy = (noise[i][k] + noise[i][(k + 1) % SECTORS] + noise[Math.max(0, i - 1)][k]) / 3;
        ro[k] = Math.max(4, base + offset * Math.cos(a - dir) + 0.05 * R * Math.cos(2 * a + p2 + 2 * t) + 0.035 * R * Math.cos(3 * a + p3 - 3 * t) + 2.4 * lumpy);
      }
      this.rows.push({ v: 0, h: ROW_H, y0: 0, yc: 0, ro, ri: null });
    }
    let total = 0;
    for (const row of this.rows) { row.v = rowArea(row) * ROW_H; total += row.v; }
    const scale = (mass / DENSITY) / total;
    for (const row of this.rows) { row.v *= scale; for (let k = 0; k < SECTORS; k++) row.ro[k] *= Math.sqrt(scale); }
    this.angle = 0;
    this.wet = 1;
    this.version = (this.version || 0) + 1;
    this.relayout();
  }

  relayout() {
    let y = 0;
    for (const row of this.rows) {
      row.h = row.v / Math.max(rowArea(row), 1e-6);
      row.y0 = y;
      row.yc = y + row.h / 2;
      y += row.h;
    }
    this.height = y;
  }

  get volume() { let v = 0; for (const row of this.rows) v += row.v; return v; }
  firstHollow() { return this.rows.findIndex(row => row.ri); }

  snapshot() {
    return { wet: this.wet, rows: this.rows.map(r => ({ v: r.v, ro: r.ro.slice(), ri: r.ri ? r.ri.slice() : null })) };
  }
  restore(snap) {
    this.rows = snap.rows.map(r => ({ v: r.v, h: 0, y0: 0, yc: 0, ro: r.ro.slice(), ri: r.ri ? r.ri.slice() : null }));
    this.wet = snap.wet;
    this.relayout();
    this.version++;
  }

  wetten() { this.wet = 1; }

  // Advance the wheel by dt seconds at `spin` revolutions per second, with an
  // optional engaged tool { kind, r, y, alpha, gap } (alpha: world angle).
  step(dt, { spin = 0, tool = null } = {}) {
    const a0 = this.angle;
    const a1 = a0 + TAU * spin * dt;
    let result = { contact: 0 };
    if (tool) result = this.applyTool(tool, a0, a1, dt, spin);
    this.angle = a1 % TAU;
    if (result.contact > 0) {
      this.wet = Math.max(0, this.wet - dt * (0.004 + 0.003 * spin));
      this.version++;
    }
    return result;
  }

  // How much of each sector passed under a hand at world angle alpha while the
  // wheel turned from a0 to a1. A hand covers halfW radians either side.
  sectorWeights(alpha, a0, a1, halfW) {
    const w = new Float64Array(SECTORS);
    const sweep = Math.abs(a1 - a0);
    if (sweep + 2 * halfW >= TAU) return w.fill(1);
    const mid = alpha - (a0 + a1) / 2;
    for (let k = 0; k < SECTORS; k++) {
      const d = Math.abs(wrap(sectorAngle(k) - mid)) - sweep / 2;
      w[k] = d <= 0 ? 1 : d < halfW ? 0.5 * (1 + Math.cos(Math.PI * d / halfW)) : 0;
    }
    return w;
  }

  applyTool(tool, a0, a1, dt, spin) {
    const S = TOOL_SIZES;
    const speed = 30 + 75 * Math.min(1, this.wet * 1.6); // how fast clay yields, mm/s
    const H = this.height;
    const top = this.rows[this.rows.length - 1];
    const topInner = top.ri ? min(top.ri) : 0, topOuter = max(top.ro);
    const sweep = Math.abs(a1 - a0);
    // On a fast wheel every part of the ring passes the hand many times a
    // second, so the hand works the whole ring a little each frame. Slowly
    // turning, only the clay that actually passes under the hand is touched.
    const fast = spin >= 0.5;
    const plan = (pad, r) => {
      const halfW = fast ? Math.PI : clamp(pad / Math.max(r, 15), 0.06, 0.8);
      const visit = !fast && spin > 0.05 ? Math.min(0.5, dt * TAU / Math.max(sweep + 2 * halfW, 1e-3)) : dt;
      return { halfW, maxD: speed * Math.max(dt, visit) };
    };
    const { kind, alpha } = tool;

    if (kind === 'press') {
      if (tool.r - S.pressHalf < topOuter && tool.r + S.pressHalf > topInner) return this.press(tool.y, speed * dt);
      return { contact: 0 };
    }
    if (kind === 'needle') return this.trim(tool, spin);

    if (kind === 'finger' || kind === 'palms') {
      const s = kind === 'palms' ? S.palms : S.finger;
      const rh = tool.r + s;
      if (tool.y > H - 0.3 * s) {
        // A fingertip over the top presses down; hands sliding off the top let go.
        if (kind === 'finger' && rh < topOuter && rh + s > topInner) return this.press(tool.y - s, speed * dt);
        return { contact: 0 };
      }
      const { halfW, maxD } = plan(s, tool.r);
      const W = this.sectorWeights(alpha, a0, a1, halfW);
      if (kind === 'palms') { const W2 = this.sectorWeights(alpha + Math.PI, a0, a1, halfW); for (let k = 0; k < SECTORS; k++) W[k] = Math.max(W[k], W2[k]); }
      return this.radial(tool.y - s, tool.y + s, W, maxD, spin, dy => ({ lo: rh - Math.sqrt(Math.max(0, s * s - dy * dy)) }));
    }

    if (kind === 'rib') {
      const half = S.ribHalf, c = S.ribCorner;
      const { halfW, maxD } = plan(20, tool.r);
      const W = this.sectorWeights(alpha, a0, a1, halfW);
      return this.radial(tool.y - half - c, tool.y + half + c, W, maxD, spin, dy => {
        const a = Math.abs(dy);
        return { lo: a <= half ? tool.r : tool.r + c - Math.sqrt(Math.max(0, c * c - (a - half) ** 2)) };
      });
    }

    if (kind === 'thumb') {
      const s = S.thumb, tip = Math.max(tool.y, MIN_FLOOR), c = tip + s;
      if (tip >= H) return { contact: 0 };
      const { halfW, maxD } = plan(s, Math.max(tool.r, s));
      const W = this.sectorWeights(alpha, a0, a1, halfW);
      return this.radial(tip, Infinity, W, maxD, spin, (dy, row) => {
        if (tool.r >= mean(row.ro) - MIN_WALL) return {};
        const y = row.yc;
        const li = y < c ? tool.r + Math.sqrt(Math.max(0, s * s - (c - y) ** 2)) : tool.r + s;
        return { li, open: true };
      });
    }

    if (kind === 'pull') {
      const s = S.pull, g = tool.gap ?? 6;
      const rin = tool.r - g / 2 - s, rout = tool.r + g / 2 + s;
      const { halfW, maxD } = plan(s, Math.max(tool.r, 15));
      const W = this.sectorWeights(alpha, a0, a1, halfW);
      return this.radial(tool.y - s, tool.y + s, W, maxD, spin, (dy, row) => {
        const bulge = Math.sqrt(Math.max(0, s * s - dy * dy));
        const out = { lo: rout - bulge };
        if (row.ri && rin > 0 && rin < mean(row.ro)) out.li = rin + bulge;
        return out;
      });
    }
    return { contact: 0 };
  }

  // Push radii toward the limits that limitsFor(dy, row) gives for rows whose
  // centre lies in [yLo, yHi]: li is the least inner radius (a hand inside),
  // lo the greatest outer radius (a hand outside).
  radial(yLo, yHi, W, maxD, spin, limitsFor) {
    let contact = 0;
    const toolY = (yLo + yHi) / 2;
    // Dry clay grabs the hands and twists the wall out of round.
    const drag = this.wet < 0.3 && spin > 0.1 ? (0.3 - this.wet) / 0.3 : 0;
    const twist = Math.random() * TAU;
    const touched = [];
    for (const row of this.rows) {
      if (row.yc < yLo || row.yc > yHi) continue;
      const { li = NaN, lo = NaN, open = false } = limitsFor(row.yc - toolY, row);
      if (Number.isNaN(li) && Number.isNaN(lo)) continue;
      if (open && !row.ri && li > MIN_HOLE + 0.5) row.ri = new Float64Array(SECTORS).fill(MIN_HOLE);
      const hasLi = !Number.isNaN(li) && row.ri, hasLo = !Number.isNaN(lo);
      touched.push(row);
      const { ro, ri } = row;
      for (let k = 0; k < SECTORS; k++) {
        const w = W[k];
        if (!w) continue;
        let o = ro[k], i = ri ? ri[k] : 0;
        if (hasLi && i < li) {
          // A hand inside stretches the wall outward; the ring keeps its area,
          // so the wall thins as it bellies out.
          const d = Math.min((li - i) * w, maxD), area = o * o - i * i;
          i += d;
          o = Math.max(Math.sqrt(area + i * i), i + MIN_WALL);
          contact += d;
        }
        if (hasLo && o > lo) {
          const d = Math.min((o - lo) * w, maxD);
          o -= d;
          contact += d;
          if (ri) {
            if (!hasLi) i -= d; // collaring: the whole wall moves in and rises
            if (o - i < MIN_WALL) {
              if (hasLi) o = i + MIN_WALL;
              else { i = Math.max(MIN_HOLE, o - MIN_WALL); o = Math.max(o, i + MIN_WALL); }
            }
            i = Math.max(i, MIN_HOLE);
          } else o = Math.max(o, 1.5);
          if (drag) o += 0.5 * drag * w * Math.cos(2 * sectorAngle(k) + twist);
        }
        if (ri) { i = Math.max(i, MIN_HOLE); o = Math.max(o, i + MIN_WALL); ri[k] = i; }
        ro[k] = Math.max(o, 1.5);
      }
    }
    if (contact > 0) { this.smooth(touched, W); this.settle(); }
    return { contact };
  }

  // Clay under a wet hand relaxes toward its neighbours above, below and around.
  smooth(touched, W) {
    const rows = this.rows, index = new Map(rows.map((row, i) => [row, i]));
    const relax = 0.3;
    const before = new Map(touched.map(row => [row, { ro: row.ro.slice(), ri: row.ri && row.ri.slice() }]));
    const old = row => before.get(row) || row;
    for (const row of touched) {
      const i = index.get(row), up = rows[i + 1] || row, dn = rows[i - 1] || row, o = old(row);
      for (const key of ['ro', 'ri']) {
        const a = o[key];
        if (!a) continue;
        const u = old(up)[key] || a, d = old(dn)[key] || a;
        for (let k = 0; k < SECTORS; k++) {
          const w = W[k];
          if (!w) continue;
          const avg = (u[k] + d[k] + a[(k + 1) % SECTORS] + a[(k + SECTORS - 1) % SECTORS]) / 4;
          row[key][k] = a[k] + (avg - a[k]) * relax * w;
        }
      }
      if (row.ri) for (let k = 0; k < SECTORS; k++) {
        row.ri[k] = Math.max(MIN_HOLE, row.ri[k]);
        row.ro[k] = Math.max(row.ro[k], row.ri[k] + MIN_WALL);
      }
    }
  }

  // Press down from above to the height cap, spreading the clay near the top.
  press(cap, maxD) {
    const H = this.height;
    const excess = H - Math.max(cap, MIN_FLOOR + 2);
    if (excess <= 0.01) return { contact: 0 };
    const e = Math.min(excess, maxD);
    const hollowTop = !!this.rows[this.rows.length - 1].ri;
    const lambda = hollowTop ? 10 : Math.max(18, H * 0.35);
    let denom = 0;
    const weights = this.rows.map(row => { const w = Math.exp(-(H - row.yc) / lambda); denom += w * row.h; return w; });
    const c = e / denom;
    this.rows.forEach((row, n) => {
      const f = Math.min(0.35, c * weights[n]);
      if (f < 1e-6) return;
      const grow = 1 / (1 - f); // cross-section area grows as the row gets thinner
      for (let k = 0; k < SECTORS; k++) {
        if (!row.ri) { row.ro[k] *= Math.sqrt(grow); continue; }
        const mid = (row.ro[k] + row.ri[k]) / 2, t = (row.ro[k] - row.ri[k]) * grow;
        row.ri[k] = Math.max(MIN_HOLE, mid - t / 2);
        row.ro[k] = row.ri[k] + Math.max(MIN_WALL, t);
      }
    });
    this.settle();
    return { contact: e };
  }

  // A needle through the wall of a spinning pot cuts off everything above it.
  trim(tool, spin) {
    const y = Math.max(tool.y, MIN_FLOOR + 4);
    if (y >= this.height - 0.5) return { contact: 0 };
    const index = this.rows.findIndex(row => row.y0 + row.h > y);
    const row = this.rows[index];
    if (tool.r > max(row.ro) + 1) return { contact: 0 };
    if (spin < 0.25) return { contact: 0.01, message: 'needs-spin' };
    const through = row.ri ? mean(row.ri) + 0.5 : 3;
    if (tool.r > through) return { contact: 0.01, message: 'needs-depth' };
    const frac = (y - row.y0) / row.h;
    this.rows.length = index + (frac > 0.25 ? 1 : 0);
    if (frac > 0.25) row.v *= frac;
    this.settle();
    return { contact: 1, cut: true };
  }

  settle() {
    this.enforceWalls();
    this.relayout();
    this.fixTopology();
    if (this.rows.some(row => row.h > 2.2 * ROW_H || row.h < 0.45 * ROW_H)) {
      this.remesh();
      this.fixTopology();
      this.enforceWalls();
      this.relayout();
    }
  }

  // Printable minimums: an open hole and a wall at least MIN_WALL thick.
  enforceWalls() {
    for (const { ro, ri } of this.rows) {
      for (let k = 0; k < SECTORS; k++) {
        if (ri) { ri[k] = Math.max(ri[k], MIN_HOLE); ro[k] = Math.max(ro[k], ri[k] + MIN_WALL); }
        else ro[k] = Math.max(ro[k], 1.5);
      }
    }
  }

  // Keep one floor at the bottom and one open cavity above it.
  fixTopology() {
    const rows = this.rows;
    let f = this.firstHollow();
    if (f < 0) return;
    let changed = false;
    while (f < rows.length && rows[f].y0 < MIN_FLOOR * 0.7) { rows[f].ri = null; f++; changed = true; }
    for (let i = f + 1; i < rows.length; i++) if (!rows[i].ri) { rows[i].ri = new Float64Array(SECTORS).fill(MIN_HOLE); changed = true; }
    if (changed) { this.enforceWalls(); this.relayout(); }
  }

  // Resample to evenly spaced rows, keeping the total volume.
  remesh() {
    const old = this.rows, H = this.height, V = this.volume;
    const n = Math.max(3, Math.round(H / ROW_H)), h = H / n;
    const rows = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const y = (i + 0.5) * h;
      while (j < old.length - 2 && old[j + 1].yc < y) j++;
      const a = old[j], b = old[Math.min(j + 1, old.length - 1)];
      const t = b === a ? 0 : clamp((y - a.yc) / (b.yc - a.yc), 0, 1);
      const ro = new Float64Array(SECTORS);
      for (let k = 0; k < SECTORS; k++) ro[k] = a.ro[k] + (b.ro[k] - a.ro[k]) * t;
      let ri = null;
      if (a.ri && b.ri) { ri = new Float64Array(SECTORS); for (let k = 0; k < SECTORS; k++) ri[k] = a.ri[k] + (b.ri[k] - a.ri[k]) * t; }
      else if (a.ri || b.ri) { const near = t < 0.5 ? a : b; if (near.ri) ri = near.ri.slice(); }
      const row = { v: 0, h, y0: 0, yc: 0, ro, ri };
      row.v = rowArea(row) * h;
      rows.push(row);
    }
    let total = 0;
    for (const row of rows) total += row.v;
    for (const row of rows) row.v *= V / total;
    this.rows = rows;
    this.relayout();
  }

  // The closed cross-section in sector k (or averaged over sectors when k < 0),
  // from the axis at the bottom, out and up the outside, over the top and down
  // the inside to the axis again. Every sector has the same number of points.
  profile(k = -1) {
    const R = row => k < 0 ? mean(row.ro) : row.ro[k];
    const I = row => k < 0 ? mean(row.ri) : row.ri[k];
    const rows = this.rows, top = rows[rows.length - 1], H = this.height;
    const p = [[0, 0], [R(rows[0]), 0]];
    for (const row of rows) p.push([R(row), row.yc]);
    p.push([R(top), H]);
    const f = this.firstHollow();
    if (f >= 0) {
      p.push([I(top), H]);
      for (let i = rows.length - 1; i >= f; i--) p.push([I(rows[i]), rows[i].yc]);
      p.push([I(rows[f]) * 0.55, rows[f].y0], [0, rows[f].y0]);
    } else {
      p.push([R(top) * 0.55, H], [0, H]);
    }
    return p;
  }

  stats() {
    const f = this.firstHollow();
    let maxR = 0, wall = Infinity, wobble = 0;
    for (const row of this.rows) {
      const hi = max(row.ro), lo = min(row.ro);
      maxR = Math.max(maxR, hi);
      wobble += (hi - lo) / 2;
      if (row.ri) for (let k = 0; k < SECTORS; k++) wall = Math.min(wall, row.ro[k] - row.ri[k]);
    }
    const volume = this.volume;
    return {
      height: this.height,
      diameter: 2 * maxR,
      wall: Number.isFinite(wall) ? wall : null,
      floor: f >= 0 ? this.rows[f].y0 : null,
      wobble: wobble / this.rows.length,
      volume,
      mass: volume * DENSITY,
      wet: this.wet,
    };
  }
}
