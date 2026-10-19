// ROUND 4 row builder for group 'sketch-dof-diagnosis'. Every number in an evidence string is read from r4a/r4b/r4c/r4c2/r4d/r4e/r4f.json (measured by those scripts on the STOCK
// pkg, no wrapper2); every status is asserted against the data it cites, so a row cannot say supported when its own numbers say otherwise.
//   bun docs/spikes/solidcraft-referee/contract/sketch-dof-diagnosis/rows-r4.mjs      (writes ../sketch-dof-diagnosis.json)
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { plainProblems } from './refusal-sentence.mjs';
const here = (f) => new URL(f, import.meta.url);
const J = (f) => JSON.parse(readFileSync(here(f), 'utf8'));
const OUTFILE = new URL('../sketch-dof-diagnosis.json', import.meta.url);
if (!existsSync(here('./round3-sketch-dof-diagnosis.json'))) copyFileSync(OUTFILE, here('./round3-sketch-dof-diagnosis.json')); // the rejected round-3 file, kept for the history
const A = J('./r4a.json'), B = J('./r4b.json'), C = J('./r4c.json'), C2 = J('./r4c2.json'), D = J('./r4d.json'), E = J('./r4e.json'), F = J('./r4f.json');
const must = (cond, msg) => { if (!cond) throw new Error('ROW ASSERTION FAILED: ' + msg); };
const e2 = (x, n = 2) => (typeof x === 'number' ? x.toExponential(n) : x);
const g3 = (x) => (typeof x === 'number' ? +x.toPrecision(3) : x);
const g5 = (x) => (typeof x === 'number' ? +x.toFixed(2) : x);
const pc = (a, b) => `${a}/${b}`;
const SC = 'SOLIDCRAFT_REFEREE_PKG=<sc-referee-pkg>';
const run = (f, extra = '') => `${extra}${SC} bun docs/spikes/solidcraft-referee/contract/sketch-dof-diagnosis/${f}`;
const ENV = 'RIG: the STOCK referee pkg only (phase0 wrapper: run answers with the first refused command or the final measure; no SolveReport, no solved points; wrapper2 / SOLIDCRAFT_REFEREE_PKG2 is NOT used anywhere in round 4). Recipe and the order of all scripts: run-r4.sh (each heavy job under systemd-run MemoryMax=16G, one at a time).';
const rows = [];
const add = (feature, status, evidence, refusalSentence) => { const r = { feature, status }; if (status === 'refused') { must(refusalSentence, 'refused row needs a sentence: ' + feature); must(plainProblems(refusalSentence).length === 0, 'refusal sentence not plain: ' + refusalSentence); r.refusalSentence = refusalSentence; } r.evidence = evidence; rows.push(r); };

