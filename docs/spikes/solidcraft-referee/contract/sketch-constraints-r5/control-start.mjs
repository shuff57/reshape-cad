// Round 5 control: does the post-build comparison protect on its own? The guard normally hands SolidCraft the independent solution as its starting geometry (sendFromSolved). Here the same
// starts are also run with sendFromSolved:false (SolidCraft solves from the DRAWN start, as the shipped route does) so that SolidCraft's own branch choice is back in play; the build is then
// accepted only if it equals the independent expectation. Counts of right / other-side / wrong / refused for: shipped, guarded (SolidCraft starts from the solution), guarded with the drawn start.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun control-start.mjs [--n=30] [--out=out/control-start.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, roughen, plainRules } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch } from './guard.mjs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
const N = +arg('n', 30), OUTF = arg('out', 'out/control-start.json');
const IDS = ['slot-hand-rows-R10-L40', 'oval-four-arcs-endpoint-tangent', 'rect-corner-dx-dy-negative', 'right-trapezoid-par-perp-neg-dx', 'triangle-length-angle-120', 'hexagon-equal-pointOn-circle', 'rounded-rect-4-lines-4-arcs', 'symmetric-trapezoid-about-Y-axis'];
const tally = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const cls = (g, cs, start) => { if (!g.ok) return 'REFUSED'; const c = classify(cs, g.body, start); return c.cls === 'MATCH' || c.cls === 'TOL-MISS' ? 'BUILT-MATCH' : c.cls === 'MATCH-OTHER-SIDE' ? 'BUILT-OTHER-SIDE' : 'BUILT-WRONG'; };
const out = [];
for (const id of IDS) {
  const cs = CASES.find((c) => c.id === id); const rules = plainRules(cs.rules);
  for (const frac of [0.15, 0.4]) {
    const t = { id, frac, N, shipped: {}, guardedFromSolution: {}, guardedFromDrawing: {}, stagesFromDrawing: {} };
    for (let k = 0; k < N; k++) {
      const start = roughen(cs.geoms, cs.rules, `${id}#ctl#${k}#${frac}`, frac);
      const u = lib.scSketch(start, rules);
      if (u.mapperRefused || u.firstRefusal || u.extrudeError || !u.body) tally(t.shipped, 'REFUSED'); else { const c = classify(cs, u.body, start); tally(t.shipped, c.cls === 'TOL-MISS' ? 'MATCH' : c.cls); }
      tally(t.guardedFromSolution, cls(ladderSketch({ geoms: start, rules }), cs, start));
      const gd = ladderSketch({ geoms: start, rules }, { sendFromSolved: false });
      tally(t.guardedFromDrawing, cls(gd, cs, start));
      if (!gd.ok) tally(t.stagesFromDrawing, gd.stage);
    }
    out.push(t);
    console.log(`${id.padEnd(40)} ${frac}: shipped ${JSON.stringify(t.shipped)} | guarded from the solution ${JSON.stringify(t.guardedFromSolution)} | guarded from the drawing ${JSON.stringify(t.guardedFromDrawing)} stages ${JSON.stringify(t.stagesFromDrawing)}`);
    writeFileSync(OUTF, JSON.stringify(out, null, 1));
  }
}
