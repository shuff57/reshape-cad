// Row table for contract/sketch-constraints.json (round 2). Reads out/*.json through rows-lib.mjs; statuses are derived, evidence numbers are read.
//   bun docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/build-rows.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { J, rows, featureRow, probe, mostCommonSentence, sweepLine, storedLine, storedFor, sweepsFor, unguardedWrongIn, caughtIn, wrongPassedIn, ST, SW, PF, PG, LG, AC, PM, PB, ex, f, pct, sum, CMD, HERE, STATUS_RULE } from './rows-lib.mjs';

const ALLSW = [...new Set(SW.map((s) => s.id))];
const BRANCH_S = mostCommonSentence(ALLSW, 1);

// ============================ 1. soup rule kinds ===========================================================================================
featureRow('rule:coincident', { sentence: probe('probe-coincident-circle-end-a') });
featureRow('rule:pointOnObject', { sentence: probe('probe-pointOn-target-is-point') });
featureRow('rule:horizontal', { sentence: probe('horizontal on a circle') });
featureRow('rule:vertical', { sentence: probe('vertical on a circle') });
featureRow('rule:parallel', { sentence: probe('parallel line to circle') });
featureRow('rule:perpendicular', { sentence: probe('perpendicular line to circle') });
featureRow('rule:tangent', { sentence: probe('probe-tangent-line-vs-line') });
featureRow('rule:equal', { sentence: probe('probe-equal-line-vs-circle') });
featureRow('rule:symmetric', { sentence: probe('symmetric about a circle') });
featureRow('rule:distance', { sentence: probe('probe-distance-names-no-end') });
featureRow('rule:distanceX', { sentence: probe('probe-distanceX-start-level'), note: 'signed: the sign is the side the points are DRAWN on; SolidCraft\'s horizontal dimension is |d|, so a request for the other side is refused before the solve (mapper) and the signed residual is re-checked after it (guard).' });
featureRow('rule:distanceY', { sentence: probe('distanceY names a missing geometry') });
featureRow('rule:radius', { sentence: probe('probe-radius-zero') });
featureRow('rule:diameter', { sentence: probe('diameter on a line') });
featureRow('rule:angle', { sentence: probe('probe-angle-line-vs-circle') });
featureRow('rule:lock', { sentence: probe('probe-lock-as-reference'), note: 'a lock on an arc centre is only honest when the arc row is consistent (ends on its circle): the preflight refuses an arc whose centre is locked and whose ends are off its circle, see the "arc rows whose ends are off the circle, with a lock on the arc centre (c)" row; off-circle arcs without a lock are solved and checked, see the next row of that name.' });

// ============================ 2. references ================================================================================================
featureRow('point-ref:a/b/c ends (aEnd/bEnd/cEnd)', { feat: 'point-ref:a/b/c ends', sentence: probe('probe-coincident-circle-end-a') });
featureRow('point-ref:built-in origin (-1)', { feat: 'point-ref:origin -1', sentence: PB?.repros?.find((r) => /origin/.test(r.name))?.guardedSentence ?? '',
  note: PB?.repros?.find((r) => /origin/.test(r.name)) ? `origin named WITHOUT an end in a dimension row: SolidCraft's shipped mapper accepts it and builds (bbox ${JSON.stringify(PB.repros.find((r) => /origin/.test(r.name)).unguardedScBbox?.map((v) => +v.toFixed(3)))}); brep-rs refuses the same row ("${PB.repros.find((r) => /origin/.test(r.name)).brepRsOpenError}"). The contract preflight refuses it with the sentence shown, so the two engines no longer disagree on the DSL.` : '' });
featureRow('axis-ref:X/Y axes (-2, -3) in parallel/perpendicular/pointOnObject/symmetric', { feat: 'axis-ref:X/Y axes (-2,-3)', note: 'brep-rs refuses every row that uses a built-in axis as a line ("line -3 has zero length; a mirror line has no direction"), so the oracle for these cases is the closed form alone.' });

// ============================ 3. tangent forms =============================================================================================
featureRow('tangent:line-circle', { feat: 'tangent:line-circle', sentence: probe('probe-tangent-line-vs-line') });
featureRow('tangent:circle-circle external', { feat: 'tangent:circle-circle external' });
featureRow('tangent:circle-circle internal', { feat: 'tangent:circle-circle internal' });
featureRow('tangent:endpoint line-arc', { feat: 'tangent:endpoint line-arc', sentence: probe('probe-tangent-endpoint-no-coincident-row') });
featureRow('tangent:endpoint arc-arc (with coincident row)', { feat: 'tangent:endpoint arc-arc', sentence: probe('tangent endpoint on a circle end') });
featureRow('tangent:mode option (external|internal)', { feat: 'tangent:mode option', sentence: storedFor((r) => r.id === 'circle-circle-mode-request-external-start-internal')[0]?.sc?.refused ?? '' });
featureRow('tangent:side option', { feat: 'tangent:side option', sentence: storedFor((r) => r.id === 'tangent-line-circle-side-opposite')[0]?.sc?.refused ?? '' });

// ============================ 4. symmetric forms ===========================================================================================
featureRow('symmetric:about a line', { feat: 'symmetric:about line' });
featureRow('symmetric:about an axis', { feat: 'symmetric:about axis' });
featureRow('symmetric:3-point (c is the midpoint)', { feat: 'symmetric:3-point' });

// ============================ 5. values / flags ============================================================================================
featureRow('value:number', { feat: 'value:number' });
{
  const paramCase = ST.find((r) => r.id === 'rect-param-width');
  featureRow('value:param() (ParamNumber)', { feat: 'value:param()', note: `a param drag on the SAME side of the stored branch rebuilds exactly (rect width 30 -> 45 in round 1: SC 9000 vs 9000). A drag that crosses a branch is a separate row below. ${paramCase ? 'stored case: ' + storedLine(paramCase) : ''}` });
}
featureRow('active:false suppressed rule', { feat: 'active:false suppressed rule' });

