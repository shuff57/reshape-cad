// Independent analytic oracle for turn(): rotation matrix math (X then Y then Z, right-handed, degrees), no OCCT/brep-rs involved.
import { runCase } from './runner.mjs';
const D = Math.PI / 180;
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
const app = (R, v) => R.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const R = (a) => mul(Rz(a[2] * D), mul(Ry(a[1] * D), Rx(a[0] * D))); // X first
let worst = { bboxBox: 0, comBox: 0, volBox: 0, comDer: 0, volDer: 0 }; let n = 0;
const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
const ang = () => [0, 1, 2].map(() => Math.round((rnd() * 720 - 360) * 10) / 10);
// A: box primitive, size [20,10,6] at c: expected bbox from rotated corners about c
for (let i = 0; i < 60; i++) {
  const a = ang(); const c = [Math.round(rnd() * 40 - 20), Math.round(rnd() * 40 - 20), Math.round(rnd() * 40 - 20)];
  const r = runCase({ script: `const s = box(20, 10, 6, { at: [${c}] });\nturn(s, [${a}]);`, ids: ['box1'] });
  const m = r.measures.box1;
  const Rm = R(a); const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { const p = app(Rm, [sx * 10, sy * 5, sz * 3]).map((v, k) => v + c[k]); p.forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); }); }
  const exp = [...lo, ...hi];
  const db = Math.max(...exp.map((e, k) => Math.abs(m.bbox[k] - e) / Math.max(1, Math.abs(e))));
  const dc = Math.max(...c.map((e, k) => Math.abs(m.com[k] - e))) / 25;
  const dv = Math.abs(m.volume - 1200) / 1200;
  worst.bboxBox = Math.max(worst.bboxBox, db); worst.comBox = Math.max(worst.comBox, dc); worst.volBox = Math.max(worst.volBox, dv); n++;
  if (db > 1e-9 || dc > 1e-6 || dv > 1e-9) console.log('BOX MISMATCH', a, c, 'dBbox', db, 'dCom', dc, 'dVol', dv, 'got', m.bbox, 'exp', exp);
}
// B: derived (box with off-centre hole, then a join with a cylinder) turned about its bbox centre: COM' = c + R(COM - c), volume unchanged
const BASES = {
  hole: `const s = box(40, 30, 20, { at: [3, -2, 1] });\nhole(s, { across: 8, at: [5, 3] });`,
  join: `const a = box(30, 20, 10);\nconst c = cylinder(10, 30, { at: [10, 0, 0] });\nconst s = join(a, c);`,
  moved: `const s = box(20, 10, 6);\nmove(s, [7, -3, 2]);`,
};
const LAST = { hole: 'hole1', join: 'op1', moved: 'move1' };
let nb = 0;
for (const [k, b] of Object.entries(BASES)) for (let i = 0; i < 12; i++) {
  const a = ang();
  const r = runCase({ script: `${b}\nturn(s, [${a}]);`, ids: [LAST[k]] });
  const pre = r.measures[LAST[k]]; const post = r.measures.turn1;
  if (!post) { console.log('NO turn1 measure for', k, a, JSON.stringify(r.truckFeatures), r.errors); continue; }
  const c = [0, 1, 2].map((q) => (pre.bbox[q] + pre.bbox[q + 3]) / 2);
  const exp = app(R(a), pre.com.map((v, q) => v - c[q])).map((v, q) => v + c[q]);
  const dc = Math.max(...exp.map((e, q) => Math.abs(post.com[q] - e))) / 50;
  const dv = Math.abs(post.volume - pre.volume) / pre.volume;
  worst.comDer = Math.max(worst.comDer, dc); worst.volDer = Math.max(worst.volDer, dv); nb++;
  if (dc > 1e-6 || dv > 1e-9) console.log('DERIVED MISMATCH', k, a, 'dCom', dc, 'dVol', dv);
}
console.log('box cases', n, 'derived cases', nb, 'worst', JSON.stringify(worst));
