// SPIKE, referee only (round 4). Scores a guard against recorded UNGUARDED kernel runs, offline: the kernel truth (good / wrong) is in the file, the guard is applied now.
//   bun fuzz-score.mjs <results.json>... [--guard=../primitives.guard.mjs] [--holes] [--json=out.json]
// good = built and inside the bars against the independent oracle (OCCT, closed form when OCCT refuses); wrong = built and outside them; n/a = refused by truck/interpreter.
// A HOLE is wrong & accepted. Also printed: wrong sorted by the rule that refuses it (what each rule earns), good & refused (the cost), and the acceptance rate.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const opt = (k, d = '') => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const G = await import(pathToFileURL(path.resolve(opt('guard', path.join(import.meta.dir, '..', 'primitives.guard.mjs')))).href);
export function outcome(r) {
  const t = r.truck;
  if (r.status !== 'built' || !t) return 'n/a';
  const planar = !t.curved;
  const volBar = planar ? 1e-9 : 3e-4; const bboxBar = planar ? 1e-6 : 1e-4; const comBar = planar ? 1e-6 : 1e-4;
  const dv = t.dVolOcct ?? t.dVolAn;
  if (dv === undefined) return 'unverified';
  if (!(dv <= volBar)) return 'wrong';
  if (t.dBboxOcct !== undefined && !(t.dBboxOcct <= bboxBar)) return 'wrong';
  if (t.dComOcct !== undefined && !(t.dComOcct <= comBar)) return 'wrong';
  if (t.facesOcct !== undefined && t.facesOcct !== t.faces) return 'wrong';
  if (t.bodies !== undefined && t.bodies !== 1) return 'wrong';
  return 'good';
}
const rows = [];
for (const f of files) for (const r of JSON.parse(readFileSync(f, 'utf8'))) if (r.doc && r.id) rows.push({ ...r, _file: path.basename(f) });
const grid = { good: [[], []], wrong: [[], []], unverified: [[], []], 'n/a': [[], []] };
const refusedBy = { wrong: {}, good: {}, 'n/a': {} };
for (const r of rows) {
  const o = outcome(r); const g = G.guardFirst(r.doc);
  grid[o][g ? 1 : 0].push({ id: r.id, why: r.why, g, dv: r.truck?.dVolOcct ?? r.truck?.dVolAn, doc: r.doc });
  if (g && refusedBy[o]) refusedBy[o][g.code] = (refusedBy[o][g.code] ?? 0) + 1;
}
const n = (a) => a.length;
const total = rows.length;
console.log(`cases ${total} from ${files.length} file(s)`);
console.log(`truck good  : accepted ${n(grid.good[0])}  refused ${n(grid.good[1])}`);
console.log(`truck WRONG : accepted ${n(grid.wrong[0])}  refused ${n(grid.wrong[1])}   <- accepted = holes`);
console.log(`truck built, no oracle : accepted ${n(grid.unverified[0])}  refused ${n(grid.unverified[1])}`);
console.log(`truck n/a   : accepted ${n(grid['n/a'][0])}  refused ${n(grid['n/a'][1])}`);
console.log('wrong refused by rule :', JSON.stringify(refusedBy.wrong));
console.log('good refused by rule  :', JSON.stringify(refusedBy.good));
const bad = [];
for (const k of ['wrong', 'unverified']) for (const h of grid[k][0]) { bad.push(h); if (process.argv.includes('--holes')) console.log('HOLE', k, h.id, h.why, h.dv, JSON.stringify(h.doc.features[0])); }
if (!process.argv.includes('--holes') && bad.length) console.log('(run with --holes to list)', bad.slice(0, 5).map((h) => h.id).join(' '));
const sentenceBad = [];
for (const k of Object.keys(grid)) for (const h of grid[k][1]) { const p = G.sentenceProblems(h.g.sentence); if (p.length) sentenceBad.push({ id: h.id, p, s: h.g.sentence }); }
console.log('sentence lint problems:', sentenceBad.length, sentenceBad.slice(0, 3).map((b) => b.id + ':' + b.p.join(',')).join(' '));
const out = opt('json');
if (out) writeFileSync(out, JSON.stringify({ total, good_acc: n(grid.good[0]), good_ref: n(grid.good[1]), wrong_acc: n(grid.wrong[0]), wrong_ref: n(grid.wrong[1]), unv_acc: n(grid.unverified[0]), unv_ref: n(grid.unverified[1]), na_acc: n(grid['n/a'][0]), na_ref: n(grid['n/a'][1]), refusedBy, holes: bad.map((h) => ({ id: h.id, why: h.why, dv: h.dv, f: h.doc.features[0] })) }, null, 1));
process.exitCode = bad.length ? 1 : 0;
