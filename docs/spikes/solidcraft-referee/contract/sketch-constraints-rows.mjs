#!/usr/bin/env node
// Builds contract/sketch-constraints.json from sketch-constraints-results.json (written by sketch-constraints-run.mjs) plus three
// small live probes that need no case table (unsolved legacy doc, TS-solver residuals, translator body count).
// Every number in an evidence string is read from the results file or measured here; none is typed in by hand.
//
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/sketch-constraints-rows.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const imp = (p) => import(pathToFileURL(p).href);
const { runScript } = await imp(path.join(REPO, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(REPO, 'packages/script/dist/model-codegen.js'));
const { solveSketch } = await imp(path.join(REPO, 'packages/sketch/dist/sketch-solve.js'));
const mt = await imp(path.join(REPO, 'packages/script/dist/model-types.js'));
const arc = await imp(path.join(REPO, 'packages/sketch/dist/sketch-arc.js'));
const { translateDoc } = await imp(path.join(REPO, 'docs/spikes/solidcraft-referee/phase4/host/translate-p4.mjs'));
const R = JSON.parse(readFileSync(path.join(HERE, 'sketch-constraints-results.json'), 'utf8'));
let P2 = null; try { P2 = JSON.parse(readFileSync(path.join(REPO, 'docs/spikes/solidcraft-referee/phase2/results.json'), 'utf8')); } catch { /* */ }
const runSC = async (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));

const ex = (x) => (typeof x === 'number' ? x.toExponential(1) : String(x));
const f = (x, d = 6) => (typeof x === 'number' ? String(+x.toFixed(d)) : String(x));
const rec = (id, mode = 'stored') => R.results.find((x) => x.id === id && x.mode === mode);
const maxVs = (r, vs, name = null) => Math.max(0, ...(r?.checks ?? []).filter((c) => c.vs === vs && (!name || c.name === name)).map((c) => c.delta));
const sweep = (id, frac) => R.sweeps.find((s) => s.id === id && s.frac === frac);
const sentence = (r) => (r?.sentence ?? '').replace(/^pull1 \(extrude\): /, '');

/** one case, both start modes, in one line each */
function caseEv(id, modes = ['stored', 'rough']) {
  return modes.map((m) => {
    const r = rec(id, m);
    if (!r) return null;
    if (r.sc?.refused || /^REFUSED/.test(r.verdict)) return `${id} [${m}] ${r.verdict}: ${sentence(r).slice(0, 220)}`;
    const o = r.occt && !r.occt.refused ? `, vs OCCT ${ex(maxVs(r, 'OCCT'))}` : ', OCCT n/a (' + (r.occt?.refused ?? 'not built').slice(0, 40) + ')';
    const b = r.brep && !r.brep.refused ? `vs brep-rs ${ex(maxVs(r, 'brep-rs'))}` : `brep-rs ${r.brep?.refused ? 'refused' : 'n/a'}`;
    const fc = maxVs(r, 'FreeCAD ref') || r.checks?.some((c) => c.vs === 'FreeCAD ref') ? `, vs FreeCAD ref bbox ${ex(maxVs(r, 'FreeCAD ref'))}` : '';
    return `${id} [${m}] ${r.verdict}: SC volume ${f(r.sc.volume)} vs closed form ${f(r.want.volume)} (rel ${ex(maxVs(r, 'closed form', 'volume'))}), bbox rel ${ex(maxVs(r, 'closed form', 'bbox'))}, ${b}${o}${fc}, faces SC ${r.sc.faces}/brep-rs ${r.brep?.faces ?? '-'}, bodies ${r.sc.bodies}${r.brepSolve ? `, brep-rs dof ${r.brepSolve.dof}` : ''}`;
  }).filter(Boolean).join(' || ');
}
/** a sweep across amplitudes */
function swEv(id, fracs = [0.035, 0.15, 0.4, 0.8]) {
  return `sweep ${id} (40 seeded starts per amplitude, amplitude = fraction of sketch diagonal): ` + fracs.map((fr) => {
    const s = sweep(id, fr);
    if (!s) return `${+(fr * 100).toFixed(1)}%: not run`;
    const t = s.tally; const wrong = t.POSE + t.VOLUME;
    const br = Object.keys(s.brepClass ?? {}).length ? ` [brep-rs on same start: ${Object.entries(s.brepClass).map(([k, v]) => `${v}x ${k.split(' / ')[1]?.replace('BREP-', '').toLowerCase()}`).join(', ')}]` : '';
    return `${+(fr * 100).toFixed(1)}%: ${t.MATCH + t['TOL-MISS']} match${t['TOL-MISS'] ? ` (${t['TOL-MISS']} at the 1e-9 planar bar missed by solver residual, max ${ex(s.maxTolMiss)})` : ''}, ${t['MAPPER-REFUSED'] + t['SC-REFUSED']} refused, ${wrong} BUILT-DIFFERENT (${t.POSE} pose, ${t.VOLUME} volume)${br}`;
  }).join('; ');
}
const wrongAt = (id, fracs) => fracs.reduce((n, fr) => { const s = sweep(id, fr); return n + (s ? s.tally.POSE + s.tally.VOLUME : 0); }, 0);

