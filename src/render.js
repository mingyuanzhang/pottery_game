import { vertexNormals } from './mesh.js';

// A small WebGL 2 renderer: one lit shader with a few material modes.
const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
uniform mat4 uModel, uVP;
uniform mat3 uNM;
out vec3 vWorld, vNormal, vLocal;
void main() {
  vLocal = aPos;
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = uNM * aNrm;
  gl_Position = uVP * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vWorld, vNormal, vLocal;
uniform vec3 uColor, uEye;
uniform int uMode;
uniform float uAlpha, uWet, uGloss, uBaseR;
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  vec3 base = uColor;
  float spec = 0.12, shine = 16.0;
  if (uMode == 0) {            // clay, in its own spinning frame
    float r = length(vLocal.xz), th = atan(vLocal.z, vLocal.x);
    float rings = sin(vLocal.y * 2.2 + noise(vec2(th * 5.0, vLocal.y * 0.08)) * 3.0);
    n = normalize(n + vec3(0.0, 1.0, 0.0) * rings * 0.07 * (1.0 - uGloss));
    float mott = noise(vec2(th * max(r, 4.0) * 0.12, vLocal.y * 0.12)) * 0.6 + noise(vec2(th * max(r, 4.0) * 0.5, vLocal.y * 0.5)) * 0.4;
    base *= mix(0.86 + 0.22 * mott, 0.97 + 0.06 * mott, uGloss);
    base *= mix(1.0, 0.74, uWet * (1.0 - uGloss));
    spec = mix(0.05, 0.5, max(uWet * 0.75, uGloss));
    shine = mix(10.0, 110.0, max(uWet * 0.45, uGloss));
  } else if (uMode == 1) {     // wheel head: rings, spoke marks and the clay's shadow
    float r = length(vLocal.xz), th = atan(vLocal.z, vLocal.x);
    base *= 0.92 + 0.08 * sin(r * 0.7);
    if (vLocal.y > -0.5) {
      if (r > 30.0 && abs(sin(th * 3.0)) < 0.025) base *= 0.55;
      if (abs(r - 110.0) < 0.8 || abs(r - 70.0) < 0.6) base *= 0.75;
      base *= mix(0.35, 1.0, smoothstep(uBaseR * 0.85, uBaseR * 1.5, r));
    }
    spec = 0.45; shine = 50.0;
  } else if (uMode == 3) {     // floor
    float r = length(vWorld.xz);
    base *= mix(0.55, 1.0, smoothstep(180.0, 700.0, r)) * (0.92 + 0.08 * noise(vWorld.xz * 0.02));
    base = mix(base, vec3(0.10, 0.085, 0.075), smoothstep(800.0, 2400.0, r));
    spec = 0.0;
  } else if (uMode == 2) {     // skin
    spec = 0.12; shine = 12.0;
  }
  vec3 L = normalize(vec3(-0.45, 0.85, 0.55));
  vec3 F = normalize(vec3(0.7, 0.25, -0.4));
  float diff = max(dot(n, L), 0.0), fill = max(dot(n, F), 0.0) * 0.3;
  float hemi = 0.5 + 0.5 * n.y;
  vec3 ambient = mix(vec3(0.20, 0.16, 0.14), vec3(0.44, 0.42, 0.40), hemi);
  vec3 h = normalize(L + v);
  float s = pow(max(dot(n, h), 0.0), shine) * spec * (shine + 8.0) / 24.0;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * (uMode == 0 ? 0.12 + 0.2 * uGloss : 0.05);
  vec3 c = base * (ambient + diff * vec3(1.0, 0.95, 0.86) * 0.85 + fill * vec3(0.7, 0.8, 1.0)) + s * vec3(1.0, 0.97, 0.9) + rim;
  c = c / (1.0 + c * 0.35);
  outColor = vec4(pow(c, vec3(0.92)), uAlpha);
}`;

// ---- small matrix helpers (column-major) ----
export const mat4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  },
  lookAt(eye, target, up) {
    const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  },
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  // Turns clay-frame angle θ into world angle θ + phi about the vertical axis.
  spin(phi) { const c = Math.cos(phi), s = Math.sin(phi); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; },
  identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
};
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => scale(a, 1 / (Math.hypot(...a) || 1));
const nm3 = m => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];

// Revolve an (r, y) polyline about the vertical axis.
export function lathe(profile, segments) {
  const M = profile.length, positions = new Float32Array(M * segments * 3), indices = [];
  for (let s = 0; s < segments; s++) {
    const a = s / segments * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    profile.forEach(([r, y], j) => { const o = (s * M + j) * 3; positions[o] = r * c; positions[o + 1] = y; positions[o + 2] = r * sn; });
    const s1 = (s + 1) % segments;
    for (let j = 0; j < M - 1; j++) indices.push(s * M + j, s * M + j + 1, s1 * M + j, s1 * M + j, s * M + j + 1, s1 * M + j + 1);
  }
  const idx = new Uint32Array(indices);
  return { positions, indices: idx, normals: vertexNormals(positions, idx) };
}

function sphere(w, h) {
  const positions = [], indices = [];
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) {
    const t = j / h * Math.PI, p = i / w * Math.PI * 2;
    positions.push(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p));
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = j * (w + 1) + i, b = a + w + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const p = new Float32Array(positions);
  return { positions: p, indices: new Uint32Array(indices), normals: p.slice() };
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL 2 is not available in this browser.');
  const shader = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = {};
  for (const name of ['uModel', 'uVP', 'uNM', 'uColor', 'uEye', 'uMode', 'uAlpha', 'uWet', 'uGloss', 'uBaseR']) U[name] = gl.getUniformLocation(prog, name);

  function mesh(data) {
    const vao = gl.createVertexArray(), pb = gl.createBuffer(), nb = gl.createBuffer(), ib = gl.createBuffer();
    const m = {
      count: 0,
      upload(d) {
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, d.positions, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, d.normals, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.indices, gl.DYNAMIC_DRAW);
        gl.bindVertexArray(null);
        m.count = d.indices.length;
      },
      draw() { gl.bindVertexArray(vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); },
    };
    if (data) m.upload(data);
    return m;
  }

  const meshes = {
    sphere: mesh(sphere(28, 18)),
    head: mesh(lathe([[0, 0], [146, 0], [150, -2], [151, -8], [148, -20], [0, -20]], 120)),
    pan: mesh(lathe([[170, -46], [236, -46], [244, -40], [250, 24], [256, 28], [262, 24], [254, -50], [170, -50]], 120)),
    body: mesh(lathe([[0, -50], [300, -50], [318, -60], [318, -78], [240, -110], [190, -130], [190, -400], [230, -420], [0, -420]], 80)),
    floor: mesh(lathe([[0, -420], [3200, -420]], 64)),
    clay: mesh(null),
  };

  function draw(m, { model = mat4.identity(), nm = null, color, mode = 4, alpha = 1, wet = 0, gloss = 0 }) {
    gl.uniformMatrix4fv(U.uModel, false, model);
    gl.uniformMatrix3fv(U.uNM, false, nm || nm3(model));
    gl.uniform3fv(U.uColor, color);
    gl.uniform1i(U.uMode, mode);
    gl.uniform1f(U.uAlpha, alpha);
    gl.uniform1f(U.uWet, wet);
    gl.uniform1f(U.uGloss, gloss);
    m.draw();
  }

  // An ellipsoid with orthonormal axes u, v, w and radii [a, b, c].
  function ellipsoid({ c, u, v, w, radii: [a, b, d] }) {
    return {
      model: [u[0] * a, u[1] * a, u[2] * a, 0, v[0] * b, v[1] * b, v[2] * b, 0, w[0] * d, w[1] * d, w[2] * d, 0, c[0], c[1], c[2], 1],
      nm: [u[0] / a, u[1] / a, u[2] / a, v[0] / b, v[1] / b, v[2] / b, w[0] / d, w[1] / d, w[2] / d],
    };
  }

  return {
    gl,
    meshes,
    setClay(data) { meshes.clay.upload(data); },
    render(scene) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.1, 0.085, 0.075, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.useProgram(prog);
      const { eye, target, fov } = scene.camera;
      const vp = mat4.mul(mat4.perspective(fov, w / h, 5, 8000), mat4.lookAt(eye, target, [0, 1, 0]));
      gl.uniformMatrix4fv(U.uVP, false, vp);
      gl.uniform3fv(U.uEye, eye);
      gl.uniform1f(U.uBaseR, scene.baseRadius);
      const turn = mat4.spin(scene.angle);
      draw(meshes.floor, { color: [0.36, 0.3, 0.26], mode: 3 });
      draw(meshes.body, { color: [0.2, 0.22, 0.24] });
      draw(meshes.pan, { color: [0.3, 0.33, 0.35] });
      draw(meshes.head, { model: turn, color: [0.55, 0.56, 0.57], mode: 1 });
      draw(meshes.clay, { model: turn, color: scene.clayColor, mode: 0, wet: scene.wet, gloss: scene.gloss });
      const solid = scene.hands.filter(p => p.alpha >= 1), ghost = scene.hands.filter(p => p.alpha < 1);
      for (const part of solid) draw(meshes.sphere, { ...ellipsoid(part), color: part.color, mode: 2 });
      if (ghost.length) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        for (const part of ghost) draw(meshes.sphere, { ...ellipsoid(part), color: part.color, mode: 2, alpha: part.alpha });
        gl.depthMask(true);
      }
    },
  };
}
