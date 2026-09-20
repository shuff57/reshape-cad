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
  arcAngles,
  sampleArc,
  toggleConstruction,
  trimLine,
  trimPick,
  segmentIntersection,
  slotRows,
  splitWeldedCircles,
  mirrorSelection,
  copySelection,
  densifyIds,
  findSnap,
  geomMidpoint,
  autoDimension,
  dimensionValueError,
  ruleGlyphAnchors,
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

// 10: construction toggle is MAJORITY, not per-shape.
test('10: toggleConstruction turns a mixed selection all-on, an all-on selection off', () => {
  const geoms = [
    { k: 'line', id: 1, a: [0, 0], b: [10, 0] },
    { k: 'line', id: 2, a: [10, 0], b: [10, 10], construction: true },
  ];
  // Mixed: 1 is normal -> both become construction.
  const on = toggleConstruction(geoms, [1, 2]);
  assert.equal(on[0].construction, true);
  assert.equal(on[1].construction, true);
  // All construction -> all toggle back off.
  const off = toggleConstruction(on, [1, 2]);
  assert.equal(off[0].construction, false);
  assert.equal(off[1].construction, false);
  // Unselected rows are untouched.
  const keep = toggleConstruction(geoms, [1]);
  assert.equal(keep[0].construction, true);
  assert.equal(keep[1].construction, true, "an unselected row keeps its own flag");
});

// 11: trim splits at the nearest crossing and DELETES the clicked half.
test('11: trimLine splits the clicked line and deletes the clicked half', () => {
  const geoms = [
    { k: 'line', id: 1, a: [0, 0], b: [40, 0] },   // the clicked line
    { k: 'line', id: 2, a: [20, -10], b: [20, 30] }, // crosses at (20, 0)
  ];
  const rules = [];
  const pick = trimPick(geoms, 1, { x: 35, y: 0 });
  assert.ok(pick, 'a crossing exists');
  assert.equal(pick.otherId, 2);
  assert.deepEqual([Math.round(pick.at.x), Math.round(pick.at.y)], [20, 0]);
  // Click at x=35 (right of the split): the RIGHT half is deleted, the LEFT
  // half survives as row 1 with its far endpoint pulled to the split. No
  // new row, no weld: the wire is now open, and discovery says so.
  const out = trimLine(geoms, rules, 1, pick.at, { x: 35, y: 0 });
  assert.equal(out.geoms.length, 2, 'no row added: the clicked half is gone');
  const one = out.geoms.find((g) => g.id === 1);
  assert.deepEqual(one.a, [0, 0], 'the surviving half keeps the far endpoint');
  assert.deepEqual(one.b, [20, 0], 'and now ends at the split');
  assert.deepEqual(out.rules, rules, 'no weld: the piece is deleted');
});

// 12: segmentIntersection basics.
test('12: segmentIntersection crosses within both segments or not at all', () => {
  const x = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
  assert.deepEqual(x, { x: 5, y: 0 });
  assert.equal(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 5 }), null, 'miss');
  assert.equal(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 }), null, 'parallel');
});

// 13: slot rows: 2 arcs + 2 lines + 4 tangencies, seed consistent.
test('13: slotRows emits 2 arcs + 2 tangent lines with 4 tangencies', () => {
  const out = slotRows({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 8 }, 10);
  assert.ok(out, 'a valid slot builds');
  assert.equal(out.geoms.length, 4);
  const arcs = out.geoms.filter((g) => g.k === 'arc');
  const lines = out.geoms.filter((g) => g.k === 'line');
  assert.equal(arcs.length, 2);
  assert.equal(lines.length, 2);
  assert.equal(out.rules.length, 8, 'each junction is a coincident weld + an endpoint tangency');
  assert.equal(out.rules.filter((r) => r.k === 'tangent').length, 4, 'endpoint tangents carry no side');
  assert.ok(out.rules.filter((r) => r.k === 'tangent').every((r) => r.aEnd && r.bEnd), 'tangents are endpoint-form (no sigma)');
  assert.equal(out.rules.filter((r) => r.k === 'coincident').length, 4, 'the welds');
  // Both arcs carry the same radius (the click set it).
  assert.equal(arcs[0].r, 8);
  assert.equal(arcs[1].r, 8);
  // Both caps run CW (the wire travels top-line -> arc2's outer half ->
  // bottom-line -> arc1's outer half; a ccw cap meets back-to-back, refusal 12).
  assert.ok(arcs.every((a) => a.sense === 'cw'), 'caps run cw');
  // The top line connects the two +perp extremes.
  const top = lines.find((l) => l.id === 12);
  assert.deepEqual(top.a, [0, 8]);
  assert.deepEqual(top.b, [40, 8]);
});

