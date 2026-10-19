// NOTE: the ladder-design data (out/ladder-*.json) was measured with earlier revisions of guard.mjs/branch.mjs; the final numbers are the sweeps / perm-test / probes outputs, not these.
// For each fixture x seeded rough start x candidate row order: run the GUARDED route (guard on, order given) and record the category.
//   cat: OK (guard passed and builds the closed form) | WRONG (guard passed, disagrees)  | <stage> (guard/solver refused)
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, roughen, plainRules } from './cases.mjs';
import { classify } from './score.mjs';
import { guardedSketch, ROW_CLASS, canonicalOrder } from './guard.mjs';
const IDS = process.argv[2].split(','), FR = +process.argv[3], N = +process.argv[4], OUTF = process.argv[5];
const perms = (a) => a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
const cl = (ord) => (rules) => { const idx = (r) => ROW_CLASS(r) === 'L' ? -1 : ord.indexOf(ROW_CLASS(r)); return rules.map((r, i) => [r, i]).sort((x, y) => idx(x[0]) - idx(y[0]) || x[1] - y[1]); };
const clf = (ord) => (rules) => canonicalOrder(rules, ord, true);
const FULL = process.argv[6] === 'full';
const VAR = FULL ? { input: (rules) => rules.map((r, i) => [r, i]), reversed: (rules) => rules.map((r, i) => [r, i]).reverse(), GTJD: cl('GTJD'), 'GTJD*': clf('GTJD'), JGTD: cl('JGTD'), 'JGTD*': clf('JGTD'), 'GTDJ*': clf('GTDJ'), 'GJTD*': clf('GJTD') } : { input: (rules) => rules.map((r, i) => [r, i]), reversed: (rules) => rules.map((r, i) => [r, i]).reverse(), ...Object.fromEntries(perms(['J', 'G', 'T', 'D']).map((p) => [p.join(''), cl(p.join(''))])) };
const out = {};
for (const id of IDS) {
  const cs = CASES.find((c) => c.id === id);
  out[id] = [];
  for (let k = 0; k < N; k++) {
    const st = roughen(cs.geoms, cs.rules, `${id}#${k}#${FR}`, FR);
    const row = {};
    for (const [name, permute] of Object.entries(VAR)) {
      const g = guardedSketch({ geoms: st, rules: plainRules(cs.rules) }, { permute });
      row[name] = g.ok ? (classify(cs, g.body).cls === 'MATCH' || classify(cs, g.body).cls === 'TOL-MISS' ? 'OK' : 'WRONG') : g.stage;
    }
    out[id].push(row);
  }
  const tally = {};
  for (const name of Object.keys(VAR)) { const t = {}; for (const r of out[id]) t[r[name]] = (t[r[name]] ?? 0) + 1; tally[name] = t; }
  console.log(id, FR, N, '\n  ' + Object.entries(tally).map(([n, t]) => `${n}:${Object.entries(t).map(([c, v]) => c + v).join('/')}`).join('  '));
  writeFileSync(OUTF, JSON.stringify(out));
}
