// Round 6 B. The seven refused/wrong rows whose evidence did not say the cited guard produced the sentence (rows 15 18 21 22 35 41 45):
// run the cited input through the guard layer and compare the sentence with the row's specifiedSentence.
// Rows 15 and 35 are ModelDoc-level / cascade cases already logged by r5c-lib / r5d-cascade (guarded logs); rows 18 21 22 41 45 are replayed here.
//   HOME=<dir with the native cli> bun r6b-sentences.mjs --out=<file>
import * as L from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { guardedTranslate } from './r3-guard.mjs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r6b-sentences.json';
const rows = JSON.parse(readFileSync(new URL('../picks-naming-params.json', import.meta.url), 'utf8')).rows;
const H = (t, p, d) => `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });\nconst plate = extrude(sk1, ${t});\nconst sk2 = sketch('top', ${t}); sk2.rect(${p}, ${p}, { at: [20, 15] });\nconst part = pocket(sk2, plate, ${d});\n`;
const cases = [
  [18, "const b = cuboid(30,36,20,{at:[-5,9,0]});\nhollow(b, { wall: 1.5, open: 'top' });\ndraft(b.face('front'), 7, { neutral: -3 });"],
  [21, "const sk1 = sketch('top'); sk1.rect(40,30,{at:[20,15]});\nconst p = extrude(sk1, 10);\nconst sk2 = sketch('top', 10); sk2.rect(10,10,{at:[20,15]});\npocket(sk2, p, 4);\nround(p.edge('top','front'), 1);"],
  [22, "const b = cuboid(40,40,20);\nconst c = cuboid(10,50,10,{at:[0,0,10]});\nconst d = subtract(b, c);\nround(d.edge('bottom','front'), 2);"],
  [41, "const b = cuboid(40,30,20);\nround(b.edge('top','front'), 3);\nhollow(b, { wall: 2, open: 'top' });"],
  [45, H(10, 10, 10) + "bevel(part.edge(part.wall(sk2,1), part.wall(sk2,2)), 1);"],
];
const out = [];
for (const [ri, src] of cases) {
  const r = L.fromScript(src); if (r.errors.length) { out.push({ row: ri, scriptError: r.errors[0].message }); console.log(ri, 'SCRIPT ERROR', r.errors[0].message); continue; }
  const g = await guardedTranslate(r.doc); const last = g.features.find((f) => f.id === L.lastSolid(r.doc));
  const spec = rows[ri].specifiedSentence;
  // numbers/ids may differ from the row's example; compare after masking digits and feature ids
  const mask = (s) => String(s).replace(/[0-9.]+/g, '#').replace(/\b(round|bevel|shell|draft|pocket|pull|box|hole|op)#/g, '$1#');
  const o = { row: ri, status: last.status, sentence: last.refusal, specified: spec, same: last.refusal === spec, sameMasked: mask(last.refusal) === mask(spec), raw: last.rawRefusal?.slice(0, 160), guard: last.guard };
  out.push(o); console.log(ri, o.status, o.same ? 'IDENTICAL' : o.sameMasked ? 'same up to numbers' : 'DIFFERENT', '\n   got ', last.refusal, '\n   spec', spec);
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
