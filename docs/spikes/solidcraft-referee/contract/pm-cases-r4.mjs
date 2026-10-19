// Round-4 cases of the patterns-mirror group (critic round 2 findings). Each: { id, row, src, note? }.
//   r4-snap-*   near-coincident copies: a copy shifted by almost nothing is fused onto the original by solid.combine join and the thin layer is
//               silently dropped. One size at a time, shifts from 1e-6 to 1 mm, so the snap threshold is a table and not a claim.
//   r4-hollow-* repeat / repeatAround / mirror of hollow() shapes (closed = refused with a plain sentence, open side = builds)
//   r4-round-*  repeat / mirror of round()ed boxes and cylinders; r4-bevel-*: bevel() of a whole shape
// EXPECT4 holds closed forms for the cases OCCT cannot score (it ignores pocket {reversed} and the taper of pull): pm-run.mjs scores those
// against the saved FreeCAD ref when there is one, else against this table.
const frustum = (side, h, deg) => { const a2 = (side + 2 * h * Math.tan((deg * Math.PI) / 180)) ** 2; const a1 = side * side; return (h / 3) * (a1 + a2 + Math.sqrt(a1 * a2)); };
export const EXPECT4 = {
  'rl-pocket-reversed-own': 12000 - Math.PI * 9 * 3,
  'r3-taper-alone': frustum(20, 15, 5),
  'r3-mir-taper-tb': 2 * frustum(20, 15, 5),
  'r3-mir-taper-neg-tb': 2 * frustum(20, 15, -5),
};

const box = (sz, at = [0, 0, 0]) => `box(${sz.join(', ')}, { at: [${at.join(', ')}] })`;
const rep = (shape, count, step) => `const a = ${shape}; repeat(a, { count: ${count}, step: [${step.join(', ')}] });`;
const out = [];
const add = (id, row, src, note) => out.push({ id, row, src, ...(note ? { note } : {}) });
const tag = (d) => String(d).replace('-', 'm');

