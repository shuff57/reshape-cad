// Group 'sketch-dof-diagnosis': measurement run. Writes results.json next to this file.
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> bun contract/sketch-dof-diagnosis/run.mjs
// Everything printed is a number or sentence measured in this run; rows.mjs turns results.json into the contract rows.
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
import * as G from './legacy.mjs';
import { analyse } from './indep.mjs';
import { dofProbe, roughen } from './probe.mjs';

const OUT = {};
const log = (...a) => console.log(...a);
const e2 = (x) => (typeof x === 'number' ? +x.toExponential(3) : x);
const r4 = (x) => (typeof x === 'number' ? +x.toFixed(6) : Array.isArray(x) ? x.map(r4) : x);
const brepDoc = (geoms, rules) => ({ version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, geoms: L.clone(geoms), rules: L.clone(rules) }, { id: 'e1', kind: 'extrude', target: 'sk1', height: G.H }] });
function scBuild(geoms, rules, extra = {}) {
  const m = L.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
  if (!m.ok) return { status: 'mapper-refused', sentences: m.refusals.map((r) => r.sentence) };
  const r = L.scRun([...m.commands, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: G.H, sketch: m.sketchName, operation: 'new', body_name: 'B', ...extra } }]);
  if (!r.ok) { const rule = m.ruleMap.findIndex((ix) => ix && ix.includes(r.index)); return { status: 'refused', rule, ruleKind: rules[rule]?.k, command: r.command, sentence: r.error }; }
  const b = r.measure.bodies[0];
  return { status: 'built', volume: b.volume_mm3, area: b.volume_mm3 / G.H, faces: b.faces, nbodies: r.measure.body_count, bbox: [...b.bbox.min, ...b.bbox.max], com: b.center_of_mass };
}
const bboxOf = (p) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
const dmax = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

// ===================================================== S1: soup fixtures: DoF / conflict / redundancy, 4 oracles ====
{
  const fxs = [...L.fixtures.OWN, ...L.fixtures.gauntletFixtures()];
  const rows = [];
  for (const f of fxs) {
    const a = analyse(f.geoms, f.rules); const b = L.brepSketch(f.geoms, f.rules); const fc = L.fcRef(f.id);
    const row = { id: f.id, group: f.group, fc: fc && { dof: fc.dof, bucket: fc.bucket }, indep: a.unsupported ? { unsupported: a.unsupported } : { dof: a.dof, consistent: a.consistent, dependentRows: a.dependentRows },
      brep: b.open ? { openRefused: b.open } : b.diag ? { dof: b.diag.dof, bucket: b.diag.bucket, blame: b.diag.blame } : { solveRefused: b.lastError }, modes: {} };
    for (const mode of ['stored', 'rough']) {
      const geoms = mode === 'rough' ? roughen(f) : f.geoms;
      const m = L.mapper.mapSketch({ plane: f.plane, geoms, rules: f.rules, id: 't' });
      if (!m.ok) { row.modes[mode] = { status: 'mapper-refused', sentences: m.refusals.map((r) => r.sentence) }; continue; }
      const r = L.scRun(m.commands);
      if (!r.ok) {
        const rule = m.ruleMap.findIndex((ix) => ix && ix.includes(r.index));
        row.modes[mode] = { status: 'refused-at-command', command: r.command, rule, ruleKind: f.rules[rule]?.k, sentence: r.error };
      } else {
        const solved = a.unsupported || !a.consistent ? geoms : a.solved;
        const p = dofProbe(m, solved);
        row.modes[mode] = { status: 'accepted', probeDof: p.dof, refused: p.refused.reduce((o, x) => ((o[x.kind] = (o[x.kind] ?? 0) + 1), o), {}), anomalies: p.anomalies, sampleSentence: p.refused.find((x) => x.kind === 'redundant')?.sentence };
      }
    }
    rows.push(row);
  }
  OUT.s1 = rows;
  log('S1 fixtures', rows.length);
}

