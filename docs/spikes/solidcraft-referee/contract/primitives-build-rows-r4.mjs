// SPIKE, referee only. Builds contract/primitives.json (round 4) from: the round 3 rows (primitives-evidence/primitives.round3.json, text kept where it is still true),
// the recorded UNGUARDED kernel results of every input ever measured for this group (primitives-r4/truth.mjs, with the CURRENT guard applied offline),
// and the round 4 sweeps (primitives-r4/results/*.json). Every count and every number quoted for a changed row is computed here; the builder asserts the status of
// each row against that data before it writes anything.
//   bun contract/primitives-build-rows-r4.mjs
//
// STATUS RULE (round 4): the status field is what the PRODUCT does TODAY with the input class, not what a guard prototype would do.
//   supported   builds and matches the oracle inside the stated envelope
//   refused     a plain sentence is shown today (the interpreter's, or a sentence that is true)
//   unsupported nothing in the product handles it: no sentence, or truck's kernel text (jargon), or a requirement that was not measured
//   wrong       builds a solid that disagrees with the oracle (or with what was typed) with status built and no sentence: the dangerous class
// A class that the prototype guard (contract/primitives.guard.mjs, NOT wired: packages/script is read-only here) turns into a plain sentence keeps the sentence in
// refusalSentence, so the contract says what the integrated layer must show; the status still says what happens until it is wired.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB, ship, refusedBy, why, kernelText, G, L, outcome, runSides } from './primitives-r4/truth.mjs';
import * as A from './primitives-r4/analyze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OLD = JSON.parse(readFileSync(path.join(HERE, 'primitives-evidence', 'primitives.round3.json'), 'utf8'));
const old = (n) => OLD.rows[n - 1];
const rows = [];
const PARTIAL = !!process.env.PARTIAL;
const assert = (c, m) => { if (!c) { if (PARTIAL) console.log('PARTIAL: skipped check: ' + m); else throw new Error('ROW CHECK FAILED: ' + m); } };
const ex = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toExponential(d) : 'n/a');
const sec = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${Math.round(ms)} ms`);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const add = (feature, status, evidence, refusalSentence) => { const r = { feature, status }; if (refusalSentence) r.refusalSentence = refusalSentence; r.evidence = evidence; rows.push(r); };
const keep = (n) => old(n).evidence;
const R3 = (t) => `ROUND 3 EVIDENCE (kept for its measured numbers; the guard constants named in it were replaced in round 4 where the header says so): ${t}`;


// ---- round 4b helpers: tables over the E22..E27 results
const resOr = (n) => A.res(n) ?? [];
const okTxt = (rs) => { const w = rs.filter((r) => r.status === 'built' && !r.good); const dv = (r) => r.truck?.dVolOcct ?? r.truck?.dVolAn ?? 0; return `${rs.filter((r) => r.status === 'built' && r.good).length}/${rs.length} correct${w.length ? ` (${w.length} WRONG: ${w.slice(0, 3).map((r) => why({ r, o: 'wrong' })).join(' | ')}${w.length > 3 ? ' ...' : ''}; worst volume ${ex(Math.max(...w.map(dv)))})` : ''}`; };
const e27 = () => { const x = A.res('e27-pin-rules'); assert(x, 'e27 results'); return x ?? []; };

const GUARD = ' GUARD: contract/primitives.guard.mjs, a PROTOTYPE that nothing in the product calls (packages/script is read-only here): the status above is what the product does today, refusalSentence is what the integrated layer must show.';
const CMD = (spec) => ` Spec: contract/primitives-r4/${spec}.mjs, run as in RIG.md 'primitives group, round 4'; results in contract/primitives-r4/results/.`;

// ---- the re-score header, computed ----------------------------------------------------------------------------------------------------------
function header(codes, extraEntries = []) {
  const es = [...refusedBy(...codes), ...extraEntries];
  const s = ship(es);
  const ex5 = (a) => a.slice(0, 5).map((e) => `${e.r.id}${why(e) ? ': ' + why(e) : ''}`).join('; ') + (a.length > 5 ? '; ...' : '');
  const kt = [...new Set(s.kernel.map((e) => kernelText(e)).filter(Boolean))].slice(0, 3);
  const parts = [];
  if (s.wrong.length) parts.push(`${s.wrong.length} built a WRONG solid with status built and no sentence (${ex5(s.wrong)})`);
  if (s.unverified.length) parts.push(`${s.unverified.length} built a solid that no oracle can confirm (${s.unverified.slice(0, 4).map((e) => e.r.id).join(', ')})`);
  if (s.kernel.length) parts.push(`${s.kernel.length} were refused by truck in kernel text, which a student cannot read (${kt.map((t) => `"${t}"`).join(' / ')})`);
  if (s.interp.length) parts.push(`${s.interp.length} were refused by the interpreter`);
  if (s.good.length) parts.push(`${s.good.length} built a correct solid and are refused on purpose by the guard (edge margin, the cost of the rule)`);
  return { s, text: `ROUND 4 RE-SCORE, offline (the recorded UNGUARDED kernel result of every input in this class, the CURRENT guard rule ${codes.join(' / ')} applied now): ${s.n} distinct recorded inputs; AS SHIPPED ${parts.join('; ') || 'none built'}.` };
}
function status(h, forced) {
  if (forced) return forced;
  return h.s.status;
}

// =====================================================================================================================================
// BOX
// =====================================================================================================================================
const e14 = A.e14(); assert(e14, 'e14 results');
const SUPPORTED_NOTE = ' Inside the placement and size rules below (a supported row is supported only for inputs that none of the wrong-solid rows below catches: "placed far from the origin", "big and far", "size", "long and thin", the rounded plate and disc rows, and the three turned / flat cone rows).';
add('box(w,d,h) / cuboid', 'supported', keep(1) + SUPPORTED_NOTE);
add('box option at:[x,y,z]', 'supported', keep(2) + ' Limit: the at position is bounded by the "placed far from the origin" row; a small box far from the origin is a WRONG solid as shipped.');
add('box doc-level rotate (script turn(box,[rx,ry,rz]))', 'supported', keep(3) + ' Limit: a turned box far from the origin is bounded by the same "placed far" row.');
{
  const fl = (s) => e14.box[s].join(' ');
  add('box option corner:r (whole-shape round): corner from 1e-4 x the longest side up to half the shortest side x (1 - 1e-4), shortest side at least 1', 'supported',
    keep(4) + ` ROUND 4 LOWER BOUND (E14, primitives-r4/e14-corner-floor.mjs, ${Object.values(e14.box).flat().length} cases): box(1.5s, 2s, s) with a tiny corner, per shortest side s, corner:outcome (ok = 26 faces and inside the bars, 18f = 18 faces against OCCT's 26, REF = truck refused in kernel text): s 1.2: ${fl('1.2')} | s 12: ${fl('12')} | s 120: ${fl('120')} | s 1200: ${fl('1200')}. The bands are dropped below about 3e-6 x the shortest side whatever the size, so the guard floor is 1e-4 x the LONGEST side (at least 12x above the last wrong cell). The volume stays right (dVol <= 2e-6) while the faces go: only the face-count check sees it.`
    + CMD('e14-corner-floor'));
  const hs = header(['box-corner-too-big']);
  add('box option corner within 1e-4 (relative) of half the shortest side, at half, or above it', status(hs, null), hs.text + ' ' + R3(old(5).evidence.replace(/GUARD RUN:[^]*?MEASURED EDGE/, 'MEASURED EDGE')) + GUARD, 'box(12, 20, 30, { corner: 6 }): the corner is too big -- the rounding would not fit and the box would be built the wrong size, so it has to be 5.999 or less, a little under half of the shortest side (12).');
  const hl = header(['box-corner-too-small']);
  assert(hl.s.wrong.length > 0, 'box corner too small has wrong');
  add('box option corner below 1e-4 x the longest side (down to 1e-5, 1e-6, 1e-7)', status(hl, null),
    hl.text + ` MEASURED (E14, cells in the corner row above): some of the 26 faces are silently dropped (18 faces, volume still right) from corner 3e-6 x the shortest side, and truck refuses 1e-6 and below with ${e14.refusedTexts.map((t) => `"${t}"`).join(' / ')}. The critic's cases box(40,30,20,{corner:1e-5}) (18 faces against 26) and corner 1e-6 / 1e-7 (kernel text) are in this class.` + GUARD + CMD('e14-corner-floor'),
    'box(40, 30, 20, { corner: 1.00 x 10^-5 }): the corner is too small -- some of the rounded edges would be left out of the part, so it has to be at least 0.004, one ten-thousandth of the longest side (40).');
  const hc = header(['box-chamfer']);
  add('box corner with chamfer style (ModelDoc roundStyle: chamfer; script bevel(box,d) is refused by the interpreter)', status(hc, null), hc.text + ' ' + R3(old(6).evidence.replace(/GUARD RUN:[^]*?Why:/, 'Why:')) + GUARD, 'box(): a chamfer on every edge of a box is not available because it would be built with its corners cut wrongly -- use corner for a rounded box, or leave the edges square.');
}

