// Cases for the "holes" contract group. Each: { id, row, script, rem?, vol?, fc?, note? }.
//   rem = closed-form volume REMOVED by the last feature (independent of every kernel); vol = closed-form final volume.
//   fc  = id of a saved FreeCAD ref (docs/replica/freecad/gauntlet/variants/refs/ref-<fc>.json).
// Gauntlet variants are taken from defs.mjs verbatim (script text + FreeCAD ref); rem is added here from closed forms.
import { VARIANTS } from '../../../replica/freecad/gauntlet/variants/defs.mjs';

const PI = Math.PI;
const cyl = (d, L) => PI * (d / 2) ** 2 * L;
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10);";
const BOX = 'const b = cuboid(40, 40, 20); ';
const lens = (r, d) => 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d); // overlap of two circles r at distance d
const unionArea = (r, d) => 2 * PI * r * r - lens(r, d);
/** numeric: integral over the bore disc (radius r, centred (cx,cy)) of chord(x,y), midpoint rule */
function numRem(r, chord, cx = 0, cy = 0, n = 600) {
  let s = 0; const h = (2 * r) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -r + (i + 0.5) * h; const y = -r + (j + 0.5) * h;
    if (x * x + y * y <= r * r) s += chord(cx + x, cy + y) * h * h;
  }
  return s;
}
/** counterbore through/blind removal: bore length bl (<= t), recess R x cbd */
const cbRem = (d, R, cbd, bl) => cyl(d, bl) + cyl(R, cbd) - cyl(d, cbd);
/** countersink removal: bore length bl, mouth D, included angle a (deg); handles the cone leaving through the bottom */
function csRem(d, D, a, bl) {
  const R = D / 2; const r = d / 2; const tn = Math.tan((a * PI) / 360); const dc = (R - r) / tn;
  if (dc <= bl) return PI * r * r * bl + (PI * dc / 3) * (R * R + R * r + r * r) - PI * r * r * dc;
  const rb = R - bl * tn;
  return (PI * bl / 3) * (R * R + R * rb + rb * rb);
}

const gaunt = (id) => VARIANTS.find((v) => v.id === id);
const GREM = {
  'hole-simple__offcentre-through': cyl(6, 10),
  'hole-simple__blind-4': cyl(6, 4),
  'hole-simple__along-x': cyl(4, 40),
  'hole-simple__along-y': cyl(3, 30),
  'hole-simple__big-and-thick': cyl(20, 25),
  'hole-simple__tiny-deep': cyl(1, 30),
  'hole-simple__breaks-out-of-the-side': (() => { const r = 5; const dd = 3; const seg = r * r * Math.acos(dd / r) - dd * Math.sqrt(r * r - dd * dd); return (PI * r * r - seg) * 10; })(),
  'hole-simple__in-cylinder': cyl(6, 20),
  'hole-simple__hexagon-prism': cyl(8, 12),
  'hole-simple__two-holes-sequential': cyl(6, 10) + cyl(4, 10),
  'hole-counterbore__through-offset': cbRem(6, 12, 3, 10),
  'hole-counterbore__deep-recess': cbRem(6, 14, 7, 20),
  'hole-counterbore__blind': cbRem(6, 10, 3, 7),
  'hole-counterbore__wide-thin': cbRem(5, 24, 2, 6),
  'hole-counterbore__in-cylinder': cbRem(6, 12, 4, 20),
  'hole-countersink__angle-90-offset': csRem(6, 12, 90, 10),
  'hole-countersink__angle-120': csRem(5, 14, 120, 10),
  'hole-countersink__angle-60': csRem(4, 10, 60, 10),
  'hole-countersink__thick-block': csRem(8, 16, 90, 30),
  'hole-countersink__blind': csRem(6, 12, 90, 6),
  'hole-countersink__in-cylinder': csRem(6, 12, 90, 20),
  'hole-countersink__cone-deeper-than-plate-roomy': csRem(5, 30, 90, 10),
  'hole-countersink__cone-deeper-than-plate-angle-60': csRem(5, 24, 60, 6),
  'hole-countersink__cone-deeper-than-plate': csRem(5, 30, 90, 10),
};
const GROW = (id) => (id.startsWith('hole-counterbore') ? 'counterbore' : id.startsWith('hole-countersink') ? 'countersink'
  : id.includes('along') ? 'along' : id.includes('blind') ? 'blind' : 'core');

export const CASES = [];
const add = (row, id, script, extra = {}) => CASES.push({ row, id, script, ...extra });

