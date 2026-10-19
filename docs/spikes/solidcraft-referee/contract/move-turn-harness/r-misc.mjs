// two small checks: (1) closed hollow + move/turn student sentences, (2) brep-rs on move-of-cut (oracle note)
import { runCase } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : v);
const C = {
  'closed hollow': `const a = box(30, 20, 10);\nhollow(a, { wall: 2 });`,
  'closed hollow;move': `const a = box(30, 20, 10);\nhollow(a, { wall: 2 });\nmove(a, [12, -7, 3.5]);`,
  'closed hollow;turn': `const a = box(30, 20, 10);\nhollow(a, { wall: 2 });\nturn(a, [0, 0, 30]);`,
  'open hollow;turn;move (control)': `const a = box(30, 20, 10);\nhollow(a, { wall: 2, open: 'top' });\nturn(a, [0, 0, 30]);\nmove(a, [5, 5, 5]);`,
  'cut(box, cyl r10 overhang);move': `const s0 = box(30, 20, 10);\nconst c = cylinder(10, 30, { at: [10, 0, 0] });\nconst s = cut(s0, c);\nmove(s, [12, -7, 3.5]);`,
  'cut(box, cyl offset);move': `const a = box(30, 30, 30);\nconst c = cylinder(5, 50, { at: [3, 3, 0] });\nconst v = cut(a, c);\nmove(v, [10, 0, 0]);`,
};
for (const [k, script] of Object.entries(C)) {
  const r = runCase({ script, translateFn: guard });
  const id = r.features.at(-1).id; const t = r.truck[id]; const b = r.brep[id];
  console.log(k.padEnd(34), verdict(r, id).padEnd(8), t.refused ?? `dVol=${f(t.dVol)} dBbox=${f(t.dBbox)} dCom=${f(t.dCom)}`, '| OCCT vol', r.occt[id]?.volume?.toFixed(3), '| brep', b?.refused ?? `dVol=${f(b?.dVol)}`);
  if (t.refused) for (const x of r.truckFeatures) if (x.refusal) console.log('     ', x.id, '->', x.refusal);
}
