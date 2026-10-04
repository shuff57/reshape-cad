// 2D audit: sketch-arc.ts and sketch-outline.ts had no tests. Oracles are closed forms (shoelace, rounded-corner
// area, circular segment, sagitta identities), not outputs of the code under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arcFromBulge, circleOf, maxFilletRadius, whyCannotRoundCorner, maxChamferDistance, whyCannotChamferCorner,
  filletCorner, chamferCorner, tessellate, outlineOf, segmentRoles, bulgeFromBow, bowOf, maxBow, bowEdge,
  whyCannotBowEdge, whyCannotRemoveCorner, whyRemovingCornerCosts, removeCorner, splitEdge,
} from '../dist/sketch-arc.js';
import { formatLabel, circleLabel } from '../dist/sketch-outline.js';
import { buildSlotRows } from '../dist/sketch-slot.js';

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} vs ${b}`);
const shoelace = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
const RECT = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

// ---- arcFromBulge ---------------------------------------------------------------------------------
test('bulge 1 is a half circle: radius = chord / 2, centre on the chord midpoint', () => {
  const { center, radius } = arcFromBulge([0, 0], [10, 0], 1);
  near(radius, 5); near(center[0], 5); near(center[1], 0, 1e-9);
});
test('sagitta = half chord x |bulge|, for minor and major arcs and both signs', () => {
  for (const g of [0.1, 0.5, 1, -0.3, 2, -2.5]) {
    const a = [1, 2], b = [7, 10], d = Math.hypot(6, 8);
    const { center, radius } = arcFromBulge(a, b, g);
    // both ends on the circle
    near(Math.hypot(a[0] - center[0], a[1] - center[1]), radius, 1e-9, `a g=${g}`);
    near(Math.hypot(b[0] - center[0], b[1] - center[1]), radius, 1e-9, `b g=${g}`);
    // the arc's furthest point from the chord stands (d/2)|g| away (minor) or radius + offset (major)
    const included = 4 * Math.atan(Math.abs(g));
    near(radius, d / (2 * Math.sin(included / 2)), 1e-9, `radius g=${g}`);
  }
});
test('a positive bulge puts the centre on the left of a -> b (the hand-worked fillet in the file header)', () => {
  const { center, radius } = arcFromBulge([25, 0], [28, 9], 0.720748);
  near(center[0], 25, 1e-4); near(center[1], 5, 1e-4); near(radius, 5, 1e-4);
});
test('circleOf reads the tag, never the points', () => {
  assert.equal(circleOf({ points: [[0, 0], [4, 0]] }), null);
  const c = circleOf({ shape: 'circle', points: [[0, 0], [4, 0]] });
  near(c.radius, 2); assert.deepEqual(c.center, [2, 0]);
});

// ---- fillet and chamfer limits --------------------------------------------------------------------
test('maxFilletRadius: half the shorter edge at 90 degrees, exact', () => {
  near(maxFilletRadius(RECT(30, 20), 0), 10);
  near(maxFilletRadius(RECT(30, 20), 2), 10);
});
test('maxFilletRadius at other angles: (shorter edge / 2) tan(interior / 2)', () => {
  const tri = [[0, 0], [40, 0], [0, 30]];
  const alpha = Math.atan2(30, 40); // interior angle at (40, 0)
  near(maxFilletRadius(tri, 1), 20 * Math.tan(alpha / 2));
  const equilateral = [[0, 0], [10, 0], [5, 5 * Math.sqrt(3)]];
  near(maxFilletRadius(equilateral, 0), 5 * Math.tan(Math.PI / 6));
});
test('maxFilletRadius is 0 for a straight corner, a zero-length edge, a curved neighbour', () => {
  assert.equal(maxFilletRadius([[0, 0], [5, 0], [10, 0], [10, 10]], 1), 0);
  assert.equal(maxFilletRadius([[0, 0], [0, 0], [10, 0], [10, 10]], 1), 0);
  assert.equal(maxFilletRadius(RECT(10, 10), 1, { 0: 0.5 }), 0);
  assert.equal(maxChamferDistance([[0, 0], [5, 0], [10, 0], [10, 10]], 1), 0);
  assert.equal(maxChamferDistance(RECT(10, 10), 1, { 1: -0.4 }), 0);
});
test('maxChamferDistance is the shorter edge', () => near(maxChamferDistance(RECT(30, 20), 0), 20));
test('whyCannot*: a sentence exactly when the ceiling is 0, and never jargon', () => {
  const cases = [
    [[[0, 0], [5, 0], [10, 0], [10, 10]], 1, undefined],
    [[[0, 0], [0, 0], [10, 0], [10, 10]], 1, undefined],
    [RECT(10, 10), 1, { 0: 0.5 }],
  ];
  for (const [pts, k, bulges] of cases) {
    for (const f of [whyCannotRoundCorner, whyCannotChamferCorner]) {
      const s = f(pts, k, bulges);
      assert.equal(typeof s, 'string');
      assert.doesNotMatch(s, /bulge|tangent|constraint|degenerate|NaN|infinity|solver|jacobian|epsilon/i, s);
    }
  }
  assert.equal(whyCannotRoundCorner(RECT(10, 10), 0), null);
  assert.equal(whyCannotChamferCorner(RECT(10, 10), 0), null);
});

test('filletCorner at, below and beyond the maximum: area removed = r^2 (1 - pi/4) at 90 degrees', () => {
  for (const r of [1, 4.99, 5]) {
    const out = filletCorner({ points: RECT(20, 10) }, 0, r);
    const poly = tessellate({ points: out.points, bulges: out.bulges });
    // tessellate samples arcs, so its area is a hair under the exact one: bound it both ways
    const exact = 200 - (1 - Math.PI / 4) * r * r;
    assert.ok(shoelace(poly) <= exact + 1e-9 && shoelace(poly) > exact - 0.01 * r * r, `r=${r}: ${shoelace(poly)} vs ${exact}`);
  }
  const beyond = filletCorner({ points: RECT(20, 10) }, 0, 50);
  const atMax = filletCorner({ points: RECT(20, 10) }, 0, 5);
  assert.deepEqual(beyond.points, atMax.points);
});
test('filletCorner refuses (returns the sketch) on a straight corner and refuses nothing silently into garbage', () => {
  const f = { points: [[0, 0], [5, 0], [10, 0], [10, 10]] };
  assert.equal(filletCorner(f, 1, 3), f);
  assert.equal(chamferCorner(f, 1, 3), f);
});
test('chamferCorner beyond the shorter edge is cut to it; area removed = d^2 / 2', () => {
  for (const d of [2, 10]) near(shoelace(chamferCorner({ points: RECT(20, 10) }, 0, d).points), 200 - d * d / 2);
  near(shoelace(chamferCorner({ points: RECT(20, 10) }, 0, 99).points), 200 - 50);
});
test('fillet tangent points: trim = r / tan(interior / 2) from the corner along both edges', () => {
  const tri = [[0, 0], [40, 0], [0, 30]];
  const alpha = Math.atan2(30, 40);
  const out = filletCorner({ points: tri }, 1, 3);
  const trim = 3 / Math.tan(alpha / 2);
  near(out.points[1][0], 40 - trim); near(out.points[1][1], 0);
  near(Math.hypot(out.points[2][0] - 40, out.points[2][1]), trim);
});

// ---- outlineOf: the rule that decides every corner's share ---------------------------------------
const area = (f) => { const o = outlineOf(f); return shoelace(tessellate({ points: o.points, bulges: o.bulges })); };
test('four equal rounds on 30 x 20: every corner gets what it asked for up to 10 (was held to half of what a neighbour left)', () => {
  for (const r of [2, 8, 9.9, 10]) {
    const o = outlineOf({ points: RECT(30, 20), rounds: { 0: r, 1: r, 2: r, 3: r } });
    assert.deepEqual(o.notes, [], `r=${r}`);
    const exact = 600 - (4 - Math.PI) * r * r;
    assert.ok(area({ points: RECT(30, 20), rounds: { 0: r, 1: r, 2: r, 3: r } }) <= exact + 1e-9);
    assert.ok(area({ points: RECT(30, 20), rounds: { 0: r, 1: r, 2: r, 3: r } }) > exact - 0.012 * 4 * r * r, `r=${r}`);
  }
});
test('outlineOf does not depend on the order rounds are listed, and notes name what was cut', () => {
  const a = outlineOf({ points: RECT(30, 20), rounds: { 0: 15, 1: 15, 2: 15, 3: 15 } });
  const b = outlineOf({ points: RECT(30, 20), rounds: { 3: 15, 2: 15, 1: 15, 0: 15 } });
  assert.deepEqual(a.points, b.points);
  assert.equal(a.notes.length, 4);
  for (const n of a.notes) { near(n.want, 15); near(n.got, 10); }
});
test('two chamfers that want more than their shared edge share it in proportion', () => {
  const o = outlineOf({ points: RECT(30, 20), chamfers: { 0: 15, 3: 15 } });
  assert.equal(o.notes.length, 2);
  for (const n of o.notes) near(n.got, 10);
  near(shoelace(o.points), 600 - 100);
});
test('a round on a straight corner or beside a curved edge is reported as taking nothing', () => {
  const o = outlineOf({ points: [[0, 0], [10, 0], [20, 0], [20, 10], [0, 10]], rounds: { 1: 3 } });
  assert.deepEqual(o.notes, [{ corner: 1, want: 3, got: 0 }]);
  assert.equal(o.points.length, 5);
});
test('round beats chamfer on one corner; non-positive or out-of-range asks are ignored', () => {
  const o = outlineOf({ points: RECT(30, 20), rounds: { 0: 5 }, chamfers: { 0: 8, 9: 3, 1: 0, 2: -4 } });
  assert.deepEqual(o.notes, []);
  assert.equal(o.points.length, 5);
});
test('basis says which design corner every outline point came from; roles name edges and treated corners', () => {
  const o = outlineOf({ points: RECT(30, 20), rounds: { 2: 4 } });
  assert.deepEqual(o.basis, [0, 1, 2, 2, 3]);
  assert.deepEqual(segmentRoles(o.basis), [
    { role: 'edge', index: 0 }, { role: 'edge', index: 1 }, { role: 'corner', index: 2 }, { role: 'edge', index: 2 }, { role: 'edge', index: 3 },
  ]);
});
test('collapsed design (two corners on top of each other) is not ok, with a sentence naming no remedy', () => {
  const o = outlineOf({ points: [[0, 0], [10, 0], [10, 0], [0, 10]] });
  assert.equal(o.ok, false);
  assert.match(o.why, /no length at all/);
  assert.doesNotMatch(o.why, /bulge|constraint/i);
});
test('a circle passes through untouched', () => {
  const o = outlineOf({ shape: 'circle', points: [[0, 0], [10, 0]] });
  assert.equal(o.ok, true); assert.deepEqual(o.points, [[0, 0], [10, 0]]);
});

// ---- bows ----------------------------------------------------------------------------------------
test('bow <-> bulge round trip, clamp at half the chord, zero chord is straight (no NaN)', () => {
  const pts = RECT(10, 10);
  near(bulgeFromBow(pts, 0, 2.5), 0.5);
  near(bowOf(pts, 0, { 0: bulgeFromBow(pts, 0, 2.5) }), 2.5);
  near(bulgeFromBow(pts, 0, 99), 1); near(maxBow(pts, 0), 5);
  assert.equal(bulgeFromBow([[0, 0], [0, 0], [5, 5]], 0, 3), 0);
  assert.equal(bulgeFromBow(pts, 0, NaN), 0);
});
test('whyCannotBowEdge: a sentence past the half circle, for a collapsed edge and for NaN', () => {
  assert.equal(whyCannotBowEdge(RECT(10, 10), 0, 5), null);
  assert.match(whyCannotBowEdge(RECT(10, 10), 0, 6), /half circle/);
  assert.match(whyCannotBowEdge([[0, 0], [0, 0], [5, 5]], 0, 1), /no length/);
  assert.match(whyCannotBowEdge(RECT(10, 10), 0, NaN), /not a number/);
});
test('bowEdge to a half circle adds pi r^2 / 2 of area', () => {
  const f = bowEdge({ points: RECT(10, 10) }, 0, 5);
  const poly = tessellate({ points: f.points, bulges: f.bulges });
  const exact = 100 + Math.PI * 25 / 2;
  assert.ok(Math.abs(shoelace(poly) - exact) < 0.01 * exact);
  assert.equal(bowEdge(f, 0, 0).bulges, undefined);
});
test('splitEdge keeps a bowed edge on the same circle (the two halves are arcs of one circle)', () => {
  const f = bowEdge({ points: RECT(10, 10) }, 0, 3);
  const s = splitEdge(f, 0);
  assert.equal(s.points.length, 5);
  const before = arcFromBulge(f.points[0], f.points[1], f.bulges[0]);
  for (const e of [0, 1]) {
    const arc = arcFromBulge(s.points[e], s.points[e + 1], s.bulges[e]);
    near(arc.radius, before.radius, 1e-9); near(arc.center[0], before.center[0], 1e-9); near(arc.center[1], before.center[1], 1e-9);
  }
});

// ---- removing a corner ---------------------------------------------------------------------------
test('removeCorner: a triangle keeps all three; removal says what it costs in the student\'s words', () => {
  assert.match(whyCannotRemoveCorner({ points: [[0, 0], [1, 0], [0, 1]] }, 0), /at least three corners/);
  assert.equal(removeCorner({ points: RECT(4, 4) }, 1).points.length, 3);
  const msg = whyRemovingCornerCosts({ points: RECT(4, 4), rounds: { 1: 1 }, bulges: { 0: 0.3 } }, 1);
  assert.match(msg, /^Removing corner 2 joins the two edges beside it into one, so a curve and its round go with it\.$/);
  assert.doesNotMatch(msg, /bulge|constraint/i);
});

// ---- slot rows -----------------------------------------------------------------------------------
test('buildSlotRows: null for a zero radius or equal centres; otherwise four pieces whose caps are semicircles', () => {
  assert.equal(buildSlotRows([0, 0], [10, 0], 0, 1), null);
  assert.equal(buildSlotRows([3, 3], [3, 3], 2, 1), null);
  const s = buildSlotRows([0, 0], [30, 0], 5, 4);
  assert.deepEqual(s.ids, { arc1: 4, arc2: 5, top: 6, bottom: 7 });
  assert.equal(s.geoms.length, 4);
  assert.equal(s.rules.filter((r) => r.k === 'tangent').length, 4);
  // every arc end is on its circle, the sides run between the caps, and the area is 2 r len + pi r^2
  for (const g of s.geoms.filter((x) => x.k === 'arc')) for (const p of [g.a, g.b]) near(Math.hypot(p[0] - g.c[0], p[1] - g.c[1]), g.r, 1e-12);
  const top = s.geoms.find((g) => g.id === 6), bottom = s.geoms.find((g) => g.id === 7);
  near(Math.hypot(top.b[0] - top.a[0], top.b[1] - top.a[1]), 30);
  near(Math.abs(top.a[1] - bottom.b[1]), 10);
});
test('buildSlotRows keeps its caps round when the slot is slanted', () => {
  const s = buildSlotRows([1, 2], [31, 42], 6, 1);
  for (const g of s.geoms.filter((x) => x.k === 'arc')) near(Math.hypot(g.a[0] - g.b[0], g.a[1] - g.b[1]), 12, 1e-9);
});

// ---- label text ----------------------------------------------------------------------------------
test('formatLabel: whole numbers stay whole, noise does not grow decimals', () => {
  assert.equal(formatLabel(40), '40'); assert.equal(formatLabel(17.5), '17.5'); assert.equal(formatLabel(40.0000001), '40');
  assert.equal(formatLabel(2.456), '2.46'); assert.equal(formatLabel(0.1 + 0.2), '0.3');
});
test('circleLabel reads a diameter pair', () => {
  const c = circleLabel([[0, 0], [10, 0]]);
  assert.ok(c);
});