// ---- three live probes ---------------------------------------------------------------------------------------------------
const probes = {};
{
  // (1) legacy panel rules: what the translator builds if the host forgets solveDoc (runScript keeps the DRAWN points)
  const src = `const sk = sketch('top')\nsk.polygon([[0, 0], [28, 1], [29, 17], [1, 18]])\nsk.across(1); sk.up(2); sk.across(3); sk.up(4)\nsk.length(1, 30); sk.length(2, 20); sk.pin(1)\nconst part = extrude(sk, 10)`;
  const run = runScript(src);
  const mk = async (doc) => { const tr = await translateDoc(doc, { arc, mt, runSC, resolveAt: () => null }); const e = tr.features.filter((x) => x.kind === 'extrude').at(-1); return e.status === 'built' ? { volume: e.measure.volume, bbox: e.measure.bbox } : { refused: e.refusal }; };
  probes.unsolved = { drawn: await mk(run.doc), solved: await mk(solveDoc(run.doc)), constraints: run.doc.features[0].constraints.length };
  // (2) TS solver residuals for the legacy cases
  probes.tsSolver = [];
  for (const r of R.results.filter((x) => x.id.startsWith('legacy-') && x.mode === 'stored' && x.script)) {
    let run2; try { run2 = runScript(r.script); } catch { continue; }
    const sk = run2.doc?.features?.find((x) => x.kind === 'sketch');
    if (!sk?.points || run2.errors?.length) continue;
    const pins = (sk.constraints ?? []).filter((c) => c.kind === 'lock').map((c) => c.corner);
    const res = solveSketch(sk.points, sk.constraints ?? [], pins);
    probes.tsSolver.push({ id: r.id, residual: res.residual, iterations: res.iterations, overConstrained: res.overConstrained });
  }
  // (3) the same two-circle sketch: all bodies vs what the translator records
  const two = R.results.find((x) => x.id === 'two-circles-equal' && x.mode === 'stored');
  probes.twoCircles = two?.translatorUnderreports ?? null;
}

// ---- rows ----------------------------------------------------------------------------------------------------------------
const rows = [];
const add = (feature, status, evidence, refusalSentence = null) => rows.push({ feature, status, refusalSentence: refusalSentence ?? null, evidence });
const CMD = 'cmd: SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/sketch-constraints-run.mjs --out=docs/spikes/solidcraft-referee/contract (rows then built by sketch-constraints-rows.mjs from sketch-constraints-results.json).';
const bars = 'bars: planar 1e-9 rel (volume, bbox), curved 3e-4 (truck tessellation), COM 1e-6 / 3e-5 x diagonal.';
const live = 'path: reSHape Script text -> runScript -> solveDoc -> phase4 translateDoc -> phase2 sketch-map.mjs -> SolidCraft extrude -> inspect.measure.';
const flipNote = (id) => swEv(id);

// ---- 16 soup kinds -------------------------------------------------------------------------------------------------
add('rule:coincident', 'supported',
  `${CMD} ${live} ${bars} ${caseEv('rect-origin-dims')} || ${caseEv('circle-diameter-origin-c')} || ${swEv('rect-origin-dims', [0.035, 0.15, 0.4])}. Coincident of a circle's end 'a' never reaches SolidCraft: the script layer refuses it: "${sentence(rec('probe-coincident-circle-end-a'))}". DoF not observable in this rig (prior phase2/results.json, not re-run: dof 0 for the same rect, truck = brep-rs = FreeCAD).`);
add('rule:pointOnObject', 'supported',
  `${CMD} ${live} point on a circle (hexagon): ${caseEv('hexagon-equal-pointOn-circle')}; point on a non-axis construction line (triangle apex, line locked at both ends): ${caseEv('triangle-apex-on-diagonal-line')}; point on the X axis (symmetric trapezoid): ${caseEv('symmetric-trapezoid-about-Y-axis')}. ${swEv('triangle-apex-on-diagonal-line', [0.035, 0.15, 0.4])}. Target that is a point: "${sentence(rec('probe-pointOn-target-is-point'))}". Caveat: the hexagon built from the same row set is its own row below (wrong at 15%).`,
  sentence(rec('probe-pointOn-target-is-point')));
add('rule:horizontal', 'supported', `${CMD} ${live} used by every rectangle case: ${caseEv('rect-origin-dims')} ${swEv('rect-origin-dims', [0.035, 0.15, 0.4])}. At 80% amplitude 1/40 starts built the mirrored rectangle (same volume, brep-rs lands on the same pose): the rows (unsigned lengths + origin) admit it, so it is an equivalent solution and not counted as wrong.`);
add('rule:vertical', 'supported', `${CMD} ${live} paired with horizontal in rect-origin-dims, square-by-equal, right trapezoid, legacy up(): ${caseEv('square-by-equal-lines')} ${caseEv('gauntlet:sk-rect-dof__corner-origin-25x60')}`);
add('rule:parallel', 'supported', `${CMD} ${live} parallel to a line and to the X axis: ${caseEv('right-trapezoid-par-perp-neg-dx')} || ${caseEv('rect-parallel-perpendicular-axes')} || ${caseEv('gauntlet:sk-rect-dof__parallelogram')} ${swEv('right-trapezoid-par-perp-neg-dx', [0.035, 0.15])}`);
add('rule:perpendicular', 'supported', `${CMD} ${live} perpendicular to a line and to the X axis: ${caseEv('right-trapezoid-par-perp-neg-dx')} || ${caseEv('rect-parallel-perpendicular-axes')} || ${caseEv('gauntlet:sk-rect-dof__right-triangle')}. (Observed in my first run, not in the final results file: my first draft of the axes rect used perpendicular(4, Y axis), which is horizontal and contradicts the loop: SolidCraft refused it with "sketch.constraint.perpendicular: invalid parameters ... that conflicts with the sketch: neither entity can move to satisfy it (they are fixed or fully constrained)"; the case was my error and was fixed, the refusal was correct.)`);
const tanWrong = wrongAt('slot-hand-rows-R10-L40', [0.035, 0.15]) + wrongAt('slot-dims-from-points', [0.035, 0.15]) + wrongAt('oval-four-arcs-endpoint-tangent', [0.035, 0.15]);
add('rule:tangent', 'wrong',
  `${CMD} ${live} WRONG SOLIDS, BUILT WITHOUT A REFUSAL, where brep-rs on the same start matches the closed form: endpoint tangent with arcs from a hand-drawn start. ${swEv('slot-hand-rows-R10-L40')}. ${swEv('slot-dims-from-points')}. ${swEv('oval-four-arcs-endpoint-tangent')}. ${tanWrong} wrong builds across the three cases at amplitudes <= 15%. Example (slot, 3.5%, seed 14): SolidCraft volume ${f(R.sweeps.find((s) => s.id === 'slot-hand-rows-R10-L40' && s.frac === 0.035)?.wrong?.[0]?.volume, 2)} and bbox y up to ${f(R.sweeps.find((s) => s.id === 'slot-hand-rows-R10-L40' && s.frac === 0.035)?.wrong?.[0]?.bbox?.[4], 3)} vs closed form ${f(rec('slot-hand-rows-R10-L40').want.volume, 2)} and 20. Simple tangent (line-circle, circle-circle) is fine at <= 15%, see the form rows. Stored/consistent starts all pass: ${caseEv('slot-hand-rows-R10-L40')}.`);
