// A picked rim is never shown HALF rounded. Rounding the four top edges of a pocket's opening needs a corner blend
// where two neighbouring rounds meet (two equal cylinders run into each other along an ellipse); brep-rs does not
// build one, and used to round two of the four edges and refuse the other two, so a student saw a part with the
// refused edges still sharp. Now an edge that meets a refused neighbour at a corner takes the whole pick with it,
// and the part is shown as it stood before the rounds.
//
// Oracles: the pocketed plate's own volume (40 x 30 x 10 - 10 x 10 x 4 = 11600), closed forms for the edges that do
// round ((1 - pi/4) r^2 per unit length), FreeCAD 26.3rc1 for the same parts (docs/replica/freecad/gauntlet):
//   four edges r=1: 11591.03244517401, 15 faces (FreeCAD builds the corners; brep-rs refuses, and shows 11600, 11 faces)
//   two opposite edges r=1: 11595.707963267949, 13 faces    one edge r=1: 11597.853981633974, 12 faces
//   two neighbouring edges: 11595.612092927622, 13 faces    three edges: 11593.370204220879, 14 faces (refused here)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine, assertWatertight, assertStep } from './s4i-harness.mjs';

const PI = Math.PI;
const wedge = (r, L) => (1 - PI / 4) * r * r * L;
const POCKETED = 40 * 30 * 10 - 10 * 10 * 4;
const SIDE = 10;

const script = (calls) => `
const s1 = sketch('top'); s1.rect(40, 30, { at: [20, 15] });
const plate = extrude(s1, 10);
const s2 = sketch('top', 10); s2.rect(10, 10, { at: [20, 15] });
const part = pocket(s2, plate, 4);
${calls}`;
const wall = (n, r = 1) => `round(part.edge('top', part.wall(s2, ${n})), ${r});`;

test('four rim edges: refused whole, the pocketed plate is shown, not a half rounded one', () => {
  const m = mine(script('round(part.rim(s2), 1);'));
  assert.deepEqual(Object.keys(m.refusals).sort(), ['round1', 'round2', 'round3', 'round4']);
  for (const w of Object.values(m.refusals)) assert.match(w, /^brep-rs cannot round these neighbouring edges together yet: .* -- round\d is shown without it\.$/);
  assert.ok(Math.abs(m.volume - POCKETED) <= 1e-9 * POCKETED, `volume ${m.volume}`);
  assert.equal(m.faces, 11);
  assertWatertight(m);
  assertStep(m);
});

test('four rim edges at another radius, pocket and place: still refused whole', () => {
  const m = mine(`
const s1 = sketch('top'); s1.rect(50, 40, { at: [25, 20] });
const plate = extrude(s1, 12);
const s2 = sketch('top', 12); s2.rect(16, 12, { at: [18, 14] });
const part = pocket(s2, plate, 5);
round(part.rim(s2), 2);`);
  assert.equal(Object.keys(m.refusals).length, 4);
  const v = 50 * 40 * 12 - 16 * 12 * 5;
  assert.ok(Math.abs(m.volume - v) <= 1e-9 * v, `volume ${m.volume}`);
  assert.equal(m.faces, 11);
  assertWatertight(m);
});

test('two neighbouring edges and three edges meet at a corner too: refused whole', () => {
  for (const calls of [wall(1) + wall(2), wall(1) + wall(2) + wall(3), wall(4) + wall(1)]) {
    const m = mine(script(calls));
    assert.ok(Object.keys(m.refusals).length >= 2, calls);
    assert.ok(Math.abs(m.volume - POCKETED) <= 1e-9 * POCKETED, `${calls}: volume ${m.volume}`);
    assert.equal(m.faces, 11, calls);
  }
});

test('one edge, and two opposite edges (no shared corner): built, and equal to FreeCAD and the closed form', () => {
  const one = mine(script(wall(2)));
  assert.deepEqual(one.refusals, {});
  assert.ok(Math.abs(one.volume - (POCKETED - wedge(1, SIDE))) <= 1e-9 * POCKETED);
  assert.ok(Math.abs(one.volume - 11597.853981633974) <= 1e-6 * one.volume);
  assert.equal(one.faces, 12);
  const two = mine(script(wall(1) + wall(3)));
  assert.deepEqual(two.refusals, {});
  assert.ok(Math.abs(two.volume - (POCKETED - 2 * wedge(1, SIDE))) <= 1e-9 * POCKETED);
  assert.ok(Math.abs(two.volume - 11595.707963267949) <= 1e-6 * two.volume);
  assert.equal(two.faces, 13);
  for (const m of [one, two]) { assertWatertight(m); assertStep(m); }
});

// The same corner for a chamfer. Taking the four rim chamfers one after the other removed their UNION at each
// inside corner (11576, 23 faces) where FreeCAD's mitre removes their intersection (11578.666666666666, 15 faces),
// a different solid with no refusal. FreeCAD: two opposite edges 11590, 13 faces; two neighbouring ones
// 11589.666666666668, 13 faces.
const bevelWall = (n, s = 1) => `bevel(part.edge('top', part.wall(s2, ${n})), ${s});`;

test('chamfer: four rim edges and two neighbouring ones are refused whole, never the union corner', () => {
  for (const calls of ['bevel(part.rim(s2), 1);', bevelWall(1) + bevelWall(2)]) {
    const m = mine(script(calls));
    assert.ok(Object.keys(m.refusals).length >= 2, calls);
    for (const w of Object.values(m.refusals)) assert.match(w, /^brep-rs cannot chamfer these neighbouring edges together yet: .* is shown without it\.$/);
    assert.ok(Math.abs(m.volume - POCKETED) <= 1e-9 * POCKETED, `${calls}: volume ${m.volume}`);
    assert.equal(m.faces, 11, calls);
  }
});

test('chamfer: one edge and two opposite edges build, equal to FreeCAD and the closed form', () => {
  const one = mine(script(bevelWall(2)));
  assert.deepEqual(one.refusals, {});
  assert.ok(Math.abs(one.volume - (POCKETED - 0.5 * SIDE)) <= 1e-9 * POCKETED);
  const two = mine(script(bevelWall(1) + bevelWall(3)));
  assert.deepEqual(two.refusals, {});
  assert.ok(Math.abs(two.volume - (POCKETED - SIDE)) <= 1e-9 * POCKETED);
  assert.ok(Math.abs(two.volume - 11590) <= 1e-6 * two.volume);
  assert.equal(two.faces, 13);
  for (const m of [one, two]) { assertWatertight(m); assertStep(m); }
});
