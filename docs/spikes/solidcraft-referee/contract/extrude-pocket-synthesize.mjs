#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group), ROUND 3. Turns ep-results.json (written by extrude-pocket-measure.mjs) into extrude-pocket.json:
// one row per feature with ONE status. Every number in the evidence is computed here from the results; only the prose notes are typed.
//   bun docs/spikes/solidcraft-referee/contract/extrude-pocket-synthesize.mjs [--results=<ep-results.json>] [--fuzz=<taper-fuzz.json>] [--slender=<file>]
//
// STATUS (one per row, no second status field): the state of the feature under the CONTRACT mapping = contract/translate-ep.mjs + outline-guard.mjs +
// soup-regions.mjs, which the page must adopt. The shipped phase 7 translator (translate-p4.mjs) is reported inside the evidence for comparison only.
//   supported   = every case that should build builds and agrees with the oracles (planar 1e-9 volume/bbox, 1e-6 COM; curved 3e-4 / 3e-4 / 3e-5), and every
//                 case that should be declined is declined WITH a sentence
//   refused     = the row is a refusal: every case is declined with the plain sentence quoted in refusalSentence, nothing is built
//   wrong       = at least one case builds a solid that disagrees with the oracles, or builds where a refusal is the right answer
//   unsupported = could not be measured (reason in the evidence)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const RESULTS = arg('results', path.join(HERE, 'ep-results.json'));
const results = JSON.parse(readFileSync(RESULTS, 'utf8'));
const cases = results.filter((r) => !r.scriptError);
const scriptErrors = results.filter((r) => r.scriptError);
const fuzz = existsSync(arg('fuzz', path.join(HERE, 'extrude-pocket-taper-fuzz-results.json'))) ? JSON.parse(readFileSync(arg('fuzz', path.join(HERE, 'extrude-pocket-taper-fuzz-results.json')), 'utf8')) : null;
const slender = existsSync(arg('slender', path.join(HERE, 'extrude-pocket-slender-results.json'))) ? JSON.parse(readFileSync(arg('slender', path.join(HERE, 'extrude-pocket-slender-results.json')), 'utf8')) : null;
const ex = (v) => (typeof v === 'number' ? (v === 0 ? '0' : v.toExponential(1)) : '-');
const byId = new Map(cases.map((c) => [c.id, c]));

// ---- classification (contract only) --------------------------------------------------------------------------------------------------------
function klass(r) {
  const rt = r.contract;
  if (rt.error) return 'ERR';
  const want = r.expect ?? 'build';
  if (rt.measure) return want === 'refuse' ? 'BUILT_UNEXPECTED' : (rt.vsRef?.ok ? 'PASS' : 'WRONG');
  return want === 'refuse' ? 'OK_REFUSED' : 'REFUSED';
}
function shippedKlass(r) {
  const rt = r.shipped;
  if (rt.error) return 'ERR';
  const want = r.expect ?? 'build';
  if (rt.measure) return want === 'refuse' ? 'built-where-a-refusal-is-right' : (rt.vsRef?.ok ? 'built-correctly' : 'built-WRONG');
  return want === 'refuse' ? 'refused-correctly' : 'refused-or-not-mapped';
}
const tally = (rs, f) => { const t = {}; for (const r of rs) { const k = f(r); t[k] = (t[k] ?? 0) + 1; } return Object.entries(t).map(([k, v]) => `${v} ${k}`).join(', '); };
function statusOf(rs) {
  const k = rs.map(klass);
  if (k.some((x) => x === 'WRONG' || x === 'BUILT_UNEXPECTED' || x === 'ERR')) return 'wrong';
  if (k.every((x) => x === 'OK_REFUSED')) return 'refused';
  if (k.some((x) => x === 'REFUSED')) return 'refused'; // a case that should build is declined: the row can only claim a refusal
  return 'supported';
}
function maxima(rs) {
  const built = rs.filter((r) => r.contract.measure && r.contract.vsRef && (r.expect ?? 'build') !== 'refuse');
  const part = (curved) => {
    const g = built.filter((r) => !!r.curved === curved);
    if (!g.length) return null;
    const m = (f) => Math.max(...g.map((r) => r.contract.vsRef[f] ?? 0));
    return `${curved ? 'curved' : 'planar'} x${g.length}: dVol<=${ex(m('dVol'))} dBbox<=${ex(m('dBbox'))} dCOM<=${ex(m('dCom'))}`;
  };
  const s = [part(false), part(true)].filter(Boolean).join('; ');
  return s ? `${s} (bars planar 1e-9/1e-9/1e-6, curved 3e-4/3e-4/3e-5)` : '';
}
function oracleLine(rs) {
  const o = [`closed form ${rs.filter((r) => r.analytic).length}/${rs.length}`];
  for (const [k, lab] of [['occt', 'live OCCT'], ['brep', 'live brep-rs'], ['fc', 'saved FreeCAD']]) {
    const b = rs.filter((r) => r[k] && r[k].volume !== undefined);
    const refused = rs.filter((r) => r[k] && r[k].refused !== undefined);
    if (!b.length && !refused.length) { o.push(`${lab} none`); continue; }
    o.push(`${lab} built ${b.length}${refused.length ? ` / refused ${refused.length}` : ''}`);
  }
  return o.join(', ');
}
function brepLine(rs) {
  const built = rs.filter((r) => r.contract.measure && (r.expect ?? 'build') !== 'refuse' && r.brep?.volume !== undefined);
  const disagree = built.filter((r) => (r.contract.vsBrep?.dVol ?? 0) > ((r.curved) ? 3e-4 : 1e-9));
  const brepRef = rs.filter((r) => r.brep?.refused !== undefined);
  const parts = [];
  if (built.length) parts.push(`contract vs brep-rs where both build: ${built.length - disagree.length}/${built.length} agree${disagree.length ? `; DISAGREE ${disagree.map((r) => `${r.id} (contract ${r.contract.measure.volume.toFixed(4)} vs brep-rs ${r.brep.volume.toFixed(4)}, closed form/OCCT ${r.analytic?.volume !== undefined ? r.analytic.volume.toFixed(4) : (r.occt?.volume?.toFixed(4) ?? '-')})`).join('; ')}` : ''}`);
  if (brepRef.length) parts.push(`brep-rs declines ${brepRef.length}: ${[...new Set(brepRef.map((r) => String(r.brep.refused).replace(/ -- .*$/, '').replace(/^(extrude|pocket) /, '').slice(0, 110)))].slice(0, 4).join(' | ')}`);
  return parts.join('; ');
}
function facesLine(rs) {
  const b = rs.filter((r) => r.contract.measure && r.occt?.faces !== undefined && (r.expect ?? 'build') !== 'refuse' && r.occt.solids === undefined || (r.contract.measure && r.occt?.faces !== undefined && (r.expect ?? 'build') !== 'refuse'));
  if (!b.length) return '';
  const diff = b.filter((r) => r.contract.measure.faces !== r.occt.faces);
  return `faces == OCCT in ${b.length - diff.length}/${b.length}${diff.length ? ` (differs: ${diff.slice(0, 6).map((r) => `${r.id} truck ${r.contract.measure.faces} / OCCT ${r.occt.faces}`).join('; ')}${diff.length > 6 ? `; +${diff.length - 6}` : ''}; volume, bbox and COM agree, truck merges coplanar faces OCCT keeps split)` : ''}`;
}
const sentencesOf = (rs) => [...new Set(rs.flatMap((r) => (r.contract.refusals ?? []).map((x) => x.sentence)))];
const checksLine = (rs) => {
  const all = rs.flatMap((r) => (r.contract.checks ?? []).map((c) => ({ id: r.id, ...c })));
  if (!all.length) return '';
  const cut = all.filter((c) => c.check === 'cut-consistency'); const join = all.filter((c) => c.check === 'join-consistency');
  const f = (a, name) => (a.length ? `${name}: ${a.length} builds checked, worst |dev| ${ex(Math.max(...a.map((c) => Math.abs(c.devMm3))))} mm3 against a tolerance of ${ex(Math.min(...a.map((c) => c.tolMm3)))}..${ex(Math.max(...a.map((c) => c.tolMm3)))} mm3${a.some((c) => c.inconclusive) ? `, ${a.filter((c) => c.inconclusive).length} inconclusive` : ''}` : '');
  return [f(cut, 'cut-consistency'), f(join, 'join-consistency')].filter(Boolean).join('; ');
};

// ---- the rows ---------------------------------------------------------------------------------------------------------------------------
const { FEATURES } = await import(pathToFileURL(path.join(HERE, 'extrude-pocket-cases.mjs')).href);
await import(pathToFileURL(path.join(HERE, 'extrude-pocket-cases-r2.mjs')).href);
const { R3_FEATURES } = await import(pathToFileURL(path.join(HERE, 'extrude-pocket-cases-r3.mjs')).href);
const { F_JOINTOUCH, F_JOINFACE, F_OUTLINE, F_ROWS, F_SLANTX, F_LOFTFACE } = R3_FEATURES;
const R4 = await import(pathToFileURL(path.join(HERE, 'extrude-pocket-cases-r4.mjs')).href);
const { F_TAPER_SOUP, F_TAPER_SOUP_X, F_COUNT, F_PADFLAT, F_FLOOR } = R4;
const jsonIf = (f) => (existsSync(path.join(HERE, f)) ? JSON.parse(readFileSync(path.join(HERE, f), 'utf8')) : null);
const SOUPFUZZ = jsonIf('extrude-pocket-taper-soup-fuzz-results.json');
const readIf = (f) => (existsSync(path.join(HERE, f)) ? readFileSync(path.join(HERE, f), 'utf8').trim() : null);
const r2base = existsSync(path.join(HERE, 'ep-r3-round2-results.json')) ? new Map(JSON.parse(readFileSync(path.join(HERE, 'ep-r3-round2-results.json'), 'utf8')).map((r) => [r.id, r])) : new Map();
/** what the ROUND-2 mapping (translate-ep.round2.mjs) did with each case: built (bodies, shells, edges) or the sentence it gave */
const baselineLine = (rs) => {
  const rows = rs.filter((r) => r2base.has(r.id)).map((r) => {
    const b = r2base.get(r.id).contract;
    return `${r.id}: ${b.measure ? `built ${b.measure.volume.toFixed(4)} (${b.measure.bodies.length} body, ${b.measure.shells} shell${b.measure.shells === 1 ? '' : 's'}, ${b.measure.kernelEdges} edges)` : `declined "${(b.refusals?.[0]?.sentence ?? b.error ?? '').slice(0, 150)}"`}`;
  });
  return rows.length ? `ROUND-2 MAPPING (frozen translate-ep.round2.mjs, ep-r3-round2-results.json), same cases: ${rows.join(' | ')}.` : '';
};
const { F_PULL, F_DEFAULT, F_MID, F_L2, F_REV, F_TAPER, F_DIR, F_POCKET, F_PADJ, F_SOUP } = FEATURES;
const PO = (n) => `pocket options: ${n}`;
const re = (r) => (c) => r.test(c.id);
const ids = (...a) => (c) => a.includes(c.id);
const not = (f, g) => (c) => f(c) && !g(c);
const ROWS = [];
const row = (feature, pick, o = {}) => ROWS.push({ feature, pick, ...o });
const refusesIt0 = (c) => (c.expect ?? 'build') === 'refuse';

