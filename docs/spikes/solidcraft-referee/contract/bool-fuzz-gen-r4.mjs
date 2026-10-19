#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 4). Seeded generator of random primitive PAIRS and TRIPLES for every boolean, now with cone, prism and wedge as well as box / cylinder / sphere / torus,
// axis-aligned, turned by 45 degrees, or turned by a generic angle; written to booleans-r4/fuzz-cases-<seed>.json (boolean-cases-r3.mjs appends every such file to CASES).
// Triples exercise the n-ary join / cut / keep (the round-2 fuzz had pairs only). Ids start fz<seed>-.
//   bun contract/bool-fuzz-gen-r4.mjs --seed=17 --n=120
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const seed = Number(arg('seed', 17)); const n = Number(arg('n', 120));
let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const KINDS = ['box', 'box', 'cylinder', 'sphere', 'torus', 'cone', 'prism', 'wedge'];
const mk = (id, kind, center, rotate) => {
  const base = { id, kind, center };
  if (kind === 'box') base.size = [pick([10, 20, 30, 40]), pick([10, 20, 30, 40]), pick([10, 20, 30])];
  if (kind === 'cylinder') { base.radius = pick([4, 6, 10]); base.height = pick([20, 30, 40]); }
  if (kind === 'sphere') base.radius = pick([6, 10, 14]);
  if (kind === 'torus') { const [R, r] = pick([[14, 4], [10, 3], [12, 5]]); base.ringRadius = R; base.tubeRadius = r; }
  if (kind === 'cone') { base.radius = pick([6, 10, 14]); base.height = pick([20, 30]); }
  if (kind === 'prism') { base.sides = pick([3, 5, 6, 8]); base.radius = pick([6, 10, 14]); base.height = pick([20, 30]); }
  if (kind === 'wedge') { base.width = pick([10, 20, 30]); base.depth = pick([10, 20]); base.height = pick([10, 20]); }
  if (rotate && kind !== 'sphere') base.rotate = rotate;
  return base;
};
const ROTS = [undefined, undefined, undefined, [90, 0, 0], [0, 90, 0], [45, 0, 0], [0, 0, 45], [30, 20, 10], [20, 30, 10], [45, 60, 45]];
const cases = [];
for (let i = 0; i < n; i++) {
  const three = rnd() < 0.3;
  const ks = [pick(KINDS), pick(KINDS), ...(three ? [pick(KINDS)] : [])];
  const ids = ['a', 'b', 'c'];
  const feats = ks.map((k, j) => mk(ids[j], k, j === 0 ? [0, 0, 0] : [0, 1, 2].map(() => pick([-1, 0, 0, 1]) * pick([0, 3, 6, 10, 14, 20])), j === 0 ? pick([undefined, undefined, undefined, [90, 0, 0], [45, 0, 0], [30, 20, 10]]) : pick(ROTS)));
  const o = pick(['union', 'subtract', 'intersect']);
  cases.push({ id: `fz${seed}-${String(i).padStart(3, '0')}-${ks.map((k) => k.slice(0, 3)).join('-')}-${o.slice(0, 3)}`, feature: 'fuzz: random primitive pairs and triples through every boolean', features: [...feats, { id: 'op1', kind: 'combine', op: o, targets: feats.map((f) => f.id) }] });
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'booleans-r4', `fuzz-cases-${seed}.json`);
writeFileSync(out, JSON.stringify(cases));
console.log('wrote', out, cases.length);
