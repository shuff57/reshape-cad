// (round 6 / fix round 1: this file supersedes make-rows-r3.mjs; it also reproduces the hand-added compose row and the RE-VERIFIED paragraph, adds the cone-chain evidence and asserts 29 rows.)
// Rebuilds ../move-turn.json (round 3) from the saved round-2 rows (../move-turn.round2.json) and the round-3 result files in this folder.
// Every status below is ASSERTED against the data it cites; the script throws when a claim and its data disagree.
//   bun make-rows-r3.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const rd = (f) => JSON.parse(readFileSync(path.join(HERE, f), 'utf8'));
const base = JSON.parse(readFileSync(path.join(HERE, '..', 'move-turn.round2.json'), 'utf8'));
const e = (v) => (typeof v === 'number' ? v.toExponential(1) : String(v));
const need = (cond, msg) => { if (!cond) throw new Error('ASSERT: ' + msg); };
const CMD = (script, extra = '') => `cd docs/spikes/solidcraft-referee/contract/move-turn-harness && ${extra}SOLIDCRAFT_REFEREE_PKG=<pkg built per contract/RIG.md> systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 bun ${script}`;
const byFeature = (needle) => { const i = base.rows.findIndex((r) => r.feature.startsWith(needle)); need(i >= 0, 'base row ' + needle); return i; };

// ---------------------------------------------------------------- data
const L = rd('r3-lumps-results.json'); const LC = rd('r3-lumps-control-results.json'); const LS = rd('r3-lumps-shipped-results.json');
const seam = rd('r3-seam-results.json');
const CH = rd('r3-cuthead-results.json'); const CHC = rd('r3-cuthead-control-results.json');
const PA = rd('r3-param-results.json');
const SK = rd('r3-sketchturn-results.json');
const MG = rd('r3-magnitude-results.json');
const SL = rd('r3-slow-120000.json'); const SL3 = rd('r3-slow-300000.json');
const DP = rd('r3-deps-results.json');
const PR = rd('r3-prismrot-results.json');
need(PR.length === 8 && PR.every((r) => r.step.v === 'PASS' && r.own.v === 'PASS' && r.occtStepVsOwn.dBbox < 1e-9 && r.occtStepVsOwn.dVol < 1e-12), 'prism/wedge both documents pass');
const S15 = rd('r3-slow-120000-s15.json').rows[0];
need(S15.case.startsWith('s15') && S15.verdict === 'REFUSED' && /took longer than 120 seconds/.test(S15.refusal), 's15 ring tube hole times out');
const ringtime = readFileSync(path.join(HERE, 'r3-ringtime.out'), 'utf8').trim();
const caseOf = (arr, name) => { const r = arr.find((x) => (x.name ?? x.case) === name); need(r, 'case ' + name); return r; };
const lastPer = (c) => c.per[c.per.length - 1];

// ---------------------------------------------------------------- multi-piece (lumps)
const lumpWrongGuard = L.filter((c) => c.worst === 'WRONG').length;
const lumpWrongCtl = LC.filter((c) => c.worst === 'WRONG').length;
const lumpWrongShip = LS.filter((c) => c.worst === 'WRONG').length;
need(lumpWrongGuard === 0, 'guard translator has a wrong lump scenario');
need(lumpWrongCtl >= 15, 'negative control must reproduce the dropped piece');
need(lumpWrongShip >= 5, 'shipped translator must reproduce wrong lump scenarios');
const splitScenes = L.filter((c) => c.per.some((p) => (p.bodies?.length ?? 1) > 1));
need(splitScenes.length >= 15, 'enough multi-piece scenes');
const rep1 = caseOf(L, 'cut/copy-at-origin'); const rep1c = caseOf(LC, 'cut/copy-at-origin');
const rep2 = caseOf(L, 'cut/x07 copy moved +20'); const rep2c = caseOf(LC, 'cut/x07 copy moved +20');
const rep3 = caseOf(L, 'cut/turned tool 90'); const rep3c = caseOf(LC, 'cut/turned tool 90');
for (const [a, b] of [[rep1, rep1c], [rep2, rep2c], [rep3, rep3c]]) { need(lastPer(a).v.startsWith('PASS'), a.name + ' fixed'); need(lastPer(b).dVol > 0.4, b.name + ' control wrong'); }
const piece = (c, cc) => { const p = lastPer(c); const q = lastPer(cc); return `OCCT ${p.occtVolume.toFixed(1)}, brep-rs ${p.brepDVol !== undefined ? 'agrees (dVol ' + e(p.brepDVol) + ')' : 'n/a'}, SC with the fix ${p.scVolume.toFixed(1)} (dVol ${e(p.dVol)}, dCom ${e(p.dCom)}, ${p.faces}/${p.occtFaces} faces, ${p.bodies.length} pieces), SC dropping the extra piece ${q.scVolume.toFixed(1)} (dVol ${e(q.dVol)}, dCom ${e(q.dCom)})`; };
const refusedDown = L.filter((c) => c.per.some((p) => p.refused && /separate pieces/.test(p.refused)));
need(refusedDown.length >= 4, 'one-body refusals present');
const sentSplit = refusedDown.map((c) => c.per.find((p) => p.refused)).map((p) => p.refused);
const seamRows = seam.filter((r) => r.rz === 0 || r.rz === 180); const seamOk = seam.filter((r) => [45, 90, 135].includes(r.rz));
need(seamRows.every((r) => r.scCylFaces === 4 && r.occtCylFaces === 3) && seamOk.every((r) => r.scCylFaces === r.occtCylFaces), 'seam explanation holds');

