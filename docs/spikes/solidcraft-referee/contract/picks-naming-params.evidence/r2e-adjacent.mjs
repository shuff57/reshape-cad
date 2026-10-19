// Round 2: one edge per feature. Sequential rounds/bevels on edges that share a corner, list forms, non-adjacent controls, and
// the engine fed several edges in ONE command (the translator limitation vs the kernel).
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const B = `const b=box(40,30,20,{at:[5,-3,2]})\n`;
const cases = [
  ['round top|front, then round top|right (adjacent)', B + `round(b.edge('top','front'),2)\nround(b.edge('top','right'),2)`],
  ['bevel top|front, then bevel top|right', B + `bevel(b.edge('top','front'),2)\nbevel(b.edge('top','right'),2)`],
  ['round top|front, then bevel top|right', B + `round(b.edge('top','front'),2)\nbevel(b.edge('top','right'),2)`],
  ['round top|front, then round front|right (vertical, shares corner)', B + `round(b.edge('top','front'),2)\nround(b.edge('front','right'),2)`],
  ['round top|front, then round bottom|back (no shared corner)', B + `round(b.edge('top','front'),2)\nround(b.edge('bottom','back'),2)`],
  ['round top|front, then round top|back (parallel, no shared corner)', B + `round(b.edge('top','front'),2)\nround(b.edge('top','back'),2)`],
  ['round top|front, then round bottom|front (parallel, no shared corner)', B + `round(b.edge('top','front'),2)\nround(b.edge('bottom','front'),2)`],
  ['round([top|front, top|right], 2) list', B + `round([b.edge('top','front'), b.edge('top','right')], 2)`],
  ['round of whole box round(b,2)', B + `round(b,2)`],
  ['round(b.edge(top,front)) at origin box then top|right', `const b=box(40,30,20)\nround(b.edge('top','front'),2)\nround(b.edge('top','right'),2)`],
];
const rows = [];
for (const [label, src] of cases) {
  const f = L.fromScript(src); if (f.errors.length) { console.log(label.padEnd(66), 'SCRIPT ERR', f.errors[0].message); rows.push({ label, src, scriptError: f.errors[0].message }); continue; }
  const ref = L.references(f.doc); const row = await L.scored(f.doc, { ref });
  const o = { label, src, outcome: row.outcome, sentence: row.sentence, refusals: row.refusals, built: row.features.filter((x) => x.status === 'built').map((x) => x.id), sc: row.truck?.volume, occt: ref.occt?.volume ?? ref.occt?.refused, occtRef: ref.occtRefusals, brep: ref.brep?.volume ?? ref.brep?.refused, brepRef: ref.brepRefusals };
  rows.push(o);
  console.log(label.padEnd(66), row.outcome.padEnd(12), 'SC', row.truck?.volume?.toFixed(3), '| built', o.built.join(','), '| OCCT', typeof o.occt === 'number' ? o.occt.toFixed(3) : String(o.occt).slice(0, 40), JSON.stringify(o.occtRef).slice(0, 70), '| BREP', typeof o.brep === 'number' ? o.brep.toFixed(3) : String(o.brep).slice(0, 40));
  for (const [k, v] of Object.entries(row.refusals ?? {})) console.log('     REFUSED', k, ':', v);
}
writeFileSync('r2e-adjacent.json', JSON.stringify(rows, null, 1));