// =====================================================================================================================================
// CYLINDER
// =====================================================================================================================================
add('cylinder(across,tall)', 'supported', keep(7) + SUPPORTED_NOTE);
add('cylinder option at', 'supported', keep(8) + ' Limit: the "placed far from the origin" row (curved shapes: 400 x the smallest size).');
add('cylinder doc-level rotate (script turn)', 'supported', keep(9));
{
  const cells = A.e15(); assert(cells.length > 10, 'e15 cells');
  const tbl = cells.filter((c) => /corner$/.test(c.k)).map((c) => `${c.k.replace(' corner', '')}: wrong up to leftover ${c.maxBad ?? '-'}, right from ${c.minGood ?? '-'}`).join(' | ');
  add('cylinder option corner:r (both rims rounded): corner at most (R - 0.01 x max(across, tall)) and at most half the height x (1 - 1e-4), at least 1e-4', 'supported',
    keep(10).replace('r at most 99% of the radius', 'r at most R - 0.01 x max(across,tall)') + ` ROUND 4 REPLACES THE 99%-OF-RADIUS RULE. The limit on the radius side is an ABSOLUTE leftover (R - corner, the flat top that remains), measured against the size of the part: E15/E15b (${cells.length} cells over R 0.5 .. 10000, heights 5 .. 30000, fillet and bevel) the bbox is 1e-2 to 2.6e-2 of the diagonal wrong when R - corner is at most 0.001 x max(across, tall), and exact from 0.0013 x: ${tbl}. So cylinder(4,20,{corner:1.9799}), cylinder(2,10,{corner:0.9899}) and cylinder(1,5,{corner:0.495}) (R 2, 1, 0.5 at 99%) are WRONG, R 5 / tall 50 is wrong at 4.95 and exact at 4.9; R 12 depends on the height: cylinder(24,30) is exact at 11.94 (leftover 0.06 = 0.002 x 30), cylinder(24,60) is wrong at 11.95 (0.05 = 0.0008 x 60), cylinder(24,100) is wrong at 11.9 (0.1 = 0.001 x 100) and cylinder(24,300) wrong at 11.85 (E15b H series), which is why a rule on R alone cannot be right. The guard now refuses a leftover below 0.01 x max(across, tall), a decade over the last wrong cell. Height side (E15 H series, R 24, tall 1, 5, 20, gaps 0.001 .. 0.3 under half the height): all good, so the relative 1e-4 gap stays. Floor: a corner of 3e-6 builds exactly at R 0.6, 6, 60 (E14), truck refuses 1e-6 and below in kernel text; the guard floor is 1e-4.`
    + CMD('e15-cyl-leftover') + CMD('e15b-cyl-leftover-big') + CMD('e14-corner-floor'));
  add('cylinder bevel (ModelDoc roundStyle: chamfer on both rims), same limits as the corner', 'supported', keep(11) + ' ROUND 4: the same leftover rule applies (the bevel cells of E15/E15b are wrong and right in the same places as the fillet cells, see the corner row).');
  const h1 = header(['cyl-corner-vs-radius']);
  add('cylinder corner or bevel leaving a flat top narrower than 0.01 x max(across, tall) (corner above R - 0.01 x max(across, tall))', status(h1, null), h1.text + ' ' + R3(old(12).evidence.replace(/GUARD RUN:[^]*?MEASURED EDGES/, 'MEASURED EDGES')) + GUARD, 'cylinder(4, 20, { corner: 1.98 }): the corner is too big for the width -- the flat top that is left would be too narrow to be built correctly (the mesh cannot resolve it), so it has to be 1.8 or less (the radius is 2, and the flat top must stay at least one hundredth of 20).');
  const h2 = header(['cyl-corner-vs-height']);
  add('cylinder corner or bevel within 1e-4 of half the height, at half, or above it', status(h2, null), h2.text + ' Measured edge: see the 12th row of round 3 evidence quoted in the previous row (height side: 0.99999 of half the height builds 3 faces against OCCT\'s 5; exactly half has no oracle; above half truck refuses in kernel text).' + GUARD, 'cylinder(48, 10, { corner: 5 }): the corner is too big for the height -- the two rims would run into each other and the part would be built wrongly, so it has to be 4.999 or less, a little under half of tall (10).');
  const h3 = header(['cyl-corner-too-small']);
  const bev = [...(A.res('e14-corner-floor') ?? []), ...(A.res('e14b-cyl-corner-bigR') ?? [])].filter((x) => x.id.startsWith('e14') && /cylC/.test(x.id) && x.status === 'built' && !x.good).map((x) => { const f = x.doc.features[0]; return `R ${f.radius} (tall ${f.height}) bevel ${f.round}: ${x.truck.faces} faces against ${x.truck.facesOcct}, ratio to max(across, tall) ${ex(f.round / Math.max(2 * f.radius, f.height))}`; });
  add('cylinder corner or bevel below max(1e-4, 1e-6 x max(across, tall))', status(h3, null), h3.text + ` BEVELS DROP FACES RELATIVE TO THE PART SIZE (E14b): ${bev.join('; ') || 'none'}; fillets of the same sizes were all correct. The guard floor is max(1e-4, 1e-6 x max(across, tall)), 75x above the largest wrong ratio. MEASURED (E14/E14b, ${e14.nCyl} cylinder cases, R 0.6 .. 25000, fillet and bevel, corner 1e-3 .. 1e-7): ${e14.cylBuiltGood} built and matched; ${e14.cylBuiltBad} built wrong; the smallest corner that built correctly was ${ex(e14.smallestGood, 0)}; truck refused every corner of ${ex(e14.refusedMax, 0)} or below with ${e14.refusedTexts.map((t) => `"${t}"`).join(' / ')}: the critic's cylinder corner / bevel 1e-6 is this class (kernel text, not a student sentence).` + GUARD + CMD('e14-corner-floor'),
    'cylinder(24, 30, { corner: 1.00 x 10^-6 }): the corner is too small -- it would be left out of the part, so it has to be at least 0.0001.');
}

{
  const x = e27(); const a = x.filter((r) => /^e27-a-/.test(r.id)); const b = x.filter((r) => /^e27-b-/.test(r.id));
  const plates = resOr('e26-cone-edges').filter((r) => /^e26-c-plate/.test(r.id));
  const asp = (rs, re, n) => okTxt(rs.filter((r) => re.test(r.id)));
  const h = header(['box-round-too-thin']);
  assert(h.s.wrong.length > 0, 'rounded plate has wrong');
  add('box option corner on a long thin plate (longest side above 100 x the shortest)', status(h, null),
    h.text + ` MEASURED: E27a (${a.length} cases: box(L, 0.7 L, t, { corner: t/2 x q }), t = 4 and 40, L/t = 60 .. 500, q = 0.1 / 0.5 / 0.9) and E26c plates (${plates.length}, L/t up to 1500): the face count stays 26 = OCCT's, the bounding box and centre of mass stay exact, and only the volume drifts, scale-free (t 4 and 40 give the same numbers): L/t 60 and 100: ${asp(a, /asp(60|100)-/)}; 150 and 200: ${asp(a, /asp(150|200)-/)}; 300: ${asp(a, /asp300-/)}; 500: ${asp(a, /asp500-/)}. The error is tessellation of the fillet (3.5e-4 to 7.7e-4 against the 3e-4 curved bar, 4x to 8x the usual 1e-4), so this class is 'wrong' by the contract's bar rather than a visibly broken part; the guard keeps the aspect at 100, where the worst cell is 1.2e-4.` + GUARD + CMD('e27-pin-rules') + CMD('e26-cone-edges'),
    'box(1000, 700, 4, { corner: 1 }): too long and thin for a rounded box -- its volume would be measured wrongly, so the longest side has to be at most 100 times the shortest.');
  const h2 = header(['cyl-round-too-flat']);
  assert(h2.s.wrong.length > 0, 'rounded disc has wrong');
  const fil = b.filter((r) => /-fil-/.test(r.id)); const bev = b.filter((r) => /-bev-/.test(r.id));
  add('cylinder corner or bevel on a wide flat disc (across above 100 x tall)', status(h2, null),
    h2.text + ` MEASURED: E27b (${b.length} cases: radius 50 / 500 / 5000, across/tall 40 .. 500, corner = tall/4, fillet and bevel), E24 (disc, ${resOr('e24-disc-corner').length}) and E26c bevels: the result depends on across/tall only (radius 50 and 5000 give the same faces). Fillet across/tall 40 .. 300: ${okTxt(fil.filter((r) => !/asp(450|500)/.test(r.id)))}; 450 and 500: ${okTxt(fil.filter((r) => /asp(450|500)/.test(r.id)))}. Bevel 40 .. 300: ${okTxt(bev.filter((r) => !/asp(450|500)/.test(r.id)))}; 450 and 500: ${okTxt(bev.filter((r) => /asp(450|500)/.test(r.id)))}. A band is dropped (4 faces for OCCT's 5) from across/tall 450; the volume of a fillet disc drifts to 2.2e-4 .. 3.4e-4 from 150 (E24 R 10670 / tall 87.62, ratio 243: 3.2e-4). The guard keeps across/tall at 100, where the worst cell is 7e-5.` + GUARD + CMD('e27-pin-rules') + CMD('e24-disc-corner') + CMD('e26-cone-edges'),
    'cylinder(1000, 4, { corner: 1 }): too flat for a rounded rim -- a rim on a disc this wide is built with a face missing, so across has to be at most 100 times tall.');
}

