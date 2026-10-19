// ROUND 4 section E: the TypeScript-only legacy features, measured against independent computations (no kernel, no pkg2): idempotence, seedForNewRule, collapsedByRatio, describe /
// removal notes / the contract's plain-sentence translator, losingEdges, sketchLabels, degenerate inputs, the overConstrained flag, legacy dof, reachability of each function.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/sketch-dof-diagnosis/r4e.mjs   (writes r4e.json)
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import * as R from './r4-lib.mjs';
import { plainRule, intendedRules, refuseSentence, solveIntended, properShape } from './legacy-guard.mjs';
import { polish, checkAll, signedResiduals, legacyDof } from './legacy-rules.mjs';
import { plainProblems } from './refusal-sentence.mjs';
import { analyse } from './indep.mjs';
import * as G from './legacy.mjs';

const { clone, e2, mulberry } = R;
const S = R.solve; const O = R.outline;
const OUT = {};
const area = (p) => G.polyArea(p);
const el = (p, e) => Math.hypot(p[(e + 1) % p.length][0] - p[e][0], p[(e + 1) % p.length][1] - p[e][1]);

// ---------------- E1: idempotent rule calls and replacement semantics, through runScript ----------------
{
  const sk = (src) => { const r = R.runScript(src); const f = r.doc?.features?.find((x) => x.kind === 'sketch'); return { errors: r.errors?.map((e) => e.message), cons: (f?.constraints ?? []).map((c) => JSON.stringify(c)), warnings: r.warnings ?? null }; };
  const pairs = [
    ['across twice', "const s=sketch('top'); s.rect(40,20); s.across(1); s.across(1)", "const s=sketch('top'); s.rect(40,20); s.across(1)"],
    ['length same value twice', "const s=sketch('top'); s.rect(40,20); s.length(1,40); s.length(1,40)", "const s=sketch('top'); s.rect(40,20); s.length(1,40)"],
    ['pin twice', "const s=sketch('top'); s.rect(40,20); s.pin(1); s.pin(1)", "const s=sketch('top'); s.rect(40,20); s.pin(1)"],
    ['distX same twice', "const s=sketch('top'); s.rect(40,20); s.distX(1,3,40); s.distX(1,3,40)", "const s=sketch('top'); s.rect(40,20); s.distX(1,3,40)"],
    ['equal twice', "const s=sketch('top'); s.rect(40,20); s.equal(1,2); s.equal(1,2)", "const s=sketch('top'); s.rect(40,20); s.equal(1,2)"],
    ['equal then parallel on one pair replaces', "const s=sketch('top'); s.rect(40,20); s.equal(1,2); s.parallel(1,2)", "const s=sketch('top'); s.rect(40,20); s.parallel(1,2)"],
    ['across then up on one edge replaces', "const s=sketch('top'); s.rect(40,20); s.across(1); s.up(1)", "const s=sketch('top'); s.rect(40,20); s.up(1)"],
  ];
  OUT.e1 = { rows: pairs.map(([name, a, b]) => { const x = sk(a), y = sk(b); return { name, sameDocAsSingleCall: JSON.stringify(x.cons) === JSON.stringify(y.cons) && !x.errors?.length, constraints: x.cons.length }; }) };
  OUT.e1.allIdempotent = OUT.e1.rows.every((r) => r.sameDocAsSingleCall);
  // not idempotent by design: two DIFFERENT values for one edge stack, then the settle drops the older
  const s2 = sk("const s=sketch('top'); s.rect(40,20); s.length(1,40); s.length(1,30)");
  OUT.e1.twoDifferentLengthsKeep = s2.cons.filter((c) => /length/.test(c));
  // distX argument order: docs say distX(a,b,v) holds x_b - x_a = v and that negative values are legal; the interpreter normalises (a,b) to (min,max) and keeps the value
  const dx = R.runScript("const s=sketch('top'); s.rect(40,30); s.distX(3,1,12); extrude(s,10)");
  const f = dx.doc.features.find((x) => x.kind === 'sketch');
  const solved = R.modelCodegen.solveDoc(dx.doc).features.find((x) => x.kind === 'sketch').points;
  OUT.e1.distXswapped = { call: 'distX(3,1,12)', docsMean: 'x(corner1) - x(corner3) = 12', stored: f.constraints.find((c) => c.kind === 'distanceX'), solvedX: solved.map((p) => +p[0].toFixed(4)), x3MinusX1: +(solved[2][0] - solved[0][0]).toFixed(4), x1MinusX3: +(solved[0][0] - solved[2][0]).toFixed(4) };
  console.log('E1', JSON.stringify({ ...OUT.e1, rows: undefined }), OUT.e1.rows.filter((r) => !r.sameDocAsSingleCall).map((r) => r.name));
}

