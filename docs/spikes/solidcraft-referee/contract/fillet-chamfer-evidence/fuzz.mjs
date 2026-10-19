// FUZZ: random boxes, random single edge, random fillet/chamfer size from 0.05 to 1.5 x the smallest face extent the blend cuts into.
// Deterministic (seeded). Classifies every case against live OCCT and live brep-rs:
//   match            truck built, OCCT built, volume within the bar (planar 1e-9, curved 3e-4)
//   MISMATCH         truck built, OCCT built, volume differs
//   WRONG-UNREFUSED  truck built, OCCT AND brep-rs refused (a solid where both reference kernels say no)
//   over-refused     truck refused, OCCT built
//   both-refused     all refuse
//   SolidCraft ~ `bun fuzz.mjs --seed=7 --n=200 --out=fuzz-results.json`
import { writeFileSync } from 'node:fs';
import { runScript } from '/home/shuff57/Documents/GitHub/reshape-cad/packages/script/dist/reshape-script.js';
import { runFixture } from './base.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const seed0 = +arg('seed', 7); const N = +arg('n', 200); const outFile = arg('res', 'fuzz-results.json'); const mode = arg('mode', 'single');
let s = seed0 >>> 0;
const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const r1 = (x) => Math.round(x * 10) / 10;
const AX = { top: 2, bottom: 2, front: 1, back: 1, left: 0, right: 0 };
const PAIRS = [['top', 'front'], ['top', 'back'], ['top', 'left'], ['top', 'right'], ['bottom', 'front'], ['bottom', 'back'], ['bottom', 'left'], ['bottom', 'right'], ['front', 'left'], ['front', 'right'], ['back', 'left'], ['back', 'right']];
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const res = [];
const tally = {};
const PI = Math.PI;
const integ = (f, a, b, n = 20000) => { const h = (b - a) / n; let sum = f(a) + f(b); for (let k = 1; k < n; k++) sum += f(a + k * h) * (k % 2 ? 4 : 2); return sum * h / 3; };
const ext = (kind, sz, w) => (w >= sz ? 0 : kind === 'f' ? sz - Math.sqrt(Math.max(0, sz * sz - (sz - w) * (sz - w))) : sz - w);
const area = (kind, sz) => (kind === 'f' ? (1 - PI / 4) * sz * sz : sz * sz / 2);
for (let i = 0; i < N; i++) {
  if (mode === 'pair') {
    // two edges meeting at a corner, sharing one face; both the same style or mixed; sizes up to 0.45 x the smallest face extent
    const D = [r1(10 + rnd() * 40), r1(10 + rnd() * 40), r1(10 + rnd() * 40)];
    const fx = pick(['left', 'right']); const fy = pick(['front', 'back']); const fz = pick(['top', 'bottom']);
    const three = [[fx, fy, 2], [fx, fz, 1], [fy, fz, 0]]; // [face, face, axis along the edge]
    const e = three.filter(() => true).sort(() => rnd() - 0.5).slice(0, 2);
    const shared = e[0].slice(0, 2).find((f) => e[1].slice(0, 2).includes(f));
    const lim = Math.min(...D);
    const mk = () => ({ kind: pick(['f', 'c']), sz: r1(Math.max(0.3, (0.1 + rnd() * 0.35) * lim)) });
    const A = mk(); const Bz = mk();
    const op = (k) => (k === 'f' ? 'round' : 'bevel');
    const script = `const b = cuboid(${D.join(',')})\n${op(A.kind)}(b.edge('${e[0][0]}','${e[0][1]}'), ${A.sz})\n${op(Bz.kind)}(b.edge('${e[1][0]}','${e[1][1]}'), ${Bz.sz})`;
    const V0 = D[0] * D[1] * D[2];
    const LA = D[e[0][2]]; const LB = D[e[1][2]];
    const closed = V0 - area(A.kind, A.sz) * LA - area(Bz.kind, Bz.sz) * LB + integ((w) => ext(A.kind, A.sz, w) * ext(Bz.kind, Bz.sz, w), 0, Math.min(A.sz, Bz.sz));
    const row = { i, mode: 'pair', script, D, A, B: Bz, shared, closed, V0, aloneMax: Math.max(area(A.kind, A.sz) * LA, area(Bz.kind, Bz.sz) * LB) };
    const r = runScript(script);
    if (r.errors.length) { row.outcome = 'script-refused'; res.push(row); tally[row.outcome] = (tally[row.outcome] || 0) + 1; continue; }
    const feats = r.doc.features;
    const fx2 = runFixture({ id: `fp${i}`, kind: 'fuzz', tol: 'approx', features: feats, measure: feats[feats.length - 1].id });
    const t = fx2.truck; const built = t && !t.refused;
    row.occt = { volume: fx2.occt?.volume, faces: fx2.occt?.faces, refused: Object.keys(fx2.occtRefusals ?? {}).length > 0 };
    row.truck = built ? { volume: t.volume, faces: t.faces } : { refused: t.refused };
    if (built) {
      const bar = 5e-5;
      const dLit = Math.abs(t.volume - closed) / closed; const dOcc = row.occt.volume ? Math.abs(t.volume - row.occt.volume) / row.occt.volume : Infinity;
      row.dLit = dLit; row.dOcct = dOcc;
      const impossible = t.volume > V0 - row.aloneMax + 1e-6; // removed less than ONE of the two blends alone: material was added back
      row.outcome = impossible ? 'ADDED-MATERIAL' : dLit < bar ? 'literal-mitre' : (dOcc < bar && !row.occt.refused) ? 'tangent-chain(=OCCT)' : 'NEITHER';
    } else row.outcome = 'refused';
    res.push(row); tally[row.outcome] = (tally[row.outcome] || 0) + 1;
    if (row.outcome === 'ADDED-MATERIAL' || row.outcome === 'NEITHER') console.log(i, row.outcome, script.replace(/\n/g, ' ; '), 'truck', t.volume.toFixed(3), 'closed', closed.toFixed(3), 'occt', row.occt.volume?.toFixed(3), 'V0', V0.toFixed(1));
    if (i % 20 === 0) writeFileSync(outFile, JSON.stringify({ seed: seed0, n: N, mode, tally, rows: res }, null, 1));
    continue;
  }
  const D = [r1(8 + rnd() * 40), r1(8 + rnd() * 40), r1(8 + rnd() * 40)];
  const [a, b] = pick(PAIRS); const style = pick(['round', 'bevel']);
  // the blend's legs run along face a and face b, perpendicular to the edge: extents are the two box dimensions that are not along the edge
  const along = 3 - AX[a] - AX[b]; const legs = [AX[a] === AX[b] ? null : null].filter(Boolean);
  const legDims = [0, 1, 2].filter((k) => k !== along).map((k) => D[k]);
  const limit = Math.min(...legDims);
  const size = r1(Math.max(0.1, (0.05 + rnd() * 1.45) * limit));
  const script = `const b = cuboid(${D.join(',')})\n${style}(b.edge('${a}','${b}'), ${size})`;
  const r = runScript(script);
  const row = { i, script, style, D, edge: [a, b], size, limit, ratio: +(size / limit).toFixed(3) };
  if (r.errors.length) { row.outcome = 'script-refused'; row.msg = r.errors[0].message; res.push(row); tally[row.outcome] = (tally[row.outcome] || 0) + 1; continue; }
  const feats = r.doc.features;
  const fx = runFixture({ id: `fz${i}`, kind: 'fuzz', tol: 'approx', features: feats, measure: feats[feats.length - 1].id });
  const t = fx.truck;
  const occtRef = fx.occtRefusals && Object.keys(fx.occtRefusals).length > 0;
  const brepRef = !!(fx.brep?.refused) || (fx.brepRefusals && Object.keys(fx.brepRefusals).length > 0);
  row.occt = fx.invalid ? { invalid: fx.invalid } : { volume: fx.occt?.volume, faces: fx.occt?.faces, refused: occtRef };
  row.brep = { volume: fx.brep?.volume, faces: fx.brep?.faces, refused: brepRef };
  row.truck = t?.refused ? { refused: t.refused } : { volume: t?.volume, faces: t?.faces, dVol: t?.dVol };
  const truckBuilt = t && !t.refused;
  const oracleBuilt = !fx.invalid && !occtRef;
  if (truckBuilt && oracleBuilt) row.outcome = fx.outcome === 'PASS' ? 'match' : 'MISMATCH';
  else if (truckBuilt && !oracleBuilt) row.outcome = 'WRONG-UNREFUSED';
  else if (!truckBuilt && oracleBuilt) row.outcome = 'over-refused';
  else row.outcome = 'both-refused';
  res.push(row); tally[row.outcome] = (tally[row.outcome] || 0) + 1;
  if (i % 20 === 0) writeFileSync(outFile, JSON.stringify({ seed: seed0, n: N, tally, rows: res }, null, 1));
  if (row.outcome === 'WRONG-UNREFUSED' || row.outcome === 'MISMATCH') console.log(i, row.outcome, script.replace('\n', ' ; '), 'ratio', row.ratio, 'OCCT', row.occt.volume, 'truck', row.truck.volume, 'brepRefused', brepRef);
}
writeFileSync(outFile, JSON.stringify({ seed: seed0, n: N, tally, rows: res }, null, 1));
console.log(JSON.stringify(tally));