// ============================ 6. legacy panel rules ========================================================================================
{
  const L = LG.filter((r) => !r.conflict && !r.error);
  const kinds = [
    ['legacy:across(edge) = horizontal', ['legacy-across-up-length-pin', 'legacy-pin-offset-corner']],
    ['legacy:up(edge) = vertical', ['legacy-across-up-length-pin', 'legacy-pin-offset-corner']],
    ['legacy:length(edge,v)', ['legacy-across-up-length-pin', 'legacy-rect-helper-dimensions']],
    ['legacy:equal(edge,other)', ['legacy-equal-edges-square']],
    ['legacy:parallel(edge,other)', ['legacy-parallel-perpendicular-trapezoid']],
    ['legacy:perpendicular(edge,other)', ['legacy-parallel-perpendicular-trapezoid']],
    ['legacy:pin(corner) = lock', ['legacy-across-up-length-pin', 'legacy-pin-offset-corner']],
    ['legacy:distX(a,b,v)', ['legacy-distX-distY-rect', 'legacy-parallel-perpendicular-trapezoid']],
    ['legacy:distY(a,b,v)', ['legacy-distX-distY-rect']],
    ['legacy:symmetric(a,b,center)', ['legacy-symmetric-midpoint-corner']],
    ['legacy:angle(edge,other,degrees)', ['legacy-angle-triangle']],
  ];
  const all = L;
  const aWorst = Math.max(...all.map((r) => r.A.worstResidual ?? 0));
  const aAreaWorst = Math.max(...all.map((r) => r.A.areaRel ?? 0)), aBboxWorst = Math.max(...all.map((r) => r.A.bboxRel ?? 0));
  const aMiss = all.filter((r) => (r.A.areaRel ?? 0) > 1e-9 || (r.A.bboxRel ?? 0) > 1e-9).length;
  const bWorstVol = Math.max(...all.map((r) => r.B?.volRel ?? 0)), bWorstBbox = Math.max(...all.map((r) => r.B?.bboxRel ?? 0));
  const bOk = all.filter((r) => r.B && !r.B.refused && (r.B.volRel ?? 0) <= 1e-9 && (r.B.bboxRel ?? 0) <= 1e-9 && r.B.legacyViolations.length === 0).length;
  const scOwn = Math.max(...all.map((r) => r.A.scVsOwnPolygon ?? 0)), scOcct = Math.max(...all.map((r) => (typeof r.A.occt?.vsSc === 'number' ? r.A.occt.vsSc : 0)));
  for (const [feature, ids] of kinds) {
    const rs = L.filter((r) => ids.includes(r.id));
    const ok = rs.length && rs.every((r) => r.B && !r.B.refused && r.B.volRel <= 1e-9 && r.B.bboxRel <= 1e-9 && r.B.legacyViolations.length === 0);
    const per = rs.map((r) => `${r.id}: route B (rules solved by SolidCraft) volume rel ${ex(r.B.volRel)}, bbox rel ${ex(r.B.bboxRel)}, legacy rules unmet at 1e-9: ${r.B.legacyViolations.length}, vs OCCT ${typeof r.B.occtVsSc === 'number' ? ex(r.B.occtVsSc) : 'n/a'}, vs brep-rs ${typeof r.B.brepVsSc === 'number' ? ex(r.B.brepVsSc) : 'n/a'}; route A (today: TS solver then SolidCraft extrudes its polygon) area rel ${ex(r.A.areaRel)}, bbox rel ${ex(r.A.bboxRel)}, worst unmet rule ${r.A.worstKind} ${ex(r.A.worstResidual)} ${r.A.worstUnit}, SolidCraft extrusion of that polygon vs its own exact area ${ex(r.A.scVsOwnPolygon)}, vs OCCT ${typeof r.A.occt?.vsSc === 'number' ? ex(r.A.occt.vsSc) : 'n/a'}`).join(' || ');
    rows.push({ feature, status: ok ? 'supported' : 'wrong', refusalSentence: '',
      evidence: `cmd: bun docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/legacy-run.mjs (needs SOLIDCRAFT_REFEREE_PKG2) || judged at the planar 1e-9 bar (round 1 relaxed it to 1e-5; round 2 does not) || ${per} || SUMMARY over the ${all.length} legacy docs: route B meets 1e-9 in ${bOk}/${all.length} (worst volume rel ${ex(bWorstVol)}, bbox rel ${ex(bWorstBbox)}); route A (the shipped pipeline) misses 1e-9 in ${aMiss}/${all.length} (worst area rel ${ex(aAreaWorst)}, bbox rel ${ex(aBboxWorst)}, worst coordinate-level rule violation ${ex(aWorst)}), because packages/sketch stops at its own tolerance (1e-7 per residual, 300 iterations); SolidCraft itself is exact on whatever polygon it is given (extrusion vs the polygon's exact area <= ${ex(scOwn)}, vs OCCT <= ${ex(scOcct)}). Status is judged on route B, the route that meets the bar; the shipped route's miss is the next row.` });
  }
  // shipped legacy precision row
  rows.push({ feature: 'legacy panel rules, shipped route A: solved by packages/sketch, polygon handed to SolidCraft (misses the planar bar)', status: aMiss ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `${aMiss} of ${all.length} legacy docs miss closed form by more than 1e-9: worst area rel ${ex(aAreaWorst)}, bbox rel ${ex(aBboxWorst)}; ${all.filter((r) => r.A.violations1e9.length).length} docs leave at least one rule unmet by more than 1e-9 (worst ${ex(aWorst)} mm; e.g. ${all.map((r) => r.id + ' ' + r.A.worstKind + ' ' + ex(r.A.worstResidual)).slice(0, 4).join('; ')}). This is the TS solver's tolerance, the same for brep-rs and OCCT (they are fed the same polygon: SolidCraft vs OCCT <= ${ex(scOcct)}); it is "wrong" only against the 1e-9 planar bar, and route B removes it (volume rel <= ${ex(bWorstVol)}).` });
  // conflicts
  const C = LG.filter((r) => r.conflict);
  const dropped = C.filter((r) => r.keptConstraints < r.statements);
  rows.push({ feature: 'legacy panel rules that conflict: runScript drops the older rule silently (shipped, upstream of SolidCraft)', status: dropped.length ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `cmd: bun .../sketch-constraints-r3/legacy-run.mjs || ${dropped.map((r) => `${r.id}: ${r.statements} rule calls written, ${r.keptConstraints} kept in the doc, run.warnings ${r.warnings.length}, shipped build is consistent with the ${r.keptConstraints} kept rules and ignores the rest`).join(' || ')} || packages/script reshape-script.ts applyConstraint settles a new rule by dropping an older one (the Rules panel's behaviour) and only pushes a warning when nothing could be dropped, so a student's written rule vanishes with no sentence; every kernel, SolidCraft included, then builds the rest correctly. The translator cannot see what runScript removed. Fix belongs in packages/script (push a ruleWarnings entry when result.removed !== null) and is NOT done here (packages/script is read-only for this spike). Without it the shipped pipeline returns a wrong part for a doc whose written rules conflict.` });
  const fight = C.find((r) => r.warnings.length);
  rows.push({ feature: 'legacy panel rules the settle cannot resolve: fighting rule left in the doc with run.warnings', status: fight && fight.A.guard.refuse && fight.B?.refused ? 'refused' : 'wrong',
    refusalSentence: fight?.B?.refused ?? '',
    evidence: fight ? `${fight.id}: runScript warns "${fight.warnings[0].slice(0, 90)}...", the doc keeps all ${fight.keptConstraints} rules, the TS solver leaves the parallel rule violated by ${ex(fight.A.worstResidual)} (${fight.A.worstUnit}) and the shipped route extrudes it silently (area ${f(fight.A.area, 3)}); guard A (independent legacy residual > 1e-4 mm / 1e-5, or any run.warnings) refuses: ${fight.A.guard.because}; route B (SolidCraft solves it) refuses: ${fight.B.refused}` : 'not measured' });
}
{
  const lp = (PB?.probes ?? []).filter((p) => p.id.startsWith('legacy-number-probe'));
  const refusedAll = lp.length && lp.every((p) => !p.guardedOk && p.sentence);
  rows.push({ feature: 'legacy: edge/corner numbers are 1-based', status: refusedAll && LG.some((r) => !r.conflict && r.B && !r.B.refused) ? 'supported' : 'unsupported', refusalSentence: lp[0]?.sentence ?? '',
    evidence: `cmd: bun .../sketch-constraints-r3/probes.mjs (legacy-number probes) and legacy-run.mjs || out-of-range numbers are refused by the script layer before any geometry exists (SolidCraft is not reached): ${lp.map((p) => `${p.id.replace('legacy-number-probe: ', '')} -> ${p.sentence}`).join(' || ')} || in-range numbers 1..n: ${LG.filter((r) => !r.conflict && r.B && !r.B.refused).length} legacy docs converted with line id = edge number and solved by SolidCraft at 1e-9 (legacy rows above).` });
}

