// Independent oracle for the census family's "hollow, then bevel wider than the wall" class (docs/PLAN-next.md section 38).
// MEASURE ONLY; nothing here reads a kernel to decide what the part is. The intended definition:
//
//   solid = shell(box)  minus  { p in the shell : d(first face) + d(second face) < size }
//
// i.e. the bevel's half-space wedge is cut off the HOLLOW part, so where the wedge was already cavity it removes nothing.
// The removed volume is measured by a jittered-grid Monte Carlo of that membership over the wedge's bounding region (the only
// place the answer depends on), 2.4 million points by default, and subtracted from the exactly known volume of the shell.
// brep-rs, OpenCascade and the sweep's closed form (hollowBevelVolume) are then compared with it.
//
//   node wrong-solid-sweep-hollow-bevel-mc.mjs SEED N_POINTS INDEX[,INDEX...]     (INDEX = census family index, chain box > hollow > chamfer)
//   node wrong-solid-sweep-hollow-bevel-mc.mjs SEED N_POINTS auto 6                 (the first 6 of that chain with size > wall)
import { genScript, makeRunner, hollowBevelVolume } from './wrong-solid-sweep-lib.mjs';

const SEED = +process.argv[2] || 1, NPTS = +process.argv[3] || 2.4e6, WHICH = process.argv[4] ?? 'auto', WANT = +process.argv[5] || 6;
const run = await makeRunner({ occt: true });
const AX = { top: [2, 1], bottom: [2, 0], front: [1, 0], back: [1, 1], left: [0, 0], right: [0, 1] }; // axis, 1 = the high side
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const indices = WHICH === 'auto' ? Array.from({ length: 3000 }, (_, i) => i) : WHICH.split(',').map(Number);
let found = 0;
for (const i of indices) {
  if (WHICH === 'auto' && found >= WANT) break;
  const s = genScript('census', i, SEED);
  if (s.tags.chain !== 'box > hollow > chamfer') continue;
  const m = /box\(([\d.]+), ([\d.]+), ([\d.]+), \{ at: \[([-\d., ]+)\] \}\)/.exec(s.code);
  const w = +/wall: ([\d.]+)/.exec(s.code)[1];
  const open = (/open: '(\w+)'/.exec(s.code) ?? [])[1] ?? null;
  const em = /edge\('(\w+)', '(\w+)'\), ([\d.]+)\)/.exec(s.code);
  const c = +em[3];
  if (WHICH === 'auto' && !(c > w)) continue;
  found++;
  const L = [+m[1], +m[2], +m[3]], at = m[4].split(',').map(Number);
  const lo = at.map((a, k) => a - L[k] / 2), hi = at.map((a, k) => a + L[k] / 2);
  const cavLo = [...lo], cavHi = [...hi];
  for (const word of Object.keys(AX)) { const [k, hiSide] = AX[word]; const t = word === open ? 0 : w; if (hiSide) cavHi[k] = hi[k] - t; else cavLo[k] = lo[k] + t; }
  const Vh = L[0] * L[1] * L[2] - (cavHi[0] - cavLo[0]) * (cavHi[1] - cavLo[1]) * (cavHi[2] - cavLo[2]);
  const [f, g] = [em[1], em[2]];
  const sLo = [...lo], sHi = [...hi];
  for (const word of [f, g]) { const [k, hiSide] = AX[word]; if (hiSide) sLo[k] = hi[k] - c; else sHi[k] = lo[k] + c; }
  const ext = [0, 1, 2].map((k) => sHi[k] - sLo[k]);
  const region = ext[0] * ext[1] * ext[2];
  const cell = Math.cbrt(region / NPTS);
  const nn = ext.map((e) => Math.max(1, Math.ceil(e / cell)));
  const r = rng(12345 + i);
  const dist = (word, p) => { const [k, hiSide] = AX[word]; return hiSide ? hi[k] - p[k] : p[k] - lo[k]; };
  const p = [0, 0, 0];
  let removedCount = 0, total = 0;
  for (let a = 0; a < nn[0]; a++) for (let b = 0; b < nn[1]; b++) for (let d = 0; d < nn[2]; d++) {
    p[0] = sLo[0] + (a + r()) * ext[0] / nn[0]; p[1] = sLo[1] + (b + r()) * ext[1] / nn[1]; p[2] = sLo[2] + (d + r()) * ext[2] / nn[2];
    total++;
    if (dist(f, p) + dist(g, p) >= c) continue; // outside the wedge
    const inCavity = p[0] > cavLo[0] && p[0] < cavHi[0] && p[1] > cavLo[1] && p[1] < cavHi[1] && p[2] > cavLo[2] && p[2] < cavHi[2];
    if (!inCavity) removedCount++; // wedge AND shell material
  }
  const mc = Vh - (removedCount / total) * region;
  const rec = run.run(s, {});
  const closed = hollowBevelVolume(L, { wall: w, open }, { first: f, second: g, size: c });
  console.log(JSON.stringify({ index: i, seed: SEED, script: s.code.split('\n').slice(1).join(' ; '), points: total, wall: w, size: c, open, shellVolume: +Vh.toFixed(4),
    membershipOracle: +mc.toFixed(3), closedForm: +closed.toFixed(3), brep: +rec.brep?.volume?.toFixed(3), occt: rec.occt ? +rec.occt.volume.toFixed(3) : null,
    closedFormMinusOracle: +(closed - mc).toFixed(3), brepMinusOracle: +(rec.brep?.volume - mc).toFixed(3), occtMinusOracle: rec.occt ? +(rec.occt.volume - mc).toFixed(3) : null,
    refusals: rec.refusals }));
}
