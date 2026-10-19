// ======================================================================================================================
// ROUND 5 ADDITIONS (spliced into build-rows.mjs by splice-r5.py before the file is written).
// Answers the critic of round 4: (a) the strong claims held only on the guarded pipeline, so the UNGUARDED behaviour now has its own `wrong` rows and every row that
// needs the guard says so in its name; (b) the guard no longer reads brep-rs' solved rows; (c) the distinct gaps it listed get rows of their own.
// ======================================================================================================================
import { readFileSync as rf5, readdirSync as rd5, existsSync as ex5, statSync as st5 } from 'node:fs';
const rawKind = (id) => kindOf(Bf(id));
const chkRaw = (feature, list) => { for (const [id, want] of list) { let got; try { got = rawKind(id); } catch (err) { fail(`RAW ROW "${feature.slice(0, 60)}": ${err.message}`); continue; } if (got !== want) fail(`RAW ROW "${feature.slice(0, 60)}": case ${id} is '${got}' in the unguarded run, the row says '${want}'`); } };
const rawLn = (id) => {
  const r = Bf(id); const t = r.truck ?? {};
  if (t.refused !== undefined) return `${id}: raw refusal "${t.refused}" (OCCT ${r.occt?.volume !== undefined ? n6(r.occt.volume) : 'no value'}, brep-rs ${r.brep?.volume !== undefined ? n6(r.brep.volume) : 'no value'})`;
  if (r.outcome === 'SCRIPT-REFUSED') return `${id}: script refused "${r.scriptErrors[0].replace(/^line \d+: /, '')}"`;
  const p = [`${id}: raw truck ${n6(t.volume)} mm3 (${t.bodies} body, ${t.faces} faces)`];
  if (r.translatorReported) p.push(`translate-p4 itself reports ${n6(r.translatorReported.volume)} (${r.translatorReported.bodies} body counted)`);
  p.push(`OCCT ${r.occt?.volume !== undefined ? n6(r.occt.volume) : 'no value'}`, `brep-rs ${r.brep?.volume !== undefined ? n6(r.brep.volume) : `refuses ("${String(r.brep?.refused).slice(0, 90)}")`}`);
  if (r.exact?.volume !== undefined) p.push(`closed form ${n6(r.exact.volume)}`);
  if (t.dVolOcct !== undefined) p.push(`dVol vs OCCT ${e(t.dVolOcct)}`);
  if (t.dBboxBrep !== undefined) p.push(`dBbox vs brep-rs ${e(t.dBboxBrep)}`);
  if (t.dComOcct !== undefined) p.push(`dCOM/diag ${e(t.dComOcct)} (bar ${e(t.comTol)})`);
  return p.join('; ');
};
const gcode = (id) => GM.get(id)?.truck?.guard ?? GM.get(id)?.guardCode ?? null;
const idsByCode = (codes) => [...GM.keys()].filter((id) => codes.includes(gcode(id)) && BM.has(id));
const rawBuilt = (id) => BM.get(id)?.truck?.volume !== undefined;

