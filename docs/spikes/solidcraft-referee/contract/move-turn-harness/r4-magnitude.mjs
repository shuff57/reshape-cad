// round 4: the distance limit, split by what the part is made of. The critic: a box turned at [5000,3000,100] is exact (dVol 3e-12, dCom 1e-10), so refusing every
// part beyond 3000 mm with a sentence about "losing accuracy" over-refuses planar parts. Sweep F = farthest bounding-box coordinate for planar and curved parts,
// unpatched (shipped) translator vs live OCCT, to find where each family really fails; then the guard with the limits this file reports.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> SC_BOX_MS=120000 bun r4-magnitude.mjs [--guard]   (--guard: also run the guard translator with MT_MAX_PLANAR / MT_MAX_CURVED from env)
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : String(v));
const withGuard = process.argv.includes('--guard');
const SHAPES = [
  // [name, family, script template, half extent of the farthest axis]
  ['move box 30x20x10', 'planar', (D) => `const a = box(30, 20, 10);\nmove(a, [${D}, ${D}, ${D}]);`, 15],
  ['move prism(6) h12', 'planar', (D) => `const a = prism(6, 20, 12);\nmove(a, [${D}, ${D}, ${D}]);`, 10],
  ['move wedge', 'planar', (D) => `const a = wedge(20, 10, 8);\nmove(a, [${D}, ${D}, ${D}]);`, 10],
  ['box at D, turn [5000,3000,100] (critic)', 'planar', (D) => `const a = box(30, 20, 10, { at: [${D}, ${D}, ${D}] });\nturn(a, [5000, 3000, 100]);`, 18],
  ['move,hole,turn(derived box)', 'planar', (D) => `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nmove(a, [${D}, ${D}, ${D}]);\nturn(a, [10, 20, 30]);`, 20],
  ['move,fillet box', 'planar+curved', (D) => `const a = box(30, 20, 10);\nround(a.edge('top', 'front'), 2);\nmove(a, [${D}, ${D}, ${D}]);`, 15],
  ['move cylinder d16 h20', 'curved', (D) => `const a = cylinder(16, 20);\nmove(a, [${D}, ${D}, ${D}]);`, 10],
  ['move sphere d14', 'curved', (D) => `const a = sphere(14);\nmove(a, [${D}, ${D}, ${D}]);`, 7],
  ['move cone d14 h18', 'curved', (D) => `const a = cone(14, 18);\nmove(a, [${D}, ${D}, ${D}]);`, 9],
  ['turn cylinder at D', 'curved', (D) => `const a = cylinder(16, 20, { at: [${D}, ${D}, ${D}] });\nturn(a, [30, 40, 50]);`, 14],
];
const FS = [3000, 5000, 10000, 20000, 50000, 1e5, 1e6, 1e7];
const out = [];
for (const [name, fam, mk, half] of SHAPES) {
  for (const F of FS) {
    const D = F - half; const script = mk(D);
    const r = runCase({ script }); const id = r.features.at(-1).id; const t = r.truck[id]; const v = verdict(r, id);
    const row = { name, family: fam, F, D, shipped: v, dVol: t.dVol, dBbox: t.dBbox, dCom: t.dCom, curved: t.curved };
    if (withGuard) { const g = runCase({ script, translateFn: guard }); const gt = g.truck[id]; row.guard = verdict(g, id); row.guardRefusal = gt.refused ?? null; row.guardDCom = gt.dCom; row.guardDVol = gt.dVol; }
    out.push(row);
    console.log(name.padEnd(40), fam.padEnd(14), String(F).padEnd(9), 'shipped', v.padEnd(7), `dVol=${f(t.dVol)} dBbox=${f(t.dBbox)} dCom=${f(t.dCom)}`, withGuard ? `| guard ${row.guard} ${row.guardRefusal ?? ''}` : '');
  }
}
writeFileSync(withGuard ? 'r4-magnitude-guard-results.json' : 'r4-magnitude-results.json', JSON.stringify(out, null, 1));
