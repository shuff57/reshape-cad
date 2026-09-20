// pick-helpers.ts's pure nearest-in-tolerance selection -- the part of
// BrepViewportThree.tsx's vertex picking (SPEC-mouse-parity.md Phase 3 item
// 2) that does not need a THREE.Camera to test. Imports from ../dist like
// every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestVisible, nextCycleIndex } from '../dist/pick-helpers.js';

test('1: empty candidates -> null', () => {
  assert.equal(nearestVisible([], 8, Infinity), null);
});

test('2: a single candidate within tolerance and depth wins', () => {
  const a = { distPx: 3, depth: 10 };
  assert.equal(nearestVisible([a], 8, Infinity), a);
});

test('3: a candidate outside the screen-pixel tolerance is excluded', () => {
  const a = { distPx: 9, depth: 10 };
  assert.equal(nearestVisible([a], 8, Infinity), null);
});

test('4: a candidate exactly at the tolerance boundary still wins (<=, not <)', () => {
  const a = { distPx: 8, depth: 10 };
  assert.equal(nearestVisible([a], 8, Infinity), a);
});

test('5: a candidate deeper than maxDepth (occluded by a nearer surface) is excluded', () => {
  const a = { distPx: 2, depth: 50 };
  assert.equal(nearestVisible([a], 8, 20), null);
});

test('6: a candidate exactly at maxDepth still wins (<=, not <)', () => {
  const a = { distPx: 2, depth: 20 };
  assert.equal(nearestVisible([a], 8, 20), a);
});

test('7: maxDepth of Infinity never rejects on depth -- the "no face hit at the cursor" fallback', () => {
  const far = { distPx: 1, depth: 100000 };
  assert.equal(nearestVisible([far], 8, Infinity), far);
});

test('8: among several in-tolerance, visible candidates, the screen-closest one wins even if farther in depth', () => {
  const near = { distPx: 5, depth: 90 };
  const closer = { distPx: 1, depth: 10 };
  assert.equal(nearestVisible([near, closer], 8, Infinity), closer);
});

test('9: an occluded closer-in-screen-space candidate loses to a visible farther one', () => {
  const occluded = { distPx: 1, depth: 500 };
  const visible = { distPx: 6, depth: 10 };
  assert.equal(nearestVisible([occluded, visible], 8, 20), visible);
});

test('10: every in-tolerance candidate occluded -> null, even though some were close in screen space', () => {
  const a = { distPx: 1, depth: 500 };
  const b = { distPx: 2, depth: 600 };
  assert.equal(nearestVisible([a, b], 8, 20), null);
});

test('11: a tie in screen distance keeps whichever the caller listed first', () => {
  const first = { distPx: 4, depth: 10 };
  const second = { distPx: 4, depth: 12 };
  assert.equal(nearestVisible([first, second], 8, Infinity), first);
});

test('12: nextCycleIndex advances by one, wrapping after the last candidate', () => {
  assert.equal(nextCycleIndex(0, 3), 1);
  assert.equal(nextCycleIndex(1, 3), 2);
  assert.equal(nextCycleIndex(2, 3), 0);
});

test('13: repeated cycle-advances visit every candidate exactly once before wrapping', () => {
  for (const count of [2, 3, 5]) {
    let index = -1;
    const visited = [];
    for (let step = 0; step < count; step++) {
      index = nextCycleIndex(index, count);
      visited.push(index);
    }
    assert.deepEqual([...visited].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
    // one more advance wraps back to the very first index this run produced
    assert.equal(nextCycleIndex(index, count), visited[0]);
  }
});

test('14: candidateCount of 0 returns 0 rather than dividing by zero', () => {
  assert.equal(nextCycleIndex(0, 0), 0);
});
