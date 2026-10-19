// Cases for the "holes" contract group, ROUND 4: every case of holes3-cases.mjs (unchanged) plus the round-4 additions the critic asked for.
//   { id, row, script, rem?, vol?, fc?, note?, unguarded? }   rem = closed-form volume REMOVED by the last feature (independent of every kernel).
import { CASES as OLD } from './holes3-cases.mjs';

const PI = Math.PI;
const cyl = (d, L) => PI * (d / 2) ** 2 * L;
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10);";
const BOX = 'const b = cuboid(40, 40, 20); ';
// The unguarded (phase-0 translator) controls of rounds 1 to 3 do not depend on the guards, so they are NOT re-run here: their numbers are in
// holes3-results/final.json and holes4-rows.mjs reads them from there (`r3Unguarded`). Only the cases below are run unguarded in round 4.
export const CASES = OLD.map((c) => ({ ...c, unguarded: false, unguardedInR3: !!c.unguarded }));
const add = (row, id, script, extra = {}) => CASES.push({ row, id, script, ...extra });
const SPUN_TUBE = "const s = sketch('top'); s.polygon([[10,0],[20,0],[20,30],[10,30]]); const r = spin(s, 360);";
const SPUN_CUP = "const s = sketch('top'); s.polygon([[0,0],[20,0],[20,30],[18,30],[18,2],[0,2]]); const r = spin(s, 360);";

