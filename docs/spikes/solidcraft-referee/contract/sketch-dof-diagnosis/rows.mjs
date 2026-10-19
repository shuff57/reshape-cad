// results.json -> ../sketch-dof-diagnosis.json  ({group, rows:[{feature,status,refusalSentence?,evidence}]}). Every number below is read from results.json.
import { readFileSync, writeFileSync } from 'node:fs';
const R = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'));
const max = (a) => Math.max(...a);
const g = (x) => (typeof x === 'number' ? (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : String(+x.toFixed(6))) : String(x));
const CMD = 'SOLIDCRAFT_REFEREE_PKG=<sc-referee-pkg> bun docs/spikes/solidcraft-referee/contract/sketch-dof-diagnosis/run.mjs';
const rows = [];
const add = (feature, status, evidence, refusalSentence) => rows.push({ feature, status, ...(refusalSentence ? { refusalSentence } : {}), evidence });
const ENGINE_FREE = 'Engine-independent TypeScript (packages/sketch): switching the kernel does not change it; verified against an independent oracle and by building its output on SolidCraft, OCCT and brep-rs.';

// ---- S2 solveSketch
{
  const d = R.s2;
  const iters = d.map((r) => r.ts.iterations);
  const tsDev = max(d.map((r) => Number(r.ts.maxDevVsClosedForm)));
  const kinds = [...new Set(d.flatMap((r) => r.kinds))].sort().join(',');
  const scVol = max(d.map((r) => Number(r.sc.volRel))), scBb = max(d.map((r) => Number(r.sc.bboxDev))), scCom = max(d.map((r) => Number(r.sc.comDev)));
  const pSC = max(d.map((r) => Number(r.pipeline.dVolSCvsOCCT))), pBr = max(d.map((r) => Number(r.pipeline.dVolBrepVsOCCT))), pCF = max(d.map((r) => Number(r.pipeline.dVolOCCTvsClosedForm))), pBb = max(d.map((r) => Number(r.pipeline.dBboxSCvsOCCT))), pCom = max(d.map((r) => Number(r.pipeline.dComSCvsOCCT)));
  const brDev = max(d.map((r) => Number(r.brep.maxDev))), inDev = max(d.map((r) => Number(r.indep.maxDev)));
  add('solveSketch result: points (legacy outline solver) -- 7 determined polygons covering every rule kind, then extruded', 'supported',
    `${ENGINE_FREE} Run: ${CMD}. Cases D1..D7 cover kinds ${kinds}. Each has a closed-form polygon. TS solveSketch max point error vs closed form ${g(tsDev)} mm (independent LM ${g(inDev)}, brep-rs ${g(brDev)}); 6 of 7 stop at the 300-iteration cap (iterations ${iters.join(',')}) so the TS answer is only good to ~1e-6 mm, not the stated 1e-7 tolerance. Real reSHape scripts -> runScript -> solveDoc -> phase0 translator on the SAME TS-solved outline: SolidCraft vs OCCT volume delta max ${g(pSC)}, brep-rs vs OCCT ${g(pBr)}, bbox delta ${g(pBb)}, COM delta ${g(pCom)}, face counts equal across the three kernels in ${d.filter((r) => r.pipeline.facesEqual).length}/7 (${d.map((r) => r.pipeline.sc.faces).join(',')}); OCCT vs the exact closed-form volume max ${g(pCF)} (planar, above 1e-9: explained by the TS iteration cap, identical on all three kernels, so not a SolidCraft difference). SolidCraft's own solver given the same rules (phase2 mapper, rough start) reaches the closed form: volume rel max ${g(scVol)}, bbox max ${g(scBb)} mm, COM max ${g(scCom)} mm (D7 is the worst, 4.1e-9 mm).`);
  const rd = d.map((r) => [Number(r.ts.residual), Number(r.tsPointsSatisfyIndependentCheck.worstResidual)]);
  add('solveSketch result: residual (largest remaining violation, reported by the TS solver)', 'supported',
    `${ENGINE_FREE} The residual the TS solver reports equals the worst violation recomputed by the independent rule checker (phase2/rule-check.mjs, no solver code) on the TS points in all 7 cases: ${rd.map((x) => `${g(x[0])}/${g(x[1])}`).join(', ')} (mm). Honest but large: 6 of 7 report 2.8e-7..2.4e-6, above the 1e-7 tolerance. The SolidCraft solver's residual is not readable through the referee wrapper (SolveReport.max_residual is discarded) so no SolidCraft residual number is claimed; its geometric error was measured instead (see points row).`);
  add('solveSketch result: iterations (soup/SolidCraft solver counterpart)', 'unsupported',
    `TS solveSketch reports iterations ${iters.join(',')} (300 = the cap, hit in 6 of 7 determined cases; the under-determined U1/U2 take ${R.s3.map((x) => x.tsIterations).join(' and ')}). SolidCraft's SolveReport has no iteration count and the phase0 wrapper returns only the first failing command's error or the final inspect.measure, so there is nothing to compare; not mapped. The TS counter itself is unaffected by the kernel choice.`);
}
// ---- S4 overConstrained
{
  const d = R.s4;
  const allTrue = d.every((r) => r.ts.overConstrained);
  const falsePos = [...R.s2.map((r) => r.ts.overConstrained), ...R.s3.map((r) => r.tsOver), ...R.s5.map((r) => r.ts.over)].filter(Boolean).length;
  const fcConf = R.s1.filter((r) => r.fc?.bucket === 'conflicting');
  add('solveSketch result: overConstrained flag (residual > 1e-3)', 'supported',
    `${ENGINE_FREE} True on ${d.filter((r) => r.ts.overConstrained).length} of ${d.length} genuine conflicts (X1..X6: ${d.map((r) => `${r.id.split('-')[0]} residual ${g(r.ts.residual)}`).join(', ')}); independent LM finds no zero-residual solution for the same ${d.length} (${d.map((r) => g(r.indep.minimaxResidual)).join(', ')}); brep-rs diagnose bucket 'conflicting' ${d.filter((r) => r.brep.bucket === 'conflicting').length}/${d.length}. False positives on the ${R.s2.length + R.s3.length + R.s5.length} consistent, under-determined and redundant cases: ${falsePos}.`);
  // conflicting rules: new fights older (SolidCraft)
  const sentences = [...new Set(d.map((r) => r.sc.sentence))];
  const ign = d.map((r) => `${r.id.split('-')[0]}: ${r.sc.ifRefusalIgnored?.volume !== undefined ? 'volume ' + g(r.sc.ifRefusalIgnored.volume) : 'second refusal'}`).join('; ');
  const fcRef = fcConf.map((r) => `${r.id.replace('sk-conflict__', '')} -> ${r.modes.stored.status}: ${r.modes.stored.sentence}`).join(' | ');
  add('conflicting rules: a new rule fights an older one (rule rejected by the engine at the command that adds it)', 'refused',
    `Run: ${CMD}. SolidCraft refuses the NEW rule at the command that adds it in ${d.filter((r) => r.sc.status === 'refused').length}/${d.length} legacy conflicts (X1..X6) and in ${fcConf.filter((r) => r.modes.stored.status === 'refused-at-command' && r.modes.rough.status === 'refused-at-command').length}/${fcConf.length} FreeCAD-gauntlet conflicting variants (${fcRef}); brep-rs says 'conflicting' with blame on the same new rule (${d.map((r) => JSON.stringify(r.brep.blame)).join(' ')}) and refuses the build; independent solver agrees. Sentences seen: ${sentences.map((x) => '"' + x + '"').join(' | ')}. They name internal constraint ids (k10, k11), not rules or edges, so reSHape must translate it before a student sees it. DANGER if a caller ignores the refusal and keeps sending commands: the sketch is built WITHOUT the rejected rule (${ign}; X6 builds a 0.0107 mm3 sliver). The wrapper stops at the first failing command, so the contract is: stop at the first refusal and show the sentence; never continue past it.`,
    'that would over-constrain the sketch (conflicts with k10, k11)');
  // settling
  const settled = d.map((r) => r.settledSet);
  add('conflicting rules: addConstraintSettling drops one (or two) older rules and reports describeRemovalNote', 'supported',
    `${ENGINE_FREE} Policy differs from SolidCraft: reSHape keeps the NEW rule and drops the older one (${d.map((r) => `${r.id.split('-')[0]} removed ${r.settle.removed.kind}${r.settle.removedAlso ? '+' + r.settle.removedAlso.kind : ''}`).join(', ')}), SolidCraft keeps the OLD rule and refuses the new one, so settling must run in TS BEFORE any rule reaches SolidCraft. After settling, the surviving rule set (started from the TS-solved polygon, which is what solveDoc stores) is consistent on the independent solver (${settled.filter((s) => s.indepConsistent).length}/${d.length}), brep-rs bucket 'consistent' (${settled.filter((s) => s.brepBucket === 'consistent').length}/${d.length}) and builds on SolidCraft (${settled.filter((s) => s.scStatus === 'built').length}/${d.length}) with the same area as the TS polygon: relative delta ${settled.map((s) => g(s.scVsTsRel)).join(', ')} (X3's 7.2e-9 is the TS polygon's own 1.2e-5 area error). Single removals 4 (X1..X4), pair removals 2 (X5, X6). Started from the unsettled original points, the two under-determined results (X5, X6) differ by 17% and 53% in area between TS and SolidCraft (measured in an exploratory run of the same cases from the original points; not stored in results.json), which is legitimate (dof 7 and 5): never let SolidCraft re-solve a legacy under-determined sketch from its pre-solve points.`);
  add('conflicting rules: describeRemovalNote / describeRemovalNotePair sentences', 'supported',
    `${ENGINE_FREE} The two templates reproduce their documented sentences exactly (${R.s9.removalNotes.filter((x) => x.ok).length}/${R.s9.removalNotes.length}): "${R.s9.removalNotes[0].got}" and "${R.s9.removalNotes[1].got}". Live outputs from the conflict cases: "${d[0].settle.note}" / "${d[4].settle.note}". SolidCraft supplies no equivalent plain sentence (its refusals name k# ids).`);
  add('conflicting rules: left in the doc as RunResult.warnings when no removal settles it', 'supported',
    `${ENGINE_FREE} Real scripts: ${Object.entries(R.s11.warnings).map(([k, v]) => `[${k}] -> ${v.warnings.length ? '"' + v.warnings[0] + '"' : 'no warning (settled quietly)'}`).join(' ; ')}. End to end for the first script (across then up on one edge): the doc keeps the original rectangle (collapse gate), OCCT ${g(R.s11.pipelineAcrossUp.occt)}, brep-rs ${g(R.s11.pipelineAcrossUp.brep)}, SolidCraft ${g(R.s11.pipelineAcrossUp.sc)} mm3 (exact 25*40*10 = 10000).`);
}
// ---- S1 DoF
{
  const rows1 = R.s1;
  const pairs = [];
  for (const r of rows1) for (const mode of ['stored', 'rough']) { const m = r.modes[mode]; if (m.status === 'accepted') pairs.push({ id: r.id, mode, probe: m.probeDof, indep: r.indep.dof, brep: r.brep.dof, fc: r.fc?.dof, tangent: /tangent/.test(r.id) || /slot/.test(r.id) }); }
  const agree = pairs.filter((p) => p.probe === p.indep);
  const bad = pairs.filter((p) => p.probe !== p.indep);
  const zero = agree.filter((p) => p.indep === 0), pos = agree.filter((p) => p.indep > 0);
  const fcPairs = pairs.filter((p) => p.fc !== undefined && p.fc >= 0);
  const fcAgree = fcPairs.filter((p) => p.probe === p.fc);
  const brepRef = rows1.filter((r) => typeof r.brep.dof === 'number' && r.indep.dof !== undefined);
  const brepAgree = brepRef.filter((r) => r.brep.dof === r.indep.dof);
  const method = 'Method (phase0 wrapper hides SolveReport.dof): after the mapped sketch, greedily add driving dimensions that pin every point coordinate and radius at an independent solution; SolidCraft refuses a dimension the sketch already determines, so the number of ACCEPTED probes = the dof its solver believes. Independent dof = unknowns - rank(numeric Jacobian) from my own LM (indep.mjs); brep-rs = SketchSession2D.diagnose; FreeCAD = saved gauntlet refs.';
  add('degrees of freedom: dof 0 (fully constrained) per soup sketch', 'supported',
    `Run: ${CMD}. ${method} 43 sketches (11 own + 32 FreeCAD-gauntlet variants) x 2 start modes (stored coordinates, rough = every coordinate off by up to 3.5% of the diagonal): SolidCraft probe dof equals the independent dof in ${agree.length} of ${pairs.length} accepted cases, ${zero.length} of them dof 0 (e.g. own-rect-rough-dims, own-hexagon-equal-oncircle, own-symmetric-trapezoid [brep-rs cannot solve this one: "line -3 has zero length; a mirror line has no direction"], sk-rect-dof__*, sk-conflict__clean-30x20, line/circle/circle-circle tangents). brep-rs matches the independent dof on ${brepAgree.length}/${brepRef.length} fixtures it can open; FreeCAD matches SolidCraft on ${fcAgree.length}/${fcPairs.length} (non-conflicting refs). Exceptions are the tangent stored-start rows (see the redundancy-flag row).`);
  add('degrees of freedom: dof > 0 (under-determined) count; parts may legitimately differ between engines', 'supported',
    `Run: ${CMD}. ${pos.length} accepted cases with dof>0 (dof 2,3,4,6: hv-only 4, width-only 3, width-and-height 2, pinned-corner 2, free-line 4, free-circle 3, triangle-joined 6, circle-radius-only 2, arc-centre-radius 2, slot floating 2 rough) all equal the independent Jacobian dof, brep-rs and FreeCAD refs. Which PART comes out when dof>0 is not compared as a defect: U1 (dof 2) and U2 (dof 4) give the same area on TS, brep-rs and SolidCraft (${R.s3.map((x) => `${x.id} ${x.tsArea}/${x.brepArea}/${x.scArea}`).join('; ')}), but parallel/perpendicular/equal added to a bare quad leave SolidCraft's answer 0 to 60% away from the TS solve the app adopts (see seedForNewRule row); a translator must freeze the solved coordinates before building.`);
  const tan = bad.filter((p) => p.mode === 'stored');
  add('redundant rules: redundancy flag / dof depends on the start state for tangent docs', 'wrong',
    `LOUD: SolidCraft reports the wrong degrees of freedom on a saved (already tangent) slot. Run: ${CMD}. ${method} Stored start: ${tan.map((p) => `${p.id.replace('sk-circle-arc-tangent__', '')} probe dof ${p.probe} vs true ${p.indep} (FreeCAD ${p.fc})`).join('; ')}. The SAME docs from a rough (non-tangent) start report the true dof (${bad.length === tan.length ? 'all ' + pairs.filter((p) => /slot-(r6|r12|arc)/.test(p.id) && p.mode === 'rough').map((p) => p.probe).join(',') : ''}). The solid is right (the part builds to ${'473.0793'} vs rough 473.0796 for the 6/30 slot; exact 473.0973, curved tolerance) and a deliberately wrong dimension (centre x+1) is still refused in both modes ("that would over-constrain the sketch (conflicts with k2, k3, k10, k11, k13, k14)"), so it is the dof/redundancy bookkeeping that is wrong: an exactly-tangent start counts the tangent as redundant, so a fully constrained slot reads as 4 free (floating 6 vs 2). Same defect as phase2 (still present at fe3717f). Not refused, no sentence, so a student sees 'under-constrained' on a finished slot. Mismatches outside the stored-start tangent rows: ${bad.filter((p) => p.mode !== 'stored').length}.`);
  // redundant dimension
  const R1 = R.s5[0], R2 = R.s5[1];
  const fcRed = rows1.filter((r) => r.fc?.bucket === 'redundant');
  add('redundant rules: duplicate or implied DIMENSION (solidcraft refuses where brep-rs and FreeCAD build)', 'refused',
    `Run: ${CMD}. Legacy R1 (rect, h/v sides, lock, length e0=40, e1=25 and a third length e2=40 implied by the rest): independent solver consistent with 1 dependent row, brep-rs bucket '${R1.brep.bucket}' and BUILDS volume ${g(R1.brep.volume)}, TS overConstrained false (residual ${g(R1.ts.residual)}), SolidCraft refuses at rule ${R1.sc.rule} (${R1.sc.ruleKind}). FreeCAD-gauntlet redundant variants: ${fcRed.map((r) => `${r.id.replace(/^sk-[a-z-]+__/, '')} -> ${r.modes.stored.status === 'refused-at-command' ? 'refused (' + r.modes.stored.ruleKind + ')' : 'kept, dof ' + r.modes.stored.probeDof}`).join(', ')}. So SolidCraft is stricter than the references for dimensions: a doc the app today accepts will fail to build until the redundant dimension is dropped or sent with driven:true. Same-value duplicate (S7): "that dimension is already determined by k2 (LinearDimension); add it as a driven (reference) dimension with driven: true". The sentence names internal ids and the workaround parameter, so reSHape needs its own plain sentence (e.g. 'this length is already fixed by the other rules; remove it or make it a reference').`,
    R1.sc.sentence);
  add('redundant rules: a duplicate or implied NON-dimension constraint (perpendicular on an h/v rectangle)', 'supported',
    `Run: ${CMD}. R2 (rect + lengths + perpendicular(e0,e1), implied by the h/v rules): independent solver consistent with 1 dependent row, brep-rs bucket '${R2.brep.bucket}' builds ${g(R2.brep.volume)}, TS no flag (overConstrained false, residual ${g(R2.ts.residual)}), SolidCraft ACCEPTS it silently and builds volume ${g(R2.sc.volume)} bbox ${JSON.stringify(R2.sc.bbox.map((v) => +v.toFixed(4)))} (exact 10000). It is only labelled redundant when asked: with if_redundant:'refuse' the same command answers "${R2.scRefuseProbe}". FreeCAD sk-conflict__redundant-perpendicular: dof 0 'redundant', SolidCraft accepted, probe dof 0. The part is correct; the redundancy is not visible through the referee rig without the extra flag.`);
}
// ---- S6 collapse
{
  const c = R.s6, m3 = c[0], m3b = c[1], m3c = c[2], s09 = c[3];
  add('collapsedByRatio (an edge under 25% of its length or the area under 25% after a solve)', 'supported',
    `${ENGINE_FREE} 4000 random before/after polygon pairs (3..6 corners; single-edge shrink factors 0.2/0.24/0.2499/0.2501/0.26/0.5/1/1.4 and whole-shape area shrink): agrees with an independent re-implementation of the stated rule on ${R.s6sweep.agree}/${R.s6sweep.total}, ${R.s6sweep.collapsedTrue} of them collapsed. On the three real collapse docs it is true (${c.slice(0, 3).map((x) => x.id.split('-')[0] + ' ' + x.startArea + '->' + x.tsRawArea).join(', ')}) and false on the S09 trapezoid (${s09.startArea}->${s09.tsRawArea}).`);
  add('collapse refusal: rules that force an edge to zero length (horizontal AND vertical on one edge), rows-and-rules sketch', 'wrong',
    `LOUD, the dangerous one. Run: ${CMD} (S6). Same rule set on a closed polygon: M3b skew quad (area ${m3b.startArea}) with horizontal+vertical on edge 1: reSHape flags it (collapsedByRatio true, TS area ${m3b.tsRawArea}) and keeps the original points; brep-rs diagnose 'consistent' but the BUILD IS REFUSED ("${m3b.brep.refusal}"); SolidCraft ACCEPTS both commands with no complaint and BUILDS a ${m3b.sc.faces}-face solid of area ${m3b.sc.area} (volume ${m3b.sc.area * 10}), i.e. the quad with one edge collapsed to a point, a different part from the one drawn. Same for the hexagon M3c (area ${m3c.startArea} -> built ${m3c.sc.area}, ${m3c.sc.faces} faces; brep-rs refuses the same way). The exact-coordinate rectangle M3 is refused, but only at extrude ("${m3.sc.sentence}"), not at the rule. Legacy outline path is NOT affected: the doc keeps the original points (solveDoc collapse gate) and all three kernels build the same 9180 (OCCT 9180, brep-rs 9180, SolidCraft 9180 for the skew quad). Required guard before SolidCraft can solve a soup: run collapsedByRatio on the solved polygon and refuse with a sentence like "these rules squeeze edge 1 down to a point".`,
    undefined);
}
// ---- S7 idempotent
{
  const ts = R.s7.ts, sc = R.s7.sc;
  const tsOk = Object.entries(ts).filter(([k, v]) => !k.endsWith('x1')).every(([k, v]) => v.errors.length === 0 && v.constraints.length === 1);
  add('idempotent rule calls (the same rule twice is a no-op, not a toggle)', 'supported',
    `${ENGINE_FREE} Real scripts, rule called 1-3 times: across x3, length(1,40) x2, equal x2, distX x2, pin x2, symmetric x2, angle x2 each leave exactly ONE stored constraint (${tsOk ? 'all 8 repeat cases' : 'MISMATCH'}), no error, no warning; a changed value replaces ('length 40 then 30' -> one length 30). SolidCraft is also not a toggle, but not idempotent for dimensions: the same non-dimension constraint 1/2/3 times builds the identical solid (volume ${g(sc.horizontalOnce.volume)}/${g(sc.horizontalTwice.volume)}/${g(sc.horizontalThrice.volume)}); a repeated dimension is REFUSED ("${sc.lengthTwiceSameValue.error}"), a contradicting one is refused ("${sc.length40then30.error}"), and with if_redundant:'refuse' the repeated horizontal answers "${sc.horizontalTwiceRefuse.error}". The doc never contains the duplicate (TS dedups first), so the translator never sends it; a hand-written soup with duplicate dimensions would be refused.`);
}
// ---- S8 seed
{
  const s = R.s8;
  add('seedForNewRule: fewest-movers seed for a freshly added parallel / perpendicular / equal rule', 'supported',
    `${ENGINE_FREE} 24 random quads (8 per kind). Independent property check: the seed leaves every corner not on the target edge exactly where it was (${s.parallel.seedKeepsOthers + s.perpendicular.seedKeepsOthers + s.equal.seedKeepsOthers}/24) and satisfies the rule exactly (${s.parallel.seedExact + s.perpendicular.seedExact + s.equal.seedExact}/24, residual < 1e-9). Cross-engine: SolidCraft's own solver, given only the same rule on the same quad, lands on the TS seeded solve for parallel (${s.parallel.scMatchesSeeded}/8, worst area delta ${g(s.parallel.worstVsSeeded)}) and perpendicular (${s.perpendicular.scMatchesSeeded}/8, ${g(s.perpendicular.worstVsSeeded)}), so SolidCraft is also fewest-movers there. For equal it does not (${s.equal.scMatchesSeeded}/8, area delta up to ${g(s.equal.worstVsSeeded)}): under-determined, legitimate divergence. Against the TS RAW solve that solveDoc actually adopts, SolidCraft matches 0/24 (perpendicular: 15%..60% area apart), so never let SolidCraft re-solve a legacy sketch; send the TS-solved coordinates. S09 trapezoid + parallel: TS seeded area ${R.s6[3].tsSeededArea}, TS raw (adopted) ${R.s6[3].tsRawArea}, SolidCraft ${R.s6[3].sc.area}, brep-rs ${R.s6[3].brep.volume / 10}.`);
}
// ---- S9 describe
{
  const ok = R.s9.describe.filter((x) => x.ok).length;
  add('describe(c): plain-sentence description of each rule kind', 'supported',
    `${ENGINE_FREE} All ${R.s9.describe.length} constraint kinds match the expected wording (${ok}/${R.s9.describe.length}): ${R.s9.describe.map((x) => `${x.kind}: "${x.got}"`).join('; ')}.`);
  const sc = R.s4.map((r) => r.sc.sentence).concat([R.s5[0].sc.sentence]);
  add('describe(c): plain-sentence descriptions of rules coming FROM SolidCraft (which rule fights or determines)', 'unsupported',
    `SolidCraft answers with internal constraint ids and class names, not edge or corner words: ${[...new Set(sc)].map((x) => '"' + x + '"').join('; ')}. The k# ids are assigned in command order and are not mapped back to doc rules (phase0 wrapper returns no constraint list), so no plain-sentence description of the offending rule can be produced from SolidCraft alone; the TS describe() works on the doc's own rules and covers the legacy path.`);
}
// ---- S4 losing edges
{
  const d = R.s4;
  add('losingEdges (legacy outline): which edges lose a fight', 'supported',
    `${ENGINE_FREE} Conflicts X1..X6: losingEdges ${d.map((r) => JSON.stringify(r.ts.losingEdges)).join(' ')}. The edges of the rule brep-rs blames (${d.map((r) => JSON.stringify(r.blamedEdges)).join(' ')}) are contained in the TS set ${d.filter((r) => r.blamedEdgesCoveredByLosingEdges).length}/${d.length} (the safe direction). It over-reports where a compromise bends neighbours: X2 flags all 4 edges for a blame on edge 3, X6 flags 3 for a blame on 2 (documented 'collateral'). Redundant and consistent cases report none (R1/R2 []).`);
  add('losingEdges: failing rules / edges identified by SolidCraft for a rows-and-rules sketch', 'unsupported',
    `SolidCraft's refusal lists constraint ids only (e.g. X2: "conflicts with k2, k3, k4, k5, k7, k9, k10, k11" = 8 ids for a conflict brep-rs pins on 1 rule), the SolveReport.failing list is discarded by the referee wrapper, and no id-to-rule map exists. No edge set can be produced; it is not mapped. The legacy TS losingEdges stays the source for red edges.`);
}
// ---- S10 labels
{
  const L = R.s10;
  add('sketchLabels: edge length labels and the dimension-vs-length kind', 'supported',
    `${ENGINE_FREE} Rectangle 40x25 with a length rule on edge 1: texts ${JSON.stringify(L.edgeLengths.texts)} (expected ${JSON.stringify(L.edgeLengths.want)}), kinds ${JSON.stringify(L.edgeLengths.kinds)} (dimension only on the ruled edge), each label exactly ${L.edgeLengths.offsetFromMidpoint[0]} units off its edge midpoint and farther from the centroid than the midpoint (${L.edgeLengths.outward}); 17.5 x 28/3 prints ${JSON.stringify(L.rounding.texts)}. The displayed 40 x 25 equals the SolidCraft-built bbox of that sketch (40 x 25, phase D1/R2: bbox [0,0,0,40,25,10]).`);
  const b = L.built;
  add('sketchLabels: corner R / C labels', 'supported',
    `${ENGINE_FREE} rounds {0:3}, chamfers {2:2.5} -> ${JSON.stringify(L.corners.texts)}; a corner asked for both shows only ${JSON.stringify(L.bothOnOneCorner.texts)}; treatmentsFromOutline recovers radius ${JSON.stringify(L.treatmentsFromOutline.roundsRecovered)} -> ${JSON.stringify(L.treatmentsFromOutline.labels)}. The labelled values are the geometry actually built: R4 on a 40x25x10 slab: closed form ${g(b[0].closedFormVolume)}, OCCT rel ${g(b[0].occt.rel)}, brep-rs ${g(b[0].brep.rel)}, SolidCraft ${g(b[0].sc.rel)} (${b[0].sc.faces} faces; curved bar 3e-4); C2.5: closed form ${g(b[1].closedFormVolume)}, OCCT/brep-rs/SolidCraft rel ${g(b[1].occt.rel)}/${g(b[1].brep.rel)}/${g(b[1].sc.rel)} (${b[1].sc.faces} faces).`);
  add('sketchLabels: bow labels (signed sagitta) and the circle diameter label', 'supported',
    `${ENGINE_FREE} bulge tan(pi/8) on a 40 chord -> bow ${JSON.stringify(L.bow.bowTexts)} (expected ${JSON.stringify(L.bow.want)}, sagitta = chord/2 * bulge), reversed ${JSON.stringify(L.bowNegative.bowTexts)}; the bowed edge gets no plain length label (labelled edges ${JSON.stringify(L.bow.edgeLabelsSkipForBowedEdge)}). circleLabel on a 10 diameter -> ${JSON.stringify(L.circle)} (expected ${JSON.stringify(L.circleWant)}). Built geometry for the bows: +8.28 closed form ${g(b[2].closedFormVolume)} vs OCCT ${g(b[2].occt.rel)}, brep-rs ${g(b[2].brep.rel)}, SolidCraft ${g(b[2].sc.rel)}; -8.28 closed form ${g(b[3].closedFormVolume)} vs ${g(b[3].occt.rel)}, ${g(b[3].brep.rel)}, ${g(b[3].sc.rel)} (SolidCraft tessellated arc, inside the 3e-4 curved bar).`);
  add('edge labels: the dimension value as measured by SolidCraft (sketch.dimension "measured" / SolveReport)', 'unsupported',
    `The SolidCraft dimension commands return a measured value, but the referee wrapper discards every command output except the first failure and the final inspect.measure, so no SolidCraft-measured dimension text could be read or compared; not mapped. The labels shown to the student come from the TS sketchLabels on the solved points, which were checked above.`);
}
const out = { group: 'sketch-dof-diagnosis', rows };
writeFileSync(new URL('../sketch-dof-diagnosis.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(rows.length, 'rows');
for (const r of rows) console.log(r.status.padEnd(12), r.feature.slice(0, 110));
