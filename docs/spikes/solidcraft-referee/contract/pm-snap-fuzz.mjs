// SPIKE, referee only. Fuzz of the repeat() guard layer against an EXACT closed form (no OCCT in the loop, so it is fast and cannot share a bug with the other kernels).
//
// A box a x b x c is repeated count (2..4) times with a random step; the union of axis-aligned boxes has an exact volume (coordinate compression). Steps are drawn
// from the families that matter for the join: 0, +-one box size (face contact), +-small fractions of the size (1e-4 .. 5%: the near-coincident family),
// +-(size -/+ a hair) (overlap / gap slivers), +-half sizes, +-1.3 sizes (apart). The result of translateDoc (the contract translator, run exactly as pm-run.mjs runs it) is
//   BUILT and equal to the closed form to 1e-9  -> ok
//   BUILT and different                          -> WRONG (a silently wrong solid: this is what the guard exists to prevent)
//   REFUSED                                      -> refused (the sentence is kept)
// PM_OFF=snap (round 4) or PM_OFF=sliver (round 5) switch a guard off (negative control); --mode=sliver draws overlap slivers, --mode=aligned draws copies apart along one axis and near-aligned along the other two. Usage:
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun pm-snap-fuzz.mjs [--n=400] [--seed=1] [--out=file.json]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc } from './pm-translate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const MODE = arg('mode', 'mixed'); // 'sliver': one axis overlaps by a log-uniform 1e-7 .. 2e-2 mm, the others by 10..90% (the family the sliver guard is about)
const N = Number(arg('n', 400)); let seed = Number(arg('seed', 1)); const OUT = arg('out', '');
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
const ALL = ['reversed', 'fresh', 'plane', 'count1', 'torus', 'contact', 'disjoint', 'subgap', 'budget', 'fused', 'spinbox', 'taper', 'contact3', 'mircontact', 'snap', 'sliver'];
const PATCHES = new Set([...ALL.filter((p) => !(process.env.PM_OFF ?? '').split(',').includes(p)), '__explicit']);

const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const FRACS = [1e-4, 1e-3, 3e-3, 0.01, 0.014, 0.05, 0.3, 0.5, 0.7];
function comp(L) {
  const k = rnd();
  if (k < 0.15) return 0;
  const sg = rnd() < 0.5 ? -1 : 1;
  if (k < 0.30) return sg * L;                                       // face contact
  if (k < 0.60) return sg * pick(FRACS) * L;                        // small / medium shift
  if (k < 0.75) return sg * (L - pick([1e-6, 1e-4, 1e-3, 0.01]));   // overlap sliver
  if (k < 0.85) return sg * (L + pick([1e-6, 1e-4, 1e-3, 0.01]));   // gap sliver
  return sg * pick([1.3, 2]) * L;                                    // apart
}
const unionVol = (boxes) => {
  const cuts = [0, 1, 2].map((i) => [...new Set(boxes.flatMap((b) => [b.lo[i], b.hi[i]]))].sort((x, y) => x - y));
  let v = 0;
  for (let i = 0; i + 1 < cuts[0].length; i++) for (let j = 0; j + 1 < cuts[1].length; j++) for (let k = 0; k + 1 < cuts[2].length; k++) {
    const m = [(cuts[0][i] + cuts[0][i + 1]) / 2, (cuts[1][j] + cuts[1][j + 1]) / 2, (cuts[2][k] + cuts[2][k + 1]) / 2];
    if (boxes.some((b) => m.every((x, d) => x > b.lo[d] && x < b.hi[d]))) v += (cuts[0][i + 1] - cuts[0][i]) * (cuts[1][j + 1] - cuts[1][j]) * (cuts[2][k + 1] - cuts[2][k]);
  }
  return v;
};
const res = []; const tally = { ok: 0, WRONG: 0, refused: 0 };
for (let t = 0; t < N; t++) {
  const L = [0, 1, 2].map(() => Math.round((1 + rnd() * 49) * 4) / 4);
  let step;
  if (MODE === 'sliver') {
    const ax = Math.floor(rnd() * 3); const depth = Math.pow(10, -7 + rnd() * 5.3);
    step = L.map((l, i) => { const sg = rnd() < 0.5 ? -1 : 1; return i === ax ? sg * (l - depth) : sg * (0.1 + 0.8 * rnd()) * l; });
  } else if (MODE === 'aligned') {
    // copies APART along one axis by a gap of 1e-3 .. 30 mm and nearly aligned (a sliver overlap of 1e-7 .. 2e-3 mm) along the other two: do near-aligned planes matter when the copies do not touch?
    const ax = Math.floor(rnd() * 3); const gapx = Math.pow(10, -3 + rnd() * 4.5);
    step = L.map((l, i) => { const sg = rnd() < 0.5 ? -1 : 1; return i === ax ? sg * (l + gapx) : sg * (l - Math.pow(10, -7 + rnd() * 7.3)); }); // near-alignment 1e-7 .. 2 mm
  } else { step = L.map((l) => comp(l)); if (step.every((v) => v === 0)) step[0] = L[0]; }
  const count = MODE === 'aligned' ? 2 : 2 + Math.floor(rnd() * 3);
  const src = `const a = box(${L.join(', ')}, { at: [0, 0, 0] }); repeat(a, { count: ${count}, step: [${step.join(', ')}] });`;
  const run = runScript(src);
  const rec = { t, L, step, count };
  if (run.errors?.length) { rec.verdict = 'script-refused'; res.push(rec); continue; }
  const doc = solveDoc(run.doc);
  const tr = translateDoc(doc, { arc, mt, runSC, resolveAt: () => null, patches: PATCHES, inProcess: true });
  const last = tr.features.at(-1);
  const boxes = Array.from({ length: count }, (_, i) => ({ lo: L.map((l, d) => -l / 2 + step[d] * i), hi: L.map((l, d) => l / 2 + step[d] * i) }));
  rec.exact = unionVol(boxes);
  if (last.status !== 'built') { rec.verdict = 'refused'; rec.student = last.student; rec.raw = last.refusal; tally.refused++; res.push(rec); continue; }
  rec.truck = last.measure.volume; rec.rel = Math.abs(rec.truck - rec.exact) / rec.exact;
  rec.verdict = rec.rel <= 1e-9 ? 'ok' : 'WRONG'; tally[rec.verdict]++; res.push(rec);
  if (rec.verdict === 'WRONG') console.log('WRONG', JSON.stringify({ L, step, count, exact: rec.exact, truck: rec.truck, rel: rec.rel }));
}
const by = {};
for (const r of res.filter((x) => x.verdict === 'refused')) { const k = /near-coincident/.test(r.raw) ? 'near-coincident (snap guard)' : /sub-resolution/.test(r.raw) ? 'sub-resolution gap/overlap' : /edge or at a point/.test(r.raw) ? 'edge/point contact' : r.raw.slice(0, 60); by[k] = (by[k] ?? 0) + 1; }
const summary = { n: N, seed: Number(arg('seed', 1)), mode: MODE, snapGuard: PATCHES.has('snap'), sliverGuard: PATCHES.has('sliver'), tally, refusedBy: by };
console.log(JSON.stringify(summary));
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, trials: res }, null, 1));
