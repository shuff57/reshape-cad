// Round 3 row builder for contract/picks-naming-params.json.
//   bun r3-build-rows.mjs      (reads picks-naming-params.round2.json + the r3-results/*.json measurement files in this directory)
// Every number in a new or changed row is read from r3-results/ at build time, not typed. Every refusal sentence is checked against the
// sentences the guard/sentence layer (r3-guard.mjs) actually emitted in r3-results (r3d-compare.json, r3a/r3b/r3e/r3f), after replacing
// ids and numbers; a sentence the layer did not emit is a build error.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const J = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const base = J('picks-naming-params.round2.json').rows;
const RA = J('r3-results/r3a-draft-sweep.json'), RB = J('r3-results/r3b-size-sweep.json'), RC = J('r3-results/r3c-misc.json');
const RE = J('r3-results/r3e-slot-sweep.json'), RF = J('r3-results/r3f-misc-refusals.json'), CMP = J('r3-results/r3d-compare.json');
const RX = J('r3-results/r3g-extra.json');
const RI = J('r3-results/r3i-guards-elsewhere.json'); const RIM = J('r3-results/sec/r2b-rim.json');
const RH = J('r3-results/r3h-reconcile.json'); const H = (prefix) => RH.find((r) => r.label.startsWith(prefix));
const hAdj = H('round top|front then'), hBev = H('bevel top|front then'), hTri = H('triangular'), hMove = H('move box'), hCone = H('hollow open bottom of a cone'), hDraft = H('draft 80'), hThin = H('bevel 2 on the 1 mm');
const SCRIPTERRORS = []; // interpreter sentences the student sees verbatim (script errors), from the re-runs through the layer
for (const f of readdirSync(new URL('r3-results/sec/', import.meta.url))) if (f.endsWith('.json')) { try { const j = J('r3-results/sec/' + f); for (const r of Array.isArray(j) ? j : []) if (r.scriptError) SCRIPTERRORS.push(r.scriptError); } catch { /* not a list */ } }
const O = (i) => structuredClone(base[i - 1]);
const f4 = (v) => (typeof v === 'number' ? v.toFixed(4) : String(v));
const f3 = (v) => (typeof v === 'number' ? v.toFixed(3) : String(v));
const e1 = (v) => (typeof v === 'number' ? v.toExponential(1) : String(v));
const rows = [];
const add = (feature, status, refusalSentence, evidence, extra = {}) => rows.push({ feature, status, refusalSentence: refusalSentence ?? null, evidence, ...extra });
const keep = (i, patch = {}) => { const r = O(i); rows.push({ feature: r.feature, status: r.status, refusalSentence: r.refusalSentence ?? null, evidence: r.evidence, ...(r.observedSentence ? { observedSentence: r.observedSentence } : {}), ...(r.requiredGuardSentence ? { requiredGuardSentence: r.requiredGuardSentence } : {}), ...patch }); };
const RIG = 'rig (see contract/RIG.md): SolidCraft wasm pkg (fe3717f) through the page\'s own phase-7 translator (phase7/pane/lib/translate-p4.mjs), scored against live OCCT, live brep-rs and an independent closed form where stated; run from contract/picks-naming-params.evidence/ with SOLIDCRAFT_REFEREE_PKG set, under systemd-run --scope -p MemoryMax=16G -p MemorySwapMax=0.';
const ABSENT = 'GUARD ABSENT FROM THE PAGE: grep for G-VANISH|G-THICK|G-ANGLE|G-OUTLINE|selfTouch over phase7/pane/lib/*.mjs, phase7/pane/pane.js and phase7/pane/bundle/host-lib.js finds 0 hits; phase7/pane/src/host-entry.mjs:6 exports translateDoc from translate-p4.mjs unchanged. The guards exist only in contract/ (shell-draft-translate.mjs, outline-guard.mjs, r3-guard.mjs).';
const BASIS = 'BASIS: the product is the page translator (translate-p4.mjs) plus the guard/sentence layer r3-guard.mjs that this group specifies; the layer is NOT in the page yet.';

// ---------------------------------------------------------------------------------------------------------------- measured sentence set
const norm = (s) => s.replace(/\b[a-z]+\d+\b/g, 'ID').replace(/-?\d+(\.\d+)?/g, 'N').replace(/\s+/g, ' ').trim();
const emitted = new Map(); // normalized sentence -> count
const seen = (s) => { if (typeof s === 'string') emitted.set(norm(s), (emitted.get(norm(s)) ?? 0) + 1); };
for (const g of CMP.groups) for (let i = 0; i < g.n; i++) seen(g.plain);
for (const r of RA) seen(r.g?.sentence);
for (const r of RB) seen(r.g?.sentence);
for (const r of RE) seen(r.guardSentence);
for (const r of RF) for (const x of r.refused ?? []) seen(x.plain);
for (const c of RC['pocket corner sliders at min/max'] ?? []) seen(c.guardSentence);
for (const c of RC['pocket bow-tie sweep'] ?? []) seen(c.guardSentence);
for (const [, v] of Object.entries(RC['checkModel x4 rim rounds']?.maps ?? {})) seen(v);
for (const r of RX.cases ?? []) for (const s of r.plain ?? []) seen(s);
for (const s of SCRIPTERRORS) seen(s);
for (const c of RI.cases ?? []) for (const x of c.plain ?? []) seen(x);
for (const c of RI.sd ?? []) { seen(c.layer?.sentence); seen(c.shellDraft?.sentence); }
for (const r of RF) if (r.scriptError) seen(r.scriptError);
const emittedN = (s) => emitted.get(norm(s)) ?? 0;

