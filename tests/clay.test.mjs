import test from 'node:test';
import assert from 'node:assert/strict';
import { Clay, MIN_FLOOR, MIN_WALL } from '../src/clay.js';
import { buildMesh, checkClosed, meshVolume, toSTL } from '../src/mesh.js';

const DT = 1 / 60;
// Move a tool linearly from one (r, y) to another over `seconds` at 2 rev/s.
function stroke(clay, kind, from, to, seconds, extra = {}) {
  const frames = Math.round(seconds / DT);
  let contact = 0;
  for (let f = 0; f <= frames; f++) {
    const t = f / frames;
    const tool = { kind, r: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t, alpha: 0, gap: 6, ...extra };
    contact += clay.step(DT, { spin: extra.spin ?? 2, tool }).contact;
    clay.wetten();
  }
  return contact;
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b}`);

// A centred, opened and pulled cylinder, as a player would make it.
function throwCylinder() {
  const clay = new Clay({ mass: 1000, seed: 7 });
  stroke(clay, 'palms', [80, 30], [40, 30], 3);
  stroke(clay, 'palms', [40, 30], [40, 30], 2);
  stroke(clay, 'thumb', [0, 120], [0, 10], 3);
  stroke(clay, 'thumb', [0, 10], [22, 10], 2);
  for (let pass = 0; pass < 3; pass++) {
    const s = clay.stats();
    const wall = clay.rows[Math.floor(clay.rows.length * 0.3)];
    const mid = (wall.ro.reduce((a, b) => a + b) + wall.ri.reduce((a, b) => a + b)) / (2 * wall.ro.length);
    stroke(clay, 'pull', [mid, 14], [mid, s.height + 10], 5, { gap: 6 });
  }
  return clay;
}

test('a fresh lump is off centre and weighs what was asked', () => {
  const clay = new Clay({ mass: 1000, seed: 3 });
  const s = clay.stats();
  close(s.mass, 1000, 0.001, 'mass');
  assert.ok(s.wobble > 3, `wobble ${s.wobble}`);
  assert.equal(s.floor, null);
});

test('palms on a spinning wheel centre the clay and cone it up', () => {
  const clay = new Clay({ mass: 1000, seed: 3 });
  const before = clay.stats();
  stroke(clay, 'palms', [90, 30], [45, 30], 3);
  stroke(clay, 'palms', [45, 30], [40, 90], 3);
  const after = clay.stats();
  assert.ok(after.wobble < before.wobble / 3, `wobble ${before.wobble} -> ${after.wobble}`);
  assert.ok(after.height > before.height * 1.2, `height ${before.height} -> ${after.height}`);
  close(after.volume, before.volume, 0.005, 'volume');
});

test('a finger on a still wheel only dents one side', () => {
  const clay = new Clay({ mass: 1000, seed: 3 });
  stroke(clay, 'palms', [90, 30], [50, 30], 2);
  const row = clay.rows.find(r => r.yc > 30);
  const before = row.ro.slice();
  stroke(clay, 'finger', [70, row.yc], [35, row.yc], 1, { spin: 0 });
  const changed = [...row.ro].filter((r, k) => before[k] - r > 1).length;
  assert.ok(changed > 0 && changed < row.ro.length / 3, `${changed} sectors dented`);
});

test('pressing down spreads the clay', () => {
  const clay = new Clay({ mass: 1000, seed: 3 });
  const before = clay.stats();
  stroke(clay, 'press', [0, before.height], [0, before.height - 30], 2);
  const after = clay.stats();
  assert.ok(after.height < before.height - 20);
  assert.ok(after.diameter > before.diameter);
  close(after.volume, before.volume, 0.005, 'volume');
});

test('opening leaves a floor, pulling raises a thin wall', () => {
  const clay = new Clay({ mass: 1000, seed: 7 });
  stroke(clay, 'palms', [80, 30], [40, 30], 3);
  stroke(clay, 'thumb', [0, 120], [0, 0], 3);
  const opened = clay.stats();
  assert.ok(opened.floor >= MIN_FLOOR * 0.7 && opened.floor < 15, `floor ${opened.floor}`);
  const pulled = throwCylinder().stats();
  assert.ok(pulled.height > opened.height * 1.3, `height ${opened.height} -> ${pulled.height}`);
  assert.ok(pulled.wall >= MIN_WALL - 1e-9 && pulled.wall < 12, `wall ${pulled.wall}`);
  close(pulled.volume, opened.volume, 0.01, 'volume');
});

test('the needle trims the rim only when it pierces a spinning wall', () => {
  const clay = throwCylinder();
  const h = clay.height;
  const top = clay.rows[clay.rows.length - 1];
  const inner = top.ri.reduce((a, b) => a + b) / top.ri.length;
  assert.equal(clay.step(DT, { spin: 0, tool: { kind: 'needle', r: inner, y: h - 10, alpha: 0 } }).cut, undefined);
  assert.ok(clay.step(DT, { spin: 2, tool: { kind: 'needle', r: inner - 2, y: h - 10, alpha: 0 } }).cut);
  assert.ok(Math.abs(clay.height - (h - 10)) < 2.5, `height ${clay.height}`);
});

test('dry clay twists the wall but never thinner than the minimum', () => {
  const clay = throwCylinder();
  const s = clay.stats();
  for (let f = 0; f < 600; f++) {
    clay.wet = 0;
    clay.step(DT, { spin: 2, tool: { kind: 'finger', r: s.diameter / 2 - 6, y: s.height * 0.5 + 20 * Math.sin(f / 30), alpha: 0 } });
  }
  assert.ok(clay.stats().wall >= MIN_WALL - 1e-9, `wall ${clay.stats().wall}`);
  assert.ok(checkClosed(buildMesh(clay)).closed);
});

test('undo restores the exact shape', () => {
  const clay = new Clay({ mass: 800, seed: 9 });
  const snap = clay.snapshot();
  const h = clay.height;
  stroke(clay, 'palms', [90, 30], [40, 30], 2);
  clay.restore(snap);
  assert.equal(clay.height, h);
});

test('the printable mesh is closed, outward facing and matches the clay', () => {
  for (const clay of [new Clay({ mass: 1000, seed: 1 }), throwCylinder()]) {
    const mesh = buildMesh(clay);
    const check = checkClosed(mesh);
    assert.ok(check.closed, JSON.stringify(check));
    close(meshVolume(mesh), clay.volume, 0.05, 'mesh volume');
    const stl = toSTL(mesh);
    assert.equal(stl.byteLength, 84 + 50 * check.triangles);
    assert.equal(new DataView(stl).getUint32(80, true), check.triangles);
  }
});
