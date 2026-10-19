// ROUND 2, section E: the plain-sentence mapper (refusal-sentence.mjs) applied to every refusal SolidCraft gave in this group.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/sketch-dof-diagnosis/r2e.mjs   (writes r2e.json)
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
import * as G from './legacy.mjs';
import { kTables, labelSoup, plainRefusal, plainProblems } from './refusal-sentence.mjs';
const H = 10;
const OUT = { rows: [] };
function one(id, geoms, rules, labelOf, isStructural, plane = 'xy') {
  const m = L.mapper.mapSketch({ plane, geoms: L.clone(geoms), rules: L.clone(rules), id: 't' });
  if (!m.ok) return OUT.rows.push({ id, mapperRefused: m.refusals.map((r) => r.sentence) });
  const cmds = L.mapper.extrudeCommands(m, { height: H }).filter((c) => c.command !== '@sketch');
  const r = L.scRun(cmds);
  if (r.ok) return OUT.rows.push({ id, built: true });
  const failedRule = m.ruleMap.findIndex((ix) => ix && ix.includes(r.index));
  const { kToRule, ordOf } = kTables(m);
  const ks = [...r.error.matchAll(/\bk(\d+)\b/g)].map((x) => Number(x[1]));
  const failedOrd = ordOf.get(r.index);
  const sentence = plainRefusal({ raw: r.error, failedRule, labelOf, isStructural, kToRule });
  const row = { id, raw: r.error, failedRule, failedOrdinal: failedOrd, maxKInError: ks.length ? Math.max(...ks) : null, numberingHolds: ks.length && /over-constrain/.test(r.error) ? Math.max(...ks) === failedOrd : null, resolvedAllIds: ks.every((n) => kToRule[n] !== undefined && kToRule[n] >= 0), sentence, problems: plainProblems(sentence) };
  OUT.rows.push(row);
}
// legacy conflicts X1..X6: labels are the script's own words (describe), edge numbers 1-based as the student wrote them
for (const c of G.CONFLICT) {
  const cons = [...c.cons, c.add]; const { geoms, rules } = G.toSoup(c.pts, cons); const n = c.pts.length;
  const lab = (i) => (i - n >= 0 && cons[i - n] ? L.solve.describe(cons[i - n]) : labelSoup(rules[i], geoms));
  one('legacy-' + c.id, geoms, rules, lab, (i) => rules[i].k === 'coincident');
}
// script cases T, P, X (round-2 section A) through the same mapper
for (const [id, pts, cons] of [
  ['script-T-3-perpendicular-triangle', [[0, 0], [30, 0], [15, 20]], [{ kind: 'perpendicular', edge: 0, other: 1 }, { kind: 'perpendicular', edge: 1, other: 2 }, { kind: 'perpendicular', edge: 2, other: 0 }]],
  ['script-P-pin1-pin2-length100', [[0, 0], [40, 0], [40, 30], [0, 30]], [{ kind: 'lock', corner: 0 }, { kind: 'lock', corner: 1 }, { kind: 'length', edge: 0, value: 100 }]],
  ['script-X-length40-then-60', [[0, 0], [40, 0], [40, 30], [0, 30]], [{ kind: 'lock', corner: 0 }, { kind: 'length', edge: 0, value: 40 }, { kind: 'length', edge: 0, value: 60 }]],
]) { const { geoms, rules } = G.toSoup(pts, cons); const n = pts.length; one(id, geoms, rules, (i) => (i - n >= 0 ? L.solve.describe(cons[i - n]) : labelSoup(rules[i], geoms)), (i) => rules[i].k === 'coincident'); }
// FreeCAD-gauntlet conflicting variants (soup rows, no legacy text): labels from the soup rule
for (const id of ['sk-conflict__width-30-vs-35', 'sk-conflict__radius-vs-diameter', 'sk-conflict__equal-vs-two-radii']) {
  const f = [...L.fixtures.OWN, ...L.fixtures.gauntletFixtures()].find((x) => x.id === id);
  one(id, f.geoms, f.rules, (i) => labelSoup(f.rules[i], f.geoms), (i) => f.rules[i].k === 'coincident', f.plane);
}
// redundant dimensions, flag NOT set (what the phase0 rig does today)
for (const id of ['sk-conflict__redundant-width', 'sk-conflict__redundant-height', 'sk-circle-arc-tangent__slot-extra-radius']) {
  const f = [...L.fixtures.OWN, ...L.fixtures.gauntletFixtures()].find((x) => x.id === id);
  one(id + '(no if_redundant flag)', f.geoms, f.rules, (i) => labelSoup(f.rules[i], f.geoms), (i) => f.rules[i].k === 'coincident', f.plane);
}
{ const c = G.REDUNDANT[0]; const { geoms, rules } = G.toSoup(c.pts, c.cons); const n = c.pts.length; one('legacy-R1(no if_redundant flag)', geoms, rules, (i) => (i - n >= 0 ? L.solve.describe(c.cons[i - n]) : labelSoup(rules[i], geoms)), (i) => rules[i].k === 'coincident'); }
for (const r of OUT.rows) console.log(r.id, '|', r.raw ?? r.built ?? r.mapperRefused, '\n   ->', r.sentence, r.problems?.length ? 'PROBLEMS ' + r.problems : '', 'ordinal', r.failedOrdinal, r.maxKInError, r.numberingHolds, r.resolvedAllIds);
const withIds = OUT.rows.filter((r) => r.numberingHolds !== null && r.numberingHolds !== undefined);
OUT.summary = { total: OUT.rows.length, refused: OUT.rows.filter((r) => r.sentence).length, plain: OUT.rows.filter((r) => r.sentence && r.problems.length === 0).length, numberingHolds: `${withIds.filter((r) => r.numberingHolds).length}/${withIds.length}`, allIdsResolved: OUT.rows.filter((r) => r.resolvedAllIds).length };
console.log(JSON.stringify(OUT.summary));
writeFileSync(new URL('./r2e.json', import.meta.url), JSON.stringify(OUT, null, 1));
