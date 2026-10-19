// Round 5 (critic): the planar 1e-9 bar over EVERY planar soup case, including the phase2 fixture the contract used to drop (own-l-shape-dims, 1.11e-9) and an independent L-shape written with
// perpendicular rows. For each: the stored geometry and N hand-drawn starts at 3.5% and 15%, through the SHIPPED route (mapper -> SolidCraft, rows sent as written) and the GUARDED route
// (the independent solution is SolidCraft's start). The worst volume / bbox delta against the closed form is reported per route; anything above 1e-9 is listed.
// Explanation of a delta above 1e-9 on the shipped route: SolidCraft's sketch solver stops at max |residual| < 1e-9 (~/solidcraft/crates/sketch/src/solver.rs line 36, `const TOL: f64 = 1e-9`), so
// a coordinate it was asked to move can be left up to ~1e-9 mm short; the guarded route starts SolidCraft at a point where every rule already holds, so there is nothing for it to move.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun planar-bar.mjs [--n=20] [--out=out/planar-bar.json]
import { writeFileSync, readFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, roughen, plainRules } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch } from './guard.mjs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
const N = +arg('n', 20), OUTF = arg('out', 'out/planar-bar.json');
const planarCases = CASES.filter((c) => c.geoms && !c.curved && c.expect === 'build' && !c.legacy && !c.probe && !c.underconstrained && c.geoms.every((g) => g.k === 'line' || g.k === 'point' || g.construction === true || g.k === 'circle' && g.construction));
const out = [];
let solverTol = null;
try { solverTol = readFileSync(process.env.HOME + '/solidcraft/crates/sketch/src/solver.rs', 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /^const TOL: f64/.test(l)).map(([i, l]) => `solver.rs:${i}: ${l.trim()}`)[0]; } catch { /* */ }
for (const cs of planarCases) {
  const rules = plainRules(cs.rules);
  const rec = { id: cs.id, shipped: { n: 0, built: 0, worst: 0, over: [] }, guarded: { n: 0, built: 0, refused: 0, worst: 0, over: [] }, faceMismatch: 0 };
  const starts = [{ k: 'stored', g: cs.geoms }, ...[0.035, 0.15].flatMap((fr) => Array.from({ length: N }, (_, k) => ({ k: `${fr}#${k}`, g: roughen(cs.geoms, cs.rules, `${cs.id}#pb#${k}#${fr}`, fr) })))];
  for (const s of starts) {
    const u = lib.scSketch(s.g, rules);
    rec.shipped.n++;
    if (u.body && !u.mapperRefused && !u.firstRefusal) {
      const c = classify(cs, u.body, s.g);
      if (c.cls === 'MATCH' || c.cls === 'TOL-MISS') { rec.shipped.built++; const w = Math.max(c.dv, c.db); rec.shipped.worst = Math.max(rec.shipped.worst, w); if (w > 1e-9) rec.shipped.over.push({ start: s.k, dv: c.dv, db: c.db }); }
    }
    const g = ladderSketch({ geoms: s.g, rules });
    rec.guarded.n++;
    if (!g.ok) { rec.guarded.refused++; continue; }
    const c = classify(cs, g.body, s.g);
    if (c.cls === 'MATCH' || c.cls === 'TOL-MISS') { rec.guarded.built++; const w = Math.max(c.dv, c.db); rec.guarded.worst = Math.max(rec.guarded.worst, w); if (w > 1e-9) rec.guarded.over.push({ start: s.k, dv: c.dv, db: c.db }); }
    if (g.cmp?.faces && g.cmp.faces[0] !== g.cmp.faces[1]) rec.faceMismatch++;
  }
  out.push(rec);
  console.log(cs.id.padEnd(44), `shipped built ${rec.shipped.built}/${rec.shipped.n} worst ${rec.shipped.worst.toExponential(1)} over1e-9 ${rec.shipped.over.length} | guarded built ${rec.guarded.built}/${rec.guarded.n} refused ${rec.guarded.refused} worst ${rec.guarded.worst.toExponential(1)} over1e-9 ${rec.guarded.over.length}`);
  writeFileSync(OUTF, JSON.stringify({ solverTol, N, cases: out }, null, 1));
}
