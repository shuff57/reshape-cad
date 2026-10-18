// Classify fuzz results.  usage: node report.mjs [--seed 1] [--bins p7=Phase7,base=baseline] [--tol 1e-3]
// Reads $FZ/{cases,oracle,cli-<tag>}-s<seed>.jsonl, writes summary.json (here) and $FZ/classified-<tag>-s<seed>.jsonl
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const FZ = process.env.FZ || '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const seed = +arg('seed', 1), TOL = +arg('tol', 1e-3), EUCL_TOL = 1.5e-2, S_TOL = 1e-3;
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const cases = new Map(readJsonl(`${FZ}/cases-s${seed}.jsonl`).map((c) => [c.id, c]));
const orc = new Map(readJsonl(`${FZ}/oracle-s${seed}.jsonl`).map((r) => [r.id, r]));
const bins = (arg('bins', 'p7=Phase7 80c1e67,base=baseline fe3717f')).split(',').map((s) => s.split('='));
const eu = new Map(readJsonl(`${FZ}/euclid-s${seed}.jsonl`).map((r) => [r.id, r]));
const idf = arg('idfile'); const only = idf ? new Set(readFileSync(idf, 'utf8').split('\n').filter(Boolean)) : null;
const baseRows = new Map(readJsonl(`${FZ}/cli-${arg('basetag', 'p7')}-s${seed}.jsonl`).map((r) => [r.id, r.base]));

const OPAQUE = new RegExp("boolean|fallback|offset:|coincident|\\bCut\\b|kernel internal|\\bwire\\b|manifold|lumps|implausible|no result|planar faces only"); // names an internal operation (case-sensitive: Cut)
const VAGUE = /the kernel cannot build this shell yet/i; // gives up without a usable reason
const norm = (e) => e.replace(/step \d+ \(solid\.shell\):\s*/, '').replace(/-?\d+(\.\d+)?/g, '#').replace(/\[[^\]]*\]/g, '[..]').replace(/\(cylinder[^)]*\)/g, '(cylinder..)').slice(0, 220);

// smallest tracked gap (in units of t) of a case, for "were all the gaps clear?"
function minGapT(c) {
  const t = c.t; const g = [];
  const m = c.meta;
  if (c.family === 'plate') {
    g.push(m.gaps.gl, m.gaps.gr, m.gaps.gy1, m.gaps.gy2, ...m.gaps.between);
    for (const f of m.feats) for (const k of ['floor', 'g', 'wall', 'ring', 'straight']) if (typeof f[k] === 'number') g.push(f[k]);
  } else if (c.family === 'stepped') { for (const k of ['ww', 'stemW']) if (m[k]) g.push(m[k]); if (m.hole) g.push(m.hole.web ?? m.hole.g ?? 99); }
  else for (const f of m.feats) { for (const k of ['floor', 'ring', 'straight']) if (typeof f[k] === 'number') g.push(f[k]); }
  const gg = g.filter((x) => typeof x === 'number' && x > 0); return gg.length ? Math.min(...gg) / t : 99;
}

