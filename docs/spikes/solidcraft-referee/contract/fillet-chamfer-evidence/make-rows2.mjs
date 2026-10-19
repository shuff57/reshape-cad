// Round 2 row builder. Every number below is read from a result file written by a run of the scripts in this directory; nothing is typed in by hand
// except sentences and case ids. Inputs: res-r2.json res-seq.json res-r2b.json res-fc.json fuzz-single.json fuzz-pair.json batch-results-main.json
// batch-results-manual.json roundtrip-results.json perf-results.json browser-results*.json cases-results.json (round 1) fillet-chamfer.round1.json.
// Output: ../fillet-chamfer.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const D = path.dirname(fileURLToPath(import.meta.url));
const J = (f) => (existsSync(path.join(D, f)) ? JSON.parse(readFileSync(path.join(D, f), 'utf8')) : null);
const idx = (a) => Object.fromEntries((a ?? []).map((r) => [r.id, r]));
const R2 = idx(J('res-r2.json')); const SQ = idx(J('res-seq.json')); const R2B = idx(J('res-r2b.json')); const FCR = idx(J('res-fc.json'));
const OLD = idx(J('cases-results.json')); const OLDROWS = J('fillet-chamfer.round1.json').rows;
const FZS = J('fuzz-single.json'); const FZP = J('fuzz-pair.json');
const BT = idx([...(J('batch-results-main.json') ?? []), ...(J('batch-results-manual.json') ?? [])]);
const RT = J('roundtrip-results.json'); const PERF = idx(J('perf-results.json'));
const BR = {};
for (const f of ['browser-results.json', 'browser-results-2.json', 'browser-results-3.json', 'browser-results-4.json', 'browser-results-5.json', 'browser-results-6.json', 'browser-results-7.json']) for (const r of J(f) ?? []) BR[r.id] = r;
const R2C = idx(J('res-r2c.json'));
const ALL = { ...R2, ...SQ, ...R2B, ...FCR, ...R2C };

