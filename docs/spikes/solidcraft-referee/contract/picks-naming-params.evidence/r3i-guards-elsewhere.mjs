// Round 3 I. (a) the "name gone" case of secJ through the plain-sentence layer; (b) the three silent-wrong hollow cases of this group (reflex edge,
// rim round >= wall, blind hole) through contract/shell-draft-translate.mjs translateDocGuarded, which holds the guards G-CONVEX / G-RIM / G-HOLE
// that the page does not have. The sentence it emits is the requiredGuardSentence of those three rows.
//   bun r3i-guards-elsewhere.mjs [--out=file]
import * as L from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { guardedTranslate } from './r3-guard.mjs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'r3i-guards-elsewhere.json';
const SD = await import(pathToFileURL(`${L.SPIKE}/contract/shell-draft-translate.mjs`).href);
const resolveAt = (prefix, name) => { try { return JSON.parse(L.brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
const out = { cases: [] };
// (a) name gone
{
  const doc = L.fromScript(`const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10)\nconst sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] })\nconst part = pocket(sk2, plate, 4)\nround(part.edge('top', part.wall(sk2, 2)), 1)`).doc;
  const d = JSON.parse(JSON.stringify(doc)); d.features.find((f) => f.id === 'sk2').points = [[15, 10], [25, 10], [20, 20]];
  const fl = d.features.find((f) => f.kind === 'fillet'); fl.edge = { ...fl.edge, of: fl.edge.of.map((n) => (n.cause === 'swept' ? { ...n, edge: 3 } : n)) };
  const g = await guardedTranslate(L.cg.solveDoc(d)); const x = g.features.find((f) => f.id === fl.id);
  out.cases.push({ label: 'name gone: swept edge 3 on a triangle', raw: x.rawRefusal, plain: [x.refusal] }); console.log('name gone', x.refusal);
}
// (b) guards elsewhere
const sd = [
  ['G-CONVEX', 'stepped union, hollow open top', `const a=box(40,30,10)\nconst b=box(20,20,10,{at:[0,0,10]})\nconst u=join(a,b)\nhollow(u,{wall:2,open:'top'})`],
  ['G-RIM', 'rim round 2.5 on a wall-2 hollow', `const b=box(40,30,20,{at:[7,-5,3]})\nhollow(b,{wall:2,open:'top'})\nround(b.edge('top','front'),2.5)`],
  ['G-HOLE', 'blind hole from the open face, then hollow', `const b=box(40,30,20,{at:[7,-5,3]})\nhole(b,{across:6,at:[5,5],deep:8})\nhollow(b,{wall:2,open:'top'})`],
];
out.sd = [];
for (const [guard, label, src] of sd) {
  const r = L.fromScript(src); if (r.errors.length) { out.sd.push({ guard, label, scriptError: r.errors[0].message }); console.log(guard, 'SCRIPT ERROR', r.errors[0].message); continue; }
  const doc = L.cg.solveDoc(r.doc);
  const page = await L.scored(doc);
  let tr; try { tr = SD.translateDocGuarded(doc, { arc: L.arc, mt: L.mt, runSC: L.runSC, resolveAt }, { fromUsage: SD.draftFromUsage(src) }); } catch (e) { out.sd.push({ guard, label, error: e.message }); console.log(guard, 'ERROR', e.message); continue; }
  const gl = await guardedTranslate(doc); const glast = [...gl.features].reverse().find((f) => f.kind === 'shell' || f.kind === 'fillet');
  const last = [...tr.features].reverse().find((f) => f.kind === 'shell' || f.kind === 'fillet');
  const row = { guard, label, src, pageOutcome: page.outcome, pageV: page.truck?.volume, pageFaces: page.truck?.faces, layer: { status: glast?.status, sentence: glast?.status === 'refused' ? glast.refusal : null }, shellDraft: { status: last?.status, guard: last?.guard, sentence: last?.refusal, V: last?.measure?.volume } };
  out.sd.push(row); console.log(guard, label, JSON.stringify(row).slice(0, 600));
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
