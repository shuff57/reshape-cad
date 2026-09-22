// move-gizmo-core.ts's snap math (todo 24, SPEC-mouse-parity.md Phase 5.2)
// + moveFeatureHandles()'s specs in model-handles.ts. Imports from ../dist
// like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveStep, snapDelta } from '../dist/model/move-gizmo-core.js';
import { handlesFor } from '@shuff57/reshape-script/model-handles';

// ---- adaptiveStep: the ruler-ladder increment -----------------------------

test('1: adaptive step keeps a full drag to ~20 ruler stops', () => {
  // 40mm part -> 2mm steps (20 stops). 300mm -> 20mm. 12mm boss -> 0.5.
  assert.equal(adaptiveStep(40), 2);
  assert.equal(adaptiveStep(300), 20);
  assert.equal(adaptiveStep(12), 1, '12/0.5=24 stops is too fine; 12/1=12 stops is right');
  assert.equal(adaptiveStep(100), 5);
  // Degenerate falls back to 1mm, not NaN.
  assert.equal(adaptiveStep(0), 1);
  assert.equal(adaptiveStep(-5), 1);
});

test('2: fixed mode snaps to the student step, off passes through, adaptive reads the extent', () => {
  const delta = [7.3, -2.9, 1.6];
  assert.deepEqual(
    snapDelta(delta, 'fixed', 5, 40),
    [5, -5, 0],
    'fixed snaps each axis to the nearest 5',
  );
  assert.deepEqual(snapDelta(delta, 'off', 5, 40), delta,
    'off is raw -- the toggle-off case, not 0');
  // 40mm model -> adaptiveStep 2 -> nearest-2 snap.
  assert.deepEqual(snapDelta(delta, 'adaptive', 5, 40), [8, -2, 2]);
  // A fixedStep <= 0 is not a step: raw deltas pass through rather than
  // all snapping to 0.
  assert.deepEqual(snapDelta(delta, 'fixed', 0, 40), delta);
});

// ---- move-feature gizmo specs ---------------------------------------------

const doc = {
  version: 1,
  params: [],
  features: [
    { id: 'bx1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv1', kind: 'move', target: 'bx1', offset: [15, 0, 8], copy: false },
    { id: 'mv2', kind: 'move', target: 'bx1', offset: [0, 0, 0], copy: true },
  ],
};

test('3: a selected Move projects the three axis gizmo arrows', () => {
  const specs = handlesFor(doc.features.find((f) => f.id === 'mv1'), doc);
  assert.equal(specs.length, 3, 'one arrow per axis');
  for (const [i, want] of ['x', 'y', 'z'].entries()) {
    assert.equal(specs[i].kind, 'move');
    assert.equal(specs[i].param, `mv1_${want}`, `the ${i}-th arrow drives _${want}`);
    assert.deepEqual(
      specs[i].axis,
      [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0],
      `the ${i}-th arrow points along its own axis`,
    );
  }
});

test('4: the arrow origins ride the offset, pushed reach off the moved centre', () => {
  const specs = handlesFor(doc.features.find((f) => f.id === 'mv1'), doc);
  // reach = hypot(15,0,8)+10 = 27; x arrow: x = 0+15+27 = 42.
  assert.equal(specs[0].origin[0], 42);
  assert.equal(specs[0].origin[1], 0);
  assert.equal(specs[2].origin[2], 0 + 8 + 27);
});

test('5: zero offset still yields arrows at reach 20 (never a dot at the centre)', () => {
  const specs = handlesFor(doc.features.find((f) => f.id === 'mv2'), doc);
  assert.equal(specs[0].origin[0], 10, 'reach floors at 10 past the centre');
  assert.equal(specs[2].param, 'mv2_z');
});

test('6: no doc, no handles -- the honest empty, not a crash', () => {
  assert.deepEqual(handlesFor(doc.features.find((f) => f.id === 'mv1'), undefined), []);
});