// ---- the threshold tables: one part, one axis, a ladder of shifts (count 2) ---------------------------------------------------------------
const ladder = (name, sz, axis, ds) => { for (const d of ds) { const st = [0, 0, 0]; st[axis] = d; add(`r4-snap-${name}-${'xyz'[axis]}-${tag(d)}`, 'r4-snap', rep(box(sz), 2, st), `${sz.join('x')} box shifted ${d} mm along ${'xyz'[axis]}`); } };
ladder('b10', [10, 10, 10], 0, [1e-6, 1e-4, 0.005, 0.01, 0.02, 0.027, 0.03, 0.05, 0.1, 0.14, 0.16, 0.2, 0.5, 1]);
ladder('b200', [200, 200, 200], 0, [0.1, 0.4, 0.55, 0.6, 2, 2.9, 3.2, 10]);
ladder('b1', [1, 1, 1], 0, [0.001, 0.00275, 0.003, 0.01, 0.014, 0.016, 0.1]);
ladder('plate', [40, 40, 10], 2, [0.01, 0.03, 0.04, 0.1, 0.14, 0.16, 0.5]);
ladder('plate', [40, 40, 10], 0, [0.02, 0.05, 0.08, 0.14, 0.16, 0.5]);
ladder('bar', [100, 2, 2], 0, [0.005, 0.01, 0.02, 0.03, 0.04, 0.1, 1]);
ladder('bar', [100, 2, 2], 1, [0.005, 0.0075, 0.01, 0.02, 0.04, 0.1]);
ladder('slab', [100, 100, 1], 2, [0.001, 0.003, 0.005, 0.014, 0.02, 0.1]);
for (const d of [0.001, 0.0015, 0.05, 0.08, 0.1]) add(`r4-snap-b10-diag-${d}`, 'r4-snap', rep(box([10, 10, 10]), 2, [d, d, d]), `diagonal shift [${d},${d},${d}]`);
// more than two copies: neighbouring copies are the close pair
add('r4-snap-b10-x-0.02-n3', 'r4-snap', rep(box([10, 10, 10]), 3, [0.02, 0, 0]));
add('r4-snap-b10-x-0.02-n5', 'r4-snap', rep(box([10, 10, 10]), 5, [0.02, 0, 0]));
add('r4-snap-b10-x-0.5-n5', 'r4-snap', rep(box([10, 10, 10]), 5, [0.5, 0, 0]));
// round parts
for (const d of [0.01, 0.05, 0.2]) {
  add(`r4-snap-cyl-x-${d}`, 'r4-snap', `const a = cylinder(10, 10); repeat(a, { count: 2, step: [${d}, 0, 0] });`);
  add(`r4-snap-cyl-z-${d}`, 'r4-snap', `const a = cylinder(10, 10); repeat(a, { count: 2, step: [0, 0, ${d}] });`);
}
for (const d of [0.01, 0.2]) add(`r4-snap-sph-x-${d}`, 'r4-snap', `const a = sphere(10); repeat(a, { count: 2, step: [${d}, 0, 0] });`);
// shifts that keep a whole face of one copy against the other (these are NOT near-coincident copies and must stay supported / unchanged)
add('r4-snap-touch-yoff-0.01', 'r4-snap-keep', rep(box([10, 10, 10]), 2, [10, 0.01, 0]), 'face-touching, 0.01 off in y');
add('r4-snap-half-yoff-0.01', 'r4-snap-keep', rep(box([10, 10, 10]), 2, [5, 0.01, 0]), 'half overlap, 0.01 off in y');
add('r4-snap-ybig-xtiny', 'r4-snap-keep', rep(box([10, 10, 10]), 2, [0.01, 5, 0]), 'half overlap in y, 0.01 off in x');
add('r4-snap-edge-overlap', 'r4-snap-keep', rep(box([10, 10, 10]), 2, [9.99, 0.01, 0]), 'overlap 0.01 in x and y');
// circular patterns with tiny spacing
add('r4-snap-around-b10-r20-n360', 'r4-snap', `const a = ${box([10, 10, 10], [20, 0, 0])}; repeatAround(a, { count: 360 });`, 'travel of the far corner 0.45 mm');
add('r4-snap-around-b10-r10-n300', 'r4-snap', `const a = ${box([10, 10, 10], [10, 0, 0])}; repeatAround(a, { count: 300 });`, 'travel 0.33 mm');
add('r4-snap-around-b10-r10-n1000', 'r4-snap', `const a = ${box([10, 10, 10], [10, 0, 0])}; repeatAround(a, { count: 1000 });`, 'travel 0.10 mm, under the 0.15 limit');
add('r4-snap-around-b10-r20-n1000', 'r4-snap', `const a = ${box([10, 10, 10], [20, 0, 0])}; repeatAround(a, { count: 1000 });`, 'travel 0.16 mm');
add('r4-snap-around-b1-r20-n1000', 'r4-snap', `const a = ${box([1, 1, 1], [20, 0, 0])}; repeatAround(a, { count: 1000 });`, 'travel 0.13 mm of a 1 mm cube');
add('r4-snap-around-cyl-n720', 'r4-snap', `const a = cylinder(10, 10, { at: [15, 0, 0] }); repeatAround(a, { count: 720 });`);
// ---- pockets and holes (repeat(pocket) arrives at the translator as one more sketch + pocket per copy) -----------------------------------------
const plate = `const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,40],[0,40]]); const plate = extrude(s1, 10);`;
const pk = (d, step) => `${plate} const p1 = sketch('top', 10); p1.circle(${d}, { at: [10, 10] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [${step.join(', ')}] });`;
for (const d of [0.01, 0.05, 0.08, 0.1, 0.2, 1]) add(`r4-snap-pocket-x-${d}`, 'r4-snap-cut', pk(6, [d, 0, 0]), `pocket d6 repeated ${d} mm along x`);
add('r4-snap-pocket-z-0.01', 'r4-snap-cut', `${plate} const p1 = sketch('top', 10); p1.circle(6, { at: [10, 10] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [0, 0, 0.01] });`, 'the copy lifted 0.01 off the face');
add('r4-snap-pocket-rect-x-0.01', 'r4-snap-cut', `${plate} const p1 = sketch('top', 10); p1.rect(10, 6, { at: [20, 20] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [0.01, 0, 0] });`);
add('r4-snap-pocket-n5-0.01', 'r4-snap-cut', `${plate} const p1 = sketch('top', 10); p1.circle(6, { at: [10, 10] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 5, step: [0.01, 0, 0] });`);
add('r4-snap-mirror-pocket-near-centre', 'r4-snap-cut', `${plate} const p1 = sketch('top', 10); p1.circle(6, { at: [10, 10] }); const pk = pocket(p1, plate, 4); mirror(pk, 'left-right', { at: 10.005 });`, 'mirror plane 0.005 from the pocket centre: copy lands 0.01 away');
add('r4-snap-mirror-pocket-far', 'r4-snap-keep', `${plate} const p1 = sketch('top', 10); p1.circle(6, { at: [10, 10] }); const pk = pocket(p1, plate, 4); mirror(pk, 'left-right', { at: 30 });`, 'ordinary mirror of a pocket');
add('r4-snap-two-pockets-by-hand-0.01', 'r4-snap-cut', `${plate} const p1 = sketch('top', 10); p1.circle(6, { at: [10, 10] }); const a = pocket(p1, plate, 4); const p2 = sketch('top', 10); p2.circle(6, { at: [10.01, 10] }); pocket(p2, a, 4);`, 'hand-written second pocket 0.01 from the first');
add('r4-snap-two-holes-by-hand-0.01', 'r4-snap-cut', `${plate} const h1 = hole(plate, { across: 6, at: [10, 10] }); hole(h1, { across: 6, at: [10.01, 10] });`, 'hand-written second hole 0.01 from the first');
add('r4-snap-two-holes-by-hand-8', 'r4-snap-keep', `${plate} const h1 = hole(plate, { across: 6, at: [10, 10] }); hole(h1, { across: 6, at: [30, 10] });`, 'ordinary second hole');
// ---- hollow() ------------------------------------------------------------------------------------------------------------------------------
add('r4-hollow-repeat-disjoint', 'r4-hollow', `const b = box(30, 30, 30); hollow(b, { wall: 3 }); repeat(b, { count: 2, step: 50 });`, 'closed hollow, copies apart');
add('r4-hollow-repeat-overlap', 'r4-hollow', `const b = box(30, 30, 30); hollow(b, { wall: 3 }); repeat(b, { count: 2, step: 15 });`);
add('r4-hollow-around', 'r4-hollow', `const b = box(20, 20, 20, { at: [40, 0, 0] }); hollow(b, { wall: 2 }); repeatAround(b, { count: 4 });`);
add('r4-hollow-mirror', 'r4-hollow', `const b = box(30, 30, 30, { at: [40, 0, 0] }); hollow(b, { wall: 3 }); mirror(b, 'left-right');`);
add('r4-hollow-cyl-mirror', 'r4-hollow', `const b = cylinder(20, 30, { at: [0, 0, 15] }); hollow(b, { wall: 2 }); mirror(b, 'top-bottom');`);
add('r4-hollow-open-repeat', 'r4-hollow-open', `const b = box(30, 30, 30); hollow(b, { wall: 3, open: "top" }); repeat(b, { count: 2, step: 50 });`, 'open top, copies apart');
add('r4-hollow-open-repeat-overlap', 'r4-hollow-open', `const b = box(30, 30, 30); hollow(b, { wall: 3, open: "top" }); repeat(b, { count: 2, step: 15 });`, 'open top, copies overlap');
add('r4-hollow-open-repeat-z', 'r4-hollow-open', `const b = box(30, 30, 30); hollow(b, { wall: 3, open: "top" }); repeat(b, { count: 3, step: [0, 0, 20] });`, 'open top, stacked into each other');
add('r4-hollow-open-mirror', 'r4-hollow-open', `const b = box(30, 30, 30, { at: [40, 0, 0] }); hollow(b, { wall: 3, open: "top" }); mirror(b, 'left-right');`);
add('r4-hollow-open-mirror-tb', 'r4-hollow-open', `const b = box(30, 30, 30, { at: [0, 0, 40] }); hollow(b, { wall: 3, open: "top" }); mirror(b, 'top-bottom');`, 'open top faces away from the mirror plane');
add('r4-hollow-open-around', 'r4-hollow-open', `const b = box(20, 20, 20, { at: [40, 0, 0] }); hollow(b, { wall: 2, open: "top" }); repeatAround(b, { count: 4 });`);
add('r4-hollow-open-around-overlap', 'r4-hollow-open', `const b = box(20, 20, 20, { at: [20, 0, 0] }); hollow(b, { wall: 2, open: "top" }); repeatAround(b, { count: 6 });`);
add('r4-hollow-open-cyl-repeat', 'r4-hollow-open', `const b = cylinder(20, 30); hollow(b, { wall: 2, open: "top" }); repeat(b, { count: 3, step: 40 });`);
// ---- round() and bevel() of a whole shape ---------------------------------------------------------------------------------------------------------
add('r4-round-box-repeat', 'r4-round', `const b = box(20, 20, 20); round(b, 3); repeat(b, { count: 3, step: 30 });`, 'rounded box, copies apart');
add('r4-round-box-repeat-overlap', 'r4-round', `const b = box(20, 20, 20); round(b, 3); repeat(b, { count: 3, step: 12 });`, 'rounded box, copies overlap');
add('r4-round-box-mirror', 'r4-round', `const b = box(20, 20, 20, { at: [30, 0, 0] }); round(b, 3); mirror(b, 'left-right');`);
add('r4-round-box-mirror-tb', 'r4-round', `const b = box(20, 20, 20, { at: [0, 0, 30] }); round(b, 3); mirror(b, 'top-bottom');`);
add('r4-round-box-around', 'r4-round', `const b = box(20, 20, 20, { at: [40, 0, 0] }); round(b, 3); repeatAround(b, { count: 5 });`);
add('r4-round-cyl-repeat', 'r4-round', `const b = cylinder(20, 20); round(b, 3); repeat(b, { count: 3, step: 30 });`);
add('r4-round-cyl-mirror', 'r4-round', `const b = cylinder(20, 20, { at: [0, 0, 30] }); round(b, 3); mirror(b, 'top-bottom');`);
add('r4-round-cyl-around', 'r4-round', `const b = cylinder(20, 20, { at: [40, 0, 0] }); round(b, 3); repeatAround(b, { count: 4 });`);
add('r4-round-alone-box', 'r4-round', `const b = box(20, 20, 20); round(b, 3);`, 'no pattern: the rounded box on its own');
add('r4-bevel-repeat', 'r4-round', `const b = box(20, 20, 20); bevel(b, 2); repeat(b, { count: 3, step: 30 });`);
add('r4-bevel-mirror', 'r4-round', `const b = box(20, 20, 20, { at: [30, 0, 0] }); bevel(b, 2); mirror(b, 'left-right');`);
add('r4-bevel-alone', 'r4-round', `const b = box(20, 20, 20); bevel(b, 2);`);
export const CASES4 = out;
