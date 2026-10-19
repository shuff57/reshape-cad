// SPIKE, referee only. Shared helpers for fc4-make-rows.mjs: load every fc4-results-*.json, score it with fc4-score.mjs, and format compact evidence lines.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAll, truthOf } from './fc4-score.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EVD = path.resolve(HERE, '..');
export const loadAll = () => {
  const recs = new Map();
  for (const f of readdirSync(EVD).filter((x) => /^fc4-results-.*\.json$/.test(x) && !/pairfuzz|seq-limit|rigcheck/.test(x)).sort()) {
    const arr = JSON.parse(readFileSync(path.join(EVD, f), 'utf8'));
    for (const r of arr) { r._file = f; recs.set(r.id, r); }
  }
  const list = [...recs.values()];
  const scored = new Map(scoreAll(list).map((s) => [s.id, s]));
  return { recs, scored, list };
};
export const f4 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(4) : String(x));
export const ex = (x) => (typeof x === 'number' ? (x === 0 ? '0.0e+0' : x.toExponential(1)) : String(x));
export const short = (id) => id.replace(/^(a1|a2|a3|a4|a5|b|rg|fzs|fzg|fzp)-/, '');
/** one path outcome as a short string: "9200.0000 (6f) built-WRONG" / "refused: <sentence>" */
export function pathStr(s, name, rec, { sentence = false } = {}) {
  const p = s?.[name]; const run = rec?.[name];
  if (!p) return `${name} -`;
  if (p.out === 'refused') return `${name} REFUSED${p.of > 1 ? ` (${p.n} of ${p.of} blends)` : ''}${p.partialVolume != null ? `, part shown ${f4(p.partialVolume)}` : ''}${sentence && p.sentence ? ` "${p.sentence}"` : ''}`;
  const bb = run?.bodies?.[0]?.bbox ? ` bbox [${run.bodies[0].bbox.map((v) => +v.toFixed(3)).join(',')}]` : '';
  return `${name} ${f4(run?.volume ?? p.volume)} (${run?.faces ?? p.faces}f)${p.out === 'built-match' ? ' =truth' : ` ${p.out}${p.dVol != null ? ' dVol ' + ex(p.dVol) : ''}${p.facesTruth != null && p.facesTruth !== p.facesTruck ? ` faces ${p.facesTruck} vs ${p.facesTruth}` : ''}${p.inv && (p.inv.shrink > 1e-3 || p.inv.grow > 1e-3) ? ` bbox moved ${(Math.max(p.inv.shrink, p.inv.grow) * 100).toFixed(1)}% of the diagonal` : ''}`}${name === 'pane' && false ? bb : ''}`;
}
export const truthStr = (rec, s) => { const t = truthOf(rec, rec.oracle?.closedForm ?? null); return t ? `${t.src} ${f4(t.volume)}${t.faces != null ? ` (${t.faces}f)` : ''}` : 'every oracle refuses'; };
export const count = (arr, f) => arr.filter(f).length;
