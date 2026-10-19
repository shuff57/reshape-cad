// ROUND 2, section C: redundancy (if_redundant), reference/inactive rules, SolveReport (redundant list), soup slider sweep.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> [SOLIDCRAFT_REFEREE_PKG2=<pkg with SolveReport>] bun contract/sketch-dof-diagnosis/r2c.mjs   (writes r2c.json)
// pkg2 = the SAME engine source (fe3717f) behind a wrapper that also returns every command's output and the evaluated sketch's SolveReport
//        (status, dof, failing, redundant). It was built by the critic of round 1 in the session scratchpad; no rebuild here. The given pkg only
//        returns the first failing command's error or the final measure. Builds/volumes below use the given pkg; report fields use pkg2.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as L from './lib.mjs';
import * as G from './legacy.mjs';
import { analyse } from './indep.mjs';

const PKG2 = process.env.SOLIDCRAFT_REFEREE_PKG2 ?? '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad/cdof/pkg2';
const sc2 = createRequire(import.meta.url)(PKG2 + '/solidcraft_referee_dofcrit.js');
const r6 = (x) => (typeof x === 'number' ? +x.toPrecision(9) : x);
const H = 10;
const brepDoc = (geoms, rules) => ({ version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, geoms: L.clone(geoms), rules: L.clone(rules) }, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }] });
const withDriven = (cmds) => cmds.map((c) => (c.command === 'sketch.dimension' ? { ...c, params: { ...c.params, if_redundant: 'driven' } } : c));
const CONSTRAINT_CMD = (c) => c.command.startsWith('sketch.constraint.') || c.command === 'sketch.dimension';
/** k-ordinal (k1, k2 ...) -> rule index, assuming one constraint per constraint command, in command order (validated below). */
export function kToRule(m) {
  const map = []; let k = 0;
  m.commands.forEach((c, ci) => { if (CONSTRAINT_CMD(c)) { k++; map[k] = m.ruleMap.findIndex((ix) => ix && ix.includes(ci)); } });
  return map;
}
function build(m, geoms, opts = {}) {
  const cmds = L.mapper.extrudeCommands(m, { height: H }).filter((c) => c.command !== '@sketch');
  const r = L.scRun(opts.driven ? withDriven(cmds) : cmds);
  if (!r.ok) return { status: 'refused', sentence: r.error, atCommand: r.command, rule: m.ruleMap.findIndex((ix) => ix && ix.includes(r.index)) };
  const b = r.measure.bodies[0];
  return { status: 'built', volume: r6(b.volume_mm3), bbox: [...b.bbox.min, ...b.bbox.max].map(r6) };
}
function report(m) {
  const cmds = L.mapper.extrudeCommands(m, { height: H });
  const r = JSON.parse(sc2.run(JSON.stringify({ commands: cmds })));
  const errs = r.results.filter((x) => !x.ok).map((x) => `${x.command}: ${x.error}`);
  const rep = r.results.find((x) => x.command === '@sketch')?.out?.report;
  return { errs, rep: rep && { status: rep.status, dof: rep.dof, failing: rep.failing, redundant: rep.redundant, max_residual: rep.max_residual } };
}
const mapOf = (geoms, rules, plane = 'xy') => L.mapper.mapSketch({ plane, geoms: L.clone(geoms), rules: L.clone(rules), id: 't' });
const OUT = {};

