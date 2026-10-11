// A cut that sits ON its own mirror plane reflects onto itself: the mirrored copy is the cut again, so it is left out
// (FreeCAD gives the single cut). A cut that is merely near the plane, or off it, still overlaps or reflects as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const HEAD = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]);
const plate = extrude(s1, 10);
`;
const pockets = (r) => r.doc.features.filter((f) => f.kind === 'pocket').length;

test('a round pocket centred on the mirror plane builds as one pocket', () => {
  const r = runScript(HEAD + `const s2 = sketch('top', 10); s2.circle(6, { at: [20, 15] });
const p = pocket(s2, plate, 10);
mirror(p, 'left-right', { at: 20 });`);
  assert.deepEqual(r.errors, []);
  assert.equal(pockets(r), 1);
});

test('a polygon symmetric about the mirror plane builds as one pocket', () => {
  const r = runScript(HEAD + `const s2 = sketch('top', 10); s2.polygon([[20,5],[28,15],[20,25],[12,15]]);
const p = pocket(s2, plate, 10);
mirror(p, 'left-right', { at: 20 });`);
  assert.deepEqual(r.errors, []);
  assert.equal(pockets(r), 1);
});

test('a round pocket that only overlaps its reflection is still refused in a sentence', () => {
  const r = runScript(HEAD + `const s2 = sketch('top', 10); s2.circle(6, { at: [18, 15] });
const p = pocket(s2, plate, 10);
mirror(p, 'left-right', { at: 20 });`);
  assert.ok(r.errors.length > 0);
  assert.match(String(r.errors[0].message ?? r.errors[0]), /overlap each other/);
});
