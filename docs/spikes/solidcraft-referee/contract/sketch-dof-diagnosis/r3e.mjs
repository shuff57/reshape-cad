// ROUND 3 section E: the k-id -> rule mapper when the doc contains a no-op row (engine answers {"constraint":"k9","existing":true}, allocates no id).
// OLD = round-2 rule "k<N> is the N-th constraint-creating command" (kTables). NEW = ids read from each command's own output (kTablesFromResults).
// Ground truth for "blames the right rule": the sentence for the SAME conflict without the duplicate row (the duplicate changes no rule's meaning).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> SOLIDCRAFT_REFEREE_PKG2=<pkg2> bun contract/sketch-dof-diagnosis/r3e.mjs   (writes r3e.json)
import { writeFileSync } from 'node:fs';
import * as R from './r3-lib.mjs';
import * as G from './legacy.mjs';
import { kTables, kTablesFromResults, labelSoup, plainRefusal, plainProblems } from './refusal-sentence.mjs';
const OUT = { rows: [] };
const ownFx = [...R.fixtures.OWN, ...R.fixtures.gauntletFixtures()];
const cases = [];
for (const c of G.CONFLICT) { const cons = [...c.cons, c.add]; const { geoms, rules } = G.toSoup(c.pts, cons); const n = c.pts.length; cases.push({ id: 'legacy-' + c.id, geoms, rules, ann: rules.map((_, i) => (i >= n ? cons[i - n] : null)), plane: 'xy' }); }
for (const [id, pts, cons] of [
  ['script-T-3-perpendicular-triangle', [[0, 0], [30, 0], [15, 20]], [{ kind: 'perpendicular', edge: 0, other: 1 }, { kind: 'perpendicular', edge: 1, other: 2 }, { kind: 'perpendicular', edge: 2, other: 0 }]],
  ['script-P-pin1-pin2-length100', [[0, 0], [40, 0], [40, 30], [0, 30]], [{ kind: 'lock', corner: 0 }, { kind: 'lock', corner: 1 }, { kind: 'length', edge: 0, value: 100 }]],
  ['script-X-length40-then-60', [[0, 0], [40, 0], [40, 30], [0, 30]], [{ kind: 'lock', corner: 0 }, { kind: 'length', edge: 0, value: 40 }, { kind: 'length', edge: 0, value: 60 }]],
]) { const { geoms, rules } = G.toSoup(pts, cons); const n = pts.length; cases.push({ id, geoms, rules, ann: rules.map((_, i) => (i >= n ? cons[i - n] : null)), plane: 'xy' }); }
for (const id of ['sk-conflict__width-30-vs-35', 'sk-conflict__radius-vs-diameter', 'sk-conflict__equal-vs-two-radii']) { const f = ownFx.find((x) => x.id === id); cases.push({ id, geoms: f.geoms, rules: f.rules, ann: f.rules.map(() => null), plane: f.plane }); }
// the critic's exact case: duplicate origin coincident before the lengths
{ const g = R.rect(0, 0, 40, 30); const rules = [...R.shape(), R.origin, R.origin, R.len(1, 30), R.len(2, 20), R.len(1, 35)]; cases.push({ id: 'critic: dup origin, len1=30, len2=20, len1=35', geoms: g, rules, ann: rules.map(() => null), plane: 'xy', baselineDrop: 5 }); }

function sentenceFor(c, rules, ann, method) {
  const s = R.scSketch(c.geoms, rules, { plane: c.plane, extrude: false });
  if (s.mapperRefused) return { mapperRefused: s.mapperRefused };
  if (!s.firstRefusal) return { built: true };
  const f = s.firstRefusal;
  const labelOf = (i) => (ann[i] ? R.solve.describe(ann[i]) : labelSoup(rules[i], c.geoms));
  const isStructural = (i) => rules[i].k === 'coincident' && !ann[i] && !(rules[i].b === -1 || rules[i].a === -1);
  const tabs = method === 'old' ? kTables(s.map) : kTablesFromResults(s.map, s.results);
  const sentence = plainRefusal({ raw: f.error, failedRule: f.rule, labelOf, isStructural, kToRule: tabs.kToRule });
  return { raw: f.error, sentence, problems: plainProblems(sentence) };
}
let oldWrong = 0, newWrong = 0, tested = 0, newPlain = 0, newResolved = 0, resolvedTotal = 0;
for (const c of cases) {
  const base = sentenceFor(c, c.rules, c.ann, 'new');
  const variants = [['as-written', c.rules, c.ann]];
  if (!c.id.startsWith('critic')) { const r2 = [c.rules[0], ...c.rules]; const a2 = [c.ann[0], ...c.ann]; variants.push(['dup of the first join row inserted', r2, a2]); }
  for (const [vn, rules, ann] of variants) {
    const o = sentenceFor(c, rules, ann, 'old'); const n = sentenceFor(c, rules, ann, 'new');
    if (!o.sentence) { OUT.rows.push({ id: c.id, variant: vn, note: o.mapperRefused ? 'mapper refused' : 'no refusal' }); continue; }
    tested++;
    const ref = vn === 'as-written' && !c.id.startsWith('critic') ? n.sentence : base.sentence;
    const row = { id: c.id, variant: vn, raw: o.raw, old: o.sentence, new: n.sentence, baseline: ref, oldMatchesBaseline: o.sentence === ref, newMatchesBaseline: n.sentence === ref, newProblems: n.problems };
    if (!row.oldMatchesBaseline) oldWrong++; if (!row.newMatchesBaseline) newWrong++; if (n.problems.length === 0) newPlain++;
    OUT.rows.push(row); console.log(vn.padEnd(36), c.id, '\n   raw:', o.raw, '\n   old:', o.sentence, row.oldMatchesBaseline ? '' : '   <-- DIFFERS', '\n   new:', n.sentence, row.newMatchesBaseline ? '' : '   <-- DIFFERS');
  }
}
// critic's case: the true clash is with the 30 length of line 1
OUT.summary = { refusalsTested: tested, oldDiffersFromBaseline: oldWrong, newDiffersFromBaseline: newWrong, newPlainSentences: newPlain };
console.log(JSON.stringify(OUT.summary));
writeFileSync(new URL('./r3e.json', import.meta.url), JSON.stringify(OUT, null, 1));