const BESPOKE = 'OCCT = the bespoke builder in extrude-pocket-measure.mjs (occtSweepShape: prism / sheared prism / ThruSections loft to a mitre offset), because the repo occt-build.js ignores every pull/pocket option (provenance table: contract/extrude-pocket-occt-provenance.txt: length2 gives the plain 1000 where brep-rs and the closed form give 1400)';
const REPO_OCCT = 'OCCT = the repo occt-build.js (plain pulls, pockets, pads, soups need no option)';

row(F_PULL, not(re(/^pp-/), ids('pp-zero-height')), { occt: REPO_OCCT, extraIds: ['fc-pad-side-offset-neg', 'bt-control-star'],
  note: 'Sweep direction measured per plane: top +Z, front -Y (its offset moves +Y, so a front sketch at offset 5 pulled 10 spans y -5..5), side +X, a framed sketch along u x v (a frame whose normal is -Z pulls DOWN); negative height pulls the other way on every plane; circle, concave L, clockwise polygon, rounded-corner outline, a 200 x 120 x 1.5 plate and a 4 x 4 x 120 post. NOTE the accuracy bar for curved solids is only valid while the part is not many times wider than its smallest round shape: see the row "curved solids: volume accuracy".' });
row(F_DEFAULT, re(/^def-/), { occt: REPO_OCCT, note: "The untouched sketch is the rectangle [[0,0],[40,0],[40,25],[0,25]] (read off the ModelDoc), 10000 mm3 on all three planes; extrude() is the same call as pull()." });
row(F_MID, (c) => /^pm-/.test(c.id) || c.id.startsWith('fc-pad-sym'), { occt: BESPOKE,
  note: 'MAPPING: solid.extrude {distance: L/2, distance2: L/2}. The direction-based form {distance: L, direction: "symmetric"} is WRONG at the pinned fe3717f (distance is per side: it builds 2L, probes.txt section 7) and would flip meaning on a rebase, so the mapping never uses it. FreeCAD "Symmetric to plane" pad refs match.' });
row(F_L2, not(re(/^pl-/), ids('pl-both-midplane', 'pl-zero-length2')), { occt: BESPOKE,
  note: 'MAPPING: solid.extrude {distance: ahead, distance2: behind}. The form {distance, distance2, direction: "negative"} silently IGNORES direction at the pinned commit (the extent comes out [-4,10] where [-10,4] was asked, probes.txt section 7), so the mapping never combines them. The interpreter itself refuses midplane together with length2 and length2 <= 0.' });
row(F_REV, (c) => /^pr-/.test(c.id) || ['fc-pad-reversed', 'fc-pad-offset-neg-reversed'].includes(c.id), { occt: BESPOKE, note: 'reversed turns the extent to n in [-h, 0]; reversed + a negative height flips twice. FreeCAD refs match (the gauntlet writes a reversed pad as a negative height).' });
row(`${F_TAPER} -- one plain outline, a taper that stays clean`, (c) => (/^pt-/.test(c.id) && !['pt-fold', 'pt-ring', 'pt-midplane', 'pt-length2', 'pt-just-folded', 'pt-90'].includes(c.id)) || /^tfc-/.test(c.id) && !/pocket/.test(c.id), { occt: BESPOKE,
  note: 'MAPPING: solid.extrude {distance, taper}. Positive taper grows the profile (same sign as ModelDoc/FreeCAD, measured). Exact for polygons incl. concave L and reflex corners, circles (cone frustum, curved bar), a rounded-corner outline, front/side planes, negative height, reversed. The CONTROLS (tfc-*) sit right at the edge of folding (a 12 mm side shrinking to 0.46 mm; a 4 mm slot left 0.11 mm wide) and still build exactly: the fold guard is not over-eager there.' });
row('pull/pocket option {taper}: a taper that folds or closes the outline (the walls cross or a wall vanishes before the end of the length) is refused', (c) => /^tf-/.test(c.id) || ['pt-fold', 'pt-just-folded', 'kk-fold'].includes(c.id), { occt: 'no oracle builds these: OCCT\'s loft of a folded outline is garbage too (it "builds" tf-cshape-30 as 7162.05, a self-overlapping solid)',
  note: 'WITHOUT the guard truck builds garbage here (probes.txt section 6, rect 20 x 12 h 10: -55 gives 549.4, -60 857.4, -70 3672.9, -85 140018.6, -89 4195258.4 mm3; only -45 and -31.5 are caught by truck\'s own "the taper closes the profile"). The mapping walks the offset outline in 64 steps (outline-guard.mjs taperFold): every segment must keep its direction and length, and no two non-neighbouring parts may cross or come within 0.001 mm. A wall that vanishes (a rounded corner whose arc is eaten by the taper, tf-roundrect-45) is refused too. The guard is validated against live OCCT on random outlines in extrude-pocket-taper-fuzz.mjs (see FUZZ below).' });
row('pull/pocket option {taper} together with midplane -- refused (not built yet)', ids('pt-midplane', 'kk-midplane', 'tc-soup-taper-midplane'), { occt: BESPOKE,
  note: 'No oracle builds a tapered midplane sweep (brep-rs also declines it): refused in its own sentence, one row per combination so the sentence a student sees is the one in this row.' });
row('pull/pocket option {taper} together with length2 -- refused (not built yet)', ids('pt-length2'), { occt: BESPOKE,
  note: 'No oracle builds a tapered two-sided sweep (brep-rs also declines it).' });
row('pull option {taper} together with a direction -- refused (not built yet)', ids('pd-with-taper'), { occt: BESPOKE,
  note: 'A slanted sweep is a loft of two copies of the outline; a taper on top of it has no oracle (brep-rs also declines it).' });
row(F_TAPER_SOUP, (c) => c.feature === F_TAPER_SOUP, { occt: 'no OCCT solid for a holed taper in the bespoke builder: the closed form (exact profile areas, Simpson) and the independent OCCT fold fuzz (extrude-pocket-taper-soup-fuzz.mjs, offset faces by BRepOffsetAPI_MakeOffset) are the oracles',
  extra: () => (SOUPFUZZ ? `SOUP TAPER FUZZ (live OCCT, ${SOUPFUZZ.summary.n} random polygons-with-holes / pairs): ${JSON.stringify(SOUPFUZZ.summary)}.` : ''),
  note: 'ROUND 4. Round 3 refused every taper on a sketch with a hole or several shapes, although the kernel builds it correctly: ring +5 gives 10248.90 against the closed form 10249.34, ring -5 8599.87 against 8599.4, and the status then contradicted its own definition of supported. The mapping now passes the even-odd region picks together with the taper and walks the offset of EVERY loop (outer loops move out, holes move in) in 64 steps before the kernel is called (outline-guard.mjs taperFoldLoops): a wall that folds, a hole that closes, or two shapes that would grow into each other are refused in the next row. HISTORY: the first version of the guard (segment crossings only) BUILT tx-island-grows-into-wall wrongly, because a hole shrinking past a block that grows can pass through it between two steps without any wall crossing another; the guard now also checks that the nesting of the loops does not change at any step (the fuzz row is the evidence for the final version). LANGUAGE REFERENCE: brep-rs (archive/, read-only) DECLINES every case of this row ("a taper or a custom direction is built for a profile without holes yet"), so here the contract builds what the reference refuses; the status follows the definition (builds and matches the closed form), and the reference text has to say that a taper on holes is built.' });
row(F_TAPER_SOUP_X, (c) => c.feature === F_TAPER_SOUP_X, { occt: 'no oracle builds these; the fuzz decides event-free-ness with live OCCT offsets',
  note: 'WITHOUT this guard truck leaves two overlapping bodies for tx-two-overlap (volume = the sum of both, overlap counted twice) and garbage when a hole closes or runs out through the wall.' });
row(F_DIR, not(re(/^pd-/), ids('pd-in-plane', 'pd-with-taper', 'pd-circle-hole', 'pd-soup-hole')), { occt: BESPOKE, extraIds: [],
  note: 'MAPPING: solidcraft has NO oblique extrude (an ARRAY direction is silently read as "positive": a mapping that forwarded it would build the plain prism, 1000, with no sentence; probes.txt s1). A slanted pull is a solid.loft of two copies of the outline S apart (S = dhat * span/|dhat.n|, or dhat * span with alongNormal:false). A direction parallel to the normal is the plain pull (flipped when it points against the normal).' });
row('pull option {direction} lying in the sketch plane -- refused', ids('pd-in-plane'), { occt: BESPOKE,
  note: 'The tool would never leave the profile. The interpreter refuses [0,0,0] and alongNormal without direction (script errors below).' });
row('pull option {direction} on a sketch with holes or several shapes -- refused', ids('pd-soup-hole'), { occt: BESPOKE,
  note: 'The soup guard is the ONLY protection for the holed case: truck\'s loft silently drops the hole (10000 against 9497 for a 40 x 30 plate with a d10 hole pulled 10 along [1,0,1]).' });
