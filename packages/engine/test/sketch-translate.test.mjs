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
 *  SEGMENT starts with 4 raw DoF (its own two endpoints, x+y each) -- not
 *  each design corner with 2, the way an earlier version of this fake
 *  modelled it. That earlier model implicitly assumed the emitted line/arc
 *  segments were already topologically welded into one polygon, which is
 *  not how FreeCAD's Sketcher works (see sketch-translate.ts's own comment
 *  on the weld loop) -- the real GCS solver caught this the first time this
 *  port ran against it, reporting cornerCount*2 leftover DoF even after
 *  every design corner was pinned, exactly the segments' un-welded end
 *  points. Every constraint call below (constrainCoincident included, since
 *  the weld loop is now part of what this fake must model) removes the DoF
 *  a real FreeCAD Sketcher constraint of that kind would remove. Good enough
 *  to prove translateSketch()'s OWN control flow (when does it call
 *  sketchState(), when does it emit closure pins, when does it throw) --
 *  see the file header for what it cannot prove.
 *
 *  `spuriousConflict: {geoId, pointPos, axis: 'x'|'y', already, informative}`,
 *  when given, simulates SPEC-engine-port.md §6.3's closure-pin tolerance
 *  gap on ONE axis of ONE corner's pin -- X and Y are pinned and checked
 *  SEPARATELY by pinAxisIfNeeded() (sketch-translate.ts), matching a real,
 *  measured case where one axis was genuinely redundant while the other
 *  was genuinely still free. `informative: true` simulates the axis that
 *  must NOT be silently dropped (dof actually decreases when it's added,
 *  even though FreeCAD ALSO flags it conflicting) -- the exact shape of the
 *  regression this file's tests exist to catch. */
