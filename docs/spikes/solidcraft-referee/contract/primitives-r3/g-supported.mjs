// G1: one representative per SUPPORTED row, run through the GUARD (so a guard that over-refuses shows up as status guard-refused) and timed.
// Each id is repeated 3 times (-r1..-r3) so the time column is a median, not one sample. rows: the primitives.json feature it backs.
const D = (feat) => ({ version: 1, features: [{ id: 'x1', center: [0, 0, 0], ...feat }] });
const reps = [
  // [id, row, script|doc]
  ['box', 'box', 'box(40, 30, 12);'],
  ['cuboid', 'box', 'cuboid(40, 30, 12);'],
  ['box-at', 'box.at', 'box(40, 30, 12, { at: [15, -7, 3] });'],
  ['box-turn', 'box.rotate', 'turn(box(40, 30, 12, { at: [10, 20, 30] }), [20, 35, 50]);'],
  ['box-corner', 'box.corner', 'box(40, 30, 12, { corner: 3 });'],
  ['box-corner-nearX', 'box.corner', 'box(12, 20, 30, { corner: 5.998 });'],
  ['box-corner-nearY', 'box.corner', 'box(20, 12, 30, { corner: 5.998 });'],
  ['box-corner-nearZ', 'box.corner', 'box(20, 30, 12, { corner: 5.998 });'],
  ['cyl', 'cylinder', 'cylinder(24, 30);'],
  ['cyl-at', 'cylinder.at', 'cylinder(24, 30, { at: [5, 3, 2] });'],
  ['cyl-turn', 'cylinder.rotate', 'turn(cylinder(24, 30, { at: [10, 20, 30] }), [20, 35, 50]);'],
  ['cyl-corner', 'cylinder.corner', 'cylinder(24, 30, { corner: 3 });'],
  ['cyl-corner-nearR', 'cylinder.corner', 'cylinder(10, 30, { corner: 4.9 });'],
  ['cyl-corner-nearH', 'cylinder.corner', 'cylinder(48, 10, { corner: 4.99 });'],
  ['cyl-chamfer', 'cylinder.chamfer', D({ kind: 'cylinder', radius: 12, height: 30, round: 3, roundStyle: 'chamfer' })],
  ['cyl-chamfer-nearH', 'cylinder.chamfer', D({ kind: 'cylinder', radius: 24, height: 10, round: 4.99, roundStyle: 'chamfer' })],
  ['sph', 'sphere', 'sphere(20);'],
  ['sph-at', 'sphere.at', 'sphere(20, { at: [5, -3, 7] });'],
  ['sph-min', 'sphere', 'sphere(1);'],
  ['cone', 'cone', 'cone(20, 30);'],
  ['cone-at', 'cone.at', 'cone(20, 30, { at: [5, -3, 7] });'],
  ['cone-turn', 'cone.rotate', 'turn(cone(20, 30, { at: [10, 20, 30] }), [20, 35, 50]);'],
  ['cone-slender', 'cone', 'cone(5, 200);'],
  ['prism3', 'prism', 'prism(3, 30, 12);'],
  ['prism7', 'prism', 'prism(7, 30, 12);'],
  ['prism12', 'prism', 'prism(12, 30, 12);'],
  ['prism-at', 'prism.at', 'prism(5, 30, 12, { at: [5, -3, 7] });'],
  ['prism-docrot', 'prism.rotate', D({ kind: 'prism', sides: 5, radius: 15, height: 12, center: [5, -3, 7], rotate: [20, 35, 50] })],
  ['prism-far-ok', 'prism.far', 'prism(6, 2, 3, { at: [200, -200, 200] });'],
  ['wedge', 'wedge', 'wedge(40, 30, 12);'],
  ['wedge-at', 'wedge.at', 'wedge(40, 30, 12, { at: [5, -3, 7] });'],
  ['wedge-docrot', 'wedge.rotate', D({ kind: 'wedge', width: 40, depth: 30, height: 12, center: [5, -3, 7], rotate: [20, 35, 50] })],
  ['box-far-axis', 'box.far', 'box(2, 3, 4, { at: [1000000, -1000000, 1000000] });'],
  ['wedge-far-axis', 'wedge.far', 'wedge(2, 3, 4, { at: [1000000, -1000000, 1000000] });'],
  ['tbox-far-ok', 'box.far', 'turn(box(2, 3, 4, { at: [200, -200, 200] }), [20, 35, 50]);'],
  ['param-box', 'param', "box(param('w', 40), param('d', 30), param('h', 12), { at: [param('x', 5), 0, 0] });"],
  ['cyl-far-ok', 'cylinder.far', 'cylinder(20, 30, { at: [5000, -5000, 5000] });'],
  ['sph-far-ok', 'sphere.far', 'sphere(20, { at: [5000, -5000, 5000] });'],
  ['big-box', 'box', 'box(1000000, 1000000, 1000000);'],
  ['big-cyl', 'cylinder', 'cylinder(50000, 50000);'],
  ['big-sph', 'sphere', 'sphere(50000);'],
  ['big-cone', 'cone', 'cone(50000, 50000);'],
  ['tiny-box', 'box', 'box(0.001, 0.0015, 0.002);'],
];
export const RING = [
  ['ring', 'ring', 'ring(40, 10);'],
  ['torus', 'ring', 'torus(40, 10);'],
  ['ring-at', 'ring.at', 'ring(40, 10, { at: [5, -3, 7] });'],
  ['ring-turn', 'ring.rotate', 'turn(ring(40, 10, { at: [10, 20, 30] }), [20, 35, 50]);'],
];
const out = [];
for (const [id, row, src] of [...reps, ...RING]) for (const r of [1, 2, 3]) {
  const c = { id: `g1-${id}-r${r}`, row };
  if (typeof src === 'string') c.script = src; else c.doc = src;
  out.push(c);
}
export default out;