// ---------------- E2: seedForNewRule as a function (independent rule check) and in the pipeline (single-rule scripts, raw vs guard) ----------------
{
  const rnd = mulberry(2024); let bad = 0, offOther = 0; const N = 300;
  for (let t = 0; t < N; t++) {
    const n = 4 + Math.floor(rnd() * 3);
    const pts = Array.from({ length: n }, (_, i) => [30 * Math.cos((2 * Math.PI * i) / n) + (rnd() - 0.5) * 6, 30 * Math.sin((2 * Math.PI * i) / n) + (rnd() - 0.5) * 6]);
    const e = Math.floor(rnd() * n); let o = Math.floor(rnd() * n); if (o === e) o = (o + 1) % n;
    const kind = ['parallel', 'perpendicular', 'equal'][t % 3]; const c = { kind, edge: e, other: o };
    const seed = S.seedForNewRule(pts, [c]); const oc = new Set([o, (o + 1) % n]);
    for (let k = 0; k < n; k++) if (!oc.has(k) && (seed[k][0] !== pts[k][0] || seed[k][1] !== pts[k][1])) { offOther++; break; }
    const r = signedResiduals(seed, [c], pts)[0]; if (Math.abs(r) > 1e-6) bad++;
  }
  OUT.e2fn = { randomPolygons: N, seedViolatesTheRule: bad, seedMovedACornerOffEdgeOther: offOther };
  // pipeline: runScript -> solveDoc, one rule per script on a few shapes; does the solved doc hold the rule? and the guard
  const shapes = { quad: 's.polygon([[0,0],[48,3],[41,30],[4,27]])', tri: 's.polygon([[0,0],[40,0],[12,26]])', L: 's.polygon([[0,0],[40,0],[40,10],[15,10],[15,30],[0,30]])', trap: 's.polygon([[0,0],[60,0],[45,20],[10,20.5]])' };
  const rows = []; let rawUnheld = 0, tot = 0, guardUnheld = 0, guardRefused = 0; const refusedEx = [];
  const { guardedLegacy } = await import('./legacy-guard.mjs');
  for (const [sn, head] of Object.entries(shapes)) {
    const n = sn === 'tri' ? 3 : sn === 'quad' || sn === 'trap' ? 4 : 6;
    for (const kind of ['parallel', 'perpendicular', 'equal']) for (let e = 1; e <= n; e++) for (const o of [e % n + 1, (e + 1) % n + 1]) {
      if (o === e) continue; const [a, b] = [Math.min(e, o), Math.max(e, o)];
      const src = `const s=sketch('top'); ${head}; s.${kind}(${a}, ${b}); extrude(s,10)`;
      const run = R.runScript(src); if (run.errors?.length) continue; tot++;
      const solved = R.modelCodegen.solveDoc(run.doc).features.find((f) => f.kind === 'sketch'); const sk0 = run.doc.features.find((f) => f.kind === 'sketch');
      const held = checkAll(solved.points, solved.constraints, sk0.points, 1e-6).ok;
      if (!held) { rawUnheld++; if (rows.length < 6) rows.push({ src: src.replace("const s=sketch('top'); ", ''), raw: 'rule not held in the doc that is built' }); }
      const g = guardedLegacy(src); if (g.outcome === 'built-ready') { const sk = g.doc.features.find((f) => f.kind === 'sketch'); if (!checkAll(sk.points, sk.constraints, sk0.points, 1e-9).ok) guardUnheld++; } else { guardRefused++; if (refusedEx.length < 8) refusedEx.push({ src: src.replace("const s=sketch('top'); ", ''), sentence: g.sentence }); }
    }
  }
  OUT.e2pipeline = { singleRuleScripts: tot, rawRuleNotHeld: rawUnheld, guardBuiltWithRuleNotHeld: guardUnheld, guardRefused, guardRefusedExamples: refusedEx, examples: rows };
  console.log('E2', JSON.stringify(OUT.e2fn), JSON.stringify({ ...OUT.e2pipeline, examples: undefined }));
}