// ===== C1: if_redundant:'driven' on the redundant-dimension refusals, and the CONTROL that it must not hide a real conflict
const fxs = [...L.fixtures.OWN, ...L.fixtures.gauntletFixtures()];
const fx = (id) => fxs.find((f) => f.id === id);
const cases = [];
for (const id of ['sk-conflict__redundant-width', 'sk-conflict__redundant-height', 'sk-circle-arc-tangent__slot-extra-radius', 'sk-conflict__redundant-perpendicular']) cases.push({ id, kind: 'redundant', geoms: fx(id).geoms, rules: fx(id).rules, plane: fx(id).plane });
{ const c = G.REDUNDANT[0]; const s = G.toSoup(c.pts, c.cons); cases.push({ id: 'legacy-R1-opposite-length-implied', kind: 'redundant', ...s, plane: 'xy' }); }
for (const id of ['sk-conflict__width-30-vs-35', 'sk-conflict__radius-vs-diameter', 'sk-conflict__equal-vs-two-radii']) cases.push({ id, kind: 'conflicting', geoms: fx(id).geoms, rules: fx(id).rules, plane: fx(id).plane });
for (const c of G.CONFLICT.filter((x) => ['X1', 'X2', 'X3', 'X5'].some((p) => x.id.startsWith(p)))) { const s = G.toSoup(c.pts, [...c.cons, c.add]); cases.push({ id: 'legacy-' + c.id, kind: 'conflicting', ...s, plane: 'xy' }); }
OUT.c1 = cases.map((c) => {
  const m = mapOf(c.geoms, c.rules, c.plane);
  if (!m.ok) return { id: c.id, kind: c.kind, mapperRefused: m.refusals.map((r) => r.sentence) };
  const plain = build(m, c.geoms), drv = build(m, c.geoms, { driven: true });
  const bd = L.brepBuild(brepDoc(c.geoms, c.rules)); const diag = L.brepSketch(c.geoms, c.rules).diag;
  const fc = L.fcRef(c.id);
  return { id: c.id, kind: c.kind, withoutFlag: plain, withDrivenFlag: drv, brep: { bucket: diag?.bucket, outcome: bd.outcome, volume: r6(bd.volume), refusal: bd.refusal }, freecad: fc && { bucket: fc.bucket, dof: fc.dof, bbox: fc.bbox } };
});
for (const r of OUT.c1) console.log('C1', r.id, r.kind, r.withoutFlag?.status, '->', r.withDrivenFlag?.status, r.withDrivenFlag?.volume, 'brep', r.brep.bucket, r.brep.outcome, r.brep.volume, 'fc', r.freecad?.bucket);