const LUMP_EVID = `ROUND 3, MULTI-PIECE RESULTS (the dropped-second-body hazard). When a cut/intersect/hole/pocket/groove leaves SEVERAL separate pieces solidcraft names the extra pieces "<body> (1)", "<body> (2)"; the round-2 translator summed only the named body and so lost the rest with no sentence. REPRODUCED then FIXED. Command: ${CMD('r3-lumps.mjs')} ; MT_NOEXTRA=1 ... bun r3-lumps.mjs (negative control = round-2 behaviour) ; MT_SHIPPED=1 ... bun r3-lumps.mjs (unpatched phase0 translator). Scripts r3-lumps.mjs, translate-guard.mjs (finish(): new body names not in the live list, after removing the consumed tools, join the feature handle). ${L.length} scenes, every top-level shape compared with live OCCT and brep-rs. Fixed translator: ${lumpWrongGuard} wrong scenes (${L.filter((c) => c.worst === 'ALL-PASS').length} all-pass, ${L.filter((c) => c.worst === 'REFUSED-some').length} with a refused one-body follow-up, see the multi-piece refusal row); same code with the fix switched off (MT_NOEXTRA=1): ${lumpWrongCtl} wrong scenes; unpatched phase0 translator: ${lumpWrongShip} wrong scenes (it refuses every copy outright, and silently drops pieces even without a copy: ${LS.filter((c) => c.worst === 'WRONG').map((c) => c.name).join('; ')}). Critic repros: (1) box(60,20,10) minus a copy-at-origin of box(10,40,20): ${piece(rep1, rep1c)}. (2) the x07 scene (tool at -20, copy moved +20): ${piece(rep2, rep2c)}. (3) box(60,20,10) minus the same box turned 90 degrees (nothing copied): ${piece(rep3, rep3c)}. The same drop happens with no copy and no move (a tool moved or turned in place, a pocket that cuts through): the cause is the translator, not the copy.`;

// ---------------------------------------------------------------- cut then move fork
const chRef = CH.filter((c) => c.per.some((p) => p.refused && /had already cut into/.test(p.refused)));
const chCtlWrong = CHC.filter((c) => c.per.some((p) => p.top && p.v === 'FAIL'));
need(chRef.length >= 6 && chCtlWrong.length >= 5, 'cut-head fork rows');
need(CH.filter((c) => /control|result\)|own rotate/.test(c.name)).every((c) => c.per.filter((p) => p.top).every((p) => p.v === 'PASS')), 'cut-head controls pass');
const chS = (n) => caseOf(CH, n).per.find((p) => p.refused)?.refused;
const chC = (n) => { const p = caseOf(CHC, n).per.find((q) => q.top && q.v === 'FAIL'); return p ? `${p.id}: OCCT vol ${p.occtVolume.toFixed(1)}, SC moved the cut body, dVol ${e(p.dVol)}, dCom ${e(p.dCom)}` : 'n/a'; };

// ---------------------------------------------------------------- params
const pr = (n) => PA.find((r) => r.name === n); need(pr('turn(ring, 3 params)').dead.length === 3 && pr('turn(sphere, 3 params)').dead.length === 3, 'dead sliders ring+sphere');
for (const n of ['turn(box, 3 params)', 'turn(cylinder, 3 params)', 'turn(cone, 3 params)', 'turn(prism, 3 params)', 'turn(wedge, 3 params)', 'turn(hole box, 3 params)', 'turn(join, 3 params)', 'move(box, 3 params)', 'move copy(ring, 3 params)', 'move(sphere, param)']) need(pr(n).dead.length === 0, 'live sliders ' + n);
const deadRing = pr('turn(ring, 3 params)').dead[0]; const deadBall = pr('turn(sphere, 3 params)').dead[0];

// ---------------------------------------------------------------- sketch/plane turn
const sk = (n) => SK.find((r) => r.case === n); need(sk('turn(sketch)').page.includes('a sketch is flat') && sk('turn(plane)').page.includes('flat reference'), 'sketch sentences');
need(sk('turn(number)').page === sk('turn(number)').interpreter && sk('turn(pulled sketch) control').interpreter === null, 'controls of the sketch mapper');

// ---------------------------------------------------------------- magnitude
const mgRefused = MG.rows.filter((r) => r.F > 3000); const mgOk = MG.rows.filter((r) => r.F <= 3000);
need(mgRefused.every((r) => r.guard === 'REFUSED' && /3000 mm|was refused/.test(r.guardRefusal)), "beyond 3000 refused with sentence");
need(mgOk.filter((r) => r.guard === 'PASS').length >= 9, 'within 3000 passes');
const mgShippedWrong = MG.rows.filter((r) => r.shipped === 'FAIL');
need(mgShippedWrong.length >= 5, 'shipped wrong beyond range present');
const mgEdge = MG.rows.filter((r) => r.F === 3000 && r.guard !== 'PASS');

// ---------------------------------------------------------------- slow
const sl = (id) => SL.rows.find((r) => r.case.startsWith(id)); const sl3 = (id) => SL3.rows.find((r) => r.case.startsWith(id));
for (const id of ['s06', 's07', 's08', 's09']) need(sl(id).verdict === 'REFUSED' && /took longer than 120 seconds/.test(sl(id).refusal), id + ' timed out at 120 s');
for (const id of ['s01', 's02', 's03', 's04', 's05', 's10', 's12', 's13', 's14']) need(sl(id).verdict === 'PASS', id + ' passes');
need(sl('s11').verdict === 'REFUSED' && /could not be built by this engine/.test(sl('s11').refusal), 's11 engine refusal');
need(sl3('s07').verdict === 'PASS' && sl3('s07').scCpuSec > 120, 's07 completes at 300 s but beyond 120 s');
const cpu = (r) => r.scCpuSec.toFixed(0);
const slowLine = (r) => `${r.case}: ${r.verdict}${r.refusal ? ' "' + r.refusal + '"' : ` dVol ${e(r.dVol)} dCom ${e(r.dCom)} faces ${r.faces}/${r.occtFaces}`}, last solidcraft call ${r.slowestCallSec.toFixed(1)} s wall${r.timedOutCalls ? ' (killed at the limit)' : ` / ${cpu(r)} s CPU over ${r.scCalls} replayed calls`}`;