// ---------------------------------------------------------------------------------------------------------------- stats
const dr = RA.filter((r) => r.verdict);
const dFeas = dr.filter((r) => r.feasible), dInf = dr.filter((r) => !r.feasible);
const dExact = dFeas.filter((r) => r.verdict === 'EXACT');
const dMax = Math.max(...dExact.map((r) => r.dClosed));
const dBothRefuse = dInf.filter((r) => Object.keys(r.occtRefusals ?? {}).length && Object.keys(r.brepRefusals ?? {}).length).length;
const dOcctBuilt = dInf.filter((r) => !Object.keys(r.occtRefusals ?? {}).length);
const dGuardRef = dInf.filter((r) => r.g.status === 'refused').length, dGuardFalse = dFeas.filter((r) => r.g.status === 'refused').length;
const dLimitOK = dInf.filter((r) => r.limitOK).length;
const dRow = (a, extra = {}) => dr.find((r) => r.w === 40 && r.d === 30 && r.h === 20 && r.word === 'right' && r.from === null && r.a === a && Object.entries(extra).every(([k, v]) => r[k] === v));
const dEx = [76, 80, 85, 89.5].map((a) => { const r = dRow(a); return `${a} deg: V=${f3(r.truck.V)}, ${r.truck.faces} faces, bbox x max ${f3(r.truck.bbox[3])}`; }).join(' | ');
const dNarrow = dr.find((r) => r.w === 10 && r.word === 'right' && r.from === null && r.a === 45);
const dBottom = dr.find((r) => r.w === 40 && r.d === 30 && r.h === 20 && r.word === 'right' && r.from === 'bottom' && r.a === 64);
const dLimit = (Math.atan(40 / 10) * 180) / Math.PI, dLimitBottom = (Math.atan(40 / 20) * 180) / Math.PI;

const hb = RB.filter((r) => r.kind === 'hollow-box' && r.verdict), hc = RB.filter((r) => r.kind === 'hollow-cyl' && r.verdict);
const hExact = [...hb, ...hc].filter((r) => r.verdict === 'EXACT');
const hInf = [...hb, ...hc].filter((r) => !r.feasible);
const hSilent = [...hb, ...hc].filter((r) => r.verdict === 'SILENT-WRONG');
const hGuardRef = hInf.filter((r) => r.g.status === 'refused').length, hGuardFalse = [...hb, ...hc].filter((r) => r.feasible && r.g.status === 'refused').length;
const hMaxD = Math.max(...hExact.map((r) => r.dClosed));
const hLimStated = [...hb, ...hc].filter((r) => r.limitStated !== undefined);
const hEx = (label) => { const r = [...hb, ...hc].find((x) => x.label === label); return `${label}: V=${f3(r.truck.V)} faces ${r.truck.faces} (the unhollowed block is ${f3(r.occtV)}; OCCT and brep-rs refuse: "would collapse it")`; };
const bv = RB.filter((r) => r.kind === 'bevel' && r.verdict), rd = RB.filter((r) => r.kind === 'round' && r.verdict);
const bvExact = bv.filter((r) => r.verdict === 'EXACT'), bvSilent = bv.filter((r) => r.verdict === 'SILENT-WRONG'), bvEq = bv.filter((r) => r.eq);
const bvGuardRef = bvSilent.filter((r) => r.g.status === 'refused').length, bvGuardFalse = bv.filter((r) => r.feasible && !r.eq && r.g.status === 'refused').length;
const bvEx = (label) => { const r = bv.find((x) => x.label === label); return `${label}: V=${f3(r.truck.V)} ${r.truck.faces} faces (true shape does not exist; OCCT and brep-rs refuse: "would not fit its edge")`; };
const rdRefOK = rd.filter((r) => r.verdict === 'REFUSED-OK'), rdExact = rd.filter((r) => r.verdict === 'EXACT'), rdEq = rd.filter((r) => r.eq);
const rdEqMax = Math.max(...rdEq.map((r) => r.dClosed));
const rdBad = rd.filter((r) => ['SILENT-WRONG', 'OVER-REFUSAL', 'WRONG-VOLUME'].includes(r.verdict)).length;

// ---------------------------------------------------------------------------------------------------------------- rows
add('shape.face(\'top\'|\'bottom\'|\'front\'|\'back\'|\'left\'|\'right\') on a box, used as hollow open face (all 6 words), wall inside the collapse limit', 'supported', null, O(1).evidence + ` BOUND: this row holds for a wall under min(depth along the open axis, half the narrowest lateral width); at or past it see the hollow-limit WRONG row (r3b: ${hExact.length} feasible sweep cases EXACT, max rel diff to the closed form ${e1(hMaxD)}).`);

// ---- draft within limit / beyond limit
add('shape.face(\'front\'|\'back\'|\'left\'|\'right\') as draft(face, angle) with default pull z, with |angle| BELOW the feasibility limit atan(W / D) (W = distance to the opposite face, D = distance from the neutral plane to the end that leans inward)', 'supported', null,
  `cmd: bun r3a-draft-sweep.mjs (r3-results/r3a-draft-sweep.json). ${RIG} ${dr.length} cases = 3 boxes (40x30x20, 40x30x5, 10x30x20) x 4 side words x neutral default | from:'bottom' x both signs x 13 angles 1..89.5. MEASURED LAW (neutral -10..10 on the 40x30x20 box, SolidCraft = OCCT to 1e-15): for a positive angle the face moves OUT below the neutral plane and IN above it by |z-n|*tan(a); a negative angle is the reverse. Closed form: valid iff the inward move stays under W; V = Dp*(W*h + tan(a)*(n*h - (z1^2 - z0^2)/2)). ${dFeas.length} feasible cases: ${dExact.length} EXACT against the closed form (max rel diff ${e1(dMax)}, 6 faces each), including 85 and 89.5 degrees where the face leans outward only. Earlier same-group evidence kept: ` + O(2).evidence.replace(/^cmd: bun secA.mjs\. /, 'secA: '));
add('draft(face, angle) with |angle| AT OR PAST the limit atan(W / D): the angle slider draft1_angle offers -89.5..89.5', 'wrong', null,
  `WRONG SOLID, NO SENTENCE. cmd: bun r3a-draft-sweep.mjs. ${RIG} ${dInf.length} of ${dr.length} swept cases are infeasible by the closed form and ALL ${dInf.filter((r) => r.verdict === 'SILENT-WRONG').length} are built by the page with ok:true and no sentence, every one with 5 faces instead of 6. 40x30x20 box, draft(b.face('right'), a), limit atan(40/10)=${f3(dLimit)} deg: ${dEx}; the true answer is "no solid" (the tilted face has passed through the opposite face). ${dBothRefuse} of ${dInf.length} cases are refused by BOTH OCCT ("Tilting Draft 1 at 80 degrees would not fit -- Draft 1 is shown without it.") and brep-rs ("Tilting draft1 at 80 degrees would not fit"); ${dOcctBuilt.length} are built by OCCT (${dOcctBuilt.map((r) => `${r.w}x${r.d}x${r.h} ${r.word} ${r.from ?? 'mid'} ${r.a}: OCCT V=${f3(r.occtV)}`).slice(0, 2).join('; ')}) while brep-rs refuses (both are the exact boundary angle atan(W/D), where the face just touches the opposite face). Narrow part: 10 wide box, draft right 45 deg (limit atan(10/10)=45): V=${f3(dNarrow.truck.V)}, ${dNarrow.truck.faces} faces. from:'bottom' (neutral at the base, D=20, limit ${f3(dLimitBottom)}): 64 deg builds V=${f3(dBottom.truck.V)} ${dBottom.truck.faces} faces (closed form ${f3(dBottom.closedV)}). The first sweep in this group (round 2) scored these NO-REFERENCE and passed them over; this one decides them by the closed form. GUARD MEASURED (r3-guard.mjs G-DRAFT, rule: a draft must keep the face count of its target): ${dGuardRef}/${dInf.length} infeasible cases refused with a sentence, ${dGuardFalse}/${dFeas.length} feasible cases refused, and the limit stated in the sentence equals an independent atan(W/D) floored to 0.1 degree in ${dLimitOK}/${dGuardRef}. The same rule exists as G-VANISH (and G-ANGLE |angle|>89) in contract/shell-draft-translate.mjs (shell-draft.json row 50: 50 and 60 degrees refused). ${ABSENT}`,
  { requiredGuardSentence: dInf.find((r) => r.w === 40 && r.h === 20 && r.word === 'right' && r.from === null && r.a === 76).g.sentence, observedSentence: '(none: the page shows the clipped solid with no message)' });