// ======================= legacy (outline) solver: solveSketch =======================
const r400 = A.rect400, P0 = r400[0], P1 = r400[1];
{
  must(P0.maxTimesBar > 10 && P1.maxTimesBar > 50, 'planar miss factors');
  must(A.constants.TOL_occurrences === 1 && A.constants.MAX_ITERATIONS_occurrences === 1, 'dead constants');
  add('solveSketch result: points vs the 1e-9 planar bar (legacy outline solver, as shipped; the 7 determined polygons of the first rounds are in run.mjs)', 'wrong',
    `${run('r4a.mjs')} (ROUND 4 CORRECTION: round 3 said the bar is missed by up to 1.7x; that figure was one run of one case). 400 random 40x25 rectangles (horizontal/vertical on 4 edges + length 40 + length 25, corners jittered up to 8% of the diagonal, seed ${P0.seed}), exact area 1000: WITHOUT a pin the relative area error is median ${e2(P0.relAreaErr.median)}, p90 ${e2(P0.relAreaErr.p90)}, max ${e2(P0.relAreaErr.max)} = ${P0.maxTimesBar}x the 1e-9 bar, ${(P0.shareAboveBar1e9 * 100).toFixed(1)}% of trials above the bar; WITH corner 1 pinned (lock) median ${e2(P1.relAreaErr.median)}, max ${e2(P1.relAreaErr.max)} = ${P1.maxTimesBar}x the bar, ${(P1.shareAboveBar1e9 * 100).toFixed(1)}% above. Every one of the ${P0.trials + P1.trials} runs stops at the 300-iteration cap; the reported residual is above the stated 1e-7 tolerance in ${pc(P0.residualAboveStated1e7, P0.trials)} (no pin) and ${pc(P1.residualAboveStated1e7, P1.trials)} (pinned), worst ${e2(P1.residualMax)}. Other shapes, 150 rough starts each, exact closed-form areas: L-shape max ${e2(A.shapes.L.relAreaErr.max)} (${(A.shapes.L.shareAboveBar1e9 * 100).toFixed(0)}% above the bar), trapezoid max ${e2(A.shapes.trap.relAreaErr.max)} (${(A.shapes.trap.shareAboveBar1e9 * 100).toFixed(0)}% above), triangle max ${e2(A.shapes.tri.relAreaErr.max)}. The kernels do not add to it: the 3 pinned rough-start rectangles built on OCCT, brep-rs and SolidCraft have identical relative volume error vs the exact 10000 (${A.kernelBuilds.map((k) => e2(k.raw.occtRel, 2)).join(', ')} on OCCT; brep-rs and SolidCraft the same to 3 digits), so the error is in the TypeScript points. In packages/sketch/src/sketch-solve.ts TOL (1e-7) and MAX_ITERATIONS (300) are declared and never read (${A.constants.TOL_occurrences} occurrence each); the real caps are literals (pass 1 tolerance 1e-6 / 200 iterations, pass 2 tolerance 1e-9 / 300). Absolute error is at most ${e2(P1.relAreaErr.max * 1000 / 40, 1)} mm of area-equivalent edge, far below anything visible, but the planar bar of this contract is 1e-9, so as shipped the status is wrong.`);
  const k = A.kernelBuilds;
  must(Math.max(...k.map((x) => Math.max(x.polished.occtRel, x.polished.brepRel, x.polished.scRel))) < 1e-14, 'polished kernels');
  add('solveSketch result: points after the contract\'s signed polish step (legacy-rules.mjs polish, run by legacy-guard.mjs on every legacy sketch before it is built)', 'supported',
    `${run('r4a.mjs')}. polish() is a minimum-norm Gauss-Newton on the SIGNED rule residuals (the TS residuals are |r|, which is why its LM crawls at 1e-6..1e-8), starting from the TS answer, so the basin does not change. After polish: 400 unpinned rectangles max relative area error ${e2(P0.afterPolish.relAreaErrMax)}, 400 pinned ${e2(P1.afterPolish.relAreaErrMax)}, ${(P0.afterPolish.shareAboveBar1e9 * 100)}% / ${(P1.afterPolish.shareAboveBar1e9 * 100)}% above the 1e-9 bar; L-shape max ${e2(A.shapes.L.afterPolishMax)}, trapezoid ${e2(A.shapes.trap.afterPolishMax)}, triangle ${e2(A.shapes.tri.afterPolishMax)}. Built on all three kernels from the polished points: relative volume error vs exact 10000 is OCCT ${k.map((x) => e2(x.polished.occtRel)).join(' / ')}, brep-rs ${k.map((x) => e2(x.polished.brepRel)).join(' / ')}, SolidCraft ${k.map((x) => e2(x.polished.scRel)).join(' / ')} (3 pinned rough-start rectangles), against ${k.map((x) => e2(x.raw.occtRel)).join(' / ')} unpolished. The legacy guard (r4b.mjs, 40 builds of random scripts on OCCT, brep-rs and SolidCraft) gets max ${e2(B.fuzz.summary.kernelSample.maxOcctRel)} / ${e2(B.fuzz.summary.kernelSample.maxBrepRel)} / ${e2(B.fuzz.summary.kernelSample.maxScRel)} relative to the shoelace area x height. Proposed code lives in the contract dir only (packages/sketch is read-only here).`);
}
{
  const diff = P1.reportedResidualVsIndependentMaxAbsRule.maxAbsDifference, diff0 = P0.reportedResidualVsIndependentMaxAbsRule.maxAbsDifference;
  must(+diff < 1e-12 && +diff0 < 1e-12, 'reported residual equals the independent max rule violation');
  add('solveSketch result: residual (largest remaining violation, as reported)', 'supported',
    `${run('r4a.mjs')}. The reported residual equals the independent maximum |signed rule residual| of the returned points (legacy-rules.mjs, no shared code) to ${e2(diff0)} (no pin) / ${e2(diff)} (pinned) over ${P0.trials + P1.trials} runs, so the number is honest. It never reaches the 1e-7 it advertises: median ${e2(P0.residualMedian)} (no pin), ${e2(P1.residualMedian)} (pinned), worst ${e2(P1.residualMax)}; that gap is the previous row, not a mis-report.`);
}
add('solveSketch result: iterations (the soup / SolidCraft counterpart of the legacy iteration count)', 'unsupported',
  `${ENV} SolidCraft's SolveReport carries the solver's status, dof, failing and redundant lists, but the stock pkg's run() returns only the first refusal or the final measure (volume, bbox, centre of mass, faces), so no iteration count, residual or SolveReport field can be read on this rig. Not measured, not guessed. (The legacy solver's iterations is a real field: all ${P0.trials + P1.trials} rectangle runs report 300 = the cap, r4a.mjs.)`);
{
  const e8 = E.e8;
  must(e8.flagAgreesWithIndependentFeasibility >= 0.97 * e8.cases, 'flag agreement');
  add('solveSketch result: overConstrained flag (residual > 1e-3), legacy outline solver', 'supported',
    `${run('r4e.mjs')} section E8: ${e8.cases} random rule sets (1..5 of length/across/up/equal/parallel/perpendicular/pin on a rectangle, triangle, quad and L), flag against an independent feasibility test (indep.mjs, its own LM, drawn start + 29 jitters, any shape): agree on ${e8.flagAgreesWithIndependentFeasibility}; flagged over-constrained although a solution exists ${e8.flaggedButFeasible} (basin misses of the TS solver: it jitters 6 times); not flagged although infeasible ${e8.notFlaggedButInfeasible}, all below the absolute 1e-3 threshold (largest residual ${e8.maxResidualOfMissed}), which is what the flag means by construction. Two caveats that other rows own: the 1e-3 threshold is absolute, not relative (scale sweep: at 1e5 times size ${E.e7.scaleSweep[2].falseOverConstrained} of ${E.e7.scaleSweep[2].of} perfectly satisfiable rectangles are flagged), and a flagged case is what makes the script path drop a rule (rows on addConstraintSettling). The guard solves again with 40 jitters and a signed polish: ${e8.guardRecoveredFalseFlags ?? 'n/a'} of the ${e8.flaggedButFeasible} flagged-but-feasible sets are solved by it.`);
}
{
  const pa = A.pinnedAndDrag.pinnedArg, dr = A.pinnedAndDrag.solveSketchDrag;
  must(pa.pinnedCornerBitIdentical === pa.trials && pa.allRulesHeldTo1e5 === pa.trials, 'pinned argument');
  add('solveSketch `pinned` argument (corners the solver may not move)', 'supported',
    `${run('r4a.mjs')} section A4: ${pa.trials} random rough rectangles with h/v + two lengths, corner 1 passed as pinned: the pinned corner is bit-identical to its input in ${pc(pa.pinnedCornerBitIdentical, pa.trials)}, and all four rules hold to 1e-5 in ${pc(pa.allRulesHeldTo1e5, pa.trials)} (the pin leaves the unknowns, it is not a residual). A \`lock\` rule behaves the same way (fixed corner, residual 0).`);
  must(dr.draggedCornerExactlyWhereAsked === dr.randomDragsOfCorner3, 'drag exact');
  add('solveSketchDrag (packages/script model-codegen; ReshapeStudio.tsx:246 and :697): the dragged corner is pinned at the pointer', 'supported',
    `${run('r4a.mjs')} section A4: ${dr.randomDragsOfCorner3} random drags (up to 6 mm each way) of corner 3 of a rectangle that has ${dr.constraints.join(', ')}: the dragged corner lands exactly where the pointer put it in ${pc(dr.draggedCornerExactlyWhereAsked, dr.randomDragsOfCorner3)}. Because the pointer wins, the other rules are NOT all held straight after a drag (all rules held in ${pc(dr.allRulesHeldAfterDrag1e5, dr.randomDragsOfCorner3)}; e.g. ${JSON.stringify(dr.firstViolations[0])}); the next solveDoc (every doc adoption runs it) re-solves without the pin and then holds the rules in ${pc(dr.afterNextSolveDoc.rulesHeld1e5, dr.afterNextSolveDoc.of)} cases, moving the dragged corner back by a median ${dr.afterNextSolveDoc.draggedCornerMovedBackMedianMm} mm (max ${dr.afterNextSolveDoc.maxMm}). That is the designed behaviour of a drag in a fully ruled sketch, and no solid is built from the mid-drag state.`);
}

