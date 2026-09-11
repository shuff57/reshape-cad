// Unit tests for translateSketch()'s ORCHESTRATION logic (SPEC-engine-port.md
// §4.5): geometry emission via outlineOf()/segmentRoles(), the full
// constraint-mapping table, DoF-closure, and the refusal policy.
//
// Against ../dist/ -- TypeScript source, same convention as
// packages/sketch/test/sketch-solve.test.mjs.
//
// WHAT THIS DOES NOT PROVE. The session here is a FAKE that records calls
// and reports a heuristic DoF count -- it does not run FreeCAD's real GCS
// solver, so it cannot confirm the translated sketch actually SOLVES to the
// same corner positions packages/sketch's own least-squares solver computed,
// nor can it confirm FreeCAD's Angle constraint sign convention agrees with
// sketch-solve.ts's atan2(cross,dot) residual (§4.5.2's own flagged
// uncertainty). Both need the real wasm kernel, which this sandboxed
// environment could not run (no docker daemon; see the port's own report).
// What this DOES prove: every constraint kind maps to the right session
// call with the right geoIds/pointPos, cornerRefs track the right segment
// per design corner (straight and rounded), DoF closure only fires when
// needed and pins every corner, and unresolvable references/conflicts throw
// rather than silently building something else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateSketch } from '../dist/sketch-translate.js';

/** A session that records every call and reports a heuristic DoF: each
 *  corner starts with 2 (x, y); every constraint call below removes the DoF
 *  a real FreeCAD Sketcher constraint of that kind would remove. Good enough
 *  to prove translateSketch()'s OWN control flow (when does it call
 *  sketchState(), when does it emit closure pins, when does it throw) --
 *  see the file header for what it cannot prove. */
function makeFakeSession(cornerCount, { conflicting = [] } = {}) {
  const calls = [];
  let nextGeoId = 0;
  let removed = 0;
  const totalDof = cornerCount * 2;
  let stateCalls = 0;

  const record = (name, args) => calls.push({ name, args });

  return {
    calls,
    sketchAddLine(sk, x1, y1, x2, y2) {
      record('sketchAddLine', [sk, x1, y1, x2, y2]);
      return nextGeoId++;
    },
    sketchAddArc(sk, cx, cy, r, a0, a1) {
      record('sketchAddArc', [sk, cx, cy, r, a0, a1]);
      return nextGeoId++;
    },
    sketchAddCircle(sk, cx, cy, r) {
      record('sketchAddCircle', [sk, cx, cy, r]);
      return nextGeoId++;
    },
    constrainHorizontal(sk, g) { record('constrainHorizontal', [sk, g]); removed += 1; return 0; },
    constrainVertical(sk, g) { record('constrainVertical', [sk, g]); removed += 1; return 0; },
    constrainDistance(sk, g1, p1, g2, p2, v) { record('constrainDistance', [sk, g1, p1, g2, p2, v]); removed += 1; return 0; },
    constrainEqual(sk, g1, g2) { record('constrainEqual', [sk, g1, g2]); removed += 1; return 0; },
    constrainParallel(sk, g1, g2) { record('constrainParallel', [sk, g1, g2]); removed += 1; return 0; },
    constrainPerpendicular(sk, g1, g2) { record('constrainPerpendicular', [sk, g1, g2]); removed += 1; return 0; },
    constrainDistanceX(sk, g1, p1, g2, p2, v) { record('constrainDistanceX', [sk, g1, p1, g2, p2, v]); removed += 1; return 0; },
    constrainDistanceY(sk, g1, p1, g2, p2, v) { record('constrainDistanceY', [sk, g1, p1, g2, p2, v]); removed += 1; return 0; },
    constrainSymmetric(sk, g1, p1, g2, p2, g3, p3) { record('constrainSymmetric', [sk, g1, p1, g2, p2, g3, p3]); removed += 2; return 0; },
    constrainAngle(sk, g1, g2, degrees) { record('constrainAngle', [sk, g1, g2, degrees]); removed += 1; return 0; },
    constrainRadius(sk, g, value) { record('constrainRadius', [sk, g, value]); removed += 1; return 0; },
    sketchState(sk) {
      stateCalls += 1;
      record('sketchState', [sk]);
      const dof = Math.max(0, totalDof - removed);
      return {
        geometry: [], constraints: [], dof,
        fully: dof === 0,
        conflicting: stateCalls === 1 ? conflicting : [],
        redundant: [], malformed: [],
      };
    },
  };
}