// ===================================================== S2: legacy determined cases ====
const SCRIPTS = {
  'D1-rect-lengths-lock': "const sk1 = sketch('top'); sk1.polygon([[0,0],[38,2],[39,23],[1,21]]); sk1.pin(1); sk1.across(1); sk1.up(2); sk1.across(3); sk1.up(4); sk1.length(1,40); sk1.length(2,25); pull(sk1, 10)",
  'D2-square-by-equal': "const sk1 = sketch('top'); sk1.polygon([[0,0],[21,1],[22,23],[1,21]]); sk1.pin(1); sk1.across(1); sk1.up(2); sk1.across(3); sk1.up(4); sk1.length(1,22); sk1.equal(1,2); pull(sk1, 10)",
  'D3-right-trapezoid-parallel-perpendicular-distX': "const sk1 = sketch('top'); sk1.polygon([[0,0],[30,1],[22,16],[1,15]]); sk1.pin(1); sk1.across(1); sk1.length(1,30); sk1.perpendicular(1,4); sk1.parallel(1,3); sk1.length(4,16); sk1.distX(2,3,-8); pull(sk1, 10)",
  'D4-rect-diagonal-distX-distY': "const sk1 = sketch('top'); sk1.polygon([[0,0],[38,2],[39,23],[1,21]]); sk1.pin(1); sk1.across(1); sk1.up(2); sk1.across(3); sk1.up(4); sk1.distX(1,3,30); sk1.distY(1,3,20); pull(sk1, 10)",
  'D5-pentagon-symmetric-centre': "const sk1 = sketch('top'); sk1.polygon([[0,0],[10,1],[11,8],[1,9],[5,4]]); sk1.pin(1); sk1.across(1); sk1.length(1,10); sk1.up(2); sk1.length(2,8); sk1.across(3); sk1.length(3,10); sk1.symmetric(1,3,5); pull(sk1, 10)",
  'D6-triangle-angle-120': "const sk1 = sketch('top'); sk1.polygon([[0,0],[30,1],[18,20]]); sk1.pin(1); sk1.across(1); sk1.length(1,30); sk1.angle(1,2,120); sk1.length(2,20); pull(sk1, 10)",
  'D7-parallelogram': "const sk1 = sketch('top'); sk1.polygon([[0,0],[30,1],[40,16],[11,15]]); sk1.pin(1); sk1.across(1); sk1.length(1,30); sk1.parallel(1,3); sk1.parallel(2,4); sk1.distX(2,3,10); sk1.distY(2,3,15); pull(sk1, 10)",
};
{
  const rows = [];
  for (const c of G.DETERMINED) {
    const ts = L.solve.solveSketch(c.pts, c.cons);
    const { geoms, rules } = G.toSoup(c.pts, c.cons);
    const ind = analyse(geoms, rules); const br = L.brepSketch(geoms, rules);
    const brPoly = br.geoms ? br.geoms.slice(0, c.pts.length).map((g) => g.a) : null;
    // independent residual of TS's polygon: rebuild soup rows with TS points as the geometry, evaluate with the independent checker (lock vs the ORIGINAL start)
    const tsGeoms = geoms.map((g, i) => (g.k === 'line' ? { ...g, a: ts.points[i], b: ts.points[(i + 1) % ts.points.length] } : g));
    const chk = L.ruleCheck.checkRules(tsGeoms, rules, geoms);
    const worst = chk.reduce((w, r) => (r.residual !== null && r.residual > w.residual ? r : w), { residual: 0 });
    const sc = scBuild(geoms, rules);
    const area = G.polyArea(c.want), cen = G.polyCentroid(c.want), bb = bboxOf(c.want);
    const row = { id: c.id, kinds: c.kinds, ts: { iterations: ts.iterations, residual: e2(ts.residual), overConstrained: ts.overConstrained, maxDevVsClosedForm: e2(dmax(ts.points, c.want)) },
      tsPointsSatisfyIndependentCheck: { worstRule: worst.kind ?? null, worstResidual: e2(worst.residual), unit: worst.unit },
      indep: { dof: ind.dof, consistent: ind.consistent, maxDev: e2(dmax(ind.solved.slice(0, c.pts.length).map((g) => g.a), c.want)) },
      brep: { dof: br.diag?.dof, bucket: br.diag?.bucket, maxDev: brPoly ? e2(dmax(brPoly, c.want)) : null },
      sc: sc.status === 'built' ? { status: 'built', volRel: e2(L.rel(sc.volume, area * G.H)), bboxDev: e2(Math.max(Math.abs(sc.bbox[0] - bb[0]), Math.abs(sc.bbox[1] - bb[1]), Math.abs(sc.bbox[3] - bb[2]), Math.abs(sc.bbox[4] - bb[3]))), comDev: e2(Math.hypot(sc.com[0] - cen[0], sc.com[1] - cen[1])), faces: sc.faces, bodies: sc.nbodies } : sc };
    // real script through the translator + 3 kernels on the TS-solved doc
    const P = L.pipeline(SCRIPTS[c.id]);
    row.pipeline = P.scriptErrors ? { scriptErrors: P.scriptErrors } : { warnings: P.warnings, solvedPoints: r4(P.doc.features[0].points), occt: { v: P.occt.volume, faces: P.occt.faces }, brep: { v: P.brep.volume, faces: P.brep.faces }, sc: P.sc.outcome === 'built' ? { v: P.sc.volume, faces: P.sc.faces } : P.sc, facesEqual: P.occt.faces === P.brep.faces && P.brep.faces === P.sc.faces,
      dVolSCvsOCCT: P.sc.volume !== undefined ? e2(L.rel(P.sc.volume, P.occt.volume)) : null, dVolBrepVsOCCT: P.brep.volume !== undefined ? e2(L.rel(P.brep.volume, P.occt.volume)) : null, dVolOCCTvsClosedForm: e2(L.rel(P.occt.volume, area * G.H)),
      dBboxSCvsOCCT: P.sc.bbox ? e2(Math.max(...P.sc.bbox.map((v, i) => Math.abs(v - P.occt.bbox[i])))) : null, dComSCvsOCCT: P.sc.com ? e2(Math.max(...P.sc.com.map((v, i) => Math.abs(v - P.occt.com[i])))) : null };
    rows.push(row);
  }
  OUT.s2 = rows; log('S2 done');
}

