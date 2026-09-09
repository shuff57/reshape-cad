// Unit tests for P1f's exported constraint writers in
// src/model/SketchConstraints.tsx -- the four kinds the solver honours that
// the Rules panel never offered: distanceX, distanceY, symmetric, angle.
//
// The gate these back is NOT the grep tripwire in shCode's
// scripts/check-constraint-ui.mjs (it is satisfied by a string literal);
// these exercise the actual write decisions: normalisation, replacement,
// coexistence, signed values, exact removal, and purity. Importing from
// ../dist/ the same way packages/script/test/ resolves -- dist/ is what a
// studio import resolves to, so these tests exercise what ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPointRule, setSymmetric, setAngle, removeRule } from '../dist/model/SketchConstraints.js';

// 1. setPointRule normalises the pair: lower corner index in `a`, higher in
//    `b`, whichever way the student picked them.
test('setPointRule normalises a/b so the lower corner index comes first', () => {
  const out = setPointRule([], 'distanceX', 3, 1, 12);
  assert.deepEqual(out, [{ kind: 'distanceX', a: 1, b: 3, value: 12 }]);

  const outY = setPointRule([], 'distanceY', 5, 2, 4);
  assert.deepEqual(outY, [{ kind: 'distanceY', a: 2, b: 5, value: 4 }]);
});

// 2. One rule per (kind, pair): adding a distanceX to a pair that already
//    has one REPLACES it, second value wins, no stacking.
test('setPointRule replaces an existing rule of the same kind on the same pair', () => {
  const first = setPointRule([], 'distanceX', 1, 3, 12);
  const second = setPointRule(first, 'distanceX', 3, 1, 20);
  assert.equal(second.length, 1);
  assert.deepEqual(second, [{ kind: 'distanceX', a: 1, b: 3, value: 20 }]);
});

// 3. distanceX and distanceY on the same pair coexist -- they are different
//    kinds asking about different axes.
test('distanceX and distanceY on the same pair coexist', () => {
  const withX = setPointRule([], 'distanceX', 1, 3, 12);
  const withY = setPointRule(withX, 'distanceY', 3, 1, 5);
  assert.equal(withY.length, 2);
  assert.deepEqual(
    withY,
    [
      { kind: 'distanceX', a: 1, b: 3, value: 12 },
      { kind: 'distanceY', a: 1, b: 3, value: 5 },
    ]
  );
});

// 4. setSymmetric normalises a/b but leaves `center` exactly as given --
//    center is a distinct role, not a pair member, so it is NOT reordered,
//    including when it is lower than both endpoints.
test('setSymmetric normalises a/b and keeps center exactly as given, even below both', () => {
  const out = setSymmetric([], 3, 1, 0);
  assert.deepEqual(out, [{ kind: 'symmetric', a: 1, b: 3, center: 0 }]);

  const out2 = setSymmetric([], 2, 5, 7);
  assert.deepEqual(out2, [{ kind: 'symmetric', a: 2, b: 5, center: 7 }]);
});

// 5. setAngle normalises edge/other and keeps the degrees as typed.
test('setAngle normalises the edge pair and keeps degrees', () => {
  const out = setAngle([], 4, 2, 30);
  assert.deepEqual(out, [{ kind: 'angle', edge: 2, other: 4, degrees: 30 }]);
});

// 6. Signed values are real: a negative gap or turn is a distinct,
//    meaningful ask (the solver treats these as signed; no Math.abs, no
//    minus-sign rejection anywhere in the writers).
test('negative values survive all three numeric writers unchanged', () => {
  assert.deepEqual(setPointRule([], 'distanceX', 1, 3, -5),
    [{ kind: 'distanceX', a: 1, b: 3, value: -5 }]);
  assert.deepEqual(setPointRule([], 'distanceY', 3, 1, -5),
    [{ kind: 'distanceY', a: 1, b: 3, value: -5 }]);
  assert.deepEqual(setAngle([], 2, 4, -30),
    [{ kind: 'angle', edge: 2, other: 4, degrees: -30 }]);
});