keep(3);
keep(4);
keep(5);
keep(6);
keep(7);
keep(8);
keep(9);
keep(10);
add(O(11).feature, 'refused', 'shell1 is not built: the faces of a cone cannot be picked by direction yet.', O(11).evidence + ` EMITTED (measured, r3d-compare.json): the layer produces the same sentence with the shape named (${['sphere', 'cone', 'ring', 'wedge'].map((s) => `"the faces of a ${s} cannot be picked by direction yet"`).join(', ')}) for the 11 probes of secB. RECONCILIATION: contract/shell-draft.json rows 5, 8 and 51 mark hollow open:'bottom' on a cone and one-face-word hollow/draft on prism/wedge as supported; they were measured on shell-draft-translate.mjs (phase0 translate.mjs picks faces with brep-rs resolve). MEASURED (r3h-reconcile.mjs, hollow open:'bottom' of cone(30,20)): phase0 translator builds V=${f3(hCone.phase0.V)} (${hCone.phase0.faces} faces; brep-rs ${f3(hCone.brep.V)}; OCCT refuses the hollow and returns the unhollowed ${f3(hCone.occt.V)}); the page refuses it. The page translator (translate-p4 + resolve-names.mjs) refuses them, and the page is the product.`, { observedSentence: O(11).observedSentence });
keep(12);
keep(13);
keep(14);
keep(15);
keep(16, { evidence: O(16).evidence.replace(/Carried through round \+ open \+x and rounding the rim of a shelled box have NO valid OCCT\/brep-rs result \(both refuse\); SolidCraft gives 8166\.230892 and 7126\.230879, which equal my independent closed forms to 1e-7: \(a\) hollowed box 7152 minus the rounded rim edge \(1-pi\/4\)\*2\^2\*30 = 25\.7699 -> 7126\.2301; \(b\) rounded outer 24000-25\.7699 = 23974\.2301 minus cavity 38\*26\*16 = 15808 \(open \+x\) -> 8166\.2301\. VERIFIED by closed form only, no second kernel agrees\./, 'Carried through round + open +x has NO valid OCCT/brep-rs result (both refuse); SolidCraft gives 8166.230892, which equals the independent closed form (b) rounded outer 24000-25.7699 = 23974.2301 minus cavity 38*26*16 = 15808 (open +x) = 8166.2301 to 1e-7. VERIFIED by closed form only, no second kernel agrees. ROUND 3 CORRECTION: the earlier "rounding the rim of a shelled box" example (round radius 2 = wall 2) was removed from this row: radius equal to the wall is the knife-edge of the rim-round WRONG row (top|front on the box at [7,-5,3]: 6892.308 vs 7117.664), so it does not belong in a supported row. Rim rounds BELOW the wall are in the consumers row.') });
keep(17, { evidence: O(17).evidence + ` RECONCILIATION (fillet-chamfer.json row 38: wrong): r3h-reconcile.mjs, box(40,30,4) moved up 2 then round top|front 1.5: the phase0 translator BUILDS V=${f3(hMove.phase0.V)} with COM z ${f4(hMove.phase0.com[2])} while OCCT and brep-rs give V=${f3(hMove.occt.V)} and COM z ${f4(hMove.occt.com[2])} (it rounded the wrong edge, the bottom-front one); the page translator REFUSES it with the sentence above, so the phase0 defect does not reach a student.` });
add(O(18).feature, 'refused', 'round1 is not built: box1 was already joined by op1, so its edges can no longer be picked -- pick the edge on the result of op1 instead.', O(18).evidence + ` WORDING (measured, r3d-compare.json): the sentence names the operation that used the target up, taken from the model: union -> "joined" (op1), mirror -> "mirrored" (mir1)${RX.cut ? `, subtract -> "${RX.cut.verb}" (${RX.cut.plain})` : ''}. The round-2 sentence said "combined by join1" for all three, which was wrong for mirror and cut.`, { observedSentence: O(18).observedSentence });
keep(19);
keep(20);
keep(21);
keep(22);
keep(23);
keep(24);
keep(25, { refusalSentence: 'round1 is not built: a round of 4.5 is too large for the 4 mm tall pocket wall it sits on -- use a smaller size.' });
keep(26);
keep(27);
add('part.wall / part.rim / edge(top, wall) of a CIRCULAR or ROUNDED-CORNER pocket (round1 itself is refused: 0 rim edges built)', 'refused', O(28).refusalSentence, O(28).evidence + ' RIM CASES (bun r2f-rim.mjs, re-run through the layer): circle pocket r1: 1 rim edge, 0 built, round1 refused with this sentence; rounded-corner rectangle pocket r0.5: 4 rim edges, 0 built, round1 refused with this sentence, round2..4 refused as dependents ("round2 is not built because round1 could not be built, so round2 is shown without it."). The round-2 row 29 attached the adjacent-corner sentence to these two cases, which was false: nothing had been rounded before round1.', { observedSentence: O(28).observedSentence });
add('part.rim(sketch) with round()/bevel() of the whole list on a STRAIGHT-SIDED pocket: rectangular, hexagonal, triangular, deep, through and flush pockets (the product builds the FIRST edge only)', 'refused',
  'round2 is not built: round1 already worked on the corner this edge shares with it, and edges that meet at a corner cannot be rounded or bevelled one after the other yet.',
  O(29).evidence.replace('(the product builds the FIRST edge only)', '').replace(/ circle pocket r1: 1 rim edges[^|]*\|/, '').replace(/ rounded-corner rect pocket r0\.5[^|]*\|/, '') + ` EMITTED (measured): round2 gets the sentence above, round3 and round4 "round3 is not built because round2 could not be built, so round3 is shown without it."; bevel rims say "bevel2 is not built: bevel1 already worked on...". The circle and rounded-corner rims are in the previous row. RECONCILIATION (fillet-chamfer.json rows 20 and 24 mark the TRIANGULAR rim supported, with their own numbers 11601.514 vs 11601.521 for their pocket): r3h-reconcile.mjs on a triangular pocket, rim round 1: the phase0 translator builds all 3 edges (V=${f3(hTri.phase0.V)}, ${hTri.phase0.faces} faces); the page translator builds the first edge and refuses the other two; OCCT cannot complete a sequential rim ("Round 2's edge could not be found") so there is no sequential reference. The page is the product.`, { observedSentence: O(29).observedSentence });
