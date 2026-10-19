import * as L from './lib.mjs';
const docs = {
  'pull taper': `const s = sketch('top'); s.rect(40,30,{at:[20,15]})\npull(s, 12, {taper: 5})`,
  'pull length2/midplane': `const s = sketch('top'); s.rect(40,30,{at:[20,15]})\npull(s, 12, {midplane: true})`,
  'pull both (length2)': `const s = sketch('top'); s.rect(40,30,{at:[20,15]})\npull(s, 12, {length2: 4})`,
  'pocket through/direction': `const s0 = sketch('top'); s0.rect(40,30,{at:[20,15]})\nconst p = pull(s0, 10)\nconst s = sketch('top', 10); s.rect(10,10,{at:[20,15]})\npocket(s, p, 4, {reversed: true})`,
  'blend': `const a = sketch('top'); a.rect(20,20,{at:[0,0]})\nconst b = sketch('top', 20); b.rect(10,10,{at:[0,0]})\nblend(a, b, 20)`,
  'draft neutral': `const b = box(40,30,20)\ndraft(b.face('right'), 5, {neutral: 3})`,
  'hole at/along': `const b = box(40,30,20)\nhole(b,{across:6, deep: 8, at:[3,2], along:'x'})`,
  'mirror at (cut)': `const b = box(40,30,20)\nconst s = sketch('top', 20); s.rect(6,6,{at:[8,0]})\nconst p = pocket(s, b, 5)\nmirror(p, 'left-right', {at: 0})`,
  'turn on cylinder': `const c = cylinder(20,30)\nturn(c,[0,30,0])`,
  'repeatAround angle': `const b = box(10,10,10,{at:[20,0,0]})\nrepeatAround(b,{count:3, axis:'z', angle: 120})`,
  'groove': `const b = box(40,40,20)\nconst sk = sketch('front'); sk.polygon([[0,15],[8,15],[8,22],[0,22]])\ngroove(sk, b, 180)`,
};
for (const [k, src] of Object.entries(docs)) {
  const r = L.fromScript(src);
  if (r.errors.length) { console.log(k.padEnd(28), 'ERR', r.errors[0].message); continue; }
  console.log(k.padEnd(28), r.doc.features.filter(f=>!['sketch'].includes(f.kind)).map(f => f.kind + ':' + JSON.stringify(Object.fromEntries(Object.entries(f).filter(([n,v]) => typeof v === 'number' || (Array.isArray(v) && v.every(x=>typeof x==='number')) && !['id'].includes(n))))).join(' | ').slice(0, 260));
  console.log(' '.repeat(28), 'slots:', L.cg.generatedParams(r.doc).map(p => p.name).join(','));
}
