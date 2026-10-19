// Parametric use across a branch. (1) angle grid: triangle stored at theta0, the angle param changed to v. (2) signed distanceX param: stored side s0, value v of the other sign.
//   SOLIDCRAFT_REFEREE_PKG2=<p2 pkg> bun param-grid.mjs [--out=out/param.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { L, loopJoins, len, atOrigin, rectG, rectShape, dX, H } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
import { soupScript } from './cases.mjs';
import { rel } from './lib.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/param.json').slice(6);
const rad = (d) => (d * Math.PI) / 180;
const shoelace = (p) => Math.abs(p.reduce((s, q, i) => s + (q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1]), 0) / 2);
const triAt = (deg) => { const p0 = [0, 0], p1 = [40, 0], p2 = [40 + 30 * Math.cos(rad(deg)), 30 * Math.sin(rad(deg))]; return [p0, p1, p2]; };
const rows = { angle: [], dx: [] };
const T0 = [20, 30, 40, 50, 60, 70, 80, 95, 105, 115, 125, 135, 150], V = [30, 50, 70, 90, 110, 130, 150];
const tally = { unguarded: {}, guarded: {} };
const add = (t, k) => { t[k] = (t[k] ?? 0) + 1; };
for (const t0 of T0) for (const v of V) {
  const P0 = triAt(t0), Pv = triAt(v);
  const geoms = [L(1, P0[0], P0[1]), L(2, P0[1], P0[2]), L(3, P0[2], P0[0])];
  const rules = [...loopJoins(3), { k: 'horizontal', a: 1 }, atOrigin(1), len(1, 40), len(2, 30), { k: 'angle', a: 1, b: 2, value: v }];
  const want = shoelace(Pv) * H, bbox = [Math.min(...Pv.map((p) => p[0])), Math.min(...Pv.map((p) => p[1])), Math.max(...Pv.map((p) => p[0])), Math.max(...Pv.map((p) => p[1]))];
  const okB = (b) => b && Math.abs(b.volume - want) / want < 1e-9 && Math.max(...[b.bbox[0] - bbox[0], b.bbox[1] - bbox[1], b.bbox[3] - bbox[2], b.bbox[4] - bbox[3]].map(Math.abs)) < 1e-6;
  const u = lib.scSketch(geoms, rules);
  const uc = u.mapperRefused ? 'MAPPER-REFUSED' : u.firstRefusal || !u.body ? 'SC-REFUSED' : okB(u.body) ? 'MATCH' : 'WRONG';
  const g = ladderSketch({ geoms, rules });
  const gc = g.ok ? (okB(g.body) ? 'MATCH' : 'WRONG') : 'REFUSED';
  add(tally.unguarded, uc); add(tally.guarded, gc);
  let bc = 'n/a';
  try { const run = lib.runScript(soupScript(geoms, rules)); const b = lib.brepBuild(lib.modelCodegen.solveDoc(run.doc)); bc = b.outcome !== 'built' ? 'REFUSED' : rel(b.volume, want) <= 1e-9 && Math.abs(b.bbox[3] - bbox[2]) < 1e-6 && Math.abs(b.bbox[4] - bbox[3]) < 1e-6 ? 'MATCH' : 'WRONG'; } catch { bc = 'ERROR'; }
  tally.brep = tally.brep ?? {}; add(tally.brep, bc);
  rows.angle.push({ stored: t0, value: v, unguarded: uc, guarded: gc, brep: bc, sentence: g.ok ? null : g.sentence });
}
console.log('angle grid', T0.length, 'x', V.length, '=', T0.length * V.length, JSON.stringify(tally));
const tallyDx = { unguarded: {}, guarded: {} };
for (const s0 of [-12, -8, -4, 4, 8, 12]) for (const v of [-12, -8, -4, 4, 8, 12]) {
  const x0 = s0 > 0 ? s0 : s0, geoms = rectG(x0 + 0.2, 2.1, x0 + 30.2, 22.1);
  const rules = [...rectShape(), dX(-1, 'a', 1, 'a', v), { k: 'distanceY', a: -1, aEnd: 'a', b: 1, bEnd: 'a', value: 2 }, len(1, 30), len(2, 20)];
  const wantBbox = [v, 2, v + 30, 22], wantVol = 600 * H;
  const okB = (b) => b && Math.abs(b.volume - wantVol) / wantVol < 1e-9 && Math.max(...[b.bbox[0] - wantBbox[0], b.bbox[1] - wantBbox[1], b.bbox[3] - wantBbox[2], b.bbox[4] - wantBbox[3]].map(Math.abs)) < 1e-6;
  const u = lib.scSketch(geoms, rules);
  const uc = u.mapperRefused ? 'MAPPER-REFUSED' : u.firstRefusal || !u.body ? 'SC-REFUSED' : okB(u.body) ? 'MATCH' : 'WRONG';
  const g = ladderSketch({ geoms, rules });
  const gc = g.ok ? (okB(g.body) ? 'MATCH' : 'WRONG') : 'REFUSED';
  add(tallyDx.unguarded, uc); add(tallyDx.guarded, gc);
  let bc = 'n/a';
  try { const run = lib.runScript(soupScript(geoms, rules)); const b = lib.brepBuild(lib.modelCodegen.solveDoc(run.doc)); bc = b.outcome !== 'built' ? 'REFUSED' : rel(b.volume, wantVol) <= 1e-9 && Math.abs(b.bbox[0] - wantBbox[0]) < 1e-6 && Math.abs(b.bbox[3] - wantBbox[2]) < 1e-6 ? 'MATCH' : 'WRONG'; } catch { bc = 'ERROR'; }
  tallyDx.brep = tallyDx.brep ?? {}; add(tallyDx.brep, bc);
  rows.dx.push({ stored: s0, value: v, sameSign: Math.sign(s0) === Math.sign(v), unguarded: uc, guarded: gc, brep: bc, sentence: g.ok ? null : g.sentence });
}
console.log('signed distanceX grid 6 x 6', JSON.stringify(tallyDx));
writeFileSync(OUTF, JSON.stringify({ rows, angle: tally, dx: tallyDx }, null, 1));
console.log('brep-rs on the same combinations: angle', JSON.stringify(tally.brep), 'dx', JSON.stringify(tallyDx.brep));