add(O(30).feature, 'refused', 'round2 is not built: round1 already worked on the corner this edge shares with it, and edges that meet at a corner cannot be rounded or bevelled one after the other yet.', O(30).evidence.replace(/Nothing wrong is built\./, `Nothing wrong is built on the page. RECONCILIATION (fillet-chamfer.json rows 14, 16, 17 mark sequential rounds/bevels on one box supported): r3h-reconcile.mjs, box 40x30x20 at [5,-3,2], round top|front then round top|right r2: the phase0 translator builds V=${f3(hAdj.phase0.V)} (${hAdj.phase0.faces} faces); live OCCT, which runs the script sequentially like a student's script, gives V=${f3(hAdj.occt.V)} (${hAdj.occt.faces} faces): relative difference ${e1(Math.abs(hAdj.phase0.V - hAdj.occt.V) / hAdj.occt.V)} against the curved bar 3e-4, so under this group's oracle rule that phase0 result is not a pass (it equals the SIMULTANEOUS OCCT result 23940.678 measured in round 2). Two bevels are different: phase0 V=${f3(hBev.phase0.V)} = OCCT ${f3(hBev.occt.V)} = brep-rs exactly, 8 faces, which is why fillet-chamfer row 17 is right for bevels. The page refuses the second round, so no number reaches a student.`), { observedSentence: O(30).observedSentence });
keep(31);
keep(32);
keep(33);
add('Consumers of picks inside their size limits: round(edge) and bevel(edge) with the size no larger than the faces beside the edge, after hole, after hollow (rim round STRICTLY below the wall), on L-shapes and cylinders', 'supported', null,
  O(34).evidence.replace('holds ONLY for a radius below the wall; for a radius at or above the wall see the WRONG row.', 'holds ONLY for a radius below the wall; for a radius at or above the wall see the WRONG row.') + ` ROUND 3 BOUNDS (bun r3b-size-sweep.mjs, closed forms; box edge(top,front), 6 boxes incl. 1 mm and 3 mm thin ones, 14 sizes 0.5..31): bevel inside the limit ${bvExact.length - bvEq.length} EXACT (planar, <=1e-9); round inside the limit ${rdExact.length - rdEq.length} EXACT (max rel diff to the closed form <= 3e-4 curved bar); hollow ${hExact.length} feasible walls EXACT (box and cylinder).`);
add('round(edge, r) with r LARGER than a face beside the edge (box 40x1x20 r1, 40x30x1 r2, 40x3x20 r3 .. r31)', 'refused', 'round1 is not built: a round of 5 is too large for the faces next to this edge -- use a smaller size.',
  `cmd: bun r3b-size-sweep.mjs. ${RIG} ${rdRefOK.length} cases with r above the face size: ALL ${rdRefOK.length} refused by the engine (page text "round1 (fillet): solidcraft refused it -- solid.fillet: not supported yet: the blend is larger than the neighbouring faces"), OCCT and brep-rs also refuse ("Rounding Round 1 at 2 would not fit its edge"). The layer replaces the page text with the sentence above (${rdRefOK.filter((r) => r.g.status === 'refused').length}/${rdRefOK.length} emit it, 0 silent). AT EQUALITY (r = the face size, ${rdEq.length} cases, e.g. 40x30x20 r20: the whole front face becomes the blend): the page BUILDS and the solid is right, V within ${e1(rdEqMax)} of the closed form (1-pi/4)*r^2*L (curved bar 3e-4), 6 faces; both oracles refuse it. ${rdBad} round cases were wrong or over-refused in the whole sweep. The wrong case is the BEVEL, next row.`, { observedSentence: 'round1 (fillet): solidcraft refused it -- solid.fillet: not supported yet: the blend is larger than the neighbouring faces' });
add('bevel(edge, d) with d LARGER than a face beside the edge: the bevel size slider (bevel1_size) offers 0.5..9.5 on a 40x30x20 box and the box slots go down to 1', 'wrong', null,
  `WRONG SOLID, NO SENTENCE. cmd: bun r3b-size-sweep.mjs. ${RIG} ${bvSilent.length} of ${bv.length} bevel cases are larger than a face beside the edge; the page builds ALL ${bvSilent.length} with ok:true, no sentence, 5 or 6 faces (a valid bevel adds a face: 7). ${bvEx('40x1x20 bevel(top,front) 2')} | ${bvEx('40x30x1 bevel(top,front) 2')} | ${bvEx('40x3x20 bevel(top,front) 4')} | ${bvEx('40x30x20 bevel(top,front) 31')}. The round of the same size is refused (previous row), so the student gets a sentence for one and a clipped solid for the other. fillet-chamfer.json row 13 reports the same defect on the phase0 translator. At equality (d = face size, ${bvEq.length} cases) the page builds a solid that equals the closed form d^2/2*L exactly; both oracles refuse, and the contract refuses it too. GUARD MEASURED (r3-guard.mjs G-BEVEL, rule: a bevel must gain exactly one face): ${bvGuardRef}/${bvSilent.length} wrong cases refused with a sentence, ${bvGuardFalse}/${bv.filter((r) => r.feasible && !r.eq).length} strictly-feasible cases refused, ${bvEq.filter((r) => r.g.status === 'refused').length}/${bvEq.length} equality cases refused (conservative, both oracles refuse). No guard of this kind exists in shell-draft-translate.mjs or anywhere else. ${ABSENT}`,
  { requiredGuardSentence: bvSilent.find((r) => r.label === '40x1x20 bevel(top,front) 2').g.sentence, observedSentence: '(none: the page shows the clipped solid with no message)' });