// ============================ 7. shapes ====================================================================================================
featureRow('dimensioned rectangle', { feat: 'dimensioned rectangle' });
featureRow('right trapezoid', { feat: 'right trapezoid' });
featureRow('symmetric trapezoid', { feat: 'symmetric trapezoid' });
featureRow('hexagon (equal + pointOnObject)', { feat: 'hexagon (equal + pointOnObject)', sentence: mostCommonSentence(['hexagon-equal-pointOn-circle']) });
featureRow('slot with tangent joints (hand rows and sk.slot sugar)', { feat: 'slot with tangent joints', sentence: mostCommonSentence(['slot-hand-rows-R10-L40', 'slot-dims-from-points']) });

// ============================ 8. rough start / branch ======================================================================================
const swIds = (ids) => ids.filter((i) => ALLSW.includes(i));
function branchRow(feature, ids, extra = '', sentence = '') {
  const s = swIds(ids);
  const wp = wrongPassedIn(s), ug = unguardedWrongIn(s), cg = caughtIn(s);
  const stable = sweepsFor(s).filter((x) => x.frac <= 0.15).reduce((n, x) => n + (x.guarded.REFUSED ?? 0), 0), stableN = sweepsFor(s).filter((x) => x.frac <= 0.15).reduce((n, x) => n + x.N, 0);
  rows.push({ feature, status: wp ? 'wrong' : 'supported', refusalSentence: sentence || mostCommonSentence(s),
    evidence: `cmd: ${CMD.sweeps.replace(/^.*bun /, 'bun ')} || ${s.map(sweepLine).join(' || ')} || totals over these sweeps: the shipped route built ${ug} different solids silently; the post-solve branch check refused ${cg} of them and let ${wp} through; at the hand-drawn amplitudes (3.5% and 15%) ${stable} of ${stableN} starts were refused. ${extra}` });
}
branchRow('rough start: signed distanceX/distanceY branch', ['rect-corner-dx-dy-negative', 'right-trapezoid-par-perp-neg-dx', 'circle-radius-dx-dy', 'slot-dims-from-points'], 'signed offsets are also re-checked as SIGNED residuals after the solve (phase2/rule-check.mjs), which catches the |d| side flip independently of the branch check.');
branchRow('rough start: angle orientation branch', ['triangle-length-angle-120'], 'an angle drawn the other way round is refused before the solve (mapper); one that SolidCraft would swing to its supplement is caught after the solve by the quadrant check.');
branchRow('rough start: tangent external/internal branch', ['circle-circle-external-mode', 'circle-circle-internal-mode', 'tangent-line-circle', 'tangent-line-circle-side-matching'], 'the oracle is start-aware (oracle.mjs): the rules put the small circle on the X axis (or tangent to a line from above or below), so the mirror image is an equally valid solution and the side the circle was DRAWN on is the right one; round 1 scored every left-hand / below-the-line build against the right-hand / above-the-line closed form, which is why it counted 9 of 40 tangent-line-circle starts as a different solid where SolidCraft had kept the drawn side (brep-rs puts the circle above the line even when it was drawn below it).');
branchRow('rough start: wrong-branch starts refused, not silently flipped', ALLSW, `critic's four named families (endpoint-tangent slots, hexagon, symmetric-about-axis, signed dimensions) are in this total. These sweeps keep every arc self-consistent (centre, radius and both ends agree); hand-typed arc rows are measured separately in arcs-fuzz.mjs: ${(J('arcs-fuzz.json') ?? []).reduce((n, t) => n + t.N, 0)} rough starts with arc ends pushed off their circle by up to 1e-3 / 0.05 / 0.3 / 1 mm over 7 slot and oval fixtures, ${(J('arcs-fuzz.json') ?? []).reduce((n, t) => n + (t.guarded['BUILT-WRONG'] ?? 0) + (t.guarded['BUILT-OTHER-SIDE'] ?? 0), 0)} built wrong by the guarded route, ${(J('arcs-fuzz.json') ?? []).reduce((n, t) => n + (t.unguarded.POSE ?? 0) + (t.unguarded.VOLUME ?? 0), 0)} built wrong by the shipped route.`);
// per-family named by the critic
{
  const fam = [['endpoint-tangent slots and ovals', ['slot-hand-rows-R10-L40', 'slot-dims-from-points', 'oval-four-arcs-endpoint-tangent']], ['hexagon', ['hexagon-equal-pointOn-circle']], ['symmetric about an axis / a line', ['symmetric-trapezoid-about-Y-axis', 'symmetric-about-construction-line', 'symmetric-3point-midpoint']], ['signed dimensions and angles', ['rect-corner-dx-dy-negative', 'right-trapezoid-par-perp-neg-dx', 'triangle-length-angle-120']]];
  const lines = fam.map(([n, ids]) => { const s = swIds(ids); return `${n}: shipped built ${unguardedWrongIn(s)} silently different solids of ${sweepsFor(s).reduce((a, x) => a + x.N, 0)} starts, guard refused ${caughtIn(s)} of them, ${wrongPassedIn(s)} passed the guard`; });
  rows.push({ feature: 'post-solve branch check: SolidCraft silently lands on another valid solution (shipped translator, no check)', status: fam.some(([, ids]) => unguardedWrongIn(swIds(ids))) ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `the shipped mapper compares the REQUESTED branch with the start geometry only; nothing runs after the solve, so SolidCraft reports status "solved", dof 0, residual ~1e-10 and the extrude builds the wrong shape. Measured on the same seeded starts as round 1: ${lines.join('; ')}.` });
  rows.push({ feature: 'post-solve branch check: guard.mjs + branch.mjs (rule residuals, loop winding / crossing / corner bend / arc sweep, tangent side and mode, symmetric side, angle quadrant, cusp)', status: wrongPassedIn(ALLSW) ? 'wrong' : 'supported', refusalSentence: BRANCH_S,
    evidence: `${fam.map(([n, ids]) => { const s = swIds(ids); return `${n}: ${s.map((i) => sweepLine(i)).join(' / ')}`; }).join(' || ')} || over all ${ALLSW.length} sweep fixtures x 4 amplitudes x 40 seeds: ${sweepsFor(ALLSW).reduce((a, x) => a + x.N, 0)} starts, shipped route built ${unguardedWrongIn(ALLSW)} silently different solids, the check refused ${caughtIn(ALLSW)} of them and let ${wrongPassedIn(ALLSW)} through; it also refused ${sweepsFor(ALLSW).reduce((a, x) => a + x.spurious, 0)} starts where the shipped route had built the right solid (at 40% / 80% the start itself is mostly a self-crossing or mirrored loop, which carries no branch to keep).` });
}