const out = { seed, tol: TOL, generated: cases.size, bins: {}, exclusions: {} };
const excl = { noOracleErr: 0, baseMultiBody: 0, baseFail: 0, modelMismatch: 0, euclidDisagree: 0, noOracleConeUnchecked: 0, baseMissing: 0 };
const coneUnchecked = [];
const mismatchFam = {};
const eligible = [];
for (const [id, c] of cases) {
  if (only && !only.has(id)) continue;
  const o = orc.get(id); const b = baseRows.get(id);
  if (!o || o.error) { excl.noOracleErr++; continue; }
  if (!b) { excl.baseMissing++; continue; }
  if (b.status !== 'ok') { excl.baseFail++; (mismatchFam['basefail ' + c.family + ' ' + (c.meta.kind || (c.meta.feats && c.meta.feats.map((f) => f.kind).join('+')) || c.meta.shape)] ??= []).push(id); continue; }
  if (b.bodies !== 1) { excl.baseMultiBody++; continue; }
  const sRel = Math.abs(b.vol - o.S) / o.S;
  if (sRel > S_TOL) { excl.modelMismatch++; const key = c.family + ' ' + (c.meta.kind || (c.meta.feats ? c.meta.feats.map((f) => f.kind).sort().join('+') : c.meta.shape)); (mismatchFam[key] ??= []).push(id); continue; }
  const hasCone = (c.model.holes || []).some((h) => h.type === 'cone');
  const e = eu.get(id);
  if (hasCone && !e) { excl.noOracleConeUnchecked++; coneUnchecked.push(id); continue; }
  if (e && Math.abs(e.eP - o.P) / o.P > EUCL_TOL) { excl.euclidDisagree++; continue; }
  eligible.push({ c, o, sRel });
}
out.exclusions = { ...excl, modelMismatchFamilies: Object.fromEntries(Object.entries(mismatchFam).map(([k, v]) => [k, v.length])) };
out.eligible = eligible.length;
out.euclidChecked = [...eu.values()].length;
out.euclidRelDelta = (() => { const d = [...eu.values()].map((e) => (e.eP - orc.get(e.id).P) / orc.get(e.id).P).sort((a, b) => a - b); return d.length ? { n: d.length, min: d[0], median: d[d.length >> 1], max: d[d.length - 1] } : null; })();
const byTag = {};
for (const [tag, label] of bins) {
  const rows = readJsonl(`${FZ}/cli-${tag}-s${seed}.jsonl`); const R = new Map(rows.map((r) => [r.id, r.shell]));
  const cls = { MATCH: 0, REFUSED: 0, WRONG: 0, TIMEOUT: 0, ERROR_OTHER: 0, MISSING: 0 };
  const refused = {}, wrong = [], classified = []; let opaque = 0, unjust = 0;
  for (const { c, o } of eligible) {
    const r = R.get(c.id); const row = { id: c.id, family: c.family, t: c.t, desc: c.desc, P: o.P, S: o.S };
    if (!r) { cls.MISSING++; continue; }
    if (r.status === 'ok') {
      const rel = Math.abs(r.vol - o.P) / o.P; row.vol = r.vol; row.rel = rel; row.bodies = r.bodies;
      if (rel <= TOL) { row.cls = 'MATCH'; cls.MATCH++; } else { row.cls = 'WRONG'; cls.WRONG++; wrong.push(row); }
    } else if (r.status === 'timeout') { row.cls = 'TIMEOUT'; cls.TIMEOUT++; }
    else if (r.status === 'error') {
      row.cls = 'REFUSED'; cls.REFUSED++; row.sentence = r.error; const key = norm(r.error); const mg = minGapT(c); row.minGapT = mg;
      const e = (refused[key] ??= { count: 0, opaque: OPAQUE.test(r.error), vague: VAGUE.test(r.error), clearGaps: 0, example: c.id, exampleText: r.error.slice(0, 300), byFamily: {} });
      e.count++; e.byFamily[c.family] = (e.byFamily[c.family] || 0) + 1;
      if (mg >= 2.05) { e.clearGaps++; unjust++; } if (e.opaque) opaque++;
    } else { row.cls = 'ERROR_OTHER'; cls.ERROR_OTHER++; row.sentence = r.error; }
    classified.push(row);
  }
  writeFileSync(`${FZ}/classified-${tag}-s${seed}.jsonl`, classified.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const cu = { MATCH: 0, REFUSED: 0, 'WRONG(unverified oracle)': 0, other: 0 };
  for (const id of coneUnchecked) { const r = R.get(id); const o = orc.get(id); if (!r) continue; if (r.status === 'ok') { cu[Math.abs(r.vol - o.P) / o.P <= TOL ? 'MATCH' : 'WRONG(unverified oracle)']++; } else if (r.status === 'error') cu.REFUSED++; else cu.other++; }
  byTag[tag] = { noOracleConeCombined_outcomes_informational_only: cu, label, classes: cls, refusedOpaqueCount: opaque, refusedWithAllGapsClear: unjust, refusalSentences: Object.entries(refused).sort((a, b) => b[1].count - a[1].count).map(([k, v]) => ({ sentence: k, ...v })), wrongIds: wrong.map((w) => w.id) };
}
out.bins = byTag;
writeFileSync(new URL(arg('out', './summary.json'), import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ generated: out.generated, eligible: out.eligible, exclusions: out.exclusions, classes: Object.fromEntries(Object.entries(byTag).map(([k, v]) => [k, v.classes])) }, null, 1));