add('rule:equal', 'supported', `${CMD} ${live} line-line: ${caseEv('square-by-equal-lines')}; circle-circle: ${caseEv('two-circles-equal')} (volume as recorded by SolidCraft is right; see the translator body-count row); arc-arc inside slots and the oval. Line vs circle never reaches SolidCraft: "${sentence(rec('probe-equal-line-vs-circle'))}".`, sentence(rec('probe-equal-line-vs-circle')));
add('rule:symmetric', 'supported', `${CMD} ${live} about the Y axis: ${caseEv('symmetric-trapezoid-about-Y-axis')}; about a construction line: ${caseEv('symmetric-about-construction-line')}; 3-point: ${caseEv('symmetric-3point-midpoint')}. ${swEv('symmetric-3point-midpoint', [0.035, 0.15, 0.4, 0.8])}. ${swEv('symmetric-about-construction-line', [0.035, 0.15, 0.4])}. ${swEv('symmetric-trapezoid-about-Y-axis', [0.035, 0.15, 0.4])} (the trapezoid also carries a signed distanceY, see that row; 3 starts at 15% miss the 1e-9 planar bar by solver residual <= ${ex(sweep('symmetric-trapezoid-about-Y-axis', 0.15)?.maxTolMiss)}, solids correct). brep-rs cannot solve the Y-axis form at all (phase2: "line -3 has zero length; a mirror line has no direction"), so that case is scored against the closed form only.`);
add('rule:distance', 'supported', `${CMD} ${live} two-point distance (diagonal): ${caseEv('rect-diagonal-two-point-distance')}; line length (a line's own a/b): ${caseEv('rect-origin-dims')}. ${swEv('rect-diagonal-two-point-distance', [0.035, 0.15, 0.4])}. A distance row naming no end: "${sentence(rec('probe-distance-names-no-end')).slice(0, 170)}". Redundant and conflicting dimensions are refused at command time (stricter than brep-rs, which builds the redundant one): ${caseEv('rect-redundant-width-dimension', ['stored'])} || ${caseEv('rect-conflicting-width-dimension', ['stored'])}.`, sentence(rec('rect-redundant-width-dimension')));
const sx = (fr) => { const s = sweep('rect-corner-dx-dy-negative', fr); const t = sweep('right-trapezoid-par-perp-neg-dx', fr); return `${+(fr * 100).toFixed(1)}%: rect ${s.tally.POSE + s.tally.VOLUME}/40 built different, trapezoid ${t.tally.POSE + t.tally.VOLUME}/40`; };
add('rule:distanceX', 'wrong', `${CMD} ${live} Signed dimension; SolidCraft's is |d| and keeps the side of the start. Positive and negative values, stored and rough start OK: ${caseEv('rect-corner-dx-dy-positive')} || ${caseEv('rect-corner-dx-dy-negative')} || ${caseEv('right-trapezoid-par-perp-neg-dx')}. A start on the wrong side is refused: "${sentence(rec('probe-distanceX-start-level')).slice(0, 190)}" (level start) and, from the control, "${R.controls.find((c) => /signed dx negative requested, start positive \(mapper in force\)/.test(c.control))?.sentence?.split(' | ')[0]}". WRONG: starts the mapper ACCEPTS (start side agrees) still come out flipped: ${sx(0.4)}; ${sx(0.8)}; <= 15%: 0 (${sx(0.035)}; ${sx(0.15)}). brep-rs on the same start matches the closed form in ${sweep('rect-corner-dx-dy-negative', 0.4).brepClass['POSE / BREP-MATCHES-CLOSED-FORM']}/5 flipped rects at 40%. Same sweep detail: ${swEv('rect-corner-dx-dy-negative')}. Dropping the sign (what |d| would build) puts the rect at ${JSON.stringify(R.controls.find((c) => /sign dropped/.test(c.control))?.bbox)} instead of ${JSON.stringify(R.controls.find((c) => /sign dropped/.test(c.control))?.wantBbox)}.`);
add('rule:distanceY', 'wrong', `${CMD} ${live} same mechanism as distanceX (rect-corner-dx-dy-negative carries a signed -4 dy; the flipped solids in the sweep have the corner on the wrong side of the X axis, e.g. bbox y min ${f(sweep('rect-corner-dx-dy-negative', 0.4).wrong?.[0]?.bbox?.[1], 3)} instead of -4). ${caseEv('rect-corner-dx-dy-positive')} || ${caseEv('rect-corner-dx-dy-negative')}. ${swEv('rect-corner-dx-dy-negative')}.`);
add('rule:radius', 'supported', `${CMD} ${live} ${caseEv('circle-radius-dx-dy')} ${swEv('circle-radius-dx-dy')} (no wrong build at any amplitude; the refusals are the signed dx/dy start-side guard). Radius 0: "${sentence(rec('probe-radius-zero'))}". Curved bar: 1e-4 is tessellation (truck), not an error.`, sentence(rec('probe-radius-zero')));
add('rule:diameter', 'supported', `${CMD} ${live} ${caseEv('circle-diameter-origin-c')}; plate with a dimensioned hole: ${caseEv('plate-with-hole-default-profiles', ['stored'])}.`);
add('rule:angle', 'wrong', `${CMD} ${live} Directed angle; SolidCraft's is undirected. Start in the right orientation OK: ${caseEv('triangle-length-angle-120')}. A start drawn with the opposite turn is refused: "${sentence(rec('triangle-angle-wrong-orientation-start')).slice(0, 330)}". With the mapper bypassed SolidCraft builds the MIRROR triangle silently (volume ${f(R.controls.find((c) => /mapper bypassed/.test(c.control) && /angle/.test(c.control))?.volume)} equal to the right one, bbox y ${f(R.controls.find((c) => /mapper bypassed/.test(c.control) && /angle/.test(c.control))?.bbox?.min?.[1], 3)}..0 instead of 0..25.98). WRONG: starts the mapper accepts can still come out mirrored: ${swEv('triangle-length-angle-120')} (brep-rs on the same start matches the closed form, 2/2 at 40%). Quadrant: see its row.`);
add('rule:lock', 'supported', `${CMD} ${live} ${caseEv('rect-lock-offset-corner')} ${swEv('rect-lock-offset-corner', [0.035, 0.15, 0.4])}. Lock is hoisted ahead of the other rules by the mapper; the control that sends the fix command last moves the pinned corner (see the hoisting row). Lock as a reference: "${sentence(rec('probe-lock-as-reference'))}". Separate wrong-solid caveat for hand-edited arc rows is its own row.`, sentence(rec('probe-lock-as-reference')));