row(F_POCKET, (c) => (/^kp-/.test(c.id) && !['kp-on-holed-plate', 'kp-bottom-face', 'kp-in-air'].includes(c.id)) || /^fc-pocket-/.test(c.id), { occt: REPO_OCCT,
  note: 'Pocket cuts opposite the sweep: on a top-face sketch it goes down, on a front sketch at y=0 it goes +Y, on a side sketch at x=40 it goes -X. Targets: a pull, a join (the pad), a box, a cylinder, an earlier pocket, a framed sketch from the bottom face; a profile running off the side; a depth larger than the part. The pocket is solid.extrude {operation:"cut", targets, direction:"negative"}. Depth <= 0 is refused by the interpreter.' });
row(PO('through:true (cut all the way)'), not((c) => /^kt-/.test(c.id) || c.id === 'fc-pocket-through-two-seq', ids('kt-below', 'kt-crossing-hole', 'kt-through-midplane')), { occt: BESPOKE,
  note: 'MAPPING: solid.extrude {through_all:true, operation:"cut", direction:"negative"}; reversed makes it "positive". The cut runs from the sketch plane to the end of the part in the cut direction (a mid-body sketch leaves the other half intact; a sketch above the part still cuts it all).' });
row(PO('through:true together with midplane: cut the whole part both ways'), (c) => /^tm-mid/.test(c.id) || /^tm3-/.test(c.id) || c.id === 'kt-through-midplane', { occt: BESPOKE,
  note: 'The old sentence "a through-all pocket cannot also be symmetric or two-sided: choose one" was false and is gone. The answer is the whole part cut either way (sketch height does not matter); the ORACLES for it are the hand closed form and live OCCT, which agree with truck. brep-rs is NOT an oracle here (round 2 said it agreed except in tm-mid-front: that was wrong, the critic found more and the DISAGREE list above has 16 cases): by hand the closed form is right. A d8 circle cut through the whole 60 mm of a 60 x 60 x 20 plate removes pi*16*60 = 3015.93 mm3 of the 72000, leaving 68984.07; live OCCT gives exactly that, truck gives 68984.57 (7.3e-6, the tessellation error of a curved volume), brep-rs gives 69088.80 to 69783.85 (it keeps 105 to 800 mm3 too much, 1.5e-3 to 1.2e-2 of the volume) whenever the sketch plane is not at the middle of the part (offsets 0, 5, 10, 20, 45 and 60 on front and side planes, reversed or not; with the sketch at offset 30 it agrees). The cause inside brep-rs was not investigated. So the status stays supported on the strength of the closed form and OCCT, not of brep-rs. MAPPING: solid.extrude {through_all:true, direction:"symmetric"} (truck supports it natively; here "symmetric" is the right form because there is no distance to double).' });
row(PO('through:true together with length2'), re(/^tm-len2/), { occt: BESPOKE,
  note: 'brep-rs DROPS length2 under through without a word (11520 / 11760 = the plain through cut, length2 ignored) and so does FreeCAD\'s ThroughAll; a literal reading would also cut 3 mm above a mid-body sketch. Neither reading is certain, so the mapping refuses rather than choose.' });
row(PO('through:true together with direction (a slanted cut through the whole part)'), (c) => /^td-/.test(c.id) && !/^td-slant-(up|reversed|below|circle)$/.test(c.id), { occt: BESPOKE,
  note: 'The old mapping ignored `through` on the slanted (loft) path: a slanted through cut built 47000 where brep-rs builds 44000. Now the loft is made long enough to cover the whole part along the slant (reach computed from the part\'s box), also with midplane and alongNormal:false.' });
row(PO('reversed:true'), not(re(/^kr-/), ids('kr-mid', 'kr-top-air', 'kr-front-mid')), { occt: BESPOKE, note: 'reversed flips the cut to n in [0, depth] (solid.extrude {direction:"positive", operation:"cut"}).' });
row(PO('midplane'), not(re(/^km-/), ids('km-mid', 'km-front')), { occt: BESPOKE, note: 'MAPPING: solid.extrude {distance: depth/2, distance2: depth/2, operation:"cut"} (not direction:"symmetric", see the pull midplane row). Cases where the symmetric tool leaves a void are in the sealed-cavity row.' });
row(PO('length2'), not(re(/^kl-/), ids('kl-mid', 'kl-reversed', 'kl-front')), { occt: BESPOKE, note: 'MAPPING: distance = length2 (out of the mouth), distance2 = depth (into the material). Cases that leave a void are in the sealed-cavity row.' });
row(PO('taper'), not(re(/^kk-/), ids('kk-fold', 'kk-midplane')), { occt: BESPOKE, extraIds: ['tfc-pocket-uslot-10'], note: 'MAPPING: solid.extrude {taper, direction:"negative", operation:"cut"}. Positive grows the cut as it deepens. Through + taper keeps widening to the bottom face.' });
row(PO('direction'), not(re(/^kd-/), (c) => /^kd-along/.test(c.id) || ['kd-in-plane', 'kd-up-slant', 'kd-parallel-up', 'kd-reversed', 'kd-midplane', 'kd-circle'].includes(c.id)), { occt: BESPOKE,
  note: 'Slanted tool = solid.loft of two copies of the outline, then the cut; the cut travels ALONG the given vector. A vector parallel to the normal is the plain pocket. A vector in the sketch plane is refused (row below).' });
row(PO('alongNormal'), re(/^kd-along/), { occt: BESPOKE, note: 'alongNormal:false measures the depth along the direction vector instead of along the normal. Both oracle readings agree with the closed form.' });
row('pocket {direction} in the sketch plane', ids('kd-in-plane'), { occt: BESPOKE, note: 'Refused by the mapping (the tool would never leave the profile).' });
row('pocket that touches nothing (sketch in the air, on the wrong side of the part, off the body, reversed away from a face, direction pointing out of the part) is refused', (c) => ['kp-bottom-face', 'kp-in-air', 'kr-top-air', 'kd-up-slant', 'kd-parallel-up', 'kd-reversed', 'kt-below'].includes(c.id) || /^td-slant-(up|reversed|below)$/.test(c.id), { occt: 'OCCT builds the unchanged part (the cut removes nothing)',
  note: 'The old contract called these "built correctly, the right answer is the unchanged plate". brep-rs (the language reference) refuses them with the same sentence; a student who pockets from the wrong side must be told. The mapping compares volume and face count before and after (after-the-build check in translate-ep.mjs verifyPocket).' });
row('pocket that would leave a sealed void inside the part (sketch inside the material, depth short of every face) is refused', (c) => ['kr-mid', 'kr-front-mid', 'km-mid', 'km-front', 'kl-mid', 'kl-reversed', 'kl-front', 'kd-midplane'].includes(c.id), { occt: 'OCCT builds the part with a void',
  note: 'POLICY REFUSAL, not a measurement: the kernel builds the void solid CORRECTLY (SolidCraft, live OCCT and the closed form agree: pk-inside / pk-l2 / pk-rev-l2b 11600, 11500, 11500), so by the definition of supported this would be supported; it is refused because the language reference (brep-rs) refuses it. brep-rs refuses these with "would leave a sealed cavity inside the part instead of opening onto a face"; truck, OCCT and FreeCAD-style kernels build the void. The policy is brep-rs\'s (a hollow made by accident is the usual meaning). Detected by shells: one more shell than one more body (kernel.shells in inspect.measure).' });
row(F_PADJ, (c) => /^jp-/.test(c.id) || (/^jcc-/.test(c.id) && !refusesIt0(c)), { extra: (rs) => baselineLine(rs.filter((r) => /^jcc-/.test(r.id))), occt: REPO_OCCT + '; pads with an option use the bespoke builder',
  note: 'join(base, pull(sketch,h)) is a combine/union of two bodies; the pad itself is the plain pull (or a pull with an option). Cases: a boss on the top face, a block wholly inside the base (union = base, a valid no-op for a JOIN), half embedded, a boss on the side face, a disjoint block (two pieces), a round boss, three-way join, and pads with midplane / taper / reversed-into-the-base. Every join is also checked by inclusion-exclusion (join-consistency). ROUND 3 controls (jcc-*): a pad that shares part of a side face, stands on the top face, is flush with two edges, overhangs the edge, overlaps a corner by a volume, joins pull to pull, a 1 mm and a 0.001 mm gap (two separate pieces), a d8 pin standing in a d10 bore of a plate, a rod sunk 1 mm into a plate, an L-shaped base: all build and match. A join whose parts only touch along a line or at a point is NOT this row: it is refused, see the next row.' });
row(F_JOINTOUCH, (c) => /^jc-/.test(c.id) || c.id === 'jcc-rods-boxes-touch-apart', { occt: 'live OCCT fuses them into a compound of 2 solids (volume = the sum); brep-rs refuses all of them',
  extra: (rs) => `${baselineLine(rs)} DECISION: refuse, as brep-rs does. Truck builds ONE body with TWO shells (24 edges) for a z-line or a corner point and for a plain 1 mm gap alike, and for an x-line on a top face it refuses with raw text, so neither the kernel answer nor its shell count tells touching from apart. The contract decides geometrically: (1) two BLOCKS (volume == bounding-box volume, the usual base and pad) are decided exactly from the gap between the boxes on x, y and z (touching = a gap of 1e-6 mm or less): touching on two or more axes is a line or a point, refused BEFORE the kernel runs; (2) parts that are not blocks (a rod on a plate, a tapered pad, an L-shaped base) get a conservative check after the build: bounding boxes touching on one plane or more AND the join merged no shell = refused. (3) the kernel's raw refusal ("join cannot preserve the original faces; check for zero-thickness edge contact") is mapped to the same sentence by plainKernelSentence. KNOWN OVER-REFUSAL (jcc-rods-boxes-touch-apart): two rods whose boxes share a plane but whose surfaces are 4.5 mm apart are refused too (brep-rs builds them). KNOWN LIMIT: a non-block pair whose boxes OVERLAP (a pin tangent to the wall of a bore, boxes inside each other) is not detected as touching; the bore with 1 mm clearance (jcc-pin-in-bore) builds correctly as two pieces, a pin of the bore's own diameter is not measured.`,
  note: 'The sentence names no kernel word and carries the choice (overlap a little, share a whole face, keep clearly apart). Gaps of 0.001 mm and up build as two pieces (jcc-gap-edge-1e-3); a 1e-7 mm gap is touching for truck and refused (jc-gap-edge-1e-7).' });
