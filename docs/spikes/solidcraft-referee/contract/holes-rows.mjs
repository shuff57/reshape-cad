#!/usr/bin/env node
// Builds contract/holes.json from the raw per-case results (holes-results.json from holes-drive.mjs, later files override earlier ones
// for the same case id: the slow-case retries). Every row's status is asserted against the numbers; a row whose data disagrees with the
// status written here makes this script exit 1 instead of writing a guess.
//   bun contract/holes-rows.mjs <out.json> <results1.json> [<results2.json> ...]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

const [, , OUTFILE, ...INPUTS] = process.argv;
const R = new Map();
const TIMES = new Map();
for (const f of INPUTS) for (const r of JSON.parse(readFileSync(f, 'utf8'))) {
  R.set(r.id, r);
  if (typeof r.truckMs === 'number') TIMES.set(r.id, [...(TIMES.get(r.id) ?? []), { ms: r.truckMs, load: r.loadavg }]);
}
for (const [id, runs] of TIMES) { const r = R.get(id); r.runs = runs; r.truckMsBest = Math.min(...runs.map((x) => x.ms)); }
const g = (id) => { const r = R.get(id); if (!r) throw new Error(`no result for case ${id}`); return r; };

const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10);";
const BOX = 'const b = cuboid(40, 40, 20); ';
const POCKET = `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 6, { at: [22, 15] }); const p = pocket(s2, plate, 4);`;
const short = (s) => s.replace(POCKET, 'POCKET;').replace(PLATE, 'PLATE;').replace(BOX, 'BOX;').replace(/\s+/g, ' ').trim();
const e = (v) => (typeof v === 'number' ? (v === 0 ? '0' : v.toExponential(1)) : '-');
const n4 = (v) => (typeof v === 'number' ? v.toFixed(4) : '-');

/** compact, number-bearing evidence for one case */
function ev(r) {
  const s = short(r.script);
  if (r.verdict === 'timeout') return `${r.id}: [${s}] -> no result within ${r.timeoutSeconds} s (killed)`;
  if (r.verdict === 'script-error') return `${r.id}: [${s}] -> script error "${(r.scriptErrors ?? [r.scriptThrew])[0]}"`;
  const recess = !!(r.lastFeature?.counterbore || r.lastFeature?.countersink);
  const oc = r.occt?.refused ? `OCCT refused "${r.occt.refused}"` : `OCCT${recess ? ' (ignores the recess, plain bore)' : ''} V=${n4(r.occt?.volume)}${r.occt?.solids !== undefined ? ` (${r.occt.solids} solid${r.occt.solids === 1 ? '' : 's'}, ${r.occt.faces} faces)` : ''}`;
  const br = r.brep?.refused ? `brep-rs refused "${r.brep.refused}"` : `brep-rs V=${n4(r.brep?.volume)}`;
  const fc = r.fc ? `; FreeCAD V=${n4(r.fc.volume)} faces=${r.fc.faces}` : '';
  const cl = r.closed?.volume !== undefined ? `; closed form V=${n4(r.closed.volume)}` : '';
  if (r.verdict === 'truck-refused') return `${r.id}: [${s}] -> truck refused "${r.truck.refused}"; ${oc}; ${br}${fc}${cl}`;
  const c = r.cmp ?? {};
  const o = c.vsOcct;
  const slow = r.truckMsBest > 15000 ? ` [TRUCK TIME best ${(r.truckMsBest / 1000).toFixed(0)} s of ${r.runs.length} run${r.runs.length === 1 ? '' : 's'} (${r.runs.map((x) => `${(x.ms / 1000).toFixed(0)} s at load ${x.load?.toFixed(0)}`).join(', ')}; 24 cores; translated script, all features and prefix replays included)]` : '';
  const nums = o ? `dVol(OCCT)=${e(o.dVol)} dBbox=${e(o.dBbox)} dCOM=${e(o.dCom)} faces O/T=${o.faces}${o.faceVerdict && !o.faceVerdict.ok ? ' UNEXPLAINED-FACES' : ''}` : '';
  const extra = [c.vsBrep ? `dVol(brep)=${e(c.vsBrep.dVol)}` : '', c.vsClosed ? `dVol(closed)=${e(c.vsClosed.dVol)}` : '', c.vsFc ? `dVol(FC)=${e(c.vsFc.dVol)} dBbox(FC)=${e(c.vsFc.dBbox)}` : ''].filter(Boolean).join(' ');
  const dropped = r.droppedBodies?.length ? `; DROPPED by the layer: ${r.droppedBodies.map((b) => `${b.name} V=${n4(b.volume)} x ${b.bbox.slice(0, 3).map((v) => v.toFixed(2))}..${b.bbox.slice(3).map((v) => v.toFixed(2))}`).join(', ')}; true total over all ${r.allBodies.length} bodies V=${n4(r.allBodies.reduce((a, b) => a + b.volume, 0))}` : '';
  return `${r.id}: [${s}] -> truck V=${n4(r.truck.volume)} (${r.truck.bodies} body reported${dropped}); ${oc}; ${br}${fc}${cl}; ${nums} ${extra}${slow}`.trim();
}