add('hollow(shape,{wall:t,open:word}) with t AT OR PAST the collapse limit min(depth along the open axis, half the narrowest lateral width) on a box or cylinder: the wall slider shell1_thickness offers 0.5..40', 'wrong', null,
  `WRONG SOLID, NO SENTENCE. cmd: bun r3b-size-sweep.mjs. ${RIG} ${hInf.length} infeasible hollow cases (7 boxes x open top/left x 12 walls, 4 cylinders d24 x 8 walls): ${hSilent.length} are built by the page with ok:true and no sentence and no hollow (the other ${hInf.length - hSilent.length} are refused by the engine with raw text such as "solid.shell: invalid input: the planes don't enclose a solid"). ${hEx('40x30x1 open top wall 2')}; ${hEx('40x30x20 open top wall 15')}; ${hEx('cyl d24 h1 open top wall 2')}; OCCT and brep-rs: "Hollowing Hollow 1 to 2 thick would collapse it -- the wall has to be under 0.5." The ${hExact.length} feasible cases (including wall 14.5 on the 40x30x20 box, V=23939.5, where OCCT refuses and the closed form agrees) are EXACT (max rel diff ${e1(hMaxD)}, cylinders within the 3e-4 tessellation bar). GUARD MEASURED (r3-guard.mjs G-HOLLOW, rule: a hollow must lose volume and gain faces): ${hGuardRef}/${hInf.length} infeasible cases refused with a sentence, ${hGuardFalse}/${[...hb, ...hc].filter((r) => r.feasible).length} feasible cases refused; the limit stated in the sentence equals an independent min(depth, lateral/2) in ${hLimStated.filter((r) => r.limitOK).length}/${hLimStated.length}. The same rule is G-THICK in contract/shell-draft-translate.mjs (shell-draft.json). ${ABSENT}`,
  { requiredGuardSentence: hSilent.find((r) => r.label === '40x30x1 open top wall 2').g.sentence, observedSentence: '(none: the page shows the unhollowed block with no message)' });
// slider reach summary
{
  const pageBuiltNoOracle = RE.filter((r) => r.page === 'BUILT-NO-ORACLE'), pageFail = RE.filter((r) => r.page === 'FAIL');
  const unresolved = RE.filter((r) => (r.page === 'BUILT-NO-ORACLE' || r.page === 'FAIL') && r.guarded !== 'REFUSED');
  const changed = RE.filter((r) => r.guarded === 'CHANGED');
  const byPage = {}; for (const r of RE) byPage[r.page] = (byPage[r.page] ?? 0) + 1;
  add('Slider reach: every generatedParams slot of the pick-consumer scripts at its own min and max (draft angle, hollow wall, round and bevel size, box and cylinder size, pocket corners)', pageBuiltNoOracle.length + pageFail.length ? 'wrong' : 'supported', null,
    `${pageBuiltNoOracle.length + pageFail.length ? 'WRONG SOLID, NO SENTENCE. ' : ''}cmd: bun r3e-slot-sweep.mjs (r3-results/r3e-slot-sweep.json). ${RIG} ${RE.length} slot extremes over 9 scripts (round, bevel, hollow, draft, draft from bottom, cylinder rim round, pocket wall round, cylinder hollow, hollow open left). Page outcomes: ${JSON.stringify(byPage)}. BUILT-NO-ORACLE = the page builds and both OCCT and brep-rs refuse (the round-2 sweep printed these as NO-REFERENCE and moved on): ${pageBuiltNoOracle.length}; FAIL = page disagrees with a valid oracle: ${pageFail.length} (${[...pageFail].slice(0, 4).map((r) => `${r.k} ${r.slot} ${r.lbl}=${r.v}`).join(', ')}). Of those ${pageBuiltNoOracle.length + pageFail.length}, the guard layer refuses ${pageBuiltNoOracle.length + pageFail.length - unresolved.length} with a sentence; unresolved: ${unresolved.length}${unresolved.length ? ' (' + unresolved.slice(0, 4).map((r) => `${r.k} ${r.slot} ${r.lbl}=${r.v} ${r.page}`).join('; ') + ')' : ''}. Guard changed an otherwise valid build in ${changed.length} cases. Cases: draft1_angle at -89.5 and 89.5 on the 40x30x20 box (draft row), shell1_thickness 40 and box height 1 with wall 2 (hollow row), bevel box depth/height 1 with size 2 (bevel row), pocket corner sliders (bow-tie row). ${ABSENT}`,
    pageBuiltNoOracle.length + pageFail.length ? { requiredGuardSentence: RE.find((r) => r.k === 'D' && r.guardSentence)?.guardSentence, observedSentence: '(none: the page shows the clipped solid with no message)' } : {});
}