// ---- gauntlet hole variants (script + saved FreeCAD ref + closed-form removal) -----------------------------------
for (const v of VARIANTS) {
  if (!/^hole-(simple|counterbore|countersink)__/.test(v.id)) continue;
  const row = v.id === 'hole-simple__breaks-out-of-the-side' ? 'breakout' : v.id.startsWith('hole-simple__in-cylinder') || v.id === 'hole-simple__hexagon-prism' ? 'host-misc' : v.id === 'hole-simple__two-holes-sequential' ? 'successive' : GROW(v.id);
  add(row, `g:${v.id}`, v.ours, { fc: v.id, rem: GREM[v.id], note: v.desc, fromRoot: v.id === 'hole-simple__two-holes-sequential' });
}

// ---- core: across, at, through -----------------------------------------------------------------------------------
add('core', 'core-centred-through', `${PLATE} hole(plate, { across: 6 });`, { rem: cyl(6, 10) });
add('core', 'core-at-xy', `${PLATE} hole(plate, { across: 6, at: [-12, 7] });`, { rem: cyl(6, 10) });
add('core', 'core-5-digit-precision', `${PLATE} hole(plate, { across: 6.35, at: [0.5, -0.25] });`, { rem: cyl(6.35, 10) });
add('core', 'core-widest-that-fits', `${PLATE} hole(plate, { across: 29.9 });`, { rem: cyl(29.9, 10) });
add('wider', 'wider-than-plate-35', `${PLATE} hole(plate, { across: 35 });`, { note: 'across 35 on a 40 x 30 plate: the bore is wider than the plate is deep' });
add('wider', 'wider-than-plate-30-exact', `${PLATE} hole(plate, { across: 30 });`, { note: 'across 30 on a 30 deep plate: tangent to both long edges' });
add('wider', 'wider-than-plate-31', `${PLATE} hole(plate, { across: 31 });`, { note: 'across 31 on a 30 deep plate: splits the plate into two pieces' });
add('wider', 'wider-than-plate-30p5', `${PLATE} hole(plate, { across: 30.5 });`, { note: 'across 30.5: splits the plate into two pieces' });
add('wider', 'wider-than-everything-60', `${PLATE} hole(plate, { across: 60 });`, { note: 'bore swallows the whole plate' });
add('wider', 'bore-tangent-to-edge', `${PLATE} hole(plate, { across: 10, at: [15, 0] });`, { note: 'centre x=35, radius 5: touches x=40 at a single point' });

// ---- size names --------------------------------------------------------------------------------------------------
for (const [n, d] of [['M3', 3.4], ['M4', 4.5], ['M5', 5.5], ['M6', 6.6], ['M8', 9], ['M10', 11], ['M12', 13.5]]) {
  add(`size-${n}`, `size-${n}`, `${PLATE} hole(plate, { size: '${n}', at: [3, -2] });`, { rem: cyl(d, 10), note: `${n} clearance ${d}` });
}
add('size-case', 'size-lowercase-m6', `${PLATE} hole(plate, { size: 'm6' });`, { rem: cyl(6.6, 10) });
add('size-case', 'size-padded-M6', `${PLATE} hole(plate, { size: '  M6 ' });`, { rem: cyl(6.6, 10) });
add('size-unknown', 'size-M7', `${PLATE} hole(plate, { size: 'M7' });`);
add('size-unknown', 'size-number', `${PLATE} hole(plate, { size: 6 });`);
add('size-unknown', 'size-M2', `${PLATE} hole(plate, { size: 'M2' });`);
add('across-size-both', 'across-and-size', `${PLATE} hole(plate, { across: 6, size: 'M6' });`);
add('across-missing', 'no-across-no-size', `${PLATE} hole(plate, {});`);
add('across-missing', 'no-options', `${PLATE} hole(plate);`);
add('across-invalid', 'across-zero', `${PLATE} hole(plate, { across: 0 });`);
add('across-invalid', 'across-negative', `${PLATE} hole(plate, { across: -4 });`);
add('across-invalid', 'across-string', `${PLATE} hole(plate, { across: 'abc' });`);
add('across-invalid', 'unknown-option', `${PLATE} hole(plate, { across: 4, radius: 2 });`);
add('across-invalid', 'hole-no-shape', "hole(5, { across: 4 });");