const f4 = (x) => (typeof x === 'number' ? x.toFixed(4) : String(x));
const ex = (x) => (typeof x === 'number' ? x.toExponential(1) : '-');
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
/** One-line measurement of a case: truck / OCCT / brep-rs volume + faces, closed form, refusal flags. */
function m(id, { cf = true } = {}) {
  const r = ALL[id];
  if (!r) return `${id}: NOT RUN`;
  if (r.interp) return `${id}: refused by the interpreter: ${r.interp.errors?.[0] ?? r.interp.threw}`;
  const fx = r.fx; const t = fx.truck ?? {};
  const oRef = Object.keys(fx.occtRefusals ?? {}).length > 0; const bRef = !!fx.brep?.refused || Object.keys(fx.brepRefusals ?? {}).length > 0;
  let tv = t.volume !== undefined ? `truck ${f4(t.volume)} (${t.faces} faces)` : `truck REFUSED`;
  if (fx.invalid) {
    const sc = r.scOnly ?? {};
    tv = sc.volume !== undefined ? `truck ${f4(sc.volume)} (${sc.faces} faces)` : `truck REFUSED`;
    return `${id}: ${tv}; OCCT could not build (${fx.invalid.slice(0, 70)}); brep-rs ${r.brepOnly?.volume !== undefined ? f4(r.brepOnly.volume) : 'REFUSED'}`;
  }
  const o = `OCCT ${f4(fx.occt?.volume)} (${fx.occt?.faces} faces)${oRef ? ' [OCCT REFUSED the blend, volume shown is the shape without it]' : ''}`;
  const b = `brep-rs ${f4(fx.brep?.volume)}${bRef ? ' [REFUSED]' : ''}`;
  const c = cf && r.closed !== undefined ? `; closed form ${f4(r.closed)}${t.volume !== undefined ? ` (truck ${ex(r.truckVsClosed)})` : ''}` : '';
  return `${id}: ${tv}; ${o}; ${b}${c}`;
}
const truckOf = (id) => ALL[id]?.fx?.truck?.volume;
const sentenceOf = (id) => ALL[id]?.fx?.truck?.refused ?? ALL[id]?.scOnly?.refused ?? (ALL[id]?.interp?.errors?.[0]);
/** Shipping-path result (phase 7 pane in a real browser) for a case id. */
function ship(id) {
  const r = BR[id];
  if (!r) return `${id}: browser not run`;
  if (r.error) return `${id}: pane error: ${String(r.error).slice(0, 160)}`;
  if (r.refusals?.length) return `${id}: pane REFUSES: ${r.refusals[0].slice(0, 230)}${r.volume ? ` (partial design shows ${f4(r.volume)})` : ''}`;
  return `${id}: pane builds ${f4(r.volume)} (${r.faces} faces)`;
}
const rigVol = (id) => ALL[id]?.fx?.truck?.volume ?? ALL[id]?.scOnly?.volume ?? OLD[id]?.truck?.volume;
/** Pane vs rig for a list of case ids: identical builds are counted, every refusal / difference / missing run is listed. */
function shipSum(ids, { terse = false } = {}) {
  const same = []; const refused = []; const diff = []; const missing = []; let worst = 0; const sents = new Map();
  const norm = (t) => String(t).replace(/^[a-z0-9]+ \((fillet|chamfer|draft|shell|box|cylinder)\): /, '').replace(/\b[a-z]+\d*\.edge\[.*?\](?= resolves| cannot| matches)/, '<edge name>').replace(/F\d:[\w:|+-]+(\|F\d:[\w:|+-]+)?/g, 'F..').replace(/on b_\w+/g, 'on <body>').replace(/\b[a-z]+\d+\.face\[[^\]]*\]/g, '<face>').replace(/\(round\d+ \(.*$/, '(...)').slice(0, 260);
  for (const id of ids) {
    const b = BR[id];
    if (!b) { missing.push(id); continue; }
    if (b.error && /^SCRIPT ERROR/.test(String(b.error))) { refused.push(terse ? `${id} (interpreter)` : `${id} (interpreter, before any kernel): ${String(b.error).replace(/^SCRIPT ERROR /, '').slice(0, 170)}`); continue; }
    if (b.error) { diff.push(`${id}: pane error ${String(b.error).slice(0, 100)}`); continue; }
    if (b.refusals?.length) {
      const rv0 = rigVol(id);
      if (terse) { refused.push(`${id}${rv0 === undefined ? '' : ` (rig BUILDS ${f4(rv0)})`}`); const k = norm(b.refusals[0]); const e = sents.get(k) ?? { n: 0, first: b.refusals[0].slice(0, 230) }; e.n++; sents.set(k, e); }
      else refused.push(`${id}${rv0 === undefined ? ' (rig also refuses)' : ` (rig BUILDS ${f4(rv0)})`}: ${b.refusals[0].slice(0, 210)}`);
      continue;
    }
    const rv = rigVol(id);
    if (rv === undefined) { diff.push(`${id}: pane BUILDS ${f4(b.volume)} where the rig refuses`); continue; }
    const d = rel(b.volume, rv);
    if (d <= 1e-6) { same.push(id); worst = Math.max(worst, d); } else diff.push(`${id}: pane ${f4(b.volume)} vs rig ${f4(rv)} (${ex(d)})`);
  }
  const sentTxt = terse && sents.size ? ` Distinct sentences (verbatim first example, count): ${[...sents.values()].map((e) => `"${e.first}" x${e.n}`).join(' || ')}.` : '';
  return `PANE (${ids.length} case${ids.length === 1 ? '' : 's'}, shipping resolver in a real browser, no brep-rs): ${same.length} identical to the rig${same.length ? ` (worst ${ex(worst)}): ${same.join(', ')}` : ''}; ${refused.length} refused by the pane${refused.length ? ' [' + refused.join(terse ? ', ' : ' | ') + ']' : ''}; ${diff.length} differ${diff.length ? ' [' + diff.join(' | ') + ']' : ''}${missing.length ? `; ${missing.length} not run (${missing.join(', ')})` : ''}.${sentTxt}`;
}
/** Interpreter refusals reproduced as SCRIPT ERROR in the pane. */
function scriptErrs(ids) {
  const ok = ids.filter((i) => /^SCRIPT ERROR/.test(String(BR[i]?.error ?? '')));
  return `${ok.length} of ${ids.length} interpreter refusals reproduce in the pane as SCRIPT ERROR with the same sentence (${ids.join(', ')})`;
}
const SHIPN = shipSum;
const rows = [];
const row = (feature, status, evidence, refusalSentence) => rows.push(refusalSentence ? { feature, status, refusalSentence, evidence } : { feature, status, evidence });
const old = (i) => OLDROWS[i - 1];
const strip = (s) => s.replace(/^cmd: [^\n]*?case ids quoted\)\. /, '').replace(/PICK: brep-rs resolve via phase0 translator; phase4 browser resolver not run\.\s*/g, '');
const CMD = 'cmd: SOLIDCRAFT_REFEREE_PKG=$S/sc-referee-pkg systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/fillet-chamfer-evidence/<driver> (drive2.mjs / batch.mjs / fuzz.mjs / perf.mjs / browser-run.mjs via run2.sh, runfz.sh).';
const RIGNOTE = 'RIG PICK: the named edge is located by brep-rs resolve (archived, not available at product time) plus the phase 0 translator\'s nearest-edge snapping and pick-retry loop; it is not the shipping resolver.';
const SHIPNOTE = 'SHIPPING PATH (phase 7 pane, real browser, translate-p4 + resolve-names.mjs, no brep-rs, no pick retry): ';
const NOTPLAIN = 'SENTENCE NOT PLAIN: ';

export { shipSum, scriptErrs, rows, row, old, strip, m, ship, SHIPN, ALL, R2, SQ, R2B, FCR, OLD, FZS, FZP, BT, RT, PERF, BR, CMD, RIGNOTE, SHIPNOTE, NOTPLAIN, f4, ex, rel, truckOf, sentenceOf, D };