// ---- status checks ------------------------------------------------------------------------------------------------
const CURVED = 3e-4; // truck volume/bbox of curved solids are tessellation-derived (~1e-4)
const okBuilt = (r) => {
  if (r.verdict !== 'truck-built') return `not built (${r.verdict})`;
  if (r.truck.bodies !== 1 || (r.droppedBodies?.length ?? 0) || (r.allBodies?.length ?? 1) !== 1) return 'more than one body';
  const c = r.cmp;
  const o = c.vsOcct;
  if (!o && !c.vsClosed && !c.vsFc && !c.vsBrep) return 'no oracle built it';
  if (o && !(o.dVol <= CURVED && o.dBbox <= CURVED && o.dCom <= 3e-5)) return `disagrees with OCCT dVol=${o.dVol} dBbox=${o.dBbox} dCom=${o.dCom}`;
  if (o && !o.faceVerdict.ok) return 'unexplained face-type mismatch vs OCCT';
  if (c.vsBrep && !(c.vsBrep.dVol <= CURVED)) return `disagrees with brep-rs ${c.vsBrep.dVol}`;
  if (c.vsClosed && !(c.vsClosed.dVol <= CURVED)) return `disagrees with closed form ${c.vsClosed.dVol}`;
  if (c.vsFc && !(c.vsFc.dVol <= CURVED && c.vsFc.dBbox <= CURVED)) return `disagrees with FreeCAD ${c.vsFc.dVol}`;
  return null;
};
const isRefused = (r) => (r.verdict === 'script-error' || r.verdict === 'truck-refused' ? null : `expected a refusal, got ${r.verdict}`);
const unchanged = (r) => {
  if (r.verdict !== 'truck-built') return `not built (${r.verdict})`;
  if (!(Math.abs(r.truck.volume - r.truckPrevVolume) <= 1e-9)) return `volume changed ${r.truckPrevVolume} -> ${r.truck.volume}`;
  return null;
};
const noop = (r) => unchanged(r) ?? (/does not touch the part/.test(r.brep?.refused ?? '') ? null : 'brep-rs did not refuse as "does not touch"');

const PROBE = (() => {
  const P = JSON.parse(readFileSync(path.join(HERE, 'holes-probe-recess.json'), 'utf8'));
  const ok = P.filter((x) => x.volume !== undefined);
  const mx = (k) => Math.max(...ok.map((x) => x[k] ?? 0));
  const same = ok.filter((x) => x.faces === x.fcFaces).length;
  return ` FEASIBILITY PROBE (not part of the translator; contract/holes-probe-recess.mjs, solidcraft's native solid.hole with type counterbore|countersink, cs_angle as the included angle): ${ok.length}/${P.length} gauntlet recess cases built one body; worst final-volume delta vs the FreeCAD ref ${mx('dFc').toExponential(1)}, vs the closed form ${mx('dClosed').toExponential(1)}, worst removed-volume delta ${mx('dFcRemoved').toExponential(1)}; face count equals FreeCAD in ${same}/${ok.length} (the tangent-rim case gives 7 vs FreeCAD 8). These 12 gauntlet cases are right, but they are the easy geometry: the rows below list where the same native call is WRONG (countersink cone deeper than a blind hole; bore over a pocket) or silently different from brep-rs (counterbore deeper than the part). It is NOT wired, so the status above stands.`;
})();
const relTo = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const SLOW_MS = 45000; // rule used in this group: a bore whose BEST observed truck time is over 45 s is not a working feature (no unloaded time was obtainable, so best-of-runs is the proxy)
const rows = [];
const cmdFor = (ids) => `SOLIDCRAFT_REFEREE_PKG=$PKG bun docs/spikes/solidcraft-referee/contract/holes-drive.mjs --out=$OUT --only=${ids.join(',')}`;
function row(feature, expect, ids, { check, note, sentence, probe } = {}) {
  const problems = [];
  for (const id of ids) {
    const r = g(id);
    const p = check ? check(r) : expect === 'supported' ? okBuilt(r) : expect === 'refused' ? isRefused(r) : null;
    if (p) problems.push(`${id}: ${p}`);
    if (expect === 'supported' && r.truckMsBest > SLOW_MS) problems.push(`${id}: truck time ${(r.truckMsBest / 1000).toFixed(0)} s is over the ${SLOW_MS / 1000} s interactive budget, cannot be 'supported'`);
  }
  if (problems.length) { console.error(`ROW "${feature}" expected ${expect} but: ${problems.join(' | ')}`); process.exitCode = 1; }
  const first = g(ids[0]);
  const out = { feature, status: expect };
  if (expect === 'refused') {
    out.refusalSentence = sentence ?? (first.verdict === 'script-error' ? (first.scriptErrors ?? [first.scriptThrew])[0] : first.truck?.refused);
  }
  out.evidence = `${expect === 'wrong' ? 'WRONG SOLID. ' : ''}${note ? note + ' ' : ''}${probe ? PROBE.trim() + ' ' : ''}Command: ${cmdFor(ids)}. ${ids.map((id) => ev(g(id))).join(' || ')}`;
  rows.push(out);
}

// ========================= core: hole(), across, diameter =========================================================
row('hole(shape,{across}): through bore on a box/pad/prism/moved box, centred and offset (HoleFeature diameter, depth, center, axis z)', 'supported', [
  'core-centred-through', 'core-at-xy', 'core-5-digit-precision', 'g:hole-simple__offcentre-through', 'g:hole-simple__big-and-thick', 'g:hole-simple__tiny-deep',
  'g:hole-simple__breaks-out-of-the-side', 'g:hole-simple__hexagon-prism', 'through-thick-60', 'moved-box', 'moved-box-blind'],
{ note: 'PLATE = 40 x 30 x 10 plate pulled from a sketch(\'top\') rectangle; BOX = cuboid(40,40,20). Truck cuts a solid.cylinder at the target bbox centre + center. Removed volume matches the closed form to 1.7e-4 (a constant n-gon signature of truck\'s tessellated cylinder), final volume 4e-6 to 3e-5; FreeCAD refs (gauntlet) agree.' });
row('across: diameter, widest bore that still fits (29.9 across on a 30 deep plate, 38 across on a 40 x 40 box, 29 across on a 30 cylinder)', 'supported', ['core-widest-that-fits', 'wide-box38-control', 'wide-cyl29-control'], {});
row('across wider than the part\'s narrowest side (31, 30.5, 35 across on a 30 deep plate): the bore splits the part in two', 'wrong',
  ['wider-than-plate-35', 'wider-than-plate-31', 'wider-than-plate-30p5'],
  { check: (r) => (r.verdict === 'truck-built' && r.droppedBodies?.length === 1 && /would not fit/.test(r.brep?.refused ?? '') && /would not fit/.test(r.occt?.refused ?? '') ? null : 'not the expected dropped-piece pattern'),
    note: 'The cut leaves TWO disjoint pieces ("b_pull1" and "b_pull1 (1)"); the translator\'s aggregate() keeps only the body it named, so the layer reports and measures ONE piece (half the part) with no sentence. Direct solidcraft run of the same commands lists both bodies (35 across: 1494.8223 + 1494.8223 = 2989.6446 mm3 true total; the layer reports 1494.8223). OCCT and brep-rs both refuse: "Boring hole1 at diameter 35 would not fit pull1 -- hole1 is shown without it." Needs a pre-flight guard: refuse when across > the smallest bbox extent perpendicular to the drill axis (the OCCT rule), or when the cut yields more than one body.' });
