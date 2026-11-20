import { Clay, TOOL_SIZES } from './clay.js';
import { buildMesh, checkClosed, toSTL } from './mesh.js';
import { createRenderer, add, scale, cross, norm, sub, dot } from './render.js';

const TOOLS = [
  { id: 'palms', key: '1', name: 'Palms', hint: 'Centre & cone: squeeze both sides' },
  { id: 'press', key: '2', name: 'Press', hint: 'Push the top down to spread it' },
  { id: 'thumb', key: '3', name: 'Thumb', hint: 'Open: press into the centre, then drag out' },
  { id: 'pull', key: '4', name: 'Pull', hint: 'Pinch the wall and lift: thinner and taller' },
  { id: 'finger', key: '5', name: 'Finger', hint: 'Push the outside in: necks and grooves' },
  { id: 'rib', key: '6', name: 'Rib', hint: 'Straighten and smooth the outside' },
  { id: 'needle', key: '7', name: 'Needle', hint: 'Through the wall of a spinning pot: trim the rim' },
];
const BODIES = { terracotta: [0.69, 0.4, 0.27], stoneware: [0.6, 0.56, 0.5], porcelain: [0.86, 0.84, 0.8] };
const GLAZES = [
  { id: 'celadon', name: 'Celadon', color: [0.56, 0.72, 0.62] },
  { id: 'tenmoku', name: 'Tenmoku', color: [0.22, 0.12, 0.08] },
  { id: 'cobalt', name: 'Cobalt', color: [0.16, 0.26, 0.58] },
  { id: 'shino', name: 'Shino', color: [0.9, 0.82, 0.72] },
  { id: 'ash', name: 'Ash', color: [0.62, 0.6, 0.42] },
];
const SKIN = [0.85, 0.64, 0.52], WOOD = [0.6, 0.4, 0.22], STEEL = [0.78, 0.8, 0.82];
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

class App {
  constructor() {
    this.canvas = $('view');
    this.renderer = createRenderer(this.canvas);
    this.body = 'terracotta';
    this.mass = 1000;
    this.clay = new Clay({ mass: this.mass, seed: Date.now() % 100000 });
    this.tool = 'palms';
    this.gap = 6;
    this.rpm = 120;
    this.spinning = false;
    this.spin = 0; // actual revolutions per second, eased
    this.cursor = null; // { r, y, s, alpha }
    this.engaged = false;
    this.strokeContact = 0;
    this.orbit = null;
    this.cam = { yaw: 0, pitch: 0.36, dist: 620 };
    this.view = { height: 120 }; // eases toward the pot's height so it stays framed
    this.glaze = null;
    this.undo = [];
    this.meshVersion = -1;
    this.lastUi = 0;
    this.message = { text: '', until: 0 };
    this.buildUi();
    this.bindInput();
    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
  }

