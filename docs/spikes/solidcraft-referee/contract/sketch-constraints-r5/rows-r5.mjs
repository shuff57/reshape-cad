// Round-5 row sections (critic): rounded rectangle / tangent chains, under-constrained sketches, construction geometry, tangent to a built-in axis, huge and tiny values, crossing outlines,
// the planar bar over every planar case, off-circle arcs with no pinned centre, DoF readout, valid slider steps across a branch.
// Statuses are DERIVED from out/*.json by the ONE rule in rows-lib.mjs STATUS_RULE; every number in an evidence string is read from those files.
import { rows, J, ST, SW, ex, f, pct, sum, sweepsFor, sweepLine, unguardedWrongIn, caughtIn, wrongPassedIn, storedLine, storedFor, deriveStatus, mostCommonSentence } from './rows-lib.mjs';
const CMD = (s, extra = '') => `cmd: SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/sketch-constraints-r5/${s}${extra}`;
const sh = (s, n = 200) => String(s ?? '').slice(0, n);
const EX = J('extras.json'), JIT = J('jitter.json'), UC = J('underconstrained.json'), PB5 = J('planar-bar.json'), PD = J('param-drags.json'), AC = J('accuracy.json');
const ok = (x) => x !== null && x !== undefined;

// ============================ rounded rectangle, one rounded corner: chains of 3+ tangent joints ==============================================================
{
  const ids = ['rounded-rect-4-lines-4-arcs', 'rounded-rect-R3-60x30', 'rect-one-rounded-corner-R6'];
  const feat = 'rounded rectangle / chain of 3+ tangent joints';
  const stored = storedFor((r) => (r.feats ?? []).includes(feat));
  const sIds = ids.filter((i) => SW.some((s) => s.id === i));
  const jit = (JIT ?? []).filter((t) => t.id === 'rounded-rect-line-pinned');
  const fam = (PD?.rows ?? []).filter((r) => /^rounded rectangle/.test(r.id));
  const famSteps = fam.flatMap((r) => [...r.paths.flatMap((p) => p.steps), ...r.jumps]);
  const famWrong = famSteps.filter((s) => s.cls === 'WRONG').length, famRight = famSteps.filter((s) => s.cls === 'RIGHT').length, famRef = famSteps.filter((s) => s.cls.startsWith('REFUSED')).length;
  const jitWrong = jit.reduce((n, t) => n + (t.guarded['BUILT-WRONG'] ?? 0) + (t.guarded['BUILT-OTHER-SIDE'] ?? 0), 0);
  const d = deriveStatus({ stored, sweepIds: sIds });
  const status = d.status === 'supported' && (famWrong || jitWrong) ? 'wrong' : d.status;
  rows.push({ feature: 'rounded rectangle: 4 lines + 4 arcs with 8 endpoint-tangent joints (chain of 3+ tangent joints mixing lines and arcs), and a rectangle with one rounded corner', status,
    refusalSentence: status === 'refused' ? mostCommonSentence(sIds) : '',
    evidence: `${CMD('stored-run.mjs')} ; ${CMD('run-sweeps.mjs', ' --fracs=0.8,0.4,0.15,0.035')} ; ${CMD('param-drags.mjs')} ; ${CMD('jitter.mjs')} || stored geometry and one 3.5% start: ${stored.map(storedLine).join(' || ')} || sweeps (40 seeded starts per amplitude, shipped = mapper -> SolidCraft, rows as written): ${sIds.map(sweepLine).join(' || ')} || totals: the shipped route built ${unguardedWrongIn(sIds)} different solids silently, the guard refused ${caughtIn(sIds)} of them and built ${wrongPassedIn(sIds)} wrong || slider/param steps on the 4-line + 4-arc shape (corner radius 5 -> 1..9 with the sides fixed; sides 30 x 14 -> 50 x 30 and back): ${famRight} RIGHT against the closed form W*H - (4 - pi) r^2, ${famWrong} WRONG, ${famRef} refused || hand-drawn jitter, NO pinned arc centre (every free line and arc end moved by up to 0.05 / 0.3 / 0.8 mm, so ends are off their circles and joints are open), 20 starts per amplitude: ${jit.map((t) => `${t.amp} mm: shipped ${JSON.stringify(t.shipped)}, guarded ${JSON.stringify(t.guarded)}`).join('; ')} || ${d.why ? '[derived: ' + d.why + ']' : ''}` });
}