// ===================================================== S3: under-determined ====
{
  OUT.s3 = G.UNDER.map((c) => {
    const ts = L.solve.solveSketch(c.pts, c.cons); const { geoms, rules } = G.toSoup(c.pts, c.cons);
    const ind = analyse(geoms, rules); const br = L.brepSketch(geoms, rules); const sc = scBuild(geoms, rules);
    const bpoly = br.geoms.slice(0, 4).map((g) => g.a);
    return { id: c.id, expectDof: c.dof, tsOver: ts.overConstrained, tsResidual: e2(ts.residual), tsIterations: ts.iterations, tsArea: r4(G.polyArea(ts.points)), brepArea: r4(G.polyArea(bpoly)), scArea: sc.area && r4(sc.area), indepDof: ind.dof, brepDof: br.diag.dof,
      invariantsHold: { ts: Math.max(...L.ruleCheck.checkRules(geoms.map((g, i) => ({ ...g, a: ts.points[i], b: ts.points[(i + 1) % 4] })), rules, geoms).map((r) => r.residual ?? 0)) < 1e-6 } };
  });
  log('S3 done');
}

// ===================================================== S4: conflicts ====
const edgesOfRule = (rule, n) => { const E = (e) => ((e % n) + n) % n; if (rule.k === 'horizontal' || rule.k === 'vertical') return [E(rule.a - 1)]; if (rule.k === 'distance' && rule.a === rule.b) return [E(rule.a - 1)]; if (['equal', 'parallel', 'perpendicular', 'angle'].includes(rule.k)) return [E(rule.a - 1), E(rule.b - 1)]; return []; };
{
  const rows = [];
  for (const c of G.CONFLICT) {
    const next = [...c.cons, c.add]; const n = c.pts.length; const { geoms, rules } = G.toSoup(c.pts, next);
    const ts = L.solve.solveSketch(c.pts, next); const los = L.solve.losingEdges(ts.points, next);
    const settle = L.solve.addConstraintSettling(c.pts, next);
    const ind = analyse(geoms, rules); const br = L.brepSketch(geoms, rules); const bb = L.brepBuild(brepDoc(geoms, rules));
    // SC: refusal, and what a consumer that IGNORES the refusal would build
    const m = L.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
    const fin = [{ command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: G.H, sketch: m.sketchName, operation: 'new', body_name: 'B' } }];
    const r = L.scRun([...m.commands, ...fin]); const row = { id: c.id, added: c.add, ts: { overConstrained: ts.overConstrained, residual: e2(ts.residual), iterations: ts.iterations, losingEdges: los, collapsed: L.solve.collapsedByRatio(c.pts, ts.points) },
      settle: { removed: settle.removed, removedAlso: settle.removedAlso, note: settle.removed ? (settle.removedAlso ? L.solve.describeRemovalNotePair(settle.removed, settle.removedAlso, c.add) : L.solve.describeRemovalNote(settle.removed, c.add)) : null },
      indep: { consistent: ind.consistent, minimaxResidual: e2(ind.maxRes), dependentRows: ind.dependentRows }, brep: { bucket: br.diag?.bucket, blame: br.diag?.blame, build: bb.outcome, refusal: bb.refusal ?? null },
      blamedEdges: [...new Set((br.diag?.blame ?? []).flatMap((i) => edgesOfRule(rules[i] ?? {}, n)))].sort() };
    row.blamedEdgesCoveredByLosingEdges = row.blamedEdges.every((e) => los.includes(e));
    if (!r.ok) {
      const rule = m.ruleMap.findIndex((ix) => ix && ix.includes(r.index)); row.sc = { status: 'refused', atRule: rule, ruleKind: rules[rule]?.k, command: r.command, sentence: r.error };
      const cmds = [...m.commands, ...fin]; cmds.splice(r.index, 1); const r2 = L.scRun(cmds);
      row.sc.ifRefusalIgnored = r2.ok ? { volume: e2(r2.measure.total.volume_mm3), bbox: r4([...r2.measure.bodies[0].bbox.min, ...r2.measure.bodies[0].bbox.max]) } : { error: r2.error };
    } else row.sc = { status: 'built', volume: r.measure.total.volume_mm3 };
    // settled set: build it from TS's own solved polygon as the START state (what solveDoc stores), on all engines
    const tsSettled = L.solve.solveSketch(c.pts, settle.constraints);
    const startPts = tsSettled.points;
    const s2 = G.toSoup(startPts, settle.constraints); const i2 = analyse(s2.geoms, s2.rules); const b2 = L.brepSketch(s2.geoms, s2.rules); const sc2 = scBuild(s2.geoms, s2.rules);
    const b2b = L.brepBuild(brepDoc(s2.geoms, s2.rules));
    row.settledSet = { tsOver: tsSettled.overConstrained, tsResidual: e2(tsSettled.residual), tsArea: r4(G.polyArea(tsSettled.points)), indepConsistent: i2.consistent, indepDof: i2.dof, brepBucket: b2.diag?.bucket, brepDof: b2.diag?.dof, brepArea: b2b.volume && r4(b2b.volume / G.H), scStatus: sc2.status, scArea: sc2.area && r4(sc2.area), scSentence: sc2.sentence ?? null,
      scVsTsRel: sc2.area ? e2(L.rel(sc2.area, G.polyArea(tsSettled.points))) : null };
    rows.push(row);
  }
  OUT.s4 = rows; log('S4 done');
}