// ---------------- E3: collapsedByRatio against an independent reimplementation, and what it drops ----------------
{
  const rnd = mulberry(99); let diff = 0; const N = 2000;
  for (let t = 0; t < N; t++) {
    const n = 3 + Math.floor(rnd() * 4);
    const a = Array.from({ length: n }, (_, i) => [20 * Math.cos((2 * Math.PI * i) / n) + (rnd() - 0.5) * 5, 20 * Math.sin((2 * Math.PI * i) / n) + (rnd() - 0.5) * 5]);
    const b = a.map(([x, y]) => [x * (0.1 + rnd() * 1.4), y * (0.1 + rnd() * 1.4)]);
    let ind = false; for (let i = 0; i < n; i++) { const e0 = el(a, i); if (e0 >= 1e-9 && el(b, i) < 0.25 * e0) ind = true; }
    if (!ind && area(a) >= 1e-9 && area(b) < 0.25 * area(a)) ind = true;
    if (ind !== S.collapsedByRatio(a, b)) diff++;
  }
  const sq = [[0, 0], [40, 0], [40, 40], [0, 40]];
  OUT.e3 = { randomPairs: N, differFromIndependentReimplementation: diff, edgeExactly25pct: S.collapsedByRatio(sq, [[0, 0], [10, 0], [40, 40], [0, 40]]), edgeJustUnder25pct: S.collapsedByRatio(sq, [[0, 0], [9.99, 0], [40, 40], [0, 40]]),
    legalShrinkRefused: ['rect 40x30 length(1,8)', 'rect 40x30 length(1,10)', 'rect 40x30 length(2,6)', 'rect 40x30 length(1,3)'].map((name, i) => { const src = ["const s=sketch('top'); s.rect(40,30); s.length(1,8)", "const s=sketch('top'); s.rect(40,30); s.length(1,10)", "const s=sketch('top'); s.rect(40,30); s.length(2,6)", "const s=sketch('top'); s.rect(40,30); s.length(1,3)"][i]; const r = R.runScript(src + '; extrude(s,10)'); const f = R.modelCodegen.solveDoc(r.doc).features.find((x) => x.kind === 'sketch'); return { name, builtArea: area(f.points), wantedArea: [240, 300, 240, 90][i], warnings: r.warnings ?? null }; }) };
  console.log('E3', JSON.stringify(OUT.e3));
}

