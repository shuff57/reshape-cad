// magnitude sweep, curved parts at 3000 and 5000 mm (the limit probe)
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : String(v));
const out = [];
for (const D of [2000, 3000, 5000]) for (const [g, s] of [['move cylinder', `const a = cylinder(8, 20);\nmove(a, [${D}, ${D}, ${D}]);`], ['move,hole,turn(derived)', `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nmove(a, [${D}, ${D}, ${D}]);\nturn(a, [10, 20, 30]);`], ['move sphere', `const a = sphere(14);\nmove(a, [${D}, ${D}, ${D}]);`]]) {
  const r = runCase({ script: s }); const id = r.features.at(-1).id; const t = r.truck[id]; const v = verdict(r, id);
  out.push({ g, D, v, dVol: t.dVol, dBbox: t.dBbox, dCom: t.dCom });
  console.log(g.padEnd(26), String(D).padEnd(6), v.padEnd(6), `dVol=${f(t.dVol)} dBbox=${f(t.dBbox)} dCom=${f(t.dCom)}`);
}
writeFileSync('p-magnitude3-results.json', JSON.stringify(out, null, 1));
