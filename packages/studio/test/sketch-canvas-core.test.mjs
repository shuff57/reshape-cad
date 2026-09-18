// SketchCanvas2D's pure core (sketch-canvas-core.ts) — the part of the canvas
// that can be proven without a DOM (the SketchConstraints.tsx:261 precedent).
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferLineConstraint,
  snapAxis,
  arcFromClicks,
  arcEnds,
  nextGeomId,
  renumber,
  readSolved,
  namedPointsOf,
  pointWorld,
  snapVertex,
  distToSegment,
  distToCircleStroke,
  angleInArcRange,
  sampleArc,
} from '../dist/model/sketch-canvas-core.js';

const LINE = { k: 'line', id: 1, a: [0, 0], b: [40, 0] };
const CIRCLE = { k: 'circle', id: 2, c: [20, 20], r: 5 };
const ARC = { k: 'arc', id: 3, c: [0, 0], r: 10, a: [10, 0], b: [0, 10], sense: 'ccw' };

test('1: inferLineConstraint reads axis-aligned segments', () => {
  assert.equal(inferLineConstraint({ x: 0, y: 0 }, { x: 40, y: 0 }), 'horizontal');
  assert.equal(inferLineConstraint({ x: 0, y: 0 }, { x: 0, y: 30 }), 'vertical');
  assert.equal(inferLineConstraint({ x: 0, y: 0 }, { x: 40, y: 30 }), null);
  assert.equal(inferLineConstraint({ x: 5, y: 5 }, { x: 5, y: 5 }), null, 'zero length has no angle');
});

test('2: snapAxis yanks the off-axis coordinate onto the line', () => {
  assert.deepEqual(snapAxis({ x: 0, y: 0 }, { x: 40, y: 3 }, 'horizontal'), { x: 40, y: 0 });
  assert.deepEqual(snapAxis({ x: 0, y: 0 }, { x: 2, y: 30 }, 'vertical'), { x: 0, y: 30 });
});

test('3: arcFromClicks sweeps CCW from the start ray to the end ray', () => {
  const arc = arcFromClicks({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
  assert.equal(arc.r, 10);
  assert.equal(arc.a0, 0);
  assert.ok(arc.sweep > 0 && arc.sweep < Math.PI * 2 + 1e-9);
  const ends = arcEnds(arc.cx, arc.cy, arc.r, arc.a0, arc.sweep);
  assert.ok(Math.hypot(ends.a.x - 10, ends.a.y - 0) < 1e-9, 'a lands on the start click');
  assert.ok(Math.hypot(ends.b.x - 0, ends.b.y - 10) < 1e-6, 'b lands on the end click');
});

test('4: nextGeomId after a delete: renumber first, then max+1', () => {
  assert.equal(nextGeomId([]), 1);
  assert.equal(nextGeomId([LINE, CIRCLE].map((g, i) => ({ ...g, id: i + 1 }))), 3);
  // The soup contract is DENSE ids, so a delete renumbers first and the next
  // add takes max+1 of the COMPACTED rows: delete id 2 of 3 -> rows {1,2}.
  const compacted = renumber([{ k: 'line', id: 1 }, { k: 'line', id: 2 }, { k: 'line', id: 3 }], [], 2);
  assert.equal(nextGeomId(compacted.geoms), 3);
});

test('5: renumber drops rules naming the removed row and shifts the rest', () => {
  const geoms = [
    { k: 'line', id: 1, a: [0, 0], b: [10, 0] },
    { k: 'line', id: 2, a: [10, 0], b: [10, 10] },
    { k: 'line', id: 3, a: [10, 10], b: [0, 10] },
  ];
  const rules = [
    { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
    { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
    { k: 'parallel', a: 3, b: 1 },
  ];
  const out = renumber(geoms, rules, 2);
  assert.deepEqual(out.geoms.map((g) => g.id), [1, 2]);
  // Both rules naming removed id 2 drop; the survivor's id 3 shifts to 2.
  assert.deepEqual(out.rules, [{ k: 'parallel', a: 2, b: 1 }]);
});

test('6: readSolved unpacks the kernel param layout', () => {
  // Built-ins 0..9; point (2 slots) 10..11; line (4) 12..15; circle (3) 16..18.
  const params = new Array(19).fill(0);
  params[10] = 3; params[11] = 4;            // point p
  params[12] = 0; params[13] = 0; params[14] = 40; params[15] = 0; // line a,b
  params[16] = 20; params[17] = 20; params[18] = 5; // circle c,r
  const rows = readSolved(
    [{ k: 'point', id: 1 }, { k: 'line', id: 2 }, { k: 'circle', id: 3 }],
    params,
  );
  assert.deepEqual(rows[0].p, [3, 4]);
  assert.deepEqual(rows[1].a, [0, 0]);
  assert.deepEqual(rows[1].b, [40, 0]);
  assert.deepEqual(rows[2].c, [20, 20]);
  assert.equal(rows[2].r, 5);
});

test('7: namedPointsOf / pointWorld expose only real points', () => {
  assert.deepEqual(namedPointsOf(LINE).map((p) => p.at), ['a', 'b']);
  assert.deepEqual(namedPointsOf(CIRCLE).map((p) => p.at), ['c']);
  assert.deepEqual(pointWorld(LINE, 'b'), { x: 40, y: 0 });
  assert.equal(pointWorld(CIRCLE, 'a'), null);
  assert.deepEqual(pointWorld({ k: 'point', id: 9, p: [1, 2] }, 'a'), { x: 1, y: 2 });
});

test('8: snapVertex picks the nearest named point within the radius', () => {
  const geoms = [LINE, CIRCLE];
  // Real distances: the probe is 2px from line b, far from the rest.
  const hit = snapVertex(geoms, { x: 40, y: 0 }, (p) => Math.hypot(p.x - 40, p.y - 0) * 2, 8);
  assert.equal(hit.id, 1);
  assert.equal(hit.at, 'b');
  // Out of range -> null.
  assert.equal(snapVertex(geoms, { x: 40, y: 0 }, () => 20, 8), null);
});

test('9: hit-test distances and arc range', () => {
  assert.equal(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
  assert.equal(distToCircleStroke({ x: 25, y: 20 }, { x: 20, y: 20 }, 5), 0);
  // A ccw quarter arc from +x to +y contains pi/4 but not -pi/2.
  assert.equal(angleInArcRange(Math.PI / 4, 0, Math.PI / 2), true);
  assert.equal(angleInArcRange(-Math.PI / 2, 0, Math.PI / 2), false);
  const pts = sampleArc(0, 0, 10, 0, Math.PI / 2, 4);
  assert.equal(pts.length, 5);
  assert.ok(Math.abs(pts[4].x) < 1e-9 && Math.abs(pts[4].y - 10) < 1e-9);
});
