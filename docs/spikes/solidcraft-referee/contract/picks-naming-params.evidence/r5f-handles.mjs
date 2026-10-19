// Round 5 (critic round 2 / row 67). handlesFor() MEASURED for every feature kind the row names (the earlier row said "not probed beyond the code read").
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5f-handles.mjs
import { L } from './common.mjs';
const docs = [
  ['box (control)', `const b = box(40,30,20,{at:[5,-3,2]})`],
  ['prism', `const p = prism(6,30,20,{at:[3,2,1]})`],
  ['wedge', `const w = wedge(30,20,10)`],
  ['hole', `const b = box(40,30,20,{at:[5,-3,2]})\nhole(b,{across:6, deep:10, at:[3,2]})`],
  ['hollow', `const b = box(40,30,20,{at:[5,-3,2]})\nhollow(b,{wall:2, open:'top'})`],
  ['join', `const a = box(30,30,10)\nconst b = box(20,20,20,{at:[10,0,5]})\njoin(a,b)`],
  ['subtract', `const a = box(30,30,10)\nconst b = cylinder(10,30,{at:[5,0,0]})\ncut(a,b)`],
  ['repeat', `const b = box(10,10,10)\nrepeat(b,{count:3, step:[15,0,0]})`],
  ['repeatAround', `const b = box(10,10,10,{at:[20,0,0]})\nrepeatAround(b,{count:4, axis:'z'})`],
  ['mirror', `const b = box(20,10,10,{at:[15,0,0]})\nmirror(b,'left-right')`],
  ['groove', `const b = box(40,40,20)\nconst sk = sketch('front'); sk.polygon([[0,15],[8,15],[8,22],[0,22]])\ngroove(sk, b, 180)`],
  ['revolve', `const sk = sketch('front'); sk.polygon([[5,0],[12,0],[12,20],[5,20]])\nrevolve(sk, 360)`],
  ['round (fillet)', `const b = box(40,30,20,{at:[5,-3,2]})\nround(b.edge('top','right'), 2)`],
  ['bevel', `const b = box(40,30,20,{at:[5,-3,2]})\nbevel(b.edge('top','right'), 2)`],
  ['draft', `const b = box(40,30,20,{at:[5,-3,2]})\ndraft(b.face('right'), 5)`],
];
for (const [label, src] of docs) {
  const r = L.fromScript(src);
  if (r.errors.length) { console.log(label.padEnd(18), 'SCRIPT ERROR', r.errors[0].message); continue; }
  const kinds = r.doc.features.map((f) => f.kind).join(',');
  let hs = []; try { for (const f of r.doc.features) for (const h of L.mh.handlesFor(f, r.doc) ?? []) hs.push({ ...h, feature: f.id }); } catch (e) { hs = 'THROWS ' + e.message; }
  const list = Array.isArray(hs) ? hs.map((h) => `${h.kind ?? h.type}:${h.label ?? h.feature}`).join(' | ') : hs;
  console.log(label.padEnd(18), 'features', kinds.padEnd(34), 'handles', Array.isArray(hs) ? hs.length : '-', list.slice(0, 300));
}