// ============================ 9. accuracy, hoisting, quadrant ==============================================================================
{
  const acc = AC?.accuracy ?? [];
  const mx = (k, key) => Math.max(...acc.map((a) => a[k][key] ?? 0));
  rows.push({ feature: 'endpoint tangency curved accuracy (about 1e-4 mm)', status: acc.length && mx('volumeRel', 'max') <= 3e-4 ? 'supported' : acc.length ? 'wrong' : 'unsupported', refusalSentence: '',
    evidence: acc.length ? `cmd: bun .../sketch-constraints-r3/accuracy.mjs; read from SolidCraft's own solved points (@sketch dump), stored geometry + 30 rough starts (3.5%) per fixture: ${acc.map((a) => `${a.id.replace('gauntlet:sk-circle-arc-tangent__', 'FC:')}: ${a.built} built/${a.refused} refused, tangency error at the joint (line vs radius perpendicularity; for arc/arc the joint's distance from the line through the two centres) max ${ex(a.tangentPerpendicularityMm.max ?? 0)} mm (median ${ex(a.tangentPerpendicularityMm.median ?? 0)}), joint gap max ${ex(a.jointGapMm.max)} mm, arc end-radius mismatch max ${ex(a.arcEndRadiusMismatchMm.max)} mm, volume rel to closed form max ${ex(a.volumeRel.max)}, SolidCraft's own max_residual max ${ex(a.scMaxResidual.max)}`).join(' || ')} || so the joint error IS observable now and is up to ${ex(mx('tangentPerpendicularityMm', 'max'))} mm while SolidCraft reports status solved and residual <= ${ex(mx('scMaxResidual', 'max'))}: the residual cannot see it. The guard therefore checks tangent rows against 1e-3 mm, not 1e-6. Volume stays within the 3e-4 curved bar (worst ${ex(mx('volumeRel', 'max'))}).` : 'accuracy.json missing' });
  const dof = AC?.dof ?? [];
  const bad = dof.filter((d) => d.sc && (d.freecad ? d.sc.dof !== d.freecad.dof : d.brep?.dof != null && d.sc.dof !== d.brep.dof));
  rows.push({ feature: 'SolidCraft DoF / SolveReport / solved-point readout through this rig', status: bad.length ? 'wrong' : dof.length ? 'supported' : 'unsupported', refusalSentence: '',
    evidence: dof.length ? `cmd: bun .../sketch-constraints-r3/accuracy.mjs (uses the wrapper2 pkg that returns the @sketch dump; the phase0 pkg still cannot). Solved points: readable and used by the guard. DoF: SolidCraft's SolveReport disagrees with brep-rs${dof.some((d) => d.freecad) ? ' and the saved FreeCAD ref' : ''} on ${bad.length} of ${dof.length} sketches: ${bad.map((d) => `${d.id.replace('gauntlet:sk-circle-arc-tangent__', 'FC:')} SC dof ${d.sc.dof} redundant ${d.sc.redundant} vs brep-rs ${d.brep?.dof}${d.freecad ? ' / FreeCAD ' + d.freecad.dof : ''}`).join('; ')}. Every tangent-joint sketch (slots, oval) reports redundant rows and dof > 0 though the shape is fully determined, so the dof indicator must NOT be shown to the student from SolidCraft's report; the guard does not use it.` : 'accuracy.json missing' });
}
featureRow('lock-hoisting order', { feat: 'lock-hoisting order', note: 'round-1 control (unchanged mapper behaviour, re-confirmed by the canonical order which still sends locks first): the same start with the fix command moved to the end moved the bbox by 0.35-0.49 mm.' });
featureRow('angle:quadrant option', { feat: 'angle:quadrant option' });

// ============================ 10. profiles / bodies ========================================================================================
{
  const pr = PF?.rows ?? [];
  const oldBad = pr.filter((r) => r.oldSelector && !r.oldSelector.ok), oldNone = pr.filter((r) => !r.oldSelector);
  const newBad = pr.filter((r) => !r.guarded?.ok);
  rows.push({ feature: 'host profile selector docProfileIndices (phase2/sketch-map.mjs, shipped) on circle-only multi-profile sketches', status: oldBad.length || oldNone.length ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `cmd: bun .../sketch-constraints-r3/profiles-test.mjs || ${pr.length} constructed sketches (two discs r10/r5 at x=0 and x=30 or 28 with the centres at assorted heights, annuli, a three-disc nest): the shipped ray-cast selector builds a WRONG solid in ${oldBad.length} and selects no profile at all in ${oldNone.length}: ${[...oldBad, ...oldNone].slice(0, 6).map((r) => `${r.name} -> profiles ${JSON.stringify(r.oldIdx)} of ${r.profiles}, volume ${r.oldSelector ? f(r.oldSelector.volume, 1) : 'none'} vs ${f(r.want.volume, 1)}`).join('; ')}. Cause: SolidCraft's interior point of a disc is its centre and the horizontal ray from it grazes the polygon vertex at angle 0 of the disc's own loop. No refusal is shown. The seeded rough-start external-tangent circles of round 1 (80 starts at 3.5% and 15%) did not trip it: ${JSON.stringify(PF.seeded)}.` });
  rows.push({ feature: 'contract profile selector evenOddProfiles (guard.mjs: winding number, no ray) on the same sketches', status: newBad.length ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `the same ${pr.length} sketches through the guarded route: ${pr.length - newBad.length} build the expected volume with the right body count (volume within 1e-3 of the closed form, body count as expected), ${newBad.length} wrong. Includes the cases the shipped selector fails: ${oldBad.slice(0, 4).map((r) => r.name).join('; ')}.` });
}
{
  const nested = storedFor((r) => (r.feats ?? []).includes('nested loops (hole) profile selection'));
  rows.push({ feature: 'nested loops (hole): translateDoc extrudes every profile', status: 'wrong', refusalSentence: '',
    evidence: `unchanged finding from round 1 (sketch-constraints-results.json, plate-with-hole-default-profiles: translator default fills the hole, 10000 vs 9214.6), shipped translator code is not touched by this contract. The contract route (evenOddProfiles) builds it right: ${nested.map(storedLine).join(' || ')}.` });
  rows.push({ feature: 'translator: extrude with several profiles records only the first body', status: 'wrong', refusalSentence: '',
    evidence: `unchanged finding from round 1 (translatorUnderreports on two-circles-equal and the circle-circle cases: translator totals only bodies named like the feature). The guarded route sums all bodies: ${storedFor((r) => r.id === 'two-circles-equal' && r.mode === 'stored').map(storedLine).join('')}.` });
}

// ============================ 11. arc rows, redundancy, order ==============================================================================
{
  // round 3: the arc rows, redundant/conflicting rows, references, placement, axes and param drags are built in rows-r3.mjs from the new measurements
}
{
  const nm = PM?.named ?? [], rd = PM?.random ?? [];
  const wr = (o) => (o.POSE ?? 0) + (o.VOLUME ?? 0) + (o['MATCH-OTHER-SIDE'] ?? 0);
  const shW = nm.reduce((n, r) => n + wr(r.unguarded), 0), shN = nm.reduce((n, r) => n + sum(r.unguarded, Object.keys(r.unguarded)), 0);
  const gW = nm.reduce((n, r) => n + (r.guarded.WRONG ?? 0), 0);
  const rW = rd.reduce((n, r) => n + wr(r.unguarded), 0), rN = rd.reduce((n, r) => n + sum(r.unguarded, Object.keys(r.unguarded)), 0);
  const rGW = rd.reduce((n, r) => n + (r.guarded.WRONG ?? 0), 0), rGN = rd.reduce((n, r) => n + sum(r.guarded, Object.keys(r.guarded)), 0), rGR = rd.reduce((n, r) => n + (r.guarded.REFUSED ?? 0), 0);
  const diff = rd.reduce((n, r) => n + r.startsWithDifferentBuiltVolumes, 0), diffN = rd.reduce((n, r) => n + r.startsTested, 0);
  rows.push({ feature: 'rule row order changes the solved branch (shipped: rows sent in the order written)', status: shW + rW ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `cmd: bun .../sketch-constraints-r3/perm-test.mjs || named orders on both slots, 24 rough starts at 4% each (unguarded = mapper, rows in the order given): ${nm.map((r) => `${r.id} ${r.order}: ${JSON.stringify(r.unguarded)}`).join('; ')} || random permutations of the rows, 8 fixtures x 6 starts x 12 permutations: shipped route built ${rW} different solids of ${rN} (silent, status solved); the same doc is built right or wrong by row order alone, with status solved each time.` });
  rows.push({ feature: 'rule row order: contract ladder (canonical class order, first rung that passes every check)', status: gW + rGW ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `same orders and permutations through ladderSketch: named orders: ${nm.map((r) => `${r.id} ${r.order}: ${JSON.stringify(r.guarded)}`).join('; ')}; random: ${rGN} permuted runs, ${rGW} built wrong, ${rGR} refused; for ${diffN - diff} of ${diffN} starts every permutation that built gave the same volume (to 1e-6), ${diff} starts had permutations that built volumes differing by more than 1e-6. SolidCraft solves after every command, so the order it is sent rows in matters; the ladder sends them in fixed class orders (join, geometric, tangent, dimension ...; then the order written) and keeps the first attempt that passes every check, so a valid doc is not refused for an unlucky order and a wrong branch is never built.` });
}
{
  const sr = PB?.slotRefusals ?? [];
  const tot = (side, k) => sr.reduce((n, x) => n + (x[side][k] ?? 0), 0), N = sr.reduce((n, x) => n + sum(x.unguarded, Object.keys(x.unguarded)), 0);
  const errs = new Map(); for (const x of sr) for (const [k, n] of Object.entries(x.unguardedErrors)) errs.set(k, (errs.get(k) ?? 0) + n);
  const worstCell = sr.map((x) => ({ x, n: (x.unguarded.REFUSED ?? 0) + (x.unguarded.VOLUME ?? 0) + (x.unguarded.POSE ?? 0) })).sort((p, q) => q.n - p.n)[0];
  rows.push({ feature: 'valid slot from a rough start: spurious refusals and kernel-level wording', status: sr.length && !tot('guarded', 'WRONG') ? 'supported' : sr.length ? 'wrong' : 'unsupported', refusalSentence: mostCommonSentence([]) || (PB?.audit?.sample?.find((s) => /does not close into one flat loop/.test(s)) ?? ''),
    evidence: sr.length ? `cmd: bun .../sketch-constraints-r3/probes.mjs || both slots (hand rows, dims from points) x 4 row orders (as written, reversed, dimensions first, tangents first) x 3 amplitudes (2%, 4%, 6%) x 24 rough starts = ${N} starts: SHIPPED route: ${tot('unguarded', 'MATCH')} right, ${tot('unguarded', 'REFUSED')} refused by SolidCraft or the mapper, ${(tot('unguarded', 'VOLUME') + tot('unguarded', 'POSE'))} built WRONG; worst cell ${worstCell?.x.id} / ${worstCell?.x.order} / ${pct(worstCell?.x.frac ?? 0)}: ${worstCell ? JSON.stringify(worstCell.x.unguarded) : ''}. GUARDED route: ${tot('guarded', 'MATCH')} right, ${tot('guarded', 'REFUSED')} refused with a plain sentence, ${tot('guarded', 'WRONG')} wrong. SolidCraft's own error texts on the refusals (numbers masked): ${[...errs.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4).map(([k, n]) => `${n}x "${k}"`).join('; ')}. The guarded route maps those to the plain sentences listed in the wording row and the ladder retries the rows in other orders before refusing.` : 'probes.json missing' });
}
{
  const ang = PG?.rows?.angle ?? [], dx = PG?.rows?.dx ?? [];
  const isCross = (r) => (r.stored < 90) !== (r.value < 90) && r.value !== 90 && r.stored !== 90;
  const aSame = ang.filter((r) => !isCross(r)), aCross = ang.filter(isCross);
  const dSame = dx.filter((r) => r.sameSign), dCross = dx.filter((r) => !r.sameSign);
  const cnt = (xs, k) => xs.filter((r) => r.guarded === k).length;
  const wrongG = cnt(ang, 'WRONG') + cnt(dx, 'WRONG');
  rows.push({ feature: 'param() jump that stays on the stored branch (angle on the same side of 90 degrees as the stored one; signed distanceX with the same sign)', status: wrongG ? 'wrong' : cnt(aSame, 'REFUSED') + cnt(dSame, 'REFUSED') ? 'supported' : 'supported', refusalSentence: '',
    evidence: `cmd: bun .../sketch-constraints-r3/param-grid.mjs || angle: triangle stored at 13 angles (20..150), the angle param changed to 7 values (30..150): of the ${aSame.length} combinations on the stored side, ${cnt(aSame, 'MATCH')} rebuild exactly (planar 1e-9), ${cnt(aSame, 'REFUSED')} are refused${cnt(aSame, 'REFUSED') ? ' (' + aSame.filter((r) => r.guarded === 'REFUSED').map((r) => r.stored + '->' + r.value).join(', ') + ')' : ''}, ${cnt(aSame, 'WRONG')} wrong; signed distanceX stored side vs requested side, 6 x 6: of the ${dSame.length} same-sign drags ${cnt(dSame, 'MATCH')} are exact, ${cnt(dSame, 'REFUSED')} refused, ${cnt(dSame, 'WRONG')} wrong || for the slider families (hole diameter, hole centre, tangent circle radius, slot radius, triangle angle in 5 degree steps, rectangle sizes) see the 'param drag, <family>' rows from param-drags.mjs.` });
  rows.push({ feature: 'param() jump across a branch (angle across 90 degrees, signed distanceX across 0)', status: wrongG ? 'wrong' : 'refused', refusalSentence: ang.find((r) => r.sentence)?.sentence ?? dx.find((r) => r.sentence)?.sentence ?? '',
    evidence: `cmd: bun .../sketch-constraints-r3/param-grid.mjs || angle: of the ${aCross.length} combinations whose value lies across 90 degrees from the stored angle ${cnt(aCross, 'REFUSED')} are refused, ${cnt(aCross, 'MATCH')} rebuild exactly, ${cnt(aCross, 'WRONG')} are wrong (SolidCraft's angle dimension holds the reading nearest the start, so it moves at most a quarter turn from the stored geometry; there is no parameter to ask for the other reading and parameters.change is not on the bridge allowlist; the shipped route refused the same ${ang.filter((r) => r.unguarded === 'MAPPER-REFUSED').length}); signed distanceX: of the ${dCross.length} sign changes ${cnt(dCross, 'REFUSED')} are refused, ${cnt(dCross, 'MATCH')} exact, ${cnt(dCross, 'WRONG')} wrong; brep-rs on the same combinations (closed form of the new value): angle ${JSON.stringify(PG.angle.brep)}, signed distanceX ${JSON.stringify(PG.dx.brep)} || the same limit appears in the slider families as steps that jump across the boundary: see the 'valid values the route refuses' rows from param-drags.mjs for the exact values (hole centre across 0, circle radius across the other circle's radius, angle past 90 in 5 degree steps ...).` });
}
{
  // round 3: wording row built in rows-r3b below from out/audit.json (one-sentence lint + internals)
}

{
  const built = ST.filter((r) => !r.sc.refused && r.want);
  const planar = built.filter((r) => !r.curved), curved = built.filter((r) => r.curved);
  const withBrep = built.filter((r) => r.brep && r.brep.faces !== undefined);
  const faceMis = withBrep.filter((r) => r.brep.faces !== r.sc.faces);
  const pw = Math.max(...planar.map((r) => Math.max(r.sc.dv, r.sc.db))), cw = Math.max(...curved.map((r) => r.sc.dv));
  const vsB = Math.max(...withBrep.filter((r) => !r.curved).map((r) => r.brep.vsSc ?? 0)), vsO = Math.max(...built.filter((r) => !r.curved && r.occt?.vsSc !== undefined).map((r) => r.occt.vsSc));
  rows.push({ feature: 'planar 1e-9 bar and face counts over every soup case (stored + 3.5% rough start)', status: planar.every((r) => r.sc.dv <= 1e-9 && r.sc.db <= 1e-9) && !faceMis.length ? 'supported' : 'wrong', refusalSentence: '',
    evidence: `cmd: ${CMD.stored.replace(/^.*bun /, 'bun ')} || ${built.length} built cases (${planar.length} planar, ${curved.length} curved): planar worst volume/bbox rel to closed form ${ex(pw)} (bar 1e-9); curved worst volume rel ${ex(cw)} (truck volumes are tessellation-derived, the bar is 3e-4, every curved case is the same ~1e-4 chord error, not a solver miss); SolidCraft vs brep-rs planar volume worst ${ex(vsB)}; vs OCCT (where OCCT can referee) worst ${ex(vsO)}; face counts SolidCraft vs brep-rs equal in ${withBrep.length - faceMis.length} of ${withBrep.length} cases where brep-rs builds${faceMis.length ? '; mismatches: ' + faceMis.map((r) => `${r.id} [${r.mode}] SC ${r.sc.faces} vs brep-rs ${r.brep.faces}`).join('; ') : ''}.` });
}

{
  const g = ST.filter((r) => r.fc && !r.sc.refused);
  const ids = [...new Set(g.map((r) => r.id))];
  const worst = Math.max(...g.map((r) => r.fc.bboxVsSc)), worstCurved = Math.max(0, ...g.filter((r) => r.curved).map((r) => r.fc.bboxVsSc)), worstPlanar = Math.max(0, ...g.filter((r) => !r.curved).map((r) => r.fc.bboxVsSc));
  rows.push({ feature: 'saved FreeCAD refs (docs/replica/freecad/gauntlet/variants/refs): the 12 sketch fixtures', status: g.length && worst <= 3e-4 ? 'supported' : g.length ? 'wrong' : 'unsupported', refusalSentence: '',
    evidence: `cmd: ${CMD.stored.replace(/^.*bun /, 'bun ')} || ${ids.length} gauntlet fixtures (${ids.map((i) => i.replace('gauntlet:sk-', '')).join(', ')}) x stored + 3.5% rough start = ${g.length} builds, each compared with the saved FreeCAD bbox (the refs carry bbox, dof, conflicting, redundant): worst bbox rel ${ex(worst)} (planar ${ex(worstPlanar)}, curved ${ex(worstCurved)}); volume is judged against the closed form because the refs store no volume. FreeCAD's dof for all 12 is 0 and conflicting / redundant are empty; SolidCraft's SolveReport agrees for the planar and circle fixtures and disagrees for the three slots (see the DoF row).` });
}

await import('./rows-r3.mjs');
await import('./rows-r3b.mjs');
// ============================ checks before writing ==========================================================================================
{
  const { sentenceCount } = await import('./rows-lib.mjs');
  const STAT = ['supported', 'refused', 'unsupported', 'wrong'];
  const problems = [];
  for (const r of rows) {
    if (!STAT.includes(r.status)) problems.push(`status ${r.status}: ${r.feature}`);
    if (r.status === 'refused' && !r.refusalSentence) problems.push(`refused row without a sentence: ${r.feature}`);
    if (r.refusalSentence && sentenceCount(r.refusalSentence) !== 1) problems.push(`refusal sentence is ${sentenceCount(r.refusalSentence)} sentences: ${r.feature}: ${r.refusalSentence}`);
    if (!r.evidence || r.evidence.length < 40) problems.push(`no evidence: ${r.feature}`);
  }
  if (problems.length) { console.error('ROW CHECK FAILED:\n' + problems.join('\n')); }
  globalThis.__rowProblems = problems;
}
// ============================ write ========================================================================================================
for (const r of rows) if (!/^cmd:/.test(r.evidence)) r.evidence = 'cmd: sh docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/run-all.sh (needs SOLIDCRAFT_REFEREE_PKG2; see howToRun) || ' + r.evidence;
for (const r of rows) if (!r.summary) r.summary = r.evidence.replace(/^cmd:[^|]*\|\|\s*/, '').slice(0, 700);
const statuses = rows.reduce((o, r) => { o[r.status] = (o[r.status] ?? 0) + 1; return o; }, {});
const doc = {
  group: 'sketch-constraints',
  generatedAt: new Date().toISOString(),
  round: 3,
  statusRule: STATUS_RULE,
  rig: "SolidCraft fe3717f wasm. This round uses the wrapper2 pkg (SOLIDCRAFT_REFEREE_PKG2 = dir holding solidcraft_referee_p2.js): a wasm-bindgen --target nodejs build of docs/spikes/solidcraft-referee/phase2/wrapper2 against the same fe3717f source as the main pkg. wrapper2 returns every command's result plus the @sketch dump (solved points, SolveReport, profile list) that the phase0 pkg cannot. I did not rebuild it: it is the copy another builder on this run had already built (scratchpad crx/pkg2, 23419164-byte wasm), copied to scratchpad scr2/pkg2. Oracles: closed form (arithmetic next to each case, plus every mirror image that still satisfies the rules: oracle.mjs), live brep-rs wasm archive/brep-rs/pkg, live OCCT replicad-opencascadejs, saved FreeCAD refs docs/replica/freecad/gauntlet/variants/refs. brep-rs and OCCT cannot referee rows that use the built-in axes or construction geometry; and brep-rs puts a circle that was drawn below a line tangent ABOVE it, so brep-rs 'WRONG' counts in the sweeps are brep-rs disagreeing with the drawn side, not evidence against SolidCraft.",
  howToRun: 'cd <repo>; export SOLIDCRAFT_REFEREE_PKG2=<pkg dir>; sh docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/run-all.sh (sweeps, perm-test, profiles-test, stored-run, param-grid, legacy-run, accuracy, probes: one job at a time under systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0), then bun docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/build-rows.mjs',
  code: 'docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/ (guard.mjs, branch.mjs, geom.mjs, legacy.mjs, score.mjs, run-sweeps.mjs, stored-run.mjs, perm-test.mjs, param-grid.mjs, profiles-test.mjs, legacy-run.mjs, accuracy.mjs, probes.mjs, build-rows.mjs; measurements in out/)',
  round3Fixes: [
    { critic: 'The guarded route builds a constrained sketch on an offset plane or a frame at offset 0 (silent wrong solid)', done: 'guardedSketch reads sk.plane / sk.offset / sk.frame and hands them to the mapper; a placement preflight refuses unknown planes and malformed frames; a placement stage after the extrude compares the solid (centre of mass along the normal, in-plane position, world bbox) with the frame and refuses a mismatch. placement.mjs: 83 constrained sketches (3 shapes x 15 placements x stored/rough) all built at the right place against live brep-rs and OCCT; the round-2 route is kept as a control (71 of 71 placed sketches built at offset 0 with no refusal; the placement stage refuses all 71)' },
    { critic: 'Refusal sentences are not single sentences (38 of 40 permuted-run sentences were two)', done: 'CONFLICT and BRANCH rewritten as one sentence, only the first mapper refusal is shown, sentenceCount() lint (refs.mjs) over every final refusal of every run script (ladderSketch logs them to $SENTENCE_LOG; audit.mjs); the wording row now fails on a sentence count other than one' },
    { critic: 'Redundant but consistent dimensions are refused with a false "they conflict" reason, and slot-extra-radius is order dependent (9 of 16 refused, 7 built)', done: 'the guard sets aside a row SolidCraft refuses as already determined, solves the rest, and builds only if the solved sketch meets the set-aside row; otherwise refuses with the conflict sentence. redundant.mjs measures all nine sk-conflict / slot fixtures from docs/replica (FreeCAD refs: redundant and conflicting lists, Invalid sketches with no bbox) stored, 12 rough starts and 16 shuffled row orders each' },
    { critic: 'Arc rows off the circle refused far more widely than the lock-on-c row says', done: 'the preflight is narrowed to an arc whose centre a lock row pins; every other off-circle arc is solved and checked after the solve. exp-arcs.mjs and arcs-fuzz.mjs (hand-typed slots and ovals, ends pushed off the circle by 1e-5 to 2 mm, 280 rough starts per arm) compare with live brep-rs and the closed form; phase2 own-slot-dims-from-points (0.29 mm off) now builds' },
    { critic: 'driving:false reference: spurious refusal of a reference on the other side of the drawing, wrong value accepted silently', done: 'reference rows are never sent to SolidCraft (they add no equation; brep-rs session.rs reference_values says their stored number is stale by design); the route builds what the other rows fix and returns the measured value of every reference (result.references: stored, measured, stale), checked against brep-rs diagnose().references and the closed form; a reference on a non-dimension is refused in one sentence like brep-rs' },
    { critic: 'Built-in axes in angle, equal and tangent rows, and the other rule kinds, have no row', done: 'axes.mjs: 20 rule kind x slot x axis combinations; a tangent to an axis is now refused up front because the independent rule checker cannot read it (it used to throw inside the guard); a guard that throws is a refusal, never a build' },
    { critic: 'Slider-style param drags cross branches and the single refused row does not enumerate the gaps', done: 'param-drags.mjs: eight families (rectangle width, hole diameter, hole centre across the edge, external and internal tangent radius, slot radius, triangle angle in 5 degree steps, signed distanceX across 0, height to 0) as slider steps from the last built geometry and as jumps from the stored one, scored RIGHT / REFUSED-VALID (capability gap) / REFUSED-INVALID / WRONG against closed forms, with live brep-rs on the jumps; one row per family for each outcome class' },
    { critic: 'Hole drags that make the outline cross itself were refused as a branch', done: 'a crossing or self-crossing outline has its own sentence (CROSSING) instead of the branch sentence' },
  ],
  round2Fixes: [
    { critic: 'No check after the solve confirms SolidCraft stayed on the drawn branch', done: 'guard.mjs now runs five post-solve checks (SolveReport status, independent signed rule residuals, branch.mjs loop / corner / arc / tangent / symmetric / angle-quadrant / cusp features, images.mjs nearest mirror image, evenOddProfiles); every sweep row reports shipped-vs-guarded counts on the same seeds' },
    { critic: 'Result depends on rule row order', done: 'ladder of canonical row orders (JGTD*, GJTD*, GTDJ*, as written), first rung that passes every check wins; perm-test.mjs measures the four named orders and 12 random permutations x 6 starts x 8 fixtures' },
    { critic: 'wrong / supported labels applied inconsistently', done: 'one STATUS_RULE, statuses derived by deriveStatus() from the measurements; rows that describe the shipped code without the guard are separate rows and are wrong by the same rule' },
    { critic: 'Refusal sentences name internals', done: 'plainMapper / plainSc / preflight sentences name rows of sk.rules() and geometry numbers only; probes.mjs audits every sentence collected from every run against a forbidden-token pattern' },
    { critic: 'Legacy rows judged at 1e-5 and nothing refuses over-constrained legacy rules', done: 'judged at 1e-9; route B (legacy rules as soup rows solved by SolidCraft) meets it, the shipped route A does not (own wrong row); the settle in runScript drops conflicting rules silently (own wrong row, upstream); unsettled fights are refused by an independent residual check' },
    { critic: 'Endpoint tangency accuracy not observable, resting on a prior measurement', done: 'accuracy.mjs reads SolidCraft\'s solved points from the @sketch dump: joint perpendicularity, gap, end-radius mismatch, volume, max_residual over stored + 30 rough starts per fixture' },
    { critic: 'lock supported but a separate wrong row for arcs off the circle', done: 'preflight refuses any arc whose ends are not on its circle, so lock-on-c cannot pin a three-point circumcentre' },
    { critic: 'docProfileIndices drops a disc', done: 'reproduced (profiles-test.mjs), shipped selector row is wrong, evenOddProfiles (winding number) is the contract selector' },
    { critic: 'Spurious refusals / kernel wording', done: 'probes.mjs: both slots x four row orders x three amplitudes x 24 starts, shipped vs guarded, with SolidCraft\'s own error texts counted' },
    { critic: 'Param drag across a branch not measured', done: 'param-grid.mjs: 13 x 7 angle grid and 6 x 6 signed-distance grid; refused with a sentence, never wrong' },
    { critic: 'Origin reference without an end: mapper accepts, brep-rs refuses', done: 'preflight refuses it with brep-rs\'s meaning in plain words; the repro shows both engines' },
  ],
  counts: statuses,
  rows,
};
writeFileSync(path.join(HERE, '..', 'sketch-constraints.json'), JSON.stringify(doc, null, 1) + '\n');
console.log(`wrote sketch-constraints.json: ${rows.length} rows`, JSON.stringify(statuses));
for (const r of rows) console.log(r.status.padEnd(11), r.feature);