// ---------------- E4: describe(), describeRemovalNote(Pair), RunResult.warnings and the plain translator: lint; and reachability ----------------
{
  const all = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'length', edge: 2, value: 7.5 }, { kind: 'equal', edge: 0, other: 2 }, { kind: 'parallel', edge: 0, other: 2 }, { kind: 'perpendicular', edge: 0, other: 1 },
    { kind: 'distanceX', a: 0, b: 2, value: 12 }, { kind: 'distanceY', a: 0, b: 2, value: -3 }, { kind: 'symmetric', a: 0, b: 2, center: 1 }, { kind: 'angle', edge: 0, other: 1, degrees: 30 }, { kind: 'lock', corner: 3 }];
  const symbolic = (s) => /[^\x20-\x7e]/.test(s) || / -- /.test(s) || /=/.test(s) || /→|∥|⊥/.test(s);
  const full = (p) => { const bad = plainProblems(p); if (symbolic(p)) bad.push('symbols'); return bad; };
  const desc = all.map((c) => ({ kind: c.kind, describe: S.describe(c), problems: symbolic(S.describe(c)) ? ['symbols or fragment'] : [] }));
  const notes = all.map((c) => { const t = S.describeRemovalNote(c, { kind: 'horizontal', edge: 4 }); return { kind: c.kind, text: t, problems: full(t), mentionsUndo: /undo/i.test(t) }; });
  const plain = all.map((c) => { const s = refuseSentence(c); return { kind: c.kind, phrase: plainRule(c), sentence: s, problems: full(s) }; });
  const warn = (() => { const r = R.runScript("const s=sketch('top'); s.rect(40,30); s.length(1,8); extrude(s,10)"); return r.warnings?.[0] ?? null; })();
  OUT.e4 = { describeAsShipped: { kinds: desc.length, symbolicOrFragment: desc.filter((d) => d.problems.length).length, rows: desc },
    removalNotesAsShipped: { kinds: notes.length, failingPlainTest: notes.filter((n) => n.problems.length).length, mentionUndo: notes.filter((n) => n.mentionsUndo).length, firstProblems: notes.slice(0, 3).map((n) => [n.text, n.problems]) },
    runResultWarning: { text: warn, problems: warn ? full(warn) : null },
    translator: { kinds: plain.length, failingPlainTest: plain.filter((p) => p.problems.length).length, rows: plain.map((p) => [p.kind, p.phrase]) } };
  // reachability: does anything in packages/*/src call these?
  const grep = (sym) => { try { return execSync(`grep -rn --include=*.ts --include=*.tsx -E "\\b${sym}\\(" packages/*/src | grep -v "^packages/sketch/src/sketch-solve.ts" | grep -v "^\\S*:[0-9]*:\\s*(//|\\*)" | head -5`, { cwd: R.REPO, encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };
  OUT.e4.reachability = Object.fromEntries(['losingEdges', 'describeRemovalNote', 'describeRemovalNotePair', 'sketchLabels', 'circleLabel', 'seedForNewRule', 'addConstraintSettling', 'collapsedByRatio', 'solveSketchDrag', 'describe'].map((s) => [s, grep(s)]));
  console.log('E4', JSON.stringify({ ...OUT.e4, describeAsShipped: { ...OUT.e4.describeAsShipped, rows: undefined }, translator: { ...OUT.e4.translator, rows: undefined } }), JSON.stringify(Object.fromEntries(Object.entries(OUT.e4.reachability).map(([k, v]) => [k, v.length]))));
}

// ---------------- E5: losingEdges ----------------
{
  const rnd = mulberry(5); const HVc = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }];
  let n = 0, contains = 0, empty = 0, over = 0;
  for (let t = 0; t < 300; t++) {
    const pts = [[0, 0], [40, 0], [40, 25], [0, 25]].map(([x, y]) => [x + (rnd() - 0.5) * 2, y + (rnd() - 0.5) * 2]);
    const e = Math.floor(rnd() * 4); const cs = [...HVc, { kind: 'length', edge: e, value: 40 }, { kind: 'length', edge: e, value: 30 }];  // two lengths on one edge: both rules are the culprits
    const r = S.solveSketch(pts, cs); if (!r.overConstrained) continue; n++;
    const l = S.losingEdges(r.points, cs); if (l.length === 0) empty++; if (l.includes(e)) contains++; if (l.length > 1) over++;
  }
  const p = [[0, 0], [40, 0], [40, 25], [0, 25]]; const cons = [{ kind: 'distanceX', a: 0, b: 2, value: 40 }, { kind: 'distanceX', a: 0, b: 2, value: 30 }];
  const r = S.solveSketch(p, cons);
  OUT.e5 = { twoLengthsOnOneEdge: { overConstrainedCases: n, namesTheEdge: contains, returnsNothing: empty, alsoNamesOtherEdges: over }, cornerRulesConflict: { overConstrained: r.overConstrained, losingEdges: S.losingEdges(r.points, cons), note: 'distanceX 40 vs 30 between two corners: the flag is raised and no edge is named, so nothing could be drawn red' } };
  console.log('E5', JSON.stringify(OUT.e5));
}

// ---------------- E6: sketchLabels / circleLabel / formatLabel ----------------
{
  const L1 = O.sketchLabels([[0, 0], [40, 0], [40, 25], [0, 25]], [{ kind: 'length', edge: 0, value: 40 }]);
  const lens = [40, 25, 40, 25];
  const e1 = L1.edges.map((e) => ({ edge: e.edge, kind: e.kind, text: e.text }));
  const bowErr = []; for (const b of [0.5, -0.5, 1, 0.001, 2]) { const LL = O.sketchLabels([[0, 0], [40, 0], [40, 25], [0, 25]], [], undefined, undefined, { 0: b }); const want = Math.abs(b * 40 / 2); bowErr.push({ bulge: b, text: LL.bows[0]?.text, wantAbs: want }); }
  const rc = O.sketchLabels([[0, 0], [40, 0], [40, 25], [0, 25]], [], { 1: 3 }, { 2: 2.5 });
  OUT.e6 = { rectEdges: e1, lengthKindForTheRuledEdge: e1.find((e) => e.edge === 0)?.kind, textsMatchLengths: e1.every((e, i) => Number(e.text) === lens[i] || e.text === O.formatLabel(lens[i])), bows: bowErr, corners: rc.corners.map((c) => `${c.corner}:${c.kind}:${c.text}`),
    circle: { diameter: O.circleLabel([[0, 0], [10, 0]]), none: O.circleLabel([[0, 0], [1, 0], [1, 1]]) }, formatLabel: [3, 3.5, 3.14159, 0.00001, -2.5, 1e6, NaN, Infinity].map((v) => [String(v), O.formatLabel(v)]) };
  console.log('E6', JSON.stringify(OUT.e6).slice(0, 700));
}

