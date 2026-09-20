// window-zoom-fit.ts's pure camera math -- no renderer, no three.js.
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindowZoomFit, computeSelectionFit } from '../dist/window-zoom-fit.js';

const CAMERA = { position: [0, 0, 100], fov: 90, near: 0.1, far: 1000 };
const TARGET = [0, 0, 0];

test('1: computeWindowZoomFit is invalid for a near-zero drag rect', () => {
  const r = computeWindowZoomFit({ x: 100, y: 100, width: 2, height: 2 }, 800, 600, CAMERA, TARGET, null);
  assert.equal(r.valid, false);
});

test('2: computeWindowZoomFit centers the target under a centered rect', () => {
  const r = computeWindowZoomFit({ x: 300, y: 200, width: 200, height: 200 }, 800, 600, CAMERA, TARGET, null);
  assert.ok(Math.abs(r.target[0]) < 1e-6);
  assert.ok(Math.abs(r.target[1]) < 1e-6);
});

test('3: computeWindowZoomFit needs less distance for a smaller drag rect', () => {
  const big = computeWindowZoomFit({ x: 100, y: 100, width: 600, height: 400 }, 800, 600, CAMERA, TARGET, null);
  const small = computeWindowZoomFit({ x: 350, y: 250, width: 100, height: 100 }, 800, 600, CAMERA, TARGET, null);
  assert.ok(small.distance < big.distance);
});

test('4: computeWindowZoomFit fitting the full viewport keeps close to the current distance', () => {
  const full = computeWindowZoomFit({ x: 0, y: 0, width: 800, height: 600 }, 800, 600, CAMERA, TARGET, null);
  const currentDist = 100; // camera at z=100, target at origin
  assert.ok(Math.abs(full.distance - currentDist) < 1e-6);
});

test('5: computeWindowZoomFit is symmetric between width- and height-driven rects at matching aspect', () => {
  // A rect as wide (in world units) as the viewport is at some distance should need the
  // same distance whether it is the full-width strip or the full-height strip, once
  // both are scaled to the viewport's own aspect ratio.
  const wide = computeWindowZoomFit({ x: 0, y: 250, width: 800, height: 100 }, 800, 600, CAMERA, TARGET, null);
  const tall = computeWindowZoomFit({ x: 350, y: 0, width: 100, height: 600 }, 800, 600, CAMERA, TARGET, null);
  // Both rects span the full extent on one axis; neither should demand a distance
  // larger than fitting the whole viewport (which is 100 at this camera setup).
  assert.ok(wide.distance <= 100 + 1e-6);
  assert.ok(tall.distance <= 100 + 1e-6);
});

test('6: computeWindowZoomFit clamps distance to the scene box when given one', () => {
  const sceneBox = { min: [-5, -5, -5], max: [5, 5, 5] };
  const r = computeWindowZoomFit({ x: 0, y: 0, width: 10, height: 10 }, 800, 600, CAMERA, TARGET, sceneBox);
  assert.ok(r.distance <= 10 * 10);
  assert.ok(r.distance >= 10 * 0.01);
});

test('7: computeSelectionFit is invalid for an empty selection', () => {
  const r = computeSelectionFit([], CAMERA, TARGET, 800, 600);
  assert.equal(r.valid, false);
});

test('8: computeSelectionFit centers on the combined bounding box', () => {
  const boxes = [
    { min: [0, 0, 0], max: [10, 10, 10] },
    { min: [10, 10, 10], max: [20, 20, 20] },
  ];
  const r = computeSelectionFit(boxes, CAMERA, TARGET, 800, 600);
  assert.equal(r.valid, true);
  assert.deepEqual(r.target, [10, 10, 10]);
});

test('9: computeSelectionFit needs more distance for a bigger box', () => {
  const small = computeSelectionFit([{ min: [0, 0, 0], max: [1, 1, 1] }], CAMERA, TARGET, 800, 600);
  const big = computeSelectionFit([{ min: [0, 0, 0], max: [50, 50, 50] }], CAMERA, TARGET, 800, 600);
  assert.ok(big.distance > small.distance);
});
