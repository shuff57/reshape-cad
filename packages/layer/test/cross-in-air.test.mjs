// G-CROSS narrowed for an extruded outline (pilot 2026-11, F1; docs/spikes/solidcraft-referee/pilot-2026-11/PILOT.md). Two drills in different directions
// whose lines meet only in the empty corner of an L bracket are let through; everything else stays refused. No kernel here: the geometry of the rule only.
// The kernel check is the seeded family cx61 (pilot-2026-11/followup), run through the host route with the guard on.
import test from 'node:test';
import assert from 'node:assert/strict';
const { rectMeetsPolygon, crossInAir } = await import(new URL('../dist/holes.js', import.meta.url).href);
const contract = await import(new URL('../../../docs/spikes/solidcraft-referee/contract/holes4-translate.mjs', import.meta.url).href);

const L = [[0, 0], [60, 0], [60, 10], [10, 10], [10, 40], [0, 40]];
test('a rectangle against an L outline: inside, across an edge, touching, in the empty corner, around the whole outline', () => {
  assert.equal(rectMeetsPolygon(2, 4, 2, 4, L), true);        // wholly inside the base
  assert.equal(rectMeetsPolygon(8, 12, 20, 22, L), true);     // across the upright's inner edge
  assert.equal(rectMeetsPolygon(10, 14, 20, 22, L), true);    // touching the upright's inner edge
  assert.equal(rectMeetsPolygon(30, 34, 20, 24, L), false);   // in the empty corner
  assert.equal(rectMeetsPolygon(70, 80, 0, 5, L), false);     // beside the part
  assert.equal(rectMeetsPolygon(-5, 65, -5, 45, L), true);    // the outline inside the rectangle
});

// the pilot's bracket: pulled 30 along z, hole A along y through the base at x = 40, hole B along x through the upright at y = 25, both at z = 15
const doc = (sk, pull = {}) => ({ byId: { sk1: { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: L, ...sk }, pull1: { id: 'pull1', kind: 'extrude', target: 'sk1', height: 30, ...pull },
  hole1: { id: 'hole1', kind: 'hole', target: 'pull1', axis: 'y' } } });
const m = { bbox: [0, 0, 0, 60, 40, 30] };
const A = (x) => ({ a: 1, c: [x, 20, 15], r: 2.5, L: 21 }); const B = (y) => ({ a: 0, c: [30, y, 15], r: 2.5, L: 31 });
const f = { id: 'hole2', kind: 'hole', target: 'hole1', axis: 'x' };
for (const [name, fn] of [['layer', crossInAir], ['contract copy', contract.crossInAir]]) {
  test(`${name}: the drills of a hole in each leg meet in the empty corner: in air`, () => {
    assert.equal(fn(A(40), B(25), f, doc(), m), true);
  });
  test(`${name}: the same drills meeting inside the upright, at its inner edge, or within the margin of it: not in air`, () => {
    assert.equal(fn(A(5), B(25), f, doc(), m), false);        // both through the upright
    assert.equal(fn(A(12.5), B(25), f, doc(), m), false);     // A's edge on the upright's inner face (x = 10)
    assert.equal(fn(A(12.505), B(25), f, doc(), m), false);   // 0.005 clear: inside the 0.01 margin
    assert.equal(fn(A(12.52), B(25), f, doc(), m), true);     // 0.02 clear
    assert.equal(fn(A(40), B(12.5), f, doc(), m), false);     // B's edge on the base's top face (y = 10)
  });
  test(`${name}: anything but a plain polygon pulled straight along z keeps the refusal`, () => {
    const air = (g, mm = m, a = A(40), b = B(25)) => fn(a, b, f, g, mm);
    assert.equal(air(doc({ plane: 'xz' })), false);
    assert.equal(air(doc({ frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } })), false);
    assert.equal(air(doc({ shape: 'circle' })), false);
    assert.equal(air(doc({ rounds: { 1: 2 } })), false);
    assert.equal(air(doc({ bulges: { 1: 0.2 } })), false);
    assert.equal(air(doc({ constraints: [{ kind: 'horizontal', edge: 0 }] })), false);
    assert.equal(air(doc({ rules: [{ k: 'length' }] })), false);
    assert.equal(air(doc({ geom: [{ k: 'line' }] })), false);
    assert.equal(air(doc({}, { taper: 5 })), false);
    assert.equal(air(doc({}, { direction: [0, 0.2, 1] })), false);
    assert.equal(air(doc({}, { midplane: true })), false);
    assert.equal(air(doc({}, { rotate: [0, 0, 30] })), false);
    assert.equal(air({ byId: { ...doc().byId, pull1: { id: 'pull1', kind: 'box' } } }), false);
    // the outline is not where the measured part is (moved, or built some other way)
    assert.equal(air(doc(), { bbox: [5, 0, 0, 65, 40, 30] }), false);
    // a drill along the pull: not this case
    assert.equal(fn({ a: 2, c: [40, 5, 15], r: 2.5, L: 16 }, B(25), f, doc(), m), false);
  });
}