// 14: slotRows refuses a degenerate ask (zero radius or zero length).
test('14: slotRows refuses a zero radius or a zero length', () => {
  assert.equal(slotRows({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }, 1), null, 'zero length');
  assert.equal(slotRows({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 0 }, 1), null, 'zero radius');
});

// 15: a circle welded by 2 tangencies becomes an arc pair; untouched circles
//     pass through.
test('15: splitWeldedCircles turns a tangent-welded circle into an arc pair', () => {
  const geoms = [
    { k: 'line', id: 1, a: [0, 0], b: [30, 0] },
    { k: 'line', id: 2, a: [30, 0], b: [30, 16] },
    { k: 'circle', id: 3, c: [20, 8], r: 8 },
    { k: 'line', id: 4, a: [30, 16], b: [0, 16] },
  ];
  const rules = [
    { k: 'tangent', a: 3, b: 1 },
    { k: 'tangent', a: 3, b: 4 },
    { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
  ];
  const out = splitWeldedCircles(geoms, rules);
  assert.deepEqual(out.replacedIds, [3]);
  const arcs = out.geoms.filter((g) => g.k === 'arc');
  assert.equal(arcs.length, 2, 'the circle became an arc pair');
  assert.equal(arcs[0].id, 3, 'the first arc keeps the circle id');
  // Both arcs share the circle's centre and radius.
  for (const a of arcs) {
    assert.deepEqual(a.c, [20, 8]);
    assert.equal(a.r, 8);
  }
  // The arc pair is welded at both junctions.
  const welds = out.rules.filter((r) => r.k === 'coincident');
  assert.equal(welds.length, 3, 'the original coincident + 2 new welds');
  // An untouched circle passes through.
  const out2 = splitWeldedCircles([{ k: 'circle', id: 1, c: [0, 0], r: 5 }], []);
  assert.deepEqual(out2.replacedIds, []);
  assert.equal(out2.geoms.length, 1);
});

// 16: mirror about Y flips x, duplicates internal rules, flips arc sense.
test('16: mirrorSelection duplicates the selection mirrored about an axis', () => {
  const geoms = [
    { k: 'line', id: 1, a: [5, 0], b: [15, 0] },
    { k: 'line', id: 2, a: [15, 0], b: [15, 10] },
  ];
  const rules = [{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }];
  const out = mirrorSelection(geoms, rules, [1, 2], 'y');
  assert.ok(out, 'a mirror happened');
  assert.equal(out.geoms.length, 4, '2 originals + 2 copies');
  const mirrored = out.geoms.find((g) => g.id === out.idMap.get(1));
  assert.ok(mirrored);
  assert.deepEqual(mirrored.a, [-5, 0], 'x flipped');
  // The internal rule was duplicated with remapped ids.
  assert.equal(out.rules.length, 2);
  const copy = out.rules[1];
  assert.equal(copy.k, 'coincident');
  assert.equal(copy.a, out.idMap.get(1));
  assert.equal(copy.b, out.idMap.get(2));
  // Rules that only touch unselected rows stay alone.
  const out2 = mirrorSelection(geoms, [{ k: 'horizontal', a: 1 }], [2], 'y');
  assert.equal(out2.rules.length, 1, 'a rule outside the selection is not duplicated');
});

// 17: copy shifts, densifyIds renumbers 100000-offset ids to 1..n.
test('17: copySelection shifts and densifyIds renumbers everything', () => {
  const geoms = [{ k: 'line', id: 1, a: [0, 0], b: [10, 0] }];
  const out = copySelection(geoms, [], [1], 5, 3);
  assert.ok(out);
  const copyId = out.idMap.get(1);
  const copy = out.geoms.find((g) => g.id === copyId);
  assert.deepEqual(copy.a, [5, 3]);
  assert.deepEqual(copy.b, [15, 3]);
  // Densify: the 100001 row becomes 2.
  const dense = densifyIds(out.geoms, out.rules);
  assert.deepEqual(dense.geoms.map((g) => g.id), [1, 2]);
});

// 18: THE SHAPE. A slot is an obround: each cap bulges AWAY from the other,
// so the drawn outline reaches the radius PAST both centres. Measured
// 2026-09-18 on the shipped rows: the caps bulged INWARD, drawing x over
// [0, 40] for centres at x=0 and x=40 with r=10 -- a rectangle with two
// semicircular notches, which the kernel then built at 4858.407346 against
// an obround's 11141.592654. A student saw the wrong PART, not just a wrong
// number. Pinned through the same arcAngles + sampleArc the canvas renders
// with, so the assertion reads what is drawn rather than what is stored.
test('18: slotRows draws an obround, its caps bulging away from the axis', () => {
  const out = slotRows({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 10 }, 1);
  assert.ok(out, 'a valid slot builds');
  const xs = [];
  for (const g of out.geoms) {
    if (g.k !== 'arc') { xs.push(g.a[0], g.b[0]); continue; }
    const ang = arcAngles(g);
    for (const p of sampleArc(g.c[0], g.c[1], g.r, ang.a0, ang.sweep)) xs.push(p.x);
  }
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  assert.ok(Math.abs(lo + 10) < 1e-9, `cap A must reach x=-10, drawn min was ${lo}`);
  assert.ok(Math.abs(hi - 50) < 1e-9, `cap B must reach x=50, drawn max was ${hi}`);
});

// 19: every weld names two points that are actually in the same place. The
// direction fix in 18 swaps each cap's ENDS, and a coincident whose end ref
// did not follow would weld a cap to the wrong corner -- a solve dragged
// inside out rather than an honest refusal.
test('19: every slot weld names two points that coincide', () => {
  const out = slotRows({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 10 }, 1);
  assert.ok(out);
  const at = (id, end) => {
    const g = out.geoms.find((x) => x.id === id);
    return end === 'a' ? g.a : g.b;
  };
  for (const r of out.rules) {
    if (r.k !== 'coincident') continue;
    const p = at(r.a, r.aEnd);
    const q = at(r.b, r.bEnd);
    assert.ok(
      Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9,
      `weld ${r.a}.${r.aEnd} <-> ${r.b}.${r.bEnd} names [${p}] and [${q}]`,
    );
  }
});

// 20: findSnap — the unified snap engine. Vertex/midpoint/center happy paths
// and the rank order among them.
test('20: findSnap ranks vertex over midpoint over onCurve within tolerance', () => {
  const geoms = [
    { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
    { k: 'circle', id: 2, c: [20, 20], r: 5 },
  ];
  // Vertex: the line's endpoint b.
  const v = findSnap(geoms, { x: 40, y: 0.5 }, 1);
  assert.equal(v.kind, 'vertex');
  assert.equal(v.id, 1);
  assert.equal(v.at, 'b');
  assert.deepEqual(v.world, { x: 40, y: 0 });
  // Midpoint of the line.
  const m = findSnap(geoms, { x: 20, y: 0.5 }, 1);
  assert.equal(m.kind, 'midpoint');
  assert.deepEqual(m.world, { x: 20, y: 0 });
  // Circle centre.
  // Circle centre: it is ALSO a named point ('c'), so vertex (rank 1) wins
  // over center (rank 2) per the decided rank table.
  const c = findSnap(geoms, { x: 20, y: 20.5 }, 1);
  assert.equal(c.kind, 'vertex');
  assert.equal(c.at, 'c');
  assert.equal(c.id, 2);
  // The center kind itself, scoped:
  const cOnly = findSnap(geoms, { x: 20, y: 20.5 }, 1, { kinds: ['center'] });
  assert.equal(cOnly.kind, 'center');
  assert.equal(cOnly.at, 'c');
  assert.equal(cOnly.id, 2);
  // onCurve: on the circle rim, away from any named point.
  const o = findSnap(geoms, { x: 25, y: 20 }, 0.5);
  assert.equal(o.kind, 'onCurve');
  assert.ok(Math.hypot(o.world.x - 25, o.world.y - 20) < 1e-9);
});

// 21: intersections — line-line, line-circle, circle-circle; parallel lines
// never report one.
test('21: findSnap line-line, line-circle, circle-circle intersections', () => {
  const lines = [
    { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
    { k: 'line', id: 2, a: [20, -10], b: [20, 30] },
  ];
  const x = findSnap(lines, { x: 20, y: 0.5 }, 1);
  assert.equal(x.kind, 'intersection');
  assert.deepEqual(x.world, { x: 20, y: 0 });
  // Parallel lines never cross (scoped to intersections: a midpoint of one
  // of the lines is a legitimate hit here).
  const par = [
    { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
    { k: 'line', id: 2, a: [0, 5], b: [40, 5] },
  ];
  assert.equal(findSnap(par, { x: 20, y: 2.5 }, 3, { kinds: ['intersection'] }), null);
  // Line-circle: the line y=20 crosses circle c=(20,20) r=5 at x=15 and x=25.
  const lc = [
    { k: 'line', id: 1, a: [0, 20], b: [40, 20] },
    { k: 'circle', id: 2, c: [20, 20], r: 5 },
  ];
  const lcx = findSnap(lc, { x: 15, y: 20.5 }, 1);
  assert.equal(lcx.kind, 'intersection');
  assert.ok(Math.abs(lcx.world.x - 15) < 1e-9 && Math.abs(lcx.world.y - 20) < 1e-9);
  // Circle-circle: c=(0,0) r=5 and c=(10,0) r=5 cross at (5, 0).
  const cc = [
    { k: 'circle', id: 1, c: [0, 0], r: 5 },
    { k: 'circle', id: 2, c: [10, 0], r: 5 },
  ];
  const ccx = findSnap(cc, { x: 5, y: 0.5 }, 1);
  assert.equal(ccx.kind, 'intersection');
  assert.ok(Math.abs(ccx.world.x - 5) < 1e-9 && Math.abs(ccx.world.y) < 1e-9);
});

// 22: tolerance — null once past tolWorld; tolWorld=0 is exact-hit only.
test('22: findSnap tolerance — null past tolWorld, exact at tolWorld=0', () => {
  const geoms = [{ k: 'line', id: 1, a: [0, 0], b: [40, 0] }];
  assert.equal(findSnap(geoms, { x: 20, y: 1.5 }, 1), null, 'past tolerance');
  const exact = findSnap(geoms, { x: 20, y: 0 }, 0);
  assert.ok(exact, 'an exact hit at tol 0 still snaps');
  assert.equal(exact.kind, 'midpoint');
  assert.equal(findSnap(geoms, { x: 20, y: 1e-9 }, 0), null, 'tol 0 admits nothing off the geometry');
});

// 23: an arc's midpoint snap respects the arc's actual sweep — a probe near
// the full circle's geometric midpoint but outside the sweep does not snap.
test('23: findSnap arc midpoint respects the sweep range', () => {
  const geoms = [ARC]; // quarter arc ccw from +x to +y
  const ang = arcAngles(ARC);
  const mid = ang.a0 + ang.sweep / 2;
  const midPt = { x: 10 * Math.cos(mid), y: 10 * Math.sin(mid) };
  const hit = findSnap(geoms, { x: midPt.x + 0.3, y: midPt.y + 0.3 }, 1);
  assert.equal(hit.kind, 'midpoint');
  assert.ok(Math.hypot(hit.world.x - midPt.x, hit.world.y - midPt.y) < 1e-9);
  // The full circle's geometric midpoint (180deg, (-10, 0)) is outside the
  // arc's sweep: no midpoint, no onCurve, nothing.
  assert.equal(findSnap(geoms, { x: -10 + 0.3, y: 0.3 }, 1), null);
});

// 24: onCurve never fires beyond a line segment's actual endpoints.
test('24: findSnap onCurve stops at a line segment endpoint', () => {
  const geoms = [{ k: 'line', id: 1, a: [0, 0], b: [40, 0] }];
  const on = findSnap(geoms, { x: 10, y: 0.4 }, 0.5);
  assert.equal(on.kind, 'onCurve');
  assert.deepEqual(on.world, { x: 10, y: 0 });
  // Far past the b endpoint: nothing within tolerance.
  assert.equal(findSnap(geoms, { x: 45, y: 0 }, 2), null);
});

// 25: grid snaps only when gridStep is supplied.
test('25: findSnap grid only when gridStep is given', () => {
  const geoms = [{ k: 'line', id: 1, a: [0, 0], b: [40, 0] }];
  assert.equal(findSnap(geoms, { x: 50, y: 50 }, 1), null, 'no gridStep, no grid snap');
  const g = findSnap(geoms, { x: 50.3, y: 49.7 }, 1, { gridStep: 10 });
  assert.equal(g.kind, 'grid');
  assert.deepEqual(g.world, { x: 50, y: 50 });
  assert.equal(g.id, undefined);
  assert.equal(g.at, undefined);
});

// 26: snapVertex keeps its contract through the findSnap delegation.
test('26: snapVertex still works through the findSnap delegation', () => {
  const geoms = [LINE, CIRCLE];
  const hit = snapVertex(geoms, { x: 40, y: 0 }, (p) => Math.hypot(p.x - 40, p.y - 0) * 2, 8);
  assert.equal(hit.id, 1);
  assert.equal(hit.at, 'b');
  assert.equal(snapVertex(geoms, { x: 40, y: 0 }, () => 20, 8), null);
});

// --- on-canvas dimensions + constraint glyphs (SPEC-mouse-parity P2.7/P2.8) ---

// 27: the midpoint a glyph or a dimension label hangs off, per geometry kind.
test('27: geomMidpoint reads each geometry kind', () => {
  assert.deepEqual(geomMidpoint(LINE), { x: 20, y: 0 });
  assert.deepEqual(geomMidpoint(CIRCLE), { x: 20, y: 20 });
  assert.deepEqual(geomMidpoint({ k: 'point', id: 9, p: [3, 4] }), { x: 3, y: 4 });
  // The arc's mid-SWEEP point, not the chord's middle: a quarter arc from
  // (10,0) to (0,10) about the origin peaks at 45 degrees.
  const m = geomMidpoint(ARC);
  assert.ok(Math.abs(m.x - 10 * Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(m.y - 10 * Math.SQRT1_2) < 1e-9);
  assert.equal(geomMidpoint({ k: 'blob', id: 1 }), null);
});

// 28: a picked LINE auto-detects as the distance between its own endpoints.
test('28: autoDimension turns a line pick into an endpoint distance', () => {
  const d = autoDimension([LINE], { id: 1, at: null });
  assert.equal(d.kind, 'distance');
  assert.equal(d.value, 40);
  assert.deepEqual(d.a, { id: 1, at: 'a' });
  assert.deepEqual(d.b, { id: 1, at: 'b' });
  assert.deepEqual(d.anchor, { x: 20, y: 0 });
});

// 29: a circle and an arc both auto-detect as RADIUS -- the convention
// openDimFromSelection already uses, so the canvas and the ribbon agree.
test('29: autoDimension reads a circle and an arc as radius', () => {
  const c = autoDimension([CIRCLE], { id: 2, at: null });
  assert.equal(c.kind, 'radius');
  assert.equal(c.value, 5);
  assert.equal(c.b, null);
  const a = autoDimension([ARC], { id: 3, at: null });
  assert.equal(a.kind, 'radius');
  assert.equal(a.value, 10);
});

// 30: two picked POINTS auto-detect as a point-to-point distance.
test('30: autoDimension turns two point picks into a point distance', () => {
  const geoms = [LINE, { k: 'line', id: 4, a: [0, 30], b: [40, 30] }];
  const d = autoDimension(geoms, { id: 1, at: 'a' }, { id: 4, at: 'a' });
  assert.equal(d.kind, 'distance');
  assert.equal(d.value, 30);
  assert.deepEqual(d.anchor, { x: 0, y: 15 });
});

// 31: nothing to dimension -- a lone point pick waits for its partner, a
// bare point row and a dangling id have no dimension at all.
test('31: autoDimension refuses what it cannot measure', () => {
  assert.equal(autoDimension([LINE], { id: 1, at: 'a' }), null, 'one point is not a distance');
  assert.equal(autoDimension([LINE], { id: 99, at: null }), null, 'dangling id');
  assert.equal(autoDimension([{ k: 'point', id: 1, p: [0, 0] }], { id: 1, at: null }), null);
});

// 32: the invalid values that must produce a status note and no doc change.
test('32: dimensionValueError names every value the solver cannot take', () => {
  assert.ok(dimensionValueError('distance', ''));
  assert.ok(dimensionValueError('distance', '   '));
  assert.ok(dimensionValueError('distance', 'abc'));
  assert.ok(dimensionValueError('distance', '0'));
  assert.ok(dimensionValueError('distance', '-5'));
  assert.ok(dimensionValueError('radius', '-1'));
  assert.ok(dimensionValueError('angle', '0'));
  assert.equal(dimensionValueError('distance', '30'), null);
  assert.equal(dimensionValueError('radius', '2.5'), null);
  // distanceX/distanceY are SIGNED offsets: a negative one names the other
  // direction and zero names a shared axis, so both are real answers.
  assert.equal(dimensionValueError('distanceX', '-12'), null);
  assert.equal(dimensionValueError('distanceY', '0'), null);
});

// 33: where each rule kind's glyph hangs -- one geometry's midpoint, the
// midpoint of two, or the named point itself.
test('33: ruleGlyphAnchors places a glyph per rule', () => {
  const geoms = [LINE, { k: 'line', id: 4, a: [0, 30], b: [40, 30] }];
  const [horiz, para, coin] = ruleGlyphAnchors(
    geoms,
    [
      { k: 'horizontal', a: 1 },
      { k: 'parallel', a: 1, b: 4 },
      { k: 'coincident', a: 1, aEnd: 'b', b: 4, bEnd: 'b' },
    ],
    2,
  );
  assert.deepEqual(horiz, { x: 20, y: 0 }, 'a unary rule sits on its line');
  assert.deepEqual(para, { x: 20, y: 15 }, 'a pair rule sits between the two');
  assert.deepEqual(coin, { x: 40, y: 15 }, 'a point rule sits between the points');
});

// 34: rules that land on the SAME spot fan out, so a line carrying both a
// horizontal and a distance shows two readable glyphs rather than one blur.
test('34: ruleGlyphAnchors fans out rules that share an anchor', () => {
  const anchors = ruleGlyphAnchors([LINE], [{ k: 'horizontal', a: 1 }, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }], 3);
  assert.deepEqual(anchors[0], { x: 20, y: 0 });
  assert.deepEqual(anchors[1], { x: 23, y: 0 });
  // The array is INDEX-ALIGNED with the rules it was given: the glyph layer
  // identifies a rule by its index, and a hole must stay a hole.
  const withHole = ruleGlyphAnchors([LINE], [{ k: 'vertical', a: 77 }, { k: 'horizontal', a: 1 }], 3);
  assert.equal(withHole.length, 2);
  assert.equal(withHole[0], null, 'a rule naming geometry that is not here has no anchor');
  assert.deepEqual(withHole[1], { x: 20, y: 0 });
});

// 35: symmetric names three geometries and averages all three.
test('35: ruleGlyphAnchors averages a three-point symmetric rule', () => {
  const geoms = [
    { k: 'point', id: 1, p: [0, 0] },
    { k: 'point', id: 2, p: [30, 0] },
    { k: 'point', id: 3, p: [15, 30] },
  ];
  const [a] = ruleGlyphAnchors(geoms, [{ k: 'symmetric', a: 1, aEnd: 'a', b: 2, bEnd: 'a', c: 3, cEnd: 'a' }], 2);
  assert.deepEqual(a, { x: 15, y: 10 });
});