row('across equal to the narrowest side of the part (30 across on the 30 deep plate, 40 across on the 40 x 40 x 20 box): tangent to the sides, the part is left as disjoint pieces joined only along lines', 'wrong',
  ['wider-than-plate-30-exact', 'wide-box40-tangent'],
  { check: (r) => (r.verdict === 'truck-built' && r.occt?.solids >= 2 && r.truck.bodies === 1 && !(r.droppedBodies?.length) && r.truck.faces !== r.occt.faces && /cannot cut this hole/.test(r.brep?.refused ?? '') ? null : 'not the expected one-body-versus-several-solids pattern'),
    note: 'OCCT cuts it into SEVERAL solids (plate: 2 solids / 13 faces, box: 4 solids / 20 faces); truck reports ONE body (9 and 13 faces) and the layer reports one solid with no sentence. Direct engine run (contract/holes-probe-wide.mjs -> holes-probe-wide.json): that single truck body holds kernel shells=2 (plate) and shells=4 (box), while the controls 29.99 and 39.99 across hold shells=1, so the pieces are fused into one non-manifold body that touches itself along lines. Volume and bbox agree with OCCT (<= 4.0e-4, tessellation) so a volume gate cannot see it; the face count is the tell. brep-rs refuses both ("brep-rs cannot cut this hole yet"). Needs a guard: refuse when across >= the smallest bounding-box extent perpendicular to the drill axis (the OCCT and brep-rs "would not fit" rule uses > only; equal is the tangent case). ' });
row('across wider than the part on a box (41 across on a 40 x 40 x 20 box): four corner pieces, the layer reports one', 'wrong', ['wide-box41'],
  { check: (r) => (r.verdict === 'truck-built' && r.droppedBodies?.length === 3 && /would not fit/.test(r.occt?.refused ?? '') && /would not fit/.test(r.brep?.refused ?? '') ? null : 'not the expected dropped-pieces pattern'),
    note: 'Truck holds FOUR bodies of about 1459 mm3 (true total 5836.6; numeric closed form 5829.4, the 7 mm3 gap is the tessellated 41 mm bore); the layer names one and reports V=1459.19, a quarter of the part, with no sentence. OCCT and brep-rs refuse "would not fit". Same guard as the row above. ' });
row('bore tangent to one side of the part along a line (10 across, centre 5 from the x=40 face of the plate)', 'unsupported', ['bore-tangent-to-edge'],
  { check: (r) => (r.verdict === 'truck-built' && r.cmp.vsOcct.dVol < 1e-4 && r.occt.solids === 1 && r.truck.faces !== r.occt.faces ? null : 'not the expected built-with-different-faces pattern'),
    note: 'NOT marked supported because the result cannot be shown to be a valid solid. One body whose volume, bbox and COM match OCCT (dVol 1.5e-5), but its faces differ (truck 7, OCCT 8) and the kernel counts jump from 8 faces / 18 edges (9.99 across) to 9 / 23 (10 across) with shells=1 (holes-probe-wide.json): the bore wall touches the x=40 face along a line, an edge shared by four face sides, and nothing in this rig checks that truck keeps it a manifold. brep-rs refuses ("brep-rs cannot cut this hole yet"). Unsupported until a manifold check exists. ' });
row('across: 0, negative or non-numeric', 'refused', ['across-zero', 'across-negative', 'across-string', 'across-nan']);
row('across/size omitted (hole(shape) and hole(shape,{}))', 'refused', ['no-across-no-size', 'no-options']);
row('unknown option name; missing shape argument', 'refused', ['unknown-option', 'hole-no-shape']);

// ========================= size =====================================================================================
for (const n of ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12']) {
  const d = { M3: 3.4, M4: 4.5, M5: 5.5, M6: 6.6, M8: 9, M10: 11, M12: 13.5 }[n];
  row(`size: '${n}' (clearance ${d} mm)`, 'supported', [`size-${n}`], { note: `${n} resolves to across ${d} at interpret time; removed volume = pi*${d / 2}^2*10 checked against the closed form.` });
}
row('size name is case-insensitive and trimmed (\'m6\', \'  M6 \')', 'supported', ['size-lowercase-m6', 'size-padded-M6']);
row('size: unknown name text (\'M7\', \'M2\')', 'refused', ['size-M7', 'size-M2'],
  { note: 'SENTENCE DEFECT (reshape-script.ts, read-only here): the text "the size the text" is ungrammatical. It should read: hole() does not know the size "M7". The refusal itself is safe (nothing is built). ' });
row('size: a number instead of a name (6)', 'refused', ['size-number']);
row('across and size together', 'refused', ['across-and-size']);