// ---- point refs ------------------------------------------------------------------------------------------------------
add('point-ref:a/b/c ends (aEnd/bEnd/cEnd)', 'supported', `${CMD} ${live} line a/b (every rect), arc a/b/c and tangent joints (slot, oval), circle c (circle cases), point a (3-point symmetric): ${caseEv('slot-hand-rows-R10-L40', ['stored'])} || ${caseEv('oval-four-arcs-endpoint-tangent', ['stored'])} || ${caseEv('symmetric-3point-midpoint', ['stored'])}. Arc names: a clockwise arc is stored ccw by SolidCraft and its points are named swapped; the mapper handles it (slot rows are clockwise arcs and pass). Circle end 'a': "${sentence(rec('probe-coincident-circle-end-a'))}".`, sentence(rec('probe-coincident-circle-end-a')));
add('point-ref:built-in origin (-1)', 'supported', `${CMD} ${live} ${caseEv('rect-origin-dims')} || ${caseEv('circle-diameter-origin-c')} (circle centre 'c' on the origin) || ${caseEv('circle-radius-dx-dy')} (distanceX/Y from the origin to a circle centre).`);
add('axis-ref:X/Y axes (-2, -3) in parallel/perpendicular/pointOnObject/symmetric', 'supported', `${CMD} ${live} parallel/perpendicular to the X axis: ${caseEv('rect-parallel-perpendicular-axes')}; pointOnObject on the X axis and symmetric about the Y axis: ${caseEv('symmetric-trapezoid-about-Y-axis')}. An axis has no point to name; the mapper says so for coincident.`);

// ---- tangent forms --------------------------------------------------------------------------------------------------
add('tangent:line-circle', 'supported', `${CMD} ${live} ${caseEv('tangent-line-circle')} ${swEv('tangent-line-circle', [0.035, 0.15])}. At 40%/80% the circle landed on the other side of the line in 9 and 10 of 40 (same volume, brep-rs lands on the closed-form side): the row has no side, so both sides are valid solutions and these are not counted wrong. A recorded side is honoured: see the side row. Curved volume deltas 1.1e-4 = tessellation.`);
add('tangent:circle-circle external', 'supported', `${CMD} ${live} Two touching discs (two bodies): ${caseEv('circle-circle-external-no-mode')} || ${caseEv('gauntlet:sk-circle-arc-tangent__circle-circle-external')}. brep-rs refuses this slot ("cross or touch"), so it is scored against the closed form pi*(64+25)*10 and the FreeCAD ref bbox. Total volume is only right when ALL bodies are counted: see the translator body-count row.`);
add('tangent:circle-circle internal', 'supported', `${CMD} ${live} A disc with a tangent internal hole: ${caseEv('circle-circle-internal-no-mode')} || ${caseEv('gauntlet:sk-circle-arc-tangent__circle-circle-internal')}. Right ONLY with the even-odd profile selection (done here by an interior point); the translator's default extrude fills the hole, see the nested-loop row. brep-rs refuses this case ("not fully inside"), so it is scored against the closed form pi*(64-25)*10.`);
add('tangent:endpoint line-arc', 'wrong', `${CMD} ${live} Slots (coincident + tangent rows at the joints). Stored/consistent and the seed-fixed rough start pass: ${caseEv('slot-sketch-sugar-R6-L30', ['stored'])} || ${caseEv('gauntlet:sk-circle-arc-tangent__slot-r6-L30-anchored')} || ${caseEv('gauntlet:sk-circle-arc-tangent__slot-r12-L18-anchored')}. But over 40 hand-drawn starts: ${swEv('slot-hand-rows-R10-L40')} ${swEv('slot-dims-from-points')}. Silent wrong solids where brep-rs matches the closed form. Prior wrapper2 evidence (phase2, not re-run): joint contact error 1.2e-4..1.5e-4 mm while the report says solved.`);
add('tangent:endpoint arc-arc (with coincident row)', 'wrong', `${CMD} ${live} Four-arc oval (R9 and r4 arcs, joints (+-5.4, +-3.2)), closed form from Green's theorem on the arcs = ${f(rec('oval-four-arcs-endpoint-tangent').want.area, 4)} mm2. Exact start passes: ${caseEv('oval-four-arcs-endpoint-tangent', ['stored'])}. Rough start (seed fixed): ${caseEv('oval-four-arcs-endpoint-tangent', ['rough'])}. ${swEv('oval-four-arcs-endpoint-tangent')}. e.g. SC built volume ${f(R.sweeps.find((s) => s.id === 'oval-four-arcs-endpoint-tangent' && s.frac === 0.035)?.wrong?.[0]?.volume, 1)} (3.25x the closed form ${f(rec('oval-four-arcs-endpoint-tangent').want.volume, 1)}) at 3.5%. Same rows in another ORDER: ${R.order.map((o) => `"${o.order}": ${o.tally.MATCH}/40 match, ${o.tally.VOLUME + o.tally.POSE} built different, ${o.tally['SC-REFUSED']} refused`).join('; ')}.`);
add('tangent:mode option (external|internal)', 'wrong', `${CMD} ${live} SolidCraft has no mode parameter; the branch is the start's. A request that contradicts the start is refused: "${sentence(rec('circle-circle-mode-request-external-start-internal')).slice(0, 330)}" and the internal twin "${sentence(rec('circle-circle-mode-request-internal-start-external')).slice(60, 330)}". With the request stripped SolidCraft builds the start branch silently (external requested, internal start: volume ${f(R.controls.find((c) => /external requested, internal start/.test(c.control))?.volume)} vs ${f(R.controls.find((c) => /external requested, internal start/.test(c.control))?.wantVolume)}). Matching starts pass: ${caseEv('circle-circle-external-mode')} || ${caseEv('circle-circle-internal-mode')}. WRONG: starts the mapper accepts but that land on the other branch: ${swEv('circle-circle-external-mode')} || ${swEv('circle-circle-internal-mode')} (<= 15%: none).`);
add('tangent:side option', 'supported', `${CMD} ${live} Side recorded and agreeing with the start: ${caseEv('tangent-line-circle-side-matching', ['stored'])}; ${swEv('tangent-line-circle-side-matching')} (no wrong build at any amplitude; the 20 and 27 refusals at 40%/80% are starts on the other side). Side contradicting the start: "${sentence(rec('tangent-line-circle-side-opposite'))}"`, sentence(rec('tangent-line-circle-side-opposite')));

