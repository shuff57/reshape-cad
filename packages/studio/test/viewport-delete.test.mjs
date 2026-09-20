// SPEC-mouse-parity.md Phase 3.6: the viewport/timeline Delete key routes
// through the SAME cascade ModelEditor.tsx's remove() has always used
// (orphanedBy + withoutFeatures, @shuff57/reshape-script/model-deps) --
// these two cases pin the two contracts a keyboard Delete must honour.
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandleViewportDelete } from '../dist/pick-helpers.js';
import { whyDeletingCosts, orphanedBy, withoutFeatures } from '@shuff57/reshape-script/model-deps';

test('1: shouldHandleViewportDelete is false while an <input> is focused', () => {
  assert.equal(shouldHandleViewportDelete('INPUT'), false);
});

test('2: shouldHandleViewportDelete is false while a <textarea> is focused, case-insensitively', () => {
  assert.equal(shouldHandleViewportDelete('textarea'), false);
});

test('3: shouldHandleViewportDelete is true for the canvas, the document body, or nothing focused', () => {
  assert.equal(shouldHandleViewportDelete('CANVAS'), true);
  assert.equal(shouldHandleViewportDelete('BODY'), true);
  assert.equal(shouldHandleViewportDelete(''), true);
});

test('4: deleting a feature with a dependent surfaces the dependent\'s own sentence, not a throw or a silent drop', () => {
  const sk1 = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [20, 0], [20, 20], [0, 20]] };
  const pull1 = { id: 'pull1', kind: 'extrude', target: 'sk1', height: 10 };
  const doc = { version: 1, features: [sk1, pull1] };
  const names = { sk1: 'Sketch 1', pull1: 'Pull 1' };

  const sentence = whyDeletingCosts(doc, ['sk1'], (id) => names[id] ?? id);
  assert.equal(typeof sentence, 'string', 'pull1 depends on sk1 -- a sentence must come back, not null');
  assert.ok(sentence.includes('Pull 1'), `expected the dependent's own name in the sentence, got: ${sentence}`);

  const doomed = orphanedBy(doc, ['sk1']);
  assert.ok(doomed.has('pull1'), 'pull1 must be named as doomed, not silently kept back to fail later unreported');

  const next = withoutFeatures(doc, ['sk1']);
  assert.ok(!next.features.some((f) => f.id === 'pull1'), 'pull1 must not survive the delete pointing at nothing');
});

test('5: deleting a feature with nothing depending on it costs nothing extra', () => {
  const box1 = { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] };
  const doc = { version: 1, features: [box1] };
  assert.equal(whyDeletingCosts(doc, ['box1'], (id) => id), null);
});
