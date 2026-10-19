// SPIKE, referee only (round 4). Seeded random primitive features, and the selection of those a given guard ACCEPTS.
//   bun primitives-r4/fuzz-gen.mjs --seed=1 --planar=700 --curved=140 --out=primitives-r4/fuzz-seed1.json [--guard=../primitives.guard.mjs]
// The kernel is not run here. fuzz-spec.mjs turns the JSON into a sweep spec; the truth (good / wrong) comes from the rig, the guard verdict is
// re-applied OFFLINE (fuzz-score.mjs), so a guard change never needs a new kernel run, and a seed that was not used to tune the guard is a held-out test.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const seed = +arg('seed', 1); const nPlanar = +arg('planar', 700); const nCurved = +arg('curved', 140); const out = arg('out', `fuzz-seed${seed}.json`);
// the POOL filter is the frozen round 3 guard with its relative-placement rule for planar shapes switched off (round 4 replaces that rule), so the pool
// holds everything round 3 let through plus the far prisms and turned shapes the new rule may accept
const G = await import(pathToFileURL(path.resolve(arg('guard', path.join(import.meta.dir, 'pool-guard-r3.mjs')))).href);
G.LIM.planarFarRatio = Infinity;
// mulberry32
let st = (seed * 2654435761) >>> 0;
const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const U = (a, b) => a + (b - a) * rnd();
const LU = (a, b) => Math.exp(U(Math.log(a), Math.log(b)));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const sig = (v, d = 4) => +v.toPrecision(d);          // 4 significant digits, so scripts stay readable and sizes are NOT dyadic
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const place = (S) => [0, 1, 2].map(() => (rnd() < 0.3 ? 0 : sig((rnd() < 0.5 ? -1 : 1) * clamp(S * LU(0.1, 1e4), 0, 1.2e6))));
const turn = () => { const r = rnd(); if (r < 0.65) return undefined; if (r < 0.8) return [0, 1, 2].map(() => pick([0, 90, 180, -90])); return [0, 1, 2].map(() => sig(U(-180, 180), 3)); };
let n = 0;
function candidate(curved) {
  const S = curved ? LU(0.3, 6e4) : LU(1e-3, 3e5);
  const dim = () => sig(clamp(S * LU(0.05, 20), curved ? 0.2 : 1e-3, 1.2e6));
  const center = place(S); const rotate = turn();
  const base = (f) => ({ ...f, center, ...(rotate ? { rotate } : {}) });
  let kind = pick(curved ? ['box', 'cylinder', 'sphere', 'cone', 'torus', 'cylinder', 'box'] : ['box', 'wedge', 'prism', 'box', 'wedge', 'prism', 'box']);
  const id = `${kind}1`;
  if (kind === 'box') {
    const size = [dim(), dim(), dim()];
    const f = { id, kind, size };
    if (curved || rnd() < 0.05) { const lim = Math.min(...size) / 2; f.round = sig(lim * LU(1e-6, 1.05) * (rnd() < 0.3 ? 1 : 1), 3); if (rnd() < 0.15) f.roundStyle = 'chamfer'; }
    return base(f);
  }
  if (kind === 'cylinder') {
    const r = dim() / 2; const h = dim(); const f = { id, kind, radius: r, height: h };
    if (rnd() < (curved ? 0.6 : 0)) { const lim = Math.min(r, h / 2); f.round = sig(lim * (rnd() < 0.4 ? LU(1e-6, 1.05) : U(0.5, 1.02)), 4); if (rnd() < 0.2) f.roundStyle = 'chamfer'; }
    return base(f);
  }
  if (kind === 'sphere') return { id, kind, radius: dim() / 2, center };
  if (kind === 'cone') return base({ id, kind, radius: dim() / 2, height: dim() });
  if (kind === 'torus') { const across = dim(); const tube = sig(across * LU(0.01, 0.6)); return base({ id, kind, ringRadius: (across - tube) / 2, tubeRadius: tube / 2 }); }
  if (kind === 'prism') return base({ id, kind, sides: rnd() < 0.08 ? pick([2, 2.6, 5.5, 13, 30, 12.4]) : 3 + Math.floor(rnd() * 10), radius: dim() / 2, height: dim() });
  return base({ id, kind: 'wedge', width: dim(), depth: dim(), height: dim() });
}
const cases = []; const tried = { planar: 0, curved: 0 };
for (const [group, want] of [['planar', nPlanar], ['curved', nCurved]]) {
  let got = 0;
  while (got < want && tried[group] < 4e6) {
    tried[group]++;
    const f = candidate(group === 'curved');
    const isCurvedKind = ['cylinder', 'sphere', 'cone', 'torus'].includes(f.kind) || (f.kind === 'box' && f.round);
    if (isCurvedKind !== (group === 'curved')) continue;
    const verdict = G.guardDoc({ version: 1, features: [f] }).get(f.id);
    if (verdict) continue;      // only inputs the guard ACCEPTS are run: those are the ones that could be a silent wrong solid
    cases.push({ id: `fz${seed}-${group[0]}${String(got).padStart(4, '0')}`, doc: { version: 1, features: [f] } });
    got++;
  }
}
writeFileSync(out, JSON.stringify({ seed, tried, cases }));
console.log(`seed ${seed}: ${cases.length} accepted cases (tried planar ${tried.planar}, curved ${tried.curved}) -> ${out}`);
