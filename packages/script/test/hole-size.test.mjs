// W-4: hole()/holes() `size:` is interpret-time sugar for `across` (ISO 273
// medium-fit CLEARANCE diameters, not tap drills). The name is never persisted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const BOX = 'const b = box(40, 40, 20)\n';
const holeOf = (r) => r.doc.features.find((f) => f.kind === 'hole' || f.kind === 'holeCorners' || f.kind === 'holes');
const TABLE = { M3: 3.4, M4: 4.5, M5: 5.5, M6: 6.6, M8: 9, M10: 11, M12: 13.5 };

for (const [name, d] of Object.entries(TABLE)) {
  test(`hole size ${name} resolves to diameter ${d}`, () => {
    const r = runScript(`${BOX}hole(b, { size: '${name}' })`);
    assert.deepEqual(r.errors, []);
    assert.equal(holeOf(r).diameter, d);
    assert.equal(holeOf(r).size, undefined, 'the name is not persisted');
  });
}

test('size is case-insensitive', () => {
  const r = runScript(`${BOX}hole(b, { size: 'm6' })`);
  assert.deepEqual(r.errors, []);
  assert.equal(holeOf(r).diameter, 6.6);
});

test('holes() accepts size too', () => {
  const r = runScript(`${BOX}holes(b, { size: 'M4', apart: [20, 20] })`);
  assert.deepEqual(r.errors, []);
  assert.equal(holeOf(r).diameter, 4.5);
});

test('size works with counterbore and countersink like across does', () => {
  const cb = runScript(`${BOX}hole(b, { size: 'M6', counterbore: { across: 11, deep: 6 } })`);
  assert.deepEqual(cb.errors, []);
  assert.deepEqual([holeOf(cb).diameter, holeOf(cb).counterbore], [6.6, { diameter: 11, depth: 6 }]);
  const cs = runScript(`${BOX}hole(b, { size: 'M5', countersink: { across: 11, angle: 90 } })`);
  assert.deepEqual(cs.errors, []);
  assert.equal(holeOf(cs).diameter, 5.5);
  assert.equal(holeOf(cs).countersink.diameter, 11);
});

test('size and across together is a plain error', () => {
  const r = runScript(`${BOX}hole(b, { size: 'M6', across: 6 })`);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /OR/);
  assert.match(r.errors[0].message, /not both/);
});

test('unknown size lists the valid names', () => {
  for (const bad of ["'M7'", "'banana'", '6', 'null']) {
    const r = runScript(`${BOX}hole(b, { size: ${bad} })`);
    assert.equal(r.errors.length, 1, bad);
    assert.match(r.errors[0].message, /M3, M4, M5, M6, M8, M10, M12/);
  }
});

test('toScript round-trips to the resolved across, never the word size', () => {
  const r = runScript(`${BOX}hole(b, { size: 'M6' })`);
  const text = toScript(r.doc);
  assert.match(text, /across: 6\.6/);
  assert.doesNotMatch(text, /size/);
  const r2 = runScript(text);
  assert.deepEqual(r2.errors, []);
  assert.equal(holeOf(r2).diameter, 6.6);
  assert.equal(toScript(r2.doc), text, 'fixpoint');
});
