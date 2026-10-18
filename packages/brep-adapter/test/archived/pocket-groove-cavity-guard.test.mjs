// A pocket or groove whose tool lies wholly inside the part must REFUSE (sealed
// cavity), never build a closed inner shell. Hand-built docs on the real wasm;
// the same shapes moved onto a face build with closed-form volumes AND pinned
// face/edge counts. Companion of hole-cavity-guard.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const box = { id: 'b1', kind: 'box', size: [40, 40, 20] }; // x,y +-20, z +-10
const rect = (plane, [u0, v0], [u1, v1]) => ({ id: 's1', kind: 'sketch', plane, offset: 0, points: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] });
const pocketDoc = (plane, offset, depth = 5) => [box, { ...rect(plane, [-5, -4], [5, 4]), offset }, { id: 'p1', kind: 'pocket', target: 's1', into: 'b1', depth }];
const grooveDoc = (plane, [r0, v0], [r1, v1], angle = 360) => [box, rect(plane, [r0, v0], [r1, v1]), { id: 'g1', kind: 'groove', target: 's1', into: 'b1', angle }];
function run(features, id) {
  const doc = JSON.stringify({ version: 1, features, measure: id });
  const refusals = JSON.parse(brep.build_doc_json(doc)).refusals ?? {};
  const m = JSON.parse(brep.measure_doc(doc));
  assert.equal(m.errors === undefined || m.errors.length === 0, true, JSON.stringify(m.errors));
  return { refusals, s: m.shapes?.[id] };
}
const sealed = (kind, id) => new RegExp(`^${kind} ${id} would leave a sealed cavity inside the part instead of opening onto a face -- ${id} is shown without it\\.$`);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

// ---- pockets ---------------------------------------------------------------
// A pocket sweeps DOWN from its sketch (xy: -z; xz: +y). 10x8 rect, depth 5.
for (const [plane, offset] of [['xy', 0], ['xy', 5], ['xy', -4], ['xz', 0], ['xz', 5], ['xz', 10], ['xz', -10], ['yz', 0]]) {
  test(`pocket on ${plane} at offset ${offset} stays inside the box: refuses, no solid`, () => {
    const { refusals, s } = run(pocketDoc(plane, offset), 'p1');
    assert.match(refusals.p1, sealed('pocket', 'p1'));
    assert.equal(s, undefined);
  });
}
test('pocket from the top face (xy, z=10) builds: 40*40*20 - 10*8*5, 11 faces', () => {
  const { refusals, s } = run(pocketDoc('xy', 10), 'p1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - 400);
  assert.equal(s.faces, 11); // 6 box + 4 walls + floor
  assert.equal(s.edges, 24);
});
test('pocket from the bottom face (xy, z=-5 down to -10) builds, 11 faces', () => {
  const { refusals, s } = run(pocketDoc('xy', -5), 'p1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - 400);
  assert.equal(s.faces, 11);
});
test('pocket from the y=+20 face (xz, offset 15, sweeps +y to the face) builds, 11 faces', () => {
  const { refusals, s } = run(pocketDoc('xz', 15), 'p1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - 400);
  assert.equal(s.faces, 11);
});

// ---- grooves ---------------------------------------------------------------
// The groove tool spins about the axis normal to the sketch plane (xz: world y).
for (const [name, doc] of [
  ['ring r3..6 y2..10 (the old docs example shape)', grooveDoc('xz', [3, 2], [6, 10])],
  ['ring r4..8 y5..12', grooveDoc('xz', [4, 5], [8, 12])],
  ['ring r3..6 y-4..4 (straddles the mid-plane only)', grooveDoc('xz', [3, -4], [6, 4])],
  ['half ring r4..8 y5..12', grooveDoc('xz', [4, 5], [8, 12], 180)],
  ['disc r0..6 y2..10', grooveDoc('xz', [0, 2], [6, 10])],
]) {
  test(`groove ${name} never reaches a face: refuses, no solid`, () => {
    const { refusals, s } = run(doc, 'g1');
    assert.match(refusals.g1, sealed('groove', 'g1'));
    assert.equal(s, undefined);
  });
}
test('groove disc r8 over y15..22 crosses the y=20 face and builds: 32000 - pi*64*5, 8 faces, 16 edges', () => {
  const { refusals, s } = run(grooveDoc('xz', [0, 15], [8, 22]), 'g1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - Math.PI * 64 * 5);
  assert.equal(s.faces, 8); // 5 untouched box faces + the pierced face + wall + floor
  assert.equal(s.edges, 16);
});
test('groove disc r6 flush on the z=10 face (xy plane, y2..10 up to the face) builds: 32000 - pi*36*8', () => {
  const { refusals, s } = run(grooveDoc('xy', [0, 2], [6, 10]), 'g1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - Math.PI * 36 * 8);
  assert.equal(s.faces, 8);
  assert.equal(s.edges, 16);
});

// An ANNULAR (r0 > 0) groove that reaches a face used to be refused; the planar
// split-and-classify boolean builds it, exactly pi x (8^2 - 4^2) x 5 less than the box.
test('open groove ring r4..8 flush/crossing y15..22 builds: 32000 - pi*48*5', () => {
  const { refusals, s } = run(grooveDoc('xz', [4, 15], [8, 22]), 'g1');
  assert.deepEqual(refusals, {});
  near(s.volume, 32000 - Math.PI * 48 * 5);
});