row(`${F_SOUP} -- NESTED loops are holes (even-odd)`, ids('sp-circle-in-rect', 'sp-rect-in-circle', 'sp-two-holes', 'sp-rect-rect-frame', 'sp-polygon-with-hole', 'sp-ring-geom-rows', 'sp-three-deep-rects', 'sp-four-circles', 'sp-island-far-disc', 'sp-holed-plate-far-rect', 'sp-slot-hole', 'sp-dimensioned', 'spk-ring', 'spk-three-deep', 'sp-slot-hole-pocket', 'spk-blind-ring-far-rect', 'spk-through-ring-far-rect', 'kp-on-holed-plate', 'kt-crossing-hole'), { occt: REPO_OCCT + ' (it cannot build the multi-piece soups: marked refused)',
  note: 'The SHIPPED translator alone fills every hole (solid.extrude with no `profiles` extrudes ALL profiles: 40 x 30 plate with a d10 hole, 15 tall: 18000 instead of 16821.90; three nested squares 54000 instead of 36000). contract/soup-regions.mjs applies the even-odd rule with explicit point picks and matches the saved FreeCAD results and brep-rs in every case.' });
row(`${F_SOUP} -- shapes side by side are separate pieces`, ids('sp-disjoint-rects', 'sp-disjoint-circles', 'sp-rect-circle-apart', 'spk-two-holes', 'spk-rect-circle', 'spk-through-two-holes'), { occt: REPO_OCCT,
  note: 'Pieces come back as separate bodies. The translator\'s OWN per-feature measure (not just the scene) now sums every piece ("b_pull1", "b_pull1 (2)"): featureVsScene is checked to 1e-9 in every case (a translator that measured only the named body saw 6000 of 12000).' });
row(`${F_SOUP} -- CROSSING shapes are refused`, ids('sp-crossing-rects', 'sp-crossing-circles'), { occt: 'OCCT refuses too', note: 'Shipped translator: builds the UNION (rects 15000, circles 7581.7); the pane\'s even-odd pick would build the XOR. Neither is a refusal. brep-rs and FreeCAD-style refusal: a sentence.' });
row(`${F_SOUP} -- TOUCHING shapes are refused`, ids('sp-tangent-inside', 'sp-tangent-outside', 'sp-shared-edge'), { occt: 'OCCT refuses', note: 'Shipped translator builds all three (tangent-inside as a FILLED disc: 18848.3 vs FreeCAD 14137.2).' });
row(`${F_SOUP} -- combined with pull/pocket options`, re(/^sp-soup-(midplane|reversed)|^spk-soup-midplane/), { occt: BESPOKE, note: 'midplane and reversed+length2 on a holed profile build exactly. Taper and direction on a holed profile are refused (rows above).' });
row('a pull of several shapes, a pocket into a part that is already several pieces, a join of such parts, a cut that splits a part in two: every later feature sees ALL the pieces', re(/^mp-/), { occt: 'OCCT = the bespoke builder where it can build the compound; closed forms otherwise (OCCT cannot be built by occt-build for these soups: marked refused)',
  note: 'Round 1 measured only the body named b_pull1: the feature measure for two squares was 6000 (true 12000), a pocket on the right-hand piece was reported built but not applied, a join with a box overlapping the right-hand piece double counted the overlap (9000 against 8000), and every feature that consumes a split part was wrong. Now aggregate() takes the named bodies AND their solidcraft split-offs ("name (2)"), a pocket cuts every piece (targets = all pieces), a join takes every piece of every target, and a subtract/intersect of several pieces is refused. A ring-shaped through pocket frees an island: two pieces, island in place (mp-ring-island; FreeCAD gives two solids; brep-rs refuses ring-only but builds ring plus a far rectangle).' });
row('pull/pocket where ONE outline crosses or touches itself (bow-tie, star drawn in one stroke, a pinched figure 8) is refused', re(/^bt-(?!control)/), { occt: 'OCCT "builds" the two triangles / drops one',
  note: 'Round 1 built a bow-tie pull as 3000 and the pocket as 47500 with no sentence. The mapping samples the outline (arcs every 2 degrees) and refuses when two non-neighbouring parts cross or come within 0.001 mm. The soup path had this check for separate loops only. Control: a ten-pointed star that does not cross itself builds exactly (bt-control-star).' });
const refusesIt = (c) => (c.expect ?? 'build') === 'refuse';
row('pull/pocket with a length, depth or outline too small for SolidCraft (under 0.001 mm, round shapes under 0.5 mm in a part they dominate), and a pocket depth that cuts nothing measurable', (c) => /^dg-(h|s|c|pk)-/.test(c.id) && refusesIt(c), { occt: 'OCCT builds all of them (brep-rs too)', extraIds: ['pp-zero-height'],
  note: 'Truck: a pull height <= 5e-7 gives the raw "extrude distance is zero" (1e-6 builds right); a pocket depth <= 1e-5 is a silent no-op (12000 stays 12000); a 0.001 mm circle has its centre of mass 6% of the size off; a square under 0.0005 mm gives the raw "s has no closed profiles", a 1e-4 mm one "cannot attach a plane to a wire that is not on one plane" (probes.txt section 8). The mapping refuses below 0.001 mm (round shapes: by the accuracy bound, see the curved-solids row) with one plain sentence. brep-rs builds them: it does not share truck\'s limit. pp-zero-height: the pull height is 0.' });
row('pull/pocket at the smallest sizes that still build: 0.001 mm lengths and squares, 0.5 mm and 1 mm circles, 0.3 mm walls', (c) => (/^dg-(h|s|c|pk|wall|wall-thru)-/.test(c.id) && !refusesIt(c)) || c.id === 'nf-join-step-0.5', { occt: REPO_OCCT + ' (volumes are tiny; errors are true relative errors, not floored at 1 mm3)',
  note: 'The lower end of the range that is measured correct: pull heights 0.001 and 0.01, squares 0.001 and 0.01, circles 0.5 and 1 mm (curved error 2.5e-4 and 1.3e-4), a pocket depth 0.001 mm, walls 0.3 mm and 1 mm.' });
row('thin walls and slivers: a pocket that leaves a wall, a pocket that stops a hair short of a face, or a join that leaves a step, thinner than about 0.3% of the part (0.12 mm on a 40 mm plate) is refused', (c) => (/^dg-wall/.test(c.id) || /^nf-/.test(c.id)) && refusesIt(c), { occt: 'OCCT keeps every wall (and brep-rs from 0.0005 mm up)',
  extra: () => 'ROUND 3 LIMIT, measured: on a part that already has a curved cut the bounding box truck reports is not exact (a slanted bore made a plate\'s top 10.000013883 where the plane is at 10; a cylinder\'s box is 2e-4 SMALL), so the near-flush rule ignores gaps under 3e-5 mm on such parts (CURVED_BBOX_SLOP in translate-ep.mjs); without that, every straight pocket from the top face of a plate with a slanted bore was refused as "1.4e-5 mm short of a face" (case sx-straight-after-slant, builds now at 1.1e-6). A wall thinner than 3e-5 mm on a curved part is therefore left to the cut-consistency check, whose bar on curved parts is 3e-4 of the volume.',
  note: 'The most dangerous silent failure found in round 2: a boolean in the pinned truck DROPS the thin wall (pocket 20 - w wide next to the plate edge: w = 0.01, 0.1, 0.12 all vanish; 0.15 and up stay, probes.txt section 9; the limit scales with the part: 10x the plate, 10x the wall). It happens in sequential pockets and joins too (web between two pockets, a 0.01..0.03 mm step). brep-rs builds them. Two guards, both before accepting the build: (1) cut-consistency / join-consistency: the mapping measures what the tool removes separately (tool INTERSECT piece, in a scratch session) and compares, V_before - V_after must equal it; (2) near-flush: a tool face 1e-9 < gap <= 1e-4 mm from a part face is refused outright, because truck\'s own intersect snaps those too (a 1e-5 wall passes the consistency check, it is the near-flush rule that catches it). On curved parts the consistency tolerance is the curved bar (3e-4 of the volume), so a dropped wall smaller than that on a curved part is NOT caught: documented limit.' });
const SLANT_TIMING = readIf('extrude-pocket-slant-timing.txt');
const WATCHDOG = readIf('extrude-pocket-watchdog.txt');
const slantSummary = (SLANT_TIMING ?? '').split('\n').filter((l) => /^sx-/.test(l)).map((l) => {
  const id = l.split(/\s+/)[0];
  const m = l.match(/\{.*\}/);
  if (m) { const j = JSON.parse(m[0]); return `${id} ${/^ERR/.test(j.result) ? `kernel error after ${j.wallS} s` : `${j.wallS} s`}`; }
  return /Unreachable/.test(l) ? `${id} wasm TRAP` : `${id} no result`;
}).join(', ');
const SLANT_NOTE = 'Slanted round tools are built as a solid.loft of two copies of the circle. Measured on the pinned truck (extrude-pocket-slant-timing.mjs: the exact command list the round-2 mapping would have sent, run once in a child process with a hard limit of 300 s; the box was at load average 25-48 on 24 cores, so every wall time is inflated): ' + (slantSummary || 'timing file missing') + '. So a slanted round cut into a part that already has a hole or a pocket either takes 30-45 s here, or is refused by the kernel with a raw error, or TRAPS the wasm (the call aborts with "Unreachable code should not be executed" and gives no result); into a plain block it takes 6-8 s. The critic measured 188 s and 48 s for two such crossings; those exact tools were not reproduced here (their sketch positions are not recorded) and the worst time seen here is 44 s, but the spread alone (5 s to 188 s, errors, traps) is the point. Round 2 guarded with a bounding-box test only (the tool must stay inside the part\'s box), which does not see a hole or a pocket INSIDE the box. ROUND 3 guard: a slanted round cut is only built into a PLAIN BLOCK (every piece has the volume of its own bounding box: no holes, pockets, steps, pads); anything else is refused in one sentence BEFORE the kernel runs, so no case is left that can take minutes. A slanted round pull that runs into another part, a cut into a body made from one, and a round tool that leaves the part\'s box are refused as before. A slanted POLYGON tool (planar faces) through the whole part is fine (sc-slant-poly-through, td-slant-*).' + (SLANT_TIMING ? `\nTIMING TABLE (contract/extrude-pocket-slant-timing.txt):\n${SLANT_TIMING}` : '');
row(PO('direction') + ' with a ROUND shape that stays inside the part (slanted bore ending inside, slanted round boss leaving the part)', (c) => ['sc-slant-circle-inside', 'sc-slant-circle-join-away', 'sc-slant-poly-through', 'kd-circle', 'sx-plain-block', 'sx-straight-cross', 'sx-straight-after-slant'].includes(c.id), { occt: BESPOKE, note: SLANT_NOTE + ' Controls: a straight round bore crossing the wall of an existing hole (sx-straight-cross), and a straight bore after a slanted one (sx-straight-after-slant) are fast and exact: the guard only concerns the slanted round tool.' });
row(PO('direction') + ' with a ROUND shape that runs out through a face of the part (slanted bore through the part, slanted round pull joined into the part) is refused', (c) => ['sc-slant-circle-exits-bottom', 'sc-slant-circle-exits-side', 'sc-slant-circle-join-hang', 'td-slant-circle'].includes(c.id), { occt: BESPOKE + '; here OCCT builds them, truck is the problem', note: SLANT_NOTE });
row(F_SLANTX, (c) => /^sx-(hole|pocket|pad)/.test(c.id), { occt: BESPOKE + '; here OCCT builds every one of them, truck is the problem', note: SLANT_NOTE,
  extra: () => 'WHY NOT A WALL-CLOCK LIMIT: sc.run is one synchronous wasm call; nothing in the process can stop it (a trap aborts the call, a slow one simply runs on), so the only protection is to refuse before calling it. The page may add a worker watchdog on top; the contract does not rely on it. MEASURED (extrude-pocket-watchdog.mjs, Bun worker_threads, NOT a browser): a slow list run in a Worker with an 8 s budget was terminated after 8.0 s, terminate() returned in 0.1 s, the host timer kept ticking (80 ticks of 100 ms) and a fresh Worker then built a box in 28 ms. Browser Worker.terminate() behaves the same by spec but was not measured here.\n' + (WATCHDOG ?? '') });
