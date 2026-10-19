// blend-loft ROUND 5 calibration of the hand-typed-input tolerances in blend-loft.guard.mjs (PAR_TOL, REG_RADIUS_TOL, REG_ANGLE_TOL, REG_PHASE_TOL).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/blend-loft.r5-calib.mjs --out=<file.json> [--n=300] [--seed=5]
// LIVE: every number is truck (SolidCraft wasm via the spike translator) vs OCCT (ThruSections ruled), measured now. Nothing is replayed.
// Part 1 (near-parallel): a polygon P and a second polygon Q = P scaled, shifted and jittered vertex by vertex so matching sides are NOT exactly parallel
//   (what a student gets by typing coordinates by hand). Binned by the measured worst sine between matching sides (G.parallelDeviation).
// Part 2 (regular polygon <-> circle): regular n-gon with the radius spread, corner spacing error and phase error a typed polygon has.
import { writeFileSync } from 'node:fs';
import { sk, circ, bl, rectPts, regPts, full, G, arc, solveDoc, lcg, rel } from './blend-loft.live-lib.mjs';
const arg = (k, d = '') => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const N = +arg('n', 300); const SEED = +arg('seed', 5);
const R = lcg(SEED); const U = (a, b) => a + (b - a) * R(); const LU = (a, b) => Math.exp(U(Math.log(a), Math.log(b)));
const D = (f) => ({ version: 1, features: f });
const E = (x) => (typeof x === 'number' ? x.toExponential(2) : String(x));
const shapes = {
  square: rectPts(0, 0, 30, 30), rect4to1: rectPts(0, 0, 40, 10), rect2to1: rectPts(0, 0, 40, 20), tri: regPts(3, 15, 0), pent: regPts(5, 15, 0), hex: regPts(6, 15, 0),
  L: [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]], skewTri: [[0, 0], [30, 0], [10, 20]],
};
const OUT = { seed: SEED, n: N, part1: [], part2: [] };
// ---- Part 1
for (let k = 0; k < N; k++) {
  const names = Object.keys(shapes); const nm = names[k % names.length]; const P = shapes[nm];
  const s = U(0.3, 0.9); const dx = U(-3, 3); const dy = U(-3, 3); const h = LU(3, 60) * (R() < 0.5 ? 1 : -1);
  const eps = Math.exp(U(Math.log(1e-5), Math.log(3e-2))) * Math.sqrt(P.map(([x, y]) => x * x + y * y).reduce((a, b) => Math.max(a, b)));
  const Q = P.map(([x, y]) => [x * s + dx + (R() - 0.5) * 2 * eps * s, y * s + dy + (R() - 0.5) * 2 * eps * s]);
  const doc = D([sk('a', 'xy', 0, P), sk('b', 'xy', h, Q), bl('a', 'b')]);
  let r; try { r = full(doc); } catch (e) { continue; }
  let warp; try { warp = G.pairWarp(solveDoc(doc), arc.outlineOf); } catch { continue; }
  if (r.d === undefined) { OUT.part1.push({ nm, warp, guard: r.guard?.code ?? 'PASS', noSolid: true }); continue; }
  OUT.part1.push({ nm, warp, d: r.d, faces: [r.occt.faces, r.truck.faces], guard: r.guard?.code ?? 'PASS' });
}
// bins by sine
const bins = [[0, 1e-9], [1e-9, 1e-4], [1e-4, 3e-4], [3e-4, 1e-3], [1e-3, 2e-3], [2e-3, 3.5e-3], [3.5e-3, 5e-3], [5e-3, 1e-2], [1e-2, 5e-2]];
OUT.part1Bins = bins.map(([lo, hi]) => {
  const a = OUT.part1.filter((c) => c.d !== undefined && c.warp > lo && c.warp <= hi + (lo === 0 ? 1e-18 : 0) && c.warp < 9);
  return { sineFrom: lo, sineTo: hi, n: a.length, maxD: a.length ? Math.max(...a.map((c) => c.d)) : null, faceMismatch: a.filter((c) => c.faces[0] !== c.faces[1]).length, guardPassed: a.filter((c) => c.guard === 'PASS').length, worst: a.length ? a.reduce((m, c) => (c.d > m.d ? c : m)).nm : null };
});
for (const b of OUT.part1Bins) console.log(`P1 sine (${E(b.sineFrom)}, ${E(b.sineTo)}]: n ${b.n} max dVol ${b.maxD === null ? '-' : E(b.maxD)} face mismatches ${b.faceMismatch} guard passed ${b.guardPassed}`);
const pass1 = OUT.part1.filter((c) => c.guard === 'PASS' && c.d !== undefined);
OUT.part1Pass = { n: pass1.length, maxD: Math.max(0, ...pass1.map((c) => c.d)), faceMismatch: pass1.filter((c) => c.faces[0] !== c.faces[1]).length, over3e4: pass1.filter((c) => c.d > 3e-4).length, noSolidPassed: OUT.part1.filter((c) => c.noSolid && c.guard === 'PASS').length };
console.log(`P1 guard-passed: ${JSON.stringify(OUT.part1Pass)} of ${OUT.part1.length}`);
// ---- Part 2: regular polygon <-> circle with typed-polygon errors
for (let k = 0; k < N; k++) {
  const n = [4, 5, 6, 8][k % 4]; const r1 = LU(4, 40);
  const rad = Math.exp(U(Math.log(1e-4), Math.log(5e-2))); const ang = Math.exp(U(Math.log(1e-4), Math.log(5e-2))); const ph = Math.exp(U(Math.log(1e-4), Math.log(0.3)));
  const P = regPts(n, r1, 0).map(([x, y], i) => { const a = Math.atan2(y, x) + (i === 0 ? 0 : (R() - 0.5) * 2 * ang) + (i === 0 ? ph * (R() < 0.5 ? 1 : -1) : 0); const rr = r1 * (1 + (R() - 0.5) * 2 * rad); return [rr * Math.cos(a), rr * Math.sin(a)]; });
  const rc = r1 * U(0.6, 1.4); const cf = R() < 0.5; const h = LU(Math.max(1, 0.7 * r1), 100);
  const doc = D([cf ? circ('a', 0, 0, rc, 'xy', 0) : sk('a', 'xy', 0, P), cf ? sk('b', 'xy', h, P) : circ('b', 0, 0, rc, 'xy', h), bl('a', 'b')]);
  let r; try { r = full(doc); } catch { continue; }
  if (r.d === undefined) { OUT.part2.push({ n, rad, ang, ph, guard: r.guard?.code ?? 'PASS', noSolid: true }); continue; }
  OUT.part2.push({ n, rad, ang, ph, d: r.d, guard: r.guard?.code ?? 'PASS' });
}
const p2pass = OUT.part2.filter((c) => c.guard === 'PASS' && c.d !== undefined);
OUT.part2Pass = { cases: OUT.part2.length, passed: p2pass.length, maxD: Math.max(0, ...p2pass.map((c) => c.d)), over3e4: p2pass.filter((c) => c.d > 3e-4).length, noSolidPassed: OUT.part2.filter((c) => c.noSolid && c.guard === 'PASS').length };
const p2ref = OUT.part2.filter((c) => c.guard !== 'PASS' && c.d !== undefined);
OUT.part2Refused = { n: p2ref.length, exactAnyway: p2ref.filter((c) => c.d <= 3e-4).length, wouldBeWrong: p2ref.filter((c) => c.d > 3e-4).length };
// phase/radius/angle response: worst d per decade of each error among ALL (pass or refused)
const dec = (key, edges) => edges.slice(1).map((hi, i) => { const lo = edges[i]; const a = OUT.part2.filter((c) => c.d !== undefined && c[key] > lo && c[key] <= hi); return { key, from: lo, to: hi, n: a.length, maxD: a.length ? Math.max(...a.map((c) => c.d)) : null }; });
OUT.part2Response = [...dec('ph', [0, 1e-3, 1e-2, 0.02, 0.05, 0.1, 0.3]), ...dec('rad', [0, 1e-3, 5e-3, 1e-2, 5e-2]), ...dec('ang', [0, 1e-3, 5e-3, 1e-2, 5e-2])];
for (const x of OUT.part2Response) console.log(`P2 ${x.key} (${E(x.from)}, ${E(x.to)}]: n ${x.n} max dVol ${x.maxD === null ? '-' : E(x.maxD)}`);
console.log(`P2 guard-passed: ${JSON.stringify(OUT.part2Pass)}; refused: ${JSON.stringify(OUT.part2Refused)}`);
if (arg('out')) writeFileSync(arg('out'), JSON.stringify(OUT, null, 1));