// ============================ off-circle arcs with NO pinned centre: slot, oval, rounded rectangle ============================================================
if (JIT) {
  const T = JIT;
  const wrongG = T.reduce((n, t) => n + (t.guarded['BUILT-WRONG'] ?? 0) + (t.guarded['BUILT-OTHER-SIDE'] ?? 0), 0);
  const shippedBad = T.reduce((n, t) => n + sum(t.shipped, ['POSE', 'VOLUME', 'MATCH-OTHER-SIDE']), 0);
  const N = T.reduce((n, t) => n + t.N, 0);
  const builtG = T.reduce((n, t) => n + (t.guarded['BUILT-MATCH'] ?? 0), 0), refG = T.reduce((n, t) => n + (t.guarded.REFUSED ?? 0), 0);
  const sents = new Map(); for (const t of T) for (const [k, n] of Object.entries(t.sentences ?? {})) sents.set(k, (sents.get(k) ?? 0) + n);
  const rawOf = new Map(); for (const t of T) for (const [k, v] of Object.entries(t.rawSentences ?? {})) if (!rawOf.has(k)) rawOf.set(k, v);
  const top = [...sents.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  rows.push({ feature: 'arcs drawn off their circle with open joints and no pinned arc centre: slot, oval and rounded rectangle, 0.05 / 0.3 / 0.8 mm of hand-drawn jitter', status: wrongG ? 'wrong' : N ? 'supported' : 'unsupported', refusalSentence: rawOf.get(top[0]?.[0]) ?? top[0]?.[0]?.replace(/^[a-z]+: /, '') ?? '',
    evidence: `${CMD('jitter.mjs')} || every unpinned line end and arc end moved by up to the amplitude (so arc ends are off their circles and the tangent/coincident joints open), ${N} starts over ${T.length} cells (3 fixtures x 3 amplitudes x ${T[0]?.N} starts) || SHIPPED route (mapper -> SolidCraft, no guard): ${shippedBad} of ${N} starts built a different solid silently (worst cell ${(() => { const w = [...T].sort((a, b) => sum(b.shipped, ['POSE', 'VOLUME']) - sum(a.shipped, ['POSE', 'VOLUME']))[0]; return w ? `${w.id} ${w.amp} mm ${JSON.stringify(w.shipped)}` : ''; })()}); e.g. ${(() => { const w = T.flatMap((t) => (t.shippedWrong ?? []).map((x) => `${t.id} ${t.amp} mm start ${x.k}: ${x.cls} volume ${f(x.volume, 2)} in ${x.bodies} body`)).slice(0, 3); return w.join('; '); })()} || GUARDED route: ${builtG} built right, ${refG} refused with a plain sentence, ${wrongG} built wrong || per cell: ${T.map((t) => `${t.id.replace('-pinned', '')} ${t.amp}: shipped ${JSON.stringify(t.shipped)} / guarded ${JSON.stringify(t.guarded)} / brep-rs ${JSON.stringify(t.brep)}`).join(' || ')} || guard sentences (numbers masked): ${top.map(([k, n]) => `${n}x "${k}"`).join(' / ')}` });
}

// ============================ under-constrained sketches (dof > 0) ============================================================================================
if (UC) {
  const U = UC;
  const buildable = U.filter((r) => r.closedVolume !== null);
  const dofAgree = U.filter((r) => r.dof.freecad !== null && r.dof.independent === r.dof.freecad);
  const dofBrepAgree = U.filter((r) => typeof r.dof.brepRs === 'number' && r.dof.independent === r.dof.brepRs);
  const storedRight = buildable.filter((r) => r.stored.guarded.right);
  const storedWrongG = buildable.filter((r) => r.stored.guarded.volume !== undefined && !r.stored.guarded.right);
  const roughG = U.flatMap((r) => [0.035, 0.15].map((fr) => ({ id: r.id, fr, ...r.rough[fr] })));
  const gWrong = roughG.reduce((n, x) => n + (x.guarded.tally['different-solid'] ?? 0), 0), gStored = roughG.reduce((n, x) => n + (x.guarded.tally['stored-solid'] ?? 0), 0), gRef = roughG.reduce((n, x) => n + (x.guarded.tally.REFUSED ?? 0), 0);
  const sDiff = roughG.reduce((n, x) => n + (x.shipped.tally['different-solid'] ?? 0), 0), sSame = roughG.reduce((n, x) => n + (x.shipped.tally['stored-solid'] ?? 0), 0);
  const bDiff = roughG.reduce((n, x) => n + (x.brep.tally['different-solid'] ?? 0), 0);
  const lineOf = (r) => `${r.id.replace('underconstrained:sk-rect-underconstrained__', '')}: dof independent ${r.dof.independent} / FreeCAD ref ${r.dof.freecad} / brep-rs ${r.dof.brepRs}; stored: shipped ${r.stored.shipped.volume !== undefined ? f(r.stored.shipped.volume, 3) + (r.stored.shipped.right ? ' right' : ' WRONG') : 'refused'}, guarded ${r.stored.guarded.volume !== undefined ? f(r.stored.guarded.volume, 3) + (r.stored.guarded.right ? ' right' : ' WRONG') : 'REFUSED (' + sh(r.stored.guarded.refused, 90) + ')'}, brep-rs ${r.stored.brep?.volume !== undefined ? f(r.stored.brep.volume, 3) : 'refuses'}; closed form ${r.closedVolume !== null ? f(r.closedVolume, 3) : 'none (no closed outline)'}`;
  const statusStored = storedRight.length === buildable.length && !storedWrongG.length ? 'supported' : storedWrongG.length ? 'wrong' : 'refused';
  rows.push({ feature: 'under-constrained sketches (dof > 0), stored geometry: the 8 saved FreeCAD sk-rect-underconstrained refs (hv-only, width-only, width-and-height, pinned-corner-only, free-line, free-circle, triangle-joined, circle-radius-only)', status: statusStored, refusalSentence: U.find((r) => r.closedVolume === null)?.stored.guarded.refused ?? '',
    evidence: `${CMD('underconstrained.mjs')} || the stored geometry obeys every rule, so the right solid is the stored one (closed form: 30x15, 2,3 -> 32,18, triangle 300, disc 16 pi; FreeCAD bbox agrees); ${storedRight.length} of ${buildable.length} buildable fixtures build it through the guarded route, ${storedWrongG.length} wrong; the free line has no closed outline and is refused || DoF: the independent solver (Jacobian rank, solve5.mjs) equals the saved FreeCAD dof on ${dofAgree.length} of ${U.length} and brep-rs diagnose() on ${dofBrepAgree.length} of ${U.length} || ${U.map(lineOf).join(' || ')}` });
  rows.push({ feature: 'under-constrained sketches from a rough start: shipped route builds a start-dependent solid with no sentence', status: sDiff ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `${CMD('underconstrained.mjs')} || ${roughG.length} cells (8 fixtures x 3.5% and 15%) x ${U[0]?.rough?.['0.035']?.N} seeded starts: the shipped route (mapper -> SolidCraft) built the stored solid ${sSame} times and a DIFFERENT solid ${sDiff} times, status solved each time, no refusal; distinct volumes it built per cell: ${roughG.filter((x) => x.shipped.volumes && x.shipped.volumes.distinct > 1).map((x) => `${x.id.replace('underconstrained:sk-rect-underconstrained__', '')} ${x.fr}: ${x.shipped.volumes.values.join(' / ')}`).join('; ')} || live brep-rs on the same starts built a different solid ${bDiff} times (its own start-dependent values: ${roughG.filter((x) => x.brep.volumes && x.brep.volumes.distinct > 1).slice(0, 4).map((x) => `${x.id.replace('underconstrained:sk-rect-underconstrained__', '')} ${x.fr}: ${x.brep.volumes.values.join(' / ')}`).join('; ')}), so there is no oracle answer to a rough drawing of an under-constrained sketch` });
  rows.push({ feature: 'under-constrained sketches from a rough start: guarded route (rules move the drawn lines and some freedom is left, so the solver would choose)', status: gWrong ? 'wrong' : 'refused', refusalSentence: (() => { const s = roughG.flatMap((x) => Object.values(x.guarded.sentences ?? {})).sort((a, b) => b.n - a.n)[0]; return s?.sentence ?? ''; })(),
    evidence: `${CMD('underconstrained.mjs')} || same ${roughG.length * (U[0]?.rough?.['0.035']?.N ?? 0)} starts through the guard: ${gStored} built the stored solid (the drawn lines already obeyed the rules, nothing for the solver to choose), ${gRef} refused with one sentence, ${gWrong} built a different solid || per cell: ${roughG.map((x) => `${x.id.replace('underconstrained:sk-rect-underconstrained__', '')} ${x.fr}: ${JSON.stringify(x.guarded.tally)}`).join('; ')} || stages: ${[...new Set(roughG.flatMap((x) => Object.keys(x.guarded.sentences ?? {})))].join(', ')}` });
}

// ============================ construction geometry ===========================================================================================================
if (EX) {
  const C = EX.construction;
  const arcOut = C[0], arcIn = C[1], circ = C[2], line = C[3];
  const shippedWrong = C.filter((c) => c.shipped.verdict === 'WRONG');
  rows.push({ feature: 'construction:true on an arc (and circle, line): shipped mapper passes the flag to sketch.arc.three_point, which ignores it, so a construction arc becomes a profile edge', status: shippedWrong.length ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `${CMD('extras.mjs')} || triangle 30 x 20 (volume 3000) plus a construction arc/circle/line, each with the shipped mapper + SolidCraft, every profile extruded: ${C.map((c) => `${c.id.replace(/\(.*\)/, '').trim()}: ${c.shipped.out} volume ${f(c.shipped.volume, 3)} bodies ${c.shipped.bodies} -> ${c.shipped.verdict}`).join(' || ')} || the arc below the base adds a lens (${f(arcOut.shipped.volume - 3000, 3)} mm3 too much). Only the circle/line paths honour the flag; sketch.construction applied afterwards does too (guard.mjs markConstructionArcs).` });
  const g = C.map((c) => c.guarded.verdict);
  rows.push({ feature: 'construction geometry through the guarded route (arc marked construction afterwards with sketch.construction, even-odd profile picks)', status: g.every((v) => v === 'RIGHT') ? 'supported' : g.some((v) => v === 'WRONG') ? 'wrong' : 'refused', refusalSentence: '',
    evidence: `${CMD('extras.mjs')} || ${C.map((c) => `${c.id.replace(/\(.*\)/, '').trim()}: guarded ${c.guarded.out} ${f(c.guarded.volume, 3)} -> ${c.guarded.verdict}; control without marking ${c.controlGuardWithoutMarkingConstruction.out} ${c.controlGuardWithoutMarkingConstruction.volume !== undefined ? f(c.controlGuardWithoutMarkingConstruction.volume, 3) : ''} -> ${c.controlGuardWithoutMarkingConstruction.verdict}; always picking a single profile: with marking ${c.guardedAlwaysPickProfiles.verdict}, without marking ${c.controlAlwaysPickWithoutMarking.verdict}${c.controlAlwaysPickWithoutMarking.sentence ? ' (' + sh(c.controlAlwaysPickWithoutMarking.sentence, 100) + ')' : ''}`).join(' || ')} || the post-build comparison with the independent expected solid is what turns the controls into refusals instead of wrong builds` });
}

// ============================ tangent to a built-in axis ======================================================================================================
if (EX) {
  const A = EX.axisTangent;
  const off = A.filter((a) => a.offFromAxisMm > 0);
  const wrongS = off.filter((a) => a.shipped.verdict === 'WRONG');
  rows.push({ feature: 'tangent to a built-in axis (-2 / -3): the shipped mapper drops the row without a word and the circle stays where it was drawn', status: wrongS.length ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `${CMD('extras.mjs')} || mapper output for the tangent row: ruleMap ${JSON.stringify(EX.axisTangentMapper.ruleMapOfTangentRow)} (no command), commands ${JSON.stringify(EX.axisTangentMapper.commands)}, notes ${JSON.stringify(EX.axisTangentMapper.notes)}, refusals ${JSON.stringify(EX.axisTangentMapper.refusals ?? null)} || circle r6 held 8 from the origin along the axis, drawn ${off.map((a) => a.offFromAxisMm).filter((v, i, xs) => xs.indexOf(v) === i).join(' / ')} mm off the axis: the shipped route built ${wrongS.length} of ${off.length} off-axis drawings with the circle left off the axis by the drawn gap (e.g. ${wrongS.slice(0, 3).map((a) => `axis ${a.axis}, drawn ${a.offFromAxisMm}: bbox ${a.shipped.bbox.map((v) => +v.toFixed(3)).join(',')} against ${a.wantBbox.join(',')}`).join('; ')}), no refusal; brep-rs and OCCT cannot referee a built-in axis, the closed form can` });
  rows.push({ feature: 'tangent to a built-in axis (-2 / -3) through the guarded route', status: A.every((a) => a.guarded.out === 'REFUSED') ? 'refused' : A.some((a) => a.guarded.out === 'BUILT' && a.shipped.verdict === 'WRONG') ? 'wrong' : 'supported', refusalSentence: A[0]?.guarded.sentence ?? '',
    evidence: `${CMD('extras.mjs')} || ${A.filter((a) => a.guarded.out === 'REFUSED').length} of ${A.length} drawings refused in the preflight, ${A.filter((a) => a.guarded.out === 'BUILT').length} built || the supported way is the construction-line form (a line along the axis with both ends pinned and the curve tangent to that line): see the tangent:line-circle row, matched to the closed form` });
}

// ============================ huge and tiny dimension values ==================================================================================================
if (EX) {
  const Hh = EX.huge;
  const lens = Hh.filter((h) => h.V !== undefined);
  const wrongShipped = Hh.filter((h) => h.shipped.verdict === 'WRONG');
  rows.push({ feature: 'huge dimension values: the shipped route silently ignores a 1e9 length (volume 5680 for a 2e11 request), a 1e9 radius and a 1e9 offset', status: wrongShipped.length ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `${CMD('extras.mjs')} || 30 x 20 rectangle, length of line 1 = V: ${lens.map((h) => `V=${h.V}: shipped ${h.shipped.out} ${h.shipped.volume !== undefined ? h.shipped.volume.toExponential(3) : ''} vs wanted ${h.wantVolume.toExponential(3)} -> ${h.shipped.verdict}${h.shipped.faces !== undefined ? ' (faces ' + h.shipped.faces + ')' : ''}`).join('; ')} || other: ${Hh.filter((h) => h.name).map((h) => `${h.name}: shipped ${h.shipped.volume !== undefined ? h.shipped.volume.toExponential(3) : h.shipped.out} vs ${h.wantVolume.toExponential(3)} -> ${h.shipped.verdict}`).join('; ')}` });
  const gRight = Hh.filter((h) => h.guarded.verdict === 'RIGHT'), gRef = Hh.filter((h) => h.guarded.out === 'REFUSED'), gWrong = Hh.filter((h) => h.guarded.verdict === 'WRONG');
  const vals = (xs) => xs.map((h) => h.V ?? h.name).join(', ');
  rows.push({ feature: 'huge and tiny dimension values through the guarded route (rectangle length 1e-6 .. 1e10, circle radius 1e6 / 1e9, offset 1e9)', status: gWrong.length ? 'wrong' : 'supported', refusalSentence: gRef.find((h) => h.guarded.sentence)?.guarded.sentence ?? '',
    evidence: `${CMD('extras.mjs')} || guarded route: ${gRight.length} built right (${vals(gRight)}), ${gRef.length} refused (${vals(gRef)}), ${gWrong.length} built wrong${gWrong.length ? ' (' + vals(gWrong) + ')' : ''} || sentences: ${[...new Set(gRef.map((h) => h.guarded.sentence).filter(Boolean))].map((s) => `"${sh(s, 220)}"`).join(' / ')} || a build is accepted only if its volume (true relative error), bbox, centre of mass, body count and, for straight-line outlines, face count equal the independent expectation: the 1e8 case, whose shipped build has the right volume but ${(() => { const h = lens.find((x) => x.V === 1e8); return h ? 'faces ' + h.shipped.faces : ''; })()} faces, is refused by the face count || brep-rs refuses every length above 1e6 ("it has a size or ...") and below 0.01 ("edge 1 and edge 2 nearly touch")` });
}

// ============================ crossing / touching / self-crossing outlines ====================================================================================
if (EX) {
  const X = EX.crossing.filter((c) => !c.valid), ctl = EX.crossing.find((c) => c.valid);
  const builtS = X.filter((c) => c.shipped.out === 'BUILT');
  rows.push({ feature: 'outlines that cross, touch or cross themselves: the shipped route builds them silently (circle across a rectangle edge, two rectangles sharing an edge or overlapping, a self-crossing bowtie)', status: builtS.length ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `${CMD('extras.mjs')} || ${X.map((c) => `${c.id}: shipped BUILT volume ${f(c.shipped.volume, 3)} in ${c.shipped.bodies} body; brep-rs ${c.brep?.volume !== undefined ? 'builds ' + f(c.brep.volume, 3) : 'refuses (' + sh(c.brep?.refused ?? JSON.stringify(c.brep), 110) + ')'}`).join(' || ')}` });
  const refd = X.filter((c) => c.guarded.out === 'REFUSED');
  rows.push({ feature: 'outlines that cross, touch or cross themselves through the guarded route', status: refd.length === X.length && ctl?.guarded.out === 'BUILT' ? 'refused' : X.some((c) => c.guarded.out === 'BUILT') ? 'wrong' : 'refused', refusalSentence: refd[0]?.guarded.sentence ?? '',
    evidence: `${CMD('extras.mjs')} || ${refd.length} of ${X.length} refused: ${X.map((c) => `${c.id}: ${c.guarded.out === 'REFUSED' ? '[' + c.guarded.stage + '] ' + sh(c.guarded.sentence, 200) : 'BUILT ' + f(c.guarded.volume, 3)}`).join(' || ')} || control, two rectangles 5 mm apart (valid, two bodies): guarded ${ctl?.guarded.out} volume ${f(ctl?.guarded.volume, 3)} bodies ${ctl?.guarded.bodies} vs closed form ${f(ctl?.wantVolume, 3)}; brep-rs ${ctl?.brep?.volume !== undefined ? f(ctl.brep.volume, 3) : 'n/a'}` });
}

// ============================ planar bar ======================================================================================================================
if (PB5) {
  const cs = PB5.cases;
  const sOver = cs.filter((c) => c.shipped.over.length), gOver = cs.filter((c) => c.guarded.over.length);
  const sw = Math.max(0, ...cs.map((c) => c.shipped.worst)), gw = Math.max(0, ...cs.map((c) => c.guarded.worst));
  const gBuilt = cs.reduce((n, c) => n + c.guarded.built, 0), gN = cs.reduce((n, c) => n + c.guarded.n, 0), gRef = cs.reduce((n, c) => n + c.guarded.refused, 0);
  const fm = cs.reduce((n, c) => n + c.faceMismatch, 0);
  const lshape = cs.filter((c) => /l-shape/.test(c.id));
  rows.push({ feature: 'planar 1e-9 bar over EVERY planar soup case including the phase2 L-shape (own-l-shape-dims, 1.1e-9 in phase2) and a 6-edge L-shape written with perpendicular rows: shipped route', status: sOver.length ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `${CMD('planar-bar.mjs')} || ${cs.length} planar cases x (stored + 20 starts at 3.5% + 20 at 15%): shipped route (mapper -> SolidCraft, rows as written) worst volume/bbox delta ${ex(sw)}; ${sOver.length} cases exceed 1e-9: ${sOver.map((c) => `${c.id} ${c.shipped.over.length} starts, worst ${ex(c.shipped.worst)}`).join('; ')} || cause: ${PB5.solverTol ?? 'solver.rs TOL'} - SolidCraft's constraint solver stops when max |residual| < 1e-9, so a coordinate it was asked to move can be left up to ~1e-9 mm short; a polygon of six or more lines with chained dimensions shows it (L-shapes: ${lshape.map((c) => `${c.id} ${ex(c.shipped.worst)}`).join(', ')})` });
  rows.push({ feature: 'planar 1e-9 bar over every planar soup case: guarded route (SolidCraft starts from the independent solution, so there is nothing left for its solver to move)', status: gOver.length || fm ? 'wrong' : 'supported', refusalSentence: '',
    evidence: `${CMD('planar-bar.mjs')} || same ${gN} runs through the guard: ${gBuilt} built and matched the closed form with worst volume/bbox delta ${ex(gw)} (bar 1e-9), ${gRef} refused, ${gOver.length} cases exceed 1e-9${gOver.length ? ': ' + gOver.map((c) => `${c.id} ${ex(c.guarded.worst)}`).join('; ') : ''}; face-count mismatches against the independent expectation (straight-line outlines: boundary edges + 2 per body): ${fm} || ${lshape.map((c) => `${c.id}: guarded built ${c.guarded.built}/${c.guarded.n}, worst ${ex(c.guarded.worst)}; shipped worst ${ex(c.shipped.worst)}`).join(' || ')}` });
}

// ============================ DoF / SolveReport readout ========================================================================================================
if (AC) {
  const dof = AC.dof ?? [];
  const fcRows = dof.filter((d) => d.freecad), bad = fcRows.filter((d) => d.indep.dof !== d.freecad.dof);
  const brRows = dof.filter((d) => typeof d.brep?.dof === 'number'), badB = brRows.filter((d) => d.indep.dof !== d.brep.dof);
  rows.push({ feature: 'SolidCraft SolveReport / dof / redundant readout through the supplied referee pkg', status: 'unsupported', refusalSentence: '',
    evidence: `${CMD('accuracy.mjs')} || the supplied pkg (wrapper/, wasm-bindgen --target nodejs) returns only the final measure or the first failed command; the SolveReport and the solved points are read by the phase2/wrapper2 pseudo-command @sketch, which needs a wasm rebuild that this run may not do. Nothing in this contract reads SolidCraft's report; the contract's DoF comes from the independent solver (next row). Round 3's rows that cited SolidCraft's report (dof > 0 and redundant rows on every tangent-joint sketch) are carried as an unmeasured claim, not as evidence.` });
  rows.push({ feature: 'DoF readout (independent solver, Jacobian rank) against the saved FreeCAD refs and brep-rs diagnose()', status: bad.length || badB.length ? 'wrong' : dof.length ? 'supported' : 'unsupported', refusalSentence: '',
    evidence: `${CMD('accuracy.mjs')} || ${fcRows.length} fixtures with a FreeCAD ref: independent dof equals the ref's dof on ${fcRows.length - bad.length}${bad.length ? ' (differs: ' + bad.map((d) => `${d.id} ${d.indep.dof} vs ${d.freecad.dof}`).join('; ') + ')' : ''}; ${brRows.length} fixtures brep-rs can diagnose: equal on ${brRows.length - badB.length}${badB.length ? ' (differs: ' + badB.map((d) => `${d.id} ${d.indep.dof} vs ${d.brep.dof}`).join('; ') + ')' : ''} || ${dof.map((d) => `${d.id.replace('gauntlet:sk-', '')}: independent ${d.indep.dof}, brep-rs ${d.brep?.dof ?? d.brep?.open ?? 'n/a'}, FreeCAD ${d.freecad?.dof ?? 'n/a'}`).join('; ')}` });
}

// ============================ valid slider steps across a branch ==============================================================================================
if (PD) {
  const ang = PD.rows.find((r) => /^triangle angle/.test(r.id)), dx = PD.rows.find((r) => /^rect corner distanceX/.test(r.id));
  const at = (fam, path, pred) => fam.paths[path].steps.filter(pred);
  const acr = ang ? ang.paths[0].steps.filter((s) => s.v < 90 && s.cls === 'RIGHT') : [];
  const dxz = dx ? dx.paths[0].steps.filter((s) => s.v < 0 && s.cls === 'RIGHT') : [];
  rows.push({ feature: 'param() slider step ACROSS a branch is accepted: triangle angle dragged 120 -> 20 in 5 degree steps (through 90), rect corner distanceX dragged +12 -> -12 in steps of 2 (through 0)', status: !ang || !dx ? 'unsupported' : [...ang.paths.flatMap((p) => p.steps), ...dx.paths.flatMap((p) => p.steps)].some((s) => s.cls === 'WRONG') ? 'wrong' : acr.length && dxz.length ? 'supported' : 'unsupported', refusalSentence: '',
    evidence: `${CMD('param-drags.mjs')} || angle drag 120 -> 10 (steps of 5, each from the last built geometry): ${ang?.paths[0].steps.map((s) => `${s.v}:${s.cls}`).join(' ')} || the steps below 90 degrees cross the old quadrant and are all built exactly (${acr.length} values: ${acr.map((s) => s.v).join(', ')}); the branch check compares the solved angle with the nearest of its two solutions (v and v - 180), so a dimension that passes 90 is a slider move, not a branch change || signed distanceX drag +12 -> -12 (steps of 2): ${dx?.paths[0].steps.map((s) => `${s.v}:${s.cls}`).join(' ')} || ${dxz.length} values on the negative side built exactly. The independent solution is handed to SolidCraft as its start, so the side requests of the mapper (signed offset, tangent side, angle orientation) agree with the geometry by construction. The remaining refusals of valid targets (hole moved wholly outside the plate, circle inside to outside, a triangle folded at 10 or 175 degrees) are listed in the param-drag capability-gap rows.` });
}