// ---- the guard is not in the shipped host --------------------------------------------------------------------------------------------------
{
  const PH7 = '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/phase7/';
  const walk = (d) => rd5(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? (['node_modules', 'screenshots'].includes(x.name) ? [] : walk(d + x.name + '/')) : [d + x.name]));
  const files = walk(PH7).filter((f) => /\.(mjs|js|ts|tsx|html|sh|md)$/.test(f) && st5(f).size < 6e6);
  const hits = files.filter((f) => rf5(f, 'utf8').includes('sketch-geometry.guard'));
  const pane = rf5(PH7 + 'pane/pane.js', 'utf8'); const tp4 = rf5(PH7 + 'pane/lib/translate-p4.mjs', 'utf8');
  const has = (s, re) => re.test(s);
  row("sketch-geometry guard inside the shipped host (phase7 pane + translate-p4): is it adopted?", 'unsupported',
    `Command: grep -rl "sketch-geometry.guard" docs/spikes/solidcraft-referee/phase7 (excluding node_modules, screenshots) over ${files.length} text files: ${hits.length} hits${hits.length ? ' (' + hits.map((h) => h.replace(PH7, '')).join(', ') + ')' : ''}. So NOTHING in the shipped host calls contract/sketch-geometry.guard.mjs. What the host DOES have: profile selection by the doc's even-odd fill (pane.js: ${has(pane, /docProfileIndices/) ? 'docProfileIndices present' : 'docProfileIndices ABSENT'}, runSC sets c.params.profiles for a soup extrude) and the translator's aggregate() (translate-p4.mjs: ${has(tp4, /function aggregate/) ? 'aggregate() present' : 'aggregate() absent'}, counts only the body named b_<id>). What it does not have: any refusal of a self-crossing outline, crossing / touching / repeated shapes, an arc that is not on its circle, a curve too small for the part, a curved shape far from the origin, an underdetermined soup, a slider value outside the language's range, a pull of 0, or the one-sentence rewrite of engine and interpreter text. Every row in this table named "[needs the sketch-geometry guard]" is therefore refused ONLY if the host calls the guard (guardDoc/guardSketch with the doc, guardPull before an extrude, valuesVerdicts on the panel values, studentSentence on every text the student sees, repairOutline around outlineOf); the rows named "[raw translator ...]" below say what the student gets today instead. Status unsupported: the integration is not done, and this campaign may not edit phase7.`, undefined, { raw: true });
}

// ---- where the soup guard gets its solved rows -----------------------------------------------------------------------------------------------
{
  const all = Object.entries(solveCheck).filter(([, v]) => v.mine && !v.mine.unsupported);
  const movedMine = all.filter(([, v]) => v.mine.moved > 1e-6);
  const movedBrep = all.filter(([, v]) => (v.brepMoved ?? 0) > 1e-6);
  const differ = all.filter(([, v]) => (v.mine.moved > 1e-6) !== ((v.brepMoved ?? 0) > 1e-6));
  const under = movedMine.filter(([, v]) => v.mine.dofMoved > 0);
  const closeBoth = movedMine.filter(([, v]) => v.mine.dofMoved === 0 && v.apartFromBrep !== null && (v.brepMoved ?? 0) > 1e-6);
  const maxApart = Math.max(0, ...closeBoth.map(([, v]) => v.apartFromBrep));
  const probe = (() => { try { return JSON.parse(rf5(HERE + 'results-guarded/pkg-probe.json', 'utf8')); } catch { return null; } })();
  row("soup guard fed by SolidCraft's OWN solved sketch (the host's @sketch probe) instead of a stand-in solver", 'unsupported',
    `Not measured against SolidCraft's own solve, for a reason that can be reproduced: the pre-built referee pkg exports one function, run(), and ${probe ? `running {command:'@sketch'} through it returns ${JSON.stringify(probe.reply)}` : "an @sketch command is refused as 'unknown command'"}; the probe lives only in phase2/wrapper2 (a different wasm build), and this campaign may not rebuild the wasm. Round 4 filled the gap with brep-rs' sketch session, which is retired (archive/) and which, as the critic showed, can put a point-on-line circle centre at x=346595 and produce a nonsense sentence. Round 5 removes that dependency: the guard now solves with contract/sketch-geometry.solve.mjs (signed rule residuals + Levenberg-Marquardt from the typed rows + DoF from the rank of the rule Jacobian, per rule-connected component; no kernel, no brep-rs), and asks the host's own solve instead whenever the caller passes ctx.solve (the pane would pass SolidCraft's solved points and its SolveReport dof). Run solve-check.mjs over ${all.length} soup sketches of the guarded run (${Object.keys(solveCheck).length - all.length} not solvable by the independent solver): ${all.filter(([, v]) => !v.mine.converged).length} did not converge; the typed rows already obey every rule (moved <= 1e-6 mm, so NO solver can change them) in ${all.length - movedMine.length}; the rules move the rows in ${movedMine.length} (brep-rs' session moves ${movedBrep.length}; the two disagree on whether anything moves in ${differ.length}: ${differ.map(([id, v]) => `${id} (independent ${v.mine.moved.toExponential(1)}, brep-rs ${(v.brepMoved ?? 0).toExponential(1)})`).join('; ') || 'none'}); of those ${movedMine.length}, ${under.length} leave freedom in what moved (dofMoved > 0) and are refused by the underdetermined rule below, ${movedMine.length - under.length} are pinned completely (dofMoved 0) and build. Where both solvers moved a fully pinned sketch their solved rows are at most ${maxApart.toExponential(1)} mm apart (${closeBoth.length} sketches), so the stand-in did not change any pinned result. WHAT IS STILL OPEN: the real-host path (SolidCraft's solve through @sketch) was not run; the ${movedMine.length} sketches the rules move are the ones whose guard decision rests on the independent solver rather than on the typed rows. To reproduce the real path: build phase2/wrapper2 (see RIG.md), set SOLIDCRAFT_REFEREE_PKG2, and pass ctx.solve built from its @sketch dump.`, undefined, { raw: true });
}

