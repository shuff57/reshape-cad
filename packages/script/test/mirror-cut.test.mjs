// mirror(cut, word, { at }) lowers to a reflected copy of the CUT (a sketch + a pocket, or a hole, or a pad), never to the
// whole-solid mirror feature, which would reflect the plate and leave the other half's hole where it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const HEAD = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]);
const plate = extrude(s1, 10);
`;
const POCKET = HEAD + `const s2 = sketch('top', 10); s2.circle(6, { at: [10, 15] });
const p = pocket(s2, plate, 10);
`;
const kinds = (r) => r.doc.features.map((f) => f.kind);
const mid = (s) => { const [[x0, y0], [x1, y1]] = s.points; return [(x0 + x1) / 2, (y0 + y1) / 2]; };

test('mirror of a pocket across x = 20 adds a second pocket at the reflected place and no mirror feature', () => {
  const r = runScript(POCKET + `mirror(p, 'left-right', { at: 20 });`);
  assert.deepEqual(r.errors, []);
  assert.ok(!kinds(r).includes('mirror'));
  assert.equal(kinds(r).filter((k) => k === 'pocket').length, 2);
  const sk = r.doc.features.filter((f) => f.kind === 'sketch');
  assert.deepEqual(mid(sk[2]), [30, 15]);
  const pk = r.doc.features.filter((f) => f.kind === 'pocket');
  assert.equal(pk[1].into, pk[0].id);
});

test('a different plane (front-back at y = 15) reflects along y', () => {
  const r = runScript(HEAD + `const s2 = sketch('top', 10); s2.circle(6, { at: [20, 8] });
const p = pocket(s2, plate, 10);
mirror(p, 'front-back', { at: 15 });`);
  assert.deepEqual(r.errors, []);
  const sk = r.doc.features.filter((f) => f.kind === 'sketch');
  assert.deepEqual(mid(sk[2]), [20, 22]);
});

test('a pad mirrors into a second pad joined to the part', () => {
  const r = runScript(HEAD + `const s2 = sketch('top', 10); s2.polygon([[5,5],[12,5],[12,12],[5,12]]);
const pd = join(plate, pull(s2, 4));
mirror(pd, 'left-right', { at: 20 });`);
  assert.deepEqual(r.errors, []);
  assert.equal(kinds(r).filter((k) => k === 'combine').length, 2);
  const sk = r.doc.features.filter((f) => f.kind === 'sketch');
  assert.deepEqual(sk[2].points.map((q) => q[0]).sort((a, b) => a - b), [28, 28, 35, 35]);
});

test('a hole mirrors into a second hole', () => {
  const r = runScript(HEAD + `const h = hole(plate, { across: 6, at: [-10, 0] });
mirror(h, 'left-right', { at: 20 });`);
  assert.deepEqual(r.errors, []);
  const holes = r.doc.features.filter((f) => f.kind === 'hole');
  assert.equal(holes.length, 2);
  assert.equal(holes[1].target, holes[0].id);
  assert.equal(holes[1].center[0], 10);
  assert.equal(holes[0].center[0], -10);
});

for (const [name, src, re] of [
  ['a cut that meets its own reflection', POCKET.replace('[10, 15]', '[19, 15]') + `mirror(p, 'left-right', { at: 20 });`, /overlap each other/],
  ['a reflection that leaves the part', POCKET + `mirror(p, 'left-right', { at: 5 });`, /edge of the part/],
  ['a pad across a plane parallel to the face it sits on', HEAD + `const s2 = sketch('top', 10); s2.polygon([[5,5],[12,5],[12,12],[5,12]]);
const pd = join(plate, pull(s2, 4));
mirror(pd, 'top-bottom', { at: 5 });`, /parallel to the face/],
  ['a whole solid with { at }', HEAD + `mirror(plate, 'left-right', { at: 5 });`, /pocket, a hole or a pad/],
  ['an at that is not a number', POCKET + `mirror(p, 'left-right', { at: 'x' });`, /at/],
]) {
  test(`${name} is refused in a sentence`, () => {
    const r = runScript(src);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].message, re);
  });
}

test('mirror without { at } is unchanged: the whole-shape mirror feature', () => {
  const r = runScript(POCKET + `mirror(p, 'left-right');`);
  assert.deepEqual(r.errors, []);
  assert.ok(kinds(r).includes('mirror'));
});
