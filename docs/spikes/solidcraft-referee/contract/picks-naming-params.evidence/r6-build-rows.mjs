// Round 6 (critic round 3): patch ../picks-naming-params.json from r6-results/picks-naming-params.before-r6.json (always starts from that copy, so it is idempotent).
//   bun r6-build-rows.mjs            then   bun r2-lint.mjs
//   1. ROUTES. Two routes exist and only one of them is a product today:
//        page route   = the unmodified SolidCraft page (translate-p4.mjs as is): shows the raw text in observedSentence (often engine jargon) or NO sentence at all for a 'wrong' row.
//        guarded route = the contract guard + plain-sentence layer r3-guard.mjs wrapped around the same translator: shows refusalSentence. It is NOT wired into the page.
//      refusalSentence is now the guarded route's plain sentence on every refused row (and on every wrong row, where it is the sentence that replaces the silent solid);
//      the raw page text is kept in observedSentence / pageSentenceRaw. Each row says which route its status describes (route, shipsToday).
//   2. G-HOLLOW false refusal (critic: cylinder(20,30) wall 9.9). Fixed in r3-guard.mjs (hollowBad); rows 46 and 47 restated from r6-results/r6a, r6c.
//   3. PICKS. The pick-hit is emulated everywhere in this group; the real page picking (nearest_face on the display mesh) is 'not measured' on every row (no browser on this box).
//   4. row 28/29 (r = wall height, degenerate), row 40 counts, row 33 partial label.
import { readFileSync, writeFileSync } from 'node:fs';
const D = new URL('./r6-results/', import.meta.url).pathname;
const j = JSON.parse(readFileSync(D + 'picks-naming-params.before-r6.json', 'utf8'));
const F = new URL('../picks-naming-params.json', import.meta.url).pathname;
const rd = (f) => JSON.parse(readFileSync(D + f, 'utf8'));
const idx = (p) => { const i = j.rows.findIndex((r) => r.feature.startsWith(p)); if (i < 0) throw new Error('row not found: ' + p); return i; };
const rep = (r, from, to) => { if (!r.evidence.includes(from)) throw new Error('text not found in row: ' + from.slice(0, 60)); r.evidence = r.evidence.replace(from, to); };

// ---- 1. routes
const PAGE = 'unmodified SolidCraft page (phase7/pane/lib/translate-p4.mjs as shipped)';
const GUARDED = 'contract guard layer (contract/picks-naming-params.evidence/r3-guard.mjs wrapped around the same translator; not wired into the page)';
let nRefused = 0, nWrong = 0;
for (const r of j.rows) {
  r.realPagePicking = 'not measured';
  if (r.status === 'refused') {
    nRefused++;
    r.pageSentenceRaw = r.shippedSentence; // the text the unmodified page shows today (observedSentence is the same text)
    r.refusalSentence = r.specifiedSentence; // the plain one-sentence text of the guarded route
    r.route = 'guarded';
    r.refusalSentenceRoute = GUARDED;
    r.shipsToday = r.shippedSentencePlain ? 'the page already shows a plain sentence for this row (same text)' : 'NO: the unmodified page shows pageSentenceRaw; refusalSentence is what the guarded route shows once r3-guard.mjs is integrated';
  } else if (r.status === 'wrong' && r.specifiedSentence) {
    nWrong++;
    r.pageSentenceRaw = null; // the page builds the solid and says nothing
    r.refusalSentence = r.specifiedSentence; // what the guarded route refuses with instead of the silent solid
    r.route = 'guarded';
    r.refusalSentenceRoute = GUARDED;
    r.shipsToday = 'NO: the unmodified page builds this solid with no sentence (status wrong); the guarded route refuses it with refusalSentence';
    r.guardedRouteStatus = 'refused';
  }
}
j.routes = {
  statement: 'Status fields describe the ' + PAGE + ' (pageStatus). refusalSentence on a row is what the ' + GUARDED + ' says; the raw text the page shows is pageSentenceRaw (refused rows) or nothing (wrong rows). The guarded route is the one this contract specifies and the sentences were all measured through it; the unmodified page route ships the raw text today. Plain statement: the plain sentences are NOT what a student sees on the current page.',
  refusedRows: nRefused, wrongRowsWithGuardSentence: nWrong,
};