// ---- through (deep omitted) ---------------------------------------------------------------------------------------
add('through', 'through-thick-60', `const b = cuboid(30, 30, 60); hole(b, { across: 5 });`, { rem: cyl(5, 60) });
add('through', 'through-sphere', `const t = sphere(20); hole(t, { across: 2 });`, { rem: numRem(1, (x, y) => 2 * Math.sqrt(100 - x * x - y * y)) });
add('through', 'through-cone', `const t = cone(20, 30); hole(t, { across: 2 });`, { rem: 28 * PI });
add('through', 'through-cylinder-axis', `const c = cylinder(30, 20); hole(c, { across: 6 });`, { rem: cyl(6, 20) });
add('through', 'through-ring-misses', `const t = ring(30, 6); hole(t, { across: 2 });`, { note: 'ring 30 / tube 6: the centre is empty, the bore touches no material' });
add('through', 'through-ring-offset-hits', `const t = ring(30, 6); hole(t, { across: 2, at: [12, 0] });`, { rem: numRem(1, (x, y) => { const q = Math.sqrt(x * x + y * y); const w = 9 - 0; const rr = 3; const dz = rr * rr - (q - 12) * (q - 12); return dz > 0 ? 2 * Math.sqrt(dz) : 0; }, 12, 0), note: 'ring 30 / tube 6: ring radius 12, tube radius 3; bore across 2 on the ring centreline' });
add('through-unknown', 'through-unknown-intersect', 'const t = intersect(cuboid(10, 10, 10), cuboid(10, 10, 10)); hole(t, { across: 2 })');
add('through-unknown', 'through-unknown-polar-wedge', "const b = wedge(6, 8, 12, { at: [25, 0, 0] }); const p = polarPattern(b, { count: 3, axis: 'y' }); hole(p, { across: 2 })");
add('through-unknown', 'through-unknown-after-turn-step', `${PLATE} hole(plate, { across: 6 }); turn(plate, [0, 0, 20]); hole(plate, { across: 3, at: [10, 5] });`);
add('through-unknown', 'holes-unknown-intersect', 'const t = intersect(cuboid(10, 10, 10), cuboid(10, 10, 10)); holes(t, { across: 2, apart: [4, 4] })');

// ---- blind -------------------------------------------------------------------------------------------------------
add('blind', 'blind-deep-8-of-20', `${BOX} hole(b, { across: 6, deep: 8 });`, { rem: cyl(6, 8) });
add('blind', 'blind-offset-at', `${BOX} hole(b, { across: 6, deep: 4, at: [5, -3] });`, { rem: cyl(6, 4) });
add('blind', 'blind-equals-thickness', `${BOX} hole(b, { across: 6, deep: 20 });`, { rem: cyl(6, 20) });
add('blind', 'blind-beyond-thickness', `${BOX} hole(b, { across: 6, deep: 35 });`, { rem: cyl(6, 20) });
add('blind', 'blind-tiny-0p5', `${BOX} hole(b, { across: 6, deep: 0.5 });`, { rem: cyl(6, 0.5) });
add('blind', 'blind-just-short-19p9', `${BOX} hole(b, { across: 6, deep: 19.9 });`, { rem: cyl(6, 19.9) });
add('blind', 'blind-on-pulled-sketch', "const sk = sketch('top'); sk.rect(20, 20); const e = extrude(sk, 20); hole(e, { across: 6, deep: 10 })", { rem: cyl(6, 10) });
add('blind', 'blind-in-cylinder', `const c = cylinder(30, 20); hole(c, { across: 6, deep: 8 });`, { rem: cyl(6, 8) });
add('blind', 'blind-in-sphere', `const t = sphere(20); hole(t, { across: 2, deep: 3 });`, { rem: numRem(1, (x, y) => { const top = Math.sqrt(100 - x * x - y * y); return Math.max(0, top - 7); }) });
add('blind', 'blind-in-hex-prism', "const t = prism(6, 40, 12); hole(t, { across: 4, deep: 5 });", { rem: cyl(4, 5) });
add('blind-inexact', 'blind-on-pocket-result', `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 6, { at: [22, 15] }); const p = pocket(s2, plate, 4); hole(p, { across: 6, at: [-10, 0], deep: 4 });`);
add('blind-inexact', 'blind-on-subtract-result', 'const a = cuboid(40, 30, 10); const t = cylinder(10, 30, { at: [10, 0, 0] }); const r = subtract(a, t); hole(r, { across: 4, at: [-10, 0], deep: 4 })');
add('blind-inexact', 'blind-deep-ge-bound-on-pocket', `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 6, { at: [22, 15] }); const p = pocket(s2, plate, 4); hole(p, { across: 6, at: [-10, 0], deep: 12 });`, { rem: cyl(6, 10) });
add('blind-unknown', 'blind-unknown-intersect-4', 'const t = intersect(cuboid(20, 20, 20), cuboid(20, 20, 20, { at: [5, 0, 0] })); hole(t, { across: 6, deep: 4 })', { note: 'extent unknown (intersect): deep:4 builds centred, a sealed cavity inside the 15 x 20 x 20 block' });
add('blind-unknown', 'blind-unknown-intersect-deep-30', 'const t = intersect(cuboid(20, 20, 20), cuboid(20, 20, 20, { at: [5, 0, 0] })); hole(t, { across: 6, deep: 30 })', { rem: cyl(6, 20) });
add('blind-unknown', 'blind-wedge-turned', 'const w = wedge(10, 20, 30); turn(w, [0, 0, 20]); hole(w, { across: 2, deep: 3 })', { note: 'turned wedge: extent unknown, deep:3 builds centred' });

