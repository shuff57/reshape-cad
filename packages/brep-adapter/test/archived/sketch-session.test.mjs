// SPEC-sketcher2 §5.1's TS seam: SketchSession2D against the REAL
// packages/brep-rs/pkg wasm via initSync in node (no fetch here) -- the same
// convention as brep-rs-engine-adapter.test.mjs. The wasm must be rebuilt
// before this suite runs (see AGENTS.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../brep-rs/pkg',
);

const brep = await import(
  new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href
);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const { SketchSession2D, slotBaseOf, pointSlots } = await import(
  '../dist/sketch-session.js'
);

const session = new SketchSession2D();
session.loadFromBytes(brep);

const SQUARE = {
  geoms: [
    { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
    { k: 'line', id: 2, a: [40, 0], b: [40, 30] },
    { k: 'line', id: 3, a: [40, 30], b: [0, 30] },
    { k: 'line', id: 4, a: [0, 30], b: [0, 0] },
  ],
  rules: [
    { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
    { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
    { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
    { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
    { k: 'horizontal', a: 1 },
    { k: 'vertical', a: 2 },
  ],
};

test('1: slotBaseOf and pointSlots mirror the kernel param layout', () => {
  const geoms = [
    { k: 'point', id: 1, p: [0, 0] },
    { k: 'line', id: 2, a: [0, 0], b: [10, 0] },
    { k: 'circle', id: 3, c: [20, 20], r: 5 },
    {
      k: 'arc', id: 4, c: [0, 0], r: 10, a: [10, 0], b: [0, 10], sense: 'ccw',
    },
  ];
  // Built-ins own 0..9; then point(2) at 10, line(4) at 12, circle(3) at 16,
  // arc(7) at 19.
  assert.equal(slotBaseOf(geoms, 1), 10);
  assert.equal(slotBaseOf(geoms, 2), 12);
  assert.equal(slotBaseOf(geoms, 3), 16);
  assert.equal(slotBaseOf(geoms, 4), 19);
  assert.equal(slotBaseOf(geoms, 5), null);
  assert.deepEqual(pointSlots(geoms, 2, 'b'), [14, 15]);
  assert.deepEqual(pointSlots(geoms, 3, 'c'), [16, 17]);
  assert.deepEqual(pointSlots(geoms, 4, 'b'), [24, 25]);
  assert.equal(pointSlots(geoms, 3, 'a'), null, 'a circle has no a/b points');
  assert.deepEqual(pointSlots(geoms, 4, 'a'), [22, 23]);
});

test('2: open + solve a square; profile has 4 segments', () => {
  const err = session.open(SQUARE.geoms, SQUARE.rules);
  assert.equal(err, null, `open refused: ${err}`);
  assert.equal(session.solve(), true, `solve refused: ${session.lastError()}`);
  const d = session.diagnose();
  assert.ok(d, 'diagnose returns a verdict');
  assert.equal(d.bucket, 'consistent');
  // 16 line params - rank 10: 4 coincidents (8 rows) + horizontal + vertical.
  // No dimensions yet, so 6 DoF remain: x/y position, width, height.
  assert.equal(d.dof, 6);
  const prof = session.profile();
  assert.ok(!('refusal' in prof), `a square profiles clean: ${JSON.stringify(prof)}`);
  assert.equal(prof.loops.length, 1, 'a square is one outline and no holes');
  assert.equal(prof.loops[0].role, 'outer');
  assert.equal(prof.loops[0].segs.length, 4, 'the closed wire has 4 segments');
});

test('3: a conflicting sketch refuses its profile with a sentence', () => {
  const err = session.open(
    [
      { k: 'point', id: 1, p: [0, 0] },
      { k: 'point', id: 2, p: [40, 0] },
    ],
    [
      { k: 'distance', a: 1, aEnd: 'a', b: 2, bEnd: 'a', value: 40 },
      { k: 'distance', a: 1, aEnd: 'a', b: 2, bEnd: 'a', value: 20 },
    ],
  );
  assert.equal(err, null, `open refused: ${err}`);
  const solved = session.solve();
  // The solve may refuse (degenerate LM) or report a conflicting bucket;
  // either way the profile must refuse.
  const prof = session.profile();
  assert.ok('refusal' in prof, `a conflicting sketch must refuse: ${JSON.stringify(prof)}`);
  assert.ok(prof.refusal.length > 10, 'the refusal is a sentence, not a code');
  void solved;
});

test('4: solvedGeoms reads back the solved coordinates', () => {
  const err = session.open(SQUARE.geoms, SQUARE.rules);
  assert.equal(err, null);
  assert.equal(session.solve(), true);
  const solved = session.solvedGeoms();
  assert.equal(solved.length, 4);
  const first = solved[0];
  assert.equal(first.k, 'line');
  if (first.k === 'line') {
    // The solver only guarantees the constraints, not the absolute pose, but
    // the horizontal line's two ends must share a y.
    assert.ok(Math.abs(first.a[1] - first.b[1]) < 1e-6, 'line 1 solved horizontal');
    // And the chain must still close on line 2's start.
    const second = solved[1];
    if (second.k === 'line') {
      assert.ok(
        Math.hypot(first.b[0] - second.a[0], first.b[1] - second.a[1]) < 1e-6,
        'the coincident chain holds',
      );
    }
  }
});

test('5: drag moves one vertex and the constraints hold', () => {
  const err = session.open(SQUARE.geoms, SQUARE.rules);
  assert.equal(err, null);
  assert.equal(session.solve(), true);
  // Slot of line 1's end (b): built-ins 10, line 1 base 10, b at +2 -> 12,13
  const slots = pointSlots(SQUARE.geoms, 1, 'b');
  assert.deepEqual(slots, [12, 13]);
  const before = session.solvedGeoms();
  assert.equal(session.drag(12, 13, 55, 5), true, `drag refused: ${session.lastError()}`);
  const after = session.solvedGeoms();
  const a1 = before[0], a2 = after[0];
  if (a1.k === 'line' && a2.k === 'line') {
    assert.ok(Math.hypot(a2.b[0] - 55, a2.b[1] - 5) < 1e-4, 'the dragged end reached the target');
    if (a2.k === 'line') {
      assert.ok(Math.abs(a2.a[1] - a2.b[1]) < 1e-6, 'horizontal survived the drag');
    }
  }
});

test('6: reopen is the edit path: add a rule, solve again', () => {
  // The bridge reopens on every edit; prove the reopen preserves the solved
  // answer when the rows did not change.
  const err = session.open(SQUARE.geoms, SQUARE.rules);
  assert.equal(err, null);
  assert.equal(session.solve(), true);
  const before = session.solvedGeoms();
  assert.equal(session.open(SQUARE.geoms, SQUARE.rules), null);
  assert.equal(session.solve(), true);
  const after = session.solvedGeoms();
  assert.deepEqual(before, after, 'an identical reopen reproduces the solve');
});

test('7: a bad row refuses open with the kernel sentence', () => {
  const err = session.open(
    [{ k: 'line', id: 2, a: [0, 0], b: [10, 0] }], // id must be 1: not dense
    [],
  );
  assert.ok(err, 'a non-dense id refuses open');
  assert.match(err, /id/i);
});

test('8: profile exposes outer and hole loops', () => {
  // SPEC-sketcher2 §8.2 across the seam: a washer -- the 40x30 square with a
  // 5 mm bore -- comes back as two ROLE-TAGGED loops, the outline first.
  // This is the shape the refusal-7 sentence used to stand in for.
  const err = session.open(
    [...SQUARE.geoms, { k: 'circle', id: 5, c: [20, 15], r: 5 }],
    SQUARE.rules,
  );
  assert.equal(err, null, `open refused: ${err}`);
  assert.equal(session.solve(), true, `solve refused: ${session.lastError()}`);
  const prof = session.profile();
  assert.ok(!('refusal' in prof), `a washer profiles clean: ${JSON.stringify(prof)}`);
  assert.equal(prof.loops.length, 2, 'the outline and its bore');
  assert.deepEqual(
    prof.loops.map((l) => l.role),
    ['outer', 'hole'],
    'the outline first, then the hole',
  );
  assert.equal(prof.loops[0].segs.length, 4, 'the plate is four lines');
  assert.equal(prof.loops[1].segs.length, 2, 'the bore is two half-arcs');
  assert.equal(prof.loops[1].segs[0].k, 'arc');
});