// ---- the RAW translator (what the student gets today) -----------------------------------------------------------------------------------------
{
  const ctlIds = ['ctl-noprofiles-plate-hole', 'ctl-noprofiles-ring', 'ctl-noprofiles-island', 'ctl-noprofiles-slot-hole'];
  chkRaw('raw holes', ctlIds.map((i) => [i, 'fail']));
  row("[raw translator, no profile selection] several closed shapes on one sketch: a plate with a hole, a ring, an island in a hole, a slot cut in a plate", 'wrong',
    `${cmd('control-noprofiles')} translate-p4 alone (SolidCraft extrudes every face of the planar subdivision, profiles:"all"): ${ctlIds.map(rawLn).join(' || ')}. The hole is FILLED: plate 30x20 with a 6 hole builds ${n6(Bf('ctl-noprofiles-plate-hole').truck.volume)} against the closed form ${n6(Bf('ctl-noprofiles-plate-hole').exact.volume)}, with no sentence. The shipped pane adds profile selection (pane.js runSC; supported row for several shapes), which is why these four are a control, not the shipped behaviour; any other caller of translate-p4 gets the wrong solid.`, undefined, { raw: true });

  const pieceIds = ['a5-A-two-squares-apart', 'a5-A-ring-disc', 'a5-D-3level-polys', 'a5-D-slot-in-hole-in-plate', 'a5-D-tilted-frame-two-pieces'];
  const under = pieceIds.filter((i) => BM.get(i)?.translatorReported && BM.get(i).translatorReported.volume < BM.get(i).truck.volume * (1 - 1e-6));
  if (under.length !== pieceIds.length) fail(`raw pieces: only ${under.length} of ${pieceIds.length} cases have a translator total below the all-bodies total`);
  row("[raw translator] the total translate-p4 reports for a sketch that makes several separate pieces (two squares apart, a ring with a disc inside, nested rectangles)", 'wrong',
    `${cmd('attacks')} Even WITH profile selection the translator's own aggregate() counts only the body named b_<id>, and SolidCraft names the second piece 'b_<id> (2)': ${pieceIds.map(rawLn).join(' || ')}. The SolidCraft build itself is right (sum over all bodies = brep-rs and the closed form); the number the translator REPORTS (and the bbox, face count and centre of mass with it) is not: two squares apart report ${n6(Bf('a5-A-two-squares-apart').translatorReported.volume)} against ${n6(Bf('a5-A-two-squares-apart').exact.volume)}. The guarded harness replaces the aggregate with a count over every piece of the lineage (sg-guarded.mjs aggregateLineage); the shipped translator does not.`, undefined, { raw: true });

  const cross = idsByCode(['outline-crosses', 'outline-touches']).filter((i) => rawBuilt(i) && BM.get(i).brep?.volume === undefined && BM.get(i).brep?.refused !== undefined);
  if (cross.length < 6) fail(`raw crossing: only ${cross.length} cases`);
  row("[raw translator] a polygon / rounded / bulged outline that crosses or touches itself (bow-tie, pentagram, spike back through the outline, inward bow deeper than the part)", 'wrong',
    `${cmd('outline')} + ${cmd('extra')} + ${cmd('attacks')} + ${cmd('guard')} ${cross.length} cases where the raw translator BUILDS a solid with no sentence while brep-rs refuses the outline and OCCT gives a different volume: ${cross.slice(0, 8).map(rawLn).join(' || ')}${cross.length > 8 ? ` || and ${cross.length - 8} more` : ''}. The bow-tie [[0,0],[40,25],[40,0],[0,35]] pulled 10: the translator reports ${n6(Bf('a5-A-bowtie2').translatorReported.volume)}, all bodies ${n6(Bf('a5-A-bowtie2').truck.volume)}, OCCT ${n6(Bf('a5-A-bowtie2').occt.volume)}, brep-rs refuses.`, undefined, { raw: true });

  const shapes = idsByCode(['shapes-cross', 'shape-overlaps', 'shapes-touch', 'shape-repeated', 'corner-touch', 't-junction', 'nothing-solid']).filter(rawBuilt);
  if (shapes.length < 6) fail(`raw shapes: only ${shapes.length} cases`);
  row("[raw translator] several shapes on one sketch that cross, overlap, share an edge, touch at a point, repeat each other, or end in the middle of another edge", 'wrong',
    `${cmd('soup')} + ${cmd('fc')} + ${cmd('attacks')} + ${cmd('guard')} ${shapes.length} cases where the raw translator BUILDS with no sentence (brep-rs and OCCT refuse or disagree): ${shapes.slice(0, 8).map(rawLn).join(' || ')}${shapes.length > 8 ? ` || and ${shapes.length - 8} more` : ''}. A rectangle with a circle crossing its edge builds ${n6(Bf('a5-A-crossing').truck.volume)} mm3 (translator reports ${n6(Bf('a5-A-crossing').translatorReported.volume)}); the same circle drawn twice builds a solid that is not the doc's even-odd fill.`, undefined, { raw: true });

  const arcs = idsByCode(['arc-radius-mismatch', 'arc-ends-off-circle']).filter(rawBuilt);
  row("[raw translator] a .geom arc whose radius or ends disagree (r=7 but both ends 10 from the centre, a slot radius slider moved)", 'wrong',
    `${cmd('soup')} + ${cmd('extra2')} ${arcs.length ? `${arcs.length} cases built silently: ${arcs.slice(0, 6).map(rawLn).join(' || ')}` : 'every such case is refused by the engine in this run, with engine wording (see the guard row)'}; the arc the 3D build draws is not the arc the rows describe (brep-rs / OCCT disagree or refuse).`, undefined, { raw: true });

  const far = ['far-grid-rr-s1-at-1e4', 'far-grid-rr-s1-at-1e5', 'far-grid-rr-s0.25-at-3000', 'far-grid-rr-s1-at-30000', 'far-grid-rr-s4-at-1e6'];
  chkRaw('raw far', far.map((i) => [i, 'fail']));
  row("[raw translator] a curved outline far from the origin (rounded rectangle at [1e4, 1e4] and beyond)", 'wrong',
    `${cmd('far')} Volume and bounding box stay exact (dVol vs OCCT ~3e-6, dBbox ~1e-13) but the centre of mass drifts with the SQUARE of the distance: ${far.map(rawLn).join(' || ')}. At 1e6 the outline stops closing: ${rawLn('far-grid-rr-s1-at-1e6')}. The round-4 evidence for far coordinates was a plain rectangle only (planes row), which stays exact at 1e6: ${rawLn('far-rect-at-1e6')}.`, undefined, { raw: true });

  const sl = ['a5-slide-rect-pdup', 'a5-slide-r0-neg2'];
  chkRaw('raw slider', [['a5-slide-rect-pdup', 'fail'], ['a5-slide-r0-neg2', 'pass']]);
  row("[raw translator] a number typed into the panel after the script ran: a rectangle corner slid onto its neighbour, a round radius below 0, an across below 0", 'wrong',
    `${cmd('attacks')} (RunOptions.values / applyParam write the doc AFTER the script's own checks). ${sl.map(rawLn).join(' || ')}. Corner 1 slid onto corner 0: the 3D build gets the rule-solved polygon, brep-rs solves it differently (bbox differs by ${e(Bf('a5-slide-rect-pdup').truck.dBboxBrep)}, OCCT builds nothing). A round radius of -2 is turned into 'no round' by applyParam (a value at or below 0 deletes the entry), so all three engines build the SAME sharp corner and nothing disagrees, but the request was dropped silently. An across of -6 is clamped to 0 and the engine then names the wrong cause: ${rawLn('a5-slide-across-neg6')}.`, undefined, { raw: true });

  const ucw = ['a5-uc-two-circles-equal-radius', 'a5-uc-grow-hole'];
  chkRaw('raw underdetermined', [['a5-uc-two-circles-equal-radius', 'fail'], ['a5-uc-grow-hole', 'fail']]);
  row("[raw translator] an underdetermined soup: rules that must move the shape but do not say where it ends up (an `equal` rule between circles of radius 3 and 9, a rectangle resized by a dimension)", 'wrong',
    `${cmd('attacks')} ${ucw.map(rawLn).join(' || ')}. The equal rule gives radius 3 in SolidCraft and radius 6 in brep-rs (${e(Math.abs(Bf('a5-uc-two-circles-equal-radius').truck.volume - Bf('a5-uc-two-circles-equal-radius').brep.volume) / Bf('a5-uc-two-circles-equal-radius').brep.volume)} apart in volume), both satisfy every rule, and no sentence says so. The resized rectangle sits ${e(Math.abs(Bf('a5-uc-grow-hole').truck.volume - Bf('a5-uc-grow-hole').brep.volume) / Bf('a5-uc-grow-hole').brep.volume)} apart in volume between the two engines.`, undefined, { raw: true });

  const eng = [...BM.keys()].filter((i) => BM.get(i).truck?.refused !== undefined && lintSentence(BM.get(i).truck.refused) && (BM.get(i).brep?.volume !== undefined || BM.get(i).occt?.volume !== undefined) && !String(BM.get(i).truck.refused).startsWith('The ') );
  const eng2 = eng.length ? eng : [...BM.keys()].filter((i) => BM.get(i).truck?.refused !== undefined && lintSentence(BM.get(i).truck.refused) && (BM.get(i).brep?.volume !== undefined));
  row("[raw translator] a refusal in engine wording where brep-rs or OCCT BUILD the part (every family: a round or chamfer that eats a whole edge such as the stadium or chamfer(2,99) on a 20 edge, curves at the size floor, loose-end soups)", 'unsupported',
    `${cmd('attacks')} + ${cmd('round3')} ${eng2.length} cases where the shipped translator refuses with the engine's own text although brep-rs (and often OCCT) build the part: ${eng2.slice(0, 5).map(rawLn).join(' || ')}${eng2.length > 5 ? ` || and ${eng2.length - 5} more` : ''}. The student sees 'solid.extrude' / 'sketch.line' words and no next step; nothing is built. With the guard, repairOutline() drops the zero-length edge and the part builds (a5-A-stadium: ${ln('a5-A-stadium')}).`, undefined, { raw: true });
}