// ===================================================== S5: redundancy ====
{
  const rows = [];
  for (const c of G.REDUNDANT) {
    const { geoms, rules } = G.toSoup(c.pts, c.cons); const ts = L.solve.solveSketch(c.pts, c.cons);
    const ind = analyse(geoms, rules); const br = L.brepSketch(geoms, rules); const bb = L.brepBuild(brepDoc(geoms, rules)); const sc = scBuild(geoms, rules);
    const row = { id: c.id, ts: { over: ts.overConstrained, residual: e2(ts.residual), iterations: ts.iterations, losingEdges: L.solve.losingEdges(ts.points, c.cons) }, indep: { consistent: ind.consistent, dependentRows: ind.dependentRows }, brep: { bucket: br.diag.bucket, blame: br.diag.blame, build: bb.outcome, volume: bb.volume && e2(bb.volume) }, sc };
    // for a redundant NON-dimension constraint, ask solidcraft to say so (if_redundant: refuse)
    const m = L.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
    const last = m.commands.length - 1;
    if (!/dimension/.test(m.commands[last].command)) {
      const cmds = L.clone(m.commands); cmds[last].params.if_redundant = 'refuse';
      const r = L.scRun(cmds); row.scRefuseProbe = r.ok ? 'accepted (not redundant)' : r.error;
    }
    rows.push(row);
  }
  OUT.s5 = rows; log('S5 done');
}

