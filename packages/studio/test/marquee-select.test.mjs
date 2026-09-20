// Marquee select (SPEC-mouse-parity.md Phase 2 item 5 / Phase 3 item 4) — the
// pure window/crossing selection core. Imports from ../dist like every suite
// here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marqueeKind, marqueeSelect } from '../dist/marquee-select.js';

const LINE_IN = { k: 'line', id: 1, a: [10, 10], b: [30, 10] }; // fully inside rect (5..35, 5..35)
const LINE_CROSS = { k: 'line', id: 2, a: [0, 20], b: [50, 20] }; // crosses rect edges
const CIRCLE_STRADDLE = { k: 'circle', id: 3, c: [20, 20], r: 16 }; // centre in, rim out (rect is 5..35)
const CIRCLE_IN = { k: 'circle', id: 4, c: [20, 20], r: 3 }; // fully inside
const ARC_PART = { k: 'arc', id: 5, c: [0, 0], r: 10, a: [10, 0], b: [0, 10], sense: 'ccw' }; // quarter arc, part outside
const ARC_IN = { k: 'arc', id: 6, c: [20, 20], r: 2, a: [22, 20], b: [20, 22], sense: 'ccw' }; // fully inside

const RECT = { startX: 5, startY: 5, endX: 35, endY: 35 };

test('1: marqueeKind reads drag direction, not normalized bounds', () => {
  assert.equal(marqueeKind({ startX: 5, startY: 5, endX: 35, endY: 35 }), 'window');
  assert.equal(marqueeKind({ startX: 35, startY: 35, endX: 5, endY: 5 }), 'crossing');
  assert.equal(marqueeKind({ startX: 35, startY: 5, endX: 5, endY: 35 }), 'crossing');
  assert.equal(marqueeKind({ startX: 5, startY: 35, endX: 35, endY: 5 }), 'window');
});

test('2: window mode keeps only fully-inside geometry', () => {
  const ids = marqueeSelect([LINE_IN, LINE_CROSS, CIRCLE_STRADDLE, CIRCLE_IN, ARC_PART, ARC_IN], RECT);
  assert.deepEqual(ids.sort((a, b) => a - b), [1, 4, 6]);
});

test('3: crossing mode keeps touched-or-inside geometry', () => {
  const ids = marqueeSelect([LINE_IN, LINE_CROSS, CIRCLE_STRADDLE, CIRCLE_IN, ARC_PART, ARC_IN], {
    startX: 35,
    startY: 35,
    endX: 5,
    endY: 5,
  });
  assert.deepEqual(ids.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test('4: degenerate rect (start == end) selects nothing in either mode', () => {
  const click = { startX: 20, startY: 20, endX: 20, endY: 20 };
  assert.deepEqual(marqueeSelect([LINE_IN, CIRCLE_IN, ARC_IN], click), []);
  assert.deepEqual(marqueeSelect([LINE_IN, CIRCLE_IN, ARC_IN], click), []);
});

test('5: line crossing the boundary — crossing yes, window no', () => {
  assert.deepEqual(marqueeSelect([LINE_CROSS], { startX: 35, startY: 35, endX: 5, endY: 5 }), [2]);
  assert.deepEqual(marqueeSelect([LINE_CROSS], RECT), []);
});

test('6: circle straddling the boundary — crossing yes, window no', () => {
  assert.deepEqual(marqueeSelect([CIRCLE_STRADDLE], { startX: 35, startY: 35, endX: 5, endY: 5 }), [3]);
  assert.deepEqual(marqueeSelect([CIRCLE_STRADDLE], RECT), []);
});

test('7: arc partially outside — crossing yes, window no', () => {
  assert.deepEqual(marqueeSelect([ARC_PART], { startX: 35, startY: 35, endX: 5, endY: 5 }), [5]);
  assert.deepEqual(marqueeSelect([ARC_PART], RECT), []);
});

test('8: empty geoms and empty result shapes', () => {
  assert.deepEqual(marqueeSelect([], RECT), []);
});