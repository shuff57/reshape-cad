// ROUND 2, section A: the script path (runScript -> solveDoc) silently drops / refuses valid rules. Measured against the student's TEXT.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/sketch-dof-diagnosis/r2a.mjs   (writes r2a.json)
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
import * as G from './legacy.mjs';
import { analyse } from './indep.mjs';

const H = 10;
const brepDoc = (geoms, rules) => ({ version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, geoms: L.clone(geoms), rules: L.clone(rules) }, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }] });
export function scBuild(geoms, rules) {
  const m = L.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
  if (!m.ok) return { status: 'mapper-refused', sentence: m.refusals.map((r) => r.sentence).join(' | ') };
  const r = L.scRun([...m.commands, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: H, sketch: m.sketchName, operation: 'new', body_name: 'B' } }]);
  if (!r.ok) { const rule = m.ruleMap.findIndex((ix) => ix && ix.includes(r.index)); return { status: 'refused', rule, ruleKind: rules[rule]?.k, sentence: r.error }; }
  const b = r.measure.bodies[0];
  return { status: 'built', volume: b.volume_mm3, bbox: [...b.bbox.min, ...b.bbox.max] };
}
const bb = (b) => b && [+(b[3] - b[0]).toFixed(4), +(b[4] - b[1]).toFixed(4)];
const r6 = (x) => (typeof x === 'number' ? +x.toPrecision(9) : x);

/** a legacy constraint list the way the script stores it BEFORE settling: what the student's text literally asks for */
const HV = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }];
const len = (edge, value) => ({ kind: 'length', edge, value });
// closed form = the rectangle the student's rules describe
export const CASES = [
  { id: 'A', src: "const s=sketch('top'); s.rect(40,30); s.length(1,20); s.length(2,15); pull(s,10)", pts: 'rect:40x30', asked: [len(0, 20), len(1, 15)], closed: 20 * 15 * H, desc: 'rect 40x30, length(1,20), length(2,15): asks 20x15' },
  { id: 'B', src: "const s=sketch('top'); s.rect(100,100); s.length(1,40); s.length(2,40); pull(s,10)", pts: 'rect:100x100', asked: [len(0, 40), len(1, 40)], closed: 40 * 40 * H, desc: 'rect 100x100, length(1,40), length(2,40): asks 40x40' },
  { id: 'C', src: "const s=sketch('top'); s.rect(40,30); s.length(1,12); s.length(2,12); s.equal(1,2); pull(s,10)", pts: 'rect:40x30', asked: [len(0, 12), len(1, 12), { kind: 'equal', edge: 0, other: 1 }], closed: 12 * 12 * H, desc: 'rect 40x30, length(1,12), length(2,12), equal(1,2): asks 12x12 (equal is redundant, consistent)' },
  { id: 'D', src: "const s=sketch('top'); s.rect(40,30); s.length(1,8); pull(s,10)", pts: 'rect:40x30', asked: [len(0, 8)], closed: 8 * 30 * H, desc: 'rect 40x30, length(1,8): asks 8x30' },
  { id: 'E-control-ok', src: "const s=sketch('top'); s.rect(40,30); s.length(1,10.1); pull(s,10)", pts: 'rect:40x30', asked: [len(0, 10.1)], closed: 10.1 * 30 * H, desc: 'control: length(1,10.1) is just above the 25% cliff' },
  { id: 'F-cliff-10', src: "const s=sketch('top'); s.rect(40,30); s.length(1,10); pull(s,10)", pts: 'rect:40x30', asked: [len(0, 10)], closed: 10 * 30 * H, desc: 'length(1,10) = exactly 25% of the drawn 40' },
  { id: 'G-9.9', src: "const s=sketch('top'); s.rect(40,30); s.length(1,9.9); pull(s,10)", pts: 'rect:40x30', asked: [len(0, 9.9)], closed: 9.9 * 30 * H, desc: 'length(1,9.9) just under 25%' },
];
const rectPts = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];

