// hole(..., { from: 'bottom' }) (owner decision 2026-11-20, plan B): the hole is drilled from the face at the LOW end of its axis. Its mouth's offset along the
// axis is the same as a top hole's with the sign turned, the field survives toScript and a depth change, and any other value of from stops the script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { withHoleDepth } from '../dist/model-types.js';

const holeOf = (s) => { const r = runScript(s); assert.deepEqual(r.errors, []); return { doc: r.doc, h: r.doc.features.find((f) => f.kind === 'hole') }; };

test('a blind hole from the bottom sits flush with the low face: the top hole\'s offset, turned', () => {
  const top = holeOf(`const b = box(40, 30, 20);\nhole(b, { across: 6, deep: 8 });`).h;
  const { h } = holeOf(`const b = box(40, 30, 20);\nhole(b, { across: 6, deep: 8, from: 'bottom' });`);
  assert.deepEqual(top.center, [0, 0, 6]); assert.equal(top.from, undefined);
  assert.deepEqual(h.center, [0, 0, -6]); assert.equal(h.from, 'bottom');
  assert.deepEqual(holeOf(`const b = box(40, 30, 20);\nhole(b, { across: 6, deep: 10, along: 'x', from: 'bottom' });`).h.center, [-15, 0, 0], 'along x');
  assert.deepEqual(holeOf(`const b = box(40, 30, 20);\nholes(b, { across: 4, deep: 5, apart: [20, 10], from: 'bottom' });`).h.center, [0, 0, -7.5], 'holes() too');
  assert.deepEqual(holeOf(`const b = box(40, 30, 20);\nhole(b, { across: 6, from: 'bottom' });`).h.center, [0, 0, 0], 'a through hole: centred either way');
});
test('toScript writes from: \'bottom\' back, and a depth change keeps the side', () => {
  const { doc, h } = holeOf(`const b = box(40, 30, 20);\nhole(b, { across: 6, deep: 8, from: 'bottom' });`);
  const src = toScript(doc); assert.match(src, /hole\(box1, \{ across: 6, deep: 8, from: 'bottom' \}\)/);
  const again = runScript(src).doc.features.find((f) => f.kind === 'hole'); assert.deepEqual([again.center, again.from], [h.center, 'bottom']);
  assert.deepEqual(withHoleDepth(doc, h, 12).center, [0, 0, -4]);
  assert.equal(toScript(holeOf(`const b = box(40, 30, 20);\nhole(b, { across: 6, deep: 8 });`).doc).includes('from:'), false, 'a top hole is written as before');
});
test('any other from stops the script in a sentence', () => {
  const r = runScript(`const b = box(40, 30, 20);\nhole(b, { across: 6, from: 'top' });`);
  assert.match(r.errors[0].message, /hole's from is 'bottom', to drill from the low end of its axis; leave it out to drill from the top\. You gave it the text "top"\./);
});
