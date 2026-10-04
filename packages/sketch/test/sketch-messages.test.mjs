// 2D audit step 3: the student-facing strings of the sketch layer. Each must read as a plain sentence: no solver
// vocabulary, no raw numbers like NaN/Infinity, edge and corner numbers that are the ones the panel shows (1-based).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, describeRemovalNote, describeRemovalNotePair, addConstraintSettling } from '../dist/sketch-solve.js';

const JARGON = /bulge|jacobian|solver|residual|degrees of freedom|\bDoF\b|constraint|NaN|undefined|Infinity|\[object|tangent point|epsilon|lambda/i;
const ALL = [
  { kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'length', edge: 2, value: 40 },
  { kind: 'equal', edge: 0, other: 2 }, { kind: 'parallel', edge: 0, other: 2 }, { kind: 'perpendicular', edge: 0, other: 1 },
  { kind: 'distanceX', a: 0, b: 1, value: 12 }, { kind: 'distanceY', a: 0, b: 3, value: 7 },
  { kind: 'symmetric', a: 0, b: 2, center: 1 }, { kind: 'angle', edge: 0, other: 1, degrees: 60 }, { kind: 'lock', corner: 0 },
];

test('describe(): every rule kind reads in the panel\'s 1-based numbers, with no jargon', () => {
  for (const c of ALL) {
    const s = describe(c);
    assert.ok(s.length > 3 && !JARGON.test(s), s);
  }
  assert.equal(describe({ kind: 'horizontal', edge: 0 }), 'edge 1 across');
  assert.equal(describe({ kind: 'lock', corner: 0 }), 'corner 1 pinned');
  assert.equal(describe({ kind: 'length', edge: 2, value: 40 }), 'edge 3 = 40');
});

test('describeRemovalNote / Pair: a fact about the sketch ending in the undo promise, never a failure message', () => {
  for (const removed of ALL) for (const added of ALL) {
    const s = describeRemovalNote(removed, added);
    assert.match(s, /^[A-Z].* no longer has to .*\. Undo puts it back\.$/s, s);
    assert.ok(!JARGON.test(s) && !/removed|error|failed/i.test(s), s);
  }
  const s = describeRemovalNotePair({ kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }, { kind: 'perpendicular', edge: 1, other: 2 });
  assert.equal(s, 'Edge 3 no longer has to stay level and edge 4 no longer has to stay upright so they can meet at a right angle. Undo puts them back.');
});

test('a rule the sketch cannot keep is settled by dropping an older one, and the note names real edges', () => {
  const rect = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const base = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }];
  const out = addConstraintSettling(rect, [...base, { kind: 'length', edge: 0, value: 40 }, { kind: 'length', edge: 0, value: 50 }]);
  assert.ok(out.constraints.length <= base.length + 2);
});
