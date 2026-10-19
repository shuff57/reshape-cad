// round 3: the 3000 mm limit as a REFUSAL. For each shape the offset is chosen so the part's farthest bounding-box coordinate is exactly F mm from the origin
// (F = 2000, 3000 must build and match; 3001, 5000, 1e5, 1e7 must be refused with a sentence). Guard translator vs live OCCT. Round 2 reported these as 'unsupported' (no sentence) while they built wrong.
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard, MAX_COORD } from './translate-guard.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : String(v));
// [name, script template with $D, half-extent of the farthest axis (the move is along +x +y +z so every axis carries D)]
const SHAPES = [
  ['move box 30x20x10', (D) => `const a = box(30, 20, 10);\nmove(a, [${D}, ${D}, ${D}]);`, 15],
  ['move cylinder d16 h20', (D) => `const a = cylinder(16, 20);\nmove(a, [${D}, ${D}, ${D}]);`, 10],
  ['move sphere d14', (D) => `const a = sphere(14);\nmove(a, [${D}, ${D}, ${D}]);`, 7],
  ['move,hole,turn(derived)', (D) => `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nmove(a, [${D}, ${D}, ${D}]);\nturn(a, [10, 20, 30]);`, 15],
  ['box at D own turn', (D) => `const a = box(30, 20, 10, { at: [${D}, ${D}, ${D}] });\nturn(a, [0, 0, 0]);`, 15],
];
const out = [];
for (const [name, mk, half] of SHAPES) {
  for (const F of [2000, 3000, 3001, 5000, 1e5, 1e7]) {
    const D = F - half; // farthest bbox coordinate = F (turn about the bbox centre can grow it a little; the guard measures the real bbox)
    const script = mk(D);
    const r = runCase({ script });
    const id = r.features.at(-1).id; const t = r.truck[id]; const v = verdict(r, id);
    const g = runCase({ script, translateFn: guard });
    const gt = g.truck[id]; const gv = verdict(g, id);
    const row = { name, F, D, shipped: v, shippedDCom: t.dCom, guard: gv, guardRefusal: gt.refused ?? null, guardDVol: gt.dVol, guardDBbox: gt.dBbox, guardDCom: gt.dCom, occtBbox: gt.occtBbox ?? t.occtBbox };
    out.push(row);
    console.log(name.padEnd(26), String(F).padEnd(8), 'shipped', v.padEnd(7), `dCom=${f(t.dCom)}`.padEnd(14), '| guard', gv.padEnd(8), gt.refused ? gt.refused : `dVol=${f(gt.dVol)} dBbox=${f(gt.dBbox)} dCom=${f(gt.dCom)}`);
  }
}
writeFileSync('r3-magnitude-results.json', JSON.stringify({ MAX_COORD, rows: out }, null, 1));