keep(35);
{
  const sd = (g) => RI.sd.find((x) => x.guard === g);
  const rimR = RIM.filter((x) => x.fn === 'round'), rimRbig = rimR.filter((x) => x.r >= 2), rimRsmall = rimR.filter((x) => x.r < 2), rimB = RIM.filter((x) => x.fn === 'bevel');
  keep(36, { requiredGuardSentence: sd('G-CONVEX').shellDraft.sentence, evidence: O(36).evidence + ` GUARD MEASURED (r3i-guards-elsewhere.mjs): the stepped union hollow open top (box 40x30x10 + 20x20x10 on top, wall 2) is built by the page at V=${f3(sd('G-CONVEX').pageV)} with ${sd('G-CONVEX').pageFaces} faces and no sentence; contract/shell-draft-translate.mjs (G-CONVEX, doc-level convexity of the history) refuses it with the sentence in requiredGuardSentence. r3-guard.mjs does NOT carry this guard; ${ABSENT}` });
  keep(37, { evidence: O(37).evidence + ` GUARD MEASURED (r3-guard.mjs G-RIM, rule: a fillet on an edge lying in the open face's plane with radius >= the wall of the preceding shell on the same body is refused; bevels are not affected): bun r2b-rim.mjs re-run through the layer: rounds r >= wall (2, 2.01, 2.1, 2.5, 3; 2 box positions x 4 edges): ${rimRbig.filter((x) => x.outcome === 'REFUSED').length}/${rimRbig.length} refused with the sentence; rounds below the wall (1.5, 1.99): ${rimRsmall.filter((x) => x.outcome === 'PASS').length}/${rimRsmall.length} still built and PASS; bevels 1.99..3: ${rimB.filter((x) => x.outcome === 'PASS').length}/${rimB.length} built and PASS (closed form, 1e-14). r = wall is refused although a few such cases are exact (conservative, because r = wall is position dependent). REGRESSION OVER THE EARLIER SCRIPTS: the layer was run over all ${CMP.cases} cases of the 19 secX/r2* scripts of this group (r3d-compare.mjs): it changed ${CMP.changed.length} outcomes, ${CMP.changed.filter((c) => /as large as or larger than the/.test(c.sentence ?? '')).length} of them rim rounds with r >= wall that the page built silently before (${CMP.changed.filter((c) => /as large as or larger than the/.test(c.sentence ?? '') && c.old === 'NO-REFERENCE').length} previously NO-REFERENCE builds), and changed no volume of any case it left built. The same-named guard G-RIM in contract/shell-draft-translate.mjs covers only the opposite order (round THEN hollow): r3i shows hollow-then-round 2.5 is BUILT by that translator too (V=${f3(sd('G-RIM').shellDraft.V)}, same as the page ${f3(sd('G-RIM').pageV)}). ${ABSENT}` });
  keep(38, { requiredGuardSentence: sd('G-HOLE').shellDraft.sentence, evidence: O(38).evidence + ` GUARD MEASURED (r3i-guards-elsewhere.mjs): the page builds hole(b,{across:6,at:[5,5],deep:8}) then hollow open top at V=${f3(sd('G-HOLE').pageV)} (${sd('G-HOLE').pageFaces} faces, exact answer 7152); contract/shell-draft-translate.mjs refuses it (${sd('G-HOLE').shellDraft.guard}) with the sentence in requiredGuardSentence. r3-guard.mjs does NOT carry this guard; ${ABSENT}` });
}
keep(39);
keep(40);

// ---- params
const pv = (k) => RC[k];
const pm = RC['param min>max'], pd = RC['param default above max'], ps0 = RC['param step 0'], psn = RC['param step negative'], psp = RC['param name with a space'], pdig = RC['param name starting with a digit'], pdash = RC['param name with a dash'];
add('param(name, value) in script text: the value drives the geometry on the page; declaration, each name used once, argument errors', 'supported', null,
  `cmd: bun secP.mjs, bun r3c-misc.mjs. param('w',40) -> namedParams {caption:'w', min:0, max:160, step:1, slots:['box1_width']}. Duplicate name: "param() already used the name "w" earlier in this script. Give each one its own name." Non-numeric value: "param's value has to be a number, and you gave it the text "abc"." Non-string name: "param() needs a name first: param("wall", 2). You gave it 5." Empty name: "${RC['param empty name'].errors[0]}" NaN bound: "${RC['param NaN min'].errors[0]}" Unknown option: "param has no option called "color". It takes min, max, step, caption." The page runs the script once at the declared value (bun r2i-page-param-rebuild.mjs: box built at 40). toScript(doc, namedParams) round-trips. This row is only the default value and the argument errors; the options and the validation gaps are the next two rows.`);
add('param(name, value, {min, max, step, caption}): the options on the PAGE (slider bounds, step, caption)', 'unsupported', null,
  `cmd: bun r2i-page-param-rebuild.mjs, bun r3c-misc.mjs. min, max, step and caption are accepted by the interpreter and carried in namedParams ({"name":"w","caption":"Width","value":40,"min":20,"max":80,"step":5,"slots":["box1_width"]}) but the page never shows a slider: the sandboxed runner calls runScript(withPreamble(code)) with no values (phase7/pane/src/runner-entry.mjs:14) and posts back only {source, runId, errors, doc}; namedParams/params/generatedParams never leave the iframe and pane.js has 0 hits for slider|namedParams|generatedParams|applyParam. So the bounds are ignored silently: round 2 listed this inside a 'supported' row, which overstated it.`);
add('param() argument validation: min greater than max, a default outside [min,max], step 0 or negative, a name with a space, dash or leading digit', 'unsupported', null,
  `cmd: bun r3c-misc.mjs (r3-results/r3c-misc.json). All accepted with NO sentence and carried to namedParams unchanged: min 50 > max 10 -> ${JSON.stringify(pm.namedParams[0])}; default 100 above max 30 -> value ${pd.namedParams[0].value} (box built at ${pd.size[0]}); default 5 below min 20 -> box built at ${RC['param default below min'].size[0]}; step 0 -> step ${ps0.namedParams[0].step}; step -5 -> step ${psn.namedParams[0].step}; step 50 on a 20..30 range accepted; min = max accepted. Names "my width", "2w", "w-1" are accepted (slots ${JSON.stringify(psp.named[0])}); runScript({values:{'my width':60}}) changes nothing (${JSON.stringify(psp.valuesByThatName)}) because values are keyed by SLOT name (box1_width), never by param name; a param named like a slot (box1_width) is applied through that slot (${JSON.stringify(RC['param reserved-looking name'].valuesByThatName)}). Only a NaN bound and an empty or non-string name give a sentence. The slider bounds a student could never reach (min > max) cannot be drawn. Out-of-range values written to a slot are also applied unclamped (secP: width 500 builds V=300000).`);