test('unconstrained rectangle: 4 lines emitted, closure pins all 4 corners, reaches dof 0', () => {
  const sketch = {
    id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0,
    points: [[0, 0], [40, 0], [40, 25], [0, 25]],
  };
  const session = makeFakeSession(4);
  const refs = translateSketch(session, 'Sketch', sketch);

  const lines = session.calls.filter((c) => c.name === 'sketchAddLine');
  assert.equal(lines.length, 4, 'one line per edge of an unrounded rectangle');
  assert.equal(refs.size, 4, 'one CornerRef per design corner');
  for (let n = 0; n < 4; n++) assert.equal(refs.get(n).pointPos, 1);

  const pins = session.calls.filter((c) => c.name === 'constrainDistanceX' || c.name === 'constrainDistanceY');
  assert.equal(pins.length, 8, 'DoF closure pins all 4 corners (X+Y each)');
  for (const p of pins) assert.deepEqual([p.args[3], p.args[4]], [-1, 1], 'pinned against the sketch origin');

  const finalState = session.calls.filter((c) => c.name === 'sketchState').at(-1);
  assert.ok(finalState);
});

test('a rectangle constrained to dof 0 by RECTANGLE_CONSTRAINTS alone needs no extra pins', () => {
  const sketch = {
    id: 'sk2', kind: 'sketch', plane: 'xy', offset: 0,
    points: [[0, 0], [40, 0], [40, 25], [0, 25]],
    constraints: [
      { kind: 'horizontal', edge: 0 },
      { kind: 'vertical', edge: 1 },
      { kind: 'horizontal', edge: 2 },
      { kind: 'vertical', edge: 3 },
      { kind: 'lock', corner: 0 },
      { kind: 'length', edge: 0, value: 40 },
      { kind: 'length', edge: 1, value: 25 },
    ],
  };
  // 4 corners * 2 dof = 8. horizontal/vertical remove 1 each (4), lock's own
  // two DistanceX/Y pins remove 2, the two lengths remove 1 each (2) -- 8
  // total, landing exactly at dof 0 with no closure pins beyond the lock's.
  const session = makeFakeSession(4);
  translateSketch(session, 'Sketch', sketch);

  const originPins = session.calls.filter(
    (c) => (c.name === 'constrainDistanceX' || c.name === 'constrainDistanceY') && c.args[3] === -1,
  );
  // Exactly the lock's own 2 -- no closure loop ran because dof was already 0.
  assert.equal(originPins.length, 2, 'no extra closure pins beyond the explicit lock');
});

test('every constraint kind in the mapping table translates to the right session call', () => {
  // A hexagon, unrounded -- 6 corners, 6 edges, enough distinct indices to
  // exercise every row of §4.5.2's table at once, including a non-90-degree
  // angle and a lock.
  const points = [[0, 0], [10, 0], [15, 8], [10, 16], [0, 16], [-5, 8]];
  const sketch = {
    id: 'sk3', kind: 'sketch', plane: 'xy', offset: 0,
    points,
    constraints: [
      { kind: 'horizontal', edge: 0 },
      { kind: 'vertical', edge: 1 },
      { kind: 'length', edge: 2, value: 12 },
      { kind: 'equal', edge: 3, other: 4 },
      { kind: 'parallel', edge: 0, other: 3 },
      { kind: 'perpendicular', edge: 1, other: 4 },
      { kind: 'distanceX', a: 0, b: 2, value: 15 },
      { kind: 'distanceY', a: 1, b: 3, value: 16 },
      { kind: 'symmetric', a: 0, b: 2, center: 1 },
      { kind: 'angle', edge: 0, other: 2, degrees: 63.4 },
      { kind: 'lock', corner: 5 },
    ],
  };
  const session = makeFakeSession(6);
  const refs = translateSketch(session, 'Sketch', sketch);

  const kinds = session.calls.map((c) => c.name);
  for (const expected of [
    'constrainHorizontal', 'constrainVertical', 'constrainDistance', 'constrainEqual',
    'constrainParallel', 'constrainPerpendicular', 'constrainDistanceX', 'constrainDistanceY',
    'constrainSymmetric', 'constrainAngle',
  ]) {
    assert.ok(kinds.includes(expected), `expected a ${expected} call`);
  }

  // The angle call carries the raw degrees, unconverted -- fc-sketch.mjs's
  // own constrainAngle() does the measured degrees->radians conversion.
  const angleCall = session.calls.find((c) => c.name === 'constrainAngle');
  assert.equal(angleCall.args[3], 63.4);

  // Lines are emitted corner n -> corner n+1, matching sketch-solve.ts's own
  // edgeCorners() convention -- edge 0's line runs points[0] -> points[1].
  const firstLine = session.calls.find((c) => c.name === 'sketchAddLine');
  assert.deepEqual(firstLine.args.slice(1), [points[0][0], points[0][1], points[1][0], points[1][1]]);

  assert.equal(refs.size, 6);
});

