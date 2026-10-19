#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 2). Seeded generator of random primitive PAIRS (box / cylinder / sphere / torus, axis-aligned or 45 degrees) for
// every boolean, written to booleans-r2/fuzz-cases.json; boolean-cases-r2.mjs appends them to CASES when that file exists. Purpose: find a pair the guard lets through
// that then hangs past the budget, traps, or builds a wrong solid.
//   bun contract/bool-fuzz-gen.mjs --seed=7 --n=90
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const seed = Number(arg('seed', 7)); const n = Number(arg('n', 90));
let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const KINDS = ['box', 'cylinder', 'sphere', 'torus'];
const mk = (id, kind, center, rotate) => {
  const base = { id, kind, center };
  if (kind === 'box') base.size = [pick([10, 20, 30, 40]), pick([10, 20, 30, 40]), pick([10, 20, 30])];
  if (kind === 'cylinder') { base.radius = pick([4, 6, 10]); base.height = pick([20, 30, 40]); }
  if (kind === 'sphere') base.radius = pick([6, 10, 14]);
  if (kind === 'torus') { const [R, r] = pick([[14, 4], [10, 3], [12, 5]]); base.ringRadius = R; base.tubeRadius = r; }
  if (rotate && kind !== 'sphere') base.rotate = rotate;
  return base;
};
const cases = [];
for (let i = 0; i < n; i++) {
  const ka = pick(KINDS); const kb = pick(KINDS);
  const off = [0, 1, 2].map(() => pick([-1, 0, 0, 1]) * pick([0, 3, 6, 10, 14, 20]));
  const rot = pick([undefined, undefined, [90, 0, 0], [0, 90, 0], [45, 0, 0]]);
  const A = mk('a', ka, [0, 0, 0], pick([undefined, undefined, undefined, [90, 0, 0]]));
  const B = mk('b', kb, off, rot);
  const o = pick(['union', 'subtract', 'intersect']);
  cases.push({ id: `fz${seed}-${String(i).padStart(3, '0')}-${ka.slice(0, 3)}-${kb.slice(0, 3)}-${o.slice(0, 3)}`, feature: 'fuzz: random primitive pairs through every boolean', features: [A, B, { id: 'op1', kind: 'combine', op: o, targets: ['a', 'b'] }] });
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'booleans-r2', `fuzz-cases-${seed}.json`);
writeFileSync(out, JSON.stringify(cases));
console.log('wrote', out, cases.length);
