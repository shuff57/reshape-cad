// Round 6 (critic: the curved volume bar fails at small sketch scale). Each curved fixture scaled 1e-3 .. 1e3 through the GUARD; the guard compares the build with the exact area x height
// (expect.mjs) and refuses a curved build whose volume is off by more than 3e-4. Writes out/scale.json.
import { writeFileSync } from 'node:fs';
// scale sweep through the GUARD: circle d=14 and a slot, scaled
import { ladderSketch } from './guard.mjs';
import { CASES, plainRules } from './cases.mjs';
const ids = (process.argv[2] || 'circle-diameter-origin-c,circle-radius-dx-dy,slot-dims-from-points,slot-hand-rows-R10-L40,tangent-line-circle').split(',');
const out = [];
for (const id of ids) {
  const cs = CASES.find((c) => c.id === id); if (!cs) { console.log('no case', id); continue; }
  for (const s of [1e-3, 1e-2, 0.03, 0.1, 0.3, 1, 10, 100, 1000]) {
    const geoms = JSON.parse(JSON.stringify(cs.geoms)).map((g) => { for (const k of ['a', 'b', 'c', 'p']) if (g[k]) g[k] = g[k].map((v) => v * s); if (g.r !== undefined) g.r *= s; return g; });
    const rules = plainRules(cs.rules).map((r) => (typeof r.value === 'number' && r.k !== 'angle' ? { ...r, value: r.value * s } : r));
    const g = ladderSketch({ geoms, rules }, { height: 10 * s });
    out.push({ id, scale: s, built: g.ok, dv: g.ok ? g.cmp.dv : null, volume: g.ok ? g.body.volume : null, stage: g.ok ? null : g.stage, sentence: g.ok ? null : g.sentence });
    console.log(id, 's=' + s, g.ok ? 'BUILT dv=' + g.cmp.dv.toExponential(2) + ' vol=' + g.body.volume.toPrecision(6) : 'REFUSED(' + g.stage + ') ' + g.sentence.slice(0, 110));
  }
}

writeFileSync('out/scale.json', JSON.stringify(out));
