// A rectangular pocket mirrored across a plane square to the part: the copies may overlap each other and the reflection may run
// out through ONE straight side of a rectangular part (one pocket open at that side; kernel and FreeCAD agree on volume, box and
// faces, see docs/replica/freecad/gauntlet/variants). Anything else about overlapping or off-part reflections stays refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const HEAD = `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10);\n`;
const rect = (w, h, at, depth, at2, word = 'left-right') =>
  HEAD + `const s2 = sketch('top', 10); s2.rect(${w}, ${h}, { at: [${at}] }); const p = pocket(s2, plate, ${depth}); mirror(p, '${word}', { at: ${at2} });`;

test('a reflection that overlaps and runs off one side is lowered to two pockets', () => {
  const r = runScript(rect(8, 8, '34, 15', 4, 36));
  assert.deepEqual(r.errors, []);
  assert.equal(r.doc.features.filter((f) => f.kind === 'pocket').length, 2);
});

test('an overlapping reflection that stays inside the part is lowered', () => {
  const r = runScript(rect(8, 8, '14, 15', 4, 16));
  assert.deepEqual(r.errors, []);
});

test('a reflection wholly off the part is still refused in a sentence', () => {
  const r = runScript(rect(4, 8, '36, 15', 4, 40));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /mirror\(\) of a pocket/);
});

test('a pocket flush with a second side of the part is still refused', () => {
  const r = runScript(rect(8, 8, '34, 4', 4, 36));
  assert.ok(r.errors.length >= 1);
});

test('a circle pocket whose reflection overlaps it is still refused', () => {
  const r = runScript(HEAD + `const s2 = sketch('top', 10); s2.circle(8, { at: [18, 15] }); const p = pocket(s2, plate, 4); mirror(p, 'left-right', { at: 20 });`);
  assert.equal(r.errors.length, 1);
});
