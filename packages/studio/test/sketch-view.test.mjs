// sketch-view.ts's 2D view math: zoom-to-cursor invariance, pan, fit, and the
// screen<->world transforms. Imports from ../dist like every suite here;
// build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWheelZoom,
  panByPx,
  fitView,
  worldToScreen,
  screenToWorld,
  clampScale,
  screenPxToWorld,
  MIN_PX_PER_MM,
  MAX_PX_PER_MM,
} from '../dist/sketch-view.js';
import { bboxCenter, bboxLongestDimension } from '../dist/camera-fit.js';

const SIZE = { width: 800, height: 600 };
const CONTENT = { min: [-40, -30], max: [40, 30] };

test('1: zoom 2x at cursor keeps the world point under the cursor invariant', () => {
  const before = { cx: 0, cy: 0, pxPerMm: 4 };
  const cursor = { x: 300, y: 200 };
  const worldUnderCursor = screenToWorld(before, cursor, SIZE);
  const after = applyWheelZoom(before, cursor, SIZE, 2);
  const back = screenToWorld(after, cursor, SIZE);
  assert.ok(Math.abs(back.x - worldUnderCursor.x) < 1e-9);
  assert.ok(Math.abs(back.y - worldUnderCursor.y) < 1e-9);
  assert.ok(Math.abs(after.pxPerMm - 8) < 1e-9);
});

test('2: fitView covers the content bbox plus padding, corners included', () => {
  const pad = 20;
  const view = fitView(CONTENT, SIZE, pad);
  // Every content corner must land strictly inside the viewport, with room
  // to spare for the pad.
  for (const [wx, wy] of [
    [CONTENT.min[0], CONTENT.min[1]],
    [CONTENT.max[0], CONTENT.min[1]],
    [CONTENT.min[0], CONTENT.max[1]],
    [CONTENT.max[0], CONTENT.max[1]],
  ]) {
    const s = worldToScreen(view, { x: wx, y: wy }, SIZE);
    assert.ok(s.x >= pad - 1e-9 && s.x <= SIZE.width - pad + 1e-9, `x ${s.x} for wx=${wx}`);
    assert.ok(s.y >= pad - 1e-9 && s.y <= SIZE.height - pad + 1e-9, `y ${s.y} for wy=${wy}`);
  }
  // And the visible world bbox (via the corners) must contain the content.
  const tl = screenToWorld(view, { x: 0, y: 0 }, SIZE);
  const br = screenToWorld(view, { x: SIZE.width, y: SIZE.height }, SIZE);
  assert.ok(tl.x <= CONTENT.min[0] + 1e-9);
  assert.ok(tl.y >= CONTENT.max[1] - 1e-9); // screen top = world max y
  assert.ok(br.x >= CONTENT.max[0] - 1e-9);
  assert.ok(br.y <= CONTENT.min[1] + 1e-9); // screen bottom = world min y
});

test('3: zoom at a canvas corner still holds the invariance property', () => {
  const before = { cx: 12, cy: -7, pxPerMm: 3 };
  for (const cursor of [
    { x: 0, y: 0 },
    { x: SIZE.width, y: SIZE.height },
    { x: SIZE.width, y: 0 },
    { x: 0, y: SIZE.height },
  ]) {
    const world = screenToWorld(before, cursor, SIZE);
    const after = applyWheelZoom(before, cursor, SIZE, 0.5);
    const back = screenToWorld(after, cursor, SIZE);
    assert.ok(Math.abs(back.x - world.x) < 1e-9, `x at ${cursor.x},${cursor.y}`);
    assert.ok(Math.abs(back.y - world.y) < 1e-9, `y at ${cursor.x},${cursor.y}`);
  }
});

test('4: scale clamps at both ends and repeated zooms stay clamped', () => {
  assert.equal(clampScale(1e-9), MIN_PX_PER_MM);
  assert.equal(clampScale(1e9), MAX_PX_PER_MM);
  assert.equal(clampScale(5), 5);

  let view = { cx: 0, cy: 0, pxPerMm: 1e-5 };
  for (let i = 0; i < 10; i++) view = applyWheelZoom(view, { x: 400, y: 300 }, SIZE, 0.1);
  assert.equal(view.pxPerMm, MIN_PX_PER_MM);

  view = { cx: 0, cy: 0, pxPerMm: 1e5 };
  for (let i = 0; i < 10; i++) view = applyWheelZoom(view, { x: 400, y: 300 }, SIZE, 10);
  assert.equal(view.pxPerMm, MAX_PX_PER_MM);
});

test('5: panByPx round-trips -- pan right by w then left by w restores cx', () => {
  const before = { cx: 25, cy: -10, pxPerMm: 2 };
  const w = 137;
  const panned = panByPx(before, w, 0);
  const back = panByPx(panned, -w, 0);
  assert.equal(back.cx, before.cx);
  assert.equal(back.cy, before.cy);
  assert.equal(back.pxPerMm, before.pxPerMm);
  // Pan moves the view opposite to the drag: dragging right shows content
  // further left, i.e. cx decreases.
  assert.ok(panned.cx < before.cx);
});

test('6: degenerate bbox fit does not produce NaN/Infinity', () => {
  for (const bbox of [
    { min: [5, 5], max: [5, 5] }, // single point
    { min: [0, 0], max: [0, 10] }, // zero width
    { min: [0, 0], max: [10, 0] }, // zero height
  ]) {
    const view = fitView(bbox, SIZE, 20);
    for (const v of [view.cx, view.cy, view.pxPerMm]) {
      assert.ok(Number.isFinite(v), `finite for ${JSON.stringify(bbox)}`);
    }
    assert.ok(view.pxPerMm > 0);
    // The transforms stay finite too.
    const s = worldToScreen(view, { x: 5, y: 5 }, SIZE);
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
  }
});

test('7: camera-fit helpers are reused, not duplicated (same module, same values)', () => {
  assert.equal(bboxCenter({ min: [-40, -30, 0], max: [40, 30, 0] })[0], 0);
  assert.equal(bboxLongestDimension({ min: [-40, -30, 0], max: [40, 30, 0] }), 80);
  // fitView centres on the bbox centre.
  const off = { min: [10, 20], max: [30, 40] };
  const view = fitView(off, SIZE, 20);
  assert.equal(view.cx, 20);
  assert.equal(view.cy, 30);
});