// ---------------- E7: solveSketch degenerate inputs and scale ----------------
{
  const HVc = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }]; const base = [[0, 0], [60, 0], [60, 30], [0, 30]];
  const t = (cs) => { try { const r = S.solveSketch(base, cs); return { over: r.overConstrained, residual: String(r.residual), pointsFinite: r.points.every((p) => p.every(Number.isFinite)) }; } catch (e) { return { threw: String(e.message).slice(0, 80) }; } };
  const sweep = [1, 1e3, 1e5].map((k) => { let fp = 0; const rnd = mulberry(3); for (let i = 0; i < 40; i++) { const p = [[0, 0], [40, 0], [40, 30], [0, 30]].map(([x, y]) => [(x + (rnd() - 0.5) * 6) * k, (y + (rnd() - 0.5) * 6) * k]); if (S.solveSketch(p, [...HVc, { kind: 'length', edge: 0, value: 40 * k }, { kind: 'length', edge: 1, value: 30 * k }]).overConstrained) fp++; } return { scale: k, falseOverConstrained: fp, of: 40 }; });
  const tiny = [60.0005, 60.001, 60.002, 61].map((v) => { const r = S.solveSketch(base, [...HVc, { kind: 'length', edge: 0, value: 60 }, { kind: 'length', edge: 0, value: v }]); return { secondLength: v, overConstrained: r.overConstrained, residual: e2(r.residual) }; });
  OUT.e7 = { nanLength: t([...HVc, { kind: 'length', edge: 0, value: NaN }]), infLength: t([...HVc, { kind: 'length', edge: 0, value: Infinity }]), edgeIndex7: t([{ kind: 'horizontal', edge: 0 }, { kind: 'length', edge: 7, value: 20 }]), edgeIndexMinus1: t([{ kind: 'horizontal', edge: 0 }, { kind: 'length', edge: -1, value: 20 }]), edgeIndex1p5: t([{ kind: 'horizontal', edge: 0 }, { kind: 'length', edge: 1.5, value: 20 }]), scaleSweep: sweep, absoluteThreshold1e3: tiny };
  console.log('E7', JSON.stringify(OUT.e7));
}