// ---- guard rows for the gaps the critic listed ------------------------------------------------------------------------------------------------
{
  const farIds = [...GM.keys()].filter((i) => i.startsWith('far-') && !i.startsWith('far-grid'));
  const gridIds = [...GM.keys()].filter((i) => i.startsWith('far-grid'));
  const all = [...farIds, ...gridIds, 'a5-C-far-rect-round', 'a5-C-far-hole'];
  const refusedFar = all.filter((i) => R(i).truck?.refused !== undefined);
  const acceptedFar = all.filter((i) => R(i).truck?.refused === undefined);
  const acceptedBad = acceptedFar.filter((i) => kindOf(R(i)) !== 'pass');
  if (acceptedBad.length) fail(`far guard: accepted but not a pass: ${acceptedBad.join(', ')}`);
  const over = refusedFar.filter((i) => BM.has(i) && kindOf(BM.get(i)) === 'pass');
  const worstAcc = Math.max(0, ...acceptedFar.map((i) => R(i).truck?.dComOcct ?? 0));
  chk('far curved', [['far-grid-rr-s1-at-1e4', 'refused'], ['far-grid-rr-s1-at-3000', 'pass'], ['far-rect-at-1e6', 'pass'], ['a5-C-far-rect-round', 'refused']]);
  row("a curved outline far from the origin: rounded rectangle, circle, slot at [1e3 .. 1e6] and sketch('top', 1e3 .. 1e6), sizes x0.25, x1, x4", 'refused',
    `${cmd('far')} + ${cmd('attacks')} ${all.length} cases. Calibration (unguarded, centre-of-mass error / part diagonal, bar 3e-5): rounded rectangle 30x20 with ONE round pulled 12: ${['far-grid-rr-s1-at-1e3', 'far-grid-rr-s1-at-3000', 'far-grid-rr-s1-at-1e4', 'far-grid-rr-s1-at-30000', 'far-grid-rr-s1-at-1e5', 'far-grid-rr-s1-at-300000'].map((i) => `${i.replace('far-grid-rr-s1-at-', '')}: ${e(Bf(i).truck?.dComOcct)}`).join(', ')}, 1e6: ${before('far-grid-rr-s1-at-1e6')}. A part a quarter the size fails 4x sooner (x0.25: 3000 gives ${e(Bf('far-grid-rr-s0.25-at-3000').truck.dComOcct)}) and a part 4x the size much later (x4: 1e5 gives ${e(Bf('far-grid-rr-s4-at-1e5').truck.dComOcct)}, 1e6 gives ${e(Bf('far-grid-rr-s4-at-1e6').truck.dComOcct)}), so the rule is a ratio, not a distance: refuse when the largest IN-PLANE world coordinate of a curved outline exceeds ${150} x the part's 3D diagonal for an outline with a partial arc (rounded corner, slot cap, bulge) and ${5000} x for outlines whose curves are all full circles (symmetric, measured smaller drift). The position along the sketch normal is not counted (sketch('top', 1e6) is exact: ${ln('far-rrect-plane-1e6')}). A plain rectangle is not subject to the rule (exact at 1e6: ${ln('far-rect-at-1e6')}). Result over ${all.length} cases: ${acceptedFar.length} accepted, every one PASS (worst centre-of-mass error among the accepted ${e(worstAcc)}, bar 3e-5); ${refusedFar.length} refused, of which ${over.length} were PASS unguarded (the cost: ${over.map((i) => i.replace('far-', '')).join(', ')}; the slot rows have no centre-of-mass oracle at all because OCCT cannot build a slot sketch). Only an extrude is checked (guardPull); a pocket or hole drawn far from the origin is covered by the extrude-pocket group.`,
    [S('far-grid-rr-s1-at-1e4'), S('far-grid-ci-s1-at-300000')].join(' | '));
}

