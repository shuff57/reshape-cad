// Round 1 probe: the one FAIL of s1-turn-compose (cone move;turn;turn, dBbox 6.2e-4 > 3e-4 curved bar). Is it tessellation chord error?
// Independent check: exact analytic bbox of the final cone (base circle + apex, rotation-matrix math) vs truck bbox, in mm.
import { runCase } from './runner.mjs';
const D = Math.PI / 180;
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
const R = (a) => mul(Rz(a[2] * D), mul(Ry(a[1] * D), Rx(a[0] * D)));
const script = `const s = cone(14, 18, { at: [5, 2, -1] });\nmove(s, [7, -3, 2]);\nturn(s, [0, 40, 25]);\nturn(s, [60, 0, 0]);`;
const r = runCase({ script, ids: ['turn2'] });
const t = r.truck.turn2; const o = r.occt.turn2;
console.log('occt bbox', o.bbox.map((v) => v.toFixed(5)).join(' '));
console.log('truck bbox', t.bbox.map((v) => v.toFixed(5)).join(' '));
console.log('truck-occt  ', t.bbox.map((v, i) => (v - o.bbox[i]).toExponential(2)).join(' '));
// analytic: cone local frame: base circle DIAMETER 14 (cone(14,18): 14 is the diameter, radius 7) centred at the base centre, apex 18 along the axis. Find the pre-turn cone from the turn-free script.
const r0 = runCase({ script: `const s = cone(14, 18, { at: [5, 2, -1] });\nmove(s, [7, -3, 2]);`, ids: ['move1'] });
const b0 = r0.occt.move1.bbox; const c = [0, 1, 2].map((q) => (b0[q] + b0[q + 3]) / 2);
console.log('pre-turn occt bbox', b0.map((v) => v.toFixed(5)).join(' '), 'centre', c);
// cone axis is z (base on the z-min face): base centre (c.x, c.y, b0.z-min), apex (c.x,c.y,b0.zmax). Rotations: turn1 about bbox centre c of the pre-turn shape; turn2 about the bbox centre of the post-turn1 shape.
function bboxOf(pts) { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of pts) p.forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); }); return [lo, hi]; }
const app = (M, v) => M.map((q) => q[0] * v[0] + q[1] * v[1] + q[2] * v[2]);
let pts = []; for (let i = 0; i < 20000; i++) { const th = 2 * Math.PI * i / 20000; pts.push([c[0] + 7 * Math.cos(th), c[1] + 7 * Math.sin(th), b0[2]]); } pts.push([c[0], c[1], b0[5]]);
for (const ang of [[0, 40, 25], [60, 0, 0]]) { const [lo, hi] = bboxOf(pts); const cc = [0, 1, 2].map((q) => (lo[q] + hi[q]) / 2); pts = pts.map((p) => app(R(ang), p.map((v, q) => v - cc[q])).map((v, q) => v + cc[q])); }
const [lo, hi] = bboxOf(pts); const exact = [...lo, ...hi];
console.log('analytic bbox', exact.map((v) => v.toFixed(5)).join(' '));
console.log('truck-analytic', t.bbox.map((v, i) => (v - exact[i]).toExponential(2)).join(' '));
console.log('occt-analytic ', o.bbox.map((v, i) => (v - exact[i]).toExponential(2)).join(' '));
const sag = (N) => 7 * (1 - Math.cos(Math.PI / N));
console.log('max abs truck-analytic mm', Math.max(...t.bbox.map((v, i) => Math.abs(v - exact[i]))).toFixed(5), '; chord sagitta r(1-cos(pi/N)) for N=32/48/64/96:', [32, 48, 64, 96].map((N) => sag(N).toFixed(5)).join(' '));