// 7. removeRule removes exactly the named rule and nothing else -- matched
//    on the rule's own fields, not object identity, and never on the pair
//    alone: a rule of another kind sharing the pair survives.
test('removeRule removes exactly the named rule, not its pair-mates', () => {
  const cs = [
    { kind: 'length', edge: 0, value: 10 },
    { kind: 'distanceX', a: 1, b: 3, value: 12 },
    { kind: 'distanceY', a: 1, b: 3, value: 5 },
    { kind: 'lock', corner: 2 },
  ];
  const out = removeRule(cs, cs[1]);
  assert.deepEqual(out, [
    { kind: 'length', edge: 0, value: 10 },
    { kind: 'distanceY', a: 1, b: 3, value: 5 },
    { kind: 'lock', corner: 2 },
  ]);

  // Same verdict when the rule arrives rebuilt (different object, same
  // fields, field order shuffled -- settle() rebuilds arrays, so a removal
  // has to survive that).
  const rebuilt = { kind: 'distanceX', b: 3, a: 1, value: 12 };
  assert.deepEqual(removeRule(cs, rebuilt), [
    { kind: 'length', edge: 0, value: 10 },
    { kind: 'distanceY', a: 1, b: 3, value: 5 },
    { kind: 'lock', corner: 2 },
  ]);
});

// 8. None of the writers mutates the array it was given -- every caller
//    passes the live `constraints` prop, and a writer that mutated it
//    corrupts React state in a way that shows up much later as a rule that
//    will not clear.
test('no writer mutates the array it was given', () => {
  const original = [
    { kind: 'distanceX', a: 1, b: 3, value: 12 },
    { kind: 'lock', corner: 2 },
  ];
  const snapshot = structuredClone(original);

  setPointRule(original, 'distanceX', 1, 3, 99);
  setPointRule(original, 'distanceY', 2, 4, 7);
  setSymmetric(original, 1, 3, 0);
  setAngle(original, 4, 2, 30);
  removeRule(original, original[0]);

  assert.deepEqual(original, snapshot);
});

// Degenerate selections are declined, not written: a === b is not a rule;
// symmetric's center equal to either endpoint is not a rule. The UI
// disables these states; the writers decline them too if called directly.
test('degenerate selections are declined unchanged', () => {
  const cs = [{ kind: 'lock', corner: 2 }];
  assert.equal(setPointRule(cs, 'distanceX', 2, 2, 5), cs);
  assert.equal(setSymmetric(cs, 1, 3, 1), cs);
  assert.equal(setSymmetric(cs, 1, 3, 3), cs);
  assert.equal(setAngle(cs, 2, 2, 45), cs);
});

// Lead's review pass: a value that is not a finite number is declined too.
// The JSX refuses to commit one, but these writers are EXPORTED, so a guard
// living only in the component is proven by nothing -- the same argument that
// put the write decisions out here. Measured before the guard existed:
// setPointRule(cs, 'distanceX', 1, 3, NaN) wrote `value: NaN` straight into
// the solver's input, and setAngle took an Infinity just as happily.
test('non-finite values are declined, not written', () => {
  const cs = [{ kind: 'lock', corner: 2 }];
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(setPointRule(cs, 'distanceX', 1, 3, bad), cs, `distanceX ${bad}`);
    assert.equal(setPointRule(cs, 'distanceY', 1, 3, bad), cs, `distanceY ${bad}`);
    assert.equal(setAngle(cs, 1, 2, bad), cs, `angle ${bad}`);
  }
  // 0 is a REAL value on all three -- two corners in line, an edge pair at no
  // turn -- and must survive a guard aimed at NaN.
  assert.deepEqual(setPointRule([], 'distanceX', 1, 3, 0),
    [{ kind: 'distanceX', a: 1, b: 3, value: 0 }]);
  assert.deepEqual(setAngle([], 1, 2, 0),
    [{ kind: 'angle', edge: 1, other: 2, degrees: 0 }]);
});