// Round 2, item: which TopoName causes can SCRIPT TEXT produce? Interpreter (runScript) over the 56 page examples + probe scripts.
import { readFileSync } from 'node:fs';
import * as L from './lib.mjs';
const REPO = L.REPO;
const ex = JSON.parse(readFileSync(`${REPO}/docs/spikes/solidcraft-referee/phase7/pane/examples.json`, 'utf8'));
const exs = (Array.isArray(ex) ? ex : ex.examples).map((e) => ({ id: e.id, script: e.script }));
const causes = (o, acc = {}) => { if (o && typeof o === 'object') { if (typeof o.cause === 'string') { acc[o.cause] = (acc[o.cause] ?? 0) + 1; } for (const v of Object.values(o)) causes(v, acc); } return acc; };
const probes = {
  'box.face(top)': `const b=box(40,30,20)\nhollow(b,{wall:2,open:'top'})`,
  'pull.face(top)': `const sk=sketch('top'); sk.rect(40,30,{at:[20,15]})\nconst p=pull(sk,20)\nhollow(p,{wall:2,open:'top'})`,
  'pull.face(right)': `const sk=sketch('top'); sk.rect(40,30,{at:[20,15]})\nconst p=pull(sk,20)\ndraft(p.face('right'),5)`,
  'pull.edge(top,right)': `const sk=sketch('top'); sk.rect(40,30,{at:[20,15]})\nconst p=pull(sk,20)\nround(p.edge('top','right'),2)`,
  'pocket.wall draft': `const sk=sketch('top'); sk.rect(40,30,{at:[20,15]})\nconst p=pull(sk,20)\nconst s2=sketch('top',20); s2.rect(10,10,{at:[20,15]})\nconst q=pocket(s2,p,5)\ndraft(q.wall(s2,1),3)`,
  'pocket.wall hollow open': `const sk=sketch('top'); sk.rect(40,30,{at:[20,15]})\nconst p=pull(sk,20)\nconst s2=sketch('top',20); s2.rect(10,10,{at:[20,15]})\nconst q=pocket(s2,p,5)\nhollow(q,{wall:1,open:q.wall(s2,1)})`,
  'pocket.rim round': `const sk=sketch('top'); sk.rect(40,30,{at:[20,15]})\nconst p=pull(sk,20)\nconst s2=sketch('top',20); s2.rect(10,10,{at:[20,15]})\nconst q=pocket(s2,p,5)\nround(q.rim(s2),1)`,
  'join.face': `const a=box(40,30,10)\nconst b=box(20,20,10,{at:[0,0,10]})\nconst u=join(a,b)\nhollow(u,{wall:2,open:'bottom'})`,
  'hole then top': `const b=box(40,30,20)\nhole(b,{across:6})\nround(b.edge('top','front'),2)`,
  'sketch rounded corner extrude': `const sk=sketch('top'); sk.rect(40,30,{at:[20,15]}); sk.round(1,3)\nconst p=pull(sk,20)\nround(p.edge('top','right'),1)`,
};
const all = {};
const per = {};
for (const e of exs) { const r = L.rs.runScript(e.script, {}); per[e.id] = r.errors.length ? { err: r.errors[0].message } : causes(r.doc.features); }
for (const v of Object.values(per)) for (const [k, n] of Object.entries(v)) if (k !== 'err') all[k] = (all[k] ?? 0) + n;
console.log('GALLERY causes over', exs.length, 'examples:', JSON.stringify(all));
for (const [k, s] of Object.entries(probes)) {
  const r = L.rs.runScript(s, {});
  if (r.errors.length) { console.log(k.padEnd(32), 'ERR', r.errors[0].message); continue; }
  const names = r.doc.features.filter((f) => f.edge || f.open || f.face).map((f) => L.tn.formatName(f.edge ?? f.open ?? f.face));
  console.log(k.padEnd(32), JSON.stringify(causes(r.doc.features)), '|', names.join(' ; '));
}