// ---- along / at -------------------------------------------------------------------------------------------------
add('along', 'along-x-default-at', `${PLATE} hole(plate, { across: 4, along: 'x' });`, { rem: cyl(4, 40) });
add('along', 'along-y-default-at', `${PLATE} hole(plate, { across: 4, along: 'y' });`, { rem: cyl(4, 30) });
add('along', 'along-z-explicit', `${PLATE} hole(plate, { across: 4, along: 'z', at: [3, 3] });`, { rem: cyl(4, 10) });
add('along', 'along-x-blind', `${PLATE} hole(plate, { across: 4, along: 'x', deep: 15, at: [3, 1] });`, { rem: cyl(4, 15) });
add('along', 'along-y-blind', `${PLATE} hole(plate, { across: 4, along: 'y', deep: 12, at: [-5, 1] });`, { rem: cyl(4, 12) });
add('along', 'along-bad-axis', `${PLATE} hole(plate, { across: 4, along: 'w' });`);
add('along', 'along-upper-case', `${PLATE} hole(plate, { across: 4, along: 'Z' });`);
add('at', 'at-wrong-length', `${PLATE} hole(plate, { across: 4, at: [1] });`);
add('at', 'at-three-values', `${PLATE} hole(plate, { across: 4, at: [1, 2, 3] });`);
add('at', 'at-off-the-part', `${PLATE} hole(plate, { across: 4, at: [50, 0] });`, { note: 'centre 30 mm beyond the plate edge: the bore touches no material' });
add('at', 'at-half-off-edge', `${PLATE} hole(plate, { across: 6, at: [20, 0] });`, { note: 'centre exactly on the x=40 edge: half the bore is in the plate' });

// ---- counterbore --------------------------------------------------------------------------------------------------
add('counterbore', 'cb-through-simple', `${PLATE} hole(plate, { across: 6, counterbore: { across: 10, deep: 3 } });`, { rem: cbRem(6, 10, 3, 10) });
add('counterbore', 'cb-size-M6', `${PLATE} hole(plate, { size: 'M6', counterbore: { across: 11, deep: 6.5 } });`, { rem: cbRem(6.6, 11, 6.5, 10) });
add('counterbore', 'cb-along-x', `${PLATE} hole(plate, { across: 4, along: 'x', counterbore: { across: 8, deep: 5 } });`, { rem: cbRem(4, 8, 5, 40) });
add('counterbore-degenerate', 'cb-narrower-than-bore', `${PLATE} hole(plate, { across: 6, counterbore: { across: 4, deep: 3 } });`);
add('counterbore-degenerate', 'cb-equal-to-bore', `${PLATE} hole(plate, { across: 6, counterbore: { across: 6, deep: 3 } });`);
add('counterbore-degenerate', 'cb-deeper-than-blind-hole', `${PLATE} hole(plate, { across: 6, deep: 4, counterbore: { across: 10, deep: 6 } });`);
add('counterbore-degenerate', 'cb-deeper-than-plate', `${PLATE} hole(plate, { across: 6, counterbore: { across: 10, deep: 12 } });`);
add('counterbore-degenerate', 'cb-as-wide-as-plate', `${PLATE} hole(plate, { across: 6, counterbore: { across: 30, deep: 3 } });`);
add('counterbore-degenerate', 'cb-missing-across', `${PLATE} hole(plate, { across: 6, counterbore: { deep: 3 } });`);
add('counterbore-degenerate', 'cb-missing-deep', `${PLATE} hole(plate, { across: 6, counterbore: { across: 10 } });`);
add('counterbore-degenerate', 'cb-zero-deep', `${PLATE} hole(plate, { across: 6, counterbore: { across: 10, deep: 0 } });`);

