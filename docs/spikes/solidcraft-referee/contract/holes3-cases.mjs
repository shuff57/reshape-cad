// Cases for the "holes" contract group, round 3: every round-1/2 case (holes-cases.mjs, unchanged) plus the round-3 additions.
//   { id, row, script, rem?, vol?, fc?, note?, unguarded? }   rem = closed-form volume REMOVED by the last feature (independent of every kernel).
//   unguarded: true also runs the case through the UNGUARDED phase-0 translator, so the evidence shows what the guard prevents.
import { CASES as OLD } from './holes-cases.mjs';

const PI = Math.PI;
const cyl = (d, L) => PI * (d / 2) ** 2 * L;
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10);";
const BOX = 'const b = cuboid(40, 40, 20); ';
const lens = (r, d) => 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
const unionArea = (r, d) => 2 * PI * r * r - lens(r, d);
export const cbRem = (d, R, cbd, bl) => cyl(d, bl) + cyl(R, cbd) - cyl(d, cbd);
export function csRem(d, D, a, bl) {
  const R = D / 2; const r = d / 2; const tn = Math.tan((a * PI) / 360); const dc = (R - r) / tn;
  if (dc <= bl) return PI * r * r * bl + (PI * dc / 3) * (R * R + R * r + r * r) - PI * r * r * dc;
  const rb = R - bl * tn;
  return (PI * bl / 3) * (R * R + R * rb + rb * rb);
}
/** numeric removal of a recess hole: the tool at (x,y) is the interval [top - depth(x,y), top] (depth = bl inside the bore, the recess depth in the ring);
 *  the material at (x,y) is the interval mat(x,y) = [zlo, zhi] or null. n x n midpoint grid over the recess disc. */
export function numTool(cx, cy, R, depthAt, mat, n = 1400, topOverride) {
  let s = 0; const h = (2 * R) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = cx - R + (i + 0.5) * h; const y = cy - R + (j + 0.5) * h;
    const m = mat(x, y); if (!m) continue;
    const rho = Math.hypot(x - cx, y - cy); if (rho > R) continue;
    const d = depthAt(rho); if (!(d > 0)) continue;
    const top = topOverride ?? m[1];
    const lo = Math.max(top - d, m[0]); const hi = Math.min(top, m[1]);
    if (hi > lo) s += (hi - lo) * h * h;
  }
  return s;
}

const CASES = [];
const add = (row, id, script, extra = {}) => CASES.push({ row, id, script, ...extra });
const UNGUARDED = new Set(['wider-than-plate-35', 'wider-than-plate-31', 'wider-than-plate-30p5', 'wider-than-plate-30-exact', 'wide-box40-tangent', 'wide-box41', 'at-off-the-part', 'pad-L-hole-in-notch', 'holes-all-outside', 'holes-two-outside',
  'holes-along-x', 'holes-along-y', 'holes-along-x-blind', 'blind-unknown-intersect-4', 'blind-wedge-turned', 'rot-box-y45-blind', 'pat-disjoint-hole', 'pat-disjoint-hole-first-copy', 'through-ring-misses-4', 'through-ring-misses', 'through-ring-offset-hits', 'bore-tangent-to-edge', 'union-hole-blind']);
for (const c of OLD) CASES.push(UNGUARDED.has(c.id) ? { ...c, unguarded: true } : c);

