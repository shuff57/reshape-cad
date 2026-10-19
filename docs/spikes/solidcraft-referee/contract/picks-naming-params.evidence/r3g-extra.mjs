// Round 3 G. Cases whose wording must be measured: which verb the sentence uses when the target was used up by subtract / a cut.
//   bun r3g-extra.mjs [--out=file]
import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { guardedTranslate } from './r3-guard.mjs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r3g-extra.json';
const out = { cases: [] };
const run = async (label, src) => {
  const r = L.fromScript(src); if (r.errors.length) { out.cases.push({ label, src, scriptError: r.errors[0].message, plain: [r.errors[0].message] }); console.log(label, 'SCRIPT ERROR', r.errors[0].message); return null; }
  const g = await guardedTranslate(r.doc); const ref = g.features.filter((f) => f.status === 'refused').map((f) => ({ id: f.id, raw: f.rawRefusal?.slice(0, 160), plain: f.refusal }));
  out.cases.push({ label, src, statuses: g.features.map((f) => `${f.id}:${f.status}`), refused: ref, plain: ref.map((x) => x.plain), unmapped: g.unmapped }); console.log(label, JSON.stringify(ref).slice(0, 400)); return ref;
};
const a = await run('subtract then round edge of the first box', `const a=box(40,30,20)\nconst c=cylinder(10,30)\nsubtract(a,c)\nround(a.edge('top','front'),2)`);
if (a) { const x = a.find((r) => r.id === 'round1'); const m = /was already (\w+) by/.exec(x?.plain ?? ''); out.cut = { verb: m?.[1], plain: x?.plain }; }
await run('union then round edge of the first box', `const a=box(40,30,20)\nconst b=box(10,10,10,{at:[30,0,0]})\njoin(a,b)\nround(a.edge('top','front'),2)`);
writeFileSync(OUT, JSON.stringify(out, null, 1));