keep(42);
keep(43);
keep(44, { evidence: O(44).evidence + ` ROUND 3 NOTE: secG moved each slot to ONE changed value, not to the slot's own min and max (the round-2 critique is right that it could not see the draft1_angle result). The min and max of every slot of the ${new Set(RE.map((r) => r.k)).size} consumer scripts (round, bevel, hollow, draft, draft from bottom, cylinder rim round, pocket wall round, cylinder hollow, hollow open left) were swept in r3e-slot-sweep.mjs (${RE.length} extremes, see the slider-reach row). The slot extremes of the other ~20 scripts of secG were NOT swept.` });
keep(45);
keep(46);
keep(47);
{
  const rp = RC['rect param: namedParams'], rv = RC['rect param: values by key'];
  add('A param bound to a sketch rect dimension (sk2.rect(w, 8)): the slot named in namedParams (sk2_width) is not a generatedParams key', 'unsupported', null,
    `cmd: bun r3c-misc.mjs. const w=param('w',10,{min:4,max:30,step:1}); sk2.rect(w,8,{at:[18,14]}) -> namedParams ${JSON.stringify(rp.named)}; generatedParams keys of that sketch: ${rp.generatedKeys.join(', ')} (no sk2_width). runScript(src,{values:{sk2_width:20}}) -> outline unchanged (${JSON.stringify(rv.sk2_width.outline)}), errors []; values {w:20} -> unchanged too; only the corner keys move it (sk2_p0u:20 -> ${JSON.stringify(rv.sk2_p0u.outline)}). A 'w' slider would move nothing, and no sentence says so (the earlier param-in-an-expression row covers expressions but not this slot mismatch). Direct use on a box dimension binds fine (box(w,..) -> slot box1_width, which IS a key).`);
}
{
  const cs = RC['pocket corner sliders at min/max'], sw = RC['pocket bow-tie sweep'];
  const bad = [...cs, ...sw].filter((c) => c.page === 'FAIL');
  const p0 = sw.filter((c) => c.slot === 'sk2_p0u'), p1 = sw.filter((c) => c.slot === 'sk2_p1u');
  const guardOK = bad.filter((c) => c.guardedStatus === 'refused').length;
  add('Self-crossing (bow-tie) pocket or extrude sketch produced by a corner slider (sk2_p0u, sk2_p1u, ... offer -500..500)', 'wrong', null,
    `WRONG SOLID, NO SENTENCE. cmd: bun r3c-misc.mjs. ${RIG} Pocket 10x8x4 in a 40x30x10 plate. Slider extremes: ${cs.filter((c) => c.page === 'FAIL').length} of ${cs.length} corner-slot extremes cross the outline and are built with no sentence, 14 faces on SolidCraft against 11 on OCCT. Sweep sk2_p0u = 10, 20, 30, 40, 50, 60: ${p0.map((c) => `${c.page === 'PASS' ? 'ok ' + f3(c.scV) : 'CROSS ' + f3(c.scV) + ' vs OCCT ' + f3(c.occtV) + ' (' + c.scFaces + '/' + c.occtFaces + ' faces)'}`).join(' | ')}; sk2_p1u = -20, -5, 0, 5, 10, 20: ${p1.map((c) => `${c.page === 'PASS' ? 'ok' : 'CROSS ' + f3(c.scV) + ' vs ' + f3(c.occtV)}`).join(' | ')}. There is no valid solid for a crossing outline; both engines build different garbage (they disagree by up to ${f4(Math.max(...bad.map((c) => Math.abs(c.scV - c.occtV))))} mm3). GUARD MEASURED (r3-guard.mjs G-OUTLINE = contract/outline-guard.mjs selfTouch on every sketch the translator maps): ${guardOK}/${bad.length} crossing cases refused with a sentence; every non-crossing slider value in the sweep stays built. ${ABSENT}`,
    { requiredGuardSentence: [...cs, ...sw].find((c) => c.guardedStatus === 'refused')?.guardSentence, observedSentence: '(none: the page shows the pocket cut by the crossed outline)' });
}
{
  const o48 = O(48);
  const sc = RC['slot sk.chamfer'], sr = RC['slot sk.round'];
  add(o48.feature + ', and sketch corner chamfers (sk.chamfer(d1, d2))', 'unsupported', null, o48.evidence + ` ROUND 3 ADDITION (bun r3c-misc.mjs): sk.round(1,3) on a rect gives the slot sk1_r0 (${sr.generated.filter((n) => /_r\d/.test(n)).join(', ')}); sk.chamfer(1,3) stores the distance in the sketch (key "chamfers") but generatedParams lists no slot for it (${sc.generated.filter((n) => n.startsWith('sk1')).join(', ')}): a chamfer cannot be driven by a slider or by runScript({values}), while a round can.`);
}
keep(49, { evidence: O(49).evidence + ' ROUND 3 NOTE: the "found a round 2" text in the wrong-edge probe has the same defect as the multi-expectation row below: the message reports the nearest unmatched item, not the one that failed.' });
{
  const c1 = RC['checkModel single refused fillet'];
  add(O(50).feature + ' (single expected feature)', 'unsupported', null, O(50).evidence);
  const m = RC['checkModel x4 rim rounds'];
  add('checkModel with SEVERAL expected features of the same kind when some were refused (4 rim rounds expected, 2 or 3 refused)', 'unsupported', null,
    `cmd: bun r3c-misc.mjs. const q=pocket(...); round(q.rim(sk2),1) builds round1 and refuses ${m.refusedIds.join(', ')}; checkModel({expect:[4 x {kind:'fillet',size:1}]}, doc) with NO refusals map -> ${JSON.stringify(m.noRefusals)} (fail-open: passes a lesson whose rounds were not built); with the translator's refusals map -> passed:false, message "${m.pageRefusals.message}" and the same text with the plain-sentence refusals map. The message names no refusal and says "Expected a round 1, found a round 1." which is useless; the single-expectation probe is informative: "Expected a round 2; the round could not be built: <the translator's refusal text>" (wedge edge round). The round-2 row stated that checkModel "names the refusal" from its single-fillet probe only. Not wired in the page (checkModel: 0 hits in pane.js).`);
}
add('model-handles size, move and turn drag handles on UNMOVED, UNTURNED shapes (box width/depth/height, cylinder across/height, cone, sphere, ring tube, extrude height, datum offset, draft angle)', 'unsupported', null, O(51).evidence.replace(/Handle origin lies on the SolidCraft bbox extreme along its axis: 8\/8/, 'For unmoved, unturned shapes the handle origin lies on the SolidCraft bbox extreme along its axis: 8/8'));
keep(52);
{
  const hh = RC['box handles vs solid'];
  const mv = hh.find((x) => x.label === 'move x10'), mz = hh.find((x) => x.label === 'move z15');
  add('model-handles on a MOVED shape: box width/depth/height handles keep the pre-move position after move(b,[10,0,0]) or move(b,[0,0,15])', 'unsupported', null,
    `cmd: bun r3c-misc.mjs (r3-results/r3c-misc.json, SolidCraft bbox from the page translator). box(40,30,20): unmoved handles lie on the solid's extremes (width (20,0,0), depth (0,15,0), height (0,0,10); gap 0). move x10: SolidCraft bbox x -10..30, the width handle stays at ${JSON.stringify(mv.handles[0].origin)} (onExtreme ${mv.handles[0].onExtreme}: it is 10 mm inside the solid's +x face at x=30). move z15: bbox z 5..25, the width handle ${JSON.stringify(mz.handles[0].origin)} and the depth handle ${JSON.stringify(mz.handles[1].origin)} are ${mz.handles[0].gapToBbox} mm from the solid (gap to bbox), the height handle ${JSON.stringify(mz.handles[2].origin)} sits 15 mm below the new top (z=25). The solid itself is right (the param change matches OCCT); only the handle positions ignore move(), as they ignore turn() in the previous row. No sentence. Not wired in the page (handlesFor: 0 hits in pane.js).`);
}
keep(53);
keep(54);