// ---- 2. G-HOLLOW
const a = rd('r6a-hollow-thin.json'); const s = rd('r6c-r3b-rerun.json');
const cyl = a.filter((x) => x.kind === 'cyl'), box = a.filter((x) => x.kind === 'box');
const feas = a.filter((x) => x.feasible);
const over = a.filter((x) => x.verdict === 'OVER-REFUSAL').length, silent = a.filter((x) => x.verdict === 'SILENT-WRONG').length;
const exactAll = feas.every((x) => x.exact);
const maxd = Math.max(...feas.map((x) => x.dClosed));
const nine = cyl.find((x) => /cylinder\(20,30\).*wall 9\.9 /.test(x.label));
const sw = s.filter((x) => x.kind.startsWith('hollow'));
const swFeas = sw.filter((x) => x.feasible), swInfeas = sw.filter((x) => !x.feasible);
const swOver = sw.filter((x) => x.gVerdict === 'OVER-REFUSAL').length;
const swRefInf = swInfeas.filter((x) => x.gVerdict === 'REFUSED-OK').length;
const hi = idx('hollow(shape,{wall:t,open:word}) with t AT OR PAST');
const rHi = j.rows[hi];
rep(rHi, 'GUARD MEASURED (r3-guard.mjs G-HOLLOW, rule: a hollow must lose volume and gain faces): 126/126 infeasible cases refused with a sentence, 0/74 feasible cases refused;',
  `GUARD MEASURED, ROUND 6 (critic found a FALSE REFUSAL: cylinder(20,30), hollow wall 9.9 open top is a valid build, page 9424.053 = OCCT 9424.147 = closed form 9424.147, but the round-3 rule 'a hollow must lose volume and gain faces' refused it with the self-contradicting "a wall of 9.9 would collapse cyl1 -- the wall has to be under 10", because the engine's cylinder volume is derived from its tessellation: un-hollowed 9423.69 is BELOW the hollowed 9424.05; the 0/74 count of rounds 3-5 never had a thin curved cavity). FIX: r3-guard.mjs hollowBad(): for a plain box or a plain cylinder whose open face is found, the verdict is the closed-form collapse limit min(depth, narrowest lateral/2), the same number the sentence states (wall under it is never refused, wall at or past it always is), plus faces must rise; a plain cylinder also has its built volume checked against pi*(R^2 h - (R-t)^2 (h-t)) at the 3e-4 curved bar the sweeps already used (not fitted to these cases); any other shape keeps the old volume-must-drop rule. NEW PROBE r6a-hollow-thin.mjs (results r6-results/r6a-hollow-thin.json): ${cyl.length} cylinder and ${box.length} box walls at 0.5, 0.9, 0.99, 0.999, 1.0, 1.001 and 1.1 of the limit (cylinder(20,30), (24,20), (24,3), (5,30), (40,8), (10,100); boxes 40x30x20, 40x30x3, 10x10x30): ${feas.length} feasible walls, ${over} over-refusals, ${silent} silent wrong builds at or past the limit, every feasible build within the closed form (max rel ${maxd.toExponential(2)}; box 1e-9, cylinder 3e-4 bar: ${exactAll}); cylinder(20,30) wall 9.9 now BUILT ${nine.guarded.V.toFixed(3)} (closed 9424.147). Walls at or past the limit are refused (page builds some of them as the unhollowed block, e.g. cylinder(24,3) wall 3 -> 1357.084). OCCT as second oracle only where OCCT itself hollows: it refuses a wall of half the depth or more, so on deep walls it is not a reference (the volumes it then returns are the un-hollowed block); where it hollows (wall <= depth/2, e.g. cylinder(20,30) wall 5) it agrees to <= 1.7e-4. RERUN r3b-size-sweep.mjs with the new guard (r6-results/r6c-r3b-rerun.json): ${swFeas.length} feasible hollow cases, ${swOver} refused; ${swRefInf} of ${swInfeas.length} infeasible hollow cases refused by the guard (the rest are refused earlier by the engine itself); limit stated in the sentence = independent min(depth, lateral/2) in 39/39 as before. OLD CLAIM WITHDRAWN: '0/74 feasible refused' described only the 24 cylinder walls of the round-3 sweep, none thinner than 1 mm of cavity radius.`);
const sl = idx('Slider reach');
const slr = rd('r6c-r3e-rerun.json');
rep(j.rows[sl], 'Guard changed an otherwise valid build in 0 cases.', `Guard changed an otherwise valid build in 0 cases (r3e-slot-sweep.mjs re-run with the round-6 G-HOLLOW: ${slr.length} slot extremes, same tally {PASS->SAME-AS-PAGE 52, REFUSED->REFUSED 38, BUILT-NO-ORACLE->REFUSED 9, FAIL->REFUSED 2}, r6-results/r6c-r3e-rerun.json). Scope of that claim: the slot ranges of these 9 scripts only; the thin curved cavity is covered by the separate r6a probe in the hollow-limit row, which found a false refusal in round 3 that is now fixed.`);