// ===== R4-A: countersink cones that touch other tools (hang class) =====================================================================
add('r4-cs', 'cs-overlap-holes-10x14', `${PLATE} holes(plate, { across: 4, apart: [10, 14], countersink: { across: 12, angle: 90 } });`, { unguarded: true, note: 'four countersinks, mouth 12, neighbours 10 apart in x: the mouths overlap (the critic\'s y-h-cs-overlap-10x14)' });
add('r4-cs', 'cs-holes-apart-14x16', `${PLATE} holes(plate, { across: 4, apart: [14, 16], countersink: { across: 12, angle: 90 } });`, { note: 'control: four countersinks, mouth 12, neighbours 14 and 16 apart: nothing touches' });
add('r4-cs', 'cs-holes-mouth-touch', `${PLATE} holes(plate, { across: 4, apart: [12, 16], countersink: { across: 12, angle: 90 } });`, { note: 'mouths exactly tangent (12 apart, mouth 12)' });
add('r4-cs', 'cs-seq-overlap', `${BOX} const h1 = hole(b, { across: 4, at: [-5, 0], countersink: { across: 12, angle: 90 } }); hole(h1, { across: 4, at: [5, 0], countersink: { across: 12, angle: 90 } });`, { unguarded: true, note: 'two sequential hole() calls, mouths overlap (10 apart, 12 mouth)' });
add('r4-cs', 'cs-seq-apart', `${BOX} const h1 = hole(b, { across: 4, at: [-10, 0], countersink: { across: 12, angle: 90 } }); hole(h1, { across: 4, at: [10, 0], countersink: { across: 12, angle: 90 } });`, { note: 'control: two sequential countersinks 20 apart' });
add('r4-cs', 'cs-over-earlier-bore', `${BOX} const h1 = hole(b, { across: 4, at: [-5, 0] }); hole(h1, { across: 4, at: [2, 0], countersink: { across: 12, angle: 90 } });`, { unguarded: true, note: 'countersink mouth reaches over an earlier plain bore' });
add('r4-cs', 'cs-over-earlier-cb', `${BOX} const h1 = hole(b, { across: 4, at: [-5, 0], counterbore: { across: 12, deep: 4 } }); hole(h1, { across: 4, at: [3, 0], countersink: { across: 12, angle: 90 } });`, { unguarded: true, note: 'countersink over an earlier counterbore' });
add('r4-cs', 'cb-over-earlier-cs', `${BOX} const h1 = hole(b, { across: 4, at: [-5, 0], countersink: { across: 12, angle: 90 } }); hole(h1, { across: 4, at: [3, 0], counterbore: { across: 12, deep: 4 } });`, { unguarded: true, note: 'counterbore over an earlier countersink' });
add('r4-cs', 'bore-over-earlier-cs', `${BOX} const h1 = hole(b, { across: 4, at: [-5, 0], countersink: { across: 12, angle: 90 } }); hole(h1, { across: 4, at: [1, 0] });`, { unguarded: true, note: 'plain bore whose wall is inside an earlier countersink mouth' });
// ===== R4-B: overlapping counterbores (the closed form must account for the earlier recess) ============================================
add('r4-cb', 'cb-seq-overlap', `${BOX} const h1 = hole(b, { across: 4, at: [-5, 0], counterbore: { across: 12, deep: 4 } }); hole(h1, { across: 4, at: [5, 0], counterbore: { across: 12, deep: 4 } });`, { unguarded: true, note: 'two sequential counterbores, bore 4, centres 10 apart, recess 12: the lens is removed once (the critic\'s case: brep-rs and a hand lens integral agree)' });
add('r4-cb', 'cb-seq-overlap-deeper', `${BOX} const h1 = hole(b, { across: 4, at: [-5, 0], counterbore: { across: 12, deep: 3 } }); hole(h1, { across: 4, at: [5, 0], counterbore: { across: 12, deep: 6 } });`, { note: 'second recess deeper than the first: the first removed only the top 3 of the lens' });
add('r4-cb', 'cb-seq-overlap-blind', `${BOX} const h1 = hole(b, { across: 4, deep: 10, at: [-5, 0], counterbore: { across: 12, deep: 4 } }); hole(h1, { across: 4, deep: 10, at: [5, 0], counterbore: { across: 12, deep: 4 } });`, { note: 'same, blind 10' });
add('r4-cb', 'cb-seq-apart', `${BOX} const h1 = hole(b, { across: 4, at: [-10, 0], counterbore: { across: 12, deep: 4 } }); hole(h1, { across: 4, at: [10, 0], counterbore: { across: 12, deep: 4 } });`, { rem: 0, note: 'control: sequential counterbores that do not touch' });
add('r4-cb', 'cb-seq-bore-inside-recess', `${BOX} const h1 = hole(b, { across: 12, deep: 6, at: [0, 0] }); hole(h1, { across: 4, at: [0, 0], counterbore: { across: 8, deep: 3 } });`, { note: 'second hole entirely inside the first one\'s bore: the recess removes nothing new down to 3, the bore continues below' });
// ===== R4-C: revolve (spin) hosts along every axis =====================================================================================
add('r4-spin', 'spin-tube-along-x', `${SPUN_TUBE} hole(r, { across: 4, along: 'x', deep: 40 });`, { unguarded: true, note: 'hole along x in a spun tube with deep 40 (deep omitted is a script error): the interpreter supplies a depth (34), truck never finished (the critic\'s s-revolve-target)' });
add('r4-spin', 'spin-cup-along-x', `${SPUN_CUP} hole(r, { across: 4, along: 'x', at: [0, 15], deep: 40 });`, { unguarded: true, note: 'hole along x in a spun cup with deep 40 (>= its 40 width) (the critic\'s case)' });
add('r4-spin', 'spin-cup-along-y-blind', `${SPUN_CUP} hole(r, { across: 4, along: 'y', deep: 10, at: [0, 15] });`, { unguarded: true });
add('r4-spin', 'spin-tube-along-z-blind', `${SPUN_TUBE} hole(r, { across: 2, at: [15, 0], deep: 10 });`, { unguarded: true });
add('r4-spin', 'spin-tube-along-z-through', `${SPUN_TUBE} hole(r, { across: 2, at: [15, 0] });`, { note: 'script error (thickness unknown)' });
// ===== R4-D: curved hosts, bore not along the axis ======================================================================================
add('r4-curved', 'cross-bore-dowel-y', 'const c = cylinder(10, 40); hole(c, { across: 3, along: "y" });', { unguarded: true, note: 'cross-hole in a 10 mm dowel, along y' });
add('r4-curved', 'cross-bore-dowel-x-offset', 'const c = cylinder(10, 40); hole(c, { across: 3, along: "x", at: [0, 8] });', { unguarded: true });
add('r4-curved', 'cross-bore-round-pad', "const sk = sketch('top'); sk.circle(30); const e = extrude(sk, 16); hole(e, { across: 4, along: 'x' });", { unguarded: true, note: 'cross bore through a circular pad' });
add('r4-curved', 'cb-along-x-on-cylinder', 'const c = cylinder(30, 20); hole(c, { across: 4, along: "x", counterbore: { across: 8, deep: 3 } });', { unguarded: true, note: 'a counterbore along x on a cylinder (the critic: refused by G-TOP after 87 s)' });
add('r4-curved', 'cyl-turned-axial-bore', 'const c = cylinder(30, 20); turn(c, [90, 0, 0]); hole(c, { across: 6, along: "y" });', { note: 'control: the cylinder lying along y, bore along ITS axis' });
add('r4-curved', 'cone-axial-bore-blind', 'const t = cone(20, 30); hole(t, { across: 2, deep: 3 });', { note: 'blind bore into the flat base of a cone, along its axis' });
add('r4-curved', 'hex-prism-along-x', 'const t = prism(6, 40, 12); hole(t, { across: 4, along: "x" });', { note: 'bore along x through a hexagonal prism (slanted side faces): 40 s CPU in the critic\'s run' });
add('r4-curved', 'hex-prism-along-y', 'const t = prism(6, 40, 12); hole(t, { across: 4, along: "y" });', { note: 'same along y (meets two faces square-on)' });
add('r4-curved', 'octagon-prism-along-x', 'const t = prism(8, 40, 12); hole(t, { across: 4, along: "x" });');
// ===== R4-E: tiny / huge / far ===========================================================================================================
for (const [id, d] of [['0p01', 0.01], ['0p003', 0.003], ['0p001', 0.001], ['0p0005', 0.0005], ['0p0003', 0.0003], ['0p0002', 0.0002], ['0p0001', 0.0001]]) {
  add('r4-size', `tiny-across-${id}`, `${PLATE} hole(plate, { across: ${d} });`, { rem: cyl(d, 10), unguarded: d < 0.001 });
}
add('r4-size', 'tiny-0p001-blind', `${PLATE} hole(plate, { across: 0.001, deep: 3 });`, { rem: cyl(0.001, 3), note: 'the critic\'s y-tiny-0p001-blind: round 3 refused it as "not flat and level"' });
add('r4-size', 'tiny-0p01-blind', `${PLATE} hole(plate, { across: 0.01, deep: 3 });`, { rem: cyl(0.01, 3) });
add('r4-size', 'cb-tiny-0p04', `${PLATE} hole(plate, { across: 0.02, counterbore: { across: 0.04, deep: 1 } });`, { note: 'the critic\'s cb-tiny: a 0.04 wide counterbore on a 0.02 bore' });
add('r4-size', 'cs-tiny-0p04', `${PLATE} hole(plate, { across: 0.02, countersink: { across: 0.04, angle: 90 } });`);
add('r4-size', 'big-plate-600', "const s1 = sketch('top'); s1.polygon([[0,0],[4000,0],[4000,3000],[0,3000]]); const plate = extrude(s1, 1000); hole(plate, { across: 600 });", { rem: cyl(600, 1000), note: '4000 x 3000 x 1000 plate, 600 across' });
add('r4-size', 'big-plate-600-blind', "const s1 = sketch('top'); s1.polygon([[0,0],[4000,0],[4000,3000],[0,3000]]); const plate = extrude(s1, 1000); hole(plate, { across: 600, deep: 400 });", { rem: cyl(600, 400) });
add('r4-size', 'far-100000', 'const b = cuboid(40, 30, 10, { at: [100000, 50, 20] }); hole(b, { across: 6 });', { rem: cyl(6, 10), note: 'part 100000 mm from the origin' });
add('r4-size', 'far-100000-blind', 'const b = cuboid(40, 30, 10, { at: [100000, 50, 20] }); hole(b, { across: 6, deep: 4 });', { rem: cyl(6, 4) });
add('r4-size', 'far-100000-cb', 'const b = cuboid(40, 30, 10, { at: [100000, 50, 20] }); hole(b, { across: 6, counterbore: { across: 12, deep: 3 } });');
// ===== R4-F: cs flatness band, wider second bore, tangency to earlier bores ==============================================================
for (const a of [150, 160, 165, 170, 171, 172, 173, 174, 175, 178]) add('r4-cs-flat', `cs-angle-${a}`, `${PLATE} hole(plate, { across: 6, countersink: { across: 12, angle: ${a} } });`);
add('r4-tangent', 'tangent-earlier-bore-ext', `${BOX} const h1 = hole(b, { across: 6, at: [-3, 0] }); hole(h1, { across: 6, at: [3, 0] });`, { rem: 2 * cyl(6, 20), note: 'second bore externally tangent to the first (6 apart, 3 + 3 radius): the critic\'s tangent-to-earlier-bore' });
add('r4-tangent', 'tangent-earlier-bore-int', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 4, at: [3, 0] });`, { note: 'second bore internally tangent to the first (centre 3 off, radii 5 and 2)' });
add('r4-tangent', 'blind-in-cone', 'const t = cone(20, 30); hole(t, { across: 2, deep: 3, at: [3, 2] });', { note: 'blind bore into a cone off its axis' });
// ===== R4-G: argument errors that were never run =========================================================================================
add('r4-arg', 'cb-not-object', `${PLATE} hole(plate, { across: 6, counterbore: 12 });`);
add('r4-arg', 'cs-not-object', `${PLATE} hole(plate, { across: 6, countersink: 90 });`);
add('r4-arg', 'cb-negative-across', `${PLATE} hole(plate, { across: 6, counterbore: { across: -12, deep: 3 } });`);
// ===== R4-H: repeat / polar targets that are already several pieces ======================================================================
add('r4-bodies', 'pat-polar-disjoint-hole', "const b = cuboid(10, 10, 10, { at: [25, 0, 0] }); const p = polarPattern(b, { count: 4, axis: 'z' }); hole(p, { across: 2, deep: 4 });", { unguarded: true, note: 'four copies that do not touch (the critic\'s s-polar-target)' });
add('r4-bodies', 'pat-repeat-disjoint-hole', "const b = cuboid(20, 20, 10); const p = repeat(b, { count: 3, step: [30, 0, 0] }); hole(p, { across: 4, deep: 4, at: [-30, 0] });", { unguarded: true, note: 'three copies that do not touch (the critic\'s s-repeat-target)' });
// ===== R4-I: a second bore wider than (or as wide as) an earlier bore it breaks into: when does truck's face count disagree with OCCT? ====================
add('r4-wall', 'wall-r7-at5', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 14, at: [5, 0] });`, { note: 'second bore 14 across, centre on the wall of the blind r5 bore' });
add('r4-wall', 'wall-r6-at4', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 12, at: [4, 0] });`);
add('r4-wall', 'wall-r5-at5', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 10, at: [5, 0] });`, { note: 'equal radius, second centre on the wall' });
add('r4-wall', 'wall-r9-at5-blind', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 18, at: [5, 0], deep: 15 });`, { note: 'wide second bore, blind 15' });
add('r4-wall', 'wall-r9-both-through', `${BOX} const h1 = hole(b, { across: 10 }); hole(h1, { across: 18, at: [5, 0] });`, { note: 'both through' });
add('r4-wall', 'wall-r7-at12p8-clear', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 14, at: [12.8, 0] });`, { note: 'control: wide second bore beside the first, circles apart (12.8 > 5 + 7)' });
add('r4-wall', 'wall-r7-at11p5-overlap', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 14, at: [11.5, 0] });`, { note: 'wide second bore whose circle overlaps the first by 0.5 mm' });
// ===== R4-J: SMALL / THIN RECESSES. Round 3's G-TOP refused a 0.04 wide counterbore as "not flat"; the truth is that native solid.hole gets tiny recesses WRONG (a counterbore across 0.04 on a 0.02 bore made the
// part GROW by 0.82 mm3). These run with G-RECESS-VOL off (H4_OFF=G-RECESS-VOL) to see where native stops being right; holes4-recess-sweep.json keeps the table.
const rs = (id, script) => add('r4-rsweep', id, script);
for (const [b, R, dp] of [[0.02, 0.04, 1], [0.02, 0.1, 1], [0.02, 0.3, 1], [0.02, 1, 1], [0.2, 0.4, 1], [0.5, 1, 1], [1, 2, 1], [6, 12, 0.001], [6, 12, 0.01], [6, 12, 0.05], [6, 12, 0.2], [6, 6.001, 3], [6, 6.01, 3], [6, 6.1, 3], [6, 6.5, 3]]) {
  rs(`rs-cb-${b}-${R}-${dp}`, `${PLATE} hole(plate, { across: ${b}, counterbore: { across: ${R}, deep: ${dp} } });`);
}
for (const [b, D, a] of [[0.02, 0.04, 90], [0.02, 0.1, 90], [0.02, 0.3, 90], [0.2, 0.4, 90], [1, 2, 90], [6, 6.001, 90], [6, 6.01, 90], [6, 6.1, 90], [6, 6.5, 90]]) {
  rs(`rs-cs-${b}-${D}-${a}`, `${PLATE} hole(plate, { across: ${b}, countersink: { across: ${D}, angle: ${a} } });`);
}
for (const [b, R, dp] of [[0.02, 0.2, 1], [0.02, 0.15, 1], [0.05, 0.3, 1], [0.1, 0.3, 1], [6, 6.005, 3], [6, 6.02, 3], [6, 12, 0.005], [6, 12, 0.02]]) {
  rs(`rs-cb-${b}-${R}-${dp}`, `${PLATE} hole(plate, { across: ${b}, counterbore: { across: ${R}, deep: ${dp} } });`);
}
for (const [b, D, a] of [[0.5, 1, 90], [0.3, 0.6, 90], [1, 1.05, 90], [1, 1.1, 90], [6, 6.05, 90], [6, 6.2, 60], [6, 6.1, 120], [6, 6.08, 120], [0.7, 1.4, 90]]) {
  rs(`rs-cs-${b}-${D}-${a}`, `${PLATE} hole(plate, { across: ${b}, countersink: { across: ${D}, angle: ${a} } });`);
}
add('r4-nest', 'cb-nest-cyl', 'const c = cylinder(60, 20); const h1 = hole(c, { across: 12, deep: 6 }); hole(h1, { across: 4, counterbore: { across: 8, deep: 3 } });', { unguarded: true, note: 'counterbore inside an earlier wider blind bore, cylinder host' });
add('r4-nest', 'cs-nest-box', `${BOX} const h1 = hole(b, { across: 12, deep: 6 }); hole(h1, { across: 4, countersink: { across: 8, angle: 90 } });`, { unguarded: true, note: 'countersink inside an earlier wider blind bore, box host' });
const NEED_UNGUARDED = new Set(['blind-in-sphere', 'blind-in-cone', 'tangent-earlier-bore-ext', 'tangent-earlier-bore-int', 'wide-cyl30', 'wide-cyl40', 'cs-ring-breaks-out-side', 'cs-wide-mouth-wider-than-plate', 'rot-cylinder-x90-hole-z', 'rot-cone-turned-through', 'cross-bore-through-cylinder', 'round-box-hole-37']);
for (const c of CASES) if (NEED_UNGUARDED.has(c.id)) c.unguarded = true;
