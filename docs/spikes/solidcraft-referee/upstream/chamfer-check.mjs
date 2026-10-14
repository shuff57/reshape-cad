// Issue 1 repro + independent check. SOLIDCRAFT_REFEREE_PKG2=<dir> node chamfer-check.mjs
// Runs scripts/chamfer-all-edges.json (solidcraft command JSON only) and compares with a closed-form-by-quadrature
// volume of the chamfered box: box [-20,20]x[-20,20]x[-10,10] intersected with the 12 half-spaces |a|+|b| <= ha+hb-d
// (a chamfer of size d on a convex box edge cuts exactly that half-space). No kernel involved.
import { run } from './run.mjs';
import { readFileSync } from 'node:fs';
const r = run(JSON.parse(readFileSync(new URL('./scripts/chamfer-all-edges.json', import.meta.url), 'utf8')));
for (const x of r.results) if (!x.ok) console.log('ERR', x.command, x.error);
const b = r.measure.out.bodies[0];
console.log(`solidcraft: volume_mm3=${b.volume_mm3} faces=${b.faces} edges=${b.edges} vertices=${b.vertices} face_types=${JSON.stringify(b.face_types)}`);
const [hx, hy, hz, d] = [20, 20, 10, 4];
const N = 4000; let v = 0; const h = (2 * hx) / N;
for (let i = 0; i < N; i++) { const x = Math.abs(-hx + (i + 0.5) * h);
  for (let j = 0; j < N; j++) { const y = Math.abs(-hy + (j + 0.5) * h);
    if (x + y > hx + hy - d) continue;
    const zt = Math.min(hz, hx + hz - d - x, hy + hz - d - y); if (zt > 0) v += 2 * zt * h * h; } }
console.log(`half-space quadrature (N=${N}): volume=${v.toFixed(3)}  (OCCT live, from phase0: 29141.333333, 26 faces)`);
console.log(`relative difference solidcraft vs half-space quadrature: ${(Math.abs(b.volume_mm3 - v) / v).toExponential(2)} (midpoint-grid error)`);
console.log(`relative difference solidcraft vs OCCT (phase0, live): ${(Math.abs(b.volume_mm3 - 29141.333333333) / 29141.333333333).toExponential(2)}`);
console.log(`NOTE: the quadrature is the plain intersection of the 12 half-spaces; it agrees with solidcraft, NOT with OCCT.`);
console.log(`faces: 6 box faces + 12 chamfer strips = 18; OCCT/brep-rs have 8 more (one 3-edge planar face per corner) = 26.`);
