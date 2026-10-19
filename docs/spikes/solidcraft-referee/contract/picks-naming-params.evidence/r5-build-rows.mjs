// Round 5 (critic round 2): patch ../picks-naming-params.json. Idempotent (guarded by j.round5).
//   bun r5-build-rows.mjs        (needs r5-results/r5e-page-vs-guard.json, r5-results/guarded/r5d-cascade.json, r5-results/guarded/r5c-lib.json)
// What this round changes in the file (critic findings, all reproduced first, see r5a..r5f):
//   1. SHIPPED vs SPECIFIED: every row now carries shippedSentence (what the unmodified page shows a student today), specifiedSentence (what the contract guard
//      layer r3-guard.mjs emits; NOT in the page), shippedSentencePlain, guardInPage:false. refusalSentence is the SHIPPED text. A WRONG row stays wrong: the
//      guard is not in the page, so a student still gets that solid today.
//   2. new rows: stale handle after pocket()/groove(); round THEN hollow (r < wall supported, r >= wall wrong); first rim edge (supported) split from the rest
//      (refused); nested refusal cascade; negative-height cap names; checkModel greedy false negative; runScript({values}) sign/zero; handles measured for every kind.
//   3. label / vocabulary fixes: row 12 (swept is script-reachable), pageStatus / libraryStatus on rows 47-67, row 19 cross-reference, row 59 slot gaps.
import { readFileSync, writeFileSync } from 'node:fs';
const D = new URL('./r5-results/', import.meta.url).pathname;
const F = new URL('../picks-naming-params.json', import.meta.url).pathname;
const j = JSON.parse(readFileSync(F, 'utf8'));
if (j.round5) { console.log('already applied'); process.exit(0); }
const rd = (f) => JSON.parse(readFileSync(D + f, 'utf8'));
const r5e0 = JSON.parse(readFileSync(D + 'r5e-page-vs-guard.json', 'utf8'));
const idx = (p) => { const i = j.rows.findIndex((r) => r.feature.startsWith(p)); if (i < 0) throw new Error('row not found: ' + p); return i; };
const f4 = (v) => (typeof v === 'number' ? v.toFixed(4) : String(v));
const JARGON = /\.face\[|\.edge\[|\.cap\[|solid\.|phase 0|browser demo|\bb_\w+|F\d+:|solidcraft|not mapped|cannot be resolved|command list|matches \d+ (faces|separate)|names a set of|no longer present whole/i;
const RIG = 'ROUND 5 RIG: SolidCraft wasm pkg at SOLIDCRAFT_REFEREE_PKG (git archive of fe3717f, contract/RIG.md; wasm-bindgen CLI 0.2.128), bun 1.4.2, the page translator phase7/pane/lib/translate-p4.mjs UNCHANGED (phase7/pane/src/host-entry.mjs:6 exports it as is), live OCCT (replicad-opencascadejs) and live brep-rs (archive/brep-rs/pkg).';
const cmd = 'SOLIDCRAFT_REFEREE_PKG=<pkg> R3_OUT=<dir> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun';

// ------------------------------------------------------------------------------------------------ 1. shipped vs specified on every existing row
const none = (s) => typeof s !== 'string' || /^\(none/.test(s) || s === '';
let nPlain = 0, nJargon = 0, nSilent = 0, nSpecOnly = 0;
for (const r of j.rows) {
  const wasRefused = r.status === 'refused';
  const spec = wasRefused ? r.refusalSentence : (r.requiredGuardSentence ?? null);
  const obs = none(r.observedSentence) ? null : r.observedSentence;
  if (wasRefused) {
    // rows 6, 29, 33 have no observedSentence: those sentences are the INTERPRETER's own script errors, which the page does show verbatim.
    const shipped = obs ?? spec;
    r.specifiedSentence = spec; r.shippedSentence = shipped; r.shippedSentencePlain = !JARGON.test(shipped ?? '');
    r.guardInPage = shipped !== spec ? false : null;
    r.refusalSentence = shipped;
    if (shipped !== spec) nSpecOnly++;
    if (r.shippedSentencePlain) nPlain++; else nJargon++;
    r.evidence = `[SHIPPING PAGE TODAY] refused; the student sees: "${shipped}"${r.shippedSentencePlain ? '' : ' (NOT plain: engine / ModelDoc jargon)'}. ${shipped !== spec ? `[CONTRACT GUARD LAYER, contract/ only, NOT in the page] would show: "${spec}". ` : '(this sentence is already shipped.) '}` + r.evidence;
  } else if (r.status === 'wrong') {
    r.specifiedSentence = spec; r.shippedSentence = null; r.shippedSentencePlain = null; r.guardInPage = false; r.refusalSentence = null;
    nSilent++;
    r.evidence = `[SHIPPING PAGE TODAY] WRONG SOLID, NO SENTENCE: a student still gets this solid today. [CONTRACT GUARD LAYER, contract/ only, NOT in the page] would refuse it with: "${spec}". ` + r.evidence;
  }
  r.pageStatus = r.status;
}

// ------------------------------------------------------------------------------------------------ 2. label / vocabulary fixes on existing rows
{
  const i = idx('[ModelDoc-level only, no script text produces it] TopoName cause swept');
  j.rows[i].feature = 'TopoName cause swept: a straight sketch edge of a plain extrude. REACHABLE FROM SCRIPT TEXT only as the wall member of part.wall(sk,n) / part.rim(sk) edge names (rows "shape.edge(top, wall n)" below, pull2.face[sk2.edge1] in the page text); as a shell open face, a draft face or in edge(cap, swept) / edge(swept, swept) of a pull() it is ModelDoc-level only (no script text produces it)';
  j.rows[i].evidence += ' ROUND 5 LABEL FIX: the earlier label said "no script text produces it" for the whole row, which was false for swept; reachability (r2a-reach.mjs) was always "swept (2, always as the wall member of part.wall()/part.rim() edge names)". carried and between are script-reachable too (their rows never carried the label). Only cap, rounded, split and made are ModelDoc-only. The status is unchanged.';
  const k = idx('pick of a consumed target');
  j.rows[k].feature += ' (pocket(), groove() and hole() are NOT in this list: the page lets a pick follow them silently; see the row "pick on a STALE handle after pocket()")';
  const c = idx('hollow(shape,{open:word}) on a shape with a reflex edge');
  void c;
}
{
  const B = ' ROUND 5 BOUND: a round of the open face\'s OWN rim made BEFORE the hollow is right only for r < wall (rows "round(edge of the open face, r) THEN hollow ..."): at or past the wall the page builds a degenerate or oversized solid with no sentence.';
  for (const p of ['TopoName cause carried', 'Consumers of picks inside their size limits']) { const i = idx(p); j.rows[i].evidence += B; }
  const w = idx('WRONG, SILENT: round(edge) of the rim of a hollowed part'); j.rows[w].evidence += ' ROUND 5: this row is the order hollow THEN round. The order round THEN hollow has its own rows (supported below the wall, wrong at or past it); r3-guard.mjs now refuses both (G-RIM here, G-RIMFIRST there).';
}
{
  const i = idx('TopoName cause carried: a planar face carried through hole');
  j.rows[i].evidence += ' ROUND 5 NARROWING: the sub-case "carried through round + open +x" (round(b.edge(top,right),2) then hollow wall 2 open right, SolidCraft 8166.2309 = closed form 8166.2301, no second kernel) has the round EQUAL to the wall on the open face\'s own rim: a zero-width knife-edge rim. It is NOT claimed supported any more; r3-guard.mjs G-RIMFIRST refuses it (the only line that changed in the 19-script regression, secC2.log "carried +x across round": NO-REFERENCE -> REFUSED with the sentence of the row "round THEN hollow ... r AT OR PAST the wall"). The page still builds it. Carried-through-round with the open face NOT on the rounded edge (open front, V=7846.2309 vs brep-rs 7846.2478) is unchanged.';
}
{
  const r43 = r5e0.find((x) => /stepped union/.test(x.label)), r43b = r5e0.find((x) => /notch subtract/.test(x.label)), r45 = r5e0.find((x) => /row 45/.test(x.label)), c1 = r5e0.find((x) => /through hole then hollow/.test(x.label)), c2 = r5e0.find((x) => /plain box hollow/.test(x.label));
  const T = (x) => `page ${f4(x.page.sc)} (${x.page.faces} faces) -> guarded ${x.guarded.outcome}`;
  const add43 = ` ROUND 5 (guard now in r3-guard.mjs as G-CONVEX, imported from shell-draft-translate.mjs convexity(); the old line "EMITTED ... produced by r3-guard.mjs" above was wrong for this row, r3-guard.mjs did NOT carry the guard until now, and the guarded run of row 45 returned 7711.1504 unrefused). cmd: ${cmd} r5e-page-vs-guard.mjs (r5-results/r5e-page-vs-guard.log): stepped union hollow open top: ${T(r43)}, OCCT ${f4(r43.oracle.occt)}; notch subtract hollow open bottom: ${T(r43b)}, OCCT ${f4(r43b.oracle.occt)}; blind hole then hollow: ${T(r45)} (OCCT shell skipped 23773.8053, brep-rs refuses); controls that must stay built: through hole then hollow top ${c1.page.outcome} ${f4(c1.page.sc)} vs OCCT ${f4(c1.oracle.occt)} -> guarded ${c1.guarded.outcome} ${f4(c1.guarded.sc)}, plain box hollow ${c2.page.outcome} ${f4(c2.page.sc)} -> guarded ${c2.guarded.outcome}. The sentences are the shell-draft group's (requiredGuardSentence of this row and of the blind-hole row). Still ABSENT FROM THE PAGE: the page builds all three today.`;
  for (const pfx of ['hollow(shape,{open:word}) on a shape with a reflex edge', 'WRONG, SILENT: hollow(open:\'top\') of a part with a BLIND hole']) { const i = idx(pfx); j.rows[i].evidence += add43; }
}
const LIB = {
  'topoRefs()': ['supported', 'bun secJ.mjs: pure ModelDoc functions, results listed in the row'],
  'param(name, value, {min': ['supported', 'bounds, step and caption are accepted and carried into namedParams (bun r2i-page-param-rebuild.mjs, r3c-misc.mjs)'],
  'param() argument validation': ['wrong', 'accepted with NO sentence (min > max, default outside the range, step <= 0, names with spaces): bun r3c-misc.mjs'],
  'applyParam / runScript({values})': ['supported', '21 of 22 variants PASS vs OCCT and brep-rs, 1 honest refusal (bun secE.mjs, secP2.mjs); out-of-range and signed values: see the row "runScript({values}) with a negative or zero value"'],
  'param value used inside an expression': ['wrong', 'the declared param gets slots [] so its slider would move nothing, with no sentence (bun secP.mjs)'],
  'generatedParams slot keys': ['supported', '245 of 288 slot writes PASS vs OCCT/brep-rs; the rest are the dead / refused slots in the rows below (bun secG.mjs)'],
  'generatedParams slots prism1': ['wrong', 'dead sliders: applyParam leaves the doc unchanged (bun secG.mjs, exp3.mjs)'],
  'generatedParams slots hole1_counterbore': ['unsupported', 'the slots exist in the library; the solid is refused by the translator'],
  'generatedParams slots pat1_totalangle': ['unsupported', 'refused by the translator'],
  'A param bound to a sketch rect dimension': ['wrong', 'the slot named in namedParams is not a generatedParams key, so the slider moves nothing and no sentence says so (bun r3c-misc.mjs)'],
  'Numeric feature fields with no generatedParams slot': ['unsupported', 'the library has no slot for these fields (bun exp6.mjs, r3c-misc.mjs, r5c-lib.mjs)'],
  'checkModel / ModelExpect': ['wrong', 'order-dependent false negative in the greedy matcher: see the row "checkModel greedy distinct matching" (r5c-lib.mjs); everything else in the row measured right (secH.mjs)'],
  'checkModel with SolidCraft refusals': ['wrong', 'fail-open unless the host passes the translator refusals map (secH.mjs)'],
  'checkModel with SEVERAL expected features': ['wrong', 'fail-open without the refusals map; message "Expected a round 1, found a round 1." (r3c-misc.mjs)'],
  'model-handles size, move and turn drag handles on UNMOVED': ['supported', '32/32 size drags, 35/36 move drags (the 1 is torus tessellation), 9/9 turn drags PASS vs OCCT (secI.mjs, secI2.mjs)'],
  'model-handles on a turned shape': ['wrong', 'handle positions ignore the rotation (secI.mjs)'],
  'model-handles on a MOVED shape': ['wrong', 'handle positions ignore move() (r3c-misc.mjs)'],
  'model-handles sketch corner point handles': ['supported', '28/28 corner drags PASS vs OCCT (secI2.mjs)'],
  'model-handles: no handles for prism': ['unsupported', 'MEASURED in round 5 for every named kind (r5f-handles.mjs): no handle on the feature itself; see the evidence'],
};
for (const r of j.rows) {
  const hit = Object.entries(LIB).find(([p]) => r.feature.startsWith(p) || r.feature.includes(p));
  if (hit && ['unsupported', 'refused', 'wrong'].includes(r.status) && j.rows.indexOf(r) >= idx('topoRefs()')) {
    r.libraryStatus = hit[1][0]; r.libraryEvidence = hit[1][1];
    r.evidence = `[SCOPE] pageStatus=${r.pageStatus} (the SolidCraft page does not wire this: pane.js has 0 hits for slider|namedParams|generatedParams|applyParam|checkModel|handlesFor); libraryStatus=${r.libraryStatus} (the ModelDoc library measured on its own, truck builds the geometry it produces): ${r.libraryEvidence}. ` + r.evidence;
  }
}
{
  const i = idx('model-handles: no handles for prism');
  j.rows[i].feature = 'model-handles: which feature kinds get drag handles (MEASURED for prism, wedge, hole, hollow, join, subtract, repeat, repeatAround, mirror, groove, revolve, round, bevel, draft)';
  j.rows[i].evidence += ' ROUND 5 MEASURED (bun r5f-handles.mjs, r5-results/r5f-handles.log; handlesFor(feature, doc) for every feature of a one-feature script): prism 0 handles, wedge 0; hole, hollow, repeat, repeatAround, mirror each add NO handle of their own (the base box keeps its 6: size width/depth/height and move x/y/z; no hole diameter / depth / position handle, no wall handle, no count or step handle); join 12 and subtract 11 are the two operands\' own handles, none for the join itself; groove: the box 6 plus 4 sketch corner points, no angle handle; revolve: 4 sketch corner points only, no angle handle; round and bevel add one radius handle each and BOTH are labelled "round edge" (the bevel handle is mislabelled); draft adds one "draft angle" size handle. So the row\'s earlier "not probed" is closed: those kinds have no handle, no sentence.';
}
{
  const i = idx('Numeric feature fields with no generatedParams slot');
  j.rows[i].evidence += ' ROUND 5 ADDITIONS (bun r5c-lib.mjs, r5-results/r5c-lib-summary.json): pocket(sk2, p, 4, {taper: 5}) stores {depth: 4, taper: 5} and generatedParams lists pocket1_depth but NO taper slot (identical slot list to the plain pocket); extrude(sk1, 10, {direction: [0.2, 0, 1]}) stores the vector and lists only pull1_height (no direction slot); extrude taper and length2 re-confirmed (stored, no slot). The critic\'s list is therefore complete: extrude taper, extrude length2, extrude direction, pocket taper, draft neutral, hole axial offset, blend, sketch chamfer distance.';
  j.rows[i].feature = 'Numeric feature fields with no generatedParams slot: extrude taper / length2 / direction vector, pocket taper, draft neutral, hole axial offset, blend, and sketch corner chamfers (sk.chamfer(d1, d2))';
}
{
  const i = idx('checkModel / ModelExpect lesson checks');
  j.rows[i].evidence += ' ROUND 5: the "greedy distinct match" in this row\'s title is order dependent and gives a false negative; measured in the next row.';
}

// ------------------------------------------------------------------------------------------------ 3. new rows
const newRows = [];
const add = (after, row) => newRows.push({ after, row });
const mk = (o) => ({ refusalSentence: null, specifiedSentence: null, shippedSentence: null, shippedSentencePlain: null, guardInPage: false, pageStatus: o.status, ...o });

// 3a. stale handle after pocket / groove
{
  const g = (f) => rd('guarded/' + f);
  add('pick of a consumed target', mk({
    feature: 'pick on a STALE handle after pocket() or groove() whose result was not captured: pocket(sk2, p, 4); round(p.edge(\'top\',\'front\'), 1) (also bevel, hollow(p, ...), draft(p.face(...), ...) on p)',
    status: 'wrong',
    specifiedSentence: 'round1 is not built: pull1 was already cut by pocket1, so this round would not include the cut -- keep the result of the cut under a name (for example part = pocket(...)) and pick on that instead.',
    evidence: `[SHIPPING PAGE TODAY] WRONG SOLID, NO SENTENCE. [CONTRACT GUARD LAYER G-STALE, r3-guard.mjs, NOT in the page] refuses with the specified sentence. ${RIG} cmd: ${cmd} r5a-stale.mjs (script text: 40x30 plate extruded 10, 10x10 pocket of depth 4 in a top-plane sketch at z=10; p is the extrude, the pocket result is NOT assigned). The page re-targets the pick onto the pocketed part (head advance; pocket, groove and hole are exempt from the "already changed in place" refusal that join, mirror and subtract get), while the ModelDoc has round1.target = pull1 and pocket1.into = pull1, a dead branch, which is what OCCT and brep-rs build. round top|front r1: SolidCraft 11591.4103 (12 faces, the pocketed part rounded) vs OCCT 11991.4159 = brep-rs 11991.4159 (7 faces) dVol 3.3e-2; hollow(p,{wall:1,open:'bottom'}): SolidCraft 2600.0000 (21 faces) vs OCCT 2424.0000 = brep-rs 2424.0000 (11 faces); draft(p.face('right'),5): SolidCraft 11468.7670 (11 faces) vs OCCT 11868.7670 = brep-rs 11868.7670 (6 faces); groove(sk, b, 180) on a 40x40x20 box then round(b.edge('top','front'),1): SolidCraft 31488.7696 (10 faces) vs OCCT 31991.4159 = brep-rs 31991.4159 (7 faces). The critic's own instance (pocket of another size) gave 11751.41 vs 11991.42, hollow bottom 2568 vs 2424, draft right 5 11760 vs 12000, groove then round 31312.86 vs 31991.42: same pattern, different pocket, not re-run with the critic's exact pocket. CONTROLS (the result IS captured, q = pocket(...) / groove(...), pick on q): round PASS 11591.4103 vs 11591.4159 (4.9e-7), draft PASS 11468.7670 exact, groove then round PASS 31488.7696 vs 31488.7611 (2.7e-7); the captured hollow control is the separate known reflex-edge WRONG row (2600 vs 2586.9). hole() uncaptured then round is NOT wrong: SolidCraft 11956.0690 vs OCCT = brep-rs 11956.0730 (3.3e-7) because the hole is in place in the ModelDoc too. join() uncaptured is refused by the page ("its target box1 was already changed in place by op1"), see the consumed-target row. GUARD MEASURED (bun r3-run-sec.mjs r5a-stale.mjs, r5-results/guarded/r5a-stale.log): the 4 stale cases (round, hollow, draft, groove+round) REFUSED with the sentence above (names filled in); the 4 captured controls, uncaptured hole and uncaptured join unchanged. Which reading of the script is "right" is the language's call; either way a silent re-target gives a solid the student did not ask for. GUARD ABSENT FROM THE PAGE.`,
  }));
}

// 3b. round THEN hollow
{
  const r5b = rd('r5b-roundhollow.json');
  const pick = (re) => r5b.find((x) => re.test(x.label));
  void pick;
  add('Consumers of picks inside their size limits', mk({
    feature: 'round(edge of the open face, r) THEN hollow(wall t, open that face) with r STRICTLY BELOW the wall (r < t), and bevel(edge of the open face, d) THEN hollow at any d',
    status: 'supported',
    evidence: `${RIG} cmd: ${cmd} r5b-roundhollow.mjs (script text: b = cuboid(40,30,20); round(b.edge('top','front'), r); hollow(b, {wall: 2, open: 'top'})). Independent closed form (plane-offset cavity, open top): V = 24000 - (1-pi/4) r^2 40 - 36*26*18 + air(r,t), air = 0 for r <= t. r=0.5: SolidCraft 7149.8508 vs brep-rs 7149.8540 = closed form 7149.8540 (4.4e-7, 12 faces both); r=1: 7143.4103 vs 7143.4159 (7.9e-7); r=1.5: 7132.6732 vs 7132.6858 (1.8e-6); r=1.9: 7120.9912 vs 7121.0115 (2.9e-6). OCCT does not build this hollow (its own refusal: "this kernel cannot hollow a shape that already has a hole or a round"; the shape it shows is the unhollowed 23997.85), so the references are brep-rs and the closed form, two independent computations that agree with each other to 1e-6. Bevel THEN hollow, d=1/2/3: SolidCraft = OCCT = brep-rs 7192.1766 / 7216.0000 / 7235.8234 (13 faces all three, dVol <= 2.1e-15). The order hollow THEN round of the rim is the existing rim-round rows (right below the wall, wrong at or past it). The critic found no bound on this order; the bound is r < t (next row).`,
  }));
  add('Consumers of picks inside their size limits', mk({
    feature: 'round(edge of the open face, r) THEN hollow(wall t, open that face) with r AT OR PAST the wall (r >= t): the order that the hollow-then-round WRONG row does not cover',
    status: 'wrong',
    specifiedSentence: 'shell1 is not built: the open edge of the part was rounded with a radius of 3, which is as large as or larger than the 2 mm wall, so the rim would have no thickness -- make the round smaller than the wall.',
    evidence: `[SHIPPING PAGE TODAY] WRONG SOLID, NO SENTENCE. [CONTRACT GUARD LAYER G-RIMFIRST, r3-guard.mjs, NOT in the page] refuses with the specified sentence. ${RIG} cmd: ${cmd} r5b-roundhollow.mjs. Box 40x30x20, round(b.edge('top','front'), r), hollow wall 2 open top. r=2 (equal to the wall): SolidCraft 7117.6412 (12 faces) = closed form 7117.6637 (3.2e-6) but with a zero-width knife-edge rim, a degenerate solid; r=2.5: 7136.2640 vs closed form 7098.6514 (+5.3e-3, 14 faces); r=3: 7154.4455 vs closed form 7076.7781 (+1.1e-2, 14 faces), which is MORE material than the un-rounded hollow (7152): impossible for a rounded body hollowed with the same wall. Both oracles refuse every one of these (OCCT: "cannot hollow a shape that already has a hole or a round"; brep-rs: "cannot hollow shell1 yet"), so there is no valid second kernel and the status rests on the closed form plus the impossibility argument (volume above the un-rounded hollow). GUARD MEASURED (bun r3-run-sec.mjs r5b-roundhollow.mjs, r5-results/guarded/r5b-roundhollow.log): r = 2, 2.5, 3 REFUSED with the sentence (numbers filled in); r = 0.5, 1, 1.5, 1.9 and the three bevels unchanged (PASS). RECONCILIATION: shell-draft.json rows 12 and 43 (G-ROUND / G-RIM in shell-draft-translate.mjs) already refuse this order for r >= wall; r3-guard.mjs's old G-RIM covers the OPPOSITE order (hollow THEN round, row "WRONG, SILENT: round(edge) of the rim of a hollowed part"); the two guards carry the same name for opposite orders. After this round r3-guard.mjs refuses both (G-RIM and G-RIMFIRST). GUARD ABSENT FROM THE PAGE: the page builds all three today.`,
  }));
}

// 3c. first rim edge supported, rest refused (split of the old partial row), plus the nested cascade
{
  add('part.wall / part.rim / edge(top, wall) of a CIRCULAR', mk({
    feature: 'part.rim(sketch) with round()/bevel(): the FIRST rim edge of a straight-sided pocket (rectangular, triangular, deep, flush and through pockets); the page builds exactly this edge and nothing else of the list',
    status: 'supported',
    evidence: `${RIG} cmd: bun r2f-rim.mjs (re-run in the regression, r5-results/regress/r2f-rim.log). The first edge is correct: rect 10x10 depth 4 r1 on the 40x30x10 plate: SolidCraft after the first edge 11597.8526 vs OCCT single-edge round 11597.8540 (1.2e-7); bevel 1: 11595.0000 exact. IT IS A PARTIAL RESULT: the solid shown has 1 of the 4 rim edges rounded (3 of 3 for the triangle), and every other edge of the list is refused with a sentence (next two rows), so the whole feature is NOT built; the earlier row that held all of this under one 'refused' status is split into these three statuses so none of them is misread.`,
  }));
  const c = rd('guarded/r5d-cascade.json');
  const o = rd('r5d-cascade.json');
  const rect = o[0], rectG = c[0];
  const rawText = (o0, id) => o0.features.find((f) => f.id === id)?.refusal;
  const plainText = (o0, id) => o0.features.find((f) => f.id === id)?.refusal;
  add('part.rim(sketch) with round()/bevel() of the whole list', mk({
    feature: 'part.rim(sketch) round()/bevel(): rim edges 3 and 4 of the list (2 for a triangle) are reported with the earlier refusal NESTED inside each later one ("its target round3 was refused (round2 (...))")',
    status: 'refused',
    refusalSentence: rawText(rect, 'round4'), specifiedSentence: plainText(rectG, 'round4'), shippedSentence: rawText(rect, 'round4'),
    shippedSentencePlain: false,
    evidence: `[SHIPPING PAGE TODAY] refused; the student sees, for round3: "${rawText(rect, 'round3')}" and for round4: "${rawText(rect, 'round4')}" (NOT plain; the text grows by one level per later edge; the triangle's round3 shows one level). [CONTRACT GUARD LAYER, NOT in the page] shows for round3: "${plainText(rectG, 'round3')}" and for round4: "${plainText(rectG, 'round4')}". ${RIG} cmd: ${cmd} r5d-cascade.mjs (page) and r3-run-sec.mjs r5d-cascade.mjs (guarded); logs r5-results/r5d-cascade.log, r5-results/guarded/r5d-cascade.log. The earlier row's 'one plain sentence per edge' described round2 only (the engine text for the corner-sharing edge, plain in the guard layer); rounds 3 and 4 are cascade text, and the guard layer's cascade rule names the failed predecessor, not the root cause (round2).`,
  }));
}

// 3d. negative-height cap
{
  const o = rd('r5c-lib.json');
  const find = (re) => o.find((x) => re.test(x.label));
  const a = find(/h=-12 cap top as hollow/), b = find(/h=-12 round between\(cap top/);
  add('[ModelDoc-level only, no script text produces it] TopoName cause cap', mk({
    feature: '[ModelDoc-level only] TopoName cause cap (top|bottom) on an extrude with a NEGATIVE height (extrude(sk, -8)): hollow open cap[top] / cap[bottom], round between(cap, swept)',
    status: 'refused',
    refusalSentence: a?.sentence ?? null, shippedSentence: a?.sentence ?? null, shippedSentencePlain: false,
    specifiedSentence: 'sh1 is not built: this shape was extruded downward (negative height), and its top and bottom caps cannot be picked by name yet -- extrude upward with a positive height instead.',
    evidence: `[SHIPPING PAGE TODAY] refused; the student (studio / bridge ModelDoc, not script text) sees: "${a?.sentence}" and for the round: "${b?.sentence}" (NOT plain). [CONTRACT GUARD LAYER r3-guard.mjs plain rule, NOT in the page] would show: "sh1 is not built: this shape was extruded downward (negative height), and its top and bottom caps cannot be picked by name yet -- extrude upward with a positive height instead." ${RIG} cmd: ${cmd} r5c-lib.mjs. ModelDoc extrude of a 40x25 rectangle, height 12 vs -12, shell thickness 2 open cap top / bottom, round 2 between(cap, swept1): height +12 PASS (hollow 4440.0000 exact both caps; rounds 11978.5257 vs 11978.5398, 1.2e-6); height -12: all four REFUSED although OCCT and brep-rs build them (4440.0000 and 11978.5398), because the resolver looks for the cap at sketch plane + height with an upward normal. This is a coverage gap, never a wrong solid. The draft of swept1 on the negative extrude PASSes (12157.4796 exact). Script text is NOT affected: extrude(sk1, -8) then hollow(e,{wall:1,open:'top'|'bottom'}) PASS 2152.0000 exact (face words are primitive names), round(e.edge('top','front'),1) and ('bottom','front') PASS 9591.4103 vs 9591.4159, draft(e.face('right'),5) PASS 9683.9891 exact.`,
  }));
}

// 3e. checkModel greedy, 3f. values sign
{
  const s = rd('r5c-lib-summary.json');
  add('checkModel / ModelExpect lesson checks', mk({
    feature: 'checkModel greedy distinct matching is ORDER DEPENDENT: expect [{kind:\'box\'},{kind:\'box\',width:40}] FAILS against a doc with a 40-wide box and a 10-wide box, while the reversed order passes [library level only]',
    status: 'unsupported', libraryStatus: 'wrong', libraryEvidence: 'false negative against an independent matcher (r5c-lib.mjs)',
    evidence: `[SCOPE] pageStatus=unsupported (checkModel is not called by the page), libraryStatus=wrong: a correct student model is judged wrong depending on the order the lesson author wrote the expectations. Rig: contract/RIG.md. cmd: bun r5c-lib.mjs (r5-results/r5c-lib-summary.json). Doc: box(40,30,20) and box(10,10,10,{at:[60,0,0]}). checkModel({expect:[{kind:'box'},{kind:'box',width:40}]}) -> ${JSON.stringify(s.checkModel.expectAnyThenWidth40)}; the reversed order {width:40} then {} -> ${JSON.stringify(s.checkModel.expectWidth40ThenAny)}. An independent matcher (all permutations of the boxes against the expectations, each pair tested through checkModel on a one-feature doc) says the expectations ARE satisfiable: ${s.checkModel.independentBipartiteMatch}. The cause is the loop in model-check.ts (each entry claims the FIRST unused feature that matches; the unconstrained {kind:'box'} claims the 40-wide box, so the width-40 entry has nothing left). The failure message ("Expected a box 40 x ? x ?, found a box 10 x 10 x 10.") also names the wrong box. A 3-expectation probe over 6 orders (box, box width 10, box width 10 depth 20 against three boxes) failed ${s.checkModel3.failingOrders} orders, so it needs a lesson with a loose entry before a tight one that both fit the same feature. The earlier row listed "greedy distinct match" as a supported behaviour; it is supported only when the entries are ordered most specific first.`,
  }));
  add('applyParam / runScript({values})', mk({
    feature: 'runScript({values}) with a NEGATIVE or ZERO value for a size slot (values keyed by slot name: {box1_width: -5}, 0, -40) [library level only]',
    status: 'unsupported',
    evidence: `[SCOPE] pageStatus=unsupported (the page never passes values), libraryStatus=accepted without a sentence; the references DISAGREE, so no result is blessed. Rig: contract/RIG.md. cmd: ${cmd} r5c-lib.mjs, script const w = param('w', 40, {min:20, max:80, step:5}); box(w, 30, 20), values {box1_width: v}. v=40: 24000.0000 PASS; v=5: 3000.0000 PASS (OCCT = brep-rs); v=0: REFUSED by the page translator with the raw engine text "box1 (box): solidcraft refused it -- solid.box: invalid input: box needs a positive size in x, y and z" (brep-rs: "builds an empty solid"); v=-5: SolidCraft 3000.0000 = OCCT 3000.0000 (a 5 mm box: the sign is dropped) but brep-rs 1000.0000, refs disagree by 6.7e-1; v=-40: SolidCraft 24000.0000 = OCCT 24000.0000, brep-rs 8000.0000. So a negative slider value is applied with no clamp and no sentence, and the oracles do not agree on what it means; the earlier row only covered 500 and mentioned -5 in passing. Zero is refused with jargon. Param bounds (min/max) are not enforced by runScript either (row on param validation).`,
  }));
}

// 3g. the six WRONG rows re-measured on the shipping page
const r5e = rd('r5e-page-vs-guard.json');
const pageToday = r5e.filter((x) => !x.scriptError).map((x) => ({
  case: x.label, script: x.src,
  pageToday: { outcome: x.page.outcome, volume: x.page.sc, faces: x.page.faces, sentence: x.page.sentence ?? null },
  withContractGuard: { outcome: x.guarded.outcome, volume: x.guarded.sc, sentence: x.guarded.sentence ?? null },
  occt: x.oracle.occt, occtFaces: x.oracle.occtFaces, occtRefusals: x.oracle.occtRefusals, brepRs: x.oracle.brep, brepFaces: x.oracle.brepFaces, brepRefusals: x.oracle.brepRefusals,
}));

// insert
for (const { after, row } of newRows) {
  const i = idx(after);
  j.rows.splice(i + 1, 0, row);
}

// 4. row 31 text: now the REMAINDER
{
  const i = idx('part.rim(sketch) with round()/bevel() of the whole list');
  j.rows[i].feature = 'part.rim(sketch) with round()/bevel(): rim edges 2.. of the list on a STRAIGHT-SIDED pocket (rectangular, hexagonal, triangular, deep, through and flush pockets); edge 1 is built (row above), the rest are refused';
  j.rows[i].evidence = '[SPLIT IN ROUND 5: edge 1 of the list is the supported row above; this row is edges 2.. only.] ' + j.rows[i].evidence;
}

// 5. reconciliation + summary
j.reconciliation.push({
  topic: 'round THEN hollow of the open face\'s own rim',
  thisFile: 'wrong on the page for r >= wall (r=2 knife edge 7117.6412, r=2.5 7136.2640, r=3 7154.4455, more than the un-rounded hollow 7152); supported for r < wall (4/4 equal to brep-rs and the closed form); bevel then hollow supported 3/3',
  otherFile: 'shell-draft.json rows 12 and 43: refused for r >= wall (G-ROUND / G-RIM in shell-draft-translate.mjs, whole-shape and single-edge round)',
  resolution: 'same family, same rule. The two guard files used the name G-RIM for OPPOSITE orders (shell-draft: round THEN hollow; r3-guard.mjs: hollow THEN round). r3-guard.mjs now has both (G-RIM, G-RIMFIRST), r5b-roundhollow.mjs. The page has neither; shell-draft-translate.mjs is not what the page runs.',
});
j.reconciliation.push({
  topic: 'which translator a number belongs to',
  thisFile: 'page translator (translate-p4, unchanged) for every status; guard layer only as specification',
  otherFile: 'shell-draft.json / extrude-pocket.json / fillet-chamfer.json state their own translators in their notes',
  resolution: 'since round 5 every row of this file carries shippedSentence / specifiedSentence / guardInPage. refusalSentence is the SHIPPED text. pageToday below is the page and the guard run side by side on the critic\'s WRONG rows.',
});
j.shippedVsSpecified = {
  statement: 'The SolidCraft page runs translate-p4.mjs unchanged: none of the guards (G-DRAFT, G-HOLLOW, G-BEVEL, G-DRAFTWALL, G-RIM, G-RIMFIRST, G-STALE, G-OUTLINE) and none of the plain sentences is in the page (grep of phase7/pane/lib, pane.js and bundle/host-lib.js for G-VANISH|G-THICK|G-ANGLE|G-OUTLINE|selfTouch: 0 hits). A "wrong" row is therefore a solid a student gets TODAY; a "refused" row is refused today in the shipped text (refusalSentence), which is often jargon (shippedSentencePlain false); specifiedSentence is what the contract guard layer in contract/ emits and what the page has to adopt.',
  refusedRows: j.rows.filter((r) => r.status === 'refused').length,
  refusedWithPlainShippedSentence: j.rows.filter((r) => r.status === 'refused' && r.shippedSentencePlain === true).length,
  refusedWithJargonShippedSentence: j.rows.filter((r) => r.status === 'refused' && r.shippedSentencePlain === false).length,
  wrongRowsStillReachableByAStudentToday: j.rows.filter((r) => r.status === 'wrong' && r.pageStatus === 'wrong' && !/\[library level only\]/.test(r.feature)).length,
  pageToday,
};
j.round5 = {
  rig: RIG,
  critic: 'round 2: guard layer exists only in contract/ scripts; stale handle after pocket/groove; checkModel greedy; slot gaps; values sign; negative-height caps; nested cascade; row 16/36 round-then-hollow; label/vocabulary fixes',
  newRows: newRows.length,
  newGuards: ['G-RIMFIRST', 'G-STALE', 'G-CONVEX (ported into r3-guard.mjs from shell-draft-translate.mjs)', 'plain rule: cap name on a downward extrude'],
  regression: 'r5-results/regress/SUMMARY.txt: the 19 sec*/r2* measurement scripts re-run through the guard layer after the additions, compared with r3-results/sec',
};
j.translatorBasis += ' ROUND 5: see shippedVsSpecified. refusalSentence is now the sentence the unmodified page shows; specifiedSentence is the guard layer\'s plain sentence (not in the page); pageStatus / libraryStatus separate "not wired into the page" from "the library works".';
writeFileSync(F, JSON.stringify(j, null, 1));
const c = {}; for (const r of j.rows) c[r.status] = (c[r.status] || 0) + 1;
console.log(j.rows.length, c, { nPlain, nJargon, nSilent, nSpecOnly });
