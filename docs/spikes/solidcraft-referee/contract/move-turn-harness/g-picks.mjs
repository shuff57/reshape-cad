import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { line, verdict } from './cases.mjs';
const C = {
  'pick/move-generic': `const a = box(30, 30, 10);\nmove(a, [10, 10, 10]);\nround(a.edge('top', 'front'), 2);`,
  'pick/move-stale-hits-wrong-edge': `const a = box(30, 30, 10);\nmove(a, [0, -30, 0]);\nround(a.edge('top', 'front'), 2);`,
  'pick/move-stale-hits-wrong-edge-x': `const a = box(30, 30, 10);\nmove(a, [30, 0, 0]);\nround(a.edge('top', 'front'), 2);`,
  'pick/turn-primitive-180z': `const a = box(30, 20, 10);\nturn(a, [0, 0, 180]);\nround(a.edge('top', 'front'), 2);`,
  'pick/turn-primitive-30': `const a = box(30, 20, 10);\nturn(a, [10, 20, 30]);\nround(a.edge('top', 'front'), 2);`,
  'pick/turn-derived-180z': `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nturn(a, [0, 0, 180]);\nround(a.edge('top', 'front'), 2);`,
  'pick/turn-derived-30': `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nturn(a, [10, 20, 30]);\nround(a.edge('top', 'front'), 2);`,
  'pick/round-then-move': `const a = box(30, 20, 10);\nround(a.edge('top', 'front'), 2);\nmove(a, [10, 5, 3]);`,
  'pick/round-then-turn': `const a = box(30, 20, 10);\nround(a.edge('top', 'front'), 2);\nturn(a, [10, 20, 30]);`,
  'pick/hole-then-turn-then-hole': `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nturn(a, [0, 90, 0]);\nhole(a, { across: 3, deep: 5 });`,
};
const out = {};
for (const [k, s] of Object.entries(C)) {
  let r;
  try { r = runCase({ script: s }); } catch (e) { console.log(k, 'THROW', e.message); continue; }
  if (r.errors.length) { console.log(k, 'SCRIPT ERROR', JSON.stringify(r.errors)); out[k] = { errors: r.errors }; continue; }
  const id = r.features.at(-1).id;
  console.log(line(k, r, [id]));
  out[k] = { script: s, v: verdict(r, id), truck: r.truck[id], brep: r.brep[id], tf: r.truckFeatures };
}
writeFileSync('g-picks-results.json', JSON.stringify(out, null, 1));
