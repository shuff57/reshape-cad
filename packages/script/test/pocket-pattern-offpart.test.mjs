// A pattern copy that lies wholly clear of the part cuts nothing (FreeCAD leaves it out), so it is dropped; a copy that
// reaches the part's edge is still refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const src = (x, count) => `const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,20],[0,20]]); const plate = extrude(s1, 10);
const p1 = sketch('top', 10); p1.circle(6, { at: [${x}, 10] }); const pk = pocket(p1, plate, 12);
linearPattern(pk, { count: ${count}, step: 20 });`;
const pockets = (r) => r.doc.features.filter((f) => f.kind === 'pocket').length;

test('copies wholly off the plate are dropped', () => {
  for (const count of [3, 4, 5, 6]) {
    const r = runScript(src(10, count));
    assert.deepEqual(r.errors, [], `count ${count}`);
    assert.equal(pockets(r), 3, `count ${count}`);
  }
});

test('a copy that reaches the edge is still refused', () => {
  const r = runScript(src(18, 3)); // copies at 18, 38, 58: the last (radius 3) crosses x=60
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /reaches the edge/);
});
