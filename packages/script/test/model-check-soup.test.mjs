// A sketch that carries soup rows (`geoms`) is measured from THEM, not from the
// legacy `points` it was migrated from. The canvas leaves `points` at the
// pre-edit outline, so reading it kept a `model` requirement green after a
// typed dimension resized the part (8.1.10, width 40 vs a 60-wide rect).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkModel } from '../dist/model-check.js';

const line = (id, a, b, extra = {}) => ({ k: 'line', id, a, b, ...extra });
const doc = (geoms, points = [[0, 0], [40, 0], [40, 25], [0, 25]]) => ({
  version: 1,
  features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points, geoms, geom: geoms }],
});
const wide = (w) => [
  line(1, [0, 0], [w, 0]), line(2, [w, 0], [w, 25]), line(3, [w, 25], [0, 25]), line(4, [0, 25], [0, 0]),
];

test('soup rows win over stale points', () => {
  const d = doc(wide(60));
  assert.equal(checkModel({ expect: [{ kind: 'sketch', width: 40, depth: 25 }] }, d).passed, false);
  assert.equal(checkModel({ expect: [{ kind: 'sketch', width: 60, depth: 25 }] }, d).passed, true);
});

test('construction rows are not part of the outline', () => {
  const g = [...wide(40), line(5, [-100, 0], [100, 0], { construction: true })];
  assert.equal(checkModel({ expect: [{ kind: 'sketch', width: 40, depth: 25 }] }, doc(g)).passed, true);
});

test('no soup: falls back to points', () => {
  const d = doc(undefined);
  assert.equal(checkModel({ expect: [{ kind: 'sketch', width: 40, depth: 25 }] }, d).passed, true);
});