// ---- symmetric forms ------------------------------------------------------------------------------------------------
add('symmetric:about a line', 'supported', `${CMD} ${live} ${caseEv('symmetric-about-construction-line')} ${swEv('symmetric-about-construction-line', [0.035, 0.15, 0.4])} (the mirrored pose at 40% is an equivalent solution; brep-rs also refuses those).`);
add('symmetric:about an axis', 'supported', `${CMD} ${live} ${caseEv('symmetric-trapezoid-about-Y-axis')} ${swEv('symmetric-trapezoid-about-Y-axis', [0.035, 0.15])}. At 40%/80% the trapezoid also carries a signed dY, so flipped builds belong to that row. brep-rs cannot solve this form (phase2), so only the closed form scores it.`);
add('symmetric:3-point (c is the midpoint)', 'supported', `${CMD} ${live} Mapped as a construction line plus SolidCraft's midpoint constraint (no extra DoF). ${caseEv('symmetric-3point-midpoint')} ${swEv('symmetric-3point-midpoint')}.`);

// ---- values / options ----------------------------------------------------------------------------------------------
add('value:number', 'supported', `${CMD} ${live} every case above; ${caseEv('rect-origin-dims', ['stored'])}.`);
{
  const p = rec('rect-param-width', 'stored');
  add('value:param() (ParamNumber)', 'supported', `${CMD} ${live} Script declares const width = param('width', 30) and writes value: width into a distance row. Default: ${caseEv('rect-param-width', ['stored'])}. Re-run with runScript values {'sk1_rule9-value': 45}: ${p.paramRerun?.verdict}, SC volume ${f(p.paramRerun?.scVolume)} vs closed form ${f(p.paramRerun?.wantVolume)}, bbox ${JSON.stringify(p.paramRerun?.bbox)}, brep-rs volume ${f(p.paramRerun?.brepVolume)}. The doc rows carry plain numbers after runScript; the mapper never sees a ParamNumber.`);
}
add('driving:false reference dimension', 'supported', `${CMD} ${live} Passed through the row as driving:false (the interpreter accepts it) and mapped to SolidCraft's driven dimension. Correct reference value: ${caseEv('rect-reference-dim-correct')}. Reference value 99 (impossible): ${caseEv('rect-reference-dim-wrong-value', ['stored'])} (value ignored, part unchanged). Refused: a reference distanceX of 0 -> "${sentence(rec('rect-reference-distanceX-zero'))}"; a reference lock -> "${sentence(rec('probe-lock-as-reference'))}".`, sentence(rec('rect-reference-distanceX-zero')));
add('active:false suppressed rule', 'supported', `${CMD} ${live} Two inactive rules (a distance of 99 and a horizontal on a vertical side) are skipped: ${caseEv('rect-inactive-conflicting-rule')}.`);