// ===== RECESS: blind countersink around the cone-tool depth (the measured silent-wrong band) ===================================================
const CS = [[6, 12, 90, [1, 2, 2.5, 3, 3.1, 3.2, 3.3, 3.34, 3.36, 3.5, 4, 6, 10]], [6, 12, 120, [1.5, 1.8, 1.9, 1.95, 1.96, 2, 3]], [10, 20, 90, [5, 5.4, 5.5, 5.56, 6, 9]], [3, 6, 60, [2.7, 2.9, 2.95, 3.5]]];
for (const [d, D, a, bs] of CS) for (const b of bs) {
  add('cs-band', `cs-blind-d${d}-D${D}-a${a}-b${b}`, `${BOX} hole(b, { across: ${d}, deep: ${b}, countersink: { across: ${D}, angle: ${a} } });`, { rem: csRem(d, D, a, b), unguarded: false, note: `blind ${b} under a ${D}/${a} countersink on a ${d} bore (cone alone ${(((D - d) / 2) / Math.tan(a * PI / 360)).toFixed(3)} deep, cone TOOL ${(((D / 2 - 0.9 * d / 2)) / Math.tan(a * PI / 360)).toFixed(3)} deep)` });
}
// thin plates: the cone leaves through the bottom (a through hole): exact closed form clipped at the plate
for (const h of [2, 3, 3.2, 3.3, 3.4, 5]) add('cs-thin', `cs-thin-plate-T${h}`, `const b = cuboid(40, 40, ${h}); hole(b, { across: 6, countersink: { across: 12, angle: 90 } });`, { rem: csRem(6, 12, 90, h), note: `through hole in a ${h} thick plate, cone 3 deep (tool 3.3)` });
// ===== RECESS: counterbore =================================================================================================================
add('cb', 'cb-blind-10-of-20', `${BOX} hole(b, { across: 6, deep: 10, counterbore: { across: 12, deep: 4 } });`, { rem: cbRem(6, 12, 4, 10) });
add('cb', 'cb-deep-equals-thickness', `${BOX} hole(b, { across: 6, counterbore: { across: 12, deep: 20 } });`, { rem: cbRem(6, 12, 20, 20), note: 'control: recess exactly as deep as the part (brep-rs builds it)' });
add('cb', 'cb-deep-beyond-thickness-21', `${BOX} hole(b, { across: 6, counterbore: { across: 12, deep: 21 } });`, { rem: cyl(12, 20), unguarded: true, note: 'native cuts a plain 12 bore; brep-rs refuses' });
add('cb', 'cb-deep-beyond-thickness-30', `${BOX} hole(b, { across: 6, counterbore: { across: 12, deep: 30 } });`, { rem: cyl(12, 20), unguarded: true });
add('cb', 'cb-blind-deep-equals-hole', `${BOX} hole(b, { across: 6, deep: 6, counterbore: { across: 12, deep: 6 } });`, { note: 'recess as deep as the blind hole: no bore left' });
add('cb', 'cb-blind-deep-beyond-hole', `${BOX} hole(b, { across: 6, deep: 6, counterbore: { across: 12, deep: 9 } });`, { note: 'recess deeper than the blind hole' });
add('cb', 'cb-along-y-blind', `${BOX} hole(b, { across: 5, along: 'y', deep: 14, counterbore: { across: 10, deep: 4 }, at: [3, -2] });`, { rem: cbRem(5, 10, 4, 14) });
add('cb', 'cb-in-cylinder-blind', `const c = cylinder(60, 20); hole(c, { across: 6, deep: 12, counterbore: { across: 14, deep: 4 } });`, { rem: cbRem(6, 14, 4, 12) });
add('cb', 'cb-hex-prism-through', `const t = prism(6, 60, 20); hole(t, { across: 6, counterbore: { across: 14, deep: 5 } });`, { rem: cbRem(6, 14, 5, 20) });
add('cb', 'cb-ring-breaks-out-side', `${PLATE} hole(plate, { across: 6, at: [-16, 0], counterbore: { across: 12, deep: 3 } });`, {
  rem: numTool(4, 15, 6, (rho) => (rho <= 3 ? 10 : 3), (x, y) => (x >= 0 && x <= 40 && y >= 0 && y <= 30 ? [0, 10] : null)),
  note: 'bore centre 4 from the x=0 edge (1 mm wall), recess radius 6: the recess ring breaks out of the side' });
