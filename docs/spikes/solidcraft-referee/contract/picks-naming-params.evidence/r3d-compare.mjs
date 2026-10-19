// Round 3 D. Compare the original measurement outputs (resX.json / r2*.json in this directory, page translator) with the re-runs through the
// guarded + plain-sentence translator (r3-run-sec.mjs, same scripts, outputs in <dir>). Reports:
//   * every case whose outcome or volume changed (guard false positives show up here: PASS -> REFUSED),
//   * every refused feature: the raw text the page shows and the plain sentence the layer emits, grouped by plain sentence,
//   * unmapped raw texts (no plain rule) and plain sentences that fail the plainness lint (r2-lint.mjs rules).
//   bun r3d-compare.mjs <dir> [--out=file]
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
const dir = process.argv[2]; const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const here = new URL('.', import.meta.url).pathname;
const BAD = [
  [/\bb_[a-z]+\d*/i, 'internal body id'], [/\bF\d+[:|]/, 'internal face id'], [/[~#]\d/, 'internal split suffix'], [/\.(face|edge|same)\[/, 'internal name syntax'], [/\^/, 'name caret'],
  [/solid\.\w+/i, 'engine command id'], [/solidcraft|truck|kernel|brep|occt|wasm|panic/i, 'engine/kernel name'],
  [/\bdemo\b|phase ?\d|\bspike\b|discriminator|history record|command list|not mapped|names a set of|nothing is picked|not guessing|translator|resolv/i, 'spike jargon'],
  [/invalid (input|parameters)|offset:|boolean/i, 'engine error text'], [/undefined|NaN|\bnull\b/, 'leaked value'],
];
const nSent = (s) => (s.replace(/\([^)]*\)/g, '(...)').match(/[.!?](\s|$)/g) ?? []).length;
const lint = (s) => { const why = []; for (const [re, m] of BAD) if (re.test(s)) why.push(m); if (nSent(s) !== 1) why.push(`${nSent(s)} sentences`); if (s.split(/\s+/).length > 45) why.push('>45 words'); if (!/[.!]$/.test(s.trim())) why.push('no full stop'); return why; };
const flat = (j) => (Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : Object.values(j).filter(Array.isArray).flat());
const changed = [], groups = new Map(), unmapped = [], badPlain = []; let cases = 0, refusedFeatures = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const oldF = here + f; if (!existsSync(oldF)) continue;
  let a, b; try { a = flat(JSON.parse(readFileSync(oldF, 'utf8'))); b = flat(JSON.parse(readFileSync(dir + '/' + f, 'utf8'))); } catch { continue; }
  const key = (r, i) => (r.label ?? '') + '#' + (r.src ?? '').slice(0, 60) + '#' + i;
  const mapA = new Map(a.map((r, i) => [key(r, i), r]));
  b.forEach((r, i) => {
    cases++;
    const o = mapA.get(key(r, i));
    if (o && (o.outcome !== r.outcome || (o.truck && r.truck && Math.abs(o.truck.volume - r.truck.volume) > 1e-9 * Math.max(1, o.truck.volume)))) changed.push({ file: f, label: r.label, old: o.outcome, now: r.outcome, oldV: o.truck?.volume, nowV: r.truck?.volume, sentence: r.sentence });
    const fts = (r.features ?? []).length ? r.features : (r.sentence && r.outcome === 'REFUSED' ? [{ status: 'refused', refusal: r.sentence, raw: o?.sentence }] : []);
    for (const ft of fts) if (ft.status === 'refused') {
      refusedFeatures++;
      const s = ft.refusal; const raw = ft.raw ?? ft.refusal;
      const gkey = s.replace(/\b(round|bevel|shell|draft|hole|pat|op|mir|move|turn|box|cyl|ball|cone|ring|wedge|prism|pocket|pull|sk|e|r|sh|d|b)\d*/g, '$1#').replace(/\d+(\.\d+)?/g, 'N');
      if (!groups.has(gkey)) groups.set(gkey, { n: 0, plain: s, raw: [], labels: [] });
      const g = groups.get(gkey); g.n++; if (g.raw.length < 2) g.raw.push(raw.slice(0, 220)); if (g.labels.length < 3) g.labels.push(`${f}:${r.label}`);
      const why = lint(s); if (why.length) badPlain.push({ file: f, label: r.label, plain: s, why });
    }
    for (const u of r.unmapped ?? []) unmapped.push({ file: f, label: r.label, ...u });
  });
}
console.log(`cases re-run ${cases}; refused features ${refusedFeatures}; distinct plain sentences ${groups.size}; changed outcome/volume ${changed.length}; unmapped ${unmapped.length}; failing the lint ${badPlain.length}`);
for (const c of changed) console.log('CHANGED', JSON.stringify(c).slice(0, 400));
for (const u of unmapped.slice(0, 40)) console.log('UNMAPPED', JSON.stringify(u).slice(0, 300));
for (const u of badPlain.slice(0, 40)) console.log('LINT', JSON.stringify(u).slice(0, 300));
const out = { cases, refusedFeatures, changed, unmapped, badPlain, groups: [...groups.values()] };
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
if (process.argv.includes('--groups')) for (const g of out.groups) console.log(`${String(g.n).padStart(3)} | ${g.plain}\n      raw: ${g.raw[0]}\n      ${g.labels.join(' ; ')}`);
