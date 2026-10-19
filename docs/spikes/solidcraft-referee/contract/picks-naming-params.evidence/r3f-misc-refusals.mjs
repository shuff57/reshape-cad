// Round 3 F. Refusals that the sec*/r2* scripts do not reach, run through the guarded + plain translator (script text, page route).
//   bun r3f-misc-refusals.mjs [--out=file]
import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { guardedTranslate, pageTranslate } from './r3-guard.mjs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r3f-misc-refusals.json';
const cases = {
  'counterbore hole then round': `const b=box(40,30,20)\nhole(b,{across:6,deep:8,counterbore:{across:10,deep:3}})\nround(b.edge('top','front'),2)`,
  'repeatAround slot pat1_totalangle=324': { src: `const b=box(10,10,10,{at:[20,0,0]})\nrepeatAround(b,{count:4,axis:'z'})`, values: { pat1_totalangle: 324 } },
  'groove slot sk1_p0u+3': { src: `const b=box(40,40,20)\nconst sk=sketch('front'); sk.polygon([[0,15],[8,15],[8,22],[0,22]])\ngroove(sk, b, 180)`, values: { sk1_p0u: 3 } },
  'keep (intersect) box and sphere': `const a=box(30,30,10)\nconst b=sphere(30,{at:[5,0,0]})\nkeep(a,b)`,
  'box with zero width': `const b=box(0,30,20)`,
  'hollow box with a blind hole near the floor': `const b=box(40,30,20)\nhole(b,{across:6,at:[5,5],deep:19})\nhollow(b,{wall:2,open:'top'})`,
  'wall of a pocket given a param depth': `const d=param('d',4)\nconst sk1=sketch('top');sk1.rect(40,30,{at:[20,15]});const p=extrude(sk1,10);const sk2=sketch('top',10);sk2.rect(10,8,{at:[18,14]});const q=pocket(sk2,p,d)\nround(q.edge('top',q.wall(sk2,1)),1)`,
  'round of a face (script error)': `const b=box(40,30,20)\nround(b.face('top'),2)`,
};
const out = [];
for (const [label, c] of Object.entries(cases)) {
  const src = typeof c === 'string' ? c : c.src; const r = L.fromScript(src, c.values);
  if (r.errors.length) { out.push({ label, scriptError: r.errors[0].message }); console.log(label.padEnd(44), 'SCRIPT ERROR:', r.errors[0].message); continue; }
  const pg = await pageTranslate(r.doc); const g = await guardedTranslate(r.doc);
  const refused = g.features.filter((f) => f.status === 'refused').map((f) => ({ id: f.id, raw: f.rawRefusal?.slice(0, 200), plain: f.refusal }));
  out.push({ label, pageStatuses: pg.features.map((f) => `${f.id}:${f.status}`), refused, unmapped: g.unmapped });
  console.log(label.padEnd(44), JSON.stringify(refused).slice(0, 500), g.unmapped.length ? 'UNMAPPED ' + JSON.stringify(g.unmapped) : '');
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