const OUT = { cases: [] };
for (const c of CASES) {
  const [w0, h0] = c.pts.split(':')[1].split('x').map(Number);
  const run = L.runScript(c.src);
  const sk = run.doc.features.find((f) => f.kind === 'sketch');
  const kept = sk.constraints.filter((k) => !HV.some((h) => h.kind === k.kind && h.edge === k.edge));
  const P = L.pipeline(c.src);
  const solvedPts = P.doc.features[0].points;
  const { geoms, rules } = G.toSoup(rectPts(w0, h0), [...HV, ...c.asked]);
  // 1. what a student's literal rules give on three independent solvers (no TS settling, no TS collapse gate)
  const sc = scBuild(geoms, rules);
  const br = L.brepBuild(brepDoc(geoms, rules));
  const ind = analyse(geoms, rules);
  const indPoly = ind.solved ? ind.solved.slice(0, 4).map((g) => g.a) : null;
  const indVol = indPoly ? G.polyArea(indPoly) * H : null;
  OUT.cases.push({
    id: c.id, desc: c.desc, src: c.src, closedForm: c.closed,
    scriptWarnings: run.warnings ?? null, scriptErrors: run.errors?.length ? run.errors.map((e) => e.message) : null,
    askedConstraints: c.asked, keptByScript: kept,
    droppedBySettling: c.asked.filter((a) => !kept.some((k) => JSON.stringify(k) === JSON.stringify(a))),
    solvedDocBBox: bb([Math.min(...solvedPts.map((p) => p[0])), Math.min(...solvedPts.map((p) => p[1])), 0, Math.max(...solvedPts.map((p) => p[0])), Math.max(...solvedPts.map((p) => p[1])), 0]),
    appPath: { occt: r6(P.occt?.volume), brep: r6(P.brep?.volume), sc: r6(P.sc?.volume), relErrVsClosed: r6(Math.abs(P.occt.volume - c.closed) / c.closed) },
    studentRules: { sc: { status: sc.status, volume: r6(sc.volume), bboxWH: bb(sc.bbox), sentence: sc.sentence }, brep: { outcome: br.outcome, volume: r6(br.volume), refusal: br.refusal }, indep: { consistent: ind.consistent, dof: ind.dof, volume: r6(indVol) } },
  });
  console.log(c.id, JSON.stringify(OUT.cases.at(-1).appPath), JSON.stringify(OUT.cases.at(-1).studentRules), JSON.stringify(OUT.cases.at(-1).scriptWarnings));
}
writeFileSync(new URL('./r2a.json', import.meta.url), JSON.stringify(OUT, null, 1));

// ---- genuine conflicts through the script path: dropped silently (no warning) instead of refused
OUT.conflicts = [];
const TRI = [[0, 0], [30, 0], [15, 20]], RECT = [[0, 0], [40, 0], [40, 30], [0, 30]];
const CONF = [
  { id: 'T-3-perpendicular-triangle', src: "const s=sketch('top'); s.polygon([[0,0],[30,0],[15,20]]); s.perpendicular(1,2); s.perpendicular(2,3); s.perpendicular(3,1); pull(s,10)", pts: TRI, cons: [{ kind: 'perpendicular', edge: 0, other: 1 }, { kind: 'perpendicular', edge: 1, other: 2 }, { kind: 'perpendicular', edge: 2, other: 0 }], note: 'a triangle cannot have three right angles' },
  { id: 'P-pin1-pin2-length100', src: "const s=sketch('top'); s.polygon([[0,0],[40,0],[40,30],[0,30]]); s.pin(1); s.pin(2); s.length(1,100); pull(s,10)", pts: RECT, cons: [{ kind: 'lock', corner: 0 }, { kind: 'lock', corner: 1 }, { kind: 'length', edge: 0, value: 100 }], note: 'two pinned corners 40 apart cannot be 100 apart' },
  { id: 'X-length-then-longer-length-same-edge', src: "const s=sketch('top'); s.polygon([[0,0],[40,0],[40,30],[0,30]]); s.pin(1); s.length(1,40); s.length(1,60); pull(s,10)", pts: RECT, cons: [{ kind: 'lock', corner: 0 }, { kind: 'length', edge: 0, value: 40 }, { kind: 'length', edge: 0, value: 60 }], note: 'two different lengths on one edge: script replaces silently (last wins)?' },
];
for (const c of CONF) {
  const run = L.runScript(c.src);
  const sk = run.doc.features.find((f) => f.kind === 'sketch');
  const P = L.pipeline(c.src);
  const { geoms, rules } = G.toSoup(c.pts, c.cons);
  const sc = scBuild(geoms, rules);
  const b = L.brepSketch(geoms, rules);
  const moved = P.doc.features[0].points.map((p, i) => +Math.hypot(p[0] - c.pts[i][0], p[1] - c.pts[i][1]).toFixed(4));
  OUT.conflicts.push({ id: c.id, note: c.note, src: c.src, asked: c.cons, keptByScript: sk.constraints, warnings: run.warnings ?? null, errors: run.errors?.length ? run.errors.map((e) => e.message) : null,
    cornerMovedMm: moved, solidVolumeOcctBrepSc: [r6(P.occt?.volume), r6(P.brep?.volume), r6(P.sc?.volume)],
    scOnStudentRules: { status: sc.status, sentence: sc.sentence, ruleKind: sc.ruleKind }, brepDiagnose: b.diag ? { bucket: b.diag.bucket, blame: b.diag.blame } : { open: b.open, err: b.lastError } });
  console.log(c.id, JSON.stringify(OUT.conflicts.at(-1)));
}
writeFileSync(new URL('./r2a.json', import.meta.url), JSON.stringify(OUT, null, 1));