add('cb', 'cb-ring-tangent-side', `${PLATE} hole(plate, { across: 6, at: [-14, 0], counterbore: { across: 12, deep: 3 } });`, { rem: cbRem(6, 12, 3, 10), note: 'recess rim tangent to the x=0 edge' });
add('cb', 'cb-ring-near-tangent-side', `${PLATE} hole(plate, { across: 6, at: [-13.8, 0], counterbore: { across: 12, deep: 3 } });`, { rem: cbRem(6, 12, 3, 10), note: 'control: recess rim 0.2 mm from the x=0 edge' });
add('cb', 'cb-wide-as-plate', `${PLATE} hole(plate, { across: 6, counterbore: { across: 30, deep: 3 } });`, { rem: cyl(30, 3) + cyl(6, 7), note: 'recess as wide as the 30 deep plate: tangent to both long edges' });
add('cb', 'cb-wider-than-plate', `${PLATE} hole(plate, { across: 6, counterbore: { across: 36, deep: 3 } });`, { rem: numTool(20, 15, 18, (rho) => (rho <= 3 ? 10 : 3), (x, y) => (x >= 0 && x <= 40 && y >= 0 && y <= 30 ? [0, 10] : null)), note: 'recess 36 wide on a 30 deep plate: the disc leaves the plate on both long sides, the top 3 mm is cut clean across' });
add('cb', 'cb-revolve-wall', "const s = sketch('top'); s.polygon([[10,0],[20,0],[20,30],[10,30]]); const r = spin(s, 360); hole(r, { across: 2, at: [15, 0], deep: 10, counterbore: { across: 6, deep: 3 } });", { note: 'flat annular top of a tube (a spin result): there is no flat-topped-family proof for a revolve' });
add('cb', 'cb-pocket-floor-9x7', `${PLATE} const s2 = sketch('top', 10); s2.rect(16, 12, { at: [22, 15] }); const p = pocket(s2, plate, 4); hole(p, { across: 4, at: [2, 0], counterbore: { across: 9, deep: 7 } });`, { rem: cyl(4, 6) + (cyl(9, 3) - cyl(4, 3)), unguarded: true, note: 'bore column over a 4 deep pocket: the recess is measured from the TOP face (z=10) so it reaches 3 below the floor' });
add('cb', 'cb-pocket-floor-9x3', `${PLATE} const s2 = sketch('top', 10); s2.rect(16, 12, { at: [22, 15] }); const p = pocket(s2, plate, 4); hole(p, { across: 4, at: [2, 0], counterbore: { across: 9, deep: 3 } });`, { rem: cyl(4, 6), unguarded: true, note: 'recess entirely in the air above the pocket floor' });
add('cb', 'cb-straddles-pocket-wall', `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 6, { at: [22, 15] }); const p = pocket(s2, plate, 4); hole(p, { across: 4, at: [10, 0], counterbore: { across: 9, deep: 3 } });`, {
  rem: numTool(30, 15, 4.5, (rho) => (rho <= 2 ? 10 : 3), (x, y) => (x >= 0 && x <= 40 && y >= 0 && y <= 30 ? (x >= 17 && x <= 27 && y >= 12 && y <= 18 ? [0, 6] : [0, 10]) : null), 1400, 10),
  unguarded: true, note: 'axis at x=30 on the full-height top, 3 mm from the pocket wall at x=27 (the bore, radius 2, clears it by 1 mm); the recess ring (radius 4.5) reaches 1.5 mm over the pocket' });
add('cb', 'cb-step-join-low', 'const a = cuboid(40, 30, 10); const t = cuboid(20, 30, 20, { at: [30, 0, 5] }); const r = join(a, t); hole(r, { across: 4, at: [-20, 0], counterbore: { across: 8, deep: 3 } });', { unguarded: true, note: 'bore on the LOW step of a stepped join (bbox top is the high step)' });
add('cb', 'cb-step-join-high', 'const a = cuboid(40, 30, 10); const t = cuboid(20, 30, 20, { at: [30, 0, 5] }); const r = join(a, t); hole(r, { across: 4, at: [20, 0], counterbore: { across: 8, deep: 3 } });', { rem: cbRem(4, 8, 3, 20), note: 'bore on the HIGH step: the bbox top is its top' });
add('cb', 'cb-tilted-slab', 'const b = cuboid(40, 30, 10); turn(b, [0, 45, 0]); hole(b, { across: 6, counterbore: { across: 12, deep: 3 } });', { unguarded: true, note: 'slab tilted 45 degrees about y: no flat level top under the bore' });
add('cb', 'cb-open-hollow', "const b = cuboid(40, 30, 20); hollow(b, { wall: 2, open: 'top' }); hole(b, { across: 6, counterbore: { across: 12, deep: 3 } });", { unguarded: true, note: 'recess over the open cavity of a hollow: the top of the part is in air under the bore' });
add('cb', 'cb-twice', `${BOX} const h1 = hole(b, { across: 6, counterbore: { across: 12, deep: 3 } }); hole(h1, { across: 6, counterbore: { across: 12, deep: 3 } });`, { unguarded: true, note: 'the same counterbored hole twice' });
// ===== RECESS: countersink hosts =============================================================================================================
add('cs', 'cs-in-cylinder-blind', `const c = cylinder(60, 20); hole(c, { across: 6, deep: 8, countersink: { across: 12, angle: 90 } });`, { rem: csRem(6, 12, 90, 8) });
add('cs', 'cs-pocket-floor-8x90', `${PLATE} const s2 = sketch('top', 10); s2.rect(16, 12, { at: [22, 15] }); const p = pocket(s2, plate, 4); hole(p, { across: 4, at: [2, 0], countersink: { across: 8, angle: 90 } });`, { rem: cyl(4, 6), unguarded: true, note: 'cone entirely in the 4 mm of air above the pocket floor' });
add('cs', 'cs-wide-mouth-wider-than-plate', `${PLATE} hole(plate, { across: 6, countersink: { across: 36, angle: 90 } });`, { rem: numTool(20, 15, 18, (rho) => (rho <= 3 ? 10 : 18 - rho), (x, y) => (x >= 0 && x <= 40 && y >= 0 && y <= 30 ? [0, 10] : null)), note: 'mouth 36 on a 30 deep plate: the cone breaks out of both long edges' });
add('cs', 'cs-ring-breaks-out-side', `${PLATE} hole(plate, { across: 6, at: [-16, 0], countersink: { across: 12, angle: 90 } });`, {
  rem: numTool(4, 15, 6, (rho) => (rho <= 3 ? 10 : 6 - rho), (x, y) => (x >= 0 && x <= 40 && y >= 0 && y <= 30 ? [0, 10] : null)), note: 'cone mouth radius 6 centred 4 from the x=0 edge' });
