import { SECTORS, sectorAngle } from './clay.js';

// Revolve each sector's closed cross-section around the axis. The two ends of
// every profile sit on the axis and become single shared vertices, so the
// result is one closed, consistently wound surface: ready to draw or print.
export function buildMesh(clay) {
  const profiles = [];
  for (let k = 0; k < SECTORS; k++) profiles.push(clay.profile(k));
  const M = profiles[0].length;
  const ring = M - 2;
  const positions = new Float32Array((2 + SECTORS * ring) * 3);
  positions[1] = profiles[0][0][1];
  positions[4] = profiles[0][M - 1][1];
  for (let k = 0; k < SECTORS; k++) {
    const a = sectorAngle(k), c = Math.cos(a), s = Math.sin(a);
    for (let j = 1; j < M - 1; j++) {
      const [r, y] = profiles[k][j], o = (2 + k * ring + j - 1) * 3;
      positions[o] = r * c; positions[o + 1] = y; positions[o + 2] = r * s;
    }
  }
  const at = (k, j) => j === 0 ? 0 : j === M - 1 ? 1 : 2 + (k % SECTORS) * ring + j - 1;
  const indices = new Uint32Array(SECTORS * (2 * (M - 1) - 2) * 3);
  let n = 0;
  const tri = (a, b, c) => { indices[n++] = a; indices[n++] = b; indices[n++] = c; };
  for (let k = 0; k < SECTORS; k++) {
    for (let j = 0; j < M - 1; j++) {
      if (j > 0) tri(at(k, j), at(k, j + 1), at(k + 1, j));
      if (j + 1 < M - 1) tri(at(k + 1, j), at(k, j + 1), at(k + 1, j + 1));
    }
  }
  return { positions, indices, normals: vertexNormals(positions, indices) };
}

export function vertexNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { normals[i] += nx; normals[i + 1] += ny; normals[i + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

// Every edge should be used once in each direction by exactly two triangles.
export function checkClosed(mesh) {
  const directed = new Map();
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const key = indices[t + e] + ',' + indices[t + (e + 1) % 3];
      directed.set(key, (directed.get(key) || 0) + 1);
    }
  }
  let open = 0, repeated = 0;
  for (const [key, count] of directed) {
    if (count > 1) repeated++;
    const [a, b] = key.split(',');
    if (!directed.has(b + ',' + a)) open++;
  }
  return { triangles: indices.length / 3, edges: directed.size / 2, open, repeated, closed: open === 0 && repeated === 0 };
}

export function meshVolume(mesh) {
  const p = mesh.positions, idx = mesh.indices;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

// Binary STL in millimetres, Z up (the wheel's axis), sitting on Z = 0.
export function toSTL(mesh, scale = 1) {
  const { positions: p, indices: idx } = mesh;
  const count = idx.length / 3;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  const header = 'Thrown on the pottery wheel. Units: mm.';
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, count, true);
  let o = 84;
  const v = i => [p[i * 3] * scale, -p[i * 3 + 2] * scale, p[i * 3 + 1] * scale];
  for (let t = 0; t < idx.length; t += 3) {
    const a = v(idx[t]), b = v(idx[t + 1]), c = v(idx[t + 2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const x of [nx, ny, nz, ...a, ...b, ...c]) { view.setFloat32(o, x, true); o += 4; }
    view.setUint16(o, 0, true); o += 2;
  }
  return buffer;
}