// ---- 3. picks (emulated pick-hit; real page picking not measured)
const PICK = ' ROUND 6 PICK PATH: realPagePicking = NOT MEASURED. Every pick in this row comes from solidcraft topology read with the native solidcraft-cli (the critic built it locally from the pinned fe3717f; it is not part of the prepared rig) and a pick-hit EMULATED by lib.mjs pickEmu (interior point with the largest clearance); the page\'s own nearest_face on the display mesh in a browser was not exercised (no browser on this box). What this row measures is the solid built FOR a given picked face/edge, not that a click in the page lands on that face.';
for (const [i, r] of j.rows.entries()) {
  if (r.status !== 'supported') continue;
  r.statusScope = 'solid geometry for the picked face/edge only (closed form or live OCCT agrees); realPagePicking is not measured';
  r.pickPathStatus = 'emulated pick-hit; real page picking not measured';
  if (!r.evidence.includes('ROUND 6 PICK PATH')) r.evidence += PICK;
}

// ---- 4. row 28/29 degenerate equality, row 40 counts, row 33 partial
const w28 = idx("shape.edge('top', part.wall(sketch, n)), n = 1..4");
rep(j.rows[w28], 'r=4 (= the 4 mm wall height) SC 11645.6412 vs closed form (1-pi/4)*16*10 -> 11645.6637 (-1.9e-6), while OCCT and brep-rs refuse/no-op it (11680.0000);',
  'DEGENERATE CASE EXCLUDED FROM THIS ROW (round 6, critic): r=4 equal to the 4 mm wall height is NOT claimed supported. The page builds it silently (SC 11645.6412 vs closed form (1-pi/4)*16*10 -> 11645.6637, -1.9e-6) but the wall face vanishes (12 faces at r=3.99 -> 11 at r=4, r2k-pocket-radius.mjs live), only a closed form agrees, and OCCT and brep-rs refuse or no-op it (11680.0000); the radius claim of this row is r STRICTLY below the wall height, like the rim and round-then-hollow rows;');
j.rows[w28].feature += ' (radius strictly below the pocket wall height; r equal to it is a degenerate case, not claimed)';
const w29 = idx('round/bevel(edge(top, wall n)) with a size larger');
rep(j.rows[w29], 'round r=4 builds and is exact against the closed form (see the wall row).', 'round r=4 (equal to the wall height) builds in the page with the wall face removed (12 -> 11 faces); it matches the closed form only and is not claimed supported (see the wall row).');
const r40 = idx('Consumers of picks inside their size limits');
rep(j.rows[r40], 'bevel inside the limit 23 EXACT (planar, <=1e-9); round inside the limit 23 EXACT (max rel diff to the closed form <= 3e-4 curved bar);', 'bevel strictly inside the limit 23 EXACT (planar, <=1e-9; the page builds 29 EXACT, the 6 extra are sizes EQUAL to the adjacent face where that face vanishes, which the guard refuses); round inside the limit 29 EXACT (max rel diff to the closed form <= 3e-4 curved bar; round 3 text said 23, the r3b output says 29, corrected);');
const r33 = idx('part.rim(sketch) with round()/bevel(): the FIRST rim edge');
j.rows[r33].feature = '[PARTIAL BUILD: first rim edge only] ' + j.rows[r33].feature;
j.rows[r33].partial = true;

// ---- shippedVsSpecified restated
j.shippedVsSpecified.statement += ' ROUND 6: refusalSentence on a refused row is now the guarded route\'s plain sentence, the raw page text is pageSentenceRaw/observedSentence/shippedSentence, and each row names its route (see routes).';
j.round6 = { rowsFile: 'built by r6-build-rows.mjs from r6-results/picks-naming-params.before-r6.json', ghollowFixed: 'r3-guard.mjs hollowBad', probes: ['r6a-hollow-thin.mjs', 'r6b-sentences.mjs'], reruns: ['r6c-r3b-rerun', 'r6c-r3e-rerun'], realPagePicking: 'not measured (no browser)' };
writeFileSync(F, JSON.stringify(j, null, 1) + '\n');
console.log('rows', j.rows.length, 'refused patched', nRefused, 'wrong patched', nWrong, 'hollow sweep feasible', swFeas.length, 'over', swOver, 'infeasible', swInfeas.length, 'ref', swRefInf, 'r6a feasible', feas.length, 'over', over, 'silent', silent);