// =====================================================================================================================================
// SPHERE, CONE
// =====================================================================================================================================
add('sphere(across)', 'supported', keep(13) + SUPPORTED_NOTE);
add('sphere option at', 'supported', keep(14) + ' Limit: the "placed far from the origin" row.');
add('sphere options corner / rotate (not offered)', 'refused', keep(15) + ' The interpreter sentence is plain and true.', 'sphere has no option called "corner". It takes at.');
{
  const e16 = A.res('e16-sphere-turn'); assert(e16, 'e16 results');
  const g = (id) => e16.find((r) => r.id === id);
  const line = (id) => { const r = g(id); if (!r) return `${id}: n/a`; return r.status === 'built' ? `${id.replace('e16-', '')}: ${r.script ?? 'doc'} -> ${r.doc.features.map((f) => f.kind + (f.angles ? '[' + f.angles + ']' : '')).join('+')}, truck vol ${r.truck.volume.toFixed(4)} vs OCCT ${r.occt.volume.toFixed(4)}, bbox d ${ex(r.truck.dBboxOcct)}, COM d ${ex(r.truck.dComOcct)}, ${r.good ? 'GOOD' : 'BAD ' + r.why}` : `${id}: ${r.status} ${String(r.refusal ?? r.guard?.sentence ?? '').slice(0, 100)}`; };
  const cases = ['e16-sph-plain', 'e16-sph-turn', 'e16-sph-at-plain', 'e16-sph-at-turn', 'e16-sph-turn-90', 'e16-sph-doc-rotate-field', 'e16-cyl-at-turn-ref'].map(line);
  const allGood = ['e16-sph-turn', 'e16-sph-at-turn', 'e16-sph-turn-90'].every((id) => g(id)?.status === 'built' && g(id)?.good);
  add('turn(sphere(..), [rx,ry,rz]) and a stored rotate field on a sphere (a rotate step that changes nothing to look at)', allGood ? 'supported' : 'wrong',
    `E16 (primitives-r4/e16-sphere-turn.mjs, ${e16.length} cases, live OCCT oracle): ${cases.join(' || ')}. The script turn() on a sphere is stored as a separate { kind: 'rotate', target } feature (like any shape); it rotates the sphere about the sphere's OWN centre (applyParam writes a rotate slot for it only through that feature; the SphereFeature type has no rotate field, so the Build slider offers none). The guard folds the rotate step back in and checks the sphere as it stands (guardDoc), so a sphere gets no extra rule from being turned. A doc that nevertheless carries a rotate FIELD on a sphere is ignored by the translator and by OCCT alike (case e16-sph-doc-rotate-field above). ` + (allGood ? 'All turned cases match the unturned sphere and live OCCT.' : 'AT LEAST ONE TURNED SPHERE DISAGREES WITH OCCT: see the case list.') + CMD('e16-sphere-turn'));
}
add('cone(across,tall) pointed cone', 'supported', keep(16) + SUPPORTED_NOTE);
add('cone option at', 'supported', keep(17));
add('cone doc-level rotate (script turn)', 'supported', keep(18) + ' Limits: a turned cone is wrong in three classes, each its own row below (turned and moved with tall/across under 1, turned with tall/across above 10, flatter than 0.01).');
{
  const x = e27(); const c = x.filter((r) => /^e27-c-t/.test(r.id));
  const byT = [...new Set(c.map((r) => +/^e27-c-t([\d.]+)-/.exec(r.id)[1]))].sort((a, b) => a - b).map((t) => `tall/across ${t}: ${okTxt(c.filter((r) => +/^e27-c-t([\d.]+)-/.exec(r.id)[1] === t))}`).join(' || ');
  const ax = x.filter((r) => /^e27-c-axis/.test(r.id)); const pm = x.filter((r) => /^e27-c-plainmoved/.test(r.id));
  const e26b = resOr('e26-cone-edges').filter((r) => /^e26-b-r/.test(r.id)); const e23b = resOr('e23-turned-cone').filter((r) => /^e23-b-/.test(r.id));
  const h = header(['cone-turned-moved-flat']);
  assert(h.s.wrong.length > 0 && h.s.status === 'wrong', 'cone turned+moved has recorded wrong solids');
  add('cone turned (any rotate) AND placed off the origin with tall/across below 1 (a flat turned cone moved with at)', status(h, null),
    h.text + ` MEASURED: E27c (primitives-r4/e27-pin-rules.mjs, ${c.length} cases, cone across 20, turned [20,35,50], centre [0.001,0,0] / [0.5,0,0] / [0,0,3] / [5,-3,2]), by tall/across: ${byT}. The edge is sharp between 0.65 (volume 10% to 20% off, centre of mass 2e-3 to 6e-3 of the diagonal off) and 0.7 (1e-4, tessellation). Even an offset of 0.001 is enough. Earlier cells: E26b (${e26b.length} cases, cone across 2 / 20 / 100, centre near and far): ${okTxt(e26b)}; E23b (${e23b.length}): ${okTxt(e23b)}. Not wrong: the same cones turned at the origin (E23a, E22), unturned and moved (${okTxt(pm)}), and turned about ONE axis only and moved (${okTxt(ax)}); the guard still refuses any non-zero rotate, because only three single-axis turns (x90, z90, y45) were tried and the multi-axis ones ([20,35,50], [180,90,90]) are the wrong ones; it does not claim that a one-axis turn is always right. The mechanism is not known; the volume is wrong by a large factor, not by tessellation, with the bounding box right, so a student would see the right outline and the wrong mass.` + GUARD + CMD('e27-pin-rules') + CMD('e26-cone-edges') + CMD('e23-turned-cone'),
    'cone(20, 4): a cone that is turned and not at the origin has to be at least as tall as it is across -- a flatter one is built with the wrong volume and position, so make tall 20 or more, or leave it unturned or at the origin.');
  const e26a = resOr('e26-cone-edges').filter((r) => /^e26-a-r/.test(r.id)); const e23a = resOr('e23-turned-cone').filter((r) => /^e23-a-r.*-(x90|y90|xyz|mix|z90|none)$/.test(r.id));
  const ts = (rs, t) => okTxt(rs.filter((r) => new RegExp('-t' + t.replace('.', '\\.') + '-').test(r.id) && !/none|z90/.test(r.id)));
  const h2 = header(['cone-turned-slender']);
  assert(h2.s.wrong.length > 0, 'cone turned slender has wrong');
  add('cone turned (not about Z only) with tall/across above 10', status(h2, null),
    h2.text + ` MEASURED: E26a (${e26a.length} cases, cone across 2 / 20 / 145.9, tall/across 10 .. 17, turned x90 and [20,35,50]) and E23a (tall/across 18, 25, 40): tall/across 10 .. 15 build 2 faces like OCCT; from 16 the turned cone has 3 faces against OCCT's 2 (a seam through the side), volume and bounding box still right (volume 1.8e-4 = tessellation). 16: ${ts(e26a, '16')}; 17: ${ts(e26a, '17')}; 18: ${ts(e23a, '18')}; 25: ${ts(e23a, '25')}; 40: ${ts(e23a, '40')}; the same cones UNTURNED (tall/across 18, 25, 40) have 2 faces. A turn about Z only (z90) keeps 2 faces. Face count is part of the contract, so the status is wrong, not supported-with-a-note.` + GUARD + CMD('e26-cone-edges') + CMD('e23-turned-cone'),
    'cone(20, 400): too long to be turned -- a turned cone this long is built with a seam through its side, so tall has to be at most 10 times across, or leave the cone unturned.');
  const fl = x.filter((r) => /^e27-d-/.test(r.id)); const fl0 = resOr('e26-cone-edges').filter((r) => /^e26-a2-/.test(r.id));
  const h3 = header(['cone-too-flat']);
  assert(h3.s.wrong.length > 0, 'cone too flat has wrong');
  const flT = (re) => okTxt([...fl, ...fl0].filter((r) => re.test(r.id)));
  add('cone flatter than tall/across 0.01 (tall under one hundredth of across)', status(h3, null),
    h3.text + ` MEASURED: E27d (${fl.length} cases) and E26a2 (${fl0.length}), across 10 / 100 / 400 / 2000, tall/across 0.0002 .. 0.01, plain and turned [20,35,50], at the origin, volume always 5.6e-5 (tessellation) and the bounding box right: tall/across 0.0005 and below: ${flT(/-t0\.0002-|-t0\.0005-/)}; 0.001: ${flT(/-t0\.001-/)} (turned: 4 faces for 2 at every size; plain: 2 faces); 0.002 and above: ${flT(/-t0\.(002|003|004|005|006|01)-/)}. The guard floor 0.01 is 10x the last wrong cell and 5x the first right one. The 0.01 absolute floor on tall (row "size") does not cover this: cone(1000, 0.2) has tall/across 0.0002.` + GUARD + CMD('e27-pin-rules') + CMD('e26-cone-edges') + CMD('e22-turned-small-cone'),
    'cone(1000, 0.2): too flat for its width -- a cone this flat is built with the wrong number of faces, so tall has to be at least 10, one hundredth of across.');
}
{
  const h = header(['cone-second-radius']);
  add('cone frustum / second radius (cone with three arguments)', 'refused', `AS SHIPPED the interpreter refuses cone(10,5,10) with a sentence, but a misleading one ("cone's extras go in a { } object ... You gave it 10." tells the student to wrap the number in { } and no option takes it); the lint sentence is the correct one. ` + keep(19), 'cone() makes a pointed cone from across and tall only -- the third value 10 would be a second radius, and a flat-topped cone is not available.');
  void h;
}