{
  const sl = ['a5-slide-r0-neg2', 'a5-slide-across-neg6', 'a5-slide-across-0', 'a5-slide-slot-g1r-0', 'a5-slide-rect-pdup', 'a5-slide-rect-collapse', 'a5-slide-rect-collinear', 'a5-slide-rect-bowtie', 'a5-param-r-neg', 'a5-param-d-neg', 'a5-param-w-neg'];
  chk('slider values', sl.map((i) => [i, i === 'a5-param-w-neg' || i === 'a5-param-d-neg' || i === 'a5-param-r-neg' ? 'refused' : 'refused']).concat([['a5-slide-r0-0', 'pass'], ['a5-slide-r0-400', 'pass']]));
  const notice = (GM.get('a5-slide-r0-400').notices ?? [])[0];
  if (!notice) fail('slider: the 400 round has no notice');
  row("numbers written into the doc AFTER the script ran (panel boxes, RunOptions.values: <sketch>_r<corner>, <sketch>_across, <sketch>_g<row>r, <sketch>_p<n>u/v) and a param() whose default is out of range", 'refused',
    `${cmd('attacks')} The script probe (and the language's own checks) cannot see these: runScript applies values with applyParam() after the script ran. Measured: ${rawLn('a5-slide-r0-neg2')} (all three engines build a sharp corner, so nothing disagrees; the request was dropped); ${rawLn('a5-slide-across-neg6')}; a corner slid onto its neighbour (${rawLn('a5-slide-rect-pdup')}). Guard pieces: valuesVerdicts(values) reads the slot keys (round below 0, across at or below 0, radius at or below 0, non-numbers), guardTypedCorners(sk) judges the TYPED corners before the rule solve (the interpreter's solve and brep-rs' solve move a collapsed rectangle to different shapes), and the normal doc checks cover the rest. Controls that must keep building: round slider 0 (sharp corner, by design: ${ln('a5-slide-r0-0')}) and a round slider of 400 (clamped to the 10 the corner can take, with this notice to the student: "${notice.sentence}"; ${ln('a5-slide-r0-400')}). Correction to round 4: the critic's param-name-keyed cases (values: { w: -4 }) are NOT applied by runScript (it keys values by slot, not by param name; measured: the default size was built), so those cases were rewritten as script defaults (param('w', -4)), which the script probe refuses: ${S('a5-param-w-neg')}`,
    [S('a5-slide-r0-neg2'), S('a5-slide-across-neg6'), S('a5-slide-slot-g1r-0'), S('a5-slide-rect-pdup')].join(' | '));
}

