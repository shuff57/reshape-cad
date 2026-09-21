// distinctOwners() (ReshapeStudio.tsx) -- the fix for a box-select regression:
// selecting across MULTIPLE bodies in one drag was collapsing the reported
// selection to only the LAST item's owner, silently dropping every other
// solid's items from `selected` even though the raw item list itself was
// correct (window/crossing box-select, P3.4). Imports from ../dist like
// every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctOwners } from '../dist/ReshapeStudio.js';

function docWith(...ids) {
  return { version: 1, features: ids.map((id) => ({ id, kind: 'box', size: [10, 10, 10], center: [0, 0, 0] })) };
}

test('distinctOwners: a box-select spanning two bodies keeps BOTH owners, not just the last item\'s', () => {
  const doc = docWith('b1', 'b2');
  const items = [
    { kind: 'feature', target: 'b1' },
    { kind: 'feature', target: 'b2' },
  ];
  assert.deepEqual(distinctOwners(doc, items), ['b1', 'b2']);
});

test('distinctOwners: repeated hits on the same body (e.g. two edges of b1) are de-duplicated to one owner', () => {
  const doc = docWith('b1');
  const items = [
    { kind: 'edge', target: 'b1', name: { cause: 'primitive', feature: 'b1', kind: 'edge', part: '+x' } },
    { kind: 'edge', target: 'b1', name: { cause: 'primitive', feature: 'b1', kind: 'edge', part: '+y' } },
  ];
  assert.deepEqual(distinctOwners(doc, items), ['b1']);
});

test('distinctOwners: an item whose owner no longer exists in the doc is skipped, not thrown', () => {
  const doc = docWith('b1');
  const items = [
    { kind: 'feature', target: 'stale-id' },
    { kind: 'feature', target: 'b1' },
  ];
  assert.deepEqual(distinctOwners(doc, items), ['b1']);
});

test('distinctOwners: empty items yields empty owners', () => {
  const doc = docWith('b1');
  assert.deepEqual(distinctOwners(doc, []), []);
});