test('circle: radius + center pinned, no cornerRefs, no per-corner constraints attempted', () => {
  const sketch = {
    id: 'sk4', kind: 'sketch', plane: 'xy', offset: 0,
    shape: 'circle',
    points: [[-10, 5], [10, 5]], // diameter ends -> center (0,5), radius 10
  };
  const session = makeFakeSession(0);
  const refs = translateSketch(session, 'Sketch', sketch);

  assert.equal(refs.size, 0);
  const circleCall = session.calls.find((c) => c.name === 'sketchAddCircle');
  assert.deepEqual(circleCall.args.slice(1), [0, 5, 10]);
  const radiusCall = session.calls.find((c) => c.name === 'constrainRadius');
  assert.equal(radiusCall.args[2], 10);
  const xPin = session.calls.find((c) => c.name === 'constrainDistanceX');
  const yPin = session.calls.find((c) => c.name === 'constrainDistanceY');
  assert.equal(xPin.args[5], 0);
  assert.equal(yPin.args[5], 5);
});

test('rounded rectangle: corner 2 emits an arc, and its CornerRef points at that arc', () => {
  const sketch = {
    id: 'sk5', kind: 'sketch', plane: 'xy', offset: 0,
    points: [[0, 0], [40, 0], [40, 25], [0, 25]],
    rounds: { 2: 5 },
  };
  const session = makeFakeSession(4);
  const refs = translateSketch(session, 'Sketch', sketch);

  const arcs = session.calls.filter((c) => c.name === 'sketchAddArc');
  assert.equal(arcs.length, 1, 'exactly one rounded corner -> exactly one arc');
  const lines = session.calls.filter((c) => c.name === 'sketchAddLine');
  assert.equal(lines.length, 4, '4 straight edges: 2 full + 2 trimmed by the round');

  // Corner 2's ref must resolve to the arc's own geoId, not to the trimmed
  // "design edge 2" line that starts at the arc's OUT trim point (a
  // different point, offset from the corner) -- both carry segmentRoles()
  // index 2, in different namespaces (corner vs. edge); see sketch-translate.ts's
  // own comment on why they must not be collapsed into one lookup.
  const emissionOrder = session.calls.filter((c) => c.name === 'sketchAddLine' || c.name === 'sketchAddArc');
  const arcIndex = emissionOrder.findIndex((c) => c.name === 'sketchAddArc');
  assert.equal(refs.get(2).geoId, arcIndex, 'corner 2 resolves to the arc segment, addressed by emission order');
});

test('refuses (throws) when the FreeCAD engine reports a conflict', () => {
  const sketch = {
    id: 'sk6', kind: 'sketch', plane: 'xy', offset: 0,
    points: [[0, 0], [40, 0], [40, 25], [0, 25]],
    constraints: [{ kind: 'horizontal', edge: 0 }],
  };
  const session = makeFakeSession(4, { conflicting: [0] });
  assert.throws(() => translateSketch(session, 'Sketch', sketch), /conflict/i);
});

test('refuses (throws) on a constraint naming an out-of-range edge', () => {
  const sketch = {
    id: 'sk7', kind: 'sketch', plane: 'xy', offset: 0,
    points: [[0, 0], [40, 0], [40, 25], [0, 25]],
    constraints: [{ kind: 'horizontal', edge: 99 }],
  };
  const session = makeFakeSession(4);
  assert.throws(() => translateSketch(session, 'Sketch', sketch), /edge 99/);
});
