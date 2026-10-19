// Over-refusals: REFUSED where every geometric gap that the generator tracks is >= 2.05 t (rect plates: layout gaps, floors, rings, rim walls,
// countersink straight length, horizontal-hole ligaments on BOTH sides; L/T/U without holes: every step/wall/stem/base dimension).
// Plates with round bosses or hhole+open side faces are kept (those are real refusals of clear geometry). Convex plates are not judged (gap tracking incomplete).
// usage: node overref.mjs --tag p8 --seed 2 [--ids file]
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const FZ = process.env.FZ || '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'p8'), seed = +arg('seed', 1); const idf = arg('ids');
const only = idf ? new Set(readFileSync(idf, 'utf8').split('\n').filter(Boolean)) : null;
const rj = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const cases = new Map(rj(`${FZ}/cases-s${seed}.jsonl`).map((c) => [c.id, c]));
const INTERNAL = new RegExp('boolean|fallback|offset:|coincident|\\bCut\\b|kernel internal|\\bwire\\b|manifold|lumps|implausible|no result|planar faces only');
function judge(c) { // returns min gap/t or null if not judged
  const t = c.t, g = [];
  if (c.family === 'plate') {
    const m = c.meta; g.push(m.gaps.gl, m.gaps.gr, m.gaps.gy1, m.gaps.gy2, ...m.gaps.between, m.H - t);
    for (const f of m.feats) {
      for (const k of ['floor', 'wall', 'ring', 'straight']) if (typeof f[k] === 'number') g.push(f[k]);
      if (f.kind === 'hhole') { g.push(f.g, f.fromTop ? f.zc - f.r : m.H - f.zc - f.r); }
      if (f.kind === 'rim') g.push(f.bw / 2, f.bd / 2);
    }
  } else if (c.family === 'stepped' && !c.meta.hole) { const m = c.meta; for (const k of ['Hb', 'Hw', 'ww', 'stemW', 'zc0', 'th']) if (m[k]) g.push(m[k]); if (m.W && m.ww) g.push(m.W - m.ww); }
  else return null;
  return Math.min(...g) / t;
}
const out = { tag, seed, judged: 0, refused: 0, overRefused: 0, sentences: {} }; const rows = [];
for (const r of rj(`${FZ}/classified-${tag}-s${seed}.jsonl`)) {
  if (only && !only.has(r.id)) continue; const c = cases.get(r.id); const mg = judge(c); if (mg === null) continue;
  if (r.cls === 'REFUSED') out.refused++; if (mg < 2.05) continue; out.judged++;
  if (r.cls !== 'REFUSED') continue; out.overRefused++;
  const key = r.sentence.replace(/step \d+ \(solid\.shell\):\s*/, '').replace(/-?\d+(\.\d+)?/g, '#').replace(/\[[^\]]*\]/g, '[..]').slice(0, 160);
  const e = (out.sentences[key] ??= { count: 0, internals: INTERNAL.test(r.sentence), example: r.id + ' ' + r.desc }); e.count++;
}
console.log(JSON.stringify(out, null, 1));
writeFileSync(new URL(`./overref-${tag}-s${seed}.json`, import.meta.url), JSON.stringify(out, null, 1));
