// Cluster WRONG rows by feature tag.  usage: node cluster.mjs [--tag p7] [--seed 1] [--min 6]
// For each tag (feature kind + face + gap bucket in units of t) prints MATCH / WRONG / REFUSED over the cases that contain it,
// separately for "single-feature" cases (a minimal family) and for all cases.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const FZ = process.env.FZ || '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'p7'), seed = +arg('seed', 1), MIN = +arg('min', 6);
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const cases = new Map(readJsonl(`${FZ}/cases-s${seed}.jsonl`).map((c) => [c.id, c]));
const rows = readJsonl(`${FZ}/classified-${tag}-s${seed}.jsonl`);
const bk = (x) => (x < 0.95 ? '<1t' : x < 1.05 ? '=1t' : x < 1.95 ? '1-2t' : x < 2.05 ? '=2t' : x < 3 ? '2-3t' : '>=3t');
function tagsOf(c) {
  const t = c.t, out = [];
  if (c.family === 'plate') {
    out.push('open=' + c.meta.open);
    for (const f of c.meta.feats) {
      const k = f.kind;
      if (k === 'blind' || k === 'pocket' || k === 'slot') out.push(`${k}/${f.face}/floor${bk(f.floor / t)}`);
      else if (k === 'cbore') out.push(`cbore/${f.face}/ring${bk(f.ring / t)}`);
      else if (k === 'csink') out.push(`csink/${f.face}/straight${bk(f.straight / t)}`, `csink/${f.face}/dep${bk(f.dep / t)}`);
      else if (k === 'hhole') out.push(`hhole/g${bk(f.g / t)}`);
      else if (k === 'rim') out.push(`rim/${f.face}/wall${bk(f.wall / t)}`);
      else if (k === 'bossBox') out.push(`bossBox/${f.face}`);
      else if (k === 'rboss') out.push(`rboss/h${bk(f.bh / t)}`);
      else out.push(k);
    }
    const g = c.meta.gaps; const all = [g.gl, g.gr, g.gy1, g.gy2, ...g.between];
    out.push('minLayoutGap' + bk(Math.min(...all) / t));
    out.push('nFeat=' + c.meta.feats.length);
  } else if (c.family === 'convex') {
    out.push('convex/' + c.meta.kind, `convex/${c.meta.kind}/s${bk(c.meta.s / t)}`);
    for (const f of c.meta.feats) out.push('convex+' + f.kind + '/' + (f.face || ''));
  } else { out.push('stepped/' + c.meta.shape + '/' + c.meta.open, 'stepped/' + (c.meta.hole ? (c.meta.hole.h ? 'hhole' : 'vhole') : 'nohole')); }
  out.push('t=' + c.t);
  return out;
}
const tab = (filter) => {
  const T = new Map();
  for (const r of rows) { if (!['MATCH', 'WRONG', 'REFUSED'].includes(r.cls)) continue; const c = cases.get(r.id); if (!filter(c)) continue; for (const tg of tagsOf(c)) { const e = T.get(tg) ?? { MATCH: 0, WRONG: 0, REFUSED: 0 }; e[r.cls]++; T.set(tg, e); } }
  return [...T.entries()].map(([tg, e]) => ({ tag: tg, ...e, n: e.MATCH + e.WRONG + e.REFUSED, wrongRate: e.WRONG / (e.MATCH + e.WRONG + e.REFUSED), wrongOfBuilt: e.WRONG / Math.max(1, e.MATCH + e.WRONG) })).filter((e) => e.n >= MIN).sort((a, b) => b.wrongOfBuilt - a.wrongOfBuilt);
};
const single = tab((c) => (c.family === 'plate' ? c.meta.feats.length <= 1 : true));
const all = tab(() => true);
const show = (name, t) => { console.log('==', name); for (const e of t.slice(0, +arg('top', 40))) console.log(e.tag.padEnd(34), `n=${String(e.n).padStart(3)} MATCH=${String(e.MATCH).padStart(3)} WRONG=${String(e.WRONG).padStart(3)} REF=${String(e.REFUSED).padStart(3)}  wrong/built=${(e.wrongOfBuilt * 100).toFixed(0)}%`); };
show('single-feature (or non-plate) cases', single); show('all cases', all);
writeFileSync(new URL(`./cluster-${tag}.json`, import.meta.url), JSON.stringify({ single, all }, null, 1));
