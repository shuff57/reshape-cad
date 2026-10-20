// Round-6 cases of the patterns-mirror group (critic round 3 findings). Each: { id, row, src, note? }.
//   r6-web-*   a thin WALL of material between two flat-sided cuts (or a cut and the side of the part): the kernel drops it with no error when it is about 0.26% of the
//              part's bounding-box diagonal or less (see pm-web-probe.mjs for the threshold table); the 'web' guard refuses up to 1% of the diagonal. The OCCT oracle is
//              the second measure here (an independent kernel: it keeps every wall).
//   r6-gap-*   curved copies a hair apart (1e-3 .. 0.1 mm; the 1e-4 sphere pair exceeds the memory cap in the OCCT oracle build, it is covered truck-alone by pm-gap-probe.mjs): refused with a sentence that says so, no longer "meet only along an edge or at a point"
//   r6-pf-*    repeatAround with an angle the source-level front door (pm-preflight.mjs) refuses: 720, -360, an angle held in a variable
const PL = `const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,40],[0,40]]); const plate = extrude(s1, 10); const p1 = sketch('top', 10);`;
const out = [];
const add = (id, row, src, note) => out.push({ id, row, src, note });
for (const web of [0.05, 0.15, 0.2, 0.5, 0.7, 1]) {
  add(`r6-web-repeat-${web}`, 'web', `${PL} p1.rect(10, 6, { at: [15, 20] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [${10 + web}, 0, 0] });`, `repeat(pocket) leaving a ${web} mm wall`);
}
add('r6-web-repeat-count3-0.15', 'web', `${PL} p1.rect(10, 6, { at: [10, 20] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 3, step: [10.15, 0, 0] });`, 'three copies, 0.15 mm walls');
add('r6-web-mirror-0.05', 'web', `${PL} p1.rect(10, 6, { at: [15, 20] }); const pk = pocket(p1, plate, 4); mirror(pk, 'left-right', { at: 20.025 });`, 'mirror(pocket,{at}) leaving a 0.05 mm wall');
add('r6-web-mirror-0.15', 'web', `${PL} p1.rect(10, 6, { at: [15, 20] }); const pk = pocket(p1, plate, 4); mirror(pk, 'left-right', { at: 20.075 });`, 'mirror(pocket,{at}) leaving a 0.15 mm wall');
add('r6-web-mirror-1', 'web', `${PL} p1.rect(10, 6, { at: [15, 20] }); const pk = pocket(p1, plate, 4); mirror(pk, 'left-right', { at: 20.5 });`, 'mirror(pocket,{at}) leaving a 1 mm wall (built)');
add('r6-web-hand-mixed-0.15', 'web', `${PL} p1.rect(10, 6, { at: [15, 20] }); const a = pocket(p1, plate, 4); const p2 = sketch('top', 10); p2.rect(4, 3, { at: [22.15, 20] }); pocket(p2, a, 4);`, 'a second pocket of another size, 0.15 mm wall');
add('r6-web-hand-depth-0.15', 'web', `${PL} p1.rect(10, 6, { at: [15, 20] }); const a = pocket(p1, plate, 4); const p2 = sketch('top', 10); p2.rect(10, 6, { at: [25.15, 20] }); pocket(p2, a, 2);`, 'a second pocket of another depth, 0.15 mm wall');
add('r6-web-two-axis-0.05', 'web', `${PL} p1.rect(10, 6, { at: [15, 10] }); const pk = pocket(p1, plate, 4); const r1 = repeat(pk, { count: 2, step: [10.05, 0, 0] }); repeat(r1, { count: 2, step: [0, 6.05, 0] });`, 'copies along two axes');
add('r6-web-diagonal-0.05', 'web', `${PL} p1.rect(10, 6, { at: [20, 15] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [10.05, 6.05, 0] });`, 'diagonal step, the copies meet corner to corner (not lost by the kernel, refused anyway)');
add('r6-web-triangle-0.05', 'web', `${PL} p1.polygon([[10,10],[20,10],[10,20]]); const a = pocket(p1, plate, 4); const p2 = sketch('top', 10); p2.polygon([[20.0707,10.0707],[20.0707,20.0707],[10.0707,20.0707]]); pocket(p2, a, 4);`, 'triangles with parallel slanted walls 0.1 mm apart');
add('r6-web-edge-0.15', 'web', `${PL} p1.rect(10, 6, { at: [5.15, 20] }); pocket(p1, plate, 4);`, 'pocket 0.15 mm from the side of the part');
add('r6-web-edge-1', 'web', `${PL} p1.rect(10, 6, { at: [6, 20] }); pocket(p1, plate, 4);`, 'pocket 1 mm from the side of the part (built)');
add('r6-web-circle-0.05', 'web', `${PL} p1.circle(8, { at: [15, 20] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [8.05, 0, 0] });`, 'circle pockets 0.05 mm apart (the kernel keeps this wall: built)');
add('r6-web-hole-0.05', 'web', `const b = box(60, 40, 10); const h = hole(b, { across: 6, deep: 10, at: [-3, 0] }); repeat(h, { count: 2, step: [6.05, 0, 0] });`, 'holes 0.05 mm apart (built)');
add('r6-web-floor-0.05', 'web', `${PL} p1.rect(10, 6, { at: [30, 20] }); pocket(p1, plate, 9.95);`, 'a pocket leaving a 0.05 mm floor (the kernel keeps it: built)');
for (const [id, shape, gap] of [['sph-1e-3', 'sphere(10)', 1e-3], ['sph-0.01', 'sphere(10)', 0.01], ['sph-0.1', 'sphere(10)', 0.1], ['cyl-1e-4', 'cylinder(10, 10)', 1e-4], ['cyl-1e-3', 'cylinder(10, 10)', 1e-3], ['cyl-0.01', 'cylinder(10, 10)', 0.01], ['cyl-0.1', 'cylinder(10, 10)', 0.1]]) {
  add(`r6-gap-${id}`, 'gap', `const a = ${shape}; repeat(a, { count: 2, step: [${+(10 + gap).toPrecision(8)}, 0, 0] });`, `two ${id.slice(0, 3) === 'sph' ? 'spheres' : 'cylinders'} ${gap} mm apart`);
}
const AR = `const plate = cylinder(60, 10); const p1 = sketch('top', 5); p1.circle(6, { at: [20, 0] }); const pk = pocket(p1, plate, 12);`;
add('r6-pf-angle-720', 'preflight', `${AR} repeatAround(pk, { count: 4, axis: 'z', angle: 720 });`, 'angle 720 on a pocket');
add('r6-pf-angle-neg360', 'preflight', `${AR} repeatAround(pk, { count: 4, axis: 'z', angle: -360 });`, 'angle -360 on a pocket');
add('r6-pf-angle-var', 'preflight', `const turn = 720; ${AR} repeatAround(pk, { count: 4, axis: 'z', angle: turn });`, 'angle held in a variable');
add('r6-pf-angle-360-ok', 'preflight', `${AR} repeatAround(pk, { count: 4, axis: 'z', angle: 360 });`, 'angle 360 (a full turn, built)');
add('r6-pf-alias-720', 'preflight', `${AR} polarPattern(pk, { count: 4, axis: 'z', angle: 720 });`, 'alias polarPattern, angle 720');
export const CASES6 = out;