{
  const ids = ['a5-uc-two-circles-equal-radius', 'a5-uc-grow-hole', 'a5-uc-shrink-hole-edge', 'a5-uc-shrink-hole-outside', 'a5-uc-hole-radius-rule-big', 'a5-uc-hole-diam-eq-width', 'a5-uc-equal-big-overlap', 'a5-uc-hole-pointon-edge'];
  chk('underdetermined', ids.map((i) => [i, 'refused']).concat([['gallery-fr-rect-dims', 'pass'], ['gallery-fr-hexagon', 'pass'], ['gallery-fr-symmetric-profile', 'pass'], ['param-values-arc-rule', 'pass']]));
  const codeIds = [...GM.keys()].filter((i) => gcode(i) === 'rules-underdetermined');
  const overIds = codeIds.filter((i) => BM.has(i) && kindOf(BM.get(i)) === 'pass');
  const pinned = ['gallery-fr-rect-dims', 'gallery-fr-plate-hole-dims', 'gallery-fr-triangle-angle', 'gallery-fr-hexagon', 'gallery-fr-symmetric-profile', 'param-values-arc-rule'];
  row("a soup whose rules MOVE the shape and leave it free (an `equal` rule between circles of radius 3 and 9, a rectangle resized by one dimension with no lock): the final shape is a solver's choice", 'refused',
    `${cmd('attacks')} + ${cmd('friendly')} Rule: solve the rows independently (sketch-geometry.solve.mjs), and if the rules move the typed rows by more than 1e-6 mm and the freedoms left in what moved (dofMoved: parameters minus the rank of the rule Jacobian, per rule-connected group) are above 0, refuse. Nothing is judged when the typed rows already obey every rule. The critic's two examples: ${rawLn('a5-uc-two-circles-equal-radius')} (SolidCraft radius 3, brep-rs radius 6, no sentence unguarded) and ${rawLn('a5-uc-grow-hole')}; both are refused now. Fully pinned sketches that the rules DO move still build (dofMoved 0): ${pinned.map((i) => `${i}: ${kindOf(R(i))}`).join(', ')}. Cost, measured: ${codeIds.length} cases carry this verdict; ${overIds.length} of them were PASS unguarded (SolidCraft and brep-rs agreed), e.g. ${overIds.slice(0, 5).join(', ')}: a rectangle with one corner moved onto the origin (fr-rectangle-handles) leaves width and height free, so it is refused although both engines happened to agree. The sentence tells the student to lock a point or dimension the free edges. This check needs the guard AND a solve: the independent one here, SolidCraft's own in the host (see the solved-rows row).`,
    [S('a5-uc-two-circles-equal-radius'), S('a5-uc-grow-hole')].join(' | '));
}

