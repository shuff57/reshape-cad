// magnitude sweep, second geometry set: box centred at [D,D,D] turned [10,20,30] (the critic's configuration), planar box with a hole moved by D, join of two far parts
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : String(v));
const out = [];
function go(group, D, script) {
  const r = runCase({ script });
  if (r.errors.length) { console.log(group, D, 'SCRIPT ERROR', r.errors[0]); return; }
  const id = r.features.at(-1).id; const t = r.truck[id]; const v = verdict(r, id);
  out.push({ group, D, script, id, v, truck: t.refused ? { refused: t.refused } : { dVol: t.dVol, dBbox: t.dBbox, dCom: t.dCom }, brep: r.brep[id] });
  console.log(group.padEnd(26), String(D).padEnd(8), v.padEnd(8), t.refused ? t.refused.slice(0, 120) : `dVol=${f(t.dVol)} dBbox=${f(t.dBbox)} dCom=${f(t.dCom)} | brep dVol=${f(r.brep[id]?.dVol)}`);
}
for (const D of [1e2, 1e3, 3e3, 1e4, 3e4, 1e5, 1e6]) {
  go('box@[D,D,D] turn', D, `const a = box(30, 20, 10, { at: [${D}, ${D}, ${D}] });\nturn(a, [10, 20, 30]);`);
  go('hole box move', D, `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nmove(a, [${D}, ${D}, ${D}]);`);
  go('join two far parts', D, `const a = box(30, 20, 10);\nconst b = box(10, 10, 10, { at: [0, 0, 10] });\nmove(a, [${D}, ${D}, ${D}]);\nmove(b, [${D}, ${D}, ${D}]);\njoin(a, b);`);
}
writeFileSync('p-magnitude2-results.json', JSON.stringify(out, null, 1));
