// move()/turn() of a part that join/cut/mirror/repeat already used ("fork" scripts): OCCT builds a separate moved shape, the translator refuses.
import { writeFileSync } from 'node:fs';
import { runCase, runScript, mt } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const C = {
  'join(a,b);move(b)': `const a = box(20, 10, 6);\nconst b = box(10, 10, 6, { at: [30, 0, 0] });\njoin(a, b);\nmove(b, [0, 40, 0]);`,
  'join(a,b);move(a)': `const a = box(20, 10, 6);\nconst b = box(10, 10, 6, { at: [30, 0, 0] });\njoin(a, b);\nmove(a, [0, 40, 0]);`,
  'join(a,b);turn(b)': `const a = box(20, 10, 6);\nconst b = box(10, 10, 6, { at: [30, 0, 0] });\njoin(a, b);\nturn(b, [0, 0, 45]);`,
  'join(a,b);turn(a)': `const a = box(20, 10, 6);\nconst b = box(10, 10, 6, { at: [30, 0, 0] });\njoin(a, b);\nturn(a, [0, 0, 45]);`,
  'cut(a,c);move(c)': `const a = box(30, 30, 10);\nconst c = cylinder(5, 20, { at: [3, 3, 0] });\ncut(a, c);\nmove(c, [0, 50, 0]);`,
  'mirror(v);move(v)': `const a = box(10, 10, 10, { at: [20, 0, 0] });\nconst v = mirror(a, 'left-right');\nmove(v, [0, 40, 0]);`,
  'mirror(v);move(a)': `const a = box(10, 10, 10, { at: [20, 0, 0] });\nconst v = mirror(a, 'left-right');\nmove(a, [0, 40, 0]);`,
  'repeat(a);move(a)': `const a = box(10, 10, 10);\nrepeat(a, { count: 3, step: [15, 0, 0] });\nmove(a, [0, 40, 0]);`,
  'repeat(a);turn(a)': `const a = box(10, 10, 10);\nrepeat(a, { count: 3, step: [15, 0, 0] });\nturn(a, [0, 0, 45]);`,
  'join(a,b derived);turn(b)': `const a = box(20, 10, 6);\nconst k = sketch('top');\nk.rect(10, 10);\nconst b = pull(k, 6);\nmove(b, [30, 0, 0]);\njoin(a, b);\nturn(b, [0, 0, 45]);`,
  'FIX join(a,b);move(b)': `const a = box(20, 10, 6);\nconst b = box(10, 10, 6, { at: [30, 0, 0] });\nmove(b, [0, 40, 0], { copy: true });\njoin(a, b);`,
  'FIX cut(a,c);move(c)': `const a = box(30, 30, 10);\nconst c = cylinder(5, 20, { at: [3, 3, 0] });\nmove(c, [0, 50, 0], { copy: true });\ncut(a, c);`,
  'FIX mirror(v);move(a)': `const a = box(10, 10, 10, { at: [20, 0, 0] });\nmove(a, [0, 40, 0], { copy: true });\nmirror(a, 'left-right');`,
  'move(a);move(a) CONTROL': `const a = box(10, 10, 10);\nmove(a, [20, 0, 0]);\nmove(a, [0, 20, 0]);`,
  'hole(a);move(a) CONTROL': `const a = box(30, 20, 10);\nhole(a, { across: 4 });\nmove(a, [0, 40, 0]);`,
  'move(copy);join CONTROL': `const a = box(20, 10, 6);\nconst b = move(a, [10, 0, 0], { copy: true });\njoin(a, b);`,
};
const out = [];
for (const [k, script] of Object.entries(C)) {
  const r0 = runScript(script);
  if (r0.errors.length) { console.log(k, 'SCRIPT ERROR', r0.errors[0].message); continue; }
  const ids = r0.doc.features.filter((x) => !['sketch', 'datum'].includes(x.kind)).map((x) => x.id);
  const g = runCase({ script, ids, translateFn: guard });
  const s = runCase({ script, ids });
  const topIds = mt.topLevel(r0.doc).map((x) => x.id);
  console.log('###', k, '| top-level:', topIds.join(','), '| OCCT shapes:', Object.fromEntries(Object.entries(g.occt).filter(([i]) => topIds.includes(i)).map(([i, o]) => [i, { vol: +o.volume.toFixed(3), bbox: o.bbox.map((v) => +v.toFixed(2)) }])), '| OCCT refusals:', JSON.stringify(g.occtRefusals));
  const rec = { k, script, topIds, occt: g.occt, occtRefusals: g.occtRefusals, features: [] };
  for (const id of ids) {
    const gv = verdict(g, id), sv = verdict(s, id);
    console.log(`   ${id.padEnd(8)} guard ${gv.padEnd(8)} ${g.truck[id].refused ?? ''}`);
    console.log(`   ${''.padEnd(8)} shipped ${sv.padEnd(8)} ${s.truck[id].refused ?? ''}`);
    rec.features.push({ id, guard: gv, guardRefusal: g.truck[id].refused, shipped: sv, shippedRefusal: s.truck[id].refused, dVol: g.truck[id].dVol, dBbox: g.truck[id].dBbox, dCom: g.truck[id].dCom });
  }
  out.push(rec);
}
writeFileSync('n-fork-results.json', JSON.stringify(out, null, 1));
