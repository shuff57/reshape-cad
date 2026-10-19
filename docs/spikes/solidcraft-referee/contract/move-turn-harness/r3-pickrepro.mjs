// round 3: the critic's three pick-after-move/turn repros, shipped phase0 translator vs the guard, against live OCCT.
import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const C = {
  'move [0,0,20] then round top/front edge': `const a = box(40, 30, 20);\nmove(a, [0, 0, 20]);\nround(a.edge('top', 'front'), 2);`,
  'move [0,0,20] then hollow open top': `const a = box(40, 30, 20);\nmove(a, [0, 0, 20]);\nhollow(a, { wall: 2, open: 'top' });`,
  'hole, turn 180, then round top/front edge': `const a = box(40, 30, 20);\nhole(a, { across: 4 });\nturn(a, [0, 0, 180]);\nround(a.edge('top', 'front'), 2);`,
};
const out = [];
for (const [name, script] of Object.entries(C)) {
  const s = runCase({ script }); const g = runCase({ script, translateFn: guard });
  const id = s.features.at(-1).id;
  const row = { name, script, id, occtVolume: s.truck[id].occtVolume, shipped: { v: verdict(s, id) === 'FAIL' ? 'FAIL' : verdict(s, id), dVol: s.truck[id].dVol, dCom: s.truck[id].dCom, dBbox: s.truck[id].dBbox }, guard: { v: verdict(g, id), refusal: g.truck[id].refused ?? null }, brepDVol: s.brep[id]?.dVol };
  out.push(row); console.log(JSON.stringify(row));
}
writeFileSync('r3-pickrepro.json', JSON.stringify(out, null, 1));