// ========================= deep omitted: through =====================================================================
row('deep omitted: through hole on a cylinder and a cone (depth = thickness along axis + 2)', 'supported', ['through-cylinder-axis', 'through-cone', 'g:hole-simple__in-cylinder'], { note: 'Curved hosts: final volume and bbox within truck tessellation (<= 3e-4).' });
row('deep omitted: through hole on a sphere', 'supported', ['through-sphere'], { note: 'Correct but slow (see the TRUCK TIME bracket: best 23 s of three runs, 23 to 56 s depending on the machine load; an unloaded time could not be obtained on this box). ' });
row('deep omitted: through hole on a ring (torus) that passes through the tube (bore on the ring centreline)', 'unsupported', ['through-ring-offset-hits'],
  { check: okBuilt, note: 'The result is CORRECT (final volume 2113.158 vs OCCT 2113.250, dVol 4.4e-5; numeric closed form 2112.934; the removed volume differs 1.2% only because the host torus itself is tessellated) but it is not a working feature: the cylinder-minus-torus cut needs minutes of truck time (see the TRUCK TIME bracket: best 250 s; 511 s in the first pass under load) with no time budget, progress or refusal in the layer. A student would wait several minutes for one bore. Marked UNSUPPORTED by this group\'s rule (a bore whose best-observed truck time is over 45 s is not marked supported). ' });
row('deep omitted: through hole that touches no material, bore down the empty centre of a ring (ring 30 / tube 6, 2 across)', 'unsupported', ['through-ring-misses'],
  { check: (r) => (r.verdict === 'truck-refused' && /came out empty/.test(r.truck.refused) ? null : 'expected the raw empty-cut stop'),
    note: 'Nothing wrong is built, but what the student would see is engine jargon, not a sentence: "hole1 (hole): solidcraft refused it -- solid.cylinder: the cut could not be computed reliably: it came out empty. The result was refused rather than kept wrong; where the bodies only touch (faces flush with each other), overlapping them slightly usually helps (refined tolerance 1.693712e-2 mm)". It never says the hole misses the part and its advice (overlap the bodies) does not apply to a hole. UNSUPPORTED, not refused. OCCT builds the unchanged ring silently; brep-rs refuses plainly: "hole1 does not touch the part, so it cuts nothing -- hole1 is shown without it." ' });
row('deep omitted: through hole that touches no material, bore down the empty centre of a ring (ring 30 / tube 6, 4 across)', 'wrong', ['through-ring-misses-4'], { check: noop,
  note: 'The same miss with a wider bore is a SILENT NO-OP: the layer returns the unchanged ring (V=2131.52 before and after, 1 face) with no sentence, where the 2-across bore got a (jargon) refusal. OCCT does the same; brep-rs refuses "hole1 does not touch the part, so it cuts nothing". Same no-op guard as the single hole off the part. ' });
row('deep omitted: refused when thickness cannot be found (intersect, polar pattern of a wedge, shape after turn step)', 'refused',
  ['through-unknown-intersect', 'through-unknown-polar-wedge', 'through-unknown-after-turn-step', 'holes-unknown-intersect']);

// ========================= deep: blind ==============================================================================
row('deep given: blind from the drilled face (axial offset from exact thickness), box, pad, hex prism, cylinder', 'supported',
  ['blind-deep-8-of-20', 'blind-offset-at', 'blind-tiny-0p5', 'blind-just-short-19p9', 'blind-on-pulled-sketch', 'blind-in-cylinder', 'blind-in-hex-prism', 'g:hole-simple__blind-4', 'pad-circle-sketch', 'pad-L-blind']);
row('deep given: blind into a sphere', 'supported', ['blind-in-sphere'], {});
row('deep >= thickness (deep equals or exceeds the part) is a through hole', 'supported', ['blind-equals-thickness', 'blind-beyond-thickness', 'blind-deep-ge-bound-on-pocket', 'blind-unknown-intersect-deep-30']);
row('deep given on a result that only has an upper bound on its thickness (pocket result, subtract result): refused', 'refused', ['blind-on-pocket-result', 'blind-on-subtract-result']);
row('deep given where the thickness is unknown (intersect result, turned wedge): hole is centred and leaves a sealed cavity', 'wrong', ['blind-unknown-intersect-4', 'blind-wedge-turned'],
  { check: (r) => (r.verdict === 'truck-built' && /sealed cavity/.test(r.brep?.refused ?? '') ? null : 'brep-rs did not call it a sealed cavity'),
    note: 'Script comment promises "the kernel refuses a tool that would leave a sealed cavity inside the part". Truck does NOT: it builds the part with an internal void (volume reduced by pi*3^2*4 = 113.1 / pi*1^2*3 = 9.42, extra void faces). OCCT agrees with truck (same defect, so a truck-vs-OCCT gate cannot see it); brep-rs refuses: "hole hole1 would leave a sealed cavity inside the part instead of opening onto a face". Needs a guard: after a blind cut, refuse when the removed volume equals the tool volume and the tool does not reach the part surface (or when the result has an inner shell).' });

// ========================= along / at ==============================================================================
row('along: \'x\' and \'y\' (default at), through', 'supported', ['along-x-default-at', 'along-y-default-at', 'g:hole-simple__along-x', 'g:hole-simple__along-y']);
row('along: \'z\' explicit with at, and blind along x / y (offset on the right axis)', 'supported', ['along-z-explicit', 'along-x-blind', 'along-y-blind', 'pad-side-plane', 'pad-front-plane-offset']);
row('along: any other value (\'w\', \'Z\')', 'refused', ['along-bad-axis', 'along-upper-case']);
row('at:[a,b] in-plane position for z, y and x drills (z: x,y; y: x,z; x: y,z)', 'supported', ['core-at-xy', 'g:hole-simple__along-x', 'g:hole-simple__along-y', 'along-x-blind', 'along-y-blind', 'at-half-off-edge']);
row('at with a wrong number of values ([1], [1,2,3])', 'refused', ['at-wrong-length', 'at-three-values']);
row('at: non-finite value (NaN, Infinity)', 'refused', ['at-nan', 'at-infinity'],
  { note: 'SENTENCE DEFECT (reshape-script.ts, read-only here): the refusal is safe (nothing is built) but the diagnosis is misleading. The list [NaN, 0] has two numbers, yet the sentence says "got a list of 2", so a student cannot tell what is wrong. It should say that at needs two finite numbers [u, v]. ' });