// ---- countersink --------------------------------------------------------------------------------------------------
add('countersink', 'cs-90-simple', `${PLATE} hole(plate, { across: 6, countersink: { across: 12, angle: 90 } });`, { rem: csRem(6, 12, 90, 10) });
add('countersink', 'cs-120', `${PLATE} hole(plate, { across: 5, countersink: { across: 11, angle: 120 } });`, { rem: csRem(5, 11, 120, 10) });
add('countersink', 'cs-size-M5-along-y', `${PLATE} hole(plate, { size: 'M5', along: 'y', countersink: { across: 10, angle: 90 } });`, { rem: csRem(5.5, 10, 90, 30) });
add('countersink-angle', 'cs-angle-180', `${PLATE} hole(plate, { across: 6, countersink: { across: 12, angle: 180 } });`);
add('countersink-angle', 'cs-angle-200', `${PLATE} hole(plate, { across: 6, countersink: { across: 12, angle: 200 } });`);
add('countersink-angle', 'cs-angle-179', `${PLATE} hole(plate, { across: 6, countersink: { across: 12, angle: 179 } });`, { rem: csRem(6, 12, 179, 10), note: 'cone almost flat: 0.05 mm deep' });
add('countersink-angle', 'cs-angle-0', `${PLATE} hole(plate, { across: 6, countersink: { across: 12, angle: 0 } });`);
add('countersink-angle', 'cs-angle-negative', `${PLATE} hole(plate, { across: 6, countersink: { across: 12, angle: -90 } });`);
add('countersink-angle', 'cs-missing-angle', `${PLATE} hole(plate, { across: 6, countersink: { across: 12 } });`);
add('countersink-angle', 'cs-missing-across', `${PLATE} hole(plate, { across: 6, countersink: { angle: 90 } });`);
add('countersink-degenerate', 'cs-narrower-than-bore', `${PLATE} hole(plate, { across: 6, countersink: { across: 4, angle: 90 } });`);
add('countersink-degenerate', 'cs-equal-to-bore', `${PLATE} hole(plate, { across: 6, countersink: { across: 6, angle: 90 } });`);
add('cb-cs-both', 'cb-and-cs', `${PLATE} hole(plate, { across: 6, counterbore: { across: 10, deep: 3 }, countersink: { across: 12, angle: 90 } });`);

// ---- holes() ------------------------------------------------------------------------------------------------------
add('holes', 'holes-corners-simple', `${PLATE} holes(plate, { across: 6, apart: [20, 10] });`, { rem: 4 * cyl(6, 10) });
add('holes', 'holes-corners-at', `${PLATE} holes(plate, { across: 4, apart: [20, 10], at: [3, 2] });`, { rem: 4 * cyl(4, 10) });
add('holes', 'holes-corners-size-M4', `${PLATE} holes(plate, { size: 'M4', apart: [30, 20] });`, { rem: 4 * cyl(4.5, 10) });
add('holes', 'holes-corners-blind', `${BOX} holes(b, { across: 6, apart: [20, 20], deep: 8 });`, { rem: 4 * cyl(6, 8) });
add('holes', 'holes-corners-blind-5', `${PLATE} holes(plate, { across: 4, apart: [24, 14], deep: 5 });`, { rem: 4 * cyl(4, 5) });
add('holes', 'holes-corners-in-cylinder', `const c = cylinder(60, 12); holes(c, { across: 5, apart: [30, 30] });`, { rem: 4 * cyl(5, 12) });
add('holes-geometry', 'holes-overlapping-columns', `${PLATE} holes(plate, { across: 6, apart: [4, 14] });`, { rem: 2 * unionArea(3, 4) * 10, note: 'bores 4 mm apart in x overlap pairwise' });
add('holes-geometry', 'holes-break-out-side', `${PLATE} holes(plate, { across: 6, apart: [38, 14] });`, { note: 'columns at x=+-19 from centre: 1 mm inside the x edge, radius 3: the bores break out of the sides' });
add('holes-geometry', 'holes-all-outside', `${PLATE} holes(plate, { across: 6, apart: [90, 80] });`, { note: 'all four bores miss the plate' });
add('holes-geometry', 'holes-two-outside', `${PLATE} holes(plate, { across: 6, apart: [20, 50] });`, { note: 'two rows at y=+-25 from centre: outside the 30 deep plate; no bore touches material' });
add('holes-geometry', 'holes-zero-spacing', `${PLATE} holes(plate, { across: 6, apart: [0, 0] });`, { rem: cyl(6, 10), note: 'four coincident bores' });
add('holes-missing', 'holes-no-apart', `${PLATE} holes(plate, { across: 6 });`);
add('holes-missing', 'holes-no-across', `${PLATE} holes(plate, { apart: [20, 10] });`);
add('holes-axis', 'holes-along-x', `${PLATE} holes(plate, { across: 2, along: 'x', apart: [10, 6] });`, { rem: 4 * cyl(2, 40), note: 'documented: four bores at +-apart/2 on the two axes the drill does NOT point along (y, z)' });
add('holes-axis', 'holes-along-y', `${PLATE} holes(plate, { across: 2, along: 'y', apart: [10, 4] });`, { rem: 4 * cyl(2, 30), note: 'documented: four bores at +-apart/2 on x and z' });
add('holes-axis', 'holes-along-x-at', `${PLATE} holes(plate, { across: 2, along: 'x', apart: [10, 6], at: [1, 1] });`, { rem: 4 * cyl(2, 40) });
add('holes-axis', 'holes-along-x-blind', `${PLATE} holes(plate, { across: 2, along: 'x', apart: [10, 6], deep: 15 });`, { rem: 4 * cyl(2, 15) });
add('holes-recess', 'holes-counterbore', `${PLATE} holes(plate, { across: 4, apart: [20, 10], counterbore: { across: 8, deep: 3 } });`, { rem: 4 * cbRem(4, 8, 3, 10) });
add('holes-recess', 'holes-countersink', `${PLATE} holes(plate, { across: 4, apart: [20, 10], countersink: { across: 8, angle: 90 } });`, { rem: 4 * csRem(4, 8, 90, 10) });

