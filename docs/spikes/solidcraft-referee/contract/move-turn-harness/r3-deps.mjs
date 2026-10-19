// round 3: the sentence a student sees for a move/turn/copy whose TARGET the engine refused (the dependent), next to the sentence on the refused feature itself.
// Guard translator: the raw engine text is kept in `raw` and never shown. Shipped phase0 translator printed for comparison (it embeds engine jargon).
import { writeFileSync } from 'node:fs';
import { runCase, runScript } from './runner.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const C = {
  'hollow(no open) then turn': `const a = box(30, 20, 10);\nhollow(a, { wall: 2 });\nturn(a, [0, 0, 45]);`,
  'hollow(no open) then move': `const a = box(30, 20, 10);\nhollow(a, { wall: 2 });\nmove(a, [0, 30, 0]);`,
  'hollow(no open) then copy': `const a = box(30, 20, 10);\nhollow(a, { wall: 2 });\nmove(a, [0, 30, 0], { copy: true });`,
  'hollow(no open), turn, then join with box': `const a = box(30, 20, 10);\nhollow(a, { wall: 2 });\nturn(a, [0, 0, 45]);\nconst b = box(10, 10, 10, { at: [0, 0, 0] });\njoin(a, b);`,
  'ring, hole (engine refuses), then turn': `const t = ring(30, 6);\nhole(t, { across: 3 });\nturn(t, [0, 0, 30]);`,
  'ring, hole through the tube (time limit), then turn': `const t = ring(30, 6);\nhole(t, { across: 2, at: [12, 0] });\nturn(t, [0, 0, 30]);`,
  'ring, hole (engine refuses), then copy': `const t = ring(30, 6);\nhole(t, { across: 3 });\nmove(t, [0, 40, 0], { copy: true });`,
  'turned box, draft (engine refuses), then move': `const a = box(30, 20, 10);\nturn(a, [10, 20, 30]);\ndraft(a.face('right'), 5);\nmove(a, [0, 40, 0]);`,
  'turned box, draft (engine refuses), then turn': `const a = box(30, 20, 10);\nturn(a, [10, 20, 30]);\ndraft(a.face('right'), 5);\nturn(a, [0, 0, 20]);`,
};
const out = [];
for (const [k, script] of Object.entries(C)) {
  const r0 = runScript(script);
  if (r0.errors.length) { console.log(k, 'SCRIPT ERROR', r0.errors[0].message); out.push({ case: k, script, errors: r0.errors.map((e) => e.message) }); continue; }
  const g = runCase({ script, translateFn: guard });
  const s = runCase({ script });
  const feats = r0.doc.features.filter((x) => !['sketch', 'datum'].includes(x.kind)).map((x) => x.id);
  const row = { case: k, script, features: feats.map((id) => ({ id, guard: g.truckFeatures.find((x) => x.id === id), shipped: s.truckFeatures.find((x) => x.id === id) })) };
  out.push(row);
  console.log('###', k);
  for (const x of row.features) console.log(`   ${x.id.padEnd(7)} guard ${x.guard?.status} ${x.guard?.refusal ?? ''}\n   ${''.padEnd(7)} shipped ${x.shipped?.status} ${x.shipped?.refusal ?? ''}`);
}
writeFileSync('r3-deps-results.json', JSON.stringify(out, null, 1));