// ===== C2: the engine's own redundant list (pkg2 SolveReport) for non-dimension duplicates / implied rules, vs brep-rs and the independent rank
const L_ = (id, a, b, x = {}) => ({ k: 'line', id, a, b, ...x });
const rect = (w, h) => [L_(1, [0, 0], [w, 0]), L_(2, [w, 0], [w, h]), L_(3, [w, h], [0, h]), L_(4, [0, h], [0, 0])];
const join = (i, j) => ({ k: 'coincident', a: i, aEnd: 'b', b: j, bEnd: 'a' });
const loop = Array.from({ length: 4 }, (_, i) => join(i + 1, ((i + 1) % 4) + 1));
const hv = [{ k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
const org = { k: 'coincident', a: 1, aEnd: 'a', b: -1, bEnd: 'a' };
const len = (i, v) => ({ k: 'distance', a: i, aEnd: 'a', b: i, bEnd: 'b', value: v });
const base = [...loop, ...hv, org, len(1, 40), len(2, 30)];
const C2 = [
  { id: 'R-perpendicular-implied-by-hv', add: [{ k: 'perpendicular', a: 1, b: 2 }] },
  { id: 'R-horizontal-twice', add: [{ k: 'horizontal', a: 1 }] },
  { id: 'R-vertical-twice', add: [{ k: 'vertical', a: 2 }] },
  { id: 'R-parallel-implied', add: [{ k: 'parallel', a: 1, b: 3 }] },
  { id: 'R-equal-implied-by-lengths', add: [{ k: 'equal', a: 1, b: 3 }] },
  { id: 'R-equal-twice', add: [{ k: 'equal', a: 1, b: 3 }, { k: 'equal', a: 1, b: 3 }] },
  { id: 'R-duplicate-coincident', add: [join(1, 2)] },
  { id: 'R-origin-coincident-twice', add: [org] },
  { id: 'R-lock-then-origin-coincident', add: [{ k: 'lock', a: 1, aEnd: 'a' }] },
];
OUT.c2 = C2.map((c) => {
  const rules = [...base, ...c.add]; const geoms = rect(40, 30);
  const m = mapOf(geoms, rules); const rp = report(m); const kmap = kToRule(m);
  const b = L.brepSketch(geoms, rules); const ind = analyse(geoms, rules);
  const scRedundantRules = (rp.rep?.redundant ?? []).map((k) => ({ k, rule: kmap[Number(String(k).replace(/^k/, ''))] }));
  const out = { id: c.id, sc: { errs: rp.errs, status: rp.rep?.status, dof: rp.rep?.dof, redundantIds: rp.rep?.redundant, redundantRuleIdx: scRedundantRules.map((x) => x.rule), addedRuleIdx: c.add.map((_, i) => base.length + i) }, brep: { bucket: b.diag?.bucket, dof: b.diag?.dof, open: b.open ?? null }, indep: { consistent: ind.consistent, dependentRows: ind.dependentRows, dof: ind.dof } };
  console.log('C2', JSON.stringify(out));
  return out;
});

// ===== C3: reference (driving:false) and inactive (active:false) rules: dof stays, conflicts skipped
const C3 = [
  { id: 'ref-length-on-D3(dof2)', rules: [...loop, ...hv, org, { ...len(1, 40), driving: false }], expectDof: 2 },
  { id: 'driving-length-on-D3(dof1)', rules: [...loop, ...hv, org, len(1, 40)], expectDof: 1 },
  { id: 'ref-length-that-DISAGREES-with-drawn(40 vs 55)', rules: [...loop, ...hv, org, { ...len(1, 55), driving: false }], expectDof: 2 },
  { id: 'inactive-conflicting-length', rules: [...loop, ...hv, org, len(1, 40), { ...len(1, 50), active: false }], expectDof: 1 },
  { id: 'active-conflicting-length(control)', rules: [...loop, ...hv, org, len(1, 40), len(1, 50)], expectDof: 'conflict' },
  { id: 'inactive-perpendicular-and-parallel-conflict', rules: [...loop, ...hv, org, { k: 'parallel', a: 1, b: 2, active: false }], expectDof: 2 },
];
OUT.c3 = C3.map((c) => {
  const geoms = rect(40, 30); const m = mapOf(geoms, c.rules); const o = { id: c.id, expectDof: c.expectDof };
  if (!m.ok) return { ...o, mapperRefused: m.refusals.map((r) => r.sentence) };
  const rp = report(m); const b = L.brepSketch(geoms, c.rules); const ind = analyse(geoms, c.rules);
  const bld = build(m, geoms);
  const bb = L.brepBuild(brepDoc(geoms, c.rules));
  const indNoRef = analyse(geoms, c.rules.filter((r) => r.driving !== false));
  Object.assign(o, { sc: { errs: rp.errs, status: rp.rep?.status, dof: rp.rep?.dof, failing: rp.rep?.failing, redundant: rp.rep?.redundant }, scBuild: bld, brep: { bucket: b.diag?.bucket, dof: b.diag?.dof }, brepBuild: bb.outcome === 'built' ? r6(bb.volume) : bb.refusal, indep: { consistent: ind.consistent, dof: ind.dof, dofIfReferenceRowsAreDropped: indNoRef.dof }, notes: m.notes });
  console.log('C3', JSON.stringify(o));
  return o;
});

// ===== C4: soup slider sweep (the soup route has NO TS gate: the rule value is a SolidCraft dimension)
OUT.c4 = [];
{
  const geoms = rect(40, 30);
  const rulesFor = (v) => [...loop, ...hv, org, len(1, v), len(2, 30)];
  let prev = null; const rows = [];
  for (const v of [40, 30, 20, 12, 10.5, 10, 9.9, 8, 5, 2, 1]) {
    const rules = rulesFor(v); const m = mapOf(geoms, rules);
    const s = build(m, geoms);
    const b = L.brepBuild(brepDoc(geoms, rules));
    rows.push({ v, closed: v * 30 * H, sc: s.status === 'built' ? s.volume : s.sentence, scRel: s.status === 'built' ? r6(Math.abs(s.volume - v * 30 * H) / (v * 30 * H)) : null, brep: b.outcome === 'built' ? r6(b.volume) : b.refusal });
  }
  OUT.c4 = rows; for (const r of rows) console.log('C4', JSON.stringify(r));
}
writeFileSync(new URL('./r2c.json', import.meta.url), JSON.stringify(OUT, null, 1));