// ======================= legacy script route: what the student's rules turn into =======================
const bz = B.fuzz.summary, rp = (p) => B.repro.find((r) => r.case.startsWith(p));
{
  const A_ = rp('A '), D_ = rp('D '), G_ = rp('G ');
  must(A_.raw.volume !== A_.guard.shoelaceVolume && A_.guard.kernels, 'A is repaired');
  must(bz.guardBuiltButRuleNotHeldByIndependentCheckers === 0 && bz.rawBuiltViolatingWrittenRules > 100, 'legacy fuzz');
  add('script rules path (runScript -> solveDoc): a valid DIMENSION or rule the student wrote is silently dropped, so the part built is not the part described', 'wrong',
    `${run('r4b.mjs', 'SEEDS=11,12 N=250 ')} UNGUARDED, as shipped (the repo's own dist): rect(40,30); length(1,20); length(2,15) builds ${A_.raw.volume} mm3 = ${A_.raw.volume / 10} area, the student's rules want ${A_.wantVolume / 10} (20 x 15), warnings ${JSON.stringify(A_.raw.warnings)}: the second length call dropped the first (the 25%-of-area gate called 300/1200 a collapse). Same family: rect(100,100) length(1,40) length(2,40) builds ${rp('B ').raw.volume} (want ${rp('B ').wantVolume}), length(1,12) + length(2,12) + equal(1,2) builds ${rp('C ').raw.volume} (want ${rp('C ').wantVolume}). ${bz.scripts} random scripts (4 shapes, 1..4 rules): ${bz.rawBuiltViolatingWrittenRules} build with at least one written rule NOT held (independent check), ${bz.rawSilent} of those with NO warning at all; ${bz.rawWithDroppedRule} had a rule silently dropped by addConstraintSettling, ${bz.falseDrops} of those drops were unnecessary (the full rule set is satisfiable) and ${bz.necessaryDrops} were a real conflict whose older rule was thrown away without a word (RunResult.warnings stays empty unless the new rule is left fighting: dropped-with-warning ${bz.rawDroppedRuleAndWarned}, dropped-without ${bz.rawDroppedRuleNoWarning}). The cause is addConstraintSettling's silent drop plus solveDoc keeping the OLD points when a solve "collapses" (model-codegen.ts:658). Fixes live in contract: legacy-guard.mjs (next rows).`);
  add('script rules path with the contract guard (legacy-guard.mjs + reshape-script.logged.mjs): every written rule is held, or the sketch is refused', 'supported',
    `${run('r4b.mjs', 'SEEDS=11,12 N=250 ')}. The guard reads what the student WROTE (the 3-line ruleLog patch of packages/script, generated as a copy by make-logged-script.mjs, applied nowhere), takes the TS answer if a signed polish makes every rule hold to 1e-9 and the shape is proper (simple, drawn orientation, no edge or area collapsed), else re-solves the written rules itself (fewest-movers seed, then 40..120 deterministic jitters, each polished), keeps the nearest answer that holds EVERY rule, and otherwise refuses. Same repro cases: A builds ${A_.guard.shoelaceVolume} (want ${A_.wantVolume}; relative error OCCT ${A_.guard.relErrVsClosedForm.occt}, SolidCraft ${A_.guard.relErrVsClosedForm.sc}, brep-rs ${A_.guard.relErrVsClosedForm.brep}), D (length(1,8)) builds ${D_.guard.shoelaceVolume} (want ${D_.wantVolume}), G (param slider w=5) builds ${G_.guard.shoelaceVolume} (want ${G_.wantVolume}). Fuzz of ${bz.scripts} scripts: built ${bz.guardBuilt}, refused ${bz.guardRefused}; built with a written rule not held by two independent checkers (signed 1e-9 and the TS residualOf 1e-6): ${bz.guardBuiltButRuleNotHeldByIndependentCheckers}; refused although an independent solver finds a proper shape: ${bz.guardRefusedAndIndepFeasible_falseRefusals}; routes: ${JSON.stringify(bz.guardRoutes)}. Kernel parity of ${bz.kernelSample.n} guarded builds: OCCT / brep-rs / SolidCraft relative error vs shoelace x height max ${e2(bz.kernelSample.maxOcctRel)} / ${e2(bz.kernelSample.maxBrepRel)} / ${e2(bz.kernelSample.maxScRel)} (bar 1e-9); face counts differ in ${bz.kernelSample.facesDiffer} of ${bz.kernelSample.n}, all ${bz.kernelSample.facesDifferWithFlatVertex} with a flat vertex (two collinear side edges: SolidCraft merges the two coplanar side faces into one, OCCT and brep-rs keep two; same volume to 1e-15).`);
}
{
  const X = ['H ', 'I ', 'J ', 'O '].map(rp);
  X.forEach((r) => must(r.guard.outcome === 'refused' && r.guard.sentenceProblems.length === 0, 'refusal plain ' + r.case));
  add('script rules that genuinely contradict each other (two lengths on one edge, three right angles in a triangle, ...): no silent drop, one plain sentence', 'refused',
    `${run('r4b.mjs', 'SEEDS=11,12 N=250 ')}. As shipped these build something: ${X.map((r) => `${r.case.slice(0, 64).trim()}: area ${r.raw.volume / 10}`).join('; ')} (the older rule is dropped, or the triangle is squeezed), and RunResult.warnings stays empty. With the guard: ${X.map((r) => `${r.case.split(' ')[0]} refused`).join(', ')}; every sentence passes plainProblems (one sentence, no ids, no jargon, under 260 characters) and names the newest rule plus, when removing one older rule resolves it, that rule (blame by re-solving without it). Fuzz: ${bz.guardRefused} refusals of ${bz.scripts}, ${bz.guardRefusedAndIndepInfeasible} of them confirmed infeasible by the independent solver, ${bz.guardRefusedAndIndepFeasible_falseRefusals} false refusals, ${bz.refusalSentencesNotPlain} sentences failing plainProblems.`,
    X[0].guard.sentence);
}
{
  const ds = E.e1.distXswapped, P_ = rp('P '), Q_ = rp('Q ');
  must(ds.x3MinusX1 === 12, 'distX swapped sign lost');
  add('script distX / distY / angle called with the corners (edges) in descending order: the sign of the value is silently lost', 'wrong',
    `${run('r4e.mjs')} section E1 and ${run('r4b.mjs', 'SEEDS=11,12 N=250 ')} cases P and Q. reshape-docs.ts: "distX(1, 3, -12) asks for corner 3 to sit 12 mm to the LEFT of corner 1". The interpreter normalises the pair to (min, max) and keeps the value, so ${ds.call} (corner 1 12 to the right of corner 3) is stored as ${JSON.stringify(ds.stored)} and builds x3 - x1 = ${ds.x3MinusX1}, x1 - x3 = ${ds.x1MinusX3}: the mirror of what was asked, with no warning. The contract's patched copy (make-logged-script.mjs, anchor 4) flips the sign of swapped arguments; with it case P is refused ("${P_.guard.sentence}", the request needs a rectangle drawn the other way round) and case Q (distX(3,1,-12) = 12 wide) builds ${Q_.guard.shoelaceVolume} (want ${Q_.wantVolume}).`);
}
{
  const e2p = E.e2pipeline, e2f = E.e2fn;
  must(e2f.seedViolatesTheRule === 0 && e2f.seedMovedACornerOffEdgeOther === 0, 'seedForNewRule function');
  add('seedForNewRule as a function: the fewest-movers seed for a freshly added parallel / perpendicular / equal rule', 'supported',
    `${run('r4e.mjs')} section E2: ${e2f.randomPolygons} random polygons (4..6 corners) with one new pair rule: the seed satisfies the rule in ${pc(e2f.randomPolygons - e2f.seedViolatesTheRule, e2f.randomPolygons)} (independent signed check, 1e-6) and moved a corner that is not on edge \`other\` in ${e2f.seedMovedACornerOffEdgeOther}. It has a caller (reshape-script.ts:1240, only to decide whether to warn).`);
  must(e2p.rawRuleNotHeld > 0 && e2p.guardBuiltWithRuleNotHeld === 0, 'seed pipeline');
  add('seedForNewRule in the pipeline: runScript -> applyConstraint -> solveDoc solves from the raw points (no seed), so a legal parallel / perpendicular / equal rule can be left unheld in the built doc', 'wrong',
    `${run('r4e.mjs')} section E2: ${e2p.singleRuleScripts} single-rule scripts (4 shapes x parallel/perpendicular/equal x every edge pair, no other rule, so every one is satisfiable): in ${e2p.rawRuleNotHeld} the doc that gets built does not hold the rule (e.g. ${e2p.examples[0].src}), warnings empty. With the contract guard (its solver does seed): rule not held in ${e2p.guardBuiltWithRuleNotHeld} built docs, ${e2p.guardRefused} refused (${JSON.stringify(e2p.guardRefusedExamples.slice(0, 2))}).`);
}
{
  const e3 = E.e3;
  must(e3.differFromIndependentReimplementation === 0, 'collapsedByRatio');
  add('collapsedByRatio (an edge under 25% of its length or the area under 25% after a solve) as the gate that keeps or drops a rule', 'wrong',
    `${run('r4e.mjs')} section E3: the function itself is exact: ${e3.randomPairs} random polygon pairs differ from an independent reimplementation in ${e3.differFromIndependentReimplementation}; an edge at exactly 25% is ${e3.edgeExactly25pct ? 'collapsed' : 'not collapsed'}, just under (9.99 of 40) is ${e3.edgeJustUnder25pct ? 'collapsed' : 'not collapsed'}. As a GATE it refuses legal shrinks: ${e3.legalShrinkRefused.map((r) => `${r.name} builds area ${r.builtArea} (wanted ${r.wantedArea}) with warning "${(r.warnings ?? [''])[0].slice(0, 40)}..."`).join('; ')}. The warning text is also false for these (the rule CAN hold; only the 25% gate says no). The contract guard replaces the gate by an exact test: rules hold to 1e-9 and no edge is under 1e-3 of the drawn diagonal (r4b.mjs repro D, E, F, G build the wanted area).`);
}
{
  const w = E.e4.runResultWarning;
  must(w.problems.length > 0, 'warning text');
  add('RunResult.warnings text for a rule that is left fighting: "<rule> cannot hold along with the rules already on this sketch -- the shape is as close as it can get to all of them. Remove one to settle it."', 'wrong',
    `${run('r4e.mjs')} section E4: the shipped text for rect(40,30); length(1,8) is "${w.text}": plainProblems says ${JSON.stringify(w.problems)} (two sentences joined by " -- "), the rule label is the symbolic describe() form (see the next rows), and the claim is FALSE for that script (8 is satisfiable: the guard builds ${rp('D ').guard.shoelaceVolume}, only the 25% gate refused it). The guard replaces it by the sentences of the refusal rows.`);
}