// ===================================================== S6: collapse ====
{
  const cases = [
    { id: 'M3-up-on-horizontal-edge-of-rect', pts: [[0, 0], [40, 0], [40, 25], [0, 25]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }, { kind: 'vertical', edge: 0 }] },
    { id: 'M3b-h-and-v-on-one-edge-of-skew-quad', pts: [[0, 0], [40, 3], [41, 25], [1, 24]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }] },
    { id: 'M3c-h-and-v-on-one-edge-of-hexagon', pts: [[0, 0], [20, -3], [40, 0], [40, 20], [20, 25], [0, 20]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }] },
    { id: 'S09-trapezoid-add-parallel', pts: [[0, 0], [40, 0], [30, 20], [5, 25]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'parallel', edge: 0, other: 2 }] },
  ];
  OUT.s6 = cases.map((c) => {
    const { geoms, rules } = G.toSoup(c.pts, c.cons);
    const raw = L.solve.solveSketch(c.pts, c.cons); const settle = L.solve.addConstraintSettling(c.pts, c.cons);
    const adopted = L.modelCodegen.solveDoc({ version: 1, features: [{ id: 's', kind: 'sketch', plane: 'xy', offset: 0, points: c.pts, constraints: c.cons }] }).features[0].points;
    const ind = analyse(geoms, rules); const br = L.brepSketch(geoms, rules); const bb = L.brepBuild(brepDoc(geoms, rules)); const sc = scBuild(geoms, rules);
    return { id: c.id, startArea: r4(G.polyArea(c.pts)), tsSeededArea: r4(G.polyArea(L.solve.solveSketch(L.solve.seedForNewRule(c.pts, c.cons), c.cons).points)), tsRawArea: r4(G.polyArea(raw.points)), tsCollapsed: L.solve.collapsedByRatio(c.pts, raw.points), tsRawOver: raw.overConstrained, tsAdoptedUnchanged: JSON.stringify(adopted) === JSON.stringify(c.pts), tsSettleRemoved: settle.removed,
      indep: { consistent: ind.consistent, dof: ind.dof }, brep: { bucket: br.diag?.bucket, build: bb.outcome, refusal: bb.refusal ?? null, volume: bb.volume && e2(bb.volume) }, sc: sc.status === 'built' ? { status: 'built', area: r4(sc.area), faces: sc.faces } : sc };
  });
  // function sweep vs independent formula
  const rnd = (() => { let a = 99; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const edgeLen = (p, i) => Math.hypot(p[(i + 1) % p.length][0] - p[i][0], p[(i + 1) % p.length][1] - p[i][1]);
  const indepCollapsed = (b, a) => { for (let i = 0; i < b.length; i++) { const lb = edgeLen(b, i); if (lb < 1e-9) continue; if (edgeLen(a, i) < 0.25 * lb) return true; } const A0 = G.polyArea(b); if (A0 < 1e-9) return false; return G.polyArea(a) < 0.25 * A0; };
  let agree = 0, total = 0, trues = 0;
  for (let k = 0; k < 4000; k++) {
    const n = 3 + Math.floor(rnd() * 4);
    const before = Array.from({ length: n }, (_, i) => [30 * Math.cos((2 * Math.PI * i) / n) + rnd() * 3, 30 * Math.sin((2 * Math.PI * i) / n) + rnd() * 3]);
    const s = [0.2, 0.24, 0.2499, 0.2501, 0.26, 0.5, 1, 1.4][Math.floor(rnd() * 8)]; const j = Math.floor(rnd() * n);
    const mode = rnd() < 0.5 ? 'edge' : 'area';
    const cen = G.polyCentroid(before);
    const after = mode === 'edge'
      ? before.map((p, i) => (i === j ? [before[(j + 1) % n][0] + (p[0] - before[(j + 1) % n][0]) * s, before[(j + 1) % n][1] + (p[1] - before[(j + 1) % n][1]) * s] : p.slice()))
      : before.map((p) => [cen[0] + (p[0] - cen[0]) * Math.sqrt(s), cen[1] + (p[1] - cen[1]) * Math.sqrt(s)]);
    total++; const t = indepCollapsed(before, after); if (t) trues++; if (t === L.solve.collapsedByRatio(before, after)) agree++;
  }
  OUT.s6sweep = { total, agree, collapsedTrue: trues };
  log('S6 done', OUT.s6sweep);
}

// ===================================================== S7: idempotence ====
{
  const base = "const sk1 = sketch('top'); sk1.polygon([[0,0],[40,0],[40,25],[0,25]]);";
  const run = (src) => { const r = L.runScript(src); return { errors: r.errors?.length ? r.errors.map((e) => e.message) : [], warnings: r.warnings ?? [], constraints: r.doc.features.find((f) => f.kind === 'sketch')?.constraints }; };
  const cases = { 'across x1': 'sk1.across(1)', 'across x2': 'sk1.across(1); sk1.across(1)', 'across x3': 'sk1.across(1); sk1.across(1); sk1.across(1)', 'length 40 x2': 'sk1.length(1,40); sk1.length(1,40)', 'equal x2': 'sk1.equal(1,2); sk1.equal(1,2)', 'distX x2': 'sk1.distX(1,3,40); sk1.distX(1,3,40)', 'pin x2': 'sk1.pin(1); sk1.pin(1)', 'symmetric x2': 'sk1.symmetric(1,3,2); sk1.symmetric(1,3,2)', 'angle x2': 'sk1.angle(1,2,90); sk1.angle(1,2,90)' };
  OUT.s7 = { ts: Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, run(base + v)])) };
  const pre = [{ command: 'sketch.create', params: { name: 's', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } }, { command: 'sketch.line', params: { points: [[0, 0], [40, 3], [41, 25], [1, 24]], closed: true, ids: ['a', 'b', 'c', 'd'] } }];
  const fin = [{ command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: 10, sketch: 's', operation: 'new', body_name: 'B' } }];
  const hv = (line, mode, x = {}) => ({ command: 'sketch.constraint.horizontal_vertical', params: { line, mode, ...x } });
  const dim = (e, v, x = {}) => ({ command: 'sketch.dimension', params: { entities: [e], type: 'length', value: v, ...x } });
  const go = (mid) => { const r = L.scRun([...pre, ...mid, ...fin]); return r.ok ? { ok: true, volume: e2(r.measure.total.volume_mm3), bbox: r4([...r.measure.bodies[0].bbox.min, ...r.measure.bodies[0].bbox.max]) } : { ok: false, index: r.index, error: r.error }; };
  OUT.s7.sc = { horizontalOnce: go([hv('a', 'horizontal')]), horizontalTwice: go([hv('a', 'horizontal'), hv('a', 'horizontal')]), horizontalThrice: go([hv('a', 'horizontal'), hv('a', 'horizontal'), hv('a', 'horizontal')]),
    horizontalTwiceRefuse: go([hv('a', 'horizontal'), hv('a', 'horizontal', { if_redundant: 'refuse' })]), lengthOnce: go([dim('a', 40)]), lengthTwiceSameValue: go([dim('a', 40), dim('a', 40)]), lengthTwiceDriven: go([dim('a', 40), dim('a', 40, { if_redundant: 'driven' })]), length40then30: go([dim('a', 40), dim('a', 30)]) };
  log('S7 done');
}