row('at: position off the part, the bore touches no material', 'wrong', ['at-off-the-part'], { check: noop,
  note: 'at:[50,0] on a 40 x 30 plate: the layer returns the UNCHANGED plate (V=12000 before and after) with no sentence. OCCT does the same; brep-rs refuses "hole1 does not touch the part, so it cuts nothing -- hole1 is shown without it." Needs a guard: refuse when a hole removes no volume.' });
row('hole whose centre lies in empty space of the host (L-shaped pad, bbox centre in the notch)', 'wrong', ['pad-L-hole-in-notch'], { check: noop,
  note: 'The bore is centred on the bounding-box centre + at; for an L-shaped pad that centre is in the notch, the bore cuts air and the layer returns the unchanged L (V unchanged) with no sentence. brep-rs refuses "hole1 does not touch the part". Same guard as above.' });

// ========================= counterbore ===============================================================================
const CB = ['g:hole-counterbore__through-offset', 'g:hole-counterbore__deep-recess', 'g:hole-counterbore__blind', 'g:hole-counterbore__wide-thin', 'g:hole-counterbore__in-cylinder', 'cb-through-simple', 'cb-size-M6', 'cb-along-x'];
const unmapped = (r) => (r.verdict === 'truck-refused' && /not mapped in phase 0/.test(r.truck.refused) ? null : `expected the generic translator stop, got ${r.verdict}`);
row('counterbore:{across,deep} (through, blind, in a cylinder, along x, with size)', 'unsupported', CB,
  { check: unmapped, probe: true, note: 'The translator does not map recesses. It stops EVERY counterbore with the same developer sentence ("hole1 (hole): counterbore and countersink are not mapped in phase 0"), which names no geometry and gives no way out, so by the status definitions this is UNSUPPORTED (not mapped, no student sentence), not a refusal. Nothing wrong is built. Oracles that cut counterbores: brep-rs and FreeCAD (gauntlet refs); my closed form equals FreeCAD to 1.6e-16 on the plate hosts (1.0e-4 on the cylinder host, whose truck volume is tessellated). Live OCCT does NOT cut recesses (occt-build.ts ignores counterbore/countersink), so OCCT is no oracle for these rows. ' });
row('counterbore geometric degeneracy (narrower than bore, equal to bore, deeper than the hole, deeper than the plate, as wide as the plate)', 'unsupported',
  ['cb-narrower-than-bore', 'cb-equal-to-bore', 'cb-deeper-than-blind-hole', 'cb-deeper-than-plate', 'cb-as-wide-as-plate'],
  { check: unmapped, note: 'Same generic translator stop for all five geometries, so no geometry-specific sentence exists. brep-rs gives specific sentences (e.g. "its counterbore or countersink is not a shape brep-rs can cut yet"; as-wide-as-plate: "its rim would touch the part\'s edge at a single point"), and the native solid.hole path would NOT refuse the deeper-than-plate case (see the next rows). ' });
row('counterbore with a missing or zero parameter', 'refused', ['cb-missing-across', 'cb-missing-deep', 'cb-zero-deep']);

// ========================= countersink ===============================================================================
const CS = ['g:hole-countersink__angle-90-offset', 'g:hole-countersink__angle-120', 'g:hole-countersink__angle-60', 'g:hole-countersink__thick-block', 'g:hole-countersink__blind', 'g:hole-countersink__in-cylinder',
  'g:hole-countersink__cone-deeper-than-plate-roomy', 'g:hole-countersink__cone-deeper-than-plate-angle-60', 'cs-90-simple', 'cs-120', 'cs-angle-179', 'cs-size-M5-along-y'];
row('countersink:{across,angle} (90/120/60 degrees included, blind, in a cylinder, cone leaving the bottom, along y, 179)', 'unsupported', CS,
  { check: unmapped, probe: true, note: 'The translator stops every countersink with the same developer sentence ("hole1 (hole): counterbore and countersink are not mapped in phase 0"): UNSUPPORTED, nothing wrong is built. Oracles: FreeCAD gauntlet refs and brep-rs; closed form equals FreeCAD to 1.6e-16 including the cone-leaves-the-bottom cases. Live OCCT ignores recesses, so it is no oracle here. ' });
row('countersink tangent rim (30 across mouth on a 30 deep plate)', 'unsupported', ['g:hole-countersink__cone-deeper-than-plate'], { check: unmapped, note: 'Translator stop; FreeCAD builds 8596.6080 (8 faces); the native probe builds 7 faces (rim topology differs); brep-rs refuses the tangent rim. ' });
row('countersink degeneracy (narrower than the bore, equal to the bore)', 'unsupported', ['cs-narrower-than-bore', 'cs-equal-to-bore'], { check: unmapped });
row('countersink included angle >= 180, <= 0, or missing across/angle', 'refused', ['cs-angle-180', 'cs-angle-200', 'cs-angle-0', 'cs-angle-negative', 'cs-missing-angle', 'cs-missing-across']);
row('counterbore and countersink together', 'refused', ['cb-and-cs']);

// ========================= holes() ===================================================================================
row('holes(shape,{apart:[dx,dy]}): four-corner holes along z (HoleFeature.corners dx,dy = apart/2): plate, size, at, in a cylinder, blind', 'supported',
  ['holes-corners-simple', 'holes-corners-at', 'holes-corners-size-M4', 'holes-corners-blind', 'holes-corners-blind-5', 'holes-corners-in-cylinder']);
