// coordinate-magnitude limit of move/turn: how far from the origin does the planar 1e-9 bar (dVol, dBbox) and the COM bar hold?
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : String(v));
const out = [];
function go(group, D, script) {
  const r = runCase({ script });
  if (r.errors.length) { console.log(group, D, 'SCRIPT ERROR', r.errors[0]); return; }
  const id = r.features.at(-1).id; const t = r.truck[id]; const v = verdict(r, id);
  const b = r.brep[id];
  out.push({ group, D, script, id, v, truck: t.refused ? { refused: t.refused } : { dVol: t.dVol, dBbox: t.dBbox, dCom: t.dCom, faces: t.faces, occtFaces: t.occtFaces, bbox: t.bbox, occtBbox: t.occtBbox }, brep: b });
  console.log(group.padEnd(22), String(D).padEnd(8), v.padEnd(8), t.refused ? t.refused.slice(0, 120) : `dVol=${f(t.dVol)} dBbox=${f(t.dBbox)} dCom=${f(t.dCom)} faces=${t.faces}/${t.occtFaces} | brep dVol=${f(b?.dVol)}`);
}
for (const D of [1e2, 1e3, 1e4, 1e5, 1e6, 1e7]) {
  go('move box', D, `const a = box(30, 20, 10);\nmove(a, [${D}, ${-D}, ${D / 2}]);`);
  go('move box then back', D, `const a = box(30, 20, 10);\nmove(a, [${D}, ${-D}, ${D / 2}]);\nmove(a, [${-D}, ${D}, ${-D / 2}]);`);
  go('box at D + own turn', D, `const a = box(30, 20, 10, { at: [${D}, ${D}, 0] });\nturn(a, [10, 20, 30]);`);
  go('move,hole,turn(derived)', D, `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nmove(a, [${D}, ${D}, ${D}]);\nturn(a, [10, 20, 30]);`);
  go('move cylinder', D, `const a = cylinder(8, 20);\nmove(a, [${D}, ${D}, ${D}]);`);
  go('move then hole', D, `const a = box(30, 20, 10);\nmove(a, [${D}, 0, 0]);\nhole(a, { across: 4 });`);
}
writeFileSync('p-magnitude-results.json', JSON.stringify(out, null, 1));