// ===================================================== S8: seedForNewRule vs SC fewest movers ====
{
  const rnd = (() => { let a = 12345; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const rows = [];
  for (const kind of ['parallel', 'perpendicular', 'equal']) for (let i = 0; i < 8; i++) {
    const w = 30 + rnd() * 20, h = 15 + rnd() * 15;
    const pts = [[0, 0], [w, 0], [w - 3 - rnd() * 8, h], [3 + rnd() * 8, h + rnd() * 4]];
    const rule = kind === 'perpendicular' ? { kind, edge: 0, other: 1 } : { kind, edge: 0, other: 2 };
    const seed = L.solve.seedForNewRule(pts, [rule]); const seeded = L.solve.solveSketch(seed, [rule]); const raw = L.solve.solveSketch(pts, [rule]);
    const { geoms, rules } = G.toSoup(pts, [rule]); const sc = scBuild(geoms, rules);
    const b1 = rule.other, b2 = (rule.other + 1) % 4;
    const unchanged = [0, 1, 2, 3].filter((c) => c !== b1 && c !== b2).every((c) => seed[c][0] === pts[c][0] && seed[c][1] === pts[c][1]);
    // independent: the seed satisfies the rule exactly (parallel/perpendicular via cross/dot of directions; equal via lengths)
    const d = (p, e) => [p[(e + 1) % 4][0] - p[e][0], p[(e + 1) % 4][1] - p[e][1]];
    const A = d(seed, rule.edge), B = d(seed, rule.other);
    const ruleResidual = kind === 'parallel' ? Math.abs(A[0] * B[1] - A[1] * B[0]) / (Math.hypot(...A) * Math.hypot(...B)) : kind === 'perpendicular' ? Math.abs(A[0] * B[0] + A[1] * B[1]) / (Math.hypot(...A) * Math.hypot(...B)) : Math.abs(Math.hypot(...A) - Math.hypot(...B));
    const cmp = (p) => sc.status === 'built' ? { dArea: L.rel(sc.area, G.polyArea(p)), dCom: Math.hypot(sc.com[0] - G.polyCentroid(p)[0], sc.com[1] - G.polyCentroid(p)[1]) } : null;
    rows.push({ kind, seedKeepsOtherCorners: unchanged, seedRuleResidual: e2(ruleResidual), sc: sc.status, vsSeeded: cmp(seeded.points), vsRaw: cmp(raw.points) });
  }
  const sum = (k) => { const r = rows.filter((x) => x.kind === k); const ok = (f) => r.filter((x) => x[f] && x[f].dArea < 1e-6 && x[f].dCom < 1e-6).length; return { n: r.length, seedKeepsOthers: r.filter((x) => x.seedKeepsOtherCorners).length, seedExact: r.filter((x) => Number(x.seedRuleResidual) < 1e-9).length, scMatchesSeeded: ok('vsSeeded'), scMatchesRawSolve: ok('vsRaw'), worstVsSeeded: e2(Math.max(...r.map((x) => x.vsSeeded?.dArea ?? 0))) }; };
  OUT.s8 = { parallel: sum('parallel'), perpendicular: sum('perpendicular'), equal: sum('equal') };
  log('S8 done', JSON.stringify(OUT.s8));
}

// ===================================================== S9: describe / removal notes ====
{
  const cs = [
    [{ kind: 'horizontal', edge: 0 }, 'edge 1 across'], [{ kind: 'vertical', edge: 1 }, 'edge 2 up'], [{ kind: 'length', edge: 2, value: 40 }, 'edge 3 = 40'], [{ kind: 'equal', edge: 0, other: 1 }, 'edge 1 = edge 2'],
    [{ kind: 'parallel', edge: 0, other: 2 }, 'edge 1 ∥ edge 3'], [{ kind: 'perpendicular', edge: 0, other: 1 }, 'edge 1 ⊥ edge 2'], [{ kind: 'distanceX', a: 0, b: 2, value: 12 }, 'corner 1→3 across = 12'],
    [{ kind: 'distanceY', a: 0, b: 2, value: -5 }, 'corner 1→3 up = -5'], [{ kind: 'symmetric', a: 0, b: 2, center: 1 }, 'corner 2 centred between 1 and 3'], [{ kind: 'angle', edge: 1, other: 3, degrees: 30 }, 'edge 2 ∠ edge 4 = 30°'], [{ kind: 'lock', corner: 0 }, 'corner 1 pinned'],
  ];
  OUT.s9 = { describe: cs.map(([c, want]) => ({ kind: c.kind, got: L.solve.describe(c), want, ok: L.solve.describe(c) === want })),
    removalNotes: [
      { got: L.solve.describeRemovalNote({ kind: 'horizontal', edge: 2 }, { kind: 'horizontal', edge: 1 }), want: 'Edge 3 no longer has to stay level so edge 2 can. Undo puts it back.' },
      { got: L.solve.describeRemovalNotePair({ kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }, { kind: 'perpendicular', edge: 1, other: 2 }), want: 'Edge 3 no longer has to stay level and edge 4 no longer has to stay upright so they can meet at a right angle. Undo puts them back.' },
    ].map((x) => ({ ...x, ok: x.got === x.want })) };
  log('S9', OUT.s9.describe.filter((x) => !x.ok).length, 'describe mismatches;', OUT.s9.removalNotes.filter((x) => !x.ok).length, 'note mismatches');
}

// ===================================================== S10: labels ====
{
  const lab = L.outline.sketchLabels; const rect = [[0, 0], [40, 0], [40, 25], [0, 25]];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const out = {};
  const l1 = lab(rect, [{ kind: 'length', edge: 0, value: 40 }]);
  out.edgeLengths = { texts: l1.edges.map((e) => e.text), kinds: l1.edges.map((e) => e.kind), want: ['40', '25', '40', '25'], offsetFromMidpoint: l1.edges.map((e, i) => +dist([e.x, e.y], [(rect[i][0] + rect[(i + 1) % 4][0]) / 2, (rect[i][1] + rect[(i + 1) % 4][1]) / 2]).toFixed(6)), outward: l1.edges.every((e, i) => dist([e.x, e.y], [20, 12.5]) > dist([(rect[i][0] + rect[(i + 1) % 4][0]) / 2, (rect[i][1] + rect[(i + 1) % 4][1]) / 2], [20, 12.5])) };
  const l2 = lab([[0, 0], [17.5, 0], [17.5, 28 / 3], [0, 28 / 3]]); out.rounding = { texts: l2.edges.map((e) => e.text), want: ['17.5', '9.33', '17.5', '9.33'] };
  const l3 = lab(rect, [], { 0: 3 }, { 2: 2.5 }); out.corners = { texts: l3.corners.map((c) => c.text), want: ['R3', 'C2.5'] };
  const l3b = lab(rect, [], { 0: 3 }, { 0: 2.5 }); out.bothOnOneCorner = { texts: l3b.corners.map((c) => c.text), want: ['R3'] };
  // bow: bulge b = tan(theta/4); sagitta = (chord/2) * b
  const b = 0.4142135623730951; const l4 = lab(rect, [], undefined, undefined, { 0: b }); const sag = (40 / 2) * b;
  out.bow = { bowTexts: l4.bows.map((x) => x.text), want: ['+' + (Math.round(sag * 100) / 100).toString().replace(/0+$/, '')], edgeLabelsSkipForBowedEdge: l4.edges.map((e) => e.edge) };
  const l4n = lab(rect, [], undefined, undefined, { 0: -b }); out.bowNegative = { bowTexts: l4n.bows.map((x) => x.text) };
  out.circle = L.outline.circleLabel([[0, 0], [10, 0]]); out.circleWant = { x: 5, y: 0, text: '⌀10' };
  // cross-check against geometry actually built by OCCT and SolidCraft
  const mk = (extra) => ({ version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: rect, ...extra }, { id: 'e1', kind: 'extrude', target: 'sk1', height: 10 }] });
  const both = (doc) => ({ occt: L.occtMeasure(doc, 'e1'), sc: L.scTranslate(doc), brep: L.brepBuild(doc) });
  const segArea = (c, s) => { const r = (c * c / 4 + s * s) / (2 * s); return r * r * Math.acos((r - s) / r) - (r - s) * Math.sqrt(2 * r * s - s * s); };
  const cases = [
    { id: 'round R4 on corner 0', doc: mk({ rounds: { 0: 4 } }), area: 1000 - (1 - Math.PI / 4) * 16, label: 'R4' },
    { id: 'chamfer C2.5 on corner 2', doc: mk({ chamfers: { 2: 2.5 } }), area: 1000 - 2.5 * 2.5 / 2, label: 'C2.5' },
    { id: 'bow +' + sag.toFixed(4) + ' on edge 0', doc: mk({ bulges: { 0: b } }), area: 1000 + segArea(40, sag), label: '+' + (Math.round(sag * 100) / 100) },
    { id: 'bow -' + sag.toFixed(4) + ' on edge 0', doc: mk({ bulges: { 0: -b } }), area: 1000 - segArea(40, sag), label: '-' + (Math.round(sag * 100) / 100) },
  ];
  out.built = cases.map((c) => { const r = both(c.doc); const v = c.area * 10; return { id: c.id, label: c.label, closedFormVolume: r4(v), occt: r.occt.volume && { v: r4(r.occt.volume), rel: e2(L.rel(r.occt.volume, v)) }, brep: r.brep.volume && { v: r4(r.brep.volume), rel: e2(L.rel(r.brep.volume, v)) }, sc: r.sc.volume && { v: r4(r.sc.volume), rel: e2(L.rel(r.sc.volume, v)), faces: r.sc.faces }, scRefusal: r.sc.refusal ?? null }; });
  const o = L.arc.outlineOf({ points: rect, rounds: { 1: 4 } });
  const t = L.outline.treatmentsFromOutline(rect, o.points, o.basis, o.bulges);
  out.treatmentsFromOutline = { roundsRecovered: t.rounds, labels: t.corners.map((c) => c.text), want: { 1: 4 } };
  OUT.s10 = out; log('S10 done');
}