row('holes(): bores that overlap pairwise, break out of the sides, or coincide (apart 0)', 'supported', ['holes-overlapping-columns', 'holes-break-out-side', 'holes-zero-spacing']);
row('holes(): every bore misses the part (apart larger than the plate)', 'wrong', ['holes-all-outside', 'holes-two-outside'], { check: noop,
  note: 'The layer returns the unchanged plate with no sentence. brep-rs refuses "hole1 does not touch the part, so it cuts nothing". Same guard as the single hole.' });
row('holes(): along \'x\' or \'y\' (and blind along x): corners are placed on x and y instead of the two axes the drill does not point along', 'wrong',
  ['holes-along-x', 'holes-along-y', 'holes-along-x-blind', 'holes-along-x-at'],
  { check: (r) => { const q = (r.truckPrevVolume - r.truck.volume) / (r.closed?.removed ?? 1); return r.verdict === 'truck-built' && q > 0.3 && q < 0.9 ? null : `removed/closed ratio ${q}`; },
    note: 'Documented (model-types.ts HoleFeature.corners): four bores at +-apart/2 on the two axes the drill does NOT point along. The translator (copying occt-build.ts) always puts the offsets on world x and y, so a bore along x gets two distinct lines, each cut twice: the layer removes HALF the volume the closed form requires for through bores (4 bores expected, 2 distinct lines built; holes-along-x removes 251.3 of 502.7 mm3, closed form 4*pi*1^2*40) and two thirds for the blind one (bores also run 5 mm too deep because the two x-offset copies overlap). Truck, OCCT and the translator agree with each other (shared defect); brep-rs refuses with "its bores overlap in a way brep-rs cannot fuse into one tool yet". The independent closed form is the only thing that catches it. Needs a guard or a fix: refuse holes() with along other than z, or place corners on the perpendicular axes.' });
row('holes() with counterbore or countersink', 'unsupported', ['holes-counterbore', 'holes-countersink'], { check: unmapped,
  note: 'Generic translator stop. The native path was probed on the one geometry nobody else builds, neighbouring recesses that overlap: see the overlapping-recess row. ' });
row('holes() without apart or without across', 'refused', ['holes-no-apart', 'holes-no-across']);

// ========================= hosts =====================================================================================
row('hole on a pocket result: clear of the pocket, through the pocket floor, half in the pocket wall, two holes in a row', 'supported',
  ['pocket-hole-clear', 'pocket-hole-through-floor', 'pocket-hole-half-in-wall', 'pocket-through-hole-at-pocket-centre-deep-bound', 'pocket-then-two-holes'],
  { note: 'Through depth = upper bound + 2 (10 + 2). POCKET = a 10 x 6 rect pocket 4 deep at the top face. Floor hole removes only the 6 mm floor (pi*2^2*6 closed form).' });
row('hole on a pad: L-shaped pad with the bore in the leg, circle pad, side and offset front planes', 'supported', ['pad-L-hole-in-leg', 'pad-circle-sketch', 'pad-side-plane', 'pad-front-plane-offset']);
row('hole on a rotated shape: box turned about z 30 and x 90 (through and blind), box tilted 45 degrees about y (through)', 'supported',
  ['rot-box-z30', 'rot-box-z30-blind', 'rot-box-x90-hole-z', 'rot-box-y45-hole-z'], { note: 'y45 through: removed volume pi*3^2*10/cos45 = 399.9 closed form.' });
row('hole on a cylinder lying along y (turned 90 about x), bore along z', 'unsupported', ['rot-cylinder-x90-hole-z'], { check: okBuilt,
  note: 'CORRECT (dVol 2.4e-5 vs OCCT and brep-rs) but a bore across a curved wall takes minutes (best truck time 101 s, see the TRUCK TIME bracket) with no time budget in the layer, so by this group\'s rule (best-observed truck time over 45 s) it is UNSUPPORTED, not supported. ' });
row('blind hole on a box tilted 45 degrees: the offset comes from the bounding-box top, which is in air at the bore position', 'wrong', ['rot-box-y45-blind'], { check: unchanged,
  note: 'deep:3 from the bbox top (z=17.7) of a 45-degree tilted slab: the bore never reaches material. The layer returns the unchanged slab (volume unchanged) with no sentence. OCCT does the same; brep-rs refuses the rotated target with "hole hole1: brep-rs cannot cut this hole yet" (it does not say the bore misses). Needs the no-op guard.' });
row('hole on a cone turned to lie along x (bore across the axis)', 'unsupported', ['rot-cone-turned-through'],
  { check: (r) => (r.verdict === 'truck-refused' && /boolean Cut: the operation failed/.test(r.truck.refused) ? null : 'expected the raw boolean failure'),
    note: 'Nothing wrong is built, but what the student would see is a raw truck dump, not a sentence: "hole1 (hole): solidcraft refused it -- solid.cylinder: boolean Cut: the operation failed: no result; the operation failed: not supported yet: the exact fallback for where the bodies meet ... takes planar faces only, and the target has 3 curved faces (cone) and the tool has 2 curved faces (cylinder); nudged: ..." (repeated). It names engine internals and gives no way out, so UNSUPPORTED, not refused. brep-rs gives a plain sentence ("a cone can be drilled down its own axis (z), or ..."); OCCT builds it (V=3110.33). ' });
