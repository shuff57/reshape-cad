// Round 2: hole(deep) then hollow(open:'top'): the hole lies inside the cavity, so the exact answer is the plain shell (7152 at the origin).
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const cases = [
  ['hole deep8 at[5,5] across6, open top, at [7,-5,3]', `const b=box(40,30,20,{at:[7,-5,3]})\nhole(b,{across:6,at:[5,5],deep:8})\nhollow(b,{wall:2,open:"top"})`, 7152],
  ['same at origin', `const b=box(40,30,20)\nhole(b,{across:6,at:[5,5],deep:8})\nhollow(b,{wall:2,open:"top"})`, 7152],
  ['hole centred deep8', `const b=box(40,30,20)\nhole(b,{across:6,deep:8})\nhollow(b,{wall:2,open:"top"})`, 7152],
  ['hole deep 3', `const b=box(40,30,20)\nhole(b,{across:6,at:[5,5],deep:3})\nhollow(b,{wall:2,open:"top"})`, 7152],
  ['hole deep 17', `const b=box(40,30,20)\nhole(b,{across:6,at:[5,5],deep:17})\nhollow(b,{wall:2,open:"top"})`, 7152],
  ['hole deep 19 (floor left 1)', `const b=box(40,30,20)\nhole(b,{across:6,at:[5,5],deep:19})\nhollow(b,{wall:2,open:"top"})`, 7152 - Math.PI * 9 * 1],
  ['hole across 10 deep 8', `const b=box(40,30,20)\nhole(b,{across:10,at:[5,5],deep:8})\nhollow(b,{wall:2,open:"top"})`, 7152],
  ['hole in the wall zone (x=-17) deep 8', `const b=box(40,30,20)\nhole(b,{across:3,at:[-17,0],deep:8})\nhollow(b,{wall:2,open:"top"})`, null],
  ['through hole then hollow open top', `const b=box(40,30,20)\nhole(b,{across:6,at:[5,5]})\nhollow(b,{wall:2,open:"top"})`, 7152],
  ['blind hole from top, hollow open bottom', `const b=box(40,30,20,{at:[7,-5,3]})\nhole(b,{across:6,at:[5,5],deep:8})\nhollow(b,{wall:2,open:"bottom"})`, null],
];
const rows = [];
for (const [label, src, cf] of cases) {
  const f = L.fromScript(src); if (f.errors.length) { console.log(label, 'SCRIPT ERR', f.errors[0].message); continue; }
  const ref = L.references(f.doc); const row = await L.scored(f.doc, { ref });
  const sc = row.truck?.volume;
  const o = { label, src, outcome: row.outcome, sentence: row.sentence, sc, closedForm: cf, dCF: cf && sc ? (sc - cf) / cf : null, scFaces: row.truck?.faces, scBodies: row.truck?.bodies, occt: ref.occt?.volume ?? ref.occt?.refused, occtRefusals: ref.occtRefusals, occtFaces: ref.occt?.faces, brep: ref.brep?.volume ?? ref.brep?.refused, brepRefusals: ref.brepRefusals, features: row.features.map((x) => `${x.id}:${x.status}`) };
  rows.push(o);
  console.log(label.padEnd(48), row.outcome.padEnd(12), 'SC', sc?.toFixed(3), 'faces', o.scFaces, 'bodies', o.scBodies, 'CF', cf?.toFixed?.(3), 'd', o.dCF?.toExponential(1), '| OCCT', typeof o.occt === 'number' ? o.occt.toFixed(3) : o.occt, JSON.stringify(o.occtRefusals).slice(0, 80), '| BREP', typeof o.brep === 'number' ? o.brep.toFixed(3) : String(o.brep).slice(0, 60), o.sentence ? '| ' + o.sentence.slice(0, 80) : '');
}
writeFileSync('r2d-hole-hollow.json', JSON.stringify(rows, null, 1));
