// ROUND 3 section C: LEGACY (outline) path. (1) solveDoc does not seed a new rule: a legal perpendicular/parallel/equal is silently left unheld.
// (2) the degeneracy guard that must replace collapsedByRatio's 25% test: it has to pass legal shrinks AND catch the 1.6e-6 / 2.1e-5 slivers.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> SOLIDCRAFT_REFEREE_PKG2=<pkg2> bun contract/sketch-dof-diagnosis/r3c.mjs   (writes r3c.json)
import { writeFileSync } from 'node:fs';
import * as R from './r3-lib.mjs';
import * as G from './legacy.mjs';
import { analyse } from './indep.mjs';
const { solve, runScript, modelCodegen, ruleCheck } = R;
const OUT = { repro: [], population: {}, guard: [] };
const r6 = (x) => (typeof x === 'number' ? +x.toPrecision(6) : x);
const edgeLen = (p, i) => Math.hypot(p[(i + 1) % p.length][0] - p[i][0], p[(i + 1) % p.length][1] - p[i][1]);
const polyArea = G.polyArea;
const diagOf = (p) => Math.hypot(Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1])));

/** independent check of a legacy constraint list on a polygon (no code from packages/sketch): max residual, mm or unitless/deg */
function violation(pts, startPts, cons) {
  const a = G.toSoup(pts, cons); const b = G.toSoup(startPts, cons);
  const joinN = pts.length;
  const res = ruleCheck.checkRules(a.geoms, a.rules, b.geoms).filter((r) => r.rule >= joinN && r.residual !== null);
  const tol = 1e-6 * Math.max(1, diagOf(startPts));
  const worst = res.map((r) => ({ ...r, over: r.residual / (r.unit === 'mm' ? tol : 1e-6) })).sort((x, y) => y.over - x.over)[0];
  return worst && worst.over > 1 ? worst : null;
}
function viaScript(src) {
  const run = runScript(src);
  if (run.errors?.length) return { error: run.errors.map((e) => e.message ?? String(e)).join('; ') };
  const doc0 = run.doc; const sk0 = doc0.features.find((f) => f.kind === 'sketch');
  const doc = modelCodegen.solveDoc(doc0); const sk = doc.features.find((f) => f.kind === 'sketch');
  return { warnings: run.warnings, drawn: sk0.points, points: sk.points, cons: sk.constraints ?? [], sk0cons: sk0.constraints ?? [] };
}
export const DEG_REL = 1e-3;
/** the degeneracy test that replaces the 25% ratio: an edge under DEG_REL of the drawn diagonal that no length rule asked for, or an outline under DEG_REL of the drawn area */
export function degenerate(before, after, cons = [], rel = DEG_REL) {
  const tol = rel * diagOf(before);
  for (let i = 0; i < after.length; i++) {
    if (edgeLen(after, i) >= tol) continue;
    const asked = cons.some((c) => c.kind === 'length' && ((c.edge % after.length) + after.length) % after.length === i && Math.abs(c.value - edgeLen(after, i)) <= 1e-6 * Math.max(1, diagOf(before)));
    if (!asked) return true;
  }
  // area test: skipped when the student asked for a tiny edge (a deliberately thin part is not a collapse)
  const askedTiny = cons.some((c) => c.kind === 'length' && c.value < tol);
  return !askedTiny && polyArea(after) < rel * polyArea(before);
}
// ---------------- 1. the critic's repro, verbatim
{
  const src = "const sk=sketch('top'); sk.polygon([[0,0],[58.33,0],[10.1,20.95]]); sk.perpendicular(1,3); pull(sk,10)";
  const v = viaScript(src);
  const seeded = solve.solveSketch(solve.seedForNewRule(v.drawn.map((p) => [...p]), v.cons), v.cons);
  const raw = solve.solveSketch(v.drawn.map((p) => [...p]), v.cons);
  const vio = violation(v.points, v.drawn, v.cons);
  const vioSeeded = violation(seeded.points, v.drawn, v.cons);
  const row = { src, constraintsKept: v.cons, warnings: v.warnings ?? null, drawn: v.drawn, afterSolveDoc: v.points, docUnchanged: JSON.stringify(v.points) === JSON.stringify(v.drawn),
    ruleViolatedInDoc: vio && { kind: vio.kind, residual: r6(vio.residual), unit: vio.unit }, rawSolve: { residual: r6(raw.residual), overConstrained: raw.overConstrained, collapsedByRatio: solve.collapsedByRatio(v.drawn, raw.points), area: r6(polyArea(raw.points)) },
    seededSolve: { points: seeded.points.map((p) => p.map(r6)), residual: r6(seeded.residual), overConstrained: seeded.overConstrained, collapsedByRatio: solve.collapsedByRatio(v.drawn, seeded.points), ruleViolated: !!vioSeeded, area: r6(polyArea(seeded.points)), angleDeg: r6(Math.abs((Math.atan2(seeded.points[2][1]-seeded.points[0][1], seeded.points[2][0]-seeded.points[0][0]) - 0) * 180 / Math.PI)) } };
  OUT.repro.push(row); console.log('REPRO', JSON.stringify(row));
}
// ---------------- 2. population of single-rule scripts (seeded). Kinds that settling prunes (length on an edge already pinned etc.) don't arise with one rule.
{
  let seed = +(process.env.LSEED ?? 7); const rnd = R.mulberry(seed);
  const r = (a, b) => a + (b - a) * rnd();
  const polys = [];
  const N = +(process.env.LN ?? 600);
  const tally = { total: 0, honoured: 0, notHonoured: 0, notHonouredSilent: 0, notHonouredWithWarning: 0, seededHonoured: 0, seededWouldFix: 0, byKind: {}, adjacency: {} };
  const examples = [];
  for (let n = 0; n < N; n++) {
    const nv = rnd() < 0.5 ? 3 : 4;
    let pts;
    for (;;) { // random simple polygon: angular sort around a centre
      const c = [r(20, 40), r(20, 40)];
      const angs = Array.from({ length: nv }, () => r(0, Math.PI * 2)).sort((a, b) => a - b);
      pts = angs.map((a) => { const rad = r(12, 30); return [+(c[0] + rad * Math.cos(a)).toFixed(2), +(c[1] + rad * Math.sin(a)).toFixed(2)]; });
      const gaps = angs.map((a, i) => ((angs[(i + 1) % nv] - a) + Math.PI * 2) % (Math.PI * 2));
      if (Math.max(...gaps) < Math.PI * 0.95 && polyArea(pts) > 150) break;
    }
    const kinds = ['perpendicular', 'parallel', 'equal', 'horizontal', 'vertical', 'length', 'angle', 'pin'];
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const i = Math.floor(rnd() * nv); let j = Math.floor(rnd() * nv); while (j === i) j = Math.floor(rnd() * nv);
    const adj = (j - i + nv) % nv === 1 || (i - j + nv) % nv === 1;
    const E = (e) => e + 1;
    let call;
    if (kind === 'horizontal') call = `sk.across(${E(i)})`;
    else if (kind === 'vertical') call = `sk.up(${E(i)})`;
    else if (kind === 'length') call = `sk.length(${E(i)}, ${+(edgeLen(pts, i) * r(0.6, 1.5)).toFixed(2)})`;
    else if (kind === 'angle') call = `sk.angle(${E(i)}, ${E(j)}, ${+r(20, 160).toFixed(1)})`;
    else if (kind === 'pin') call = `sk.pin(${E(i)})`;
    else call = `sk.${kind}(${E(i)}, ${E(j)})`;
    const src = `const sk=sketch('top'); sk.polygon(${JSON.stringify(pts)}); ${call}; pull(sk,10)`;
    const v = viaScript(src);
    if (v.error) { (tally.errors ??= []).push([src, v.error]); continue; }
    if (v.cons.length === 0) continue;
    // oracle: the independent LM, from the drawn start, finds a part that is not a sliver (every edge >= 1e-3 of the diagonal and area >= 1e-3 of the drawn area)
    const so = G.toSoup(v.drawn, v.cons); const ind = analyse(so.geoms, so.rules);
    const indPts = ind.solved ? ind.solved.map((g) => g.a) : null;
    const feasible = !!(ind.consistent && indPts && !degenerate(v.drawn, indPts, v.cons));
    if (!feasible) { tally.infeasibleOrDegenerateByOracle = (tally.infeasibleOrDegenerateByOracle ?? 0) + 1; if (violation(v.points, v.drawn, v.cons)) tally.infeasibleWarned = (tally.infeasibleWarned ?? 0) + ((v.warnings ?? []).length > 0 ? 1 : 0), tally.infeasibleSilent = (tally.infeasibleSilent ?? 0) + ((v.warnings ?? []).length > 0 ? 0 : 1); continue; }
    tally.total++;
    const b = (tally.byKind[kind] ??= { total: 0, notHonouredSilent: 0, notHonouredWithWarning: 0 });
    b.total++;
    const vio = violation(v.points, v.drawn, v.cons);
    if (!vio) { tally.honoured++; }
    else {
      tally.notHonoured++;
      const warned = (v.warnings ?? []).length > 0;
      if (warned) { tally.notHonouredWithWarning++; b.notHonouredWithWarning++; } else { tally.notHonouredSilent++; b.notHonouredSilent++; }
      const seeded = solve.solveSketch(solve.seedForNewRule(v.drawn.map((p) => [...p]), v.cons), v.cons);
      const raw = solve.solveSketch(v.drawn.map((p) => [...p]), v.cons);
      const ok = !violation(seeded.points, v.drawn, v.cons) && !solve.collapsedByRatio(v.drawn, seeded.points);
      if (ok) tally.seededWouldFix++;
      const f = (tally.fixCandidates ??= { unhonoured: 0, seedOnly25: 0, rawHonoursButGate25Rejects: 0, rawHonoursAndPassesDeg: 0, seedPlusDeg: 0, seedPlusDegHonoured: 0, stillUnhonoured: 0 });
      f.unhonoured++;
      if (ok) f.seedOnly25++;
      const rawHonours = !violation(raw.points, v.drawn, v.cons);
      if (rawHonours && solve.collapsedByRatio(v.drawn, raw.points)) f.rawHonoursButGate25Rejects++;
      if (rawHonours && !degenerate(v.drawn, raw.points, v.cons)) f.rawHonoursAndPassesDeg++;
      const sOK = !violation(seeded.points, v.drawn, v.cons) && !degenerate(v.drawn, seeded.points, v.cons);
      if (sOK) f.seedPlusDeg++;
      if (!(sOK || (rawHonours && !degenerate(v.drawn, raw.points, v.cons)))) f.stillUnhonoured++;
      if (!warned && examples.length < 8) examples.push({ src, kind, adjacent: adj, kept: v.cons.length, violated: { kind: vio.kind, residual: r6(vio.residual), unit: vio.unit }, seededFixes: ok });
      if (!warned) { const a = (tally.adjacency[`${kind}:${adj ? 'adjacent' : 'non-adjacent'}`] ??= 0); tally.adjacency[`${kind}:${adj ? 'adjacent' : 'non-adjacent'}`]++; }
    }
  }
  tally.examples = examples; OUT.population = tally;
  console.log('POPULATION', JSON.stringify({ ...tally, examples: undefined }), '\n', JSON.stringify(examples.slice(0, 4)));
}
// ---------------- 3. degeneracy guard vs the 25% ratio vs the round-2 prototype (1e-6), on cases that must pass and cases that must be refused
{
  const rectPts = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const HV = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }];
  const len = (edge, value) => ({ kind: 'length', edge, value });
  const T3 = [[0, 0], [40, 0], [10, 25]];
  const cases = [];
  for (const v of [40, 30, 20, 12, 10.5, 10.1, 10, 9.9, 8, 5, 2, 1]) cases.push({ id: `slider-${v}`, must: 'pass', pts: rectPts(40, 30), cons: [...HV, len(0, v)] });
  cases.push({ id: 'A rect40x30 len 20,15', must: 'pass', pts: rectPts(40, 30), cons: [...HV, len(0, 20), len(1, 15)] });
  cases.push({ id: 'B rect100 len 40,40', must: 'pass', pts: rectPts(100, 100), cons: [...HV, len(0, 40), len(1, 40)] });
  cases.push({ id: 'C rect40x30 len 12,12 equal', must: 'pass', pts: rectPts(40, 30), cons: [...HV, len(0, 12), len(1, 12), { kind: 'equal', edge: 0, other: 1 }] });
  cases.push({ id: 'tiny but asked: len 0.02 on 40x30', must: 'pass', pts: rectPts(40, 30), cons: [...HV, len(0, 0.02)] });
  cases.push({ id: 'S09 trapezoid + parallel (the case the 25% test was written for)', must: 'pass', pts: [[0, 0], [40, 0], [30, 20], [5, 25]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'parallel', edge: 0, other: 2 }] });
  cases.push({ id: 'M3 up-on-horizontal rect', must: 'refuse', pts: [[0, 0], [40, 0], [40, 25], [0, 25]], cons: [...HV, { kind: 'vertical', edge: 0 }] });
  cases.push({ id: 'M3b h+v one edge skew quad', must: 'refuse', pts: [[0, 0], [40, 3], [41, 25], [1, 24]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }] });
  cases.push({ id: 'M3c h+v one edge hexagon', must: 'refuse', pts: [[0, 0], [20, -3], [40, 0], [40, 20], [20, 25], [0, 20]], cons: [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 0 }] });
  cases.push({ id: 'ROUND3 sliver: triangle, two right angles', must: 'refuse', pts: T3, cons: [{ kind: 'perpendicular', edge: 0, other: 1 }, { kind: 'perpendicular', edge: 1, other: 2 }] });
  cases.push({ id: 'ROUND3 sliver: triangle perp(1,3)+equal(1,2)', must: 'refuse', pts: T3, cons: [{ kind: 'perpendicular', edge: 0, other: 2 }, { kind: 'equal', edge: 0, other: 1 }] });
  cases.push({ id: 'ROUND3 point: rect h/v + angle 45', must: 'refuse', pts: rectPts(30, 20), cons: [...HV, { kind: 'angle', edge: 0, other: 1, degrees: 45 }] });
  const proto = (before, after) => { const tol = Math.max(1e-9, 1e-6 * diagOf(before)); for (let i = 0; i < after.length; i++) if (edgeLen(after, i) < tol && edgeLen(before, i) > tol) return true; return polyArea(after) < Math.max(1e-12, 1e-9 * polyArea(before)); };
  for (const c of cases) {
    const ts = solve.solveSketch(c.pts.map((p) => [...p]), c.cons);
    const vio = violation(ts.points, c.pts, c.cons);
    const minRatio = Math.min(...ts.points.map((_, i) => edgeLen(ts.points, i))) / diagOf(c.pts);
    OUT.guard.push({ id: c.id, must: c.must, tsOverConstrained: ts.overConstrained, tsResidual: r6(ts.residual), ruleHeld: !vio, area: r6(polyArea(ts.points)), drawnArea: r6(polyArea(c.pts)), minEdgeOverDiag: +minRatio.toExponential(3),
      ratio25: solve.collapsedByRatio(c.pts, ts.points), proto1e6: proto(c.pts, ts.points) || ts.overConstrained, deg1e3: degenerate(c.pts, ts.points, c.cons) || ts.overConstrained, tsOver: ts.overConstrained });
  }
  const table = OUT.guard.map((g) => `${g.id.padEnd(46)} over ${String(g.tsOver).padEnd(5)} must ${g.must.padEnd(6)} held ${String(g.ruleHeld).padEnd(5)} minEdge/diag ${String(g.minEdgeOverDiag).padEnd(10)} 25%:${g.ratio25 ? 'REFUSE' : 'pass  '} (1e-6|over):${g.proto1e6 ? 'REFUSE' : 'pass  '} (1e-3|over):${g.deg1e3 ? 'REFUSE' : 'pass  '}`);
  console.log(table.join('\n'));
  const wrong = (key) => OUT.guard.filter((g) => (g.must === 'pass') === g[key]).map((g) => g.id);
  OUT.guardWrong = { ratio25: wrong('ratio25'), proto1e6: wrong('proto1e6'), deg1e3: wrong('deg1e3') };
  console.log('WRONG verdicts (pass-expected refused, or refuse-expected passed):', JSON.stringify(OUT.guardWrong));
}
// ---------------- 4. the same impossible sets through the real script path (runScript -> solveDoc): what does the doc keep and what is built
{
  const scripts = {
    'two right angles': "const sk=sketch('top'); sk.polygon([[0,0],[40,0],[10,25]]); sk.perpendicular(1,2); sk.perpendicular(2,3); pull(sk,10)",
    'perp(1,3)+equal(1,2)': "const sk=sketch('top'); sk.polygon([[0,0],[40,0],[10,25]]); sk.perpendicular(1,3); sk.equal(1,2); pull(sk,10)",
    'rect + angle 45': "const sk=sketch('top'); sk.rect(30,20); sk.angle(1,2,45); pull(sk,10)",
  };
  OUT.scripts = {};
  for (const [id, src] of Object.entries(scripts)) {
    const v = viaScript(src);
    OUT.scripts[id] = v.error ? { error: v.error } : { warnings: v.warnings ?? null, kept: v.cons, drawn: v.drawn, doc: v.points.map((p) => p.map(r6)), docArea: r6(polyArea(v.points)), drawnArea: r6(polyArea(v.drawn)), ruleViolatedInDoc: (() => { const x = violation(v.points, v.drawn, v.cons); return x && { kind: x.kind, residual: r6(x.residual) }; })() };
    console.log('SCRIPT', id, JSON.stringify(OUT.scripts[id]));
  }
}
// ---------------- 5. solveSketch accuracy caveat (row 0/1) and the two label caveats
{
  const rnd = R.mulberry(99); const HVc = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }];
  let n = 0, capHit = 0, above1e7 = 0, worstRes = 0, worstDimErr = 0; const res = [];
  for (let k = 0; k < 300; k++) {
    const w = 20 + 60 * rnd(), h = 15 + 40 * rnd(); const j = () => (rnd() * 2 - 1) * 0.08 * Math.max(w, h);
    const pts = [[0 + j(), 0 + j()], [w + j(), j()], [w + j(), h + j()], [j(), h + j()]];
    const cons = [...HVc, { kind: 'length', edge: 0, value: +(w * 0.9).toFixed(3) }, { kind: 'length', edge: 1, value: +(h * 0.9).toFixed(3) }];
    const t = solve.solveSketch(pts, cons); n++;
    if (t.iterations >= 300) capHit++; if (t.residual > 1e-7) above1e7++; worstRes = Math.max(worstRes, t.residual); res.push(t.residual);
    worstDimErr = Math.max(worstDimErr, Math.abs(edgeLen(t.points, 0) - cons[4].value), Math.abs(edgeLen(t.points, 1) - cons[5].value));
  }
  res.sort((a, b) => a - b);
  OUT.accuracy = { cases: n, hitIterationCap300: capHit, residualAbove1e7: above1e7, medianResidual: res[Math.floor(n / 2)], worstResidual: worstRes, worstDimensionErrorMm: worstDimErr };
  console.log('ACCURACY', JSON.stringify(OUT.accuracy));
  const rect = [[0, 0], [40, 0], [40, 25], [0, 25]];
  const lab = R.outline.sketchLabels;
  const big = lab(rect, [], { 0: 50 }); const o = R.arc.outlineOf({ points: rect, rounds: { 0: 50 } });
  const tr = o.ok === false ? null : R.outline.treatmentsFromOutline(rect, o.points, o.basis, o.bulges);
  const small = lab(rect, [], { 0: 3 }); const o3 = R.arc.outlineOf({ points: rect, rounds: { 0: 3 } });
  const near = lab([[0, 0], [29.996, 0], [29.996, 20], [0, 20]], [{ kind: 'length', edge: 0, value: 30 }]);
  OUT.labels = { requestedRound50: big.corners.map((c) => c.text), builtOutlineOk: o.ok ?? true, builtRoundRecovered: tr && tr.rounds, builtOutlinePointCount: o.points?.length ?? null, outlineMessage: o.reason ?? o.message ?? o.error ?? null, r3: small.corners.map((c) => c.text), r3built: R.outline.treatmentsFromOutline(rect, o3.points, o3.basis, o3.bulges).rounds, geometry29_996_ruled30: near.edges.map((e) => [e.kind, e.text]), noConsumer: 'grep -rn sketchLabels packages/*/src (excluding tests): only the definition and comments in sketch-outline.ts' };
  console.log('LABELS', JSON.stringify(OUT.labels));
}
writeFileSync(new URL('./r3c.json', import.meta.url), JSON.stringify(OUT, null, 1));
