// WRONG-rate by "which gaps are < 2t" (layout gaps vs per-feature floors/rings/walls). usage: node groups.mjs [--tag p7] [--seed 1]
import { readFileSync, existsSync } from 'node:fs';
const FZ = process.env.FZ || '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'p7'), seed = +arg('seed', 1);
const rj = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const cases = new Map(rj(`${FZ}/cases-s${seed}.jsonl`).map((c) => [c.id, c]));
const T = {}; const unexplained = [];
export function gapInfo(c) {
  const t = c.t; let lay = 99, feat = 99;
  if (c.family === 'plate') { const g = c.meta.gaps; lay = Math.min(g.gl, g.gr, g.gy1, g.gy2, ...g.between) / t; for (const f of c.meta.feats) for (const k of ['floor', 'g', 'wall', 'ring', 'straight']) if (typeof f[k] === 'number') feat = Math.min(feat, f[k] / t); }
  else if (c.family === 'convex') { for (const f of c.meta.feats) for (const k of ['floor', 'ring', 'straight']) if (typeof f[k] === 'number') feat = Math.min(feat, f[k] / t); if (c.meta.feats.some((f) => f.corner)) lay = 1.5; }
  else { const m = c.meta; for (const k of ['ww', 'stemW']) if (m[k]) feat = Math.min(feat, m[k] / t / 1); if (m.hole) lay = Math.min(lay, (m.hole.web ?? m.hole.g ?? 99) / t); }
  return { lay, feat };
}
for (const r of rj(`${FZ}/classified-${tag}-s${seed}.jsonl`)) {
  if (!['MATCH', 'WRONG', 'REFUSED'].includes(r.cls)) continue; const c = cases.get(r.id); const { lay, feat } = gapInfo(c);
  const g = `${c.family} layout${lay < 1 ? '<t' : lay < 2 ? 't..2t' : '>=2t'} feat${feat < 1 ? '<t' : feat < 2 ? 't..2t' : '>=2t'}`;
  const e = (T[g] ??= { MATCH: 0, WRONG: 0, REFUSED: 0 }); e[r.cls]++;
  if (r.cls === 'WRONG' && lay >= 2 && feat >= 2) unexplained.push(r.id + ' ' + c.desc + ' rel=' + r.rel.toExponential(1));
}
for (const [k, v] of Object.entries(T).sort()) console.log(k.padEnd(40), JSON.stringify(v), 'wrong/built=' + (100 * v.WRONG / Math.max(1, v.WRONG + v.MATCH)).toFixed(0) + '%');
console.log('WRONG with all tracked gaps >= 2t:', unexplained.length); console.log(unexplained.slice(0, 40).join('\n'));