row('hole on a turned hexagonal prism (extent not provable)', 'refused', ['rot-prism-turned']);
row('hole on a subtract (cut) result: through, and bore centred on the cut wall', 'supported', ['cut-hole-through', 'cut-hole-into-cut-edge']);
row('hole on a join (union) result, blind', 'supported', ['union-hole-blind']);
row('hole on a cross-bore through a cylinder (bore along x through a z cylinder)', 'unsupported', ['cross-bore-through-cylinder'], { check: okBuilt,
  note: 'CORRECT (dVol 2.6e-5 vs OCCT and brep-rs) but slow (best truck time 58 s, 89 s in another run, see the TRUCK TIME bracket): UNSUPPORTED by this group\'s rule (best-observed truck time over 45 s). ' });
row('bore as wide as, or wider than, a cylinder host (cylinder 30 x 20 with 30 or 40 across)', 'unsupported', ['wide-cyl30', 'wide-cyl40'],
  { check: (r) => (r.verdict === 'truck-refused' && /no body named b_cyl1/.test(r.truck.refused) ? null : 'expected the internal-name stop'),
    note: 'Nothing wrong is built (the swallowed part leaves no body), but the sentence the student would get names an internal body id: "hole1 (hole): solidcraft refused it -- solidcraft ran the commands but no body named b_cyl1 came back". That is not a plain sentence, so UNSUPPORTED. For comparison, 40 across: OCCT and brep-rs say "Boring hole1 at diameter 40 would not fit cyl1 -- hole1 is shown without it."; 30 across: OCCT throws, brep-rs "brep-rs cannot cut this hole yet". The control 29 across (0.5 mm tube) is in the widest-bore row. ' });
row('hole on a repeat() result whose copies do not touch (3 boxes 20 x 20 x 10, step 30, 4 across; on the middle copy and on the first copy)', 'wrong', ['pat-disjoint-hole', 'pat-disjoint-hole-first-copy'],
  { check: (r) => (r.verdict === 'truck-built' && r.droppedBodies?.length === 2 && relTo(r.brep.volume, r.closed.volume) < 1e-9 && relTo(r.occt.volume, r.closed.volume) < 1e-9 && relTo(r.truck.volume, r.closed.volume) > 0.1 ? null : 'not the expected dropped-copies pattern'),
    note: 'The bore is cut into one copy (the middle one at the bounding-box centre, or the first one with at:[-30,0]) but the layer reports only the body named b_box1, so the other two copies vanish from the measure and the shape: it reports V=4000 (the UNDRILLED first copy, 6 faces, hole lost) for the middle-copy bore, or V=3874.36 (first copy drilled, 7 faces) for the first-copy bore, where OCCT and brep-rs both give 11874.336 (3 solids, 19 faces) and the closed form 3 x 4000 - pi*2^2*10 = 11874.336. No sentence. Direct engine listing (allBodies) shows all three copies alive, so nothing is lost inside truck: the translator\'s one-body aggregate drops them. Needs a guard: refuse a hole whose target is a multi-body result, or measure every body. ' });
row('hole on a repeat() result whose copies touch (step 20: one fused block)', 'supported', ['pat-touching-hole'], { note: 'Control for the row above. ' });
row('hole on a hollow() result (box 40 x 30 x 20, wall 2, open top; 6 across through the floor)', 'supported', ['hollow-open-top-hole'],
  { note: 'The open-top face of the hollow is picked through brep-rs resolve (the translator\'s ctx.resolveAt), so this row depends on the archived brep-rs. With no resolver the hollow is refused by dependency ("solid.shell: invalid parameters ... `faces` must be a list of points") and the hole after it with it. ' });
row('hole on a round()ed box (box 40 x 40 x 20 with all edges r2): 6 across through', 'supported', ['round-box-hole-through']);
row('hole on a round()ed box: 37 across, reaching into the rounded top and bottom rims', 'unsupported', ['round-box-hole-37'], { check: okBuilt,
  note: 'CORRECT against OCCT (dVol 3.8e-5, 33/33 faces; brep-rs refuses it: "the cut reaches a rounded, chamfered or otherwise curved face of the part", so OCCT is the only oracle) but the cut needs about a minute (best truck time 60 s, see the TRUCK TIME bracket): UNSUPPORTED by this group\'s rule (best-observed truck time over 45 s). ' });
row('hole on a revolve (spin) result: blind', 'supported', ['revolve-hole-wall-blind']);
row('hole on a revolve (spin) result: through (deep omitted)', 'refused', ['revolve-hole-wall']);
row('hole on a mirror() result when the hole targets the mirror (const m = mirror(a, ...); hole(m, ...)): through and blind', 'supported', ['mirror-hole-seam-var', 'mirror-hole-seam-var-blind']);
row('hole on the ORIGINAL name after a mirror (mirror(a, ...); hole(a, ...))', 'unsupported', ['mirror-hole-seam'],
  { check: (r) => (r.verdict === 'truck-refused' && /already changed in place/.test(r.truck.refused) ? null : 'expected the already-changed stop'),
    note: 'Nothing wrong is built, but the student would see: "hole1 (hole): its target box1 was already changed in place by mir1, and a solidcraft command list has no second copy of it" - internal wording, no way out. UNSUPPORTED. OCCT and brep-rs build it (V=3874.336). ' });
row('successive holes: second/third bore on the earlier hole result (stacked blind bores, overlapping bore, narrower bore below an earlier floor, holes() then hole())', 'supported',
  ['g:hole-simple__two-holes-sequential', 'bores-blind-stacked', 'bore-overlapping-second', 'bore-into-previous-bore-floor', 'holes-then-hole'],
  { note: 'Closed form is for the total removed from the original plate/box.' });

