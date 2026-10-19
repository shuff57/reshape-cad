// ROUND 4 section A: planar accuracy of the legacy solveSketch, with the corrected bar and the fix (polish), plus `pinned` and the drag path.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/sketch-dof-diagnosis/r4a.mjs   (writes r4a.json; ~30 s)
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import { polish, checkAll, signedResiduals } from './legacy-rules.mjs';

const OUT = {};
const S = L.solve;
const e2 = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? +x.toExponential(3) : String(x)) : x);
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))];
const BAR = 1e-9;

// ---- A0: the constants. TOL and MAX_ITERATIONS in sketch-solve.ts are declared and never read.
{
  const src = readFileSync(path.join(L.REPO, 'packages/sketch/src/sketch-solve.ts'), 'utf8');
  const count = (name) => (src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
  OUT.constants = { TOL_occurrences: count('TOL'), MAX_ITERATIONS_occurrences: count('MAX_ITERATIONS'), note: 'each is 1 = the declaration only, so neither is read; the real caps are the literals tolerance:1e-9,maxIterations:300 (pass 2) and tolerance:1e-6,maxIterations:200 (pass 1)' };
  console.log('A0', JSON.stringify(OUT.constants));
}

// ---- A1: 400 random 40x25 rectangles, rough start (corners jittered up to 8% of the diagonal), h/v + two lengths
const H = (e) => ({ kind: 'horizontal', edge: e }), V = (e) => ({ kind: 'vertical', edge: e }), Ln = (e, v) => ({ kind: 'length', edge: e, value: v });
function rectTrials(label, extra, seed, N = 400) {
  const rnd = mulberry(seed); const W = 40, Hh = 25, amp = 0.08 * Math.hypot(W, Hh);
  const raw = [], pol = [], iters = [], resid = [], rawAbs = [], solved = [], resDiff = [];
  let cap = 0, above1e7 = 0;
  for (let t = 0; t < N; t++) {
    const base = [[0, 0], [W, 0], [W, Hh], [0, Hh]];
    const pts = base.map(([x, y]) => [x + (rnd() * 2 - 1) * amp, y + (rnd() * 2 - 1) * amp]);
    if (extra.length) pts[0] = [0, 0];
    const cons = [H(0), V(1), H(2), V(3), Ln(0, W), Ln(1, Hh), ...extra];
    const r = S.solveSketch(pts, cons);
    const q = polish(r.points, cons);
    raw.push(Math.abs(area(r.points) - W * Hh) / (W * Hh)); pol.push(Math.abs(area(q.points) - W * Hh) / (W * Hh));
    iters.push(r.iterations); resid.push(r.residual); if (r.iterations >= 300) cap++; if (r.residual > 1e-7) above1e7++;
    const ind = Math.max(...signedResiduals(r.points, cons, pts).map(Math.abs)); rawAbs.push(ind); resDiff.push(Math.abs(r.residual - ind));
    if (t < 3) solved.push(r.points);
  }
  const o = { label, trials: N, seed, atIterationCap300: cap, residualAboveStated1e7: above1e7, residualMedian: e2(pct(resid, 0.5)), residualMax: e2(Math.max(...resid)), reportedResidualVsIndependentMaxAbsRule: { maxAbsDifference: e2(Math.max(...resDiff)), note: 'solveSketch.residual against max |signed rule residual| computed by legacy-rules.mjs from the returned points' },
    relAreaErr: { median: e2(pct(raw, 0.5)), p90: e2(pct(raw, 0.9)), max: e2(Math.max(...raw)) }, shareAboveBar1e9: +(raw.filter((v) => v > BAR).length / N).toFixed(3), maxTimesBar: +(Math.max(...raw) / BAR).toFixed(1),
    afterPolish: { relAreaErrMax: e2(Math.max(...pol)), shareAboveBar1e9: +(pol.filter((v) => v > BAR).length / N).toFixed(3) } };
  console.log('A1', JSON.stringify(o));
  return o;
}
OUT.rect400 = [rectTrials('no pin (Ln,Ln,hv)', [], 31337), rectTrials('corner 1 pinned (lock)', [{ kind: 'lock', corner: 0 }], 31337)];

// ---- A2: other shapes (L, triangle with angle + lengths, trapezoid), closed-form area, 150 rough starts each
{
  const shapes = {
    L: { base: [[0, 0], [40, 0], [40, 10], [15, 10], [15, 30], [0, 30]], cons: [H(0), V(1), H(2), V(3), H(4), V(5), Ln(0, 40), Ln(1, 10), Ln(2, 25), Ln(3, 20), Ln(4, 15), { kind: 'lock', corner: 0 }], area: 40 * 10 + 15 * 20 },
    tri: { base: [[0, 0], [40, 0], [10, 25]], cons: [H(0), Ln(0, 40), { kind: 'angle', edge: 0, other: 1, degrees: 120 }, Ln(1, 30), { kind: 'lock', corner: 0 }], area: 0.5 * 40 * 30 * Math.sin(Math.PI / 3) },
    trap: { base: [[0, 0], [60, 0], [45, 20], [10, 20]], cons: [H(0), H(2), Ln(0, 60), Ln(2, 35), { kind: 'distanceY', a: 0, b: 3, value: 20 }, { kind: 'symmetric', a: 0, b: 1, center: 0 }].slice(0, 5).concat([{ kind: 'lock', corner: 0 }, { kind: 'distanceX', a: 0, b: 3, value: 12.5 }]), area: 0.5 * (60 + 35) * 20 },
  };
  OUT.shapes = {};
  for (const [name, sh] of Object.entries(shapes)) {
    const rnd = mulberry(77); const errs = [], pol = []; let n = 0, cap = 0;
    for (let t = 0; t < 150; t++) {
      const pts = sh.base.map(([x, y], i) => (i === 0 ? [x, y] : [x + (rnd() * 2 - 1) * 2.5, y + (rnd() * 2 - 1) * 2.5]));
      const r = S.solveSketch(pts, sh.cons);
      if (r.overConstrained) continue;
      n++; errs.push(Math.abs(area(r.points) - sh.area) / sh.area); if (r.iterations >= 300) cap++;
      pol.push(Math.abs(area(polish(r.points, sh.cons).points) - sh.area) / sh.area);
    }
    OUT.shapes[name] = { solvedTrials: n, atCap: cap, relAreaErr: { median: e2(pct(errs, 0.5)), max: e2(Math.max(...errs)) }, shareAboveBar1e9: +(errs.filter((v) => v > BAR).length / n).toFixed(3), afterPolishMax: e2(Math.max(...pol)) };
    console.log('A2', name, JSON.stringify(OUT.shapes[name]));
  }
}

// ---- A3: the kernels see the SAME TS points: 3 rough-start pinned rectangles built on OCCT, brep-rs, SolidCraft, raw vs polished
{
  const rnd = mulberry(31337); const W = 40, Hh = 25, amp = 0.08 * Math.hypot(W, Hh);
  const cons = [H(0), V(1), H(2), V(3), Ln(0, W), Ln(1, Hh), { kind: 'lock', corner: 0 }];
  const base = L.runScript("const s=sketch('top'); s.rect(40,25); extrude(s,10)").doc;
  const mk = (points) => { const d = L.clone(base); const sk = d.features.find((f) => f.kind === 'sketch'); sk.points = points; sk.constraints = []; return d; };
  const rows = [];
  for (let t = 0; t < 3; t++) {
    const pts = [[0, 0], [W, 0], [W, Hh], [0, Hh]].map(([x, y], i) => (i === 0 ? [0, 0] : [x + (rnd() * 2 - 1) * amp, y + (rnd() * 2 - 1) * amp]));
    const raw = S.solveSketch(pts, cons); const pol = polish(raw.points, cons);
    const exact = W * Hh * 10;
    const run = (points) => { const d = mk(points); const last = d.features.at(-1).id; const o = L.occtMeasure(d, last), b = L.brepBuild(d), s = L.scTranslate(d); return { occt: o.volume, brep: b.volume, sc: s.volume }; };
    const a = run(raw.points), b = run(pol.points);
    const rel = (v) => e2(Math.abs(v - exact) / exact);
    rows.push({ trial: t, exactVolume: exact, raw: { iterations: raw.iterations, occtRel: rel(a.occt), brepRel: rel(a.brep), scRel: rel(a.sc) }, polished: { worst: e2(pol.worst), occtRel: rel(b.occt), brepRel: rel(b.brep), scRel: rel(b.sc) } });
  }
  OUT.kernelBuilds = rows; console.log('A3', JSON.stringify(rows));
}

// ---- A4: the `pinned` argument and the drag path
{
  const rnd = mulberry(5); const cons = [H(0), V(1), H(2), V(3), Ln(0, 40), Ln(1, 25)];
  let exactPinned = 0, N = 200, rulesHeld = 0, dragExact = 0, dragRulesHeld = 0, dragN = 100, dragViolations = [], afterSolveRulesHeld = 0, cameBack = [];
  for (let t = 0; t < N; t++) {
    const pts = [[0, 0], [40, 0], [40, 25], [0, 25]].map(([x, y]) => [x + (rnd() * 2 - 1) * 3, y + (rnd() * 2 - 1) * 3]);
    const r = S.solveSketch(pts, cons, [0]);
    if (r.points[0][0] === pts[0][0] && r.points[0][1] === pts[0][1]) exactPinned++;
    if (checkAll(r.points, cons, pts, 1e-5).ok) rulesHeld++;
  }
  // solveSketchDrag (packages/script model-codegen): drag corner 2 to a random feasible spot on the rect's constraints, i.e. translate the whole target
  const base = L.runScript("const s=sketch('top'); s.rect(40,25); s.length(1,40); s.length(2,25); s.pin(1); extrude(s,10)").doc;
  const sk0 = base.features.find((f) => f.kind === 'sketch'); const sid = sk0.id;
  for (let t = 0; t < dragN; t++) {
    const du = (rnd() * 2 - 1) * 6, dv = (rnd() * 2 - 1) * 6; const p2 = sk0.points[2];
    const out = L.modelCodegen.solveSketchDrag(base, { [`${sid}_p2u`]: p2[0] + du, [`${sid}_p2v`]: p2[1] + dv });
    const pts = sk0.points.map((p) => [...p]);
    for (const [name, v] of Object.entries(out)) { const m = /_p(\d+)([uv])$/.exec(name); if (m) pts[+m[1]][m[2] === 'u' ? 0 : 1] = v; }
    if (out[`${sid}_p2u`] === p2[0] + du && out[`${sid}_p2v`] === p2[1] + dv) dragExact++;
    { // the next solveDoc (every doc adoption runs it) re-solves with the rules and no pin: do the rules hold afterwards, and how far did the dragged corner come back?
      const d2 = L.clone(base); const k = d2.features.find((f) => f.kind === 'sketch'); for (const [name, v] of Object.entries(out)) { const m = /_p(\d+)([uv])$/.exec(name); if (m) k.points[+m[1]][m[2] === 'u' ? 0 : 1] = v; }
      const sd = L.modelCodegen.solveDoc(d2).features.find((f) => f.kind === 'sketch');
      if (checkAll(sd.points, sk0.constraints, sk0.points, 1e-5).ok) afterSolveRulesHeld++;
      cameBack.push(Math.hypot(sd.points[2][0] - (p2[0] + du), sd.points[2][1] - (p2[1] + dv)));
    }
    const chk = checkAll(pts, sk0.constraints, sk0.points, 1e-5);
    if (chk.ok) dragRulesHeld++; else if (dragViolations.length < 3) dragViolations.push({ du: +du.toFixed(3), dv: +dv.toFixed(3), worstKind: chk.worst.kind, worstResidual: e2(chk.worst.residual) });
  }
  OUT.pinnedAndDrag = { pinnedArg: { trials: N, pinnedCornerBitIdentical: exactPinned, allRulesHeldTo1e5: rulesHeld }, solveSketchDrag: { constraints: sk0.constraints.map((c) => c.kind + (c.edge !== undefined ? c.edge + 1 : '') + (c.value !== undefined ? '=' + c.value : '')), randomDragsOfCorner3: dragN, draggedCornerExactlyWhereAsked: dragExact, allRulesHeldAfterDrag1e5: dragRulesHeld, firstViolations: dragViolations, afterNextSolveDoc: { rulesHeld1e5: afterSolveRulesHeld, of: dragN, draggedCornerMovedBackMedianMm: e2(pct(cameBack, 0.5)), maxMm: e2(Math.max(...cameBack)) },
    note: 'a drag of one corner of a rect that has lock + two lengths + h/v: the dragged corner is pinned at the pointer, so a pointer move that the length rules cannot follow leaves a rule violated (the pointer wins by design); the studio calls it from ReshapeStudio.tsx:246 and :697.' } };
  console.log('A4', JSON.stringify(OUT.pinnedAndDrag));
}
writeFileSync(new URL('./r4a.json', import.meta.url), JSON.stringify(OUT, null, 1));