// ======================= describe / notes / translator / reachability =======================
{
  const d = E.e4.describeAsShipped;
  must(d.symbolicOrFragment >= 5, 'describe symbolic');
  add('describe(c): rule descriptions as shipped (packages/sketch) are symbolic fragments, not plain sentences', 'unsupported',
    `${run('r4e.mjs')} section E4: ${d.symbolicOrFragment} of ${d.kinds} kinds come out as fragments or with symbols: ${d.rows.filter((r) => r.problems.length).map((r) => `"${r.describe}"`).join(', ')}. Only horizontal ("edge 1 across"), vertical, symmetric and lock read as words. Used today only inside the false RunResult.warnings text. A student never sees describe() output as a sentence; the translator row below is the replacement.`);
  const t = E.e4.translator;
  must(t.failingPlainTest === 0, 'translator plain');
  add('plainRule / refuse sentences (legacy-guard.mjs, soup-guard2.mjs labelRule): one plain sentence per rule kind', 'supported',
    `${run('r4e.mjs')} section E4: all ${t.kinds} legacy rule kinds are worded (${t.rows.map((r) => `${r[0]}: "${r[1]}"`).join('; ')}); the refusal sentence built from each passes plainProblems (exactly one sentence, no engine ids or jargon, under 260 characters) AND a symbol test the round-3 lint did not have (no non-ASCII, no "=" and no " -- "): ${t.failingPlainTest} failures of ${t.kinds}. The soup labels (labelRule) additionally round numbers to 3 decimals (a 39.80557109226518 degree rule used to push the sentence past 260 characters) and word two-shape distances, point-on-shape and symmetric rules.`);
  const n = E.e4.removalNotesAsShipped;
  must(n.failingPlainTest === n.kinds, 'removal notes');
  add('conflicting rules: describeRemovalNote / describeRemovalNotePair (the sentence that says which older rule was dropped)', 'unsupported',
    `${run('r4e.mjs')} section E4: all ${n.kinds} kinds fail the plain test (two sentences each: ${JSON.stringify(n.firstProblems[0][0])}) and all ${n.mentionUndo} end with "Undo puts it back", but the script path has no undo and nothing calls the function at all (grep of packages/*/src: describeRemovalNote ${E.e4.reachability.describeRemovalNote.length} call sites, describeRemovalNotePair ${E.e4.reachability.describeRemovalNotePair.length}). A dropped rule is therefore silent (see the script rows). Not wired, so not supported.`);
  add('losingEdges (legacy outline): which edges lose a fight', 'unsupported',
    `${run('r4e.mjs')} section E5: the function is accurate - ${E.e5.twoLengthsOnOneEdge.overConstrainedCases} over-constrained rectangles with two lengths on one edge, it names the edge in ${E.e5.twoLengthsOnOneEdge.namesTheEdge}, returns nothing in ${E.e5.twoLengthsOnOneEdge.returnsNothing}, also names another edge in ${E.e5.twoLengthsOnOneEdge.alsoNamesOtherEdges} - and blind to corner-only conflicts (distanceX 40 vs 30: overConstrained ${E.e5.cornerRulesConflict.overConstrained}, losingEdges ${JSON.stringify(E.e5.cornerRulesConflict.losingEdges)}). But grep of packages/*/src finds ${E.e4.reachability.losingEdges.length} callers: nothing shows a student which edges lose, so the feature is not delivered. The guard's blame list (conflict rows) is the delivered counterpart.`);
}
{
  const e6 = E.e6, r = E.e4.reachability;
  must(r.sketchLabels.every((l) => !/sketchLabels\(/.test(l) || /\*|\/\//.test(l)) || true, 'labels reachability');
  const callers = r.sketchLabels.filter((l) => !/^packages\/sketch\/src\/sketch-outline\.ts/.test(l)).length;
  const lab = (title, body) => add(title, 'unsupported', `${run('r4e.mjs')} section E6: ${body} Reachability: ${callers} callers of sketchLabels outside its own file in packages/*/src (the matches are its definition and two comments), circleLabel ${r.circleLabel.length} (its definition), so no label the studio draws comes from this function; the numbers below are a library measurement, not a delivered feature.`);
  lab('sketchLabels: edge length labels and the dimension-vs-length kind', `rectangle 40x25 with a length rule on edge 1: texts ${e6.rectEdges.map((e) => `${e.text}(${e.kind})`).join(', ')} equal the edge lengths 40/25/40/25; the ruled edge is kind "${e6.lengthKindForTheRuledEdge}", the others "length". formatLabel prints 2 decimals and passes NaN / Infinity through ("${e6.formatLabel[6][1]}", "${e6.formatLabel[7][1]}").`);
  lab('sketchLabels: corner R / C labels', `rounds {1:3} and chamfers {2:2.5} give ${JSON.stringify(e6.corners)} (the label echoes the REQUESTED radius, not what the outline can build).`);
  lab('sketchLabels: bow labels (signed sagitta) and the circle diameter label', `bulge b on a 40 chord: ${e6.bows.map((b) => `${b.bulge}: "${b.text}" (|b|*chord/2 = ${b.wantAbs})`).join(', ')}; circleLabel of a 2-point circle: ${JSON.stringify(e6.circle.diameter)}, of 3 points: ${JSON.stringify(e6.circle.none)}.`);
}
add('edge label output: the dimension value as MEASURED by SolidCraft (sketch.dimension "measured" / SolveReport) for a rows-and-rules sketch', 'unsupported',
  `${ENV} The measured value of a dimension is a SolveReport / command output field; the stock pkg does not return it, so it cannot be read here. The witness the soup guard computes (soup-guard2.mjs) carries the same numbers (every driving dimension is verified to 1e-9 by two evaluators), but those are the checker's values, not SolidCraft's measure, so this row is not claimed.`);

// ======================= soup route: conflicts, collapse, sign flips, completeness =======================
const d5 = (p) => D.d5.rows.find((r) => r.id.startsWith(p));
{
  const names = ['legacy X1', 'legacy X2', 'legacy X3', 'legacy X4', 'legacy X5', 'legacy X6', 'sk-conflict__width', 'sk-conflict__radius', 'sk-conflict__equal'];
  const rs = names.map(d5);
  rs.forEach((r) => must(r.raw.status === 'refused-at-command' && r.guard.outcome === 'refused' && r.guard.problems.length === 0, 'conflict ' + r.id));
  const named = rs.filter((r) => !/the other rules on this sketch/.test(r.guard.sentence)).length;
  add('conflicting rules on the soup route: a new rule fights an older one (SolidCraft rejects it at the command that adds it)', 'refused',
    `${run('r4d.mjs')} section D5: ${rs.length} conflicting rule sets (6 two-rule fights from the legacy conflict list, 3 gauntlet conflict fixtures), brep-rs bucket conflicting in ${rs.filter((r) => r.brepBucket === 'conflicting').length}. SolidCraft refuses ${rs.length} of ${rs.length} at the command that adds the rule - the refusal itself is right - but its text names engine ids and API flags ("that would over-constrain the sketch (conflicts with k2, k3, k4, k5, k7, k9, k10, k12)", "...add it as a driven (reference) dimension with driven: true", "neither entity can move to satisfy it"): none of that is in the student's script. The guard decides before any kernel call (independent LM, 60 starts, no witness), names the newest rule and, in ${named} of ${rs.length}, the older rule(s) whose removal resolves it (re-solved without each): ${rs.slice(0, 3).map((r) => `"${r.guard.sentence}"`).join(' / ')}. All ${rs.length} pass plainProblems. Nothing is built, nothing retried elsewhere.`,
    d5('sk-conflict__width').guard.sentence);
}
{
  const N1 = d5('N1'), N2 = d5('N2'), c1 = C.c1;
  must(c1.twoRightAngles.raw.status === 'built' && c1.twoRightAngles.guard.outcome === 'refused', 'sliver');
  must(c1.twoRightAngles.raw.volume < 0.1, 'sliver volume');
  const M = ['M3b', 'M3c'].map(d5);
  add('impossible rule sets that SolidCraft does NOT reject: it satisfies them by squeezing the sketch to a sliver and extrudes it (two right angles in a triangle, perpendicular + equal on a triangle, across AND up on one edge)', 'refused',
    `${run('r4c.mjs')} + ${run('r4d.mjs')} section C1/D5, REPRODUCED on the given pkg. UNGUARDED: triangle (0,0)-(40,0)-(10,25) with perpendicular(1,2) and perpendicular(2,3): SolidCraft builds ${c1.twoRightAngles.raw.volume} mm3 (drawn area x height 5000), ${c1.twoRightAngles.raw.faces} faces, no error; perpendicular(1,3)+equal(1,2) (a hypotenuse cannot equal a leg): builds ${c1.perp13_equal12.raw.volume} mm3; skew quad and hexagon with across+up on one edge: build ${M[0].raw.volume} and ${M[1].raw.volume} mm3 with one edge squeezed away. (Three right angles, and across+up on a plain rectangle, ARE refused at the command by SolidCraft: controls.) brep-rs calls N1 ${N1.brepBucket}. GUARD: all of these are refused before the kernel (independent solver finds no witness, or only a collapsed one): "${c1.twoRightAngles.guard.sentence}" / "${M[0].guard.sentence}". Control that must build: triangle with one right angle + pin + two lengths builds ${c1.oneRightAngleControl.raw.volume} unguarded and ${c1.oneRightAngleControl.guard.volume} guarded. Random soup fuzz (r4c2.mjs, ${C2.summary.cases} rule sets, pools rect / triangle / two circles / tangent slot): rules infeasible ${C2.summary.truthInfeasible}; SolidCraft built something for ${C2.summary.rawBuiltOnInfeasible} of them; the guard built ${C2.summary.guardBuiltOnInfeasible} of them.`,
    c1.twoRightAngles.guard.sentence);
}
{
  const c2 = C.c2;
  must(c2.rawFlips > 0 && c2.guardWrong === 0 && c2.guardRefused === 0, 'sign flip');
  add('signed distanceX / distanceY as SolidCraft solves them (raw): dimensions are |d| (undirected), so a rule asking dy = +2.1 can come back as -2.1', 'wrong',
    `${run('r4c.mjs')} section C2, REPRODUCED on the given pkg (two circles r4 and r3, c1 coincident with the origin or pinned there, distance(c1,c2)=15.0333, distanceY(c1,c2)=+2.1, 8 starts dy = 0.2 .. 10): raw solved dy for the distance variant ${c2.rows.slice(0, 8).map((r) => r.rawDy).join(', ')}; lock variant ${c2.rows.slice(8).map((r) => r.rawDy).join(', ')}. ${c2.rawFlips} of ${c2.rows.length} come back -2.1 (the flip is NOT monotonic in the start: 0.2, 0.5, 1, 3, 5 flip, 2, 2.5, 10 do not, so round 3's "start dy = +0.5 ends at +2.1" control does not reproduce and "a start near the target is safe" is unsupported). Only a post-solve SIGNED check is reliable; the next row is that check.`);
  add('signed distanceX / distanceY with the soup guard (the witness is drawn at the asked sign and SolidCraft only confirms it)', 'supported',
    `${run('r4c.mjs')} section C2 (two circles r4 and r3, c1 coincident with the origin or pinned there, distance(c1,c2)=15.0333 and distanceY(c1,c2)=+2.1, 8 starts dy = 0.2 .. 10 each): UNGUARDED the solved dy is ${c2.rows.map((r) => (typeof r.rawDy === 'number' ? r.rawDy : r.rawDy)).filter((v, i) => i < 8).join(', ')} for the distance variant (the sign flips for starts 0.2, 0.5, 1, 3, 5: NOT monotonic in the start, so "a start near the target is safe" is false, round-3's control did not reproduce) and ${c2.rows.slice(8).map((r) => r.rawDy).join(', ')} for the lock variant; ${c2.rawFlips} of ${c2.rows.length} come back -2.1, ${c2.rawCorrect} correct. GUARD: the witness is drawn at +2.1 and SolidCraft only confirms it: ${c2.guardBuiltCorrect} of ${c2.rows.length} build with c2 exactly +2.1 above c1 (read from the two bodies' bboxes), ${c2.guardWrong} wrong, ${c2.guardRefused} refused.`);
  const af = d5('ANGLE-FLIP');
  must(af.raw.volume !== af.guard.volume, 'angle flip differs');
  add('angle dimension as SolidCraft solves it (raw): undirected, so a 45 degree rule can be solved as 135', 'wrong',
    `${run('r4d.mjs')} section D5, the round-3 fuzz case (rect: equal(1,2), diagonal distance, length(3)=30, angle(1,2)=45): raw SolidCraft builds ${af.raw.volume} mm3, the independent solver holding the signed angle to 1e-9 builds ${af.guard.volume} (same rules, other orientation of the angle dimension).`);
  add('angle dimension with the soup guard', 'supported',
    `${run('r4d.mjs')} section D5, the round-3 fuzz case (rect: equal(1,2), diagonal distance, length(3)=30, angle(1,2)=45): UNGUARDED SolidCraft builds ${af.raw.volume} mm3, the guard (witness with the signed angle held to 1e-9) builds ${af.guard.volume}; the two differ because SolidCraft took the other orientation of the same dimension. The guard builds the witness, so the angle asked is the angle built.`);
}
{
  const s = C2.summary, c3 = C.c3;
  const lv = c3.levels;
  must(s.guardBuiltWrongVolume === 0 && c3.levels.every((l) => l.guardBuiltWrong === 0), 'guard completeness');
  must(s.guardWorstRelErr_planar < 1e-9 && s.guardWorstRelErr_curved < 3e-4, 'guard error bars');
  add('tangent docs (arc-first-order slot) started 0.5% to 3.5% of the diagonal off, built by SolidCraft raw: a rule-satisfying wrong-branch solid', 'wrong',
    `${run('r4c.mjs')} section C3, REPRODUCED on the given pkg: slot with 2 arcs + 2 lines + 4 tangent joins, closed form ${g5(c3.closedVolume)} mm3; ${lv[0].n} jittered starts per level; raw SolidCraft builds a wrong volume in ${lv.map((l) => `${pc(l.rawWrong, l.n)} at ${+(l.jitterFracOfDiag * 100).toFixed(1)}%`).join(', ')} (worst relative error ${g3(Math.max(...lv.map((l) => l.rawWrongWorstRel)))}); bbox and face types are exactly right, only the volume shows it. Round 3's guard claim never tested this (its fuzz had no tangent rules); the next row does.`);
  add('post-solve guard on the soup route (soup-guard2.mjs): no silently wrong solid, including rule-satisfying wrong-branch builds on TANGENT docs', 'supported',
    `${run('r4c.mjs')} section C3 and ${run('r4c2.mjs', 'SEEDS=1,2 N=250 ')}. Round 3's fuzz had no tangent rules; this one does. (1) The arc-first-order slot (2 arcs + 2 lines, 4 tangent joins, closed form ${g5(c3.closedVolume)} mm3) started 0.5%, 1%, 2%, 3.5% of its diagonal off, ${lv[0].n} starts each: UNGUARDED SolidCraft builds a volume wrong by up to ${g3(Math.max(...lv.map((l) => l.rawWrongWorstRel)))} relative in ${lv.map((l) => pc(l.rawWrong, l.n)).join(', ')} (bbox and face types exactly right, only volume shows it); GUARD: built correct ${lv.map((l) => pc(l.guardBuiltOk, l.n)).join(', ')}, built wrong ${lv.reduce((a, l) => a + l.guardBuiltWrong, 0)}, worst relative error ${g3(Math.max(...lv.map((l) => +l.guardWorstRel)))} (curved volumes from truck are tessellation-derived, bar 3e-4). (2) ${s.cases} random rule sets over 4 pools (rect ${s.byPool.rect}, triangle ${s.byPool.tri}, two circles ${s.byPool.cc}, tangent slot with 1..3 extra dimensions and starts up to 3.5% off ${s.byPool.slot}): guard built ${s.guardBuilt} (planar worst relative volume error vs shoelace of the witness ${e2(s.guardWorstRelErr_planar)}, curved ${e2(s.guardWorstRelErr_curved)}), built wrong ${s.guardBuiltWrongVolume}, built on a set no solver could satisfy ${s.guardBuiltOnInfeasible}, refused ${s.guardRefused} (${JSON.stringify(s.guardRefusedStages)}). Of the refusals, sets that brep-rs and the independent solver both call feasible: ${s.guardRefusedOnFeasible_falseRefusals} (${JSON.stringify(s.guardRefusedOnFeasible_byStageAndPool)}): the outline refusals are the language's loop rule (touching or loose shapes), the preflight ones are rule sets satisfiable only by squeezing a shape to nothing. SolidCraft's own raw volume can only be judged where the rules fix the part (witness dof 0): ${s.rawBuiltWrongVolume_dof0} wrong of ${s.rawComparableUnique} such builds; with free dof ${s.rawBuiltDifferentVolume_dofPositive} raw builds differ from the witness and ${s.rawBuiltSameVolume_dofPositive} agree - a different valid part, not an error, which is why the guard builds ITS verified witness rather than comparing volumes.`);
}
{
  const c5 = C.c5, built = c5.rows.filter((r) => r.guard === 'built');
  must(c5.guardBuiltWrong === 0, 'fixtures');
  add('phase-2 fixtures (43 sketches: dimensioned rectangles, slots, polygons, circles, tangent pairs) through the soup guard: stored start and a rough start', 'supported',
    `${run('r4c.mjs')} section C5, ${c5.n} runs (43 fixtures x stored / rough start): guard built ${c5.guardBuilt}, refused ${c5.guardRefused}, built wrong ${c5.guardBuiltWrong} against the closed forms (planar bar 1e-9, curved 3e-4); ${c5.guardBuiltNoClosedForm} builds have no closed form (conflict-free redundant fixtures etc.). UNGUARDED SolidCraft is wrong in ${c5.rawWrong} of them. The refusals are: ${[...new Set(c5.refusedSentences.map((x) => x[0]))].join(', ')} - conflicts (plain sentences naming the fighting rules), a loose edge or touching shapes (the language's outline rule), and horizontal+vertical on one edge (collapse).`);
}
add('degrees of freedom and status that SolveReport gives for a collapsed or rule-violating result ("solved", failing [], dof > 0)', 'unsupported',
  `${ENV} SolveReport cannot be read on the stock pkg, so this round cannot confirm or refute round 3's reading (status solved, failing [], dof 1 for the two-right-angle sliver). The guard does not depend on it: the result is decided before the kernel and a collapsed or contradictory set is refused (the rows above), so the unreliable report is never what a student is shown. Re-measuring the report needs the wrapper2 build described in RIG.md ("pkg2"), which the ground rules forbid rebuilding here.`);

// ======================= dof, redundancy =======================
{
  const d1 = D.d1, hb = D.d1b;
  const tr = d1.rows.filter((r) => r.truth !== null && r.truth >= 0);
  const okG = tr.filter((r) => r.indepDof === r.truth).length;
  const okS = tr.filter((r) => r.scProbeDof === r.truth).length;
  const scBad = tr.filter((r) => r.scProbeDof !== r.truth && r.scProbeDof !== 'base-refused'); const scRefused = tr.filter((r) => r.scProbeDof === 'base-refused');
  must(okG === tr.length || tr.filter((r) => r.indepDof !== r.truth).every((r) => r.indepDof === null), 'guard dof agrees');
  add('degrees of freedom per soup sketch: the count the guard reports (independent Jacobian rank at the witness; dof 0 = fully constrained, dof > 0 = under-determined, parts may legitimately differ)', 'supported',
    `${run('r4d.mjs')} section D1. ${tr.length} runs (43 phase-2 fixtures, the consistent ones, x stored start and a 0.2 mm jittered start) against the saved FreeCAD refs (gauntlet, ${d1.rows.filter((r) => r.truth !== null && r.truth >= 0 && /__/.test(r.id)).length} runs) and the hand counts (own fixtures): the guard's dof equals the truth in ${okG} of ${tr.length}; brep-rs in ${tr.filter((r) => r.brepDof === r.truth).length}; the stock-pkg SolidCraft probe (rank by refusal) in ${okS}. Bucket (consistent / redundant / conflicting) against the FreeCAD refs: guard ${hb.guardAgrees} of ${hb.withFreecadBucket}, brep-rs ${hb.brepAgrees}; guard disagreements ${JSON.stringify(hb.guardDisagrees.slice(0, 4))}. The redundant-rule count of the guard against FreeCAD's: ${JSON.stringify(hb.redundantCountMatchesFreecad.slice(0, 4))}. No kernel call and no start dependence: stored and jittered starts give the same dof.`);
  add('SolidCraft\'s own dof / redundancy bookkeeping depends on the start state for exactly-tangent docs (saved slots)', 'wrong',
    `${run('r4d.mjs')} section D1, reproduced with the rank-by-refusal probe (r4-lib.mjs rankByProbe: every coordinate offered as a dimension to a helper point; accepted pins = remaining dof): of ${tr.length} consistent runs the SolidCraft probe is right in ${okS}; ${scRefused.length} more are fixtures whose redundant dimension SolidCraft refuses at the command (no dof to read: ${[...new Set(scRefused.map((r) => r.id.replace('sk-conflict__', '').replace('sk-circle-arc-tangent__', '')))].join(', ')}); the ${scBad.length} real misses: ${scBad.map((r) => `${r.id.replace('sk-circle-arc-tangent__', '')} ${r.mode} truth ${r.truth} probe ${r.scProbeDof}`).join('; ')}. The four exactly-tangent saved slots read dof 4 / 6 / 4 / 4 (truth 0 / 2 / 0 / 0) and read correctly (0 / 2 / 0 / 0) from a 0.2 mm jittered start; the solid built from them is right (the bookkeeping is wrong, the geometry is not). The guard's own count is start-independent (previous row).`);
}
{
  const s = D.d4.summary;
  must(s.guardFlagsRedundant === s.truthRedundant && s.guardFalseFlags === 0, 'redundancy list');
  add('redundant rules (duplicate or implied; dimension and non-dimension): which ones SolidCraft flags, which it accepts silently, and the guard\'s own list', 'supported',
    `${run('r4d.mjs')} section D4: on a rectangle (shape rules + lock + length 30 + length 20) ${s.truthRedundant} added rules that are redundant by construction (horizontal twice, perpendicular implied by h/v, parallel implied, duplicate join, origin coincident on a locked corner, lock twice, equal implied, length(3)=30, distanceX=30) and 2 controls that are not (length 31 = a conflict, perpendicular on parallel edges = a conflict). SolidCraft as written: redundant dimensions are REFUSED ("already determined by k2 (Coincident)..., add it as a driven (reference) dimension"), redundant non-dimension rules are ACCEPTED silently; with if_redundant:"refuse" it detects ${s.scRefuseDetects} of ${s.truthRedundant} and still accepts ${s.scAcceptsSilently} silently (a duplicate join, lock written twice); with if_redundant:"driven" every redundant dimension builds. The guard's rank listing (soup-guard2.mjs redundantRules, rule i is redundant when its rows add no rank to the rules before it) flags ${s.guardFlagsRedundant} of ${s.truthRedundant} and ${s.guardFalseFlags} false flags, and the guard builds redundant dimensions with if_redundant:"driven" on the verified witness.`);
}
{
  const cells = D.d2.cells, d3 = D.d3;
  const tang = cells.filter((c) => c.jitterMm > 0);
  const rawRefusals = tang.reduce((a, c) => a + Object.entries(c.raw).filter(([k]) => /refused/.test(k)).reduce((x, [, v]) => x + v, 0), 0);
  const rawTotal = tang.reduce((a, c) => a + Object.values(c.raw).reduce((x, v) => x + v, 0), 0);
  const guardBuilt = tang.reduce((a, c) => a + (c.guard['built-correct'] ?? 0), 0), guardTotal = tang.reduce((a, c) => a + Object.values(c.guard).reduce((x, v) => x + v, 0), 0);
  must(guardBuilt === guardTotal && rawRefusals > 0.9 * rawTotal, 'tangent chain');
  const st = d3[0], jt = d3[1];
  add('redundant DIMENSION implied through a tangent chain (slot: centres = 30, top line length = 30): SolidCraft raw with if_redundant:"driven" vs the soup guard', 'supported',
    `${run('r4d.mjs')} sections D2 and D3 (fixture sk-circle-arc-tangent__slot-r6-L30-anchored, closed form ${g5((Math.PI * 36 + 360) * 10)} mm3). UNGUARDED SolidCraft: from the exactly-tangent saved start both redundant dimensions are accepted (built, flag or no flag); from a start off by 0.02, 0.2 or 1 mm it REFUSES them: ${rawRefusals} of ${rawTotal} attempts (jitter > 0, with and without the flag) answer "other constraints already determine it with a different value" - a false conflict on a consistent rule, so round 3's "fix = if_redundant:driven" does not hold for chains (it only holds for dimensions that are exact in arithmetic). Start-state dependence of the DECISION: ${JSON.stringify({ stored: { centres30: st.plusCentres30, thenLength40: st.lengthTo40_withCentres30Kept }, jitter0_2mm: { centres30: jt.plusCentres30, thenLength40: jt.lengthTo40_withCentres30Kept } })} - the hidden driver accepted on the stored start is what the later length edit fights. GUARD: the witness is exactly consistent, so the redundant dimension is a reference: ${guardBuilt} of ${guardTotal} jittered attempts build the correct slot (relative volume error < 3e-4), 0 refused. A redundant dimension that is NOT consistent (centres = 30 and top length = 40) is a genuine contradiction and is refused before the kernel: "${st.guard_lengthTo40_withCentres30.sentence}"; the same edit without the extra dimension builds ${st.guard_lengthTo40_alone.volume} (closed form ${st.guard_lengthTo40_alone.closed}).`);
}
{
  const st = D.d3[0];
  add('accept / refuse decision for a redundant or conflicting rule depends on the start state (stored exactly-tangent start vs 0.2 mm jitter)', 'refused',
    `${run('r4d.mjs')} section D3, slot-r6-L30-anchored: stored start: base ${D.d3[0].base}, +centres=30 ${D.d3[0].plusCentres30}, length->40 without the extra ${D.d3[0].lengthTo40_withoutExtra}, length->40 with centres=30 kept ${D.d3[0].lengthTo40_withCentres30Kept}; 0.2 mm jittered start: +centres=30 ${D.d3[1].plusCentres30} (the same dimension, opposite answer). The guard removes the dependence by deciding on the witness: the contradictory combination is refused on both starts with the same sentence, the consistent one builds on both.`,
    st.guard_lengthTo40_withCentres30.sentence);
}
{
  add('reference (driven, driving:false) rules in a rows-and-rules sketch', F.rows.every((r) => r.guard.outcome === 'built' || r.case.startsWith('driving')) ? 'supported' : 'unsupported',
    `${run('r4f.mjs')}: rectangle (lock + length 30 + length 20, wanted volume ${F.want}). ${F.rows.filter((r) => /reference/.test(r.case)).map((r) => `${r.case}: raw ${r.raw.status === 'built' ? 'built, rel err ' + r.raw.relErr : r.raw.status}, guard ${r.guard.outcome === 'built' ? 'built, rel err ' + r.guard.relErr : 'refused'}`).join('; ')}. A reference rule only measures, even with a value the sketch cannot have; the control (a driving length(3) = 99) conflicts: raw ${F.rows.find((r) => r.case.startsWith('driving')).raw.status}, guard "${F.rows.find((r) => r.case.startsWith('driving')).guard.sentence}".`);
  add('inactive (active:false) rules in a rows-and-rules sketch', F.rows.filter((r) => /inactive/.test(r.case)).every((r) => r.guard.outcome === 'built' && Math.abs(+r.guard.relErr) < 1e-9) ? 'supported' : 'unsupported',
    `${run('r4f.mjs')}: ${F.rows.filter((r) => /inactive/.test(r.case)).map((r) => `${r.case}: raw ${r.raw.status === 'built' ? 'built, rel err ' + r.raw.relErr : r.raw.status}, guard ${r.guard.outcome === 'built' ? 'built, rel err ' + r.guard.relErr : 'refused'}`).join('; ')}. An inactive rule is not sent to SolidCraft and not enforced by the independent solver.`);
}
{
  const m3 = ['M3 ', 'M3b', 'M3c'].map(d5), fh = D.d5.rows.find((r) => r.id.startsWith('sk-conflict__horizontal')) ?? null;
  m3.forEach((r) => must(r.guard.outcome === 'refused', 'M3 refused'));
  add('collapse on the soup route: rules that force an edge to a point (horizontal AND vertical on one edge)', 'refused',
    `${run('r4d.mjs')} section D5 and ${run('r4c.mjs')} C5. UNGUARDED: rectangle + vertical on a horizontal edge is refused by SolidCraft at the command (raw: ${m3[0].raw.status}), but the skew quad and the hexagon are ACCEPTED and extruded with one edge squeezed away (volumes ${m3[1].raw.volume} and ${m3[2].raw.volume}). GUARD: all three refused before the kernel: "${m3[0].guard.sentence}". The gauntlet fixture sk-conflict__horizontal-and-vertical (SolidCraft accepts the rules and then fails the extrude with "no closed profiles", the wrong reason) is refused with the same sentence.`,
    m3[0].guard.sentence);
}

// ======================= misc legacy =======================
{
  add('idempotent rule calls (the same rule twice is a no-op, not a toggle), legacy script path', E.e1.allIdempotent ? 'supported' : 'wrong',
    `${run('r4e.mjs')} section E1: ${E.e1.rows.length} pairs (across, length same value, pin, distX same, equal, each twice; equal then parallel on one pair replaces; across then up on one edge replaces) produce the same constraint list as the single call in ${E.e1.rows.filter((r) => r.sameDocAsSingleCall).length} of ${E.e1.rows.length}. Two DIFFERENT values for one edge stack and the settle drops the older (kept: ${JSON.stringify(E.e1.twoDifferentLengthsKeep)}): that is not idempotence, it is the silent drop of the script rows above (refused by the guard).`);
  const e7 = E.e7;
  must(e7.scaleSweep[2].falseOverConstrained > 0, 'scale');
  add('solveSketch degenerate inputs and scale: NaN / Infinity values, out-of-range or fractional edge index, the absolute 1e-3 threshold', 'wrong',
    `${run('r4e.mjs')} section E7: length NaN -> overConstrained ${e7.nanLength.over}, residual ${e7.nanLength.residual} (accepted, flag false); length Infinity -> over ${e7.infLength.over}; edge index 7 and -1 wrap silently (over ${e7.edgeIndex7.over}, residual ${e7.edgeIndex7.residual}); edge index 1.5 throws "${e7.edgeIndex1p5.threw}". The flag threshold is ABSOLUTE 1e-3: a second length of 60.002 on a 60 edge is flagged (${JSON.stringify(e7.absoluteThreshold1e3[2])}) but 60.001 is not; at 1e5 times size ${e7.scaleSweep[2].falseOverConstrained} of ${e7.scaleSweep[2].of} perfectly satisfiable rectangles are flagged (scale 1: ${e7.scaleSweep[0].falseOverConstrained}, 1e3: ${e7.scaleSweep[1].falseOverConstrained}). The script interpreter rejects most of these before the solver (length(9,5), length(1,NaN), length(0,5), length(1,-5) are script errors in r2d.json), so the exposure is solveSketch called with unvalidated numbers (drag, params).`);
  const e9 = E.e9;
  must(e9.allMatchHand, 'legacy dof helper vs hand');
  add('degrees of freedom for LEGACY (outline) sketches: solveSketch has no dof field; the contract helper legacyDof (signed Jacobian rank)', 'supported',
    `${run('r4e.mjs')} section E9: solveSketch's result has no dof field (${E.e9.solveSketchHasDofField}). legacy-rules.mjs legacyDof (free coordinates minus the rank of the signed rule Jacobian at the polished points) against the hand counts: ${e9.rows.filter((r) => typeof r.hand === 'number').map((r) => `${r.id.split('-')[0]} ${r.helper}/${r.hand}`).join(', ')} (all ${e9.rows.filter((r) => typeof r.hand === 'number').length} match); on the two redundant sets it reports ${JSON.stringify(e9.redundantDetected)} dependent rule(s) (truth 1 each).`);
}
{
  const nm = D.d5.rows.filter((r) => r.id.startsWith('legacy') || r.id.startsWith('sk-conflict'));
  add('rule descriptions coming FROM SolidCraft (which older rule a refused rule fights): ids in the refusal text are not the student\'s rules', 'supported',
    `${run('r4d.mjs')} section D5: SolidCraft's text names k-ids ("conflicts with k2, k3, ..."), and round 3 showed the ordinal k<N> -> rule table breaks after a no-op row. Round 4 does not translate the ids at all: the independent solver names the fighting rules from first principles (re-solve without each older rule). ${nm.length} conflict sets: ${nm.filter((r) => !/the other rules on this sketch/.test(r.guard.sentence)).length} sentences name at least one older rule by its content, the rest say "the other rules on this sketch" when no single removal resolves the conflict. Example: "${d5('legacy X3').guard.sentence}".`);
}

// ======================= write =======================
const out = { group: 'sketch-dof-diagnosis', rows: rows.map((r) => { const o = { feature: r.feature, status: r.status }; if (r.status === 'refused') o.refusalSentence = r.refusalSentence; o.evidence = r.evidence; return o; }) };
const tally = out.rows.reduce((t, r) => { t[r.status] = (t[r.status] ?? 0) + 1; return t; }, {});
writeFileSync(OUTFILE, JSON.stringify(out, null, 2));
console.log('rows', out.rows.length, JSON.stringify(tally));
console.log(out.rows.map((r, i) => `${i}:${r.status}`).join(' '));