  // ---------- camera and picking ----------
  camera() {
    const { yaw, pitch } = this.cam;
    const lift = Math.max(1, this.view.height / 190);
    const dist = this.cam.dist * lift, target = [0, this.view.height * 0.5 + 25, 0];
    const eye = add(target, [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)]);
    return { eye, target, fov: 40 * Math.PI / 180 };
  }

  // Cast the pointer onto the vertical plane through the axis that faces the
  // camera. Distance from the axis is r; the hand works on that side.
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const { eye, target, fov } = this.camera();
    const f = norm(sub(target, eye)), right = norm(cross(f, [0, 1, 0])), up = cross(right, f);
    const x = ((clientX - rect.left) / rect.width) * 2 - 1, y = 1 - ((clientY - rect.top) / rect.height) * 2;
    const t = Math.tan(fov / 2);
    const dir = norm(add(f, add(scale(right, x * t * rect.width / rect.height), scale(up, y * t))));
    const n = norm([f[0], 0, f[2]]);
    const denom = dot(dir, n);
    if (Math.abs(denom) < 1e-4) return null;
    const p = add(eye, scale(dir, -dot(eye, n) / denom));
    const s = dot(p, right);
    const side = s >= 0 ? right : scale(right, -1);
    return { r: clamp(Math.abs(s), 0, 320), s, y: clamp(p[1], -20, 420), alpha: Math.atan2(side[2], side[0]) };
  }

  // ---------- hands ----------
  handParts() {
    const c = this.cursor;
    if (!c || this.glaze) return [];
    const parts = [];
    const S = TOOL_SIZES;
    const frame = alpha => {
      const U = [Math.cos(alpha), 0, Math.sin(alpha)], V = [0, 1, 0], W = cross(U, V);
      return (r, y, t, ra, rb, rc, tilt = 0, color = SKIN) => {
        const u = add(scale(U, Math.cos(tilt)), scale(V, Math.sin(tilt))), v = add(scale(U, -Math.sin(tilt)), scale(V, Math.cos(tilt)));
        parts.push({ c: add(add(scale(U, r), scale(V, y)), scale(W, t)), u, v, w: W, radii: [ra, rb, rc], color });
      };
    };
    const e = frame(c.alpha), { r, y } = c;
    const finger = (e, rh, y, s) => {
      e(rh, y, 0, s, s, s);
      e(rh + 24, y + 4, 0, 26, s * 1.05, s * 1.1, 0.18);
      e(rh + 40, y - 9, 14, 20, s, s * 1.05, -0.35);
      e(rh + 38, y - 12, -12, 18, s * 0.95, s, -0.45);
      e(rh + 72, y + 12, 2, 30, 14, 34, 0.3);
      e(rh + 46, y + 26, -20, 22, 8, 8, 0.6);
    };
    switch (this.tool) {
      case 'palms': for (const a of [c.alpha, c.alpha + Math.PI]) {
        const h = frame(a), rh = r + S.palms;
        h(rh + 6, y, 0, S.palms + 6, 40, 42);
        h(rh - 10, y + 6, 46, 12, 34, 12, 0.15);
        h(rh - 10, y - 4, -46, 12, 32, 12, -0.1);
        h(rh + 20, y + 44, 18, 10, 24, 10, 0.5);
      } break;
      case 'press':
        e(r, y + 14, 0, 50, 14, 44);
        e(r + 48, y + 26, 34, 24, 8, 8, 0.4);
        e(r - 40, y + 8, -18, 26, 9, 10, -0.1);
        break;
      case 'thumb': {
        const tip = Math.max(y, 6);
        e(r, tip + 32, 0, 8.5, 32, 8.5);
        e(r + 30, tip + 76, 0, 34, 16, 34, -0.35);
        e(r + 62, tip + 44, 12, 9, 30, 9, 0.2);
        e(r + 64, tip + 46, -10, 9, 30, 9, 0.25);
      } break;
      case 'pull': {
        const s = S.pull, rin = r - this.gap / 2 - s, rout = r + this.gap / 2 + s;
        e(rin, y + 34, 0, s, 41, s);
        e(rin - 4, y + 92, 0, 18, 24, 30);
        finger(e, rout, y, s);
      } break;
      case 'finger': finger(e, r + S.finger, y, S.finger); break;
      case 'rib':
        e(r + 3, y, 0, 3, S.ribHalf + 6, 30, 0, WOOD);
        e(r + 30, y, -4, 22, 30, 15);
        e(r + 16, y + 16, 18, 16, 8, 8, 0.1);
        break;
      case 'needle':
        e(r + 60, y, 0, 60, 1.3, 1.3, 0, STEEL);
        e(r + 132, y, 0, 16, 5.5, 5.5, 0, WOOD);
        e(r + 150, y + 6, 0, 26, 16, 22, 0.1);
        break;
    }
    const alpha = this.engaged ? 1 : 0.42;
    for (const p of parts) p.alpha = alpha;
    return parts;
  }

  // ---------- loop ----------
  frame(now) {
    const dt = Math.min(0.033, (now - this.last) / 1000);
    this.last = now;
    // Reframe only between strokes, so the plane under the hand holds still.
    if (!this.engaged) this.view.height += (Math.max(120, this.clay.height) - this.view.height) * Math.min(1, dt * 3);
    const target = this.spinning ? this.rpm / 60 : 0;
    this.spin += clamp(target - this.spin, -2.5 * dt, 2.5 * dt);
    const c = this.cursor;
    const tool = this.engaged && c && !this.glaze ? { kind: this.tool, r: c.r, y: c.y, alpha: c.alpha, gap: this.gap } : null;
    const result = this.clay.step(dt, { spin: this.spin, tool });
    this.strokeContact += result.contact;
    if (result.cut) this.say('Rim trimmed.');
    if (result.message === 'needs-spin') this.say('Start the wheel (Space) to trim with the needle.');
    if (result.message === 'needs-depth') this.say('Push the needle right through the wall.');
    if (tool && this.clay.wet < 0.3 && this.spin > 0.1) this.say('The clay is drying and dragging. Add water (W).');
    if (this.clay.version !== this.meshVersion) {
      this.meshVersion = this.clay.version;
      this.mesh = buildMesh(this.clay);
      this.renderer.setClay(this.mesh);
    }
    const glaze = this.glaze && GLAZES.find(g => g.id === this.glaze);
    this.renderer.render({
      camera: this.camera(),
      angle: this.clay.angle,
      baseRadius: this.clay.stats().diameter / 2,
      clayColor: glaze ? glaze.color : BODIES[this.body],
      wet: glaze ? 0 : this.clay.wet,
      gloss: glaze ? 1 : 0,
      hands: this.handParts(),
    });
    if (now - this.lastUi > 90) { this.lastUi = now; this.updateUi(now); }
    requestAnimationFrame(t => this.frame(t));
  }

  // ---------- actions ----------
  say(text) { if (this.message.text !== text || performance.now() > this.message.until) this.message = { text, until: performance.now() + 2600 }; }
  setTool(id) {
    this.tool = id;
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === id);
    $('gap-row').hidden = id !== 'pull';
  }
  toggleWheel() { this.spinning = !this.spinning; }
  water() { this.clay.wetten(); this.say('Water on. The clay slides again.'); }
  doUndo() {
    const snap = this.undo.pop();
    if (snap) { this.clay.restore(snap); this.say('Undone.'); } else this.say('Nothing to undo.');
  }
  newClay(mass = this.mass) {
    this.undo.push(this.clay.snapshot());
    this.mass = mass;
    this.clay.reset({ mass, seed: Math.floor(Math.random() * 1e6) });
    this.glaze = null;
    this.refreshGlaze();
    this.say(`A fresh ${mass >= 1000 ? (mass / 1000) + ' kg' : mass + ' g'} lump, slapped down off-centre. Centre it first.`);
  }
  setGlaze(id) { this.glaze = this.glaze === id ? null : id; this.engaged = false; this.refreshGlaze(); }
  refreshGlaze() { for (const b of document.querySelectorAll('.swatch')) b.classList.toggle('active', b.dataset.glaze === this.glaze); }

  exportSTL() {
    const mesh = buildMesh(this.clay);
    const check = checkClosed(mesh);
    const pct = clamp(Number($('scale').value) || 100, 1, 1000);
    const blob = new Blob([toSTL(mesh, pct / 100)], { type: 'model/stl' });
    const a = document.createElement('a');
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    a.download = `pot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.stl`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    const s = this.clay.stats(), k = pct / 100;
    this.lastExport = { name: a.download, bytes: blob.size, check };
    this.say(`Saved ${a.download}: ${(s.diameter * k).toFixed(0)} × ${(s.diameter * k).toFixed(0)} × ${(s.height * k).toFixed(0)} mm, ${check.triangles.toLocaleString()} triangles${check.closed ? ', watertight' : ''}.`);
  }

  // ---------- UI ----------
  buildUi() {
    $('tools').innerHTML = TOOLS.map(t => `<button class="tool" data-tool="${t.id}" title="${t.hint}"><kbd>${t.key}</kbd><span class="tool-name">${t.name}</span><span class="tool-hint">${t.hint}</span></button>`).join('');
    $('swatches').innerHTML = GLAZES.map(g => `<button class="swatch" data-glaze="${g.id}" title="${g.name}" style="--c: rgb(${g.color.map(v => Math.round(v * 255)).join(',')})"><span></span>${g.name}</button>`).join('');
    for (const b of document.querySelectorAll('.tool')) b.onclick = () => this.setTool(b.dataset.tool);
    for (const b of document.querySelectorAll('.swatch')) b.onclick = () => this.setGlaze(b.dataset.glaze);
    $('wheel-button').onclick = () => this.toggleWheel();
    $('rpm').oninput = e => { this.rpm = Number(e.target.value); };
    $('gap').oninput = e => { this.gap = Number(e.target.value); };
    $('water-button').onclick = () => this.water();
    $('undo-button').onclick = () => this.doUndo();
    $('new-button').onclick = () => this.newClay(Number($('mass').value));
    $('body').onchange = e => { this.body = e.target.value; };
    $('export-button').onclick = () => this.exportSTL();
    $('help-close').onclick = () => { $('help').hidden = true; };
    $('help-button').onclick = () => { $('help').hidden = !$('help').hidden; };
    this.setTool(this.tool);
  }

  bindInput() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      $('help').hidden = true;
      if (e.button === 2 || e.button === 1 || e.shiftKey || e.altKey) { this.orbit = { x: e.clientX, y: e.clientY }; return; }
      if (e.button !== 0 || this.glaze) return;
      this.cursor = this.pick(e.clientX, e.clientY);
      this.undo.push(this.clay.snapshot());
      if (this.undo.length > 40) this.undo.shift();
      this.engaged = true;
      this.strokeContact = 0;
    });
    cv.addEventListener('pointermove', e => {
      if (this.orbit) {
        this.cam.yaw -= (e.clientX - this.orbit.x) * 0.006;
        this.cam.pitch = clamp(this.cam.pitch + (e.clientY - this.orbit.y) * 0.004, -0.05, 1.3);
        this.orbit = { x: e.clientX, y: e.clientY };
        return;
      }
      this.cursor = this.pick(e.clientX, e.clientY);
    });
    const release = () => {
      if (this.engaged && this.strokeContact === 0) this.undo.pop();
      this.engaged = false;
      this.orbit = null;
    };
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', release);
    cv.addEventListener('pointerleave', () => { if (!this.engaged) this.cursor = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.dist = clamp(this.cam.dist * Math.exp(e.deltaY * 0.001), 260, 1500); }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const tool = TOOLS.find(t => t.key === e.key);
      if (tool) { this.setTool(tool.id); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.doUndo(); return; }
      switch (e.key) {
        case ' ': e.preventDefault(); this.toggleWheel(); break;
        case 'ArrowUp': e.preventDefault(); this.rpm = clamp(this.rpm + 10, 0, 240); $('rpm').value = this.rpm; break;
        case 'ArrowDown': e.preventDefault(); this.rpm = clamp(this.rpm - 10, 0, 240); $('rpm').value = this.rpm; break;
        case 'ArrowLeft': this.cam.yaw += 0.15; break;
        case 'ArrowRight': this.cam.yaw -= 0.15; break;
        case '[': this.gap = clamp(this.gap - 1, 3, 20); $('gap').value = this.gap; break;
        case ']': this.gap = clamp(this.gap + 1, 3, 20); $('gap').value = this.gap; break;
        case 'w': case 'W': this.water(); break;
        case 'z': case 'Z': if (!e.metaKey && !e.ctrlKey) this.doUndo(); break;
        case 'e': case 'E': this.exportSTL(); break;
        case 'h': case 'H': case '?': $('help').hidden = !$('help').hidden; break;
        case 'Escape': $('help').hidden = true; break;
      }
    });
  }

  updateUi(now) {
    const s = this.clay.stats();
    $('wheel-button').textContent = this.spinning ? 'Stop wheel' : 'Start wheel';
    $('wheel-button').classList.toggle('on', this.spinning);
    $('rpm-label').textContent = `${Math.round(this.spin * 60)} / ${this.rpm} rpm`;
    $('gap-label').textContent = `${this.gap} mm`;
    $('water-fill').style.width = `${Math.round(s.wet * 100)}%`;
    $('water-fill').classList.toggle('dry', s.wet < 0.3);
    const fmt = (v, unit = 'mm') => v == null ? '—' : `${v.toFixed(v < 20 ? 1 : 0)} ${unit}`;
    $('stat-height').textContent = fmt(s.height);
    $('stat-width').textContent = fmt(s.diameter);
    $('stat-wall').textContent = fmt(s.wall);
    $('stat-floor').textContent = fmt(s.floor);
    $('stat-mass').textContent = `${Math.round(s.mass)} g`;
    $('stat-centre').textContent = s.wobble < 1 ? 'centred' : `${s.wobble.toFixed(1)} mm off`;
    $('stat-centre').classList.toggle('good', s.wobble < 1);
    $('toast').textContent = now < this.message.until ? this.message.text : '';
    $('toast').classList.toggle('show', now < this.message.until);
    this.drawSection(s);
  }

  // The cross-section, as if sliced through the axis facing you.
  drawSection(s) {
    const cv = $('section'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const R = Math.max(110, s.diameter / 2 + 20), Hm = Math.max(140, s.height + 30);
    const k = Math.min((w - 16) / (2 * R), (h - 24) / Hm);
    const X = r => w / 2 + r * k, Y = y => h - 12 - y * k;
    g.strokeStyle = 'rgba(255,240,220,0.12)';
    g.lineWidth = 1;
    for (let y = 0; y <= Hm; y += 50) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(w, Y(y)); g.stroke(); }
    g.fillStyle = 'rgba(255,240,220,0.35)';
    g.font = '10px ui-monospace, monospace';
    for (let y = 50; y <= Hm; y += 50) g.fillText(`${y}`, 4, Y(y) - 3);
    g.fillStyle = '#5d6063';
    g.fillRect(X(-150), Y(0), 300 * k, 5);
    const p = this.clay.profile(-1);
    const col = BODIES[this.body].map(v => Math.round(v * 255));
    g.fillStyle = `rgb(${col.join(',')})`;
    for (const sign of [1, -1]) {
      g.beginPath();
      p.forEach(([r, y], i) => (i ? g.lineTo : g.moveTo).call(g, X(sign * r), Y(y)));
      g.closePath();
      g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(0), Y(Hm)); g.stroke();
    g.setLineDash([]);
    const c = this.cursor;
    if (c && !this.glaze) {
      g.fillStyle = this.engaged ? '#ffd9a8' : 'rgba(255,217,168,0.5)';
      g.beginPath(); g.arc(X(c.s), Y(c.y), 4, 0, Math.PI * 2); g.fill();
    }
  }
}

function start() {
  try {
    const app = new App();
    window.pottery = { app };
  } catch (error) {
    $('fatal').hidden = false;
    $('fatal').textContent = `Sorry, the wheel could not start: ${error.message}`;
    throw error;
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