{
  chk('pull zero', [['hz-pull-0-rect', 'refused'], ['hz-pull-0-circle', 'refused']]);
  row("pull(sk, 0) (and pull(sk, NaN)): a zero or non-numeric pull distance, and the OCCT oracle hazard", 'refused',
    `${cmd('hazards')} Raw: ${rawLn('hz-pull-0-rect')} (engine wording, wrong cause for a student). Guarded: ${ln('hz-pull-0-rect')}. HARNESS HAZARD, measured: the OCCT oracle (replicad via packages/brep-adapter occt-build) does NOT RETURN on a zero-height pull, so these cases run with noOcct (sg-core measureCase) and any future runner that sends pull(sk, 0) to OCCT needs a child process with a time limit; brep-rs answers "${R('hz-pull-0-rect').brep.refused}". pull(sk, NaN) is refused by the language itself with "${S('hz-pull-nan')}" Negative control, a pull of -5 builds downward and matches: ${ln('hz-pull-neg-control')}.`,
    [S('hz-pull-0-rect'), S('hz-pull-nan')].join(' | '));
}

{
  const r = R('hz-bulge-roundtrip-volume').summary;
  if (R('hz-bulge-roundtrip-volume').outcome !== 'WRONG-SILENT') fail('bulge roundtrip is not WRONG-SILENT');
  row("edge bulges through save and reload: toScript(doc) then runScript(text) of a sketch that has SketchFeature.bulges", 'wrong',
    `${cmd('hazards')} + ${cmd('extra')} Doc: 20x20 square with bulges {0: 0.5}, pulled 10. toScript emits ${JSON.stringify(r.text)} (no arc, no warning: ${JSON.stringify(r.warnings)}); the reloaded doc has bulges ${JSON.stringify(r.bulgesAfter)}. Volume before ${n6(r.before.occt)} (OCCT) / ${n6(r.before.brep)} (brep-rs), after ${n6(r.after.occt)} / ${n6(r.after.brep)}: the reloaded part is ${e(Math.abs(r.volumeChange))} smaller, silently. This is in packages/script (reshape-script-gen.ts has no bulge branch; the language has no script call that writes a bulge), not in SolidCraft, and it is outside what this campaign may edit, but it makes the edge-bulge row a doc-level feature only: a bulged sketch does not survive a save as script. Every other sketch feature round-trips exactly (roundtrip-rect, -circle, -polygon-round-chamfer, -slot, -geom, -multi, -frame, -datum: ROUNDTRIP-EQUAL).`, undefined, { raw: true });
}

