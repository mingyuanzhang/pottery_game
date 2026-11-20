// Real-browser check: installed Chrome (software WebGL when headless), driven
// over the DevTools protocol. Throws a pot with real mouse events and writes
// screenshots under artifacts/.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = ms => new Promise(r => setTimeout(r, ms));
// Set CHROME_PROFILE to attach to a Chrome you started yourself with
// --remote-debugging-port=0 --user-data-dir=$CHROME_PROFILE.
const external = process.env.CHROME_PROFILE;
const profile = external || mkdtempSync(join(tmpdir(), 'pottery-browser-'));
const browser = external ? null : spawn(chrome, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

const pending = new Map();
const errors = [];
let serial = 0, ws;
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function run(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
const shot = async name => { await delay(300); const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, name), Buffer.from(data, 'base64')); };
const key = async (key, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); };
const stats = () => run('window.pottery.app.clay.stats()');
// Screen position of a point (r, y) on the camera-facing plane, right side.
const screen = (r, y) => run(`(() => { const a = window.pottery.app, c = a.camera(); const cv = a.canvas.getBoundingClientRect();
  const f = [c.target[0]-c.eye[0], c.target[1]-c.eye[1], c.target[2]-c.eye[2]]; const fl = Math.hypot(...f); f.forEach((v,i)=>f[i]=v/fl);
  const R = [-f[2], 0, f[0]]; const rl = Math.hypot(...R); R.forEach((v,i)=>R[i]=v/rl);
  const U = [R[1]*f[2]-R[2]*f[1], R[2]*f[0]-R[0]*f[2], R[0]*f[1]-R[1]*f[0]];
  const p = [R[0]*${r}, ${y}, R[2]*${r}]; const d = [p[0]-c.eye[0], p[1]-c.eye[1], p[2]-c.eye[2]];
  const z = d[0]*f[0]+d[1]*f[1]+d[2]*f[2], t = Math.tan(c.fov/2), asp = cv.width/cv.height;
  const x = (d[0]*R[0]+d[1]*R[1]+d[2]*R[2]) / (z*t*asp), yy = (d[0]*U[0]+d[1]*U[1]+d[2]*U[2]) / (z*t);
  return [cv.left + (x+1)/2*cv.width, cv.top + (1-yy)/2*cv.height]; })()`);
async function drag(path, seconds) {
  const pts = [];
  for (const [r, y] of path) pts.push(await screen(r, y));
  const steps = Math.round(seconds * 30);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0][0], y: pts[0][1] });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const u = i / steps * (pts.length - 1), a = Math.min(Math.floor(u), pts.length - 2), t = u - a;
    const x = pts[a][0] + (pts[a + 1][0] - pts[a][0]) * t, y = pts[a][1] + (pts[a + 1][1] - pts[a][1]) * t;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await delay(33);
  }
  const end = pts[pts.length - 1];
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end[0], y: end[1], button: 'left', buttons: 0, clickCount: 1 });
}

try {
  let port;
  for (let i = 0; i < 300 && !port; i++) { try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {} await delay(100); }
  assert.ok(port, 'Chrome starts');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id) { const e = pending.get(m.id); pending.delete(m.id); m.error ? e.reject(Error(m.error.message)) : e.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(join(root, 'index.html')).href });
  for (let i = 0; i < 100 && !(await run('!!window.pottery')); i++) await delay(100);
  assert.ok(await run('!!window.pottery'), 'app starts from file://');
  await shot('01-help.png');
  await run('document.getElementById("help-close").click()');
  await shot('02-lump.png');

  await key(' ', 'Space', 32);
  await delay(1200);
  const s0 = await stats();
  await key('1', 'Digit1', 49);
  await drag([[95, 20], [40, 20], [38, 60], [36, 20]], 6);
  const s1 = await stats();
  console.log('centred', s0.wobble.toFixed(1), '->', s1.wobble.toFixed(1), 'height', s0.height.toFixed(0), '->', s1.height.toFixed(0));
  assert.ok(s1.wobble < s0.wobble / 2, 'palms centre the clay');
  await shot('03-centred.png');

  await key('3', 'Digit3', 51);
  await drag([[0, s1.height + 20], [0, 8], [0, 8], [24, 8]], 5);
  const s2 = await stats();
  console.log('opened floor', s2.floor?.toFixed(1), 'wall', s2.wall?.toFixed(1));
  assert.ok(s2.floor > 3, 'opening leaves a floor');
  await shot('04-opened.png');

  await key('w', 'KeyW', 87);
  await key('4', 'Digit4', 52);
  for (let pass = 0; pass < 3; pass++) {
    const mid = await run('(() => { const c = window.pottery.app.clay, row = c.rows[Math.floor(c.rows.length * 0.25)], m = a => a.reduce((x, y) => x + y) / a.length; return (m(row.ro) + m(row.ri)) / 2; })()');
    const h = (await stats()).height;
    await drag([[mid + 6, 14], [mid, 14], [mid, h + 15]], 5);
  }
  const s3 = await stats();
  console.log('pulled height', s3.height.toFixed(0), 'wall', s3.wall.toFixed(1));
  assert.ok(s3.height > s2.height * 1.3, 'pulling raises the wall');
  await shot('05-pulled.png');

  // Belly out from inside low down, then collar in a neck with a finger.
  const wallAt = y => run(`(() => { const c = window.pottery.app.clay, row = c.rows.find(r => r.yc > ${y}), m = a => a.reduce((x, y) => x + y) / a.length; return [m(row.ri), m(row.ro)]; })()`);
  let [ri, ro] = await wallAt(s3.height * 0.35);
  await drag([[(ri + ro) / 2, s3.height * 0.15], [(ri + ro) / 2 + 22, s3.height * 0.4], [(ri + ro) / 2 + 4, s3.height * 0.62]], 5);
  await key('5', 'Digit5', 53);
  const h3 = (await stats()).height;
  [ri, ro] = await wallAt(h3 * 0.8);
  await drag([[ro + 8, h3 * 0.8], [ro - 12, h3 * 0.8], [ro - 12, h3 * 0.82]], 3);
  await shot('06-shaped.png');

  await run('window.pottery.app.exportSTL()');
  const exp = await run('window.pottery.app.lastExport');
  console.log('export', exp.name, exp.bytes, 'bytes', exp.check.triangles, 'triangles, closed', exp.check.closed);
  assert.ok(exp.check.closed, 'exported mesh is watertight');
  assert.ok((await stats()).wall >= 3 - 1e-9, 'walls stay printable');
  await shot('07-exported.png');

  await run('window.pottery.app.setGlaze("celadon"); window.pottery.app.cam.pitch = 0.6');
  await shot('08-glazed.png');
  await run('window.pottery.app.setGlaze("celadon")');

  await key('z', 'KeyZ', 90);
  await delay(100);
  assert.ok(Math.abs((await stats()).height - h3) < 1, 'undo restores');

  await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1000, deviceScaleFactor: 1, mobile: false });
  await shot('09-narrow.png');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('Browser check passed. Screenshots are in artifacts/.');
} catch (error) {
  console.error(error); console.error('Page errors:', errors); process.exitCode = 1;
} finally {
  ws?.close();
  if (browser) { browser.kill(); await delay(300); rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); }
}
