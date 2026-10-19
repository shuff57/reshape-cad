// SPIKE, referee only. ROUND 4: what the kernel does when two blends are sent ONE AFTER THE OTHER on two edges of a box that share a corner (the case the contract refuses by rule R3 unless
// the two blends have the same size and kind and follow each other, in which case they are grouped). Fresh seed. For every random pair:
//   truck      : raw solidcraft commands on the rig wasm (box, solid.fillet/chamfer edge A, then edge B), no resolver in the way
//   mitre      : closed form of the LITERAL reading, box minus the union of the two removal prisms (fc4-mitre.mjs mitrePair): what the student asked for
//   occtSim    : OCCT, both edges added to ONE maker with their own sizes (simultaneous)
//   occtSeq    : OCCT, the blends one after the other (the repo's buildDoc), brep-rs the same
// class of the truck result: MITRE (equals the literal reading), CHAIN (equals OCCT sequential, which also blends the third edge of the tangent chain), ADDED (volume above the unblended box), NEITHER.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> SEED=31 N=120 bun live/fc4-pairfuzz.mjs [--res=../fc4-results-pairfuzz.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runViaBundle } from '../../../phase7/bundle-run.mjs';
import { runSC, occtSeq, brepSeq, occtSimSizes, rel } from './fc-oracle.mjs';
import { mitrePair } from './fc4-mitre.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const SEED = Number(process.env.SEED ?? 31); const N = Number(process.env.N ?? 120);
let st = SEED >>> 0;
const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const U = (a, b) => a + (b - a) * rnd(); const I = (a, b) => Math.floor(U(a, b + 1)); const pickOne = (a) => a[Math.floor(rnd() * a.length)];
const NORM = { top: ['z', 1], bottom: ['z', -1], front: ['y', -1], back: ['y', 1], left: ['x', -1], right: ['x', 1] };
const AX = { x: 0, y: 1, z: 2 };
const FACES = Object.keys(NORM);
const EDGES = [];
for (let i = 0; i < FACES.length; i++) for (let j = i + 1; j < FACES.length; j++) if (NORM[FACES[i]][0] !== NORM[FACES[j]][0]) EDGES.push([FACES[i], FACES[j]]);
const geom = (e, dim) => { const [a, b] = e.map((f) => NORM[f]); const free = ['x', 'y', 'z'].find((k) => k !== a[0] && k !== b[0]); const mid = [0, 0, 0]; mid[AX[a[0]]] = a[1] * dim[a[0]] / 2; mid[AX[b[0]]] = b[1] * dim[b[0]] / 2; const ends = [-1, 1].map((s) => { const v = [...mid]; v[AX[free]] = s * dim[free] / 2; return v.join(','); }); return { mid, ends, len: dim[free], legs: [dim[b[0]], dim[a[0]]] }; };
const rows = [];
for (let n = 0; n < N; n++) {
  const dim = { x: I(14, 48), y: I(14, 48), z: I(14, 48) };
  let eA; let eB;
  for (;;) { eA = pickOne(EDGES); eB = pickOne(EDGES); if (eA === eB) continue; const ga = geom(eA, dim); const gb = geom(eB, dim); if (ga.ends.some((v) => gb.ends.includes(v))) break; }
  const ga = geom(eA, dim); const gb = geom(eB, dim);
  const lim = 0.45 * Math.min(...ga.legs, ...gb.legs);
  const a = Math.round(U(0.05, 1) * lim * 10) / 10 || 0.5;
  const ratio = pickOne([0.4, 0.7, 1, 1.2, 1.5, 1.8, 2, 2.5, 3]);
  const b = Math.min(lim * 1.2, Math.max(0.1, Math.round(a * ratio * 10) / 10));
  const kinds = pickOne([['fillet', 'fillet'], ['fillet', 'fillet'], ['chamfer', 'chamfer'], ['fillet', 'chamfer'], ['chamfer', 'fillet']]);
  const word = (k) => (k === 'fillet' ? 'round' : 'bevel');
  const script = `const b = cuboid(${dim.x},${dim.y},${dim.z})\n${word(kinds[0])}(b.edge('${eA[0]}','${eA[1]}'), ${a})\n${word(kinds[1])}(b.edge('${eB[0]}','${eB[1]}'), ${b})`;
  const V0 = dim.x * dim.y * dim.z;
  const cmd = (k, g, s) => ({ command: k === 'fillet' ? 'solid.fillet' : 'solid.chamfer', params: { edges: [g.mid], [k === 'fillet' ? 'radius' : 'distance']: s, body: 'b' } });
  const t0 = Date.now();
  const r = runSC([{ command: 'solid.box', params: { length: dim.x, width: dim.y, height: dim.z, center: [0, 0, 0], body_name: 'b' } }, cmd(kinds[0], ga, a), cmd(kinds[1], gb, b)]);
  const row = { id: `pf-${SEED}-${String(n).padStart(3, '0')}`, script, dim, kinds, a, b, ratio: Math.round(b / a * 100) / 100, V0 };
  if (r.ok) { const m = r.measure.bodies[0]; row.truck = { volume: m.volume_mm3, faces: m.faces, curved: Object.keys(m.face_types ?? {}).some((k) => k !== 'plane') }; } else row.truck = { refused: `${r.failed?.command}: ${r.failed?.error}`.slice(0, 120) };
  row.mitre = mitrePair({ V0, LA: ga.len, LB: gb.len, a, b, styleA: kinds[0], styleB: kinds[1] });
  const { doc, errors } = runViaBundle(script);
  if (!errors.length) {
    row.occtSeq = occtSeq(doc); row.brepSeq = brepSeq(doc);
    // simultaneous with their own sizes: add both edges to one maker (only meaningful when both blends have the same kind)
    if (kinds[0] === kinds[1]) {
      try { row.occtSim = occtSimSizes(doc, [ga.mid, gb.mid], [a, b], kinds[0]); } catch (e) { row.occtSim = { refused: String(e.message).slice(0, 80) }; }
    }
  } else row.scriptError = errors[0].message;
  const tv = row.truck.volume;
  if (tv != null) {
    const tol = row.truck.curved ? 3e-4 : 1e-9;
    const eq = (x) => x != null && rel(tv, x) <= tol;
    const seqV = row.occtSeq && !row.occtSeq.refused ? row.occtSeq.volume : null;
    row.class = tv > V0 + 1e-6 ? 'ADDED-MATERIAL' : eq(row.mitre) ? 'MITRE' : eq(seqV) ? 'CHAIN(=OCCT sequential)' : 'NEITHER';
    row.dMitre = rel(tv, row.mitre);
  } else row.class = 'REFUSED';
  row.ms = Date.now() - t0;
  rows.push(row);
  console.log(row.id, `${dim.x}x${dim.y}x${dim.z}`, kinds.join('+'), a, b, 'ratio', row.ratio, '|', row.class, tv?.toFixed?.(4), 'mitre', row.mitre.toFixed(4), 'occtSeq', row.occtSeq?.volume?.toFixed?.(4) ?? row.occtSeq?.refused?.slice(0, 40));
}
writeFileSync(path.resolve(HERE, arg('res', '../fc4-results-pairfuzz.json')), JSON.stringify(rows, null, 1));
const cnt = {}; for (const r of rows) cnt[r.class] = (cnt[r.class] ?? 0) + 1;
console.log('classes:', JSON.stringify(cnt));