// ---------------- E8: overConstrained flag vs an independent feasibility test (random rule sets on polygons) ----------------
{
  const rnd = mulberry(8); const BASES = { rect: [[0, 0], [40, 0], [40, 25], [0, 25]], tri: [[0, 0], [40, 0], [12, 26]], quad: [[0, 0], [48, 3], [41, 30], [4, 27]], L: [[0, 0], [40, 0], [40, 10], [15, 10], [15, 30], [0, 30]] };
  let falseOver = 0, missed = 0, ok = 0, N = 0, recovered = 0; const ex = []; const missedEx = [];
  for (let t = 0; t < 400; t++) {
    const bn = ['rect', 'tri', 'quad', 'L'][Math.floor(rnd() * 4)]; const pts = BASES[bn]; const n = pts.length; const k = 1 + Math.floor(rnd() * 5); const cs = [];
    for (let i = 0; i < k; i++) { const u = rnd(); const e = Math.floor(rnd() * n); let o = Math.floor(rnd() * n); if (o === e) o = (e + 1) % n;
      if (u < 0.3) cs.push({ kind: 'length', edge: e, value: Math.round(el(pts, e) * [0.4, 0.8, 1, 1.3][Math.floor(rnd() * 4)] * 2) / 2 }); else if (u < 0.45) cs.push({ kind: 'horizontal', edge: e }); else if (u < 0.6) cs.push({ kind: 'vertical', edge: e });
      else if (u < 0.7) cs.push({ kind: 'equal', edge: Math.min(e, o), other: Math.max(e, o) }); else if (u < 0.8) cs.push({ kind: 'parallel', edge: Math.min(e, o), other: Math.max(e, o) }); else if (u < 0.9) cs.push({ kind: 'perpendicular', edge: Math.min(e, o), other: Math.max(e, o) }); else cs.push({ kind: 'lock', corner: e }); }
    const sp = G.toSoup(pts, cs); const a = (() => { for (let s = 0; s < 30; s++) { const gm = s === 0 ? sp.geoms : sp.geoms.map((g) => ({ ...g, a: [g.a[0] + (rnd() - 0.5) * 8, g.a[1] + (rnd() - 0.5) * 8], b: [g.b[0] + (rnd() - 0.5) * 8, g.b[1] + (rnd() - 0.5) * 8] })); const locked = sp.rules.filter((r) => r.k === 'lock').map((r) => r.a); const gg = gm.map((g, i) => (locked.includes(g.id) ? { ...g, a: sp.geoms[i].a } : g)); try { const r = analyse(gg, sp.rules); if (r.consistent) return true; } catch { /* next */ } } return false; })();
    const r = S.solveSketch(pts, cs); N++;
    if (r.overConstrained && a) { falseOver++; { const sol = solveIntended(pts, cs); if (sol.points) recovered++; } if (ex.length < 4) ex.push({ base: bn, cs: cs.map((c) => c.kind + (c.edge ?? c.corner ?? '') + (c.value !== undefined ? '=' + c.value : '')), residual: e2(r.residual) }); }
    else if (!r.overConstrained && !a) { missed++; if (missedEx.length < 4) missedEx.push({ base: bn, cs: cs.map((c) => c.kind + (c.edge ?? c.corner ?? '') + (c.value !== undefined ? '=' + c.value : '')), residual: e2(r.residual) }); } else ok++;
  }
  OUT.e8 = { cases: N, flagAgreesWithIndependentFeasibility: ok, flaggedButFeasible: falseOver, guardRecoveredFalseFlags: recovered, notFlaggedButInfeasible: missed, examples: ex, missedExamples: missedEx, maxResidualOfMissed: e2(Math.max(0, ...missedEx.map((m) => +m.residual))), note: 'feasible = indep.mjs (its own LM) converges from the drawn start or one of 29 jitters, any shape; a flagged-but-feasible case is a basin miss of the TS solver (it jitters 6 times)' };
  console.log('E8', JSON.stringify(OUT.e8));
}

// ---------------- E9: dof of LEGACY sketches (solveSketch has none): the contract helper legacyDof against hand counts ----------------
{
  const rows = [];
  for (const c of G.DETERMINED) { const r = S.solveSketch(c.pts, c.cons); const q = polish(r.points, c.cons); rows.push({ id: c.id, hand: 0, helper: legacyDof(q.points, c.cons).dof, dependent: legacyDof(q.points, c.cons).dependentRules }); }
  for (const c of G.UNDER) { const r = S.solveSketch(c.pts, c.cons); const q = polish(r.points, c.cons); rows.push({ id: c.id, hand: c.dof, helper: legacyDof(q.points, c.cons).dof, dependent: legacyDof(q.points, c.cons).dependentRules }); }
  for (const c of G.REDUNDANT) { const r = S.solveSketch(c.pts, c.cons); const q = polish(r.points, c.cons); const d = legacyDof(q.points, c.cons); rows.push({ id: c.id, hand: 'redundant', helper: d.dof, dependent: d.dependentRules }); }
  OUT.e9 = { rows, solveSketchHasDofField: 'dof' in S.solveSketch([[0, 0], [1, 0], [1, 1]], [{ kind: 'horizontal', edge: 0 }]), allMatchHand: rows.filter((r) => typeof r.hand === 'number').every((r) => r.hand === r.helper), redundantDetected: rows.filter((r) => r.hand === 'redundant').map((r) => r.dependent) };
  console.log('E9', JSON.stringify(OUT.e9));
}
writeFileSync(new URL('./r4e.json', import.meta.url), JSON.stringify(OUT, null, 1));
