// A tangent row used to come out of toScript with bEnd written twice
// ({ k:'tangent', a:3, aEnd:'a', bEnd:'b', b:1, bEnd:'b' }): valid JS, ugly text.
// Each end key must appear at most once per row, and the row must still round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const doc = {
  version: 1,
  features: [{
    id: 'sk1', kind: 'sketch', plane: 'top', offset: 0,
    geoms: [
      { k: 'line', id: 1, a: [0, 0], b: [10, 0] },
      { k: 'arc', id: 2, c: [10, 5], r: 5, a: [10, 0], b: [15, 5], sense: 'ccw' },
    ],
    rules: [{ k: 'tangent', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }],
  }],
};

test('a tangent row emits each end key once and round-trips', () => {
  const text = toScript(doc);
  const row = text.split('\n').find((l) => l.includes("k:'tangent'"));
  assert.ok(row, 'tangent row present');
  assert.equal((row.match(/bEnd/g) ?? []).length, 1, `bEnd duplicated: ${row}`);
  assert.equal((row.match(/aEnd/g) ?? []).length, 1, `aEnd duplicated: ${row}`);
  const parsed = runScript(text);
  assert.deepEqual(parsed.errors, []);
  assert.equal(toScript(parsed.doc, parsed.namedParams), text, 'D6 fixpoint');
  const sk = parsed.doc.features.find((f) => f.kind === 'sketch');
  assert.deepEqual(sk.rules, doc.features[0].rules);
});
