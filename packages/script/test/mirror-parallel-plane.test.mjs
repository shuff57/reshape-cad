// mirror(pocket, 'top-bottom', { at }) -- a plane PARALLEL to the face the pocket sits on. FreeCAD's Mirrored does this: the
// pocket is cut from the opposite side of the part. The kernel half (volume, box, centroid, against closed forms and the
// same cut written by hand) is packages/brep-adapter/test/mirror-parallel-plane.test.mjs; this is the script half: what
// the copy is made of, which of these are refused in a sentence, and that the saved script reads back to the same document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const HEAD = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]);
const plate = extrude(s1, 10);
`;
const POCKET = (depth = 3, opts = '') => HEAD + `const s2 = sketch('top', 10); s2.circle(6, { at: [10, 15] });
const p = pocket(s2, plate, ${depth}${opts});
`;
const pockets = (r) => r.doc.features.filter((f) => f.kind === 'pocket');
const sketches = (r) => r.doc.features.filter((f) => f.kind === 'sketch');
const msg = (r) => String(r.errors[0]?.message ?? r.errors[0]);

test('a pocket mirrored through the middle plane is a second pocket on the plane z = 0, pushed the other way', () => {
  const r = runScript(POCKET() + `mirror(p, 'top-bottom', { at: 5 });`);
  assert.deepEqual(r.errors, []);
  assert.ok(!r.doc.features.some((f) => f.kind === 'mirror'));
  assert.equal(pockets(r).length, 2);
  const [a, b] = sketches(r).slice(1);
  assert.equal(a.offset, 10);
  assert.equal(b.offset, 0);
  assert.deepEqual(b.points, a.points);
  const [p0, p1] = pockets(r);
  assert.equal(p1.depth, p0.depth);
  assert.equal(p1.into, p0.id);
  assert.ok(!p0.reversed);
  assert.equal(p1.reversed, true, 'the copy sketch is the same named plane, so the push is flipped to go up into the plate');
});

test('the offset of the copy follows the plane: z = 2 * at - the original', () => {
  for (const at of [6, 4, 5.5]) {
    const r = runScript(POCKET() + `mirror(p, 'top-bottom', { at: ${at} });`);
    assert.deepEqual(r.errors, [], `at ${at}`);
    assert.equal(sketches(r)[2].offset, 2 * at - 10);
  }
});

test('a pocket sketched on the bottom and cut up mirrors onto the top and cuts down', () => {
  const r = runScript(HEAD + `const s2 = sketch('top', 0); s2.circle(6, { at: [10, 15] });
const p = pocket(s2, plate, 3, { reversed: true });
mirror(p, 'top-bottom', { at: 5 });`);
  assert.deepEqual(r.errors, []);
  const [p0, p1] = pockets(r);
  assert.equal(p0.reversed, true);
  assert.ok(!p1.reversed);
  assert.equal(sketches(r)[2].offset, 10);
});

test('a through pocket mirrored through the middle is the same hole: the copy is left out', () => {
  const r = runScript(POCKET(10, ', { through: true }') + `mirror(p, 'top-bottom', { at: 5 });`);
  assert.deepEqual(r.errors, []);
  assert.equal(pockets(r).length, 1);
});

for (const [name, src, re] of [
  ['a copy that lands above the part', POCKET() + `mirror(p, 'top-bottom', { at: 12 });`, /wholly off the part/],
  ['a copy that lands below the part', POCKET() + `mirror(p, 'top-bottom', { at: -3 });`, /wholly off the part/],
  ['a copy that overlaps the original along the part', POCKET(6) + `mirror(p, 'top-bottom', { at: 5 });`, /meets the original cut/],
  ['a copy whose floor meets the original floor', POCKET() + `mirror(p, 'top-bottom', { at: 7 });`, /meets the original cut/],
  ['a slanted pocket', POCKET(3, ', { direction: [1, 0, -1] }') + `mirror(p, 'top-bottom', { at: 5 });`, /slanted, tapered, symmetric or two-sided/],
  ['a symmetric pocket', POCKET(3, ', { midplane: true }') + `mirror(p, 'top-bottom', { at: 5 });`, /slanted, tapered, symmetric or two-sided/],
  ['a hole', HEAD + `const h = hole(plate, { across: 6, at: [-10, 0] });\nmirror(h, 'top-bottom', { at: 5 });`, /parallel to the face/],
]) {
  test(`${name} is refused in a sentence`, () => {
    const r = runScript(src);
    assert.equal(r.errors.length, 1);
    assert.match(msg(r), re);
  });
}

test('a mirror through a plane square to the sketch is unchanged (no push flip)', () => {
  const r = runScript(POCKET() + `mirror(p, 'left-right', { at: 20 });`);
  assert.deepEqual(r.errors, []);
  assert.ok(!pockets(r)[1].reversed);
});

test('the mirrored pocket saves and reopens to the same document', () => {
  const r = runScript(POCKET() + `mirror(p, 'top-bottom', { at: 6 });`);
  assert.deepEqual(r.errors, []);
  const text = toScript(r.doc);
  const again = runScript(text);
  assert.deepEqual(again.errors, []);
  const norm = (d) => JSON.parse(JSON.stringify(d.features));
  assert.deepEqual(norm(again.doc), norm(r.doc));
});