row('pull/pocket of a polygon that repeats a point (the same corner twice, or the first point again at the end) builds as the plain outline', (c) => /^od-(polygon-dup|polygon-closed|pocket-dup)/.test(c.id), { occt: 'live OCCT (occt-build refuses a repeated point); brep-rs builds them (7 faces for the square where 6 is right: a zero-length face); the closed form is the oracle',
  extra: (rs) => `${baselineLine(rs)} Round 2 refused every one of these with "sketch sk1 has no usable outline (outlineOf refused it)", the library's own text about an EDIT, applied to a valid outline.`,
  note: 'cleanSketch() in translate-ep.mjs drops repeated consecutive points (and the first point repeated at the end) of a plain polygon with no rules, rounds and chamfers follow their corner, then the normal mapping runs. Faces: the truck solid has 6 faces for the square (the repeat leaves no zero-length face).' });
row('pull/pocket of an outline with no area (a side of 0 mm, all points on one line, a circle of diameter 0) is refused in one plain sentence', (c) => /^od-(rect-zero|polygon-collinear|circle-zero)/.test(c.id), { occt: 'OCCT and brep-rs refuse too (or build an empty solid)',
  extra: (rs) => baselineLine(rs),
  note: 'The sentence says what is wrong (the outline is flat, 0 mm wide or tall, so there is no area) and what to do, and names no internal function. Round 2 gave rect(0,10) "has no usable outline (outlineOf refused it)".' });
row(F_ROWS, (c) => /^ro-/.test(c.id), { occt: 'OCCT: the occt-build soup path needs the rules, so it declines rows without them; brep-rs refuses rows without a coincident rule ("edge 1 has a loose end; the outline must close"); the closed form is the oracle',
  extra: (rs) => baselineLine(rs),
  note: 'DIFFERENCE FROM brep-rs, deliberately kept: four lines whose end points are exactly equal build the 6000 mm3 plate in the contract (soup-regions.mjs joins end points that are 1e-5 mm or closer), while brep-rs wants the coincident rules. The solid is right and equal to the same sketch drawn with the four rules, so it is not a wrong solid; it is a more permissive reading. A gap of 1e-4 mm is refused with a loose-end sentence like brep-rs, and a gap of 1e-6 mm (inside the 1e-5 join tolerance but too much for truck, which wants the loop exactly closed) is refused with "the outline does not close: two ends that should meet are a hair apart". This difference belongs to the sketch group too: the page should show the rows without rules as an unconstrained sketch.' });
row(F_LOFTFACE, (c) => /^lf-/.test(c.id), { occt: 'closed forms (oblique cylinder, lens integral for the hole); live OCCT is not an oracle for hole() in a slanted pull because occt-build ignores the direction',
  extra: (rs) => `Face types of the slanted round pull in truck: ${JSON.stringify(rs.find((r) => r.id === 'lf-slant-circle-pull')?.contract.measure?.faceTypes)} against ${JSON.stringify(rs.find((r) => r.id === 'lf-straight-circle-pull')?.contract.measure?.faceTypes)} for the straight pull: the side is a free-form surface, not a cylinder. Cut into by a pocket: refused (lf-slant-hole, sentence in the pocket rows). Bored by hole(): builds, ${ex(rs.find((r) => r.id === 'lf-slant-hole2')?.contract.vsRef?.dVol)} from the lens-integral closed form. Face and edge PICKS on such a body (round, shell, draft) belong to the picks and fillet groups and are not measured here; in this group the only dependents of a slanted round pull are a pocket (refused), a join that overlaps another part (refused) and hole() (builds).`,
  note: 'Accuracy: the volume of a curved solid is tessellation-derived, so 1e-4 (d10 circle, 785.3192 vs 785.3982) is the expected size and is not a wrong solid; the bar is 3e-4, the mapping refuses above it (curved solids row), and the rows quote the measured maxima rather than a rounded bar.' });

const TIMING = readIf('extrude-pocket-timing.txt');
const FLOORSWEEP = readIf('extrude-pocket-floor-sweep.txt');
const RAWTXT = readIf('extrude-pocket-raw.txt');
row(`${F_COUNT} -- up to 24 shapes: built`, (c) => c.feature === F_COUNT && (c.expect ?? 'build') !== 'refuse', { occt: 'closed form (area x depth)', extra: () => `TIME through the contract translator, one synchronous wasm call per step, no wall-clock limit inside the call (a Worker watchdog is the page's job, see the watchdog row): ${TIMING ? `\n${TIMING}` : '(extrude-pocket-timing.txt missing)'}`,
  note: 'ROUND 4. Round 3 let any number of shapes through with no bound (12 round holes took 78 s: the consistency check built ALL regions in every one of its N scratch sessions, and evenOddPicks re-tested every circle against itself). Now each scratch session builds ONE region and a circle is not tested against itself: 12 holes take about a quarter of the old time. The remaining cost is the kernel itself, roughly one second per round shape on this box under load, so the number of shapes is bounded (next row).' });
row(`${F_COUNT} -- over 24 shapes: refused`, (c) => c.feature === F_COUNT && (c.expect ?? 'build') === 'refuse', { occt: 'n/a (refused before the kernel runs)',
  note: 'The limit is a time budget, not a kernel failure and not a measured boundary: 24 round shapes were measured to build (the timing table above), nothing above 24 was measured, SolidCraft cannot be interrupted once sc.run is called, and the browser speed was NOT measured (see the browser-time row), so the translator refuses before any kernel call and says to split the shapes over two steps.' });
row(F_PADFLAT, (c) => /^pf-/.test(c.id), { occt: 'OCCT and brep-rs refuse or build an empty solid', extra: () => (RAWTXT ? `RAW SolidCraft with the same flat outline (extrude-pocket-raw.mjs):\n${RAWTXT.split('\n').filter((l) => /^flat/.test(l)).join('\n')}` : ''),
  note: 'A report said raw SolidCraft answers ok:true with ZERO bodies for collinear points; NOT REPRODUCED here: 3 and 4 collinear points, operation new and join, and 3 collinear lines drawn as rows with coincident rules are all refused by the kernel with the raw text "f has no closed profiles" (the shipped route shows that text to the student: "solidcraft refused it -- solid.extrude: ... has no closed profiles"). So the pad does not build a wrong solid; the contract only replaces the raw text with one plain sentence (the same sentence a pull on the same outline gets) and refuses before the kernel is called.' });
row(`${F_FLOOR} -- above 0.0001 mm: built`, (c) => c.feature === F_FLOOR && (c.expect ?? 'build') !== 'refuse', { occt: 'closed form (volume of plate minus tool)', extra: () => (FLOORSWEEP ? `RAW vs CONTRACT sweep (extrude-pocket-floor-sweep.mjs):\n${FLOORSWEEP}` : ''),
  note: 'These floors and steps are above the 0.0001 mm line the guard draws, and build exactly (11 faces for a floor, step volume g x 100).' });
row(`${F_FLOOR} -- refused (floors up to 0.0001 mm; join steps up to about 2.5e-5 of the part size, and every step the join-consistency check sees)`, (c) => c.feature === F_FLOOR && (c.expect ?? 'build') === 'refuse', { occt: 'closed form; live OCCT keeps every floor', extra: () => (FLOORSWEEP ? `RAW vs CONTRACT sweep (extrude-pocket-floor-sweep.mjs):\n${FLOORSWEEP}` : ''),
  note: 'CONSERVATIVE at exactly 1e-4: raw SolidCraft built a floor of 1e-4 mm exactly (see the sweep), but swallowed a WALL of 1e-4 mm (11599.996 with 10 faces against 11600 with 11) and wrong results appear at 1e-5 and below, so the guard draws one line at 1e-4 for floors, walls and steps. The sentence therefore says "closer than the 0.0001 mm this app can check reliably", not that SolidCraft cannot keep them apart.' });
row('curved solids: volume, mass and centre of mass accuracy against the size of the part (slender rods, big plates with small bores)', (c) => false, { occt: 'OCCT exact', special: 'slender',
  note: 'Truck\'s volume_mm3 is tessellation-derived; the error depends only on diag / (2 r) of the smallest round shape. Measured table in the evidence. The mapping refuses when the bound (table error x curved volume / part volume) exceeds 3e-4.' });

