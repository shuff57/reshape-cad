// manipulator-core.ts's pure half (SPEC-mouse-parity.md Phase 5.1, todo 22).
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANIPULATOR_KINDS,
  manipulatorParam,
  manipulatorValue,
  manipulatorValueError,
  manipulatorLabel,
} from '../dist/model/manipulator-core.js';

// Minimal doc fixtures -- the same plain-object shape model-types.ts
// declares; no interpreter, no kernel.
const doc = {
  version: 1,
  params: [],
  features: [
    { id: 'sk1', kind: 'sketch', plane: 'xy', points: [[0, 0], [40, 0], [40, 20], [0, 20]] },
    { id: 'ex1', kind: 'extrude', target: 'sk1', height: 12 },
    { id: 'pk1', kind: 'pocket', target: 'sk1', into: 'bx1', depth: 5 },
    { id: 'bx1', kind: 'box', size: [40, 20, 10], center: [0, 0, 0] },
    { id: 'fi1', kind: 'fillet', target: 'bx1', edge: { cause: 'between', of: [] }, size: 3, style: 'fillet' },
    { id: 'ho1', kind: 'hole', target: 'bx1', diameter: 6, depth: 4, center: [0, 0, 5] },
  ],
  // The solver fields solveDoc() fills; the pure readers here never touch
  // them, but the doc type wants them, so cast below keeps the fixture
  // honest about being a partial.
};

test('1: exactly the three Phase 5.1 feature kinds carry a manipulator', () => {
  assert.deepEqual([...MANIPULATOR_KINDS], ['extrude', 'pocket', 'fillet']);
  assert.equal(manipulatorParam({ id: 'bx1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] }), null,
    'a box already carries its own size handles -- no second manipulator');
  assert.equal(manipulatorParam({ id: 'ho1', kind: 'hole', target: 'bx1', diameter: 6, depth: 4, center: [0, 0, 5] }), null,
    'a hole has no single positive-extent handle');
  assert.equal(manipulatorParam({ id: 'sk1', kind: 'sketch', plane: 'xy', points: [[0, 0], [40, 0], [40, 20], [0, 20]] }), null,
    'a sketch is edited in the 2D canvas, not by this manipulator');
});

test('2: drag and type CONVERGE on one generated-param name per feature kind', () => {
  // The param name both paths end in is exactly what generatedParams()
  // emits (pname(id, slot)) -- asserting the shape here pins the
  // convergence; ReshapeStudio wires BOTH call sites through sendParams.
  const ex = manipulatorParam({ id: 'ex1', kind: 'extrude', target: 'sk1', height: 12 });
  assert.equal(ex.param, 'ex1_height');
  assert.equal(ex.slot, 'height');
  const pk = manipulatorParam({ id: 'pk1', kind: 'pocket', target: 'sk1', into: 'bx1', depth: 5 });
  assert.equal(pk.param, 'pk1_depth');
  assert.equal(pk.slot, 'depth');
  const fi = manipulatorParam({ id: 'fi1', kind: 'fillet', target: 'bx1', edge: { cause: 'between', of: [] }, size: 3, style: 'fillet' });
  assert.equal(fi.param, 'fi1_size');
  assert.equal(fi.slot, 'size');
});

test('3: the committed value reads off the doc, not off any cache', () => {
  assert.equal(manipulatorValue(doc, 'ex1_height'), 12);
  assert.equal(manipulatorValue(doc, 'pk1_depth'), 5);
  assert.equal(manipulatorValue(doc, 'fi1_size'), 3);
  // A param whose feature is gone (deleted mid-flight) answers null rather
  // than a stale number.
  assert.equal(manipulatorValue(doc, 'gone_height'), null);
  // A mismatched slot answers null rather than lying.
  assert.equal(manipulatorValue(doc, 'ex1_depth'), null);
});

test('4: refusal sentences -- empty, non-numeric, and non-positive all refuse', () => {
  for (const kind of MANIPULATOR_KINDS) {
    assert.match(String(manipulatorValueError(kind, '')), /type a number/);
    assert.match(String(manipulatorValueError(kind, '  ')), /type a number/);
    assert.match(String(manipulatorValueError(kind, 'abc')), /not a number/);
    assert.match(String(manipulatorValueError(kind, '-5')), /positive number/,
      'a negative extent is not this feature driven backwards -- refused in a sentence');
    assert.match(String(manipulatorValueError(kind, '0')), /positive number/,
      'a zero extent is degenerate');
    // The happy path is null: the caller commits.
    assert.equal(manipulatorValueError(kind, '14'), null);
    assert.equal(manipulatorValueError(kind, '2.5'), null);
  }
});

test('5: the label matches the panel caption family', () => {
  assert.equal(manipulatorLabel('height'), 'height');
  // 'deep', not 'depth' -- generatedParams' caption for the pocket slot is
  // "deep", and a box and a slider driving the SAME parameter must not use
  // two different words (the Bevel/Angled-Corner split already paid for).
  assert.equal(manipulatorLabel('depth'), 'deep');
  assert.equal(manipulatorLabel('size'), 'size');
});

test('6: the drag half rides the SAME param name as the type half', () => {
  // The overlay's drag flow pushes { param: mani.param, value } and commits
  // that same param; ReshapeStudio wires BOTH onDrag and the box's Enter
  // through sendParams(...)/commitParams(). This pins that the drag target
  // and the type target are the same string -- the convergence criterion
  // verbatim, one assertion per kind.
  for (const [fixture, want] of [
    [{ id: 'ex1', kind: 'extrude', target: 'sk1', height: 12 }, 'ex1_height'],
    [{ id: 'pk1', kind: 'pocket', target: 'sk1', into: 'bx1', depth: 5 }, 'pk1_depth'],
    [{ id: 'fi1', kind: 'fillet', target: 'bx1', edge: { cause: 'between', of: [] }, size: 3, style: 'fillet' }, 'fi1_size'],
  ]) {
    const m = manipulatorParam(fixture);
    assert.ok(m, `${want}: a manipulator exists`);
    assert.equal(m.param, want);
  }
});

test('7: after a write, the doc-read reflects the new value (no cache)', () => {
  const bumped = { ...doc, features: doc.features.map((f) => (f.id === 'pk1' ? { ...f, depth: 12 } : f)) };
  assert.equal(manipulatorValue(bumped, 'pk1_depth'), 12);
  assert.equal(manipulatorValue(doc, 'pk1_depth'), 5, 'the original doc is untouched');
});
