// Round 4: hollow THEN draft a wall. Page translator vs the guarded one (G-DRAFTWALL), scored against live OCCT and brep-rs.
//   R3_OUT=<dir> SOLIDCRAFT_REFEREE_PKG=<pkg> bun r4g-draft-wall-sweep.mjs
import * as L from './lib.mjs';
import { guardedTranslate } from './r3-guard.mjs';
import { writeFileSync } from 'node:fs';
const rows = []; const tally = {};
const bump = (k) => (tally[k] = (tally[k] || 0) + 1);
for (const wall of [1, 1.5, 3]) for (const face of ['front', 'right']) for (const neutral of [-10, -3, 0, 10]) for (const ang of [-12, -8, -4, 2, 4, 6, 8, 12]) {
  const src = `const b = cuboid(30,36,20,{at:[-5,9,0]})\nhollow(b,{wall:${wall},open:'top'})\ndraft(b.face('${face}'),${ang},{neutral:${neutral}})`;
  const f = L.fromScript(src); if (f.errors.length) { bump('scriptError'); continue; }
  const doc = L.cg.solveDoc(f.doc); const ref = L.references(doc);
  delete globalThis.__R3_TRANSLATE; const u = await L.scored(doc, { ref });
  globalThis.__R3_TRANSLATE = (d) => guardedTranslate(d); const g = await L.scored(doc, { ref });
  delete globalThis.__R3_TRANSLATE;
  const oracle = ref.occt?.volume !== undefined || ref.brep?.volume !== undefined;
  let cls;
  if (!oracle) cls = 'no-oracle';
  else if (u.outcome === 'FAIL' && g.outcome === 'REFUSED') cls = 'caught';
  else if (u.outcome === 'FAIL') cls = 'MISSED';
  else if (u.outcome === 'PASS' && g.outcome === 'REFUSED') cls = 'refused-kernels-agree'; // SolidCraft = OCCT here; r4h shows both off the half-space closed form
  else cls = `${u.outcome}/${g.outcome}`;
  bump(cls);
  rows.push({ wall, face, neutral, ang, unguarded: u.outcome, guarded: g.outcome, dVol: u.score?.dVol, sc: u.truck?.volume, occt: ref.occt?.volume, sentence: g.sentence, cls });
  if (cls === 'MISSED') console.log('!!', cls, JSON.stringify(rows.at(-1)));
}
console.log('TALLY', JSON.stringify(tally));
for (const r of rows.filter((r) => r.cls === 'caught').slice(0, 3)) console.log(JSON.stringify(r));
writeFileSync((process.env.R3_OUT ? process.env.R3_OUT + '/' : '') + 'r4g-draft-wall-sweep.json', JSON.stringify(rows, null, 1));