// ---- native solid.hole recess geometries a naive mapping would get WRONG (contract/holes-probe-recess2.mjs, holes-probe-recess2.json) ----
const P2 = JSON.parse(readFileSync(path.join(HERE, 'holes-probe-recess2.json'), 'utf8'));
const f3 = (v) => (typeof v === 'number' ? v.toFixed(3) : '-');
const p2 = (id) => {
  const x = P2.find((r) => r.id === id); if (!x) throw new Error(`no probe2 case ${id}`);
  return `${id} [${x.what}] native solid.hole removes ${f3(x.native.removed)} mm3${x.native.refused ? ` (native REFUSED ${x.native.refused})` : ''}; closed form ${f3(x.closedRemoved)}; brep-rs ${x.brep.refused ? `refuses "${x.brep.refused}"` : `removes ${f3(x.brepRemoved)}`}`;
};
function probeRow(feature, expect, ids, check, note) {
  const problems = ids.map((id) => { const x = P2.find((r) => r.id === id); const p = x ? check(x) : 'missing'; return p ? `${id}: ${p}` : null; }).filter(Boolean);
  if (problems.length) { console.error(`PROBE ROW "${feature}" expected ${expect} but: ${problems.join(' | ')}`); process.exitCode = 1; }
  rows.push({ feature, status: expect, evidence: `${note} Command: SOLIDCRAFT_REFEREE_PKG=$PKG bun docs/spikes/solidcraft-referee/contract/holes-probe-recess2.mjs --out=$OUT (native solid.hole appended to the translated base part; truck run time of the whole probe about 4 minutes at load average 30). ${ids.map(p2).join(' || ')}` });
}
probeRow('countersink whose cone is deeper than a blind hole (countersink 12/90 over a 6 bore, blind 1, 2, 2.5, 3, cone alone 3 deep)', 'unsupported',
  ['cs-cone-deeper-than-blind-deep1', 'cs-cone-deeper-than-blind-deep2', 'cs-cone-deeper-than-blind-deep2.5', 'cs-cone-deeper-than-blind-deep3'],
  (x) => (x.native.removed !== undefined && Math.abs(x.native.removed - 205.571) < 0.01 && relTo(x.native.removed, x.closedRemoved) > 0.03 && /not a shape brep-rs can cut/.test(x.brep.refused ?? '') ? null : 'not the expected fixed-205.57 pattern'),
  'WOULD BE A SILENT WRONG SOLID IF WIRED (the translator does not map it, so today it is unsupported). The native solid.hole always cuts a full 3 mm cone: it removes 205.571 mm3 whatever the blind depth is (1, 2, 2.5 or 3), overshooting the hole floor, while the analytic answer shrinks with the depth (95.3, 159.2, 181.3, 197.9) and a 4 mm blind hole (cone fits) is right to 7.5e-5. brep-rs refuses these. A mapping needs a guard: refuse a countersink whose cone depth (mouth - bore) / (2 tan(angle / 2)) exceeds the blind depth.');
probeRow('recess measured from the wrong face when the bore column starts over a pocket (counterbore 9 x 7 and 9 x 3, countersink 8/90, bore 4 centred in a 16 x 12 x 4 pocket)', 'unsupported',
  ['cb-in-pocket-9x7', 'cb-in-pocket-9x3', 'cs-in-pocket-8x90'],
  (x) => (x.native.removed !== undefined && relTo(x.native.removed, x.closedRemoved) > 0.03 && x.brep.volume !== undefined && relTo(x.brepRemoved, x.closedRemoved) < 1e-6 ? null : 'native did not disagree with a brep-rs that matches the closed form'),
  'WOULD BE A SILENT WRONG SOLID IF WIRED (unsupported today). The native solid.hole measures the recess from the pocket FLOOR instead of the top face: the recess that should lie in air above the floor (or only reach 3 mm below it) cuts extra material, in every one of the three cases. brep-rs matches the closed form to 1e-6 here, so it is a real oracle. A mapping needs a guard: refuse a recess when the bore axis passes through a pocket or any step (the top face under the bore is not the highest face of the part).');
probeRow('counterbore deeper than the part (counterbore 12 x 21 and 12 x 30 in a 20 thick box; 12 x 20 as the control)', 'unsupported',
  ['cb-deeper-than-part-20', 'cb-deeper-than-part-21', 'cb-deeper-than-part-30'],
  (x) => (x.native.removed !== undefined && relTo(x.native.removed, x.closedRemoved) < 3e-4 ? null : 'native did not simply build the plain 12 bore'),
  'The native solid.hole builds a plain 12 mm bore through the box silently (the recess swallows the part: removed 2261.57 vs 2261.95 for a 12 mm through cylinder). brep-rs builds the equal-depth control (12 x 20) but REFUSES 21 and 30 ("its counterbore or countersink is not a shape brep-rs can cut yet"). Whether a recess deeper than the part is an error is a policy question; with no fallback engine the contract is to refuse. A mapping needs a guard: refuse counterbore.deep > the part thickness along the drill axis.');
probeRow('overlapping recesses of neighbouring holes() bores (4 bores d4 apart [10,14]: counterbore d12 x 3 and countersink d14/90)', 'unsupported',
  ['holes-cb-overlap', 'holes-cs-overlap'],
  (x) => (x.native.removed !== undefined && relTo(x.native.removed, x.closedRemoved) < 1e-4 && /overlap/.test(x.brep.refused ?? '') ? null : 'native did not match the closed form'),
  'Native path is RIGHT here (counterbore 7.3e-5 and countersink 3.5e-5 off an independent closed form / numeric integral of the union of the overlapping cones) where brep-rs refuses ("its bores overlap in a way brep-rs cannot fuse into one tool yet"). It is still unsupported because the translator maps none of it; recorded so a mapping is not blocked on a refusal brep-rs needs and SolidCraft does not.');
writeFileSync(OUTFILE, JSON.stringify({ group: 'holes', rows }, null, 1) + '\n');
console.log(`wrote ${OUTFILE}: ${rows.length} rows (${['supported', 'refused', 'wrong', 'unsupported'].map((k) => `${k} ${rows.filter((x) => x.status === k).length}`).join(', ')})`);
