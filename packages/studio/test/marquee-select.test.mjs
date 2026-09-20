// Marquee select (SPEC-mouse-parity.md Phase 2 item 5 / Phase 3 item 4) — the
// pure window/crossing selection core. Imports from ../dist like every suite
// here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marqueeKind, marqueeSelect, pointSetSelect } from '../dist/marquee-select.js';

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

// pointSetSelect (SPEC-mouse-parity.md Phase 3 item 4): the generic point-set
// containment test BrepViewportThree.tsx's 3D-projected box select reuses --
// a vertex reduces to 1 screen point, an edge to its 2 endpoints, a face or
// body to its 4 screen-space bbox corners.
const CROSSING = { startX: 35, startY: 35, endX: 5, endY: 5 };

test('9: a single point (vertex) inside the rect selects in both window and crossing', () => {
  assert.equal(pointSetSelect([{ x: 20, y: 20 }], RECT), true);
  assert.equal(pointSetSelect([{ x: 20, y: 20 }], CROSSING), true);
});

test('10: a single point (vertex) outside the rect selects in neither -- a point has no partial touch', () => {
  assert.equal(pointSetSelect([{ x: 0, y: 0 }], RECT), false);
  assert.equal(pointSetSelect([{ x: 0, y: 0 }], CROSSING), false);
});

test('11: two points (an edge) both inside select as window', () => {
  assert.equal(pointSetSelect([{ x: 10, y: 10 }, { x: 30, y: 10 }], RECT), true);
});

test('12: two points (an edge) straddling the boundary -- crossing yes, window no', () => {
  const straddle = [{ x: 0, y: 20 }, { x: 50, y: 20 }];
  assert.equal(pointSetSelect(straddle, RECT), false);
  assert.equal(pointSetSelect(straddle, CROSSING), true);
});

test('13: two points (an edge) entirely outside with no crossing select in neither', () => {
  const outside = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
  assert.equal(pointSetSelect(outside, RECT), false);
  assert.equal(pointSetSelect(outside, CROSSING), false);
});

test('14: four points (a face/body screen bbox, tl/tr/br/bl) fully inside select as window', () => {
  const bbox = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }];
  assert.equal(pointSetSelect(bbox, RECT), true);
});

test('15: a bbox exactly matching the rect boundary still counts as window (inside is inclusive)', () => {
  const bbox = [{ x: 5, y: 5 }, { x: 35, y: 5 }, { x: 35, y: 35 }, { x: 5, y: 35 }];
  assert.equal(pointSetSelect(bbox, RECT), true);
});

test('16: a bbox entirely outside, no overlap, selects in neither mode', () => {
  const bbox = [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 120 }, { x: 100, y: 120 }];
  assert.equal(pointSetSelect(bbox, RECT), false);
  assert.equal(pointSetSelect(bbox, CROSSING), false);
});

test('17: a bbox threaded through the drag rect with NO corner of either inside the other still crosses -- pure edge-crossing overlap, not just corner containment', () => {
  // Face bbox: a wide, short rect (x 0..100, y 40..60). Drag rect: a narrow,
  // tall one (x 45..55, y 0..100) passed vertically through its middle.
  // Neither rect's corners land inside the other, so a corner-only overlap
  // test would wrongly say 'no touch' -- only testing every bbox edge
  // against every drag-rect edge catches this, the same way it would for
  // two literal rectangles drawn on screen.
  const bbox = [{ x: 0, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const threadCrossing = { startX: 55, startY: 100, endX: 45, endY: 0 };
  const threadWindow = { startX: 45, startY: 0, endX: 55, endY: 100 };
  assert.equal(pointSetSelect(bbox, threadCrossing), true);
  assert.equal(pointSetSelect(bbox, threadWindow), false);
});

test('18: a degenerate drag rect (start == end) selects nothing for any point set', () => {
  const click = { startX: 20, startY: 20, endX: 20, endY: 20 };
  assert.equal(pointSetSelect([{ x: 20, y: 20 }], click), false);
});

test('19: viewport box-select wiring contract -- window selects exactly the enclosed faces, crossing additionally includes a touched third (T11 edge cases a/b)', () => {
  // Three face candidates, each reduced to its screen bbox corners the way
  // BrepViewportThree.tsx's collectBoxSelection() does for a mesh face range.
  const faceA = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }]; // fully inside
  const faceB = [{ x: 40, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 30 }, { x: 40, y: 30 }]; // fully inside
  const faceC = [{ x: 65, y: 10 }, { x: 85, y: 10 }, { x: 85, y: 30 }, { x: 65, y: 30 }]; // only touched, not enclosed
  const faces = [faceA, faceB, faceC];
  // (a) L->R (window): covers faceA and faceB fully, faceC only partially.
  const windowDrag = { startX: 5, startY: 5, endX: 70, endY: 35 };
  const windowHits = faces.filter((f) => pointSetSelect(f, windowDrag));
  assert.deepEqual(windowHits, [faceA, faceB]);
  // (b) R->L (crossing) over the same rect: faceC now joins because crossing
  // counts a touch, not just full enclosure.
  const crossingDrag = { startX: 70, startY: 35, endX: 5, endY: 5 };
  const crossingHits = faces.filter((f) => pointSetSelect(f, crossingDrag));
  assert.deepEqual(crossingHits, [faceA, faceB, faceC]);
});