// ---------------------------------------------------------------- deps
const dp = (n, id) => DP.find((r) => r.case === n).features.find((f) => f.id === id).guard;
need(dp('ring, hole (engine refuses), then turn', 'hole1').refusal === 'Hole 1 could not be built by this engine, so it is shown without it.', 'ring hole sentence');
need(dp('ring, hole (engine refuses), then turn', 'turn1').refusal === 'Turn 1 is not built because Hole 1, which it uses, was refused.', 'turn dependent');
need(dp('hollow(no open), turn, then join with box', 'op1').refusal === 'Join 1 is not built because Turn 1, which it uses, was refused.', 'join dependent');
const noJargon = DP.every((r) => r.features.every((f) => !f.guard?.refusal || !/solid\.|solidcraft|command|phase 0/i.test(f.guard.refusal)));
need(noJargon, 'dependent sentences carry no engine words');
const shippedJargon = DP.flatMap((r) => r.features).filter((f) => f.shipped?.refusal && /solid\./.test(f.shipped.refusal)).length;

// ================================================================ rows
const rows = [];
const SHIP = (ids) => ` SHIP CONDITION (round 3): this row is a silent wrong solid in the shipped translator; the group is NOT safe to ship until the pick guard (row "pick after move/turn") is in the page's translator. Re-measured on the critic's three repros: ${ids}`;
// re-measured wrongs (r3-pickrepro, optional file)
let pickrepro = ''; if (existsSync(path.join(HERE, 'r3-pickrepro.json'))) {
  const P = rd('r3-pickrepro.json');
  for (const r of P) need(r.shipped.v === 'FAIL' && r.guard.v === 'REFUSED', 'pickrepro ' + r.name);
  pickrepro = P.map((r) => `${r.name}: shipped dCom ${e(r.shipped.dCom)} dVol ${e(r.shipped.dVol)} (wrong), guard REFUSED "${r.guard.refusal}"`).join(' | ');
}
const pushBase = (needle, patch) => { const r = structuredClone(base.rows[byFeature(needle)]); Object.assign(r, patch(r)); rows.push(r); return r; };
const shipTail = (r) => r.evidence + (pickrepro ? SHIP(pickrepro) : '');
// 1-4 wrong (as shipped)
pushBase('move(shape,[x,y,z]) then round/bevel', (r) => ({ evidence: shipTail(r) }));
pushBase('move(shape,[x,y,z]) then hollow', (r) => ({ evidence: shipTail(r) }));
pushBase('turn(derived shape) then round/bevel', (r) => ({ evidence: shipTail(r) }));
pushBase('turn(derived shape) then hollow', (r) => ({ evidence: shipTail(r) }));
pushBase('pick after move/turn', (r) => ({ evidence: r.evidence + (pickrepro ? ` ROUND 3: the guard is what makes rows 1-4 safe; it ships with the page or the group does not. Critic repros re-run: ${pickrepro}` : '') }));
// 6 move
pushBase('move(shape,[x,y,z]): MoveFeature', (r) => ({
  feature: 'move(shape,[x,y,z]): MoveFeature offset[3], copy=false (consumes the target handle), when no pick-bearing feature follows on the moved shape and the part stays within 3000 mm of the origin',
  evidence: r.evidence.replace(/coordinates beyond 3000 mm lose measurement precision \(magnitude row\)/, 'a part farther than 3000 mm from the origin is now REFUSED with a sentence (magnitude row); a move of a shape that pocket()/groove() already cut is refused (cut-then-move row); a split result moves as one (multi-piece rows)'),
}));
// 7 copy
pushBase('move(shape,[x,y,z],{copy:true})', (r) => ({
  feature: 'move(shape,[x,y,z],{copy:true}): MoveFeature copy=true (new body, original kept), including a copy used as a cutter that splits the target into pieces',
  evidence: r.evidence.replace('cut by a copied tool;', `cut by a copied tool (also when the cut splits the target: see below);`) + ' ' + LUMP_EVID,
}));
pushBase('move copy followed by repeat', (r) => ({ evidence: r.evidence }));
// 9..13
pushBase('turn(shape,[rx,ry,rz]) on a primitive', (r) => ({ feature: 'turn(shape,[rx,ry,rz]) on a primitive: box, cylinder, cone, torus (sets the primitive own rotate[3], rotated about the origin then translated to center)', evidence: r.evidence + ` ROUND 3 NOTE: a torus costs 15-18 s of solidcraft CPU to build on its own (r3-ringtime.out: ${ringtime.split('\n').slice(0, 3).map((l) => l.replace(/\s+/g, ' ')).join(' | ')}; box 0.1 s, cylinder 1.1 s, cone 0.3 s, sphere 7.9 s), turning or copying it adds another build; the time-limit rows apply.` }));
pushBase('turn(shape,[rx,ry,rz]) on prism and wedge', (r) => ({
  feature: 'turn(shape,[rx,ry,rz]) on prism and wedge (an extra RotateFeature step about the bounding-box centre, NOT the primitive\'s own rotate: canRotate() is false for them, so the group brief that says "sets the primitive\'s own rotate" is wrong for these two)',
  evidence: r.evidence + ` Group description correction (round 3): only box, cylinder, cone and torus set their own rotate[3]; prism and wedge, like every derived shape, get a RotateFeature step. Measured both documents (r3-prismrot.mjs, 4 angle triples x prism, wedge = 8 cases): (a) the interpreter's doc (prism + RotateFeature step) and (b) the same prism with its own rotate[3] set and no step: BOTH PASS against live OCCT (SC dVol <= ${e(Math.max(...PR.map((r) => Math.max(r.step.dVol, r.own.dVol))))}, dBbox <= ${e(Math.max(...PR.map((r) => Math.max(r.step.dBbox, r.own.dBbox))))}); OCCT builds the two documents identically (dVol <= ${e(Math.max(...PR.map((r) => r.occtStepVsOwn.dVol)))}, dBbox <= ${e(Math.max(...PR.map((r) => r.occtStepVsOwn.dBbox)))}); brep-rs builds (b) with dVol <= ${e(Math.max(...PR.map((r) => r.brepOwn.dVol ?? 0)))}. So the translator may map either; the interpreter emits (a).`,
}));
pushBase('turn(shape,[rx,ry,rz]) on a derived shape', (r) => ({ evidence: r.evidence + ' ROUND 3: a derived shape that is several pieces (a cut that split the part) turns as one: cut-split then turn PASS (dVol 1.8e-16, dCom 3.9e-17, 12/12 faces, 2 pieces; r3-lumps.mjs).' }));
pushBase('turn() or move() of hollow', (r) => ({ evidence: r.evidence + ` ROUND 3, sentence for the dependents (r3-deps.mjs, guard translator, engine text never shown): hollow(no open) then turn -> "${dp('hollow(no open) then turn', 'turn1').refusal}" ; then move -> "${dp('hollow(no open) then move', 'move1').refusal}" ; then a copy -> "${dp('hollow(no open) then copy', 'move1').refusal}" ; a join of the turned part -> "${dp('hollow(no open), turn, then join with box', 'op1').refusal}". The unpatched translator prints engine text instead (${shippedJargon} dependent/refused sentences in r3-deps-results.json contain "solid." command names).` }));
pushBase('turn() on a sphere', (r) => ({ evidence: r.evidence.replace(/Side effect:.*$/, '') + ` Dead slider: see the "param() in turn() of a ring or a ball" row.` }));
// 14 sketch/plane
pushBase('turn() on a sketch or datum plane', (r) => ({
  feature: 'turn() or move() of a sketch or a datum plane (neither is a solid)',
  status: 'refused',
  refusalSentence: `turn(sketch): "${sk('turn(sketch)').page}" | turn(plane): "${sk('turn(plane)').page}" | move(sketch): "${sk('move(sketch)').page}" | move(plane): "${sk('move(plane)').page}"`,
  evidence: `${CMD('r3-sketchturn.mjs')} (interpreter only, no kernel; explain-script-error.mjs; r3-sketchturn-results.json). The interpreter says only "${sk('turn(sketch)').interpreter}" for a sketch or a plane because isHandle() fails before the 'a sketch is flat' branch at reshape-script.ts:3013, which is therefore unreachable (packages/script is read-only here). The page layer maps that error: it reads the line, finds what the first argument was declared as (sketch(...) or plane(...)) and says why in ONE sentence. Measured: ${SK.filter((r) => r.page && r.page !== r.interpreter).length} of ${SK.filter((r) => r.interpreter).length} errors rewritten (turn/move of a sketch and of a plane); turn(5,...) and move(5,...) keep the interpreter sentence (not a flat thing); a pulled sketch turns without an error (control). turn(sketch) never reaches SolidCraft. The mapping is a page-layer change: without it the student sees the one-line interpreter sentence "${sk('turn(sketch)').interpreter}" which does not say why.`,
}));
pushBase('angles in degrees', (r) => ({ evidence: r.evidence }));
// 16 param
pushBase('offsets and angles accept param()', (r) => ({
  feature: 'offsets and angles accept param(): move offsets, and turn angles of box, cylinder, cone, prism, wedge and derived shapes (every slider has a live slot)',
  evidence: r.evidence.replace(/Only caveat:.*$/, '') + ` ROUND 3: r3-param.mjs asks the interpreter which slider slots exist (namedParams[].slots against params[]): live for turn(box|cylinder|cone|prism|wedge), turn(hole box), turn(join), move(box), move(copy ring), move(sphere); DEAD for turn(ring) and turn(sphere) (next row).`,
}));
rows.push({
  feature: 'param() in turn() of a ring (torus) or a ball (sphere): the slider is dead',
  status: 'refused',
  refusalSentence: `${deadRing} | ${deadBall}`,
  evidence: `${CMD('r3-param.mjs')} (interpreter only; r3-param-results.json). turn(ring(30,6),[param('ax',30),param('ay',40),param('az',50)]) registers three named sliders whose slots point at ring1_rx/ry/rz, but the generated parameter list has NO ring1_rx/ry/rz row (params[] lacks them), so no slider can drive the turn; turn(sphere(14),[param(...)...]) registers three sliders with slots [] (turn on a ball is a no-op). The solid itself is right at the default angles (ring turns PASS, sphere no-op PASS: rows above), only the slider is dead. A slider whose slots are not rows of params[] is reported with the sentence above (deadSliders() in r3-param.mjs): ${PA.filter((r) => r.dead && r.dead.length).map((r) => r.name + ' -> ' + r.dead.length + ' dead').join('; ')}; controls with live sliders (0 dead): turn(box), turn(cylinder), turn(cone), turn(prism), turn(wedge), turn(hole box), turn(join), move(box), move copy(ring), move(sphere). Note (critic): a torus is affected, not only a sphere; values keyed by the NAMED param ({r:10}) are ignored by the interpreter for box too, so the test is the slot list, and values keyed by slot ({ring1_rx:10}) do change the doc, which a slider cannot reach. Status is 'refused' for the slider only.`,
});
// 17 fork + cut-head
pushBase('move() or turn() of a part that join/cut/mirror/repeat already used', (r) => ({ evidence: r.evidence }));
rows.push({
  feature: 'move() or turn() of a shape that pocket() or groove() already cut (the pocket result is a separate shape; move(a) moves the UNCUT original)',
  status: 'refused',
  refusalSentence: [chS('box;pocket;move(a)'), chS('join;pocket;turn(a) [RotateFeature]'), chS('box;groove;move(a)'), chS('box;pocket;move(a,copy)')].join(' | '),
  evidence: `${CMD('r3-cuthead.mjs')} ; MT_NOCUTGUARD=1 ... bun r3-cuthead.mjs (round-2 behaviour) ; r3-cuthead-results.json, r3-cuthead-control-results.json. OCCT and brep-rs: pocket(k,a,5) leaves box1 uncut under its own id, so move(a,[5,5,5]) moves the UNCUT box and pocket1 stays where it was (two shapes, e.g. volume 6000 and 5748.7); the translator's head-advance moved the cut body instead. Round-2 behaviour (control): ${[chC('box;pocket;move(a)'), chC('join;pocket;move(a)'), chC('box;groove;move(a)'), chC('box;hole;pocket;move(a)')].join(' | ')}: ${chCtlWrong.length} of ${CH.length} cases wrong. With the guard (cutGuard() in translate-guard.mjs: refuse move/turn when the target id has a newer cut on it) all ${chRef.length} such cases are REFUSED, nothing is wrong, and the controls PASS: move(pocket result) (dVol ${e(caseOf(CH, 'box;pocket;move(pocket result)').per.find((p) => p.top).dVol)}), turn(pocket result), turn of a primitive (its own rotate; pocket stays right), move BEFORE the pocket, and a pocket with no move. Verified workaround from the sentence: use the pocket's result (const p = pocket(...); move(p,...)). hole is not affected: the doc retargets the handle to the hole feature (move(a) after hole(a) PASS). Other consumers of a pocketed id (join, mirror, repeat after pocket(a)) read the same pre-cut shape in OCCT; those belong to their own groups and are not measured here.`,
});
// multi-piece rows
rows.push({
  feature: 'a cut, intersect, hole, pocket or groove that leaves SEVERAL separate pieces (copied, moved or turned tool), then move(), turn() or a copy of the result',
  status: 'supported',
  evidence: LUMP_EVID + ` Rigid transforms of a multi-piece result PASS: ${['cut-split then move result', 'cut-split then turn result', 'cut-split then copy-move result', 'cut by round tool, then move result', 'cut by round tool, then turn result', 'cut by joined disjoint tools, then turn result', 'pocket-split', 'pocket-split then turn', 'join disjoint copy then move', 'join disjoint copy then turn'].map((n) => { const c = caseOf(L, n); const p = lastPer(c); return `${n}: ${p.v} dVol ${e(p.dVol)} dCom ${e(p.dCom)} ${p.bodies?.length ?? 1} piece(s)`; }).join('; ')}. A round tool that splits the box (diameter-30 cylinder through box(60,20,10)) agrees on volume (dVol ${e(lastPer(caseOf(L, 'cut by round tool (2 pieces)')).dVol)} vs OCCT, closed form ${lastPer(caseOf(L, 'cut by round tool (2 pieces)')).seam.closedFormVol.toFixed(2)}, tessellation tier) but SC reports 14 faces to OCCT 13: truck splits a cylinder patch at BOTH 0 and 180 degrees, OCCT only at 0 (r3-seam.mjs: turning the tool by 0/180 gives SC 4 vs OCCT 3 cylinder faces, by 45/90/135 gives 2 vs 2; brep-rs 12 faces). Explained, not a geometry error. OCCT's own centre of mass of a two-solid compound is unreliable in the keep scene (OCCT com [0.94, 0.63, 0] for two pieces symmetric about the origin); the closed form (0,0,0) agrees with SC (PASS analytic). Oracle note: a diameter-30 hole through a 20-wide box is refused by OCCT and brep-rs ("would not fit"), so the cutter is a cylinder cut here.`,
});
rows.push({
  feature: 'a feature that needs ONE body (hole, round/bevel, hollow, draft, mirror, repeat, repeatAround, join/cut/keep with another part) applied to a result that is several separate pieces',
  status: 'refused',
  refusalSentence: [...new Set(sentSplit)][0] + ' (the same sentence for Hole, Round, Mirror, Repeat, Join, with that feature\'s own name)',
  evidence: `${CMD('r3-lumps.mjs')} (cut-split then hole / round edge / mirror / repeat / join with box; r3-lumps-results.json). Before the fix these ran on the one surviving piece and returned half the volume (control MT_NOEXTRA=1: wrong). Now splitMsg() refuses them: ${refusedDown.map((c) => c.name + ' -> "' + c.per.find((p) => p.refused).refused + '"').join(' | ')}. OCCT and brep-rs build all of these (they treat the result as one compound), so this is a SolidCraft-side gap that is refused, not wrong. Cost: a student who cuts a part in two and then drills it gets this sentence.`,
});
// 18 magnitude
rows.push({
  feature: 'move/turn (or any part) farther than 3000 mm from the origin',
  status: 'refused',
  refusalSentence: mgRefused[0].guardRefusal,
  evidence: `${CMD('r3-magnitude.mjs', 'SC_BOX_MS=120000 ')} (r3-magnitude-results.json; earlier sweeps p-magnitude*.mjs). Round 2 listed this as 'unsupported' with no sentence although the part DOES build and the volume/centre-of-mass reading is silently degraded, which is a wrong number; it is now refused with the sentence above (the guard measures the built bounding box: nothing beyond 3000 mm is accepted; the box is farthest-coordinate = F, F in 2000/3000/3001/5000/1e5/1e7 for a box, a cylinder, a sphere, a moved-and-turned hole box and a box built at [D,D,D]). F<=3000: ${mgOk.length - mgEdge.length} of ${mgOk.length} PASS (worst dCom ${e(Math.max(...mgOk.filter((r) => r.guard === 'PASS').map((r) => r.guardDCom)))}); ${mgEdge.length ? 'at exactly F=3000 the turned hole box grows to 3004 mm and is refused (' + mgEdge.map((r) => r.name).join(', ') + ')' : ''}. F>3000: ${mgRefused.length} of ${mgRefused.length} REFUSED with the sentence, 0 built. The unpatched translator builds them: ${mgShippedWrong.length} of ${MG.rows.length} wrong, e.g. ${mgShippedWrong.slice(0, 4).map((r) => r.name + ' @' + r.F + ' dCom ' + e(r.shippedDCom)).join('; ')}, and planar boxes stay exact to 1e5 (the single limit is deliberately simple and conservative: curved parts first fail the COM bar at 5000-1e4 mm, planar at 1e4-3e4). The limit is 3000 mm (3 m) of bounding-box coordinate, tolerance 0.5 mm for tessellated edges.`,
});
pushBase('move() argument misuse', (r) => ({ evidence: r.evidence }));
// slow rows
rows.push({
  feature: 'booleans with a round tool or part that is turned off-axis (cylinder turned [30,0,0] or [30,45,60] cut from a box): slow, correct',
  status: 'supported',
  evidence: `${CMD('r3-slow.mjs', 'SC_BOX_MS=120000 ')} (r3-slow-120000.json, r3-slow-300000.json). SLOW BUT CORRECT, within the 120 s budget: ${slowLine(sl('s01'))} ; ${slowLine(sl('s02'))}. Same cut with the tool axis-aligned is fast: ${slowLine(sl('s03'))} ; ${slowLine(sl('s04'))}; a box (planar) tool turned the same angle is fast: ${slowLine(sl('s05'))}. Without the time box (SC_BOX_MS=300000) the same two take ${sl3('s01').scCpuSec.toFixed(0)} s and ${sl3('s02').scCpuSec.toFixed(0)} s of CPU (the figure that does not depend on machine load; the machine was shared, wall times are upper bounds). brep-rs REFUSES this boolean (unsupported surface pair) so only OCCT is the oracle here. A student sees a minute of waiting; the page must run solidcraft in a Worker with the 120 s hard limit of the time-limit row. Practical advice from the data: turn the tool by multiples of 90 degrees, or cut with a box, to stay fast.`,
});
rows.push({
  feature: 'booleans of curved parts that take longer than the 120 s time limit: join of two perpendicular cylinders (equal or unequal radius), join of overlapping copied rings, join of a cylinder with a turned ring, a hole drilled through a ring\'s tube',
  status: 'refused',
  refusalSentence: sl('s06').refusal.replace('Join 1', 'Join 1') + ' (for a cut: "Cut 1 is not built: it took longer than 120 seconds to compute, so it is shown without it -- try a simpler shape.")',
  evidence: `${CMD('r3-slow.mjs', 'SC_BOX_MS=120000 ')} (r3-slow-120000.json). Each solidcraft call runs in a child process that is killed at the limit (sc-child.mjs, runner.mjs SC_BOX_MS): this stands in for a Worker that the page terminates, because a wasm call cannot be cancelled from the same thread and a browser tab would otherwise freeze. When the limit is hit the feature is refused with the sentence above and its dependents say "X is not built because Join 1, which it uses, was refused." ${slowLine(sl('s06'))} ; ${slowLine(sl('s07'))} (completes after ${sl3('s07').scCpuSec.toFixed(0)} s of CPU when allowed 300 s: PASS dVol ${e(sl3('s07').dVol)}, but that is above the budget) ; ${slowLine(sl('s08'))} ; ${slowLine(sl('s09'))} ; ${slowLine(S15)} (OCCT builds it: volume ${S15.occtVolume.toFixed(2)}; brep-rs: ${S15.brep.refused ? 'refuses (' + S15.brep.refused.slice(0, 70) + '...)' : 'builds'}). Equal-radius perpendicular cylinders did not finish in 300 s of wall time (${sl3('s06').verdict}); overlapping copied rings did not finish in 300 s either (${sl3('s08').verdict}); cylinder + turned ring did not (${sl3('s09').verdict}). Round 2 saw the ring join end in a refusal with engine jargon after 216 s; with the limit the student gets the plain sentence after 120 s instead. This status is 'refused' only if the page enforces the limit (Worker + terminate): measured here with a killed child process, not in a browser. The sentence names the limit but not the cause; it is the best a generic limit can say.`,
});
rows.push({
  feature: 'time to build a ring (torus), a ball (sphere) and copies/turns of them: slow primitives (ring 15-18 s CPU, ball 7-8 s CPU; box, cylinder, cone under 1.2 s)',
  status: 'supported',
  evidence: `${CMD('r3-ringtime.mjs', 'SC_BOX_MS=120000 ')} (r3-ringtime.out). ${ringtime.split('\n').map((l) => l.replace(/\s+/g, ' ')).join(' | ')}. The referee replays the whole feature list for each feature, so the ring-copy scene shows two calls (19 s then 35 s); an incremental session would pay each step once. Also measured: sphere + hole + turn ${slowLine(sl('s10'))}; cone + hole + turn ${slowLine(sl('s12'))}; box copy then join (the commonest copy) ${slowLine(sl('s13'))}; cylinder copy then join ${slowLine(sl('s14'))}. All correct, all inside the 120 s limit, but a ring or a ball makes every follow-up step a multi-second wait.`,
});
rows.push({
  feature: 'a hole (or other feature) the engine refuses or cannot finish in time, then move(), turn() or a copy of it: the sentence on the dependent',
  status: 'refused',
  refusalSentence: `${dp('ring, hole (engine refuses), then turn', 'hole1').refusal} | ${dp('ring, hole (engine refuses), then turn', 'turn1').refusal} | ${dp('ring, hole (engine refuses), then copy', 'move1').refusal} | ${dp('ring, hole through the tube (time limit), then turn', 'hole1').refusal} | ${dp('ring, hole through the tube (time limit), then turn', 'turn1').refusal} | ${dp('turned box, draft (engine refuses), then move', 'move1').refusal} | ${dp('hollow(no open), turn, then join with box', 'op1').refusal}`,
  evidence: `${CMD('r3-deps.mjs', 'SC_BOX_MS=120000 ')} (r3-deps-results.json). Four real refusal causes: (1) hole(ring(30,6),{across:3}) drilled through the EMPTY MIDDLE of the ring: nothing is cut; OCCT returns the ring unchanged (volume ${sl('s11').occtVolume.toFixed(2)}, no OCCT refusal ${JSON.stringify(sl('s11').occtRefusals)}), brep-rs says "${(sl('s11').brep.refused ?? '').slice(0, 70)}", SolidCraft refuses after ${sl('s11').slowestCallSec.toFixed(0)} s ("the cut could not be computed reliably: it came out empty"): a harmless no-op that is refused. (2) a hole through the ring's tube (at [12,0]) takes longer than the 120 s limit (time-limit row). (3) draft of a face of a turned box ("not supported yet: drafting faces that aren't parallel to the pull direction"). (4) hollow with no open face. The guard translator keeps the raw engine text in 'raw' (never shown) and shows: on the refused feature "X could not be built by this engine, so it is shown without it." (or the feature's own plain sentence, or the time-limit sentence); on every dependent move/turn/copy/join "Y is not built because X, which it uses, was refused." No engine word ("solid.", "solidcraft", "phase 0", command names) appears in any of the ${DP.reduce((n, r) => n + r.features.filter((f) => f.guard?.refusal).length, 0)} guard sentences (asserted); the unpatched translator prints the full engine message into the dependent's sentence (${shippedJargon} sentences containing "solid." command names). Weakness stated: "could not be built by this engine" says what, not why, for the refused feature itself.`,
});

// ================================================================ round 6 additions (post-process of the rows built above)
const AUTH = rd('r6-authored-text.json');
// (a) the paragraph earlier rounds appended by hand to these rows, now produced here
const REV_ROWS = ['move(shape,[x,y,z]) then round/bevel', 'move(shape,[x,y,z]) then hollow', 'turn(derived shape) then round/bevel', 'turn(derived shape) then hollow', 'pick after move/turn', 'move(shape,[x,y,z]): MoveFeature', 'move(shape,[x,y,z],{copy:true})', 'turn(shape,[rx,ry,rz]) on a primitive', 'turn(shape,[rx,ry,rz]) on prism and wedge', 'turn(shape,[rx,ry,rz]) on a derived shape', 'turn() on a sphere', 'turn() or move() of a sketch or a datum plane', 'angles in degrees', 'offsets and angles accept param()'];
for (const n of REV_ROWS) { const r = rows.find((x) => x.feature.startsWith(n)); need(r, 'rev row ' + n); r.evidence += AUTH.reverified; }
// (b) the compose row (was added by hand to the stored file): authored text, its numbers asserted against the data
const SCOMP = rd('s1-turn-compose-results.json');
need(SCOMP.summary && JSON.stringify(SCOMP.summary).length > 2, 'compose summary');
need(/19 PASS, 1 flagged/.test(AUTH.composeRow.evidence), 'compose row text');
need(SCOMP.out.length === 20 && SCOMP.summary.PASS === 19 && SCOMP.summary.FAIL === 1, 'compose: 20 cases, 19 PASS, 1 flagged');
rows.splice(11, 0, structuredClone(AUTH.composeRow));
need(rows[11].feature.startsWith('turn() and move() applied again'), 'compose row index');
// (c) cone chains: the silent wrong solid the critic found, and the guard that makes it safe
const cnt = (f, sc) => { const A = rd(f); const s = A.find((x) => x.scenario === sc && x.summary); need(s, f + ' ' + sc); return s.summary; };
const CW = [['cone', cnt('r6-wide-a-results.json', 'cone')], ['copies', cnt('r6-wide-a-results.json', 'copies')], ['join', cnt('r6-wide-join-results.json', 'join')], ['control', cnt('r6-wide-control-results.json', 'control')]];
const CM = cnt('r6-conechain-moves-results.json', 'moves');
const CF = [['cone', cnt('r6-fresh-a-results.json', 'cone')], ['copies', cnt('r6-fresh-a-results.json', 'copies')], ['join', cnt('r6-fresh-join-results.json', 'join')]];
const CC = ['cone', 'copies'].map((k) => [k, cnt('r6-control-nolimit-results.json', k)]);
const guardWrongTotal = [...CW, ['moves', CM], ...CF].reduce((a, [, s]) => a + s.guardWrong, 0);
const guardTotal = [...CW, ['moves', CM], ...CF].reduce((a, [, s]) => a + s.n, 0);
const shippedWrongTotal = [...CW, ['moves', CM], ...CF].reduce((a, [, s]) => a + (s.shipped.FAIL ?? 0), 0);
const guardRefusedTotal = [...CW, ['moves', CM], ...CF].reduce((a, [, s]) => a + (s.guard.REFUSED ?? 0), 0);
const ctlWrong = CC.reduce((a, [, s]) => a + s.guardWrong, 0);
need(CW.find(([k]) => k === 'control')[1].guardWrong === 0, 'control scenario 0 wrong');
need(guardWrongTotal === 0, 'cone chain guard must have 0 wrong, got ' + guardWrongTotal);
need(ctlWrong >= 1, 'negative control (limit off) must reproduce the wrong solids');
need(shippedWrongTotal >= 20, 'shipped translator must be wrong on the cone chains');
const CLS = rd('r6-limit-sentence-results.json');
need(CLS.directSentence && !/solid\.|solidcraft|truck|occt|brep|phase 0/i.test(CLS.directSentence), 'cone sentence');
const GW = rd('r5-guardwrong-results.json');
for (const k of ['gw1', 'gw2', 'gw3']) need(GW[k].steps.every((s) => s.guard.v !== 'FAIL'), 'guardwrong ' + k + ' no FAIL');
const CONE_TXT = ` ROUND 6 (cone chains, the critic's silent wrong solid): a cone is built by spinning a triangle, and solidcraft returns a WRONG body (volume, area and centre of mass off, bounding box right) after about 3 or more accumulated move/turn steps: as shipped, ${shippedWrongTotal} of ${guardTotal} fuzzed cone/copy/join chains are wrong (dVol up to 0.27, dCom up to 0.16; r4-conechain.mjs, r5-conechain-moves.out, r5-critic-repro.out, and the scripts' --seed values in run-r6.sh). The page translator MUST ship the guard in move-turn-harness/translate-guard.mjs, otherwise rows 6, 7, 9, 11 and 12 are WRONG, not supported: (1) a rigid-motion invariant on every move/turn (volume, area, face kinds and centre of mass of the result must equal the part it started from), (2) a chain repair (fold translations, retry), (3) NEW, a limit of ${CLS.limit} move/turn steps for a part that has a conical face (copies inherit the count); the next step is refused with: "${CLS.directSentence}". Why (3): the invariant and repair cannot see an error of tessellation scale (centre of mass 3.0e-5 to 3.4e-5 of the diagonal against the 3e-5 bar, 3 chains of 360 in the round-5 wide fuzz: r5-guardwrong.mjs gw1 1.7e-4, gw2 3.0e-5, gw3 3.4e-5); with the limit all three are refused (r6-guardwrong.out). PROOF (fuzz, guard translator vs live OCCT, bar dVol 3e-4, dCom 3e-5 curved, faces equal): ${guardTotal} chains (wide seed 5150: cone, copies and control n 120 each, join n 60; moves seed 7 n 100; fresh seed 9001: cone and copies n 120 each, join n 60; the per-scenario counts are in r6-*-results.json): guard WRONG ${guardWrongTotal}, guard refused ${guardRefusedTotal} chains (cost: legitimate long cone chains are refused too). NEGATIVE CONTROL (limit off, MT_NOCONELIMIT=1, seed 5150 cone/copies n 120): ${ctlWrong} guard-wrong chains again. The limit ${CLS.limit} was chosen after seeing gw2 (failing at the 4th step), stated here, not before. Not measured by this fuzz: chains of a ring (torus) or a ball (sphere), which are not cone-built; they rest on the b-turn sweep and the cylinder/box/prism/wedge controls of the same runs (control scenario, 0 wrong).`;
for (const n of ['move(shape,[x,y,z]): MoveFeature', 'move(shape,[x,y,z],{copy:true})', 'turn(shape,[rx,ry,rz]) on a primitive', 'turn(shape,[rx,ry,rz]) on a derived shape', 'turn() and move() applied again']) { const r = rows.find((x) => x.feature.startsWith(n)); need(r, 'cone row ' + n); r.evidence += CONE_TXT; }
for (const n of ['move(shape,[x,y,z]): MoveFeature', 'move(shape,[x,y,z],{copy:true})', 'turn(shape,[rx,ry,rz]) on a derived shape', 'turn() and move() applied again']) { const r = rows.find((x) => x.feature.startsWith(n)); r.feature += ' [a part with a cone face: at most 3 move/turn steps in a row, then refused (cone-chain row); the translator guard must ship]'; }
const coneRow = rows.find((x) => x.feature.startsWith('turn(shape,[rx,ry,rz]) on a primitive'));
coneRow.feature = coneRow.feature.replace('box, cylinder, cone, torus', 'box, cylinder, cone (at most 3 move/turn steps, then refused), torus');
rows.splice(12, 0, {
  feature: 'move() or turn() of a part with a conical face (a cone, or a part joined with one) that has already been moved or turned more than 3 times, including copies of it',
  status: 'refused',
  refusalSentence: CLS.directSentence,
  evidence: `${CMD('r6-limit-sentence.mjs')} (r6-limit-sentence-results.json): cone(8,15) then five move() steps: steps 1-3 build, step 4 and 5 are refused with the sentence above (and a later feature that uses a refused step says "X is not built because Y, which it uses, was refused."). Without the limit ${CONE_TXT.slice(CONE_TXT.indexOf('PROOF'))}`,
});
need(rows.length === 29, 'expected 29 rows, got ' + rows.length);
const out = { group: 'move-turn', rows };
for (const r of rows) { need(['supported', 'refused', 'unsupported', 'wrong'].includes(r.status), 'status ' + r.feature); if (r.status === 'refused') need(r.refusalSentence, 'refused row needs a sentence: ' + r.feature); }
writeFileSync(path.join(HERE, '..', 'move-turn.json'), JSON.stringify(out, null, 1));
console.log(rows.map((r, i) => `${String(i + 1).padStart(2)} ${r.status.padEnd(11)} ${r.feature.slice(0, 120)}`).join('\n'));
