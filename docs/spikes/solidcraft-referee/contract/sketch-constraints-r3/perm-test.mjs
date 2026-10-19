// Row-order sensitivity. (1) four named orders on both slots, 24 rough starts at 4%, unguarded (mapper, rows in the order given) vs guarded (ladder).
// (2) random permutations of the rows of 8 fixtures x 6 rough starts x 12 permutations.
//   SOLIDCRAFT_REFEREE_PKG2=<p2 pkg> bun perm-test.mjs [--out=out/perm.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, roughen, plainRules, mulberry, seedOf } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch, ROW_CLASS } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/perm.json').slice(6);
const unguarded = (cs, st, rules) => { const r = lib.scSketch(st, rules); if (r.mapperRefused || r.firstRefusal || r.extrudeError || !r.body) return 'REFUSED'; const c = classify(cs, r.body, st).cls; return c === 'TOL-MISS' ? 'MATCH' : c; };
const guarded = (cs, st, rules) => { const g = ladderSketch({ geoms: st, rules }); if (!g.ok) return 'REFUSED'; const c = classify(cs, g.body, st).cls; return c === 'MATCH' || c === 'TOL-MISS' ? 'MATCH' : 'WRONG'; };
const add = (t, k) => { t[k] = (t[k] ?? 0) + 1; };
const out = { named: [], random: [] };
// (1) named orders
const NAMED = {
  'as written': (r) => r,
  reversed: (r) => [...r].reverse(),
  'dimensions first': (r) => [...r.filter((x) => ROW_CLASS(x) === 'D'), ...r.filter((x) => ROW_CLASS(x) !== 'D')],
  'tangents first': (r) => [...r.filter((x) => x.k === 'tangent'), ...r.filter((x) => x.k !== 'tangent')],
  'interleaved (tangent after every other row)': (r) => { const t = r.filter((x) => x.k === 'tangent'), o = r.filter((x) => x.k !== 'tangent'); const res = []; o.forEach((x, i) => { res.push(x); if (i % 2 === 1 && t.length) res.push(t.shift()); }); return [...res, ...t]; },
};
for (const id of ['slot-hand-rows-R10-L40', 'slot-dims-from-points']) {
  const cs = CASES.find((c) => c.id === id);
  for (const [name, f] of Object.entries(NAMED)) {
    const tu = {}, tg = {};
    for (let k = 0; k < 24; k++) {
      const st = roughen(cs.geoms, cs.rules, `${id}#named#${k}`, 0.04), rules = f(plainRules(cs.rules));
      add(tu, unguarded(cs, st, rules)); add(tg, guarded(cs, st, rules));
    }
    out.named.push({ id, order: name, unguarded: tu, guarded: tg });
    console.log(`named ${id} ${name.padEnd(46)} unguarded ${JSON.stringify(tu)} guarded ${JSON.stringify(tg)}`);
    writeFileSync(OUTF, JSON.stringify(out));
  }
}
// (2) random permutations
const FIX = ['slot-hand-rows-R10-L40', 'slot-dims-from-points', 'oval-four-arcs-endpoint-tangent', 'hexagon-equal-pointOn-circle', 'symmetric-trapezoid-about-Y-axis', 'rect-corner-dx-dy-negative', 'triangle-length-angle-120', 'circle-circle-external-mode'];
for (const id of FIX) {
  const cs = CASES.find((c) => c.id === id);
  const tu = {}, tg = {}; let distinct = 0, groups = 0; const vols = [];
  for (let s = 0; s < 6; s++) {
    const st = roughen(cs.geoms, cs.rules, `${id}#perm#${s}`, 0.04);
    const gv = [];
    for (let p = 0; p < 12; p++) {
      const rnd = mulberry(seedOf(`${id}/${s}/${p}`)); const rules = plainRules(cs.rules).map((r) => [r, rnd()]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
      add(tu, unguarded(cs, st, rules));
      const g = ladderSketch({ geoms: st, rules });
      if (!g.ok) add(tg, 'REFUSED'); else { const c = classify(cs, g.body, st).cls; add(tg, c === 'MATCH' || c === 'TOL-MISS' ? 'MATCH' : 'WRONG'); gv.push(g.body.volume); }
    }
    groups++; if (gv.length > 1 && Math.max(...gv) - Math.min(...gv) > 1e-6 * Math.max(...gv)) distinct++;
    vols.push(gv.length ? Math.max(...gv) - Math.min(...gv) : null);
  }
  out.random.push({ id, permutations: 72, unguarded: tu, guarded: tg, startsWithDifferentBuiltVolumes: distinct, startsTested: groups, maxVolumeSpreadPerStart: vols });
  console.log(`random ${id.padEnd(40)} unguarded ${JSON.stringify(tu)} guarded ${JSON.stringify(tg)} starts whose built volume differs between permutations: ${distinct}/${groups}`);
  writeFileSync(OUTF, JSON.stringify(out));
}
