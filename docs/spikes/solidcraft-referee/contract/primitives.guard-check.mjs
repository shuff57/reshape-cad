// SPIKE, referee only. Proof run for the primitives pre-flight guard (primitives.guard.mjs + primitives.call-lint.mjs).
// Loads EVERY recorded primitives measurement (round 1/2 evidence + the round 3 sweeps) and asks, per case:
//   truck outcome  : good  = built and inside the bars against the independent oracle (OCCT; closed form when OCCT refuses)
//                    wrong = built and outside the bars (volume, bbox, COM or face count) -- the dangerous class
//                    n/a   = truck refused / script refused (nothing to protect)
//   guard verdict  : accept | refuse (+ sentence)
// and prints the 2x2. Required: wrong & accept = 0 (a hole), and every sentence passes the plain-sentence lint. good & refuse is listed
// (conservative refusal, each is a deliberate envelope edge, not a bug) so the cost of the guard is visible.
//
//   bun contract/primitives.guard-check.mjs [--json=<out.json>] [--full]
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './primitives.guard.mjs';
import * as L from './primitives.call-lint.mjs';
import { runScript } from '../../../../packages/script/dist/reshape-script.js';
const runSides = (src) => { const r = runScript(src); return r.errors.length ? null : r.doc.features.filter((f) => f.kind === 'prism').map((f) => f.sides); };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EV = path.join(HERE, 'primitives-evidence');
const R3 = path.join(HERE, 'primitives-r3', 'results');
const R4 = path.join(HERE, 'primitives-r4', 'results');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);

const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/primitives-measure\.json$|^main\.json$|^far\.json$|^edge\.json$/.test(n)) files.push(p); } };
walk(EV);
for (const dir of [R3, R4]) if (existsSync(dir)) for (const n of readdirSync(dir)) if (n.endsWith('.json') && n !== 'fuzz-spec.json') files.push(path.join(dir, n));

const rows = [];
for (const f of files) {
  let j; try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  if (!Array.isArray(j)) continue;
  for (const r of j) if (r && r.doc && r.id) rows.push({ ...r, _file: path.relative(HERE, f) });
}
// de-duplicate by (script|doc) text, keeping the one with the fullest truck record
const key = (r) => (r.script ?? JSON.stringify(r.doc));
const byKey = new Map();
for (const r of rows) { const k = key(r); const o = byKey.get(k); if (!o || (!o.truck && r.truck)) byKey.set(k, r); }
const uniq = [...byKey.values()];

/** outcome of one recorded case against the bars; handles round 1/2 records (dVolAnalytic, truck.refused) and round 3 records (dVolAn, oracle) */
export function outcome(r) {
  const t = r.truck;
  if (r.status === 'script-refused' || r.status === 'refused-by-script' || r.scriptRefusal) return 'n/a';
  if (r.status === 'truck-refused' || r.status === 'refused-by-solidcraft' || r.status === 'harness-error') return 'n/a';
  if (!t || t.refused !== undefined) return 'n/a';
  const planar = !t.curved;
  const volBar = planar ? 1e-9 : 3e-4; const bboxBar = planar ? 1e-6 : 1e-4; const comBar = planar ? 1e-6 : 1e-4;
  const dv = t.dVolOcct ?? t.dVolAn ?? t.dVolAnalytic;
  if (dv === undefined) return 'unverified'; // built, but neither OCCT nor a closed form could say what it should be
  if (dv > volBar) return 'wrong';
  if (t.dBboxOcct !== undefined && t.dBboxOcct > bboxBar) return 'wrong';
  if (t.dComOcct !== undefined && t.dComOcct > comBar) return 'wrong';
  if (t.facesOcct !== undefined && t.facesOcct !== t.faces) return 'wrong';
  if (t.bodies !== undefined && t.bodies !== 1) return 'wrong';
  return 'good';
}

const grid = { good: { accept: [], refuse: [] }, wrong: { accept: [], refuse: [] }, unverified: { accept: [], refuse: [] }, 'n/a': { accept: [], refuse: [] } };
const lintBad = [];
const sentences = new Map();
for (const r of uniq) {
  const o = outcome(r);
  let g = G.guardFirst(r.doc);
  if (!g && r.script) { const l = [...L.lintSurplusArgs(r.script), ...(/prism\s*\(/.test(r.script) ? L.lintPrismSides(r.script, runSides) : [])]; if (l.length) g = l[0]; }
  if (g) { const bad = G.sentenceProblems(g.sentence); if (bad.length) lintBad.push({ id: r.id, sentence: g.sentence, bad }); sentences.set(g.code, g.sentence); }
  grid[o][g ? 'refuse' : 'accept'].push({ id: r.id, script: r.script, guard: g, dv: r.truck ? (r.truck.dVolOcct ?? r.truck.dVolAn ?? r.truck.dVolAnalytic) : undefined });
}
const n = (a) => a.length;
console.log(`cases ${uniq.length} from ${files.length} files`);
console.log(`truck good  : guard accepts ${n(grid.good.accept)}   guard refuses ${n(grid.good.refuse)}   (conservative)`);
console.log(`truck WRONG : guard accepts ${n(grid.wrong.accept)}   guard refuses ${n(grid.wrong.refuse)}   <- accepts must be 0`);
console.log(`truck built, no oracle can say: guard accepts ${n(grid.unverified.accept)}   guard refuses ${n(grid.unverified.refuse)}   <- accepts must be 0`);
console.log(`truck n/a   : guard accepts ${n(grid['n/a'].accept)}   guard refuses ${n(grid['n/a'].refuse)}   (truck or the interpreter already refused)`);
const byCode = (a) => { const m = {}; for (const h of a) m[h.guard.code] = (m[h.guard.code] ?? 0) + 1; return JSON.stringify(m); };
console.log('wrong, refused by code   :', byCode(grid.wrong.refuse));
console.log('good, refused by code    :', byCode(grid.good.refuse));
console.log('n/a, refused by code     :', byCode(grid['n/a'].refuse));
for (const k of ['wrong', 'unverified']) if (grid[k].accept.length) { console.log(`HOLES (${k}):`); for (const h of grid[k].accept) console.log('  ', h.id, h.script ?? '', h.dv); }
if (process.argv.includes('--full')) {
  console.log('--- good but refused:'); for (const h of grid.good.refuse) console.log('  ', h.id.padEnd(34), (h.script ?? '').slice(0, 70).padEnd(70), h.guard.code);
}
console.log('sentence lint problems:', lintBad.length); for (const b of lintBad) console.log('  ', b.id, b.bad.join(','), '::', b.sentence);
console.log('distinct refusal codes:', [...sentences.keys()].join(', '));
const out = arg('json');
if (out) writeFileSync(out, JSON.stringify({ n: uniq.length, files: files.length, good_accept: n(grid.good.accept), good_refuse: grid.good.refuse.map((h) => ({ id: h.id, script: h.script, code: h.guard.code })), wrong_accept: grid.wrong.accept, unverified_accept: grid.unverified.accept, wrong_refuse: n(grid.wrong.refuse), unverified_refuse: n(grid.unverified.refuse), na_refuse: n(grid['n/a'].refuse), na_accept: n(grid['n/a'].accept), lintBad }, null, 1));
process.exitCode = grid.wrong.accept.length || grid.unverified.accept.length || lintBad.length ? 1 : 0;