// ---------------------------------------------------------------------------------------------------------------- checks
const CAVEAT = ' PICK-HIT CAVEAT: the picks in this rig are not the page running in a browser: the pick point comes from solidcraft topology read with the native solidcraft-cli (same engine fe3717f; the wasm rig run() returns only inspect.measure) and the bridge pick-hit test is EMULATED by lib.mjs pickEmu (interior point with the largest clearance, centroid hit) instead of solidcraft_doc::appearance::nearest_face on the display mesh; the page web crate was not driven here (phase7 browser verifiers were not re-run).';
for (const r of rows) if (/translate-p4|phase-7 translator/.test(r.evidence) && !/PICK-HIT CAVEAT/.test(r.evidence)) r.evidence += CAVEAT;
let errors = 0;
for (const r of rows) {
  const sents = [];
  if (r.status === 'refused') sents.push(r.refusalSentence);
  if (r.status === 'wrong' && r.requiredGuardSentence) sents.push(r.requiredGuardSentence);
  for (const s of sents) {
    const n = emittedN(s);
    if (!n) { errors++; console.log('NOT EMITTED BY THE LAYER:', r.feature.slice(0, 70), '=>', s); }
    else r.evidence += ` EMITTED: this sentence (ids and numbers aside) was produced by r3-guard.mjs ${n} time(s) in the live runs of r3-results/.`;
  }
}
const out = {
  group: 'picks-naming-params',
  translatorBasis: 'The statuses in this file describe the PAGE translator (docs/spikes/solidcraft-referee/phase7/pane/lib/translate-p4.mjs, exported to the page by phase7/pane/src/host-entry.mjs:6), plus the guard and plain-sentence layer in picks-naming-params.evidence/r3-guard.mjs that this group specifies and the page does not yet contain. A "refused" row means: the sentence in refusalSentence is what that layer emits for the cited cases (measured live); observedSentence is what the page shows today. A "wrong" row means: the page builds a solid with no sentence that a closed form or a live oracle shows is not the answer; requiredGuardSentence is what the layer emits instead. PICK-HIT CAVEAT: picks are measured with solidcraft topology from the native solidcraft-cli and an EMULATED bridge pick-hit test (lib.mjs pickEmu), not with the page web crate nearest_face in a browser. Contracts of other groups measured on other translators (phase0 translate.mjs, shell-draft-translate.mjs) are reconciled in "reconciliation".',
  reconciliation: [
    { topic: 'sequential rounds on edges that share a corner', thisFile: 'refused (page translator, rows: straight-sided rim, adjacent rounds)', otherFile: 'fillet-chamfer.json rows 14, 16, 17, 20, 24: supported (phase0 translator)', resolution: `r3h-reconcile.mjs: phase0 builds V=${f3(hAdj.phase0.V)} (${hAdj.phase0.faces} faces) for round top|front then top|right; sequential OCCT gives ${f3(hAdj.occt.V)} (${hAdj.occt.faces} faces), rel ${e1(Math.abs(hAdj.phase0.V - hAdj.occt.V) / hAdj.occt.V)}. For bevels phase0 = OCCT exactly (${f3(hBev.phase0.V)}). The page refuses both; the product is the page.` },
    { topic: 'triangular pocket rim', thisFile: 'refused after the first edge', otherFile: 'fillet-chamfer.json row 24: supported', resolution: `r3h-reconcile.mjs triangular pocket: phase0 builds all 3 rim edges (V=${f3(hTri.phase0.V)}, ${hTri.phase0.faces} faces); the page builds the first edge only. fillet-chamfer.json's own numbers for its pocket: 11601.514 vs simultaneous OCCT 11601.521.` },
    { topic: 'move() before a round', thisFile: 'refused (page)', otherFile: 'fillet-chamfer.json row 38: wrong (phase0 rounds the bottom edge of box(40,30,4) moved up by 2)', resolution: `r3h-reconcile.mjs: phase0 builds V=${f3(hMove.phase0.V)} with COM z ${f4(hMove.phase0.com[2])} against OCCT ${f4(hMove.occt.com[2])} (wrong edge); the page resolves the edge in the pre-move frame, finds it missing on the moved body and refuses (moves of 2, 3 and larger: r2h-move-turn.json). The phase0 defect does not reach a student.` },
    { topic: 'cone and wedge faces by word', thisFile: 'refused (page: resolve-names.mjs resolves box, cylinder and prism top/bottom only)', otherFile: 'shell-draft.json rows 5, 8, 51: supported (shell-draft-translate.mjs picks with brep-rs resolve)', resolution: `different pick resolvers (r3h-reconcile.mjs, cone(30,20) hollow open bottom: phase0 builds V=${f3(hCone.phase0.V)}, page refuses). The page is the product, so a student cannot reach the supported shell-draft cases until the page uses that resolver.` },
    { topic: 'draft crossing the opposite face', thisFile: 'wrong on the page; fixed by G-DRAFT', otherFile: 'shell-draft.json row 50: refused (G-VANISH in shell-draft-translate.mjs)', resolution: `r3h-reconcile.mjs draft 80 deg on the 40x30x20 box: the page AND the unguarded phase0 translator both build V=${f3(hDraft.page.V)} with ${hDraft.page.faces} faces (OCCT and brep-rs refuse). Same rule as G-VANISH (face count must be kept); the guard is in the shell-draft translator only. ` + ABSENT },
    { topic: 'bevel larger than the face beside the edge', thisFile: 'wrong on the page; fixed by G-BEVEL', otherFile: 'fillet-chamfer.json row 13: wrong (phase0)', resolution: `consistent (r3h-reconcile.mjs bevel 2 on 40x30x1: page and phase0 both build V=${f3(hThin.page.V)}, ${hThin.page.faces} faces; OCCT and brep-rs refuse): both translators build the clipped solid; no guard existed anywhere before r3-guard.mjs.` },
  ],
  rows,
};
writeFileSync(new URL('../picks-naming-params.json', import.meta.url), JSON.stringify(out, null, 1));
const c = {}; for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
console.log(`${rows.length} rows ${JSON.stringify(c)}; ${errors} sentence(s) not emitted by the layer`);
process.exit(errors ? 1 : 0);