add('cs', 'cs-step-join-low', 'const a = cuboid(40, 30, 10); const t = cuboid(20, 30, 20, { at: [30, 0, 5] }); const r = join(a, t); hole(r, { across: 4, at: [-20, 0], countersink: { across: 8, angle: 90 } });', { unguarded: true });
add('cs', 'cs-size-M5-along-y-mouth8', `${PLATE} hole(plate, { size: 'M5', along: 'y', countersink: { across: 8, angle: 90 } });`, { rem: csRem(5.5, 8, 90, 30), note: 'mouth 8 on a 10 high plate (the round-2 case had a 10 mouth: tangent to the top and bottom faces)' });
// holes() + recess
add('holes-recess', 'holes-cb-touching', `${PLATE} holes(plate, { across: 4, apart: [12, 14], counterbore: { across: 12, deep: 3 } });`, { rem: 4 * cbRem(4, 12, 3, 10), note: 'recess circles of neighbouring bores tangent (12 apart, 12 across)' });
add('holes-recess', 'holes-cb-near-tangent', `${PLATE} holes(plate, { across: 4, apart: [12.2, 14], counterbore: { across: 12, deep: 3 } });`, { rem: 4 * cbRem(4, 12, 3, 10), note: 'control: recess circles of neighbouring bores 0.2 mm apart' });
add('holes-recess', 'holes-cb-overlap', `${PLATE} holes(plate, { across: 4, apart: [10, 14], counterbore: { across: 12, deep: 3 } });`, { rem: 2 * unionArea(6, 10) * 3 + 4 * cyl(4, 7), note: 'neighbouring recesses overlap (lens)' });
add('holes-recess', 'holes-cb-blind', `${BOX} holes(b, { across: 4, apart: [20, 20], deep: 10, counterbore: { across: 8, deep: 3 } });`, { rem: 4 * cbRem(4, 8, 3, 10) });
add('holes-recess', 'holes-cs-blind', `${BOX} holes(b, { across: 4, apart: [20, 20], deep: 10, countersink: { across: 8, angle: 90 } });`, { rem: 4 * csRem(4, 8, 90, 10) });
add('holes-recess', 'holes-cs-blind-band', `${BOX} holes(b, { across: 4, apart: [20, 20], deep: 2.1, countersink: { across: 8, angle: 90 } });`, { note: 'cone (2 deep, tool 2.2) deeper than the 2.1 deep holes' });
add('holes-recess', 'holes-cb-along-x', `${PLATE} holes(plate, { across: 2, along: 'x', apart: [10, 6], counterbore: { across: 4, deep: 3 } });`, { unguarded: true });

