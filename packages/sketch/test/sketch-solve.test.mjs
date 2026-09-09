// Unit tests for the P1d solver additions (distanceX, distanceY, symmetric,
// angle) and the corner-vs-edge remap/removal machinery they forced open.
// Against `../dist/` -- these are TypeScript sources, so the suite runs
// against the built output the workspace already produces, same convention
// as packages/script/test/transpile.test.mjs importing the compiled bridge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  solveSketch,
  residualsOf,
  losingEdges,
  describe,
  describeRemovalNote,
} from '../dist/sketch-solve.js';
import { reindex, removeCorner } from '../dist/sketch-arc.js';

const UNIT_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];

// T1 -- distanceX 30 between corners 0 and 2 of a unit square.
test('distanceX solves the gap between two corners along X', () => {
  const r = solveSketch(UNIT_SQUARE, [{ kind: 'distanceX', a: 0, b: 2, value: 30 }]);
  assert.ok(Math.abs(r.points[2][0] - r.points[0][0] - 30) < 1e-6, r.points);
});

// T2 -- distanceY with a NEGATIVE value: the sign is honoured, not stripped.
test('distanceY honours a negative value (signed, not absolute)', () => {
  const r = solveSketch(UNIT_SQUARE, [{ kind: 'distanceY', a: 0, b: 2, value: -15 }]);
  assert.ok(Math.abs(r.points[2][1] - r.points[0][1] - -15) < 1e-6, r.points);
});

// T3 -- symmetric a=0, b=2, center=1: corner 1 lands on the midpoint of the
// (solved) corners 0 and 2. residual -> 0 IS this equation, so this holds
// regardless of how the least-squares step distributes movement across a/b/center.
test('symmetric puts the center corner at the midpoint of a and b', () => {
  const r = solveSketch(UNIT_SQUARE, [{ kind: 'symmetric', a: 0, b: 2, center: 1 }]);
  const midX = (r.points[0][0] + r.points[2][0]) / 2;
  const midY = (r.points[0][1] + r.points[2][1]) / 2;
  assert.ok(Math.abs(r.points[1][0] - midX) < 1e-6, r.points);
  assert.ok(Math.abs(r.points[1][1] - midY) < 1e-6, r.points);
});

// T4 -- angle 90 degrees between two edges: residual small AND the measured
// turn is +90, not the wrapped-around 270 (or -90) a sign slip would produce.
test('angle 90 degrees converges to +90, not 270', () => {
  // Edge 0->1 starts along +X; edge 1->2 starts a few degrees off it (CCW),
  // so the near basin for a 90 degree ask is +90, not -90 -- a solver that
  // wrapped the target wrong would converge to the wrong basin instead of
  // just being slow.
  const quad = [[0, 0], [10, 0], [20, 1], [0, 10]];
  const r = solveSketch(quad, [{ kind: 'angle', edge: 0, other: 1, degrees: 90 }]);
  const residuals = residualsOf(r.points, [{ kind: 'angle', edge: 0, other: 1, degrees: 90 }]);
  assert.ok(residuals[0] < 1e-3, residuals[0]);

  const ax = r.points[1][0] - r.points[0][0], ay = r.points[1][1] - r.points[0][1];
  const bx = r.points[2][0] - r.points[1][0], by = r.points[2][1] - r.points[1][1];
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  const dot = (ax * bx + ay * by) / (la * lb);
  const cross = (ax * by - ay * bx) / (la * lb);
  const turnDeg = (Math.atan2(cross, dot) * 180) / Math.PI;
  assert.ok(Math.abs(turnDeg - 90) < 1e-3, turnDeg);
});

// T5 -- angle 350 and angle -10 name the same edge relationship (SS1.2's
// wrap). Solved from the same start, they must land on the same points.
test('angle 350 degrees and angle -10 degrees solve to identical points', () => {
  const quad = [[0, 0], [10, 0], [20, 1], [0, 10]];
  const r350 = solveSketch(quad, [{ kind: 'angle', edge: 0, other: 1, degrees: 350 }]);
  const rNeg10 = solveSketch(quad, [{ kind: 'angle', edge: 0, other: 1, degrees: -10 }]);
  for (let i = 0; i < quad.length; i++) {
    assert.ok(Math.abs(r350.points[i][0] - rNeg10.points[i][0]) < 1e-4, `corner ${i} x`);
    assert.ok(Math.abs(r350.points[i][1] - rNeg10.points[i][1]) < 1e-4, `corner ${i} y`);
  }
});

// T6 -- describe() / describeQuality() (the latter only reachable through
// describeRemovalNote(), which is the exported surface) for all four kinds:
// no NaN, no undefined anywhere in the string.
test('describe and describeRemovalNote never print NaN or undefined for the four new kinds', () => {
  const kinds = [
    { kind: 'distanceX', a: 0, b: 1, value: 5 },
    { kind: 'distanceY', a: 0, b: 1, value: -5 },
    { kind: 'symmetric', a: 0, b: 1, center: 2 },
    { kind: 'angle', edge: 0, other: 1, degrees: 90 },
  ];
  for (const c of kinds) {
    const s = describe(c);
    assert.ok(!s.includes('NaN') && !s.includes('undefined'), `describe(${c.kind}): ${s}`);
  }
  for (let i = 0; i < kinds.length; i++) {
    const note = describeRemovalNote(kinds[i], kinds[(i + 1) % kinds.length]);
    assert.ok(!note.includes('NaN') && !note.includes('undefined'), `removalNote(${kinds[i].kind}): ${note}`);
  }
});

// T7 -- reindex() after inserting a corner before a symmetric rule: all
// three of a/b/center shift, not just one.
test('reindex shifts every corner a symmetric rule names', () => {
  const f = {
    points: [[0, 0], [1, 0], [1, 1], [0, 1]],
    constraints: [{ kind: 'symmetric', a: 1, b: 2, center: 3 }],
  };
  const r = reindex(f, 0); // insert a corner right after corner 0
  assert.deepEqual(r.constraints, [{ kind: 'symmetric', a: 2, b: 3, center: 4 }]);
});

// T8 -- removeCorner() on a corner named by a distanceX rule: that rule is
// dropped, and neighbouring corner-indexed rules are re-shifted.
test('removeCorner drops a distanceX rule that names the removed corner', () => {
  const f = {
    points: [[0, 0], [10, 0], [10, 10], [0, 10]],
    constraints: [
      { kind: 'distanceX', a: 1, b: 3, value: 5 },
      { kind: 'lock', corner: 3 },
    ],
  };
  const r = removeCorner(f, 1);
  assert.deepEqual(r.constraints, [{ kind: 'lock', corner: 2 }]);
});

// T9 -- losingEdges() with a violated distanceX: returns [], not [NaN]. The
// regression test for section 0's broken invariant -- before the fix,
// `out.add(wrap(c.edge))` read `.edge` off a constraint that has no `.edge`.
test('losingEdges returns no edges for a violated corner rule, not NaN', () => {
  const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const c = { kind: 'distanceX', a: 0, b: 2, value: 999 }; // actual gap is 10, badly violated
  const residuals = residualsOf(pts, [c]);
  assert.ok(Number.isFinite(residuals[0]) && residuals[0] > 1e-3, residuals[0]);
  assert.deepEqual(losingEdges(pts, [c]), []);
});