// ---- section B: where is the cliff, and would a degeneracy-only guard keep the true catches? (prototype, lives only here)
const edgeLen = (p, i) => Math.hypot(p[(i + 1) % p.length][0] - p[i][0], p[(i + 1) % p.length][1] - p[i][1]);
const diag = (p) => Math.hypot(Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1])));
/** PROTOTYPE contract guard: an edge reduced to a point (< 1e-6 of the drawn diagonal, absolute floor 1e-9) or an outline of no area. NOT a ratio. */
export function degenerate(before, after) {
  const tol = Math.max(1e-9, 1e-6 * diag(before));
  for (let i = 0; i < after.length; i++) if (edgeLen(after, i) < tol && edgeLen(before, i) > tol) return true;
  return G.polyArea(after) < Math.max(1e-12, 1e-9 * G.polyArea(before));
}
OUT.guard = [];
for (const c of CASES) {
  const [w0, h0] = c.pts.split(':')[1].split('x').map(Number);
  const before = rectPts(w0, h0);
  const ts = L.solve.solveSketch(before, [...HV, ...c.asked]);
  OUT.guard.push({ id: c.id, tsOver: ts.overConstrained, tsResidual: r6(ts.residual), tsVolume: r6(G.polyArea(ts.points) * H), closed: c.closed, relErr: r6(Math.abs(G.polyArea(ts.points) * H - c.closed) / c.closed), ratioGate: L.solve.collapsedByRatio(before, ts.points), protoGate: degenerate(before, ts.points) });
}
const TRUE_COLLAPSE = [
  { id: 'M3-up-on-horizontal-edge-of-rect', pts: [[0, 0], [40, 0], [40, 25], [0, 25]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }, { kind: 'vertical', edge: 0 }] },
  { id: 'M3b-h-and-v-on-one-edge-of-skew-quad', pts: [[0, 0], [40, 3], [41, 25], [1, 24]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }] },
  { id: 'M3c-h-and-v-on-one-edge-of-hexagon', pts: [[0, 0], [20, -3], [40, 0], [40, 20], [20, 25], [0, 20]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }] },
];
OUT.trueCollapse = TRUE_COLLAPSE.map((c) => { const ts = L.solve.solveSketch(c.pts, c.cons); return { id: c.id, startArea: r6(G.polyArea(c.pts)), solvedArea: r6(G.polyArea(ts.points)), minEdge: r6(Math.min(...ts.points.map((_, i) => edgeLen(ts.points, i)))), ratioGate: L.solve.collapsedByRatio(c.pts, ts.points), protoGate: degenerate(c.pts, ts.points) }; });
console.log(JSON.stringify(OUT.guard)); console.log(JSON.stringify(OUT.trueCollapse));
writeFileSync(new URL('./r2a.json', import.meta.url), JSON.stringify(OUT, null, 1));