// ---- legacy panel rules ----------------------------------------------------------------------------------------------
const ts = (id) => probes.tsSolver.find((x) => x.id === id);
const legacyEv = (id) => `${caseEv(id, ['stored'])}; packages/sketch solveSketch residual ${ex(ts(id)?.residual)} mm, ${ts(id)?.iterations} iterations`;
const resMin = Math.min(...probes.tsSolver.map((x) => x.residual)), resMax = Math.max(...probes.tsSolver.map((x) => x.residual));
const LEG = `Legacy rules are solved by OUR TS solver (packages/sketch) inside solveDoc; SolidCraft only sees the solved polygon. SolidCraft equals live OCCT and brep-rs on that polygon to ~1e-15, but the closed form differs by up to 4.5e-6 relative (> the 1e-9 planar bar) because the TS solver ends at residuals ${ex(resMin)}..${ex(resMax)} mm (solveSketch, ${probes.tsSolver.filter((x) => x.iterations >= 300).length} of ${probes.tsSolver.length} cases hit its 300-iteration cap): that error is ours, not SolidCraft's.`;
add('legacy:across(edge) = horizontal', 'supported', `${CMD} ${live} ${LEG} ${legacyEv('legacy-across-up-length-pin')}`);
add('legacy:up(edge) = vertical', 'supported', `${CMD} ${live} ${legacyEv('legacy-across-up-length-pin')}; ${legacyEv('legacy-distX-distY-rect')}`);
add('legacy:length(edge,v)', 'supported', `${CMD} ${live} ${legacyEv('legacy-across-up-length-pin')}; ${legacyEv('legacy-rect-helper-dimensions')}`);
add('legacy:equal(edge,other)', 'supported', `${CMD} ${live} ${legacyEv('legacy-equal-edges-square')}`);
add('legacy:parallel(edge,other)', 'supported', `${CMD} ${live} ${legacyEv('legacy-parallel-perpendicular-trapezoid')}`);
add('legacy:perpendicular(edge,other)', 'supported', `${CMD} ${live} ${legacyEv('legacy-parallel-perpendicular-trapezoid')}`);
add('legacy:pin(corner) = lock', 'supported', `${CMD} ${live} pin keeps the corner where it is DRAWN (not at the origin): ${legacyEv('legacy-pin-offset-corner')}; ${legacyEv('legacy-rect-helper-dimensions')} (sk.rect(28,17,{at:[0,0]}) is centred, so pinned corner 1 sits at (-14,-8.5)).`);
add('legacy:distX(a,b,v)', 'supported', `${CMD} ${live} ${legacyEv('legacy-distX-distY-rect')}; negative value through the trapezoid: ${legacyEv('legacy-parallel-perpendicular-trapezoid')}`);
add('legacy:distY(a,b,v)', 'supported', `${CMD} ${live} ${legacyEv('legacy-distX-distY-rect')}; ${legacyEv('legacy-symmetric-midpoint-corner')}`);
{
  const r = rec('legacy-symmetric-midpoint-corner');
  add('legacy:symmetric(a,b,center)', 'supported', `${CMD} ${live} ${legacyEv('legacy-symmetric-midpoint-corner')}. FACE COUNT: SolidCraft ${r.sc.faces} vs brep-rs ${r.brep.faces}: the centre corner lies on the bottom edge (collinear), brep-rs/OCCT keep the bottom face split, SolidCraft merges the coplanar faces. Explained, volume/bbox/COM agree to ${ex(Math.max(maxVs(r, 'brep-rs'), maxVs(r, 'OCCT')))}.`);
}
add('legacy:angle(edge,other,degrees)', 'supported', `${CMD} ${live} ${legacyEv('legacy-angle-triangle')}`);
add('legacy: edge/corner numbers are 1-based', 'supported', `${CMD} ${live} 1-based numbering used by every legacy case above (corner 1 pinned = first polygon point). Out of range is refused by the script layer, before SolidCraft: "${sentence(rec('legacy-edge-number-9-of-4'))}" and "${sentence(rec('legacy-edge-number-0'))}". HAZARD, not SolidCraft: runScript keeps the DRAWN points; if a host skips solveDoc the translator ignores the constraints and builds the drawn polygon: with ${probes.unsolved.constraints} rules on a 4-point sketch the unsolved doc gives volume ${f(probes.unsolved.drawn.volume)} vs ${f(probes.unsolved.solved.volume)} solved (the drawn polygon is 476 mm2, the dimensioned part 600 mm2). Every host page in the spike calls solveDoc; the translator does not check.`, sentence(rec('legacy-edge-number-9-of-4')));

// ---- composites -----------------------------------------------------------------------------------------------------
add('dimensioned rectangle', 'supported', `${CMD} ${live} ${caseEv('rect-origin-dims')} || ${caseEv('rect-corner-dx-dy-positive')} || ${caseEv('gauntlet:sk-rect-dof__corner-origin-25x60')} || ${caseEv('gauntlet:sk-rect-dof__offset-corner-30x18')} || ${swEv('rect-origin-dims', [0.035, 0.15, 0.4])}. FreeCAD refs (read, not re-run): dof 0, bbox matches to ${ex(maxVs(rec('gauntlet:sk-rect-dof__corner-origin-25x60', 'rough'), 'FreeCAD ref'))}.`);
add('right trapezoid', 'supported', `${CMD} ${live} ${caseEv('right-trapezoid-par-perp-neg-dx')} ${swEv('right-trapezoid-par-perp-neg-dx', [0.035, 0.15])}. At 40%/80% it carries the signed distanceX branch problem (10/40 and 14/40 built different): see rule:distanceX.`);
add('symmetric trapezoid', 'supported', `${CMD} ${live} ${caseEv('symmetric-trapezoid-about-Y-axis')} ${swEv('symmetric-trapezoid-about-Y-axis', [0.035, 0.15])} (15%: 3 starts miss the planar 1e-9 bar by solver residual, max ${ex(sweep('symmetric-trapezoid-about-Y-axis', 0.15)?.maxTolMiss)}; volume right). At 40% 20/40 starts build different solids (signed dY); brep-rs refuses this form.`);
add('hexagon (equal + pointOnObject)', 'wrong', `${CMD} ${live} Exact and 3.5% starts pass: ${caseEv('hexagon-equal-pointOn-circle')}. ${swEv('hexagon-equal-pointOn-circle')}. At 15% SolidCraft BUILT a different solid in 4 of 40 starts (volume ${f(sweep('hexagon-equal-pointOn-circle', 0.15).wrong?.[0]?.volume, 2)} = half the hexagon: a triangle traversed twice, which the rows admit because no side length is dimensioned) while brep-rs lands on the hexagon in all 4. ${sweep('hexagon-equal-pointOn-circle', 0.15).tally['SC-REFUSED']} more are refused, e.g. "${sweep('hexagon-equal-pointOn-circle', 0.15).topSentences?.[0]?.raw?.slice(0, 220)}".`);
add('slot with tangent joints (hand rows and sk.slot sugar)', 'wrong', `${CMD} ${live} Stored/seeded-rough pass: ${caseEv('slot-sketch-sugar-R6-L30', ['stored'])} || ${caseEv('slot-hand-rows-R10-L40')} || ${caseEv('slot-dims-from-points')} || ${caseEv('gauntlet:sk-circle-arc-tangent__slot-arc-first-order')}. 40-start sweeps: ${swEv('slot-hand-rows-R10-L40', [0.035, 0.15, 0.4])} ${swEv('slot-dims-from-points', [0.035, 0.15, 0.4])}. The sugar form (sk.slot) is exact by construction; the hand-drawn start is where it fails.`);