// ===== PLAIN BORES: guards added in round 3 ==============================================================================================
// crossing bores in a prismatic host
add('cross', 'cross-z-through-then-x-through', `${BOX} const h1 = hole(b, { across: 6 }); hole(h1, { across: 6, along: 'x' });`, { rem: cyl(6, 20) + cyl(6, 40) - (16 / 3) * 3 ** 3 * 1, note: 'two through bores crossing at right angles at the centre of a 40 x 40 x 20 box (intersection of two equal cylinders: 16 r^3 / 3, valid while the second bore is wholly inside the first one\'s length)', unguarded: true });
add('cross', 'cross-z-blind-then-x-through', `${BOX} const h1 = hole(b, { across: 6, deep: 8 }); hole(h1, { across: 6, along: 'x' });`, { note: 'blind z bore (8 deep from the top) crossed by an x through bore at the middle height', unguarded: true });
add('cross', 'cross-both-blind', `${BOX} const h1 = hole(b, { across: 6, deep: 12 }); hole(h1, { across: 4, along: 'x', deep: 20, at: [0, 0] });`, { note: 'two blind bores that cross', unguarded: true });
add('cross', 'cross-apart-no-touch', `${BOX} const h1 = hole(b, { across: 6, at: [0, 12] }); hole(h1, { across: 4, along: 'x', at: [-12, 0] });`, { rem: cyl(4, 40), note: 'control (rem is the second bore only): perpendicular bores that do not meet (z bore at y=12, x bore at y=-12)' });
// holes() tangent
add('holes-tangent', 'holes-tangent-to-wall', `${PLATE} holes(plate, { across: 6, apart: [34, 10] });`, { rem: 4 * cyl(6, 10), unguarded: true, note: 'columns at +-17 from centre, radius 3: tangent to the x=0 and x=40 faces' });
add('holes-tangent', 'holes-tangent-to-each-other', `${PLATE} holes(plate, { across: 6, apart: [6, 14] });`, { rem: 4 * cyl(6, 10), unguarded: true, note: 'neighbouring bores 6 apart, 6 across: tangent to each other' });
add('holes-tangent', 'holes-near-tangent-control', `${PLATE} holes(plate, { across: 6, apart: [6.2, 14] });`, { rem: 4 * cyl(6, 10), note: 'control: 0.2 mm web between neighbours' });
// invalid deep / apart
add('deep-invalid', 'deep-zero', `${PLATE} hole(plate, { across: 6, deep: 0 });`);
add('deep-invalid', 'deep-negative', `${PLATE} hole(plate, { across: 6, deep: -3 });`);
add('deep-invalid', 'deep-string', `${PLATE} hole(plate, { across: 6, deep: 'abc' });`);
add('deep-invalid', 'deep-nan', `${PLATE} hole(plate, { across: 6, deep: NaN });`);
add('apart-invalid', 'apart-one', `${PLATE} holes(plate, { across: 6, apart: [20] });`);
add('apart-invalid', 'apart-three', `${PLATE} holes(plate, { across: 6, apart: [20, 10, 5] });`);
add('apart-invalid', 'apart-string', `${PLATE} holes(plate, { across: 6, apart: 'wide' });`);
add('apart-invalid', 'apart-nan', `${PLATE} holes(plate, { across: 6, apart: [NaN, 10] });`);
add('apart-invalid', 'apart-negative', `${PLATE} holes(plate, { across: 6, apart: [-20, 10] });`, { rem: 4 * cyl(6, 10), note: 'a negative spacing is read as its absolute value: the same four bores as [20, 10]' });
add('apart-invalid', 'apart-zero-one-axis', `${PLATE} holes(plate, { across: 6, apart: [0, 14] });`, { rem: 2 * cyl(6, 10), note: 'dx = 0: two pairs of coincident bores, two distinct bores' });
// redundant second hole
add('redundant', 'hole-twice-identical', `${PLATE} const h1 = hole(plate, { across: 6 }); hole(h1, { across: 6 });`, { unguarded: true, note: 'the same through hole drilled twice: nothing left to remove' });
add('redundant', 'hole-twice-blind', `${BOX} const h1 = hole(b, { across: 6, deep: 8 }); hole(h1, { across: 6, deep: 8 });`, { unguarded: true });
add('redundant', 'hole-inside-earlier-bore', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 4, deep: 6 });`, { unguarded: true, note: 'a narrower, shallower blind bore inside an earlier wider one' });
// stepped parts
const STEP = 'const a = cuboid(40, 30, 10); const t = cuboid(20, 30, 20, { at: [30, 0, 5] }); const r = join(a, t);';
add('step', 'step-join-blind-low', `${STEP} hole(r, { across: 4, at: [-20, 0], deep: 4 });`, { unguarded: true, note: 'low step (top z=5) of a stepped join (high step top z=15): the script layer treats the extent as exact and starts the bore at z=15, in air' });
add('step', 'step-join-blind-low-deep12', `${STEP} hole(r, { across: 4, at: [-20, 0], deep: 12 });`, { unguarded: true, note: 'deep 12 from z=15 reaches z=3: only 2 mm of it is in material' });
add('step', 'step-join-blind-high', `${STEP} hole(r, { across: 4, at: [20, 0], deep: 4 });`, { rem: cyl(4, 4), note: 'bore on the high step: its top is the bbox top' });
add('step', 'step-join-through-low', `${STEP} hole(r, { across: 4, at: [-20, 0] });`, { rem: cyl(4, 10), note: 'through bore on the low step is right whatever the top' });
add('step', 'step-join-blind-on-seam', `${STEP} hole(r, { across: 4, at: [10, 0], deep: 4 });`, { unguarded: true, note: 'bore centred on the step wall (x=20): the axis is on the high step\'s edge' });
// tilted shapes
add('tilt', 'tilt-x30-blind-8', 'const b = cuboid(40, 30, 10); turn(b, [30, 0, 0]); hole(b, { across: 6, deep: 8 });', { unguarded: true, note: 'slab tilted 30 degrees about x, blind from the bbox top' });
add('tilt', 'tilt-x30-through', 'const b = cuboid(40, 30, 10); turn(b, [30, 0, 0]); hole(b, { across: 6 });', { note: 'through bore in the same tilted slab' });
add('tilt', 'tilt-y20-blind-3', 'const b = cuboid(40, 30, 10); turn(b, [0, 20, 0]); hole(b, { across: 6, deep: 3 });', { unguarded: true });
// closed / open hollow
add('hollow', 'closed-hollow-hole', 'const b = cuboid(40, 30, 20); hollow(b, { wall: 2 }); hole(b, { across: 6 });', { note: 'hollow with no open side, then a through hole' });
add('hollow', 'hollow-open-top-blind', "const b = cuboid(40, 30, 20); hollow(b, { wall: 2, open: 'top' }); hole(b, { across: 6, deep: 1 });", { unguarded: true, note: 'blind hole from the bbox top over the open cavity' });
add('hollow', 'hollow-open-top-side-wall', "const b = cuboid(40, 30, 20); hollow(b, { wall: 2, open: 'top' }); hole(b, { across: 6, along: 'x' });", { note: 'bore along x through both 2 mm side walls of the open-top box (cuts the walls and nothing else)', rem: 2 * cyl(6, 2) });
// second bore on the wall of an earlier blind bore (face counts)
add('wall', 'bore-on-wall-of-blind', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 4, at: [5, 0] });`, { note: 'second through bore centred on the wall of the first (10 across, 10 deep) bore' });
add('wall', 'bore-on-wall-of-blind-blind', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 4, at: [5, 0], deep: 15 });`, { note: 'same, second bore blind 15' });

// face-count hypothesis tests: how many cylinder faces does truck make where a second bore breaks through the wall of an earlier blind bore?
add('wall', 'faces-notch-r0.5', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 1, at: [5, 0] });`, { note: 'tiny second bore on the wall: the r5 wall stays a 350-degree patch' });
add('wall', 'faces-notch-r9', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 18, at: [5, 0] });`, { note: 'wide second bore on the wall: the r5 wall is left a 104-degree patch' });
add('wall', 'faces-notch-r2-far', `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 4, at: [14, 0] });`, { note: 'control: second bore clear of the first, no interaction' });

// the blind spot of G-TANGENT: tangency to an INTERIOR face (pocket wall, notch wall), which is not a bbox side
const POCKET2 = `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 6, { at: [22, 15] }); const p = pocket(s2, plate, 4);`;
add('tangent-interior', 'tangent-pocket-wall-through', `${POCKET2} hole(p, { across: 4, at: [9, 0] });`, { rem: cyl(4, 10), note: 'bore centre x=29, radius 2: tangent to the pocket wall at x=27 (outside the pocket, so the bore is in full 10 thick material)' });
add('tangent-interior', 'tangent-pocket-wall-blind', `${POCKET2} hole(p, { across: 4, at: [9, 0], deep: 12 });`, { rem: cyl(4, 10), note: 'same, deep 12 (through, with a bound on the extent)' });
add('tangent-interior', 'tangent-notch-wall', "const sk = sketch('top'); sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]); const L = extrude(sk, 10); hole(L, { across: 4, at: [-7, 5.5] });", { rem: cyl(4, 10), note: 'L pad, bore centre (8,18) radius 2 in the leg: tangent to the inner wall x=10 of the notch' });
export { CASES };