// =====================================================================================================================================
// RING
// =====================================================================================================================================
{
  const e19 = A.res('e19-ring-boundary'); assert(e19, 'e19 results');
  const cell = (id) => { const r = e19.find((x) => x.id === id); return r ? (r.status === 'built' ? `${r.good ? 'ok' : 'WRONG ' + r.why} (${ex(r.truck.dVolOcct ?? r.truck.dVolAn)})` : r.status) : 'n/a'; };
  const bd = [['2.05-1', 2.05], ['4.1-2', 2.05], ['8.2-4', 2.05], ['20.5-10', 2.05], ['41-20', 2.05], ['82-40', 2.05], ['205-100', 2.05], ['2.0501-1', 2.0501], ['2.1-1', 2.1], ['2.04-1', 2.04], ['2.0499-1', 2.0499], ['2.0-1', 2], ['25-0.5', 50], ['50-1', 50], ['100-2', 50], ['250-5', 50], ['500-10', 50], ['50.5-1', 50.5], ['26-0.5', 52], ['60-1', 60]]
    .map(([k, ratio]) => `ring(${k.replace('-', ',')}) ratio ${ratio}: ${cell('e19-ring-' + k)}`).join(' | ');
  const inc = ['2.05-1', '4.1-2', '8.2-4', '20.5-10', '41-20', '82-40', '205-100'].map((k) => G.guardFirst(e19.find((x) => x.id === 'e19-ring-' + k).doc));
  assert(inc.every((v) => v === null), 'ring ratio 2.05 inclusive accepted by the guard');
  const inc50 = ['25-0.5', '50-1', '100-2', '250-5', '500-10'].map((k) => G.guardFirst(e19.find((x) => x.id === 'e19-ring-' + k).doc));
  assert(inc50.every((v) => v === null), 'ring ratio 50 inclusive accepted by the guard');
  add('ring(across,tubeAcross) / torus, across/tubeAcross from 2.05 to 50 INCLUSIVE, tubeAcross at least 0.5', 'supported', keep(20) + ` ROUND 4 BOUNDARY (E19, primitives-r4/e19-ring-boundary.mjs, ${e19.length} cases): the inclusive ends are accepted by the guard and build correctly: ${bd}. Round 3's guard refused the exact end ring(2.05,1) (it tested tube >= across/2.05); the round 4 check is across < tube x 2.05 x (1 - 1e-9), so 2.05 itself is accepted and 2.0499 is not.` + CMD('e19-ring-boundary'));
}
add('ring option at', 'supported', keep(21));
add('ring doc-level rotate (script turn)', 'supported', keep(22));
{
  const h = header(['ring-tube-too-thick']);
  add('ring with a tube too thick for the ring (across/tubeAcross below 2.05): horn, spindle, zero or negative ring radius', status(h, null), h.text + ' ' + R3(old(23).evidence.replace(/GUARD RUN:[^]*?THE ORACLES/, 'THE ORACLES')) + GUARD, 'ring(10, 12): the tube is too thick for a ring 10 across, so the hole in the middle would close and the part would be built wrongly -- tubeAcross has to be 4.878 or less.');
  const h2 = header(['ring-tube-too-thin']);
  add('ring with a tube too thin for the ring (across/tubeAcross above 50)', status(h2, null), h2.text + ' ' + R3(old(24).evidence.replace(/GUARD RUN:[^]*?The volume/, 'The volume')) + GUARD, 'ring(100, 1): the tube is too thin for a ring 100 across, so its volume would be measured wrongly -- tubeAcross has to be at least 2, one fiftieth of across.');
}