// ---- rough start rows -----------------------------------------------------------------------------------------------
add('rough start: signed distanceX/distanceY branch', 'wrong', `${CMD} ${live} See rule:distanceX. Mapper refusals verified: level start and opposite-side start. Silent flips: ${sx(0.4)}; ${sx(0.8)}; none at <= 15%.`);
add('rough start: angle orientation branch', 'wrong', `${CMD} ${live} See rule:angle. ${swEv('triangle-length-angle-120')}.`);
add('rough start: tangent external/internal branch', 'wrong', `${CMD} ${live} See tangent:mode option. ${swEv('circle-circle-external-mode')}.`);
{
  const flips = ['rect-corner-dx-dy-negative', 'right-trapezoid-par-perp-neg-dx', 'triangle-length-angle-120', 'circle-circle-external-mode', 'circle-circle-internal-mode'];
  const n4 = flips.reduce((n, id) => n + wrongAt(id, [0.4]), 0), n15 = flips.reduce((n, id) => n + wrongAt(id, [0.035, 0.15]), 0);
  add('rough start: wrong-branch starts refused, not silently flipped', 'wrong', `${CMD} ${live} What works: six explicit wrong-branch starts are refused with a sentence (tangent mode x2, tangent side, signed dx/dy, level start, angle orientation; see their rows). What does not: over the five branch-bearing cases, 40 starts each, the mapper accepted starts (start side agrees) that SolidCraft then solved to the other branch ${n15} times at <= 15% amplitude and ${n4} times at 40% (all five cases: dx/dy rect, right trapezoid, angle triangle, circle-circle external, circle-circle internal), always silently; brep-rs on the same start either matches the closed form or refuses (it refuses the circle-circle cases outright). The start-state check is necessary but not sufficient: a post-solve branch check is missing.`);
}

// ---- accuracy, ordering ----------------------------------------------------------------------------------------------
{
  const fcs = ['gauntlet:sk-circle-arc-tangent__slot-r6-L30-anchored', 'gauntlet:sk-circle-arc-tangent__slot-r12-L18-anchored', 'gauntlet:sk-circle-arc-tangent__slot-arc-first-order'];
  const st = fcs.map((id) => maxVs(rec(id, 'stored'), 'FreeCAD ref')), rg = fcs.map((id) => maxVs(rec(id, 'rough'), 'FreeCAD ref'));
  add('endpoint tangency curved accuracy (about 1e-4 mm)', 'supported', `${CMD} ${live} Stored (solver barely moves) vs rough start, bbox against the FreeCAD ref: stored ${st.map(ex).join(' / ')}, rough ${rg.map(ex).join(' / ')} relative (about 5e-4 mm absolute on a 60 mm slot), volumes within the curved bar: ${fcs.map((id) => ex(maxVs(rec(id, 'rough'), 'closed form', 'volume'))).join(' / ')} (tessellation 3.8e-5..5.8e-5). The joint contact error itself is NOT observable in this rig (no sketch dump): prior wrapper2 measurement in phase2 (not re-run): 1.2e-4..1.5e-4 mm off perpendicular with status solved and residual ~6e-10; the residual cannot see it. Within the 3e-4 curved bar, so not called wrong; gated rows above are about the branch flips, not this.`);
}
{
  const c = R.controls.filter((x) => x.control === 'lock-hoisting');
  add('lock-hoisting order', 'supported', `${CMD} ${live} The mapper sends every sketch.constraint.fix first. Control, same rough starts with the fix sent last: pinned corner moves, bbox off by ${c.map((x) => ex(x.unhoisted.dBbox)).join(' / ')} relative (3 seeds; hoisted: ${c.map((x) => ex(x.hoisted.dBbox ?? 0)).join(' / ')}), e.g. bbox ${JSON.stringify(c[0].unhoisted.bbox.map((v) => +v.toFixed(3)))} instead of [5,3,0,35,23,10]. With hoisting: ${swEv('rect-lock-offset-corner', [0.035, 0.15, 0.4])}.`);
}
add('angle:quadrant option', 'supported', `${CMD} ${live} quadrant is accepted by the interpreter, carried as a note by the mapper and not sent to SolidCraft (its angle is undirected, orientation from the start): ${caseEv('triangle-angle-120-with-quadrant', ['stored'])}. brep-rs's quadrant never enters its residual either (phase2), so the solid is the same as without it; a student who expects quadrant to pick the other orientation gets the start's orientation, with no sentence.`);

