// Round 5 (critic round 2). The file's own WRONG rows, driven through the SHIPPING page translator (translate-p4, unguarded: what a student gets today)
// and through the contract guard layer (r3-guard.mjs: what the page must add), same script text, same oracles.
//   R3_OUT=<dir> SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5e-page-vs-guard.mjs
import { L, save, out } from './common.mjs';
import { guardedTranslate } from './r3-guard.mjs';
const cases = [
  ['row 38  bevel 2 on a 40x30x1 slab', `const b = cuboid(40,30,1);\nbevel(b.edge('top','front'), 2);`],
  ['row 38b bevel 2 on a 40x1x20 slab', `const b = cuboid(40,1,20);\nbevel(b.edge('top','front'), 2);`],
  ['row 44  hollow then round r=3 of the rim', `const b = cuboid(40,30,20);\nhollow(b, { wall: 2, open: 'top' });\nround(b.edge('top','front'), 3);`],
  ['row 45  blind hole then hollow', `const b = cuboid(40,30,20, { at: [7,-5,3] });\nhole(b, { across: 6, at: [5,5], deep: 8 });\nhollow(b, { wall: 2, open: 'top' });`],
  ['row 17  hollow then draft 15 deg of the front wall', `const b = cuboid(40,30,20);\nhollow(b, { wall: 2, open: 'top' });\ndraft(b.face('front'), 15);`],
  ['row 2   draft 80 deg right face of a 40x30x20 box', `const b = cuboid(40,30,20);\ndraft(b.face('right'), 80);`],
  ['row 40  hollow wall 15 of a 40x30x20 box', `const b = cuboid(40,30,20);\nhollow(b, { wall: 15, open: 'top' });`],
  ['row 43 stepped union hollow open top', `const a = cuboid(40,30,10);\nconst c = cuboid(20,20,10,{at:[0,0,10]});\nconst u = join(a, c);\nhollow(u, { wall: 2, open: 'top' });`],
  ['row 43 notch subtract hollow open bottom', `const b = cuboid(40,40,20);\nconst c = cuboid(10,50,10,{at:[0,0,10]});\nconst d = subtract(b, c);\nhollow(d, { wall: 2, open: 'bottom' });`],
  ['row 43 through hole then hollow top (control, must stay built)', `const b = cuboid(40,30,20,{at:[5,-3,2]});\nhole(b, { across: 6 });\nhollow(b, { wall: 2, open: 'top' });`],
  ['row 43 plain box hollow (control, must stay built)', `const b = cuboid(40,30,20);\nhollow(b, { wall: 2, open: 'top' });`],
  ['round-then-hollow r=3 (new)', `const b = cuboid(40,30,20);\nround(b.edge('top','front'), 3);\nhollow(b, { wall: 2, open: 'top' });`],
  ['stale pocket + round (new)', `const sk1 = sketch('top'); sk1.rect(40,30,{at:[20,15]});\nconst p = extrude(sk1, 10);\nconst sk2 = sketch('top', 10); sk2.rect(10,10,{at:[20,15]});\npocket(sk2, p, 4);\nround(p.edge('top','front'), 1);`],
];
const rows = [];
for (const [label, src] of cases) {
  const r = L.fromScript(src); if (r.errors.length) { console.log(label, 'SCRIPT ERROR', r.errors[0].message); rows.push({ label, scriptError: r.errors[0].message }); continue; }
  const doc = r.doc; const ref = L.references(doc);
  const rec = { label, src };
  for (const mode of ['page', 'guarded']) {
    globalThis.__R3_TRANSLATE = mode === 'guarded' ? (d) => guardedTranslate(d) : undefined;
    const row = await L.scored(doc, { ref });
    rec[mode] = { outcome: row.outcome, sc: row.truck?.volume, faces: row.truck?.faces, sentence: row.sentence, dVol: row.score?.dVol };
  }
  rec.oracle = { occt: ref.occt?.volume, occtFaces: ref.occt?.faces, occtRefusals: ref.occtRefusals, brep: ref.brep?.volume, brepFaces: ref.brep?.faces, brepRefusals: ref.brepRefusals };
  rows.push(rec);
  console.log(label.padEnd(52), '| PAGE', rec.page.outcome, rec.page.sc?.toFixed?.(4) ?? '', 'faces', rec.page.faces ?? '', rec.page.sentence ? '"' + rec.page.sentence.slice(0, 140) + '"' : '', '| GUARDED', rec.guarded.outcome, rec.guarded.sc?.toFixed?.(4) ?? '', rec.guarded.sentence ? '"' + rec.guarded.sentence.slice(0, 200) + '"' : '', '| OCCT', rec.oracle.occt?.toFixed?.(4), 'brep', rec.oracle.brep?.toFixed?.(4), JSON.stringify(rec.oracle.occtRefusals).slice(0, 90));
}
import { writeFileSync } from 'node:fs';
writeFileSync((process.env.R3_OUT ? process.env.R3_OUT + '/' : '') + 'r5e-page-vs-guard.json', JSON.stringify(rows, null, 1));