// =====================================================================================================================================
// PRISM
// =====================================================================================================================================
add('prism(sides,across,tall) sides 3..12', 'supported', keep(25) + SUPPORTED_NOTE);
add('prism option at', 'supported', keep(26) + ' Limit: the "placed far from the origin" row (planar rule Q).');
add('prism doc-level rotate (ModelDoc rotate field; script turn(prism) makes a separate rotate feature)', 'supported', keep(27));
add('prism sides outside 3..12 from a script (2, 13, 0, -3)', 'refused', keep(28) + ' The sentence is plain and true.', 'prism() needs 3 to 12 sides.');
{
  const e18 = A.res('e18-prism-sides'); assert(e18, 'e18 results');
  const sc = e18.filter((r) => r.id.startsWith('e18-script-'));
  const doc = e18.filter((r) => r.id.startsWith('e18-doc-'));
  // script level: the interpreter's behaviour and the new lint
  const scriptTxt = sc.map((r) => { const typed = /prism\(([^,]+),/.exec(r.script)[1]; const stored = r.doc ? r.doc.features[0].sides : null; const lint = L.lintPrismSides(r.script, runSides).length ? 'lint:REFUSES' : 'lint:none'; return `prism(${typed}) ${r.status === 'script-refused' ? 'interpreter refuses (' + r.refusal + ')' : 'stored sides ' + stored}, ${lint}`; });
  const wrongStored = sc.filter((r) => r.status !== 'script-refused' && !Number.isInteger(+(/prism\(([^,]+),/.exec(r.script)[1])));
  const unflagged = wrongStored.filter((r) => !L.lintPrismSides(r.script, runSides).length);
  assert(unflagged.length === 0, 'prism lint flags every fractional script: ' + unflagged.map((r) => r.id));
  const effSides = (n) => Math.max(3, Math.min(12, Math.round(n)));
  const docTxt = doc.map((r) => { const s = r.doc.features[0].sides; const g = G.guardFirst(r.doc); return `sides ${s}: ${r.status === 'built' ? `built with ${r.truck.faces - 2} sides (${r.good ? 'faces equal to OCCT' : 'faces differ from OCCT'})` : r.status + ' "' + String(r.refusal ?? '').replace(/^.*solidcraft refused it -- /, '').slice(0, 60) + '"'}; guard ${g ? g.code : 'accepts'}`; });
  const silentDoc = doc.filter((r) => r.status === 'built' && effSides(r.doc.features[0].sides) !== r.doc.features[0].sides);
  assert(silentDoc.length >= 6 && silentDoc.every((r) => r.truck.faces - 2 === effSides(r.doc.features[0].sides)), 'E18 doc cases: truck builds the clamped/rounded prism');
  assert(silentDoc.every((r) => r.truck.facesOcct === r.truck.faces), 'E18 doc: OCCT builds the same clamped prism');
  const docHoles = doc.filter((r) => !G.guardFirst(r.doc));
  assert(docHoles.every((r) => Number.isInteger(r.doc.features[0].sides) && r.doc.features[0].sides >= 3 && r.doc.features[0].sides <= 12), 'prism doc guard accepts only whole 3..12');
  add('prism sides not a whole number from a script (2.5, 2.6, 5.4, 5.5, 12.4, a variable, param() or an expression holding a fraction)', 'wrong',
    `E18 (primitives-r4/e18-prism-sides.mjs): the interpreter rounds the typed value and keeps only the rounded one (Math.round, then the 3..12 check on the ROUNDED value), so it accepts 2.5, 2.6 (stored 3), 12.4 (stored 12), 5.4, 5.5 with no error and no warning, and the part silently has a different number of sides than typed. ${scriptTxt.join(' | ')}. ROUND 4 LINT (primitives.call-lint.mjs lintPrismSides, replaces the round 3 +-0.499 probe that MISSED 2.5, 2.6 and 12.4 because one probe ran into the range check, errored, and the lint then gave up): the first argument is replaced, inside the script itself so variables and param() still resolve and the typed expression is evaluated once, by ((v) => 4 + (|v - round(v)| > 1e-9 ? 5 : 0))(<typed>); a control run uses 4; if the two documents differ the value is not whole. Checked here on every fractional script above (flagged ${wrongStored.length} of ${wrongStored.length}) and on a variable (const n = 5.5), param('n', 7.5), 10/3, 0.1*30 (whole, not flagged), 3.0000000001 (within 1e-9 of whole, not flagged), two prisms in one script (only the fractional call is flagged), 2.4 and 12.5 (the interpreter's own sentence applies as well). ` + GUARD + CMD('e18-prism-sides'),
    'prism() needs a whole number of sides, from 3 to 12 -- 2.6 is not whole, so it would be rounded to a different shape than you typed; use a whole number such as 3.');
  add('prism sides in a stored ModelDoc (Build-mode edit, old document, import): 2, 2.6, 5.5, 12.4, 13, 30, 0, -1, 1e9, NaN (no interpreter in the path)', 'wrong',
    `E18 doc cases (${doc.length}): a stored document never goes back through prism(), so nothing checks the sides. The translator clamps to 3..12 and rounds (translate.mjs: Math.max(3, Math.min(12, Math.round(f.sides)))). Result per document: ${docTxt.join(' | ')}. ${silentDoc.length} of ${doc.length} documents build a prism with a different number of sides than the document says, with status built and no sentence. HONEST NOTE ON THE ORACLE: live OCCT (packages/brep-adapter occt-build) clamps and rounds the same way, so truck and OCCT AGREE with each other on every one of these (faces equal), and the "wrong" is against the DOCUMENT, not against OCCT: a parity check would pass them. The status is wrong because the layer's promise is no silently wrong part and a document that says 13 sides is shown as a 12-gon. NaN is refused by truck in kernel text. There is NO slider for sides (generatedParams offers radius, height and position for a prism), so the reachable paths are a stored or imported document and a Build-mode document edit. ROUND 4 GUARD: guardFeature refuses any prism whose sides is not a whole number from 3 to 12 (all ${doc.length - docHoles.length} bad documents above are refused, the ${docHoles.length} good ones accepted). Round 3 had no such check at document level.` + GUARD + CMD('e18-prism-sides'),
    'prism(): sides has to be a whole number from 3 to 12, and it is 2.6 -- any other value would be rounded to a different shape.');
}

// =====================================================================================================================================
// WEDGE
// =====================================================================================================================================
add('wedge(width,depth,tall)', 'supported', keep(30) + SUPPORTED_NOTE);
add('wedge option at', 'supported', keep(31) + ' Limit: the "placed far from the origin" row (planar rule Q); wedge(0.01,0.01,0.01) at [1e6,-1e6,1e6] is WRONG as shipped (volume 86 against 1.5e-6 for 0.01 x 0.015 x 0.02).');
add('wedge doc-level rotate (ModelDoc rotate field; script turn(wedge) makes a rotate feature)', 'supported', keep(32));

// =====================================================================================================================================
// VALIDATION
// =====================================================================================================================================
add('validation: every size must be a positive number', 'refused', keep(33) + ' The interpreter sentences are plain and true. A stored ModelDoc or a slider bypasses them: the guard adds a not-a-size check (NaN, Infinity, zero, negative, text) at document level.', 'box(): a size has to be a positive number -- got -10 for width.');
add('validation: unknown option names refused with "has no option called"', 'refused', keep(34), 'box has no option called "colour". It takes at, corner.');
{
  const h = header(['surplus-argument']);
  add('validation: a surplus value after the { } options object', 'wrong', `AS SHIPPED the interpreter accepts and drops the value (box(1, 2, 3, { at: [0,0,0] }, 99) builds a box and 99 is ignored), so the part is silently not what was typed; ${h.s.n} recorded inputs. ` + keep(35) + GUARD, 'box() takes width, depth and height, then at most one { } of options -- the extra value 99 would be ignored, so take it out.');
}

// =====================================================================================================================================
// PARAM, SLIDERS
// =====================================================================================================================================
add('param() accepted as a size, a corner and an at coordinate (the DEFAULT value)', 'supported', keep(36) + ' Only the default value is exercised here; values reached by dragging are the next row.');
{
  const e17 = A.res('e17-sliders') ?? (PARTIAL ? [] : null); assert(e17, 'e17 results');
  const es = e17.map((r) => ({ r, o: outcome(r), g: r.doc ? G.guardFirst(r.doc) : null }));
  const s = ship(es);
  const holes = es.filter((e) => !e.g && (e.o === 'wrong' || e.o === 'unverified'));
  assert(holes.length === 0, 'slider holes: ' + holes.map((e) => e.r.id));
  const byRow = (row) => es.filter((e) => e.r.row === row);
  const cnt = (a) => `${a.length} cases: ${a.filter((e) => e.o === 'good').length} correct, ${a.filter((e) => e.o === 'wrong' || e.o === 'unverified').length} WRONG, ${a.filter((e) => e.o === 'kernel').length} kernel-text refusals, ${a.filter((e) => e.g).length} refused by the guard, ${a.filter((e) => e.g && e.o === 'good').length} of those were built correctly`;
  const sample = es.filter((e) => e.o === 'wrong' || e.o === 'unverified').slice(0, 6).map((e) => `${e.r.id} (${e.r.note.split(': ')[1]}): ${why(e)}`).join('; ');
  const zero = es.filter((e) => /B-corner-0$/.test(e.r.id));
  add('Build-mode sliders (applyParam, no interpreter): a size dragged to its minimum 1 or maximum, a position to +-500, the corner over 0..40 in steps of 0.5', status({ s }, null),
    `E17 (primitives-r4/e17-sliders.mjs, ${e17.length} cases = the seven primitives run to a document, then ONE slot moved to the slider min / middle / max (A), the corner swept over 0, 0.5, 1, 2, 5, 6, 10, 12, 15, 20, 40 (B), all size sliders at their minimum with the position sliders at +-500 and 100 (C), through the real generatedParams ranges: sizes [1, max(100, 4 x value)], positions [-500, 500], corner [0, 40]). The slider writes the number into the stored ModelDoc and never goes back through the interpreter, so none of the interpreter's checks run. AS SHIPPED: ${cnt(es)}. By set: one slot ${cnt(byRow('slider.one'))}; corner sweep ${cnt(byRow('slider.corner'))}; combinations ${cnt(byRow('slider.combo'))}. Examples that build wrong or are refused in kernel text: ${sample || 'none'}. The corner slider reaches 0: ${zero.map((e) => `${e.r.id.replace('e17-', '')} ${e.o === 'good' ? 'builds correctly (stored round 0 is treated as no rounding)' : e.o}`).join(', ') || 'n/a'}. GUARD (applied to every stored document, so it covers the sliders): accepted AND wrong = ${holes.length} (the guard sees the number the slider produced, not the typed text). Round 3 tested param() only at its default value.` + GUARD + CMD('e17-sliders'),
    'cylinder(2, 30, { corner: 3 }): the corner is too big for the width -- the flat top that is left would be too narrow to be built correctly (the mesh cannot resolve it), so it has to be 0.7 or less (the radius is 1, and the flat top must stay at least one hundredth of 30).');
}

// =====================================================================================================================================
// PLACEMENT, SIZE
// =====================================================================================================================================
{
  const q = A.e12Q(); assert(q, 'e12 results');
  assert(q.q1e6.bad === 0 && q.q1e7.bad === 0 && q.qhi.bad > 0, 'E12 bins');
  const h = header(['too-far-planar']);
  // lowest Q at which any recorded planar case is WRONG, split into plain box/wedge and turned/prism
  const qs = { plain: [], turned: [] };
  for (const e of DB) {
    const f = e.r.doc.features.find((x) => !['rotate', 'move'].includes(x.kind)); if (!f || !['box', 'wedge', 'prism'].includes(f.kind) || f.round) continue;
    const hasRot = e.r.doc.features.some((x) => x.kind === 'rotate') || (f.rotate && f.rotate.some((v) => v));
    const fq = G.farQ({ ...f, rotate: hasRot ? [1, 1, 1] : f.rotate }); if (!Number.isFinite(fq.Q)) continue;
    if (e.g && e.g.code !== 'too-far-planar') continue; // wrong for another reason (aspect, size) is not a placement case
    (hasRot || f.kind === 'prism' ? qs.turned : qs.plain).push({ Q: fq.Q, o: e.o, id: e.r.id });
  }
  const lowWrong = (a) => a.filter((x) => x.o === 'wrong').sort((x, y) => x.Q - y.Q).slice(0, 3).map((x) => `${x.id} Q ${ex(x.Q)}`).join(', ');
  const nWrongLow = (a, lim) => a.filter((x) => x.o === 'wrong' && x.Q <= lim).length;
  assert(nWrongLow(qs.plain, G.LIM.planarQMax) === 0 && nWrongLow(qs.turned, G.LIM.planarQMaxTurned) === 0, 'recorded planar wrong inside the Q limits');
  add('planar box, wedge, prism and turned shapes placed away from the origin: Q = (|x|+ex)(|y|+ey)(|z|+ez) / volume at most 1e6 for an unturned box or wedge and at most 1e4 for a prism or a turned shape (ex..ez the half sizes; the half diagonal on every axis when turned)', status(h, null),
    h.text + ` MODEL AND MEASUREMENT (E12, primitives-r4/e12-planar-tiny-far.mjs, ${q.n} cases: box, wedge, hexagonal prism, turned box, turned wedge with smallest size 0.001 .. 5 at (e,-e,e), e = 0 .. 1e6; non-dyadic sizes). truck sums the volume and the centre of mass from products of vertex coordinates, so the rounding error grows with the PRODUCT of the largest coordinate on each axis and is judged against the volume: Q = prod(|at_a| + ext_a) / V. Cases with Q <= 1e6: ${q.q1e6.n} all good (max dVol ${ex(q.q1e6.maxdVol)}, max COM ${ex(q.q1e6.maxdCom)} x diagonal); Q 1e6 .. 1e7: ${q.q1e7.n} all good (max dVol ${ex(q.q1e7.maxdVol)}, at the 1e-9 bar); Q above 1e7: ${q.qhi.n} cases, ${q.qhi.bad} WRONG, the first at Q ${ex(q.qhi.minBadQ)}. As shipped ${q.neg} of the ${q.built} built cases read a NEGATIVE volume and ${q.refused} are refused by truck in kernel text. The critic's cases: ${q.tinyFar.join(' | ')}. ROUND 3'S CLAIM "an unturned box or wedge is exact to the 1e6 cap" WAS A TEST ARTIFACT: E6 used sizes 0.5, 2, 20, 200 and integer offsets, all exactly representable in binary, so the cancellation costs nothing; the same boxes with sizes ${q.dyadicTrap.join(', ')} are exact, while box(0.1) / box(0.01) / wedge(0.1) at 1e6 are not. Sizes that are not exact in binary (0.1, 1.3, 2.7 ...) are what students type. THE CONSEQUENCE: round 3's "box(2,3,4) at 1e6" and "prism(6,2,3) at 200" are now refused on purpose although truck happens to get them right (integers are exact): the guard cannot tell exact from inexact sizes. The rule replaces round 3's "|at| <= 100 x smallest size for prisms and turned shapes, nothing for unturned boxes and wedges". TURNED SHAPES AND PRISMS SCATTER MORE THAN THE MODEL (the rotation and the n-gon vertices are not exact in binary): over ${qs.turned.length} recorded turned/prism cases the lowest Q at which truck is wrong is ${lowWrong(qs.turned)} (random inputs of fuzz seed 1, single-axis offsets: dVol 6e-8 .. 1.3e-7, COM 3e-4 .. 5e-4 x diagonal), far under the E12 grid's 1e8, so the limit for them is 1e4; for ${qs.plain.length} recorded unturned box/wedge cases the lowest wrong Q is ${lowWrong(qs.plain)} against the limit 1e6.` + GUARD + CMD('e12-planar-tiny-far'),
    'wedge(0.01, 0.01, 0.01): the at position 1000000 is too far from the origin for a part this small -- its volume and centre would be worked out wrongly, so keep every at coordinate within 0.783, or make the part bigger.');
}
{
  const e20 = A.res('e20-curved-far-nondyadic');
  const h = header(['too-far-curved']);
  let e20t = 'E20 not run.';
  if (e20) {
    const kk = (r) => +/-k(\d+)$/.exec(r.id)[1];
    const ks = [...new Set(e20.map(kk))].sort((a, b) => a - b);
    const cellsTxt = ks.map((k) => { const c = e20.filter((r) => kk(r) === k); const built = c.filter((r) => r.status === 'built'); return `k ${k}: ${built.filter((r) => r.good).length}/${c.length} good${built.some((r) => !r.good) ? ' (' + built.filter((r) => !r.good).map((r) => r.id.replace('e20-', '') + ' ' + r.why).slice(0, 2).join('; ') + ')' : ''}`; }).join(' | ');
    const bad400 = e20.filter((r) => kk(r) <= 400 && r.status === 'built' && !r.good);
    assert(bad400.length === 0, 'E20: a non-dyadic curved case inside ratio 400 is wrong: ' + bad400.map((r) => r.id + ' ' + r.why).join('; '));
    e20t = `E20 (primitives-r4/e20-curved-far-nondyadic.mjs, ${e20.length} cases: cylinder, sphere, cone, ring, rounded box with sizes 2.7 and 27.3, which are NOT exact in binary; offset = k x the smallest typed size at (e,-e,e)), ratio k: ${cellsTxt}. Every case inside k <= 400 is good, so the round 3 ratio rule survives sizes that are not exact in binary (round 3's E7 used 2, 3, 20 ...).`;
  }
  add('sphere, cylinder, cone, ring or rounded box placed far from the origin (offset above 400 x its smallest size)', status(h, null), h.text + ' ' + e20t + ' ' + R3(old(39).evidence.replace(/GUARD RUN:[^]*?Guard:/, 'Guard:')) + GUARD, 'sphere(): the at position 10000 is too far from the origin for a shape whose smallest size is 2 -- its volume and centre would be worked out wrongly, so keep every at coordinate within 800 (400 times that size), or move the shape nearer.');
}
{
  const x = e27().filter((r) => /^e27-e-/.test(r.id)); const e21 = resOr('e21-fuzz-holes').filter((r) => /^e21-sph/.test(r.id)); const e25 = resOr('e25-curved-far-big');
  const h = header(['too-far-big-curved']);
  assert(h.s.wrong.length > 0, 'big far curved has wrong');
  const P = (r) => { const m = /P(\d+)/.exec(r.id); return m ? +m[1] : null; };
  const e25wrong = e25.filter((r) => r.status === 'built' && !r.good);
  add('sphere, cylinder, cone, ring or rounded box that is both big and far (largest |at| x largest typed size above 1e8)', status(h, null),
    h.text + ` MEASURED: E27e (${x.length} spheres, across 2000 .. 40000, P = |at| x across 1e7 .. 4e9): ${okTxt(x)}; the cells that fail are P ${x.filter((r) => !r.good).map(P).join(', ')}; the ones above 1e9 that are right (sphere 2000 and 5000 at 1e9 .. 4e9, 20000 at 4e9) show the failure is erratic above 1e9, which is why the rule sits a decade below the first wrong cell (E25: sphere 1000 at 1e6, P 1e9, centre of mass 1.7e-4 of the diagonal off). E21 spheres (${e21.length}): ${okTxt(e21)}. E25 (${e25.length} cylinder / cone / rounded box / ring / sphere cells with P up to 8e10): ${okTxt(e25)} -- only spheres failed (${e25wrong.map((r) => r.id.replace('e25-', '')).join(', ')}) and the failing ones are far off: volume 33% .. 330% too big, bounding box 8.5% off (a wrong solid by a large factor, not a tessellation difference). The guard applies the same product to every curved shape because E25 sampled the other kinds once per cell; it costs ${'${'}n${'}'} correct inputs recorded in the truth DB.`.replace('${n}', String(refusedBy('too-far-big-curved').filter((e) => e.o === 'good').length)) + ' This is IN ADDITION to the "400 x its smallest size" row above.' + GUARD + CMD('e27-pin-rules') + CMD('e25-curved-far-big') + CMD('e21-fuzz-holes'),
    'sphere(40000): a shape 40000 across at a position 50000 from the origin is too far out for its size -- its volume and centre would be worked out wrongly, so keep the position times the biggest size at 100000000 or less (at most 2500 here).');
}
{
  const h = header(['too-far']);
  add('any shape with a coordinate beyond 1e6', status(h, null), h.text + ' ' + keep(40).replace(/GUARD RUN:[^]*?Without the guard/, 'Without the guard') + GUARD, 'box(): the at position 10000000 is too far from the origin -- the part would be built in the wrong place, so keep every at coordinate within 1000000.');
  const h2 = header(['too-big-curved']);
  add('curved or rounded shape with a size above 5e4 (sphere, cylinder, cone, ring, rounded box)', status(h2, null), h2.text + ' ' + R3(old(41).evidence.replace(/GUARD RUN:[^]*$/, '')) + GUARD, 'sphere(): across 70000 is too big -- a curved or rounded shape this big is built with the wrong volume and position, so keep it at 50000 or less.');
  const h3 = header(['too-big']);
  add('planar shape with a size above 1e6 (box, prism, wedge)', status(h3, null), h3.text + ' ' + R3(old(42).evidence.replace(/GUARD RUN:[^]*$/, '')) + GUARD, 'box(): width 10000000 is too big -- a part this big is built with the wrong volume and position, so keep it at 1000000 or less.');
  const h4 = header(['too-small-curved', 'too-small']);
  (() => {
    const tiny = DB.filter((e) => { const f = e.r.doc.features.find((x) => !['rotate', 'move'].includes(x.kind)); if (!f || !['box', 'wedge', 'prism'].includes(f.kind) || f.round) return false; const dims = f.kind === 'box' ? f.size : f.kind === 'wedge' ? [f.width, f.depth, f.height] : [2 * f.radius, f.height]; const m = Math.min(...dims); return m >= 0.0009 && m <= 0.0021; });
    const kern = tiny.filter((e) => e.o === 'kernel'); const exact = tiny.filter((e) => { const f = e.r.doc.features.find((x) => !['rotate', 'move'].includes(x.kind)); const dims = f.kind === 'box' ? f.size : f.kind === 'wedge' ? [f.width, f.depth, f.height] : [2 * f.radius, f.height]; return Math.abs(Math.min(...dims) - 0.001) < 1e-12; });
    assert(kern.length > 0 && kern.every((e) => G.guardFirst(e.r.doc)), 'tiny planar: every kernel refusal is refused by the guard');
    add('curved or rounded shape below 1 across (0.5 for a ring tube, 0.01 tall), planar shape below 0.01', status(h4, null), h4.text + ` ROUND 4b, PLANAR FLOOR RAISED FROM 0.001 TO 0.01: of ${tiny.length} recorded planar box / wedge / prism inputs whose smallest size is 0.0009 .. 0.0021, truck refused ${kern.length} in kernel text ("${kernelText(kern[0])}"), ${exact.filter((e) => e.o === 'kernel').length} of the ${exact.length} that are exactly 0.001 (a prism of across 0.001 has sides shorter than that; a wedge of 0.001 has a leg at it), and the others at 0.00114 and 0.002; none above 0.0021. The fuzz seeds 1..3 had 17 such inputs that the guard with the 0.001 floor ACCEPTED, so a student would have read "solid.extrude: invalid input: profile: cannot attach a plane to a wire that is not on one plane". The floor is now a decade above the last refusal. ` + R3(old(43).evidence.replace(/GUARD RUN:[^]*$/, '')) + GUARD, 'sphere(): across 0.5 is too small -- a curved or rounded shape this small is built with the wrong size and shape, so make it at least 1.');
  })();
  const h5 = header(['cyl-too-slender', 'cone-too-slender']);
  add('cylinder taller than 30 times its across, cone taller than 40 times its across', status(h5, null), h5.text + ' ' + R3(old(44).evidence.replace(/GUARD RUN:[^]*?Guard:/, 'Guard:')) + GUARD, 'cylinder(2, 100): too long for its width -- a slender cylinder is measured wrongly, so tall has to be at most 30 times across.');
}
{
  const a = A.e13(); assert(a, 'e13');
  const h = header(['too-thin-planar']);
  const fb = Object.entries(a.firstBad).map(([k, v]) => `${k} ${ex(v, 0)}`).join(', ');
  const lg = Object.entries(a.lastAllGood).map(([k, v]) => `${k} ${ex(v, 0)}`).join(', ');
  add('planar box, wedge or prism that is long and thin (longest typed size above 1e4 x the shortest)', status(h, null),
    h.text + ` MEASURED (E13, primitives-r4/e13-aspect.mjs, ${a.n} cases: needles and plates of box, wedge, hexagonal... heptagonal prism and turned box, longest side L = 1.37 .. 913000, aspect L / shortest = 10 .. 1e7, at the origin, plus e13b-critic-aspect.mjs, ${a.critic.length} cases): the first aspect at which ANY case of a shape loses faces: ${fb}; the last aspect at which every case of the shape is right: ${lg}. The critic's cases reproduce: ${a.critic.slice(0, 4).join('; ')}; ${a.critic.slice(4).filter((c) => /faces/.test(c)).slice(0, 6).join('; ')}. The failure depends on the end face being tiny against the length, not on a particular size: box(1000,0.001,0.001), box(1e4,0.01,0.01), box(1e5,0.1,0.1), box(1e6,10,10) is fine but box(1e6,1,1) loses its ends; the volume stays exact (dVol <= 3e-16), only the face count (4 for 6) shows it, which is why it breaks the "faces equal" bar. The guard limit is 1e4: a decade under the first failing aspect of a turned box (1e5) and two under a plain box (1e6).` + GUARD + CMD('e13-aspect') + CMD('e13b-critic-aspect'),
    'box(1000, 0.001, 0.001): too long and thin -- its ends would be lost and the part built with missing faces, so the longest size has to be at most 10000 times the shortest.');
}

// =====================================================================================================================================
// TIME, BROWSER
// =====================================================================================================================================
{
  // timings measured in round 4 (same rig, machine load recorded per row)
  const t = (files, pred) => files.flatMap((f) => A.res(f) ?? []).filter((r) => r.status === 'built' && pred(r) && r.ms !== undefined);
  const cylFil = t(['e15-cyl-leftover', 'e15b-cyl-leftover-big', 'e14-corner-floor', 'e14b-cyl-corner-bigR'], (r) => r.kind === 'cylinder' && r.doc.features[0].round && r.doc.features[0].roundStyle !== 'chamfer');
  const cylCha = t(['e15-cyl-leftover', 'e15b-cyl-leftover-big', 'e14-corner-floor', 'e14b-cyl-corner-bigR'], (r) => r.kind === 'cylinder' && r.doc.features[0].roundStyle === 'chamfer');
  const ringT = t(['e19-ring-boundary'], () => true);
  const stat = (a) => (a.length ? `n ${a.length}, median ${sec(med(a.map((r) => r.ms)))}, max ${sec(Math.max(...a.map((r) => r.ms)))}, machine load ${Math.min(...a.map((r) => r.load)).toFixed(0)}-${Math.max(...a.map((r) => r.load)).toFixed(0)} on 24 cores` : 'n/a');
  const fz = [1, 2, 3, 4, 5].map((s) => A.res('fuzz-seed' + s)).filter(Boolean).flat();
  const fzCurved = fz.filter((r) => r.status === 'built' && r.truck?.curved && r.ms !== undefined);
  const worst = [...fzCurved].sort((a, b) => b.ms - a.ms)[0];
  const br = A.res('browser-bench');
  add('build time of one primitive: a requirement that the page never blocks and ends a long call with a sentence (Web Worker, time budget, "took too long")', 'unsupported',
    `STATUS CORRECTED FROM ROUND 3 (was "supported"): the measurements below are real, but the thing that makes the time acceptable is a requirement on the page (run the call in a Worker, give it a budget, end it with a sentence) and none of it exists in the product; see the next row for what a headless-Chromium harness showed about it. MEASURED, one SolidCraft call = build + measure as ONE SYNCHRONOUS wasm call that cannot yield (the referee wrapper solidcraft_referee.run). Round 3 table (median of 3 guarded runs, machine load 14-51): ${keep(45).replace(/^[^]*?Median wall time of 3 runs through the guard on a 24-core machine whose load average was 14-51 during the run \(cpu time ~ wall time, so this is real compute, inflated by contention\): /, '').replace(/ Load changes these by[^]*$/, '')}. ROUND 4 ADDITIONS: cylinder with a rim FILLET (E14/E14b/E15/E15b): ${stat(cylFil)}; cylinder with a rim BEVEL: ${stat(cylCha)}; ring (E19, 20 ring sizes 2 .. 500 across): ${stat(ringT)}; fuzz curved inputs the guard ACCEPTED (${fzCurved.length}): median ${fzCurved.length ? sec(med(fzCurved.map((r) => r.ms))) : 'n/a'}, slowest ${worst ? sec(worst.ms) + ' (' + worst.id + ', ' + worst.kind + ')' : 'n/a'}. EVERY ONE OF THESE BLOCKS A PAGE THAT RUNS THE CALL ON ITS MAIN THREAD for its whole duration. The numbers are inflated by contention (the machine was at load 40-120 during round 4; the same ring took 4.4 s and 69 s in different runs), so quote them as orders of magnitude: planar shapes and cones tens of ms, cylinders and bevels about a second, rounded boxes seconds, spheres, rings and rounded cylinders seconds to a minute.`
    , 'ring(40, 10): building this took more than 20 seconds, so it was stopped and is not shown -- try a bigger corner, a thicker tube, or fewer rounded edges.');
  if (br) {
    const wk = br.filter((r) => r.mode === 'worker'); const mn = br.filter((r) => r.mode === 'main');
    const env = br.find((r) => r.env)?.env;
    const tx = (r) => `${r.name}${r.timedOut ? ' (budget ' + r.budgetMs + ' ms, terminated)' : ''}: call ${r.callMs ?? '-'} ms in ${r.mode}, wall ${r.wallMs ?? r.callMs} ms, longest page freeze (50 ms heartbeat gap) ${r.hb.maxGapMs} ms, browser long tasks [${(r.hb.longTasksMs ?? []).join(', ')}] ms, machine load ${r.load.toFixed(0)}`;
    const nonblock = wk.every((r) => r.hb.maxGapMs < 1000);
    const blocked = mn.filter((r) => r.callMs > 1000).every((r) => r.hb.maxGapMs >= r.callMs * 0.8);
    add('browser: the SolidCraft call in a Web Worker (page stays responsive), on the main thread (page freezes), and ended by a budget with a sentence', 'unsupported',
      `MEASURED in headless Chromium (${env?.ua ?? '?'}; ${env?.cores ?? '?'} cores) through playwright-cli, page primitives-r4/browser/bench.html + worker.js, the SAME command JSON that the translator sends (captured by capture-cmds.mjs) replayed against the wasm-bindgen --target web build of the same rig wasm (23 MB). A 50 ms heartbeat timer runs on the page; its largest gap is how long the page was frozen. WORKER (${wk.length} calls): ${wk.map(tx).join(' || ')}. MAIN THREAD (${mn.length} calls): ${mn.map(tx).join(' || ')}. ${nonblock ? 'With the Worker the heartbeat never stalled (longest gap under 1 s even for the ring and the rounded cylinder).' : 'WITH THE WORKER THE HEARTBEAT STALLED: see the gaps above.'} ${blocked ? 'On the main thread the freeze equals the call time.' : 'On the main thread the freeze did not equal the call time for every case: see the gaps.'} The budget run terminates the worker (Worker.terminate()) when the budget is spent, the page keeps ticking, the next call starts a fresh worker (the 23 MB wasm is compiled again: initMs above), and window.sentenceFor(call, seconds) is the student sentence. WHAT THIS IS AND IS NOT: it proves the mechanism works in a real browser with this wasm; it is a harness page, not the product, and the product does none of it today (packages/studio calls nothing of the sort), so the row stays unsupported. Not measured: Safari/Firefox, a low-memory machine (the wasm needs a large heap for rings), several students' builds at once, and the first-load download of 23 MB.`
      + ' Command: PKG_WEB=<wasm-bindgen --target web dir> CMDS=<capture-cmds output> bun contract/primitives-r4/browser/run-bench.mjs contract/primitives-r4/results/browser-bench.json',
      'ring(40, 10): building this took more than 2 seconds, so it was stopped and is not shown -- try a bigger corner, a thicker tube, or fewer rounded edges.');
  } else {
    add('browser: the SolidCraft call in a Web Worker (page stays responsive), on the main thread (page freezes), and ended by a budget with a sentence', 'unsupported', 'NOT MEASURED: the browser benchmark did not run (results/browser-bench.json is missing). The Worker, the time budget and the "took too long" sentence are a requirement on the page, not a measured behaviour.');
  }
}

// =====================================================================================================================================
// ORACLE INDEPENDENCE, DEFERRED, ENVELOPE
// =====================================================================================================================================
add('independent (non-OCCT) check of wedge orientation and prism vertex phase', 'unsupported', keep(46) + ' ROUND 4: still not measured. A hand-written closed-form check of the wedge and prism vertex coordinates would restate occt-build, not test it, so it is not offered as independent evidence. What would close it: a FreeCAD (Part::Wedge / Part::Prism) or hand-drawn reference result for one wedge and one pentagonal prism.');
add('repeated, mirrored and booleaned primitives (repeat, mirror, join, cut, keep on primitives)', 'unsupported', 'NOT MEASURED IN THIS GROUP, by design: a primitive that is repeated, mirrored or combined goes through the patterns / mirror, move-turn and booleans groups (contract/patterns-mirror.json, move-turn.json, booleans.json), whose guards fold the primitive in. A primitive moved by move() or turned by turn() IS folded back into the placement rules here (guardDoc handles { kind: move } and { kind: rotate } features, including the sum of several turns) and is covered by the placement rows and by the fuzz below.');
{
  // whole-record 2x2 under the current guard, from the same DB
  const cnt = { good: [0, 0], wrong: [0, 0], unverified: [0, 0], kernel: [0, 0], interp: [0, 0] };
  for (const e of DB) cnt[e.o][e.g ? 1 : 0]++;
  assert(cnt.wrong[0] === 0 && cnt.unverified[0] === 0, `HOLE in the recorded set: ${DB.filter((e) => !e.g && (e.o === 'wrong' || e.o === 'unverified')).map((e) => e.r.id).slice(0, 5)}`);
  const badSent = DB.filter((e) => e.g && G.sentenceProblems(e.g.sentence).length);
  assert(badSent.length === 0, 'sentence lint: ' + badSent.map((e) => e.r.id));
  const fzTxt = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const f = A.res('fuzz-seed' + seed); if (!f) { fzTxt.push(`seed ${seed}: not run`); continue; }
    const es = f.map((r) => ({ r, o: outcome(r), g: r.doc ? G.guardFirst(r.doc) : null }));
    const acc = es.filter((e) => !e.g); const accWrong = acc.filter((e) => e.o === 'wrong' || e.o === 'unverified'); const wrongAll = es.filter((e) => e.o === 'wrong' || e.o === 'unverified');
    const tag = seed === 1 ? 'DEVELOPMENT sample (the first round 4 constants were fitted while looking at it)' : seed <= 3 ? 'held out from the FIRST round 4 constants, but its holes (cones turned and moved, huge far spheres, wide rounded discs) were then fixed with E22..E27, so for the FINAL guard it is a development sample too' : 'HELD-OUT sample for the FINAL guard (generated and run after the E27 constants were frozen, run once, nothing in the guard changed afterwards)';
    fzTxt.push(`seed ${seed} [${tag}]: ${es.length} inputs that the ROUND 3 guard accepted (frozen pool filter, so nothing is hidden by the new rules); the round 4 guard accepts ${acc.length} and refuses ${es.length - acc.length}; among ALL ${es.length}, truck built ${wrongAll.length} WRONG solids; accepted AND wrong = ${accWrong.length}${accWrong.length ? ' (' + accWrong.slice(0, 6).map((e) => e.r.id + ': ' + why(e)).join('; ') + ')' : ''}; accepted and correct ${acc.filter((e) => e.o === 'good').length}; accepted but the kernel refused ${acc.filter((e) => e.o === 'kernel').length}`);
  }
  add('pre-flight envelope (every limit in one place), its sample-based regression proof, and its limits as a proof', 'unsupported',
    `NOT WIRED: the guard is a prototype (contract/primitives.guard.mjs + primitives.call-lint.mjs) outside packages/script; nothing in the product calls it, so every row above whose refusalSentence is quoted is a wrong solid, a silent change, or kernel text TODAY. THE LIMITS (current LIM): ${JSON.stringify(G.LIM)}. WHAT THE EVIDENCE IS, AND IS NOT: "the guard accepts 0 wrong" over the recorded set is a closure over its own data (every constant was fitted to those runs), so it is reported but not claimed as proof. RECORDED SET (${DB.length} distinct inputs from every sweep of this group, primitives.guard-check.mjs and primitives-r4/truth.mjs): truck built a correct solid for ${cnt.good[0] + cnt.good[1]} (guard accepts ${cnt.good[0]}, refuses ${cnt.good[1]} on purpose), built a WRONG solid for ${cnt.wrong[0] + cnt.wrong[1]} (accepts ${cnt.wrong[0]}, refuses ${cnt.wrong[1]}), built a solid no oracle can check for ${cnt.unverified[0] + cnt.unverified[1]} (accepts ${cnt.unverified[0]}), and refused ${cnt.kernel[0] + cnt.kernel[1] + cnt.interp[0] + cnt.interp[1]} itself (guard gives a sentence to ${cnt.kernel[1] + cnt.interp[1]}). Every guard sentence passes the lint (starts with the call, no internal id, no kernel word, one sentence): 0 problems. OUT-OF-SAMPLE TEST, random inputs (primitives-r4/fuzz-gen.mjs, seeded; log-uniform sizes 0.001 .. 3e5, offsets 0 .. 1e6, 35% turned, corners 1e-6 .. 1.05 of the limit, prism sides including bad ones; the kernel ran UNGUARDED so the truth does not depend on any guard version, and the guard is applied offline): ${fzTxt.join(' || ')}. The held-out seeds are a sample of a 6-dimensional space with 1000 points, not a proof: a hole smaller than a few percent of the accepted volume can survive it, and the first held-out run found holes that were then fixed (see the next sentence). `
    + (A.res('fuzz-notes') ? '' : '')
    + `STILL OPEN: the guard is a prototype; the Worker and time budget are a requirement; no independent (non-OCCT) oracle for wedge orientation and prism vertex phase; repeated, mirrored and booleaned primitives belong to other groups; browsers other than headless Chromium were not tried.`
    + ' Rig: RIG.md "primitives group, round 4".');
}

// =====================================================================================================================================
// WRITE
// =====================================================================================================================================
const out = { group: 'primitives', rows };
const bad = rows.filter((r) => !['supported', 'refused', 'unsupported', 'wrong'].includes(r.status));
assert(bad.length === 0, 'bad status: ' + bad.map((r) => r.feature));
for (const r of rows) assert(r.evidence && r.evidence.length > 40, 'empty evidence: ' + r.feature);
for (const r of rows) if (r.status === 'refused' && !r.refusalSentence) throw new Error('refused row without a sentence: ' + r.feature);
const outPath = path.join(HERE, 'primitives.json');
writeFileSync(outPath, JSON.stringify(out, null, 1));
const tally = {}; for (const r of rows) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log(`wrote ${outPath}: ${rows.length} rows`, JSON.stringify(tally));
for (const r of rows) console.log(r.status.padEnd(12), r.feature.slice(0, 130));
