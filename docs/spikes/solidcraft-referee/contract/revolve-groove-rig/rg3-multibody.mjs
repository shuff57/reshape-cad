// What the page does with the multi-body result of a groove that splits the part: the next feature of every kind that takes a body, scored against OCCT and brep-rs (round 3).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg3-multibody.mjs --out=../revolve-groove-results/r3/multibody-downstream.json
import { writeFileSync } from 'node:fs';
import { init } from './rg3-lib.mjs';
const arg = (k, d = '') => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const L = await init({ occt: true, brep: true });
const PRE = `const bar = box(60,10,20); const g = sketch('top'); g.polygon([[10,-20],[12,-20],[12,20],[10,20]]); const g1 = groove(g, bar, 360);`;
const tails = {
  'groove alone': ``,
  move: `const m = move(g1, [5, 0, 0]);`,
  turn: `const m = turn(g1, [0, 0, 30]);`,
  mirror: `const m = mirror(g1, 'left-right');`,
  'spin of a new sketch': `const q = sketch('top'); q.rect(4,4,{at:[30,0]}); const m = spin(q, 90);`,
  'union with a box': `const x = box(10,10,10,{at:[40,0,0]}); const m = union(g1, x);`,
  'subtract a box': `const x = box(10,10,10,{at:[0,0,0]}); const m = subtract(g1, x);`,
  hole: `const m = hole(g1, { across: 3 });`,
  pocket: `const p = sketch('top', 10); p.circle(3, {at:[25,0]}); const m = pocket(p, g1, 5);`,
  'second groove (new handle name, same part)': `const h = sketch('top'); h.polygon([[20,-5],[22,-5],[22,5],[20,5]]); const m = groove(h, g1, 360);`,
};
const out = [];
for (const [k, t] of Object.entries(tails)) {
  const r = await L.run(`${PRE} ${t}`, { oracle: true, brepToo: true });
  if (r.scriptErrors) { out.push({ k, scriptErrors: r.scriptErrors }); continue; }
  const f = r.features.at(-1); const m = f.measure;
  out.push({ k, status: f.status, refusal: f.refusal ?? null, volume: m?.volume ?? null, bodies: m?.bodies?.length ?? null, faces: m?.faces ?? null, occtVolume: r.occt?.volume ?? null, occtFaces: r.occt?.faces ?? null, brepVolume: r.brep?.volume ?? null });
  console.log(k.padEnd(44), f.status, f.status === 'built' ? `V ${m.volume.toFixed(3)} bodies ${m.bodies.length} F ${m.faces}` : `"${f.refusal}"`, '| OCCT', r.occt?.volume?.toFixed(3), r.occt?.faces, '| brep', r.brep?.volume?.toFixed?.(3));
}
if (arg('out')) writeFileSync(arg('out'), JSON.stringify(out, null, 1));