{
  const stad = R('a5-A-stadium'); const rr = R('far-rrect-at-0');
  row("face count of a curved prism against brep-rs and OCCT (stadium / rounded rectangle): why SolidCraft says 6 where brep-rs says 10", 'supported',
    `${cmd('attacks')} + ${cmd('far')} + ${cmd('outline')} Stadium (rect 20x10, all four corners rounded r=5, pulled 12): SolidCraft ${stad.truck.faces} faces, brep-rs ${stad.brep.faces}, OCCT builds nothing for this soup-free outline in this run (${String(stad.occt.refused).slice(0, 40)}); the independent prism count of the outline the build is handed (round-4 repairOutline drops the two zero-length sides; edges on the same line or the same circle are merged) is ${prismFaces(stad)} (2 flats + 2 half cylinders, each the merge of two quarter arcs on one circle, + 2 caps) and matches SolidCraft. Why they differ: brep-rs keeps each quarter arc as its own face (4 + 2 flats + 2 caps = ${stad.brep.faces}) while truck merges edge-connected faces of the same cylinder (the harness faceVerdict key 'truck-merges-edge-connected-same-surface-faces', checked against live OCCT surface classes). Rounded rectangle with two rounds: SolidCraft ${rr.truck.faces}, OCCT ${rr.occt.faces}, brep-rs ${rr.brep.faces} (equal). The explanation is measured, not assumed: over every built classic prism of the guarded run the independent outline count equals SolidCraft's face count in ${prismFaceStats().ok} of ${prismFaceStats().n}${prismFaceStats().bad.length ? ` (exceptions: ${prismFaceStats().bad.slice(0, 5).join('; ')})` : ''}. CONSEQUENCE for downstream picks: a face NAME or index that brep-rs assigned to one quarter arc does not exist in SolidCraft where the two quarters merged, so named-face picks on curved outlines must be resolved on SolidCraft's own topology (phase7 resolve-names.mjs does this; the picks-naming-params group measures it), never by face index carried over from brep-rs.`);
}