// ===================================================== S11: legacy-path collapse guard + RunResult.warnings ====
{
  const skew = [[0, 0], [40, 3], [41, 25], [1, 24]];
  const legacy = { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: skew, constraints: [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }] }, { id: 'e1', kind: 'extrude', target: 'sk1', height: 10 }] };
  const solved = L.modelCodegen.solveDoc(legacy);
  OUT.s11 = { legacyDocAdoptedUnchanged: JSON.stringify(solved.features[0].points) === JSON.stringify(skew), occt: L.occtMeasure(solved, 'e1'), brep: L.brepBuild(solved), sc: L.scTranslate(solved), startArea: G.polyArea(skew) };
  const run = (src) => { const r = L.runScript(src); return { errors: (r.errors ?? []).map((e) => e.message), warnings: r.warnings ?? [], constraints: r.doc.features.find((f) => f.kind === 'sketch')?.constraints }; };
  const base = "const sk1 = sketch('top'); sk1.polygon([[0,0],[40,0],[40,25],[0,25]]);";
  OUT.s11.warnings = {
    'across then up on one edge': run(base + 'sk1.across(1); sk1.up(1)'),
    'equal then parallel on adjacent edges': run(base + 'sk1.equal(1,2); sk1.parallel(1,2)'),
    'settled quietly (older rule dropped, no warning)': run(base + 'sk1.across(1); sk1.up(2); sk1.across(3); sk1.up(4); sk1.length(1,40); sk1.length(3,30)'),
  };
  // the full pipeline for the warning case: 3 kernels on whatever the doc becomes
  OUT.s11.pipelineAcrossUp = (() => { const P = L.pipeline(base + 'sk1.across(1); sk1.up(1); pull(sk1, 10)'); return P.scriptErrors ? P : { warnings: P.warnings, points: P.doc.features[0].points, occt: P.occt.volume, brep: P.brep.volume, sc: P.sc.volume }; })();
  log('S11 done');
}

writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(OUT, null, 1));
log('wrote results.json');
