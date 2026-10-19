// Independent estimator: shell(S, open top, t) = vol(S) - vol(cavity), cavity = Euclidean erosion by t of S' (S plus the open face extruded out by t).
// Squared-distance transform (Felzenszwalb) on a voxel grid; reported with both erosion shapes (ball = offset surfaces, cube = plane offset).
const h = 0.1, t = 2;
const X0 = -22, X1 = 22, Y0 = -17, Y1 = 17, Z0 = -8, Z1 = 20;
const nx = Math.round((X1 - X0) / h), ny = Math.round((Y1 - Y0) / h), nz = Math.round((Z1 - Z0) / h);
const inA = (x, y, z) => Math.abs(x) <= 20 && Math.abs(y) <= 15 && Math.abs(z) <= 5;
const inB = (x, y, z) => Math.abs(x) <= 10 && Math.abs(y) <= 10 && z >= 5 && z <= 15;
const inExt = (x, y, z) => Math.abs(x) <= 10 && Math.abs(y) <= 10 && z >= 15 && z <= 17; // open face extruded out by t
const mat = new Uint8Array(nx * ny * nz);
const idx = (i, j, k) => (k * ny + j) * nx + i;
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const x = X0 + (i + 0.5) * h, y = Y0 + (j + 0.5) * h, z = Z0 + (k + 0.5) * h;
  mat[idx(i, j, k)] = (inA(x, y, z) || inB(x, y, z) || inExt(x, y, z)) ? 1 : 0;
}
const inS = (x, y, z) => inA(x, y, z) || inB(x, y, z);
// squared euclid distance (in voxels) to nearest complement voxel
const INF = 1e20;
const d = new Float64Array(nx * ny * nz);
for (let n = 0; n < d.length; n++) d[n] = mat[n] ? INF : 0;
function edt1(f, n, out, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; }
    if (s > z[k]) { k++; v[k] = q; z[k] = s; z[k + 1] = INF; } else { v[k] = q; z[k] = s; z[k + 1] = INF; }
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; out[q] = (q - p) * (q - p) + f[p]; }
}
const m = Math.max(nx, ny, nz); const f = new Float64Array(m), o = new Float64Array(m), v = new Int32Array(m), zz = new Float64Array(m + 1);
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { for (let i = 0; i < nx; i++) f[i] = d[idx(i, j, k)]; edt1(f, nx, o, v, zz); for (let i = 0; i < nx; i++) d[idx(i, j, k)] = o[i]; }
for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { for (let j = 0; j < ny; j++) f[j] = d[idx(i, j, k)]; edt1(f, ny, o, v, zz); for (let j = 0; j < ny; j++) d[idx(i, j, k)] = o[j]; }
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { for (let k = 0; k < nz; k++) f[k] = d[idx(i, j, k)]; edt1(f, nz, o, v, zz); for (let k = 0; k < nz; k++) d[idx(i, j, k)] = o[k]; }
let volS = 0, cavBall = 0;
const r2 = (t / h) * (t / h);
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const x = X0 + (i + 0.5) * h, y = Y0 + (j + 0.5) * h, z = Z0 + (k + 0.5) * h;
  if (!inS(x, y, z)) continue; volS += h * h * h;
  // voxel centre sits (i+0.5); distance to the nearest complement voxel CENTRE minus half a voxel is the surface distance
  if (Math.sqrt(d[idx(i, j, k)]) * h - h / 2 >= t) cavBall += h * h * h;
}
console.log('volS', volS.toFixed(3), 'Euclid-ball cavity', cavBall.toFixed(3), 'shell (ball erosion)', (volS - cavBall).toFixed(3), '| analytic P (cube) shell 7312.000 | OCCT 7253.994 | truck 7312.000');
