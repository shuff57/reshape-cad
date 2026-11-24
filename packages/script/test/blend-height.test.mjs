// blend(a, b, gap) moves the second sketch to the first's height + gap. A second sketch the student placed at a height of its own that the gap contradicts
// used to be moved silently (the blend-loft guard's 'datum' case, docs/spikes/solidcraft-referee/contract/blend-loft.guard.mjs). The layer sees only the
// moved sketch, so the script names it. A sketch on the default height, one the gap agrees with, and the toScript round trip are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const two = (hb) => `const a = sketch('top', 10); a.rect(40, 40); const b = sketch('top'${hb === undefined ? '' : `, ${hb}`}); b.rect(20, 20);`;
const offsetOf = (r, id) => r.doc.features.find((f) => f.id === id)?.offset;

test('a second sketch on the default height is moved to the first sketch + the gap', () => {
  const r = runScript(`${two()} blend(a, b, 30);`);
  assert.deepEqual(r.errors, []);
  assert.equal(offsetOf(r, 'sk2'), 40);
});

test('a second sketch already at the height the gap gives is kept', () => {
  const r = runScript(`${two(40)} blend(a, b, 30);`);
  assert.deepEqual(r.errors, []);
  assert.equal(offsetOf(r, 'sk2'), 40);
});

test('a second sketch placed at a height the gap contradicts is refused in a plain sentence', () => {
  const r = runScript(`${two(20)} blend(a, b, 30);`);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].message ?? String(r.errors[0]), "The second sketch was placed at height 20, but the loft's gap puts it at 40, so make the two agree by changing the gap or the height the sketch was drawn at.");
  const l = runScript(`${two(20)} loft(a, b, 30);`);
  assert.equal(l.errors.length, 1);
});

test('the code a loft round-trips to runs without an error and keeps the heights', () => {
  const r = runScript(`${two()} const l = blend(a, b, 30);`);
  const again = runScript(toScript(r.doc));
  assert.deepEqual(again.errors, []);
  assert.equal(offsetOf(again, 'sk2'), 40);
  assert.equal(offsetOf(again, 'sk1'), 10);
});