// ---- evidence ------------------------------------------------------------------------------------------------------------------------------
const REPRO = 'sh docs/spikes/solidcraft-referee/contract/extrude-pocket-repro.sh';
const CMDBASE = `SOLIDCRAFT_REFEREE_PKG=<solidcraft pkg dir, built as in contract/RIG.md "Measuring rig"> ${REPRO} measure`;
const rowsOut = [];
const assigned = new Set();
const shippedAgg = []; // per row definition: the shipped-route outcome, for the SHIPPED ROUTE rows
const normSentence = (x) => String(x).replace(/\b(pull|pocket|op|sk|b_pull|extrude)\d*\b/g, 'X').replace(/[-+]?\d+(\.\d+)?(e[-+]?\d+)?/g, 'N').replace(/^X: /, '');
const sentenceOfCase = (r) => (r.contract.refusals ?? [])[0]?.sentence ?? null;

function makeRow(def, rs, es, feature) {
  const status = statusOf(rs);
  const ids2 = rs.map((r) => r.id);
  const first = rs.find((r) => r.contract.measure && (r.expect ?? 'build') !== 'refuse') ?? rs[0];
  const parts = [];
  parts.push(`RE-RUN: ${CMDBASE} --only=${ids2.slice(0, 5).join(',')}${ids2.length > 5 ? ',...' : ''}   (${ids2.length} cases; all numbers in contract/ep-results.json, table in contract/ep-run.txt; cases in contract/extrude-pocket-cases{,-r2,-r3,-r4}.mjs; rig recipe: contract/RIG.md)`);
  parts.push(`script: ${first.script.length > 260 ? `${first.script.slice(0, 260)}...` : first.script}`);
  parts.push(`CONTRACT (translate-ep.mjs): ${tally(rs, klass).replace(/PASS/g, 'built correctly').replace(/OK_REFUSED/g, 'declined with a sentence, as it should be').replace(/BUILT_UNEXPECTED/g, 'BUILT where a refusal is right').replace(/WRONG/g, 'built WRONG').replace(/REFUSED/g, 'declined but should build')}. ${maxima(rs)}`);
  const bad = rs.filter((r) => ['WRONG', 'BUILT_UNEXPECTED', 'ERR', 'REFUSED'].includes(klass(r)));
  if (bad.length) parts.push(`NOT AS EXPECTED: ${bad.slice(0, 8).map((r) => `${r.id} [${klass(r)}] ${r.contract.measure ? `built ${r.contract.measure.volume.toFixed(4)} vs ${(r.analytic?.volume ?? r.occt?.volume)?.toFixed?.(4)}` : (r.contract.refusals?.[0]?.sentence ?? r.contract.error ?? '').slice(0, 160)}`).join(' | ')}${bad.length > 8 ? ` (+${bad.length - 8})` : ''}`);
  const ck = checksLine(rs); if (ck) parts.push(`AFTER-BUILD CHECKS: ${ck}.`);
  const ssAll = sentencesOf(rs.filter((r) => !r.contract.measure));
  const ss = ssAll.filter((x) => !/its target .* was refused/.test(x)); // a join that depends on a refused pull gets a follow-on line, not a second refusal
  if (ssAll.length > ss.length) parts.push(`FOLLOW-ON LINE (not a second refusal): the join/pocket that depends on the refused feature says "${ssAll.find((x) => /its target .* was refused/.test(x)).slice(0, 90)}..." so nothing is built on it.`);
  if (ss.length) parts.push(`SENTENCES a student sees (${ss.length}): ${ss.slice(0, 4).map((x) => `"${x}"`).join(' | ')}${ss.length > 4 ? ` (+${ss.length - 4} the same with other numbers)` : ''}.`);
  if (es.length) parts.push(`INTERPRETER refuses before any kernel: ${es.map((r) => `"${r.scriptError}"`).join(' | ')}.`);
  parts.push(`ORACLES: ${oracleLine(rs)}; ${def.occt}. ${brepLine(rs)}`);
  parts.push(`SHIPPED phase 7 translate-p4 as is (what the pane runs today; its own SHIPPED ROUTE rows are at the end): ${tally(rs, shippedKlass)}.`);
  if (def.extra) { const x = def.extra(rs); if (x) parts.push(x); }
  parts.push(def.note);
  const cs = ss.filter(Boolean);
  return { feature, status, refusalSentence: status === 'refused' || status === 'wrong' ? (cs[0] ?? '') : '', evidence: parts.join(' ') };
}
for (const def of ROWS) {
  let rs = cases.filter(def.pick);
  for (const id of def.extraIds ?? []) if (byId.has(id) && !rs.includes(byId.get(id))) rs.push(byId.get(id));
  const es = scriptErrors.filter(def.pick);
  rs.forEach((r) => assigned.add(r.id));
  if (def.special === 'slender') {
    if (!slender) { rowsOut.push({ feature: def.feature, status: 'unsupported', refusalSentence: '', evidence: 'not measured: extrude-pocket-slender-results.json is missing' }); continue; }
    // ROUND 3: say what 'supported' means for a curved volume in numbers, over every built curved case of this file
    const cm = cases.filter((r) => r.contract.measure && r.curved && r.contract.vsRef && (r.expect ?? 'build') !== 'refuse').sort((a, b) => b.contract.vsRef.dVol - a.contract.vsRef.dVol);
    const med = cm.map((r) => r.contract.vsRef.dVol).sort((a, b) => a - b)[Math.floor(cm.length / 2)];
    const bar = `ACCURACY BAR, in numbers over all ${cm.length} built curved cases of this group (closed form or live OCCT as the reference): median volume error ${ex(med)}, worst ${ex(cm[0]?.contract.vsRef.dVol)} (${cm[0]?.id}); ${cm.filter((r) => r.contract.vsRef.dVol > 1e-4).length} of them are above 1e-4: ${cm.filter((r) => r.contract.vsRef.dVol > 1e-4).map((r) => `${r.id} ${ex(r.contract.vsRef.dVol)}`).join(', ') || 'none'}.`;
    const ev = slender.evidence.replace(/SOLIDCRAFT_REFEREE_PKG=\$S\/sc-referee-pkg systemd-run[^b]*bun docs/, 'SOLIDCRAFT_REFEREE_PKG=<pkg, see contract/RIG.md> bun docs');
    // ROUND 4: ONE outcome per row. The curved volume of the solids that are built, and the policy refusal of a valid slender part, are two rows.
    rowsOut.push({ feature: 'curved solids: volume, mass and centre of mass of the parts that are built (squat to slender: error table by diag / (2 r), refused above 3e-4)', status: 'supported', refusalSentence: '', evidence: `${ev}\n${bar}` });
    rowsOut.push({ feature: 'POLICY REFUSAL, solid is right: a valid slender round part (d10 x h400 and beyond, a small bore in a huge plate) whose volume and mass readout would be off by more than 3e-4 is refused', status: 'refused', refusalSentence: slender.sentence ?? '',
      evidence: `POLICY, not a kernel failure: the solid truck builds is the right shape (faces, edges and bounding box agree with OCCT); only its tessellation-derived volume/mass/centre-of-mass readout is slightly off (d10 x h400: -2.5e-4, bar 3e-4 after the table bound 0.031%), and the contract prefers a refusal to a readout it cannot stand behind. Cases and the table: the row above and ${slender.rows.filter((q) => q.contract === 'REFUSED').length} refused rows in contract/extrude-pocket-slender-results.json.\n${ev}` });
    continue;
  }
  if (!rs.length) { console.error('NO CASES for', def.feature); continue; }
  // ROUND 4: ONE refusal sentence per row. A refused row whose cases are declined with more than one sentence is split by sentence.
  const allRefusing = rs.every((r) => (r.expect ?? 'build') === 'refuse') && statusOf(rs) === 'refused';
  const groups = new Map();
  if (allRefusing) for (const r of rs) { const k = normSentence(sentenceOfCase(r) ?? '(no sentence)'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  shippedAgg.push({ def, rs });
  if (allRefusing && groups.size > 1) {
    let n = 0;
    for (const [k, g] of groups) {
      n++;
      rowsOut.push(makeRow(def, g, es.filter((e) => g.some((r) => r.id === e.id)), `${def.feature} -- REFUSAL ${n} of ${groups.size}: ${k.slice(0, 110)}`));
    }
    continue;
  }
  rowsOut.push(makeRow(def, rs, es, def.feature));
}
// unaccounted cases
const loose = cases.filter((c) => !assigned.has(c.id));
if (loose.length) console.error('UNASSIGNED CASES:', loose.map((c) => c.id).join(', '));

// ---- rows that are not case groups: option-key lint, taper fuzz --------------------------------------------------------------------------------
const lintPath = path.join(HERE, 'extrude-pocket-lint.txt');
if (existsSync(lintPath)) {
  const lt = readFileSync(lintPath, 'utf8');
  rowsOut.push({
    feature: 'an unknown key in the options of pull() / pocket() ({ twist: 5 }, { through: true } on a pull, { deep: true } on a pocket)', status: 'refused',
    refusalSentence: 'pull() has no option called twist. pull() takes midplane, length2, reversed, taper, direction, alongNormal.',
    evidence: `RE-RUN: sh docs/spikes/solidcraft-referee/contract/extrude-pocket-repro.sh lint > contract/extrude-pocket-lint.txt. The interpreter (packages/script, read-only here) refuses the script with "pull() takes a sketch and a height; the third argument (a { } object) was ignored. To move the result, use move(...)." for any unknown key: the script FAILS (not "ignored") and the sentence never names the key, nor says that through is a pocket option. contract/option-lint.mjs reads the call out of the script text on exactly that error and names the key and the options the call takes (5 scripts below, 3 pull and 2 pocket forms, the extrude alias included). Needs adopting on the page: the interpreter\'s own sentence can only be replaced there. Measured:\n${lt.trim()}`,
  });
}
const censusTxt = readIf('extrude-pocket-census.txt');
const allSentences = cases.flatMap((r) => (r.contract.refusals ?? []).map((x) => x.sentence));
const BANNED = [/choose One sided/i, /rows and rules/i, /phase 0/i, /solidcraft refused it/i, /solid\.extrude/, /boolean Cut/, /pushing a face/, /\(extrude\)/, /\(pocket\)/, /not mapped/i];
const census = `${allSentences.length} refusal sentences over ${new Set(allSentences.map((x) => x.replace(/[-+]?\d+(\.\d+)?(e[-+]?\d+)?/g, 'N'))).size} distinct shapes, ${allSentences.filter((x) => BANNED.some((b) => b.test(x))).length} contain a banned phrase (${BANNED.map((b) => b.source).join(' | ')})`;
if (existsSync(lintPath)) {
  const lt = readFileSync(lintPath, 'utf8');
  const half = lt.slice(lt.indexOf('--- raw solidcraft errors'));
  rowsOut.push({
    feature: 'a pull or pocket that SolidCraft itself refuses after the mapping let it through (raw kernel text such as "solid.extrude: boolean Cut: the operation failed: no result; ... pushing a face: a neighbouring face is not perpendicular")', status: 'refused',
    refusalSentence: 'pocket1: this pocket cannot be built from the sketch as drawn (the solid it makes does not close up cleanly), so nothing is cut; change the sketch, the length or the options',
    evidence: `RE-RUN: sh docs/spikes/solidcraft-referee/contract/extrude-pocket-repro.sh lint (second half of contract/extrude-pocket-lint.txt). Round 1 handed the student the kernel's own text ("pull1 (extrude): solidcraft refused it -- solid.extrude: invalid input: the taper closes the profile", and the "boolean Cut ... pushing a face" line). translate-ep.mjs plainKernelSentence maps every raw error to one plain sentence without the kernel's words, the internal feature kind or UI wording the script language does not have; the raw text stays in the note's \`failed\` field for the evidence only. Every refusal sentence of the ${cases.length} measured cases is checked for the old phrases ("choose One sided", "rows and rules", "phase 0", "solidcraft refused it") in the sentence census: ${census}. ROUND 3: that census only sampled the measured pull/pocket cases, so a join (pad) refusal and the planFeature fallbacks ("(kind): translator error: ...", "(kind): solidcraft refused it -- ...") were never looked at. Fixed: plainKernelSentence has no raw-text branch left (the last line used to be \`\${f.id} (\${f.kind}): solidcraft refused it -- \${r}\`), a thrown translator error becomes a plain sentence (the message stays in the note's internalError), the join refusal text is mapped, and extrude-pocket-census.mjs pushes every distinct raw SolidCraft message found anywhere under docs/spikes/solidcraft-referee through plainKernelSentence for 19 feature kinds and checks 25 banned patterns. Census output:\n${censusTxt ?? '(extrude-pocket-census.txt missing)'}\nMeasured (lint):\n${half.trim()}`,
  });
}
if (fuzz) {
  const s = fuzz.summary;
  const fz4 = jsonIf('extrude-pocket-taper-fuzz-results-r4.json');
  rowsOut.push({
    feature: 'taper fold guard, validated on random outlines against live OCCT (FUZZ)', status: s.builtWrong === 0 ? 'supported' : 'wrong', refusalSentence: '',
    evidence: `RE-RUN: SOLIDCRAFT_REFEREE_PKG=<pkg, contract/RIG.md> sh docs/spikes/solidcraft-referee/contract/extrude-pocket-repro.sh taperfuzz --n=${s.nPerSeed} --seed=${s.seeds[0]} and --seed=${s.seeds[1]} (merged results: contract/extrude-pocket-taper-fuzz-results.json). ${s.n} random simple polygons (${s.nPerSeed} per seed) (random star-shaped, rectangles, L, U, T, C) x random taper (2..20 degrees half the time, 3..65 the other half, both signs) x random height. Truth by OCCT: the area of the outline offset by d(t) as OCCT's own 2-D offset gives it (handles splits and collapses) against the area of the plain vertex-moved polygon (what a ruled loft builds) at 64 heights; equal everywhere = event-free = the loft is the true solid. Result: built and event-free with volume equal to the OCCT integral to 1e-9: ${s.builtRight}; refused and the taper does hit an event: ${s.refusedRight}; BUILT THROUGH AN EVENT (a wrong solid the guard missed): ${s.builtWrong}; refused though event-free (over-refusal, safe): ${s.refusedOver}; refused for another reason: ${s.other}; skipped because OCCT's own offset returned nothing at the first step (no oracle for that outline): ${s.oracleFailed ?? 0}. ${fz4 ? `ROUND 4 RE-RUN with the round-4 translator, seed ${fz4.summary.seed ?? 3}, n=${fz4.summary.n}: ${JSON.stringify(fz4.summary)}.` : ''}`,
  });
}


if (SOUPFUZZ) {
  const q = SOUPFUZZ.summary;
  rowsOut.push({ feature: 'taper guard for holes and several shapes, validated on random sketches against live OCCT offsets and booleans (FUZZ)', status: q.builtWrong === 0 ? 'supported' : 'wrong', refusalSentence: '',
    evidence: `RE-RUN: SOLIDCRAFT_REFEREE_PKG=<pkg, contract/RIG.md> sh docs/spikes/solidcraft-referee/contract/extrude-pocket-repro.sh softfuzz --n=${q.n} --seed=${q.seed} (results: contract/extrude-pocket-taper-soup-fuzz-results.json). ${q.n} random sketches (a star or box with 1-2 holes, 2-3 disjoint polygons, a frame with a block in its hole), random taper -25..25 degrees and height 3..21. Truth is decided by live OCCT, not by the guard: BRepOffsetAPI_MakeOffset area per loop against the vertex-moved polygon at 64 heights, and BRepAlgoAPI_Common of the offset faces for every pair of loops (nesting must not change). Counts: ${q.builtRight} built correctly (volume equals the OCCT Simpson integral to 1e-9), ${q.refusedRight} refused and the taper really hits an event, ${q.builtWrong} BUILT WRONG, ${q.refusedOver} refused though event-free (over-refusal, safe: the guard keeps 0.001 mm clear), ${q.other} refused for another reason. By kind: ${JSON.stringify(q.byKind)}.` });
}
// ---- ROUND 4 rows that are not case groups ----------------------------------------------------------------------------------------------------
// (1) the interpreter's own refusals, one row each, with the sentence a student sees
const SCRIPT_ROWS = {
  'pl-both-midplane': 'pull options midplane and length2 together -- refused by the interpreter, before any translator or kernel',
  'pl-zero-length2': 'pull option length2 that is zero or negative -- refused by the interpreter',
  'pt-90': 'pull option taper of 90 degrees or more (outside -90 .. 90) -- refused by the interpreter',
  'pd-alongnormal-alone': 'pull option alongNormal without a direction -- refused by the interpreter',
  'pd-zero-vector': 'pull option direction [0, 0, 0] (points nowhere) -- refused by the interpreter',
  'fc-pocket-depth-negative': 'pocket depth that is negative -- refused by the interpreter',
  'fc-pocket-depth-zero': 'pocket depth that is zero -- refused by the interpreter',
};
for (const e of scriptErrors) {
  const label = SCRIPT_ROWS[e.id];
  if (!label) continue;
  rowsOut.push({ feature: label, status: 'refused', refusalSentence: e.scriptError,
    evidence: `RE-RUN: ${CMDBASE} --only=${e.id}   (the sentence comes from runScript in packages/script, read-only here; no wasm is needed for this case). script: ${e.script}. Result: runScript returns the error "${e.scriptError}" and no ModelDoc, so neither the translator nor SolidCraft is ever called. Measured on ${new Date().toISOString().slice(0, 10)}. Round 3 listed these sentences only in extrude-pocket.meta.json scriptErrors.` });
}
// (2) wall clock in a browser: not measured
rowsOut.push({ feature: 'wall-clock time of a pull or pocket INSIDE THE BROWSER PANE (Worker, 23 MB wasm, one synchronous sc.run per step)', status: 'unsupported', refusalSentence: '',
  evidence: `NOT MEASURED in a browser: every figure in this file is Bun ${Bun.version} on a 24-core box that was shared with other jobs, at load average 24 to 110 over the runs (the load average of the timing run is on the first line of extrude-pocket-timing.txt), so the browser speed, the page's own watchdog budget and what a student sees at the 8 s mark are unknown. What IS measured: the watchdog mechanism (a Worker killed by a budget while sc.run is inside the kernel; a fresh Worker still works) in Bun: ${WATCHDOG ? WATCHDOG.replace(/\s+/g, ' ').slice(0, 900) : 'extrude-pocket-watchdog.txt missing'}. The kill sentence above is written by the watchdog probe (the page would show it), translate-ep.mjs does not produce it. The translator itself bounds the work BEFORE the call: at most 24 shapes per pull/pocket (rows above), slanted round cuts only into a plain block that end inside the part, and the consistency sessions are one region each.` });
// (3) wiring: nothing outside contract/ uses the guard modules
{
  const root = path.join(HERE, '..', '..', '..', '..');
  const GUARDS = ['translate-ep', 'outline-guard', 'soup-regions', 'option-lint'];
  const hits = new Map(); const p4 = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'archive'].includes(ent.name)) continue;
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (fp === HERE) continue; walk(fp); continue; }
      if (!/\.(m?js|ts|tsx|html|json|sh)$/.test(ent.name) || statSync(fp).size > 2e6) continue;
      const t = readFileSync(fp, 'utf8');
      for (const g of GUARDS) if (t.includes(g)) { if (!hits.has(fp)) hits.set(fp, []); hits.get(fp).push(g); }
      if (t.includes('translate-p4') && /phase7/.test(fp)) p4.push(path.relative(root, fp));
    }
  };
  for (const d of ['docs/spikes', 'packages', 'scripts']) walk(path.join(root, d));
  const outside = [...hits.entries()].map(([f, g]) => `${path.relative(root, f)} (${[...new Set(g)].join(', ')})`);
  rowsOut.push({ feature: 'WIRING: the contract guard modules (translate-ep, outline-guard, soup-regions, option-lint) are what the pane and the product run', status: 'unsupported', refusalSentence: '',
    evidence: `NOT WIRED. Every status above that is not marked SHIPPED ROUTE or RAW describes the contract mapping in contract/, and nothing outside contract/ imports it. Scan done by this script at synthesis time (files under docs/spikes, packages, scripts that mention translate-ep / outline-guard / soup-regions / option-lint, excluding contract/ itself): ${outside.length ? outside.join('; ') : 'none'}. The pane still imports the phase 7 translator: files naming translate-p4 under phase7: ${p4.join(', ') || 'none'}. I may write only under contract/, so the swap is NOT done here. To adopt: point the pane's import of phase7/pane/lib/translate-p4.mjs at contract/translate-ep.mjs (same translateDoc(doc, {arc, mt, runSC, resolveAt}) signature, measured through extrude-pocket-measure.mjs), keep outline-guard.mjs, soup-regions.mjs and option-lint.mjs next to it, and run each step in a Worker with the page's watchdog. Until then AGENTS.md "never a silently wrong solid" does NOT hold for the product in the rows below.` });
}
// (4) the shipped route, per feature row: the dangerous status
{
  const wrongRows = []; const unmapped = [];
  for (const { def, rs } of shippedAgg) {
    const ks = rs.map((r) => ({ r, k: shippedKlass(r) }));
    const bad = ks.filter((x) => x.k === 'built-WRONG' || x.k === 'built-where-a-refusal-is-right');
    const notBuilt = ks.filter((x) => x.k === 'refused-or-not-mapped' && x.r.contract.measure);
    if (bad.length) wrongRows.push({ def, rs, bad, tot: ks.length });
    if (notBuilt.length) unmapped.push({ def, n: notBuilt.length, tot: ks.length });
  }
  const CAT = (f) => (/soup|multi-loop|holes or several|several shapes|sketch with holes/i.test(f) ? 'holes and several shapes in one sketch'
    : /thin walls|floors and join steps|too small|smallest sizes/i.test(f) ? 'slivers, thin walls and tiny sizes'
    : /through/i.test(f) ? 'through-all pockets'
    : /taper/i.test(f) ? 'taper'
    : /direction|alongNormal|slanted|ROUND shape/i.test(f) ? 'direction and slanted tools'
    : /touches nothing|sealed|reversed|midplane|length2/i.test(f) ? 'pocket options reversed / midplane / length2, and pockets that touch nothing or seal a void'
    : /join|pad/i.test(f) ? 'pads and joins that only touch'
    : /outline|bow-tie|repeats a point/i.test(f) ? 'outlines that cross themselves or have no area'
    : 'other');
  const cats = new Map();
  for (const w of wrongRows) { const k = CAT(w.def.feature); if (!cats.has(k)) cats.set(k, []); cats.get(k).push(w); }
  for (const [k, ws] of cats) {
    const bad = ws.flatMap((w) => w.bad);
    const tot = ws.reduce((a, w) => a + w.tot, 0);
    const why = (r) => { const q = r.shipped.vsRef; if (!r.shipped.measure || !q) return ''; const bits = []; if (q.dVol > q.tol) bits.push(`volume off ${ex(q.dVol)}`); if (q.dBbox !== null && q.dBbox > q.tol) bits.push(`bounding box off ${ex(q.dBbox)}`); if (q.dCom !== null && q.dCom > q.comTol) bits.push(`centre of mass off ${ex(q.dCom)}`); return bits.length ? ` [${bits.join(', ')}]` : ''; };
    const ex6 = bad.slice(0, 6).map(({ r }) => `${r.id}: shipped ${r.shipped.measure ? r.shipped.measure.volume.toFixed(4) : '-'} against ${(r.analytic?.volume ?? r.occt?.volume)?.toFixed?.(4) ?? 'a refusal'}${(r.expect ?? 'build') === 'refuse' ? ' (should be refused)' : ''}${why(r)}`).join(' | ');
    rowsOut.push({ feature: `SHIPPED ROUTE (phase7 translate-p4, what the pane builds today) builds WRONG SOLIDS: ${k}`, status: 'wrong', refusalSentence: '',
      evidence: `RE-RUN: ${CMDBASE} --only=${bad.slice(0, 5).map((x) => x.r.id).join(',')}.  ${bad.length} of ${tot} cases in ${ws.length} feature row(s) of this group build wrong, or build where a refusal is right, through the shipped translator: ${ex6}${bad.length > 6 ? ` (+${bad.length - 6} more in ep-results.json, field shipped)` : ''}. Per feature row: ${ws.map((w) => `${w.def.feature.slice(0, 80)} [${w.bad.length}/${w.tot}]`).join('; ')}. Same cases through the contract mapping: ${tally(ws.flatMap((w) => w.rs), klass).replace(/PASS/g, 'built correctly').replace(/OK_REFUSED/g, 'declined with a sentence').replace(/REFUSED/g, 'declined (should build)').replace(/WRONG/g, 'built WRONG')}. The contract rows of the same features name the guard that fixes each one; none of it is wired (WIRING row).` });
  }
  rowsOut.push({ feature: 'SHIPPED ROUTE (phase7 translate-p4): features it does not map, so a student gets a refusal or nothing where the contract builds a correct solid', status: 'unsupported', refusalSentence: '',
    evidence: `RE-RUN: ${CMDBASE}. Per feature row, cases the contract builds correctly that the shipped translator declines or does not map: ${unmapped.map((u) => `${u.def.feature.slice(0, 70)} ${u.n}/${u.tot}`).join('; ') || 'none'}. (A refusal is honest; it is listed as unsupported for the shipped route because no sentence is guaranteed to be a plain one.)` });
}
// (5) raw kernel wrongness, in the statuses (not only in prose)
if (RAWTXT) {
  const lines = RAWTXT.split('\n').filter((l) => l && !l.startsWith('#'));
  const groups = new Map();
  for (const l of lines) { const k = l.split(' | ')[0]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  const LABEL = { 'soup-hole': 'a loop standing inside another is a hole', 'soup-nested3': 'three nested squares are frame + block', 'taper-fold': 'a taper that folds the outline', 'direction-array': 'a direction array on solid.extrude', wall: 'a pocket that leaves a thin wall', flat: 'a pad on a flat (collinear) outline', 'loft-hole': 'a loft of a holed profile (the slanted pull)' };
  for (const [k, ls] of groups) {
    const wrong = ls.filter((l) => /WRONG/.test(l)).length;
    if (!wrong) continue; // a group where the kernel refuses (the flat pad) is cited by its own contract row, it is not a wrong-solid row
    rowsOut.push({ feature: `RAW SOLIDCRAFT, no translator, no guard: ${LABEL[k] ?? k}`, status: wrong ? 'wrong' : 'supported', refusalSentence: '',
      evidence: `RE-RUN: SOLIDCRAFT_REFEREE_PKG=<pkg, contract/RIG.md> ${REPRO} raw   (hand-written solid.* command lists straight into sc.run, closed form for the exact answer; file: contract/extrude-pocket-raw.txt). ${wrong} of ${ls.length} lines WRONG:\n${ls.join('\n')}\nThis is what the kernel does with nothing in front of it. The guard layer (contract rows above) refuses or corrects each one; with the pane still on translate-p4 only part of it applies (SHIPPED ROUTE rows).` });
  }
}
// (6) language reference (brep-rs) vs contract: through + midplane
{
  const tm = cases.filter((r) => /^(tm-mid|tm3-)/.test(r.id) && r.contract.measure && r.brep?.volume !== undefined);
  const dis = tm.filter((r) => Math.abs(r.brep.volume - r.contract.measure.volume) > (r.curved ? 3e-4 : 1e-6) * Math.max(1, r.contract.measure.volume)); // curved volumes are tessellation-derived: 3e-4 is the bar, a smaller difference is not a disagreement
  if (tm.length) {
    rowsOut.push({ feature: 'REFERENCE CONFLICT: pocket through:true + midplane on a front or side sketch -- the language reference (brep-rs) and the contract mapping disagree; settled for the contract (closed form + live OCCT)', status: 'supported', refusalSentence: '',
      evidence: `RE-RUN: ${CMDBASE} --only=${tm.slice(0, 6).map((r) => r.id).join(',')}.  ${tm.length} through+midplane cases where both build: brep-rs disagrees with the contract (beyond 1e-6 planar / 3e-4 curved) in ${dis.length}: ${dis.slice(0, 8).map((r) => `${r.id} contract ${r.contract.measure.volume.toFixed(4)} (closed form ${(r.analytic?.volume ?? r.occt?.volume)?.toFixed?.(4)}) vs brep-rs ${r.brep.volume.toFixed(4)}`).join(' | ')}. No saved FreeCAD result arbitrates. The mapping follows the closed form and live OCCT (the whole part cut both ways); brep-rs (archive/, read-only) is NOT an oracle for this combination, so the language reference text for through+midplane on a non-top plane has to be corrected to the closed form (the contract volumes listed above equal it) before the layer ships; this row is the decision, not a measurement of brep-rs.` });
  }
}

const out = {
  group: 'extrude-pocket', measuredOn: new Date().toISOString().slice(0, 10), round: 4,
  rig: 'SolidCraft fe3717f (truck) via contract/RIG.md; the status is the CONTRACT mapping = contract/translate-ep.mjs + outline-guard.mjs + soup-regions.mjs + option-lint.mjs (NOT WIRED into the pane: see the WIRING row); rows marked SHIPPED ROUTE describe phase7/pane/lib/translate-p4.mjs as the pane runs it today, rows marked RAW SOLIDCRAFT describe the kernel with no translator',
  statusMeaning: 'ONE status and ONE outcome per row: supported | refused | wrong | unsupported. Plain rows describe the CONTRACT mapping (contract/translate-ep.mjs + guards); a row starting SHIPPED ROUTE describes the phase 7 translator the pane runs today; a row starting RAW SOLIDCRAFT describes the kernel with nothing in front of it; a row starting POLICY REFUSAL is refused although the kernel builds a correct solid. A refused row has exactly one sentence.',
  cases: cases.length, scriptErrors: scriptErrors.map((r) => ({ id: r.id, sentence: r.scriptError })), rows: rowsOut,
};
const { rows: finalRows, ...meta } = out;
writeFileSync(path.join(HERE, 'extrude-pocket.json'), JSON.stringify({ group: 'extrude-pocket', rows: finalRows }, null, 1));
writeFileSync(path.join(HERE, 'extrude-pocket.meta.json'), JSON.stringify(meta, null, 1));
for (const r of rowsOut) console.log(r.status.padEnd(11), r.feature.slice(0, 150));
console.log('wrote extrude-pocket.json');
