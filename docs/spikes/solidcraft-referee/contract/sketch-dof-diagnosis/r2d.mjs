// ROUND 2, section D: legacy solveSketch numerics / degenerate inputs / losingEdges / dof for legacy / removal-note wording.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/sketch-dof-diagnosis/r2d.mjs   (writes r2d.json)
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import * as L from './lib.mjs';
import * as G from './legacy.mjs';
import { analyse } from './indep.mjs';
const sc2 = createRequire(import.meta.url)((process.env.SOLIDCRAFT_REFEREE_PKG2 ?? '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad/cdof/pkg2') + '/solidcraft_referee_dofcrit.js');
const e2 = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? +x.toExponential(3) : String(x)) : x);
const r6 = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? +x.toPrecision(9) : String(x)) : x);
const OUT = {};
const HV = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }];
const len = (edge, value) => ({ kind: 'length', edge, value });
// deterministic PRNG so the numbers reproduce
let seed = 20261017; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---- D1: 200 random starts, plain rectangle
{
  const cons = [...HV, len(0, 40), len(1, 30)]; const iters = [], res = [], dev = [];
  for (let t = 0; t < 200; t++) {
    const pts = [[0, 0], [40, 0], [40, 30], [0, 30]].map(([x, y]) => [x + (rnd() - 0.5) * 6, y + (rnd() - 0.5) * 6]);
    const s = L.solve.solveSketch(pts, cons);
    iters.push(s.iterations); res.push(s.residual);
    const w = Math.hypot(s.points[1][0] - s.points[0][0], s.points[1][1] - s.points[0][1]), h = Math.hypot(s.points[2][0] - s.points[1][0], s.points[2][1] - s.points[1][1]);
    dev.push(Math.max(Math.abs(w - 40), Math.abs(h - 30)));
  }
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  OUT.d1 = { starts: 200, atCap300: iters.filter((i) => i >= 300).length, medianIterations: med(iters), residualMedian: e2(med(res)), residualWorst: e2(Math.max(...res)), shareAbove1e7: r6(res.filter((r) => r > 1e-7).length / res.length), dimErrorMedianMm: e2(med(dev)), dimErrorWorstMm: e2(Math.max(...dev)),
    solidVolErrWorstRel_planar: e2(Math.max(...dev) / 30), tolerancePlanarBar: 1e-9 };
  console.log('D1', JSON.stringify(OUT.d1));
  // 100000x scale
  const sc = 1e5, pts = [[0, 0], [40, 0], [40, 30], [0, 30]].map(([x, y]) => [(x + (rnd() - 0.5) * 6) * sc, (y + (rnd() - 0.5) * 6) * sc]);
  const s = L.solve.solveSketch(pts, [...HV, len(0, 40 * sc), len(1, 30 * sc)]);
  OUT.d1scaled = { scale: sc, iterations: s.iterations, residual: e2(s.residual), overConstrained: s.overConstrained, thresholdAbs: 1e-3 };
  OUT.d1scaleSweep = [1, 1e2, 1e3, 1e4, 1e5].map((k) => {
    let fp = 0, worst = 0; const N = 40;
    for (let t = 0; t < N; t++) {
      const p = [[0, 0], [40, 0], [40, 30], [0, 30]].map(([x, y]) => [(x + (rnd() - 0.5) * 6) * k, (y + (rnd() - 0.5) * 6) * k]);
      const r = L.solve.solveSketch(p, [...HV, len(0, 40 * k), len(1, 30 * k)]);
      if (r.overConstrained) fp++; worst = Math.max(worst, r.residual);
    }
    return { scale: k, starts: N, falseOverConstrained: fp, worstResidual: e2(worst) };
  });
  console.log('D1s', JSON.stringify(OUT.d1scaled), JSON.stringify(OUT.d1scaleSweep));
}
// ---- D3: absolute 1e-3 threshold, tiny conflicts, NaN
{
  const base = [[0, 0], [60, 0], [60, 30], [0, 30]];
  OUT.d3 = [];
  for (const v of [60.0005, 60.001, 60.002, 60.01, 61]) {
    const s = L.solve.solveSketch(base, [...HV, len(0, 60), len(0, v)]);
    OUT.d3.push({ conflictingSecondLength: v, gapMm: r6(v - 60), overConstrained: s.overConstrained, residual: e2(s.residual), solvedLength: r6(Math.hypot(s.points[1][0] - s.points[0][0], s.points[1][1] - s.points[0][1])), losingEdges: L.solve.losingEdges(s.points, [...HV, len(0, 60), len(0, v)]) });
  }
  const sN = L.solve.solveSketch(base, [...HV, len(0, NaN)]);
  OUT.d3nan = { residual: String(sN.residual), overConstrained: sN.overConstrained, pointsFinite: sN.points.every((p) => p.every(Number.isFinite)) };
  const sI = L.solve.solveSketch(base, [...HV, len(0, Infinity)]);
  OUT.d3inf = { residual: String(sI.residual), overConstrained: sI.overConstrained, pointsFinite: sI.points.every((p) => p.every(Number.isFinite)) };
  const w = (edge) => { let s; try { s = L.solve.solveSketch(base, [{ kind: 'horizontal', edge: 0 }, len(edge, 20)]); } catch (e) { return { requestedEdge: edge, threw: String(e.message).slice(0, 120) }; } return { requestedEdge: edge, result: s.points.map((p) => p.map((x) => +x.toFixed(3))), iterations: s.iterations, over: s.overConstrained }; };
  OUT.d3range = [w(7), w(-1), w(1.5)];
  const sc = (src) => { const r = L.runScript(src); return r.errors?.length ? r.errors[0].message : 'no error'; };
  OUT.d3script = { 'length(9,5)': sc("const s=sketch('top'); s.rect(40,30); s.length(9,5)"), 'length(1,NaN)': sc("const s=sketch('top'); s.rect(40,30); s.length(1,NaN)"), 'length(0,5)': sc("const s=sketch('top'); s.rect(40,30); s.length(0,5)"), 'length(1,-5)': sc("const s=sketch('top'); s.rect(40,30); s.length(1,-5)") };
  console.log('D3', JSON.stringify(OUT.d3), JSON.stringify(OUT.d3nan), JSON.stringify(OUT.d3inf), JSON.stringify(OUT.d3range), JSON.stringify(OUT.d3script));
}
// ---- D5: losingEdges (corner rules never named; over-reports on pair rules)
{
  const base = [[0, 0], [40, 0], [40, 25], [0, 25]];
  const cons = [...HV, { kind: 'lock', corner: 0 }, { kind: 'distanceX', a: 0, b: 2, value: 30 }, { kind: 'distanceX', a: 0, b: 2, value: 50 }];
  const s = L.solve.solveSketch(base, cons);
  OUT.d5corner = { overConstrained: s.overConstrained, residual: e2(s.residual), losingEdges: L.solve.losingEdges(s.points, cons) };
  const x2 = G.CONFLICT.find((c) => c.id.startsWith('X2')); const nx = [...x2.cons, x2.add]; const sx = L.solve.solveSketch(x2.pts, nx);
  const { geoms, rules } = G.toSoup(x2.pts, nx); const bd = L.brepSketch(geoms, rules).diag;
  OUT.d5X2 = { added: x2.add, brepBlameRuleIdx: bd?.blame, brepBlameKinds: (bd?.blame ?? []).map((i) => rules[i]?.k), losingEdges: L.solve.losingEdges(sx.points, nx), edgesCarryingTheConflict: 'edge 1 (index 0) length 40 vs opposite edge 3 (index 2) length 30 with h/v: 2 edges' };
  console.log('D5', JSON.stringify(OUT.d5corner), JSON.stringify(OUT.d5X2));
}
// ---- D6: legacy SolveResult has no dof; legacy -> soup -> SolidCraft SolveReport dof vs independent
{
  const probe = L.solve.solveSketch([[0, 0], [40, 0], [40, 30], [0, 30]], HV);
  OUT.d6keys = Object.keys(probe);
  OUT.d6 = [];
  for (const c of [...G.DETERMINED, ...G.UNDER]) {
    const { geoms, rules } = G.toSoup(c.pts, c.cons); const m = L.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
    // start SolidCraft from the closed form when known (a saved legacy doc is the solved polygon), else the drawn points
    const ind = analyse(geoms, rules); const br = L.brepSketch(geoms, rules).diag;
    let scDof = 'mapper-refused';
    if (m.ok) { const r = JSON.parse(sc2.run(JSON.stringify({ commands: L.mapper.extrudeCommands(m, { height: 10 }) }))); const rep = r.results.find((x) => x.command === '@sketch')?.out?.report; scDof = rep ? { dof: rep.dof, status: rep.status } : r.results.filter((x) => !x.ok).map((x) => x.error); }
    OUT.d6.push({ id: c.id, indepDof: ind.dof, brepDof: br?.dof, scDof });
  }
  console.log('D6', JSON.stringify(OUT.d6keys), JSON.stringify(OUT.d6));
}
// ---- D7: removal-note wording + who calls it
{
  const S = L.solve;
  const dx = { kind: 'distanceX', a: 0, b: 2, value: 30 }, lk = { kind: 'lock', corner: 0 }, sym = { kind: 'symmetric', a: 0, b: 2, center: 4 };
  OUT.d7 = {
    singleEdgeAdded: S.describeRemovalNote(len(0, 40), len(0, 30)),
    pairSameEdge: S.describeRemovalNotePair(len(0, 40), len(0, 30), len(0, 20)),
    pairDifferentEdges: S.describeRemovalNotePair({ kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }, { kind: 'perpendicular', edge: 2, other: 3 }),
    pairCornerRuleAdded: S.describeRemovalNotePair(len(0, 40), len(1, 20), sym),
    singleCornerRuleAdded: S.describeRemovalNote(len(0, 40), sym),
    singleLockRemoved: S.describeRemovalNote(lk, dx),
    pairLockAndLength: S.describeRemovalNotePair(lk, len(0, 40), dx),
  };
  OUT.d7callers = execSync('grep -rn "describeRemovalNote" /home/shuff57/Documents/GitHub/reshape-cad/packages --include=*.ts --include=*.tsx -l | grep -v node_modules | grep -v "/dist/" || true').toString().trim().split('\n');
  OUT.d7callersScript = execSync('grep -rln "describeRemovalNote" /home/shuff57/Documents/GitHub/reshape-cad/packages/script/src || echo NONE').toString().trim();
  OUT.d7callersStudio = execSync('grep -rn "describeRemovalNote" /home/shuff57/Documents/GitHub/reshape-cad/packages/studio/src | head -5 || true').toString().trim();
  console.log('D7', JSON.stringify(OUT.d7, null, 1), OUT.d7callers, OUT.d7callersScript, OUT.d7callersStudio);
}
writeFileSync(new URL('./r2d.json', import.meta.url), JSON.stringify(OUT, null, 1));
