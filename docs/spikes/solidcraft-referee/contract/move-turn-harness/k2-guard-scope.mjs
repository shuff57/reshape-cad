// scope of the pick guard: taint must travel through hole/join/mirror/repeat, and must NOT refuse picks on an untouched shape
import { writeFileSync } from 'node:fs';
import { runCase, runScript } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : v);
const C = {
  'move;hole;round': `const a = box(30, 20, 10);\nmove(a, [0, -30, 0]);\nhole(a, { across: 4 });\nround(a.edge('top', 'front'), 2);`,
  'move;hole;hollow(top)': `const a = box(30, 20, 10);\nmove(a, [0, 0, 10]);\nhole(a, { across: 4 });\nhollow(a, { wall: 2, open: 'top' });`,
  'move(b);round(a) untouched': `const a = box(30, 20, 10);\nconst b = box(10, 10, 10, { at: [50, 0, 0] });\nmove(b, [0, 30, 0]);\nround(a.edge('top', 'front'), 2);`,
  'turn(b);hollow(a) untouched': `const a = box(30, 20, 10);\nconst b = box(10, 10, 10, { at: [50, 0, 0] });\nturn(b, [0, 0, 30]);\nhollow(a, { wall: 2, open: 'top' });`,
  'round;move;hole': `const a = box(30, 20, 10);\nround(a.edge('top', 'front'), 2);\nmove(a, [0, 0, 10]);\nhole(a, { across: 4 });`,
  'move;mirror;round': `const a = box(10, 10, 10, { at: [20, 0, 0] });\nmove(a, [0, 0, 5]);\nconst m = mirror(a, 'left-right');\nround(m.edge('top', 'front'), 1);`,
  'move;repeat;hollow(top)': `const a = box(10, 10, 10);\nmove(a, [0, 0, 10]);\nconst p = repeat(a, { count: 2, step: [15, 0, 0] });\nhollow(p, { wall: 1, open: 'top' });`,
};
const out = [];
for (const [k, script] of Object.entries(C)) {
  const r0 = runScript(script);
  if (r0.errors.length) { console.log(k, 'SCRIPT ERROR', r0.errors[0].message); continue; }
  const ids = r0.doc.features.map((x) => x.id);
  const id = ids.at(-1);
  const g = runCase({ script, ids: [id], translateFn: guard });
  const s = runCase({ script, ids: [id] });
  console.log(k.padEnd(30), 'kinds', r0.doc.features.map((x) => x.kind).join('>').padEnd(36), 'shipped', verdict(s, id).padEnd(8), 'guard', verdict(g, id).padEnd(8), g.truck[id].refused ? g.truck[id].refused.slice(0, 110) : `dVol=${f(g.truck[id].dVol)} dCom=${f(g.truck[id].dCom)}`, Object.keys(g.occtRefusals).length ? '| OCCT-REFUSES ' + JSON.stringify(g.occtRefusals).slice(0, 100) : '');
  out.push({ k, script, kinds: r0.doc.features.map((x) => x.kind), shipped: verdict(s, id), guard: verdict(g, id), guardRefusal: g.truck[id].refused, occtRefusals: g.occtRefusals, dVol: g.truck[id].dVol, dCom: g.truck[id].dCom });
}
writeFileSync('k2-guard-scope-results.json', JSON.stringify(out, null, 1));