// ---- hosts --------------------------------------------------------------------------------------------------------
const POCKET = `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 6, { at: [22, 15] }); const p = pocket(s2, plate, 4);`;
add('host-pocket', 'pocket-hole-clear', `${POCKET} hole(p, { across: 6, at: [-10, 0] });`, { rem: cyl(6, 10) });
add('host-pocket', 'pocket-hole-through-floor', `${POCKET} hole(p, { across: 4, at: [2, 0] });`, { rem: cyl(4, 6), note: 'bore inside the pocket: only the 6 mm floor is cut' });
add('host-pocket', 'pocket-hole-half-in-wall', `${POCKET} hole(p, { across: 6, at: [7, 0] });`, { rem: (PI * 9 / 2) * 6 + (PI * 9 / 2) * 10, note: 'bore centre on the pocket wall: half floor (6), half full thickness (10)' });
add('host-pocket', 'pocket-through-hole-at-pocket-centre-deep-bound', `${POCKET} hole(p, { across: 4, at: [2, 0], deep: 10 });`, { rem: cyl(4, 6) });
add('host-pocket', 'pocket-then-two-holes', `${POCKET} const h1 = hole(p, { across: 4, at: [-10, 0] }); hole(h1, { across: 3, at: [-10, 8] });`, { rem: cyl(3, 10), note: 'second hole on the first hole result; rem is the second hole only' });
add('host-pad', 'pad-L-hole-in-notch', "const sk = sketch('top'); sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]); const L = extrude(sk, 10); hole(L, { across: 4 });", { rem: 0, note: 'bbox centre (15, 12.5) is in the empty notch: the bore touches no material' });
add('host-pad', 'pad-L-hole-in-leg', "const sk = sketch('top'); sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]); const L = extrude(sk, 10); hole(L, { across: 4, at: [-10, -5] });", { rem: cyl(4, 10) });
add('host-pad', 'pad-L-blind', "const sk = sketch('top'); sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]); const L = extrude(sk, 10); hole(L, { across: 4, at: [-10, -5], deep: 4 });", { rem: cyl(4, 4) });
add('host-pad', 'pad-circle-sketch', "const sk = sketch('top'); sk.circle(30); const e = extrude(sk, 16); hole(e, { across: 5, deep: 7 });", { rem: cyl(5, 7) });
add('host-pad', 'pad-side-plane', "const sk = sketch('side'); sk.rect(30, 20); const e = extrude(sk, 12); hole(e, { across: 4, along: 'x', deep: 5 });", { rem: cyl(4, 5), note: 'sketch on the side plane (pulls +x)' });
add('host-pad', 'pad-front-plane-offset', "const sk = sketch('front', 5); sk.rect(30, 20); const e = extrude(sk, 12); hole(e, { across: 4, along: 'y' });", { rem: cyl(4, 12), note: 'front plane offset 5: the pad runs -y from y=5' });
add('host-rotated', 'rot-box-z30', 'const b = cuboid(40, 30, 10); turn(b, [0, 0, 30]); hole(b, { across: 6 });', { rem: cyl(6, 10) });
add('host-rotated', 'rot-box-z30-blind', 'const b = cuboid(40, 30, 10); turn(b, [0, 0, 30]); hole(b, { across: 6, deep: 4 });', { rem: cyl(6, 4) });
add('host-rotated', 'rot-box-x90-hole-z', 'const b = cuboid(40, 30, 10); turn(b, [90, 0, 0]); hole(b, { across: 6 });', { rem: cyl(6, 30), note: 'box on its edge: 30 thick along z' });
add('host-rotated', 'rot-box-y45-hole-z', 'const b = cuboid(40, 30, 10); turn(b, [0, 45, 0]); hole(b, { across: 6 });', { rem: (cyl(6, 10)) / Math.cos(PI / 4), note: 'slab tilted 45 degrees: the bore sees 10 / cos 45 of material' });
add('host-rotated', 'rot-box-y45-blind', 'const b = cuboid(40, 30, 10); turn(b, [0, 45, 0]); hole(b, { across: 6, deep: 3 });', { note: 'tilted slab, blind bore from the top: the cut is a tilted-end cylinder' });
add('host-rotated', 'rot-cylinder-x90-hole-z', 'const c = cylinder(30, 20); turn(c, [90, 0, 0]); hole(c, { across: 6 });', { rem: numRem(3, (x, y) => 2 * Math.sqrt(225 - x * x)), note: 'cylinder lying along y, bore along z through its middle' });
add('host-rotated', 'rot-cone-turned-through', 'const c = cone(20, 30); turn(c, [0, 90, 0]); hole(c, { across: 2 });', { note: 'cone lying along x, bore along z through the middle' });
add('host-rotated', 'rot-prism-turned', 'const t = prism(6, 40, 12); turn(t, [0, 0, 15]); hole(t, { across: 4 });', { rem: cyl(4, 12) });
add('host-cut', 'cut-hole-through', 'const a = cuboid(40, 30, 10); const t = cylinder(10, 30, { at: [10, 0, 0] }); const r = subtract(a, t); hole(r, { across: 4, at: [-10, 0] });', { rem: cyl(4, 10), note: 'through hole on a subtract result (extent is only an upper bound)' });
add('host-cut', 'cut-hole-into-cut-edge', 'const a = cuboid(40, 30, 10); const t = cylinder(10, 30, { at: [10, 0, 0] }); const r = subtract(a, t); hole(r, { across: 4, at: [5, 0] });', { note: 'bore centred on the cylinder cut wall: half the bore is already air' });
add('host-cut', 'union-hole-blind', 'const a = cuboid(40, 30, 10); const t = cuboid(20, 30, 10, { at: [30, 0, 0] }); const r = join(a, t); hole(r, { across: 4, at: [5, 0], deep: 4 });', { note: 'join of two abutting boxes: exact extent, blind from the top' });
add('host-misc', 'moved-box', 'const b = cuboid(40, 30, 10); move(b, [100, 50, 20]); hole(b, { across: 6 });', { rem: cyl(6, 10) });
add('host-misc', 'moved-box-blind', 'const b = cuboid(40, 30, 10, { at: [100, 50, 20] }); hole(b, { across: 6, deep: 4 });', { rem: cyl(6, 4) });
add('host-misc', 'cross-bore-through-cylinder', 'const c = cylinder(20, 30); hole(c, { across: 4, along: "x" });', { rem: numRem(2, (y, z) => (Math.abs(z) <= 15 ? 2 * Math.sqrt(100 - y * y) : 0)) });
add('successive', 'bores-blind-stacked', `${BOX} hole(b, { across: 6, deep: 8, at: [-12, 0] }); hole(b, { across: 6, deep: 14, at: [0, 0] }); hole(b, { across: 6, deep: 20, at: [12, 0] });`, { fromRoot: true, rem: cyl(6, 8) + cyl(6, 14) + cyl(6, 20), note: 'second and third bore are on the first hole result' });
add('successive', 'bore-overlapping-second', `${PLATE} const h1 = hole(plate, { across: 6, at: [-2, 0] }); hole(h1, { across: 6, at: [2, 0] });`, { fromRoot: true, rem: unionArea(3, 4) * 10 });
add('successive', 'bore-into-previous-bore-floor', `${BOX} const h1 = hole(b, { across: 8, deep: 10 }); hole(h1, { across: 4, deep: 15 });`, { fromRoot: true, rem: cyl(8, 10) + cyl(4, 15) - cyl(4, 10), note: 'a narrower bore continued below the first blind bore: the overlap must not be double-counted' });
add('successive', 'holes-then-hole', `${PLATE} const h1 = holes(plate, { across: 4, apart: [20, 10] }); hole(h1, { across: 5 });`, { fromRoot: true, rem: 4 * cyl(4, 10) + cyl(5, 10) });