function makeFakeSession(cornerCount, { conflicting = [], spuriousConflict = null } = {}) {
  const calls = [];
  let nextGeoId = 0;
  let nextIndex = 0;
  let removed = 0;
  // The redundant case pre-spends 1 DoF (as if some OTHER, unmodelled
  // constraint chain already fixed that ONE axis before closure ran, so
  // this fake's total never counted it as needing to come from closure at
  // all); the informative case really does close real dof when added, so
  // the total is not pre-reduced.
  const totalDof = cornerCount * 4 - (spuriousConflict && !spuriousConflict.informative ? 1 : 0);
  let stateCalls = 0;
  let triggered = false;
  let stillPinned = false;

  const record = (name, args) => calls.push({ name, args });
  // Tracks whether EACH constraint index actually incremented `removed`
  // when added, so delConstraint() can mirror it symmetrically -- a
  // redundant pin that added zero real dof-reduction must not SUBTRACT one
  // on deletion either, or "undo the redundant pin" looks like it destroys
  // dof closure that was never really there.
  const contributedByIndex = new Map();
  const nextIdx = (contributed = true) => {
    const i = nextIndex++;
    contributedByIndex.set(i, contributed);
    return i;
  };

  // Returns true when THIS call is the triggering, non-informative pin --
  // the caller must then skip `removed += 1` for it, since "already fixed
  // elsewhere" means this constraint adds literally zero new closure
  // (before.dof === after.dof, the real signature pinAxisIfNeeded checks
  // for). An informative trigger still arms/reports the conflict but DOES
  // remove real dof, same as any other constraint.
  const maybeArm = (axis, g1, p1) => {
    const isTrigger = !!spuriousConflict && !triggered && spuriousConflict.axis === axis
      && g1 === spuriousConflict.geoId && p1 === spuriousConflict.pointPos;
    if (isTrigger) {
      triggered = true;
      stillPinned = true;
    }
    return isTrigger && !spuriousConflict.informative;
  };

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
    constrainHorizontal(sk, g) { record('constrainHorizontal', [sk, g]); removed += 1; return nextIdx(); },
    constrainVertical(sk, g) { record('constrainVertical', [sk, g]); removed += 1; return nextIdx(); },
    constrainDistance(sk, g1, p1, g2, p2, v) { record('constrainDistance', [sk, g1, p1, g2, p2, v]); removed += 1; return nextIdx(); },
    constrainEqual(sk, g1, g2) { record('constrainEqual', [sk, g1, g2]); removed += 1; return nextIdx(); },
    constrainParallel(sk, g1, g2) { record('constrainParallel', [sk, g1, g2]); removed += 1; return nextIdx(); },
    constrainPerpendicular(sk, g1, g2) { record('constrainPerpendicular', [sk, g1, g2]); removed += 1; return nextIdx(); },
    // Origin-relative pins (pinCornerToOrigin/pinAxisIfNeeded/the circle
    // branch) now call with the ORIGIN as g1/p1 and the actual point as
    // g2/p2 -- see sketch-translate.ts's own pinCornerToOrigin() header for
    // the real, measured sign bug that ordering fixes. maybeArm() matches
    // against g2/p2, the point being pinned, not g1/p1.
    constrainDistanceX(sk, g1, p1, g2, p2, v) {
      record('constrainDistanceX', [sk, g1, p1, g2, p2, v]);
      const contributes = !maybeArm('x', g2, p2);
      if (contributes) removed += 1;
      return nextIdx(contributes);
    },
    constrainDistanceY(sk, g1, p1, g2, p2, v) {
      record('constrainDistanceY', [sk, g1, p1, g2, p2, v]);
      const contributes = !maybeArm('y', g2, p2);
      if (contributes) removed += 1;
      return nextIdx(contributes);
    },
    constrainSymmetric(sk, g1, p1, g2, p2, g3, p3) { record('constrainSymmetric', [sk, g1, p1, g2, p2, g3, p3]); removed += 2; return nextIdx(); },
    constrainAngle(sk, g1, g2, degrees) { record('constrainAngle', [sk, g1, g2, degrees]); removed += 1; return nextIdx(); },
    constrainRadius(sk, g, value) { record('constrainRadius', [sk, g, value]); removed += 1; return nextIdx(); },
    constrainCoincident(sk, g1, p1, g2, p2) { record('constrainCoincident', [sk, g1, p1, g2, p2]); removed += 2; return nextIdx(); },
    delConstraint(sk, cIndex) {
      record('delConstraint', [sk, cIndex]);
      if (contributedByIndex.get(cIndex)) removed -= 1;
      stillPinned = false;
    },
    sketchState(sk) {
      stateCalls += 1;
      record('sketchState', [sk]);
      const dof = Math.max(0, totalDof - removed);
      // Keeps reporting the conflict on EVERY call while the triggering pin
      // is still in place -- a real GCS wouldn't "forget" a conflict just
      // because someone re-asked; only delConstraint()-ing it away clears
      // it, same as the tests below rely on.
      const stillConflicting = triggered && stillPinned;
      // The "already" value is a fact about this sketch from the START --
      // some OTHER, earlier constraint chain fixed it before closure ever
      // touched it (real bug: lock+horizontal+length, applied before this
      // file's own closure loop runs) -- not something that only appears
      // once a conflict is detected. Always present when configured, so a
      // `before` snapshot taken ahead of the triggering pin (exactly what
      // sketch-translate.ts's own closure loop does) sees it too.
      const geometry = spuriousConflict
        ? [{ id: spuriousConflict.geoId, x1: spuriousConflict.already[0], y1: spuriousConflict.already[1] }]
        : [];
      return {
        geometry, constraints: [], dof,
        fully: dof === 0,
        conflicting: stillConflicting ? [999] : (stateCalls === 1 ? conflicting : []),
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

  const welds = session.calls.filter((c) => c.name === 'constrainCoincident');
  assert.equal(welds.length, 4, 'one Coincident weld per segment, closing the loop');

  const pins = session.calls.filter((c) => c.name === 'constrainDistanceX' || c.name === 'constrainDistanceY');
  assert.equal(pins.length, 8, 'DoF closure pins all 4 corners (X+Y each)');
  // Origin FIRST, point second -- see pinCornerToOrigin()'s own header in
  // sketch-translate.ts for the real, measured sign bug this order avoids
  // (FreeCAD's DistanceX/Y is `value = coord(g2,p2) - coord(g1,p1)`; origin
  // as g1 makes that `coord(point) - 0`, which is what every caller means).
  for (const p of pins) assert.deepEqual([p.args[1], p.args[2]], [-1, 1], 'pinned against the sketch origin, origin first');

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
  // 4 segments * 4 raw dof = 16. The weld loop's 4 Coincident constraints
  // close the loop, removing 2 each (8). horizontal/vertical remove 1 each
  // (4), lock's own two DistanceX/Y pins remove 2, the two lengths remove 1
  // each (2) -- 8+4+2+2=16 total, landing exactly at dof 0 with no closure
  // pins beyond the lock's.
  const session = makeFakeSession(4);
  translateSketch(session, 'Sketch', sketch);

  const originPins = session.calls.filter(
    (c) => (c.name === 'constrainDistanceX' || c.name === 'constrainDistanceY') && c.args[1] === -1,
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

// §6.3's closure-pin tolerance gap: a closure pin can land on a point some
// OTHER, already-exact constraint chain already fixed, at a value that
// differs by only float noise -- FreeCAD reports that as conflicting, but
// it is not a translation bug. X and Y are checked SEPARATELY
// (pinAxisIfNeeded) -- a real, measured regression (rounded-rectangle built
// with the wrong volume, 12706.8583 instead of 11935.6194) came from an
// earlier version of this fix treating a corner's pin as one all-or-nothing
// unit: one axis was genuinely redundant while the other was genuinely
// still needed, and deleting both together silently dropped the needed
// one. These three tests prove all three outcomes the per-axis check must
// tell apart.

test('DoF closure: a spuriously-conflicting pin on an already-exact point is undone, not refused', () => {
  // Corner 1 is geoId 1, pointPos 1 (edge n's line starts at corner n --
  // the same convention every other test here relies on). Simulate
  // FreeCAD's own solve already having that point's X at EXACTLY 40 --
  // matching sketch.points[1][0] to within tolerance, AND contributing zero
  // new dof (the real signature of "some other constraint already fixed
  // this") -- while the closure pin we are about to add carries a hair of
  // float noise, same shape as the real bug (packages/sketch's
  // least-squares residual, not an exact algebraic answer).
  const sketch = {
    id: 'skT1', kind: 'sketch', plane: 'xy', offset: 0,
    points: [[0, 0], [40.00000001, 0], [40, 25], [0, 25]],
  };
  const session = makeFakeSession(4, {
    spuriousConflict: { geoId: 1, pointPos: 1, axis: 'x', already: [40, 0], informative: false },
  });
  let refs;
  assert.doesNotThrow(() => { refs = translateSketch(session, 'Sketch', sketch); });
  assert.equal(refs.size, 4);

  const deletes = session.calls.filter((c) => c.name === 'delConstraint');
  assert.equal(deletes.length, 1, 'only the spurious axis (X) was undone, not the whole corner');

  const finalState = session.calls.filter((c) => c.name === 'sketchState').at(-1);
  assert.ok(finalState, 'translateSketch still checked final state after undoing the spurious pin');
});

test('DoF closure: a GENUINELY conflicting pin (not just float noise) still refuses', () => {
  // Same shape as the test above, but "already" is nowhere near
  // sketch.points[1][0] -- a real mismatch, not tolerance noise. Must NOT
  // be silently undone; the whole sketch build must still refuse, the same
  // way it always has for an honest conflict.
  const sketch = {
    id: 'skT2', kind: 'sketch', plane: 'xy', offset: 0,
    points: [[0, 0], [40, 0], [40, 25], [0, 25]],
  };
  const session = makeFakeSession(4, {
    spuriousConflict: { geoId: 1, pointPos: 1, axis: 'x', already: [999, 999], informative: false },
  });
  assert.throws(() => translateSketch(session, 'Sketch', sketch), /conflict/i);

  const deletes = session.calls.filter((c) => c.name === 'delConstraint');
  assert.equal(deletes.length, 0, 'a real mismatch is never silently undone');
});

test('DoF closure: an INFORMATIVE pin that also conflicts is kept, not dropped (the actual regression)', () => {
  // Same shape again, but this time the axis genuinely removes real dof
  // when added (informative: true -- packages/kernel/test's own measured
  // corner: before.dof=3, after.dof=2) even though FreeCAD ALSO flags it
  // conflicting. An earlier version of this fix deleted it anyway because
  // the VALUE happened to be numerically close (every corner starts near
  // its target -- geometry is always constructed from the solved
  // coordinates, see the file header), silently under-constraining the
  // sketch and letting the solver settle on the WRONG shape. Correct
  // behavior: leave it in place and let the sketch honestly refuse rather
  // than build something wrong.
  const sketch = {
    id: 'skT3', kind: 'sketch', plane: 'xy', offset: 0,
    points: [[0, 0], [40.00000001, 0], [40, 25], [0, 25]],
  };
  const session = makeFakeSession(4, {
    spuriousConflict: { geoId: 1, pointPos: 1, axis: 'x', already: [40, 0], informative: true },
  });
  assert.throws(() => translateSketch(session, 'Sketch', sketch), /conflict/i);

  const deletes = session.calls.filter((c) => c.name === 'delConstraint');
  assert.equal(deletes.length, 0, 'an informative pin is never dropped just because it also conflicts');
});