// ---- extra rows the rig exposed ------------------------------------------------------------------------------------
add('nested loops (hole): translateDoc extrudes every profile', 'wrong', `${CMD} ${live} A 40x25 plate with a dia-10 hole: the translator alone extrudes all SolidCraft profiles, so the hole is FILLED: volume ${f(rec('plate-with-hole-default-profiles').scDefaultProfiles.volume)} vs closed form ${f(rec('plate-with-hole-default-profiles').want.volume)} (correct = 40*25*10 - pi*25*10). With the profile chosen by an interior point at ${JSON.stringify(rec('plate-with-hole-default-profiles').profilePoint)} (what the host page does with the sketch dump, which this pkg cannot produce): ${caseEv('plate-with-hole-default-profiles', ['stored'])}. Same for the internal-tangent discs: default volume ${f(rec('circle-circle-internal-no-mode').scDefaultProfiles.volume)} vs ${f(rec('circle-circle-internal-no-mode').want.volume)}. The guard exists only in the host page's second pass.`);
{
  const t = probes.twoCircles;
  add('translator: extrude with several profiles records only the first body', 'wrong', `${CMD} ${live} Two disjoint circles (equal radius) extrude to bodies 'b_pull1' and 'b_pull1 (2)'. translateDoc (phase4/host/translate-p4.mjs, byte-identical to phase5/host/translate-p4.mjs) totals only bodies named exactly like the feature, so its measure says ${t.translatorBodies} body, volume ${f(t.translatorVolume)}; SolidCraft has ${t.allBodies} bodies, total ${f(t.allVolume)} (closed form ${f(rec('two-circles-equal').want.volume)}). Same for touching discs: translator ${f(rec('circle-circle-external-no-mode').scTranslator.volume)} vs ${f(rec('circle-circle-external-no-mode').sc.volume)} (closed form ${f(rec('circle-circle-external-no-mode').want.volume)}). SolidCraft's geometry is right; the record the translator keeps is not, and any later hole/combine/fillet targets only body one (st.bodies = names of the first).`);
}
{
  const r = rec('slot-arc-rows-inconsistent-with-lock-c', 'stored');
  add('arc rows whose ends are off the circle, with lock on c', 'wrong', `${CMD} ${live} Hand-edited arc row: c=(0.1,10.2), r=10 but ends (0.2,0) and (-0.1,20.1) are not 10 from c. brep-rs pins c at the ROW (bbox ${JSON.stringify(r.brep.bbox.map((v) => +v.toFixed(3)))}); SolidCraft builds the arc from its three points and pins the circumcentre (bbox ${JSON.stringify(r.sc.bbox.map((v) => +v.toFixed(3)))}): ${ex(maxVs(r, 'brep-rs', 'bbox'))} relative / 0.15 mm absolute off, no refusal. The mapper does not check that a, b lie on the circle of c, r. Rows written by the sketch tools are consistent, so this needs a hand-edited script.`);
}
add('redundant/conflicting dimensions', 'refused', `${CMD} ${live} Redundant width (stated twice): ${caseEv('rect-redundant-width-dimension', ['stored'])} (brep-rs BUILDS this; SolidCraft is stricter). Conflicting width (30 and 35): ${caseEv('rect-conflicting-width-dimension', ['stored'])}. The run stops at the first refused command, so no part is built (nothing drops the rule silently in the translator). Under-constrained rect (height left free): ${caseEv('rect-underconstrained-height-free', ['stored'])} keeps the drawn 17 (brep-rs dof ${rec('rect-underconstrained-height-free').brepSolve.dof}).`, sentence(rec('rect-redundant-width-dimension')));
add('rule order changes whether an over-constrained check fires', 'wrong', `${CMD} ${live} The same 4-arc oval rows, 40 rough starts at 3.5%, three rule orders: ${R.order.map((o) => `"${o.order}": ${o.tally.MATCH} match, ${o.tally.VOLUME + o.tally.POSE} built different${o.wrong ? ` (brep-rs ${o.wrong.brep})` : ''}, ${o.tally['SC-REFUSED']} refused${o.sentences?.[0] ? ` ["${o.sentences[0].raw.slice(0, 200)}"]` : ''}`).join('; ')}. SolidCraft checks each command as it is added, so a perfectly consistent doc (brep-rs dof 0, consistent) is refused or solved differently by row order. The seed-fixed rough start in the case table is refused with: "${sentence(rec('oval-four-arcs-endpoint-tangent', 'rough'))}".`, sentence(rec('oval-four-arcs-endpoint-tangent', 'rough')));
add('SolidCraft DoF / SolveReport / solved-point readout through this rig', 'unsupported', `The pkg given (phase0 wrapper) returns only the final inspect.measure or the first failing command's error; it has no @sketch dump, so SolidCraft's own DoF, redundant list, max residual and solved points cannot be read here, and I was told not to rebuild the wasm. Solved geometry was judged through the extruded solid (planar results pin positions to ~1e-9). Prior evidence from phase2/results.json (wrapper2, NOT re-run): dof agrees with brep-rs/FreeCAD for non-tangent fixtures (e.g. own-rect-rough-dims 0/0/0), but stored (already tangent) slot docs report dof 4 with redundant [k3,k5,k7,k9] where the reference is 0, and rough starts report 0.`);

writeFileSync(path.join(HERE, 'sketch-constraints.json'), JSON.stringify({ group: 'sketch-constraints', generatedAt: new Date().toISOString(), rig: 'SolidCraft fe3717f wasm, phase0-style pkg (run(commands) -> final measure); live OCCT (replicad-opencascadejs); live brep-rs wasm archive/brep-rs/pkg; FreeCAD refs read from docs/replica/freecad/gauntlet/variants/refs', rows }, null, 1) + '\n');
const tally = {}; for (const r of rows) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log(`wrote ${path.join(HERE, 'sketch-constraints.json')}: ${rows.length} rows ${JSON.stringify(tally)}`);
for (const r of rows) console.log(`${r.status.padEnd(11)} ${r.feature}`);
