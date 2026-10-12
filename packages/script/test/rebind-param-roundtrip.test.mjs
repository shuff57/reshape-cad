// Re-pointing a field from one named parameter to another (the property view's "=plate_t" on a Length that
// followed "wall"). The script layer's half: the regenerated script must carry the NEW binding, must not
// rewrite the parameter the field now follows, and must read back to the same document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { applyParam, generatedParams } from '../dist/model-codegen.js';

const SRC = [
  "const wall = param('wall', 5)",
  "const plate_t = param('plate_t', 9)",
  "const s = sketch('top')",
  's.rect(40, 30)',
  'pull(s, wall)',
  "const s2 = sketch(plane('top', 20))",
  's2.rect(10, 10)',
  'pull(s2, plate_t)',
].join('\n');

const heightSlot = (r, id) => generatedParams(r.doc).find((p) => p.name.startsWith(`${id}_`) && /height|depth/.test(p.name));

test('rebinding a pad length from wall to plate_t keeps both values and round-trips', () => {
  const r = runScript(SRC);
  assert.equal(r.errors?.length ?? 0, 0);
  const wall = r.namedParams.find((p) => p.name === 'wall');
  const plate = r.namedParams.find((p) => p.name === 'plate_t');
  assert.equal(wall.slots.length, 1);
  assert.equal(plate.slots.length, 1);
  const slot = wall.slots[0];
  // The studio's bind: the slot leaves wall and joins plate_t; nothing else changes.
  const plateValue = plate.value;
  const rebound = r.namedParams
    .map((p) => ({ ...p, slots: p.slots.filter((x) => x !== slot) }))
    .map((p) => (p.name === 'plate_t' ? { ...p, slots: [...p.slots, slot] } : p));
  // The field now holds plate_t's value.
  const doc = applyParam(r.doc, slot, plateValue);
  const text = toScript(doc, rebound);
  assert.match(text, /const pull1 = extrude\(sk1, plate_t\)/);
  assert.doesNotMatch(text, /param\('wall'/, 'wall has no field left, so it is not declared dead');
  const again = runScript(text);
  assert.equal(again.errors?.length ?? 0, 0);
  const plate2 = again.namedParams.find((p) => p.name === 'plate_t');
  assert.equal(plate2.value, plateValue, 'plate_t was not rewritten');
  assert.equal(plate2.slots.length, 2, 'both pads follow plate_t');
  assert.equal(heightSlot(again, 'pull1')?.value, plateValue);
});

test('a stale parameter value never beats the document: the declared value is the live slot value', () => {
  const r = runScript(SRC);
  const plate = r.namedParams.find((p) => p.name === 'plate_t');
  // A slider drag edits the document and leaves namedParams[i].value alone.
  const dragged = applyParam(r.doc, plate.slots[0], 15);
  const text = toScript(dragged, r.namedParams);
  assert.match(text, /param\('plate_t', 15\b/);
  assert.equal(plate.value, 9, 'the namedParams copy is the stale one');
});