// ---- round 2 additions (critic: bores as wide as the host, hosts that were never tried, sentence defects) ----------------------------
const boxChord = (x, y) => (Math.abs(x) <= 20 && Math.abs(y) <= 20 ? 20 : 0);
add('wide-box', 'wide-box40-tangent', `${BOX} hole(b, { across: 40 });`, { rem: cyl(40, 20), note: '40 across on a 40 x 40 x 20 box: tangent to all four sides, the box is left as four corner pieces that touch the bore only along lines' });
add('wide-box', 'wide-box41', `${BOX} hole(b, { across: 41 });`, { rem: numRem(20.5, boxChord, 0, 0, 2000), note: '41 across on the 40 x 40 box: the bore breaks out of all four sides, four separate corner pieces remain' });
add('wide-box', 'wide-box38-control', `${BOX} hole(b, { across: 38 });`, { rem: cyl(38, 20), note: 'control: 38 across leaves a 1 mm wall all round, one connected piece' });
add('wide-cyl', 'wide-cyl30', 'const c = cylinder(30, 20); hole(c, { across: 30 });', { note: 'bore as wide as the cylinder: swallows the whole part' });
add('wide-cyl', 'wide-cyl40', 'const c = cylinder(30, 20); hole(c, { across: 40 });', { note: 'bore wider than the cylinder' });
add('wide-cyl', 'wide-cyl29-control', 'const c = cylinder(30, 20); hole(c, { across: 29 });', { note: 'control: leaves a 0.5 mm tube (no closed form: the host cylinder is tessellated, the 0.5 mm tube would amplify it 15x; OCCT and brep-rs are the oracles)' });
add('through', 'through-ring-misses-4', 'const t = ring(30, 6); hole(t, { across: 4 });', { note: 'ring 30 / tube 6, across 4: the whole bore is in the empty centre' });
add('host-pattern', 'pat-disjoint-hole', 'const a = cuboid(20, 20, 10); repeat(a, { count: 3, step: [30, 0, 0] }); hole(a, { across: 4 });', { vol: 3 * 4000 - cyl(4, 10), note: 'three copies 10 mm apart (not touching); the bore is on the middle copy (bounding-box centre)' });
add('host-pattern', 'pat-disjoint-hole-first-copy', 'const a = cuboid(20, 20, 10); repeat(a, { count: 3, step: [30, 0, 0] }); hole(a, { across: 4, at: [-30, 0] });', { vol: 3 * 4000 - cyl(4, 10), note: 'same, bore on the first copy' });
add('host-pattern', 'pat-touching-hole', 'const a = cuboid(20, 20, 10); repeat(a, { count: 3, step: [20, 0, 0] }); hole(a, { across: 4 });', { vol: 3 * 4000 - cyl(4, 10), note: 'control: copies touch (one fused block)' });
add('host-hollow', 'hollow-open-top-hole', "const b = cuboid(40, 30, 20); hollow(b, { wall: 2, open: 'top' }); hole(b, { across: 6 });", { note: 'hole on a hollow() result' });
add('host-round', 'round-box-hole-through', `${BOX} round(b, 2); hole(b, { across: 6 });`, { note: 'through bore on a box with all edges rounded r2' });
add('host-round', 'round-box-hole-37', `${BOX} round(b, 2); hole(b, { across: 37 });`, { note: '37 across: the bore reaches into the rounded top and bottom rims' });
add('host-revolve', 'revolve-hole-wall', "const s = sketch('top'); s.polygon([[10,0],[20,0],[20,30],[10,30]]); const r = spin(s, 360); hole(r, { across: 4, at: [15, 0] });", { note: 'tube (r 10..20, 30 tall) from spin; bore through the wall at x=15' });
add('host-revolve', 'revolve-hole-wall-blind', "const s = sketch('top'); s.polygon([[10,0],[20,0],[20,30],[10,30]]); const r = spin(s, 360); hole(r, { across: 4, at: [15, 0], deep: 10 });", { note: 'same, blind 10' });
add('host-mirror', 'mirror-hole-seam', "const a = cuboid(20, 20, 10, { at: [10, 0, 0] }); mirror(a, 'left-right'); hole(a, { across: 4, at: [5, 0] });", { vol: 4000 * 2 - cyl(4, 10), note: 'box mirrored through its x=0 face (touching copies, a 40 x 20 x 10 block), bore on the right half' });
add('at', 'at-nan', `${PLATE} hole(plate, { across: 6, at: [NaN, 0] });`, { note: 'non-finite position' });
add('at', 'at-infinity', `${PLATE} hole(plate, { across: 6, at: [0, Infinity] });`, { note: 'non-finite position' });
add('across-invalid', 'across-nan', `${PLATE} hole(plate, { across: NaN });`, { note: 'non-finite diameter' });
add('host-mirror', 'mirror-hole-seam-var', "const a = cuboid(20, 20, 10, { at: [10, 0, 0] }); const m = mirror(a, 'left-right'); hole(m, { across: 4, at: [5, 0] });", { vol: 4000 * 2 - cyl(4, 10), note: 'same, the hole targets the mirror result' });
add('host-mirror', 'mirror-hole-seam-var-blind', "const a = cuboid(20, 20, 10, { at: [10, 0, 0] }); const m = mirror(a, 'left-right'); hole(m, { across: 4, at: [5, 0], deep: 4 });", { vol: 4000 * 2 - cyl(4, 4), note: 'same, blind' });
