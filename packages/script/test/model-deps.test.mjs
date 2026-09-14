// SPEC-pocket-crossbody.md §6/§8.5 -- dependsOn() was blind to `f.into`,
// which pocket and groove both use to name the SOLID they cut, separate
// from the PROFILE (`f.target`) they cut it with. reshape-script-gen.ts
// emits both as variable references, so deleting the solid used to leave
// the cut pointing at an undeclared name -- the exact ReferenceError
// model-deps.ts's own header documents. This pins the fix: before it,
// orphanedBy(doc, ['box1']) did NOT contain 'p1'; after it, it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orphanedBy, danglingRefs } from '../dist/model-deps.js';

function docWith(...features) {
  return { version: 1, features };
}

test('orphanedBy: deleting a pocket\'s `into` solid takes the pocket with it', () => {
  const box1 = { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] };
  const sk1 = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[5, 5], [15, 5], [15, 15], [5, 15]] };
  const p1 = { id: 'p1', kind: 'pocket', target: 'sk1', into: 'box1', depth: 5 };
  const doc = docWith(box1, sk1, p1);

  const doomed = orphanedBy(doc, ['box1']);
  assert.ok(doomed.has('box1'));
  assert.ok(
    doomed.has('p1'),
    'p1 cuts INTO box1 (not via target, which names sk1) -- deleting box1 must take p1 with it or the ' +
      'generated script is left calling pocket(sk1, box1, 5) with box1 undeclared',
  );
});

test('orphanedBy: deleting a groove\'s `into` solid takes the groove with it', () => {
  const sk1 = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [20, 0], [20, 20], [0, 20]] };
  const base1 = { id: 'base1', kind: 'extrude', target: 'sk1', height: 5 };
  const grv1 = { id: 'grv1', kind: 'groove', target: 'sk1', into: 'base1', angle: 360 };
  const doc = docWith(sk1, base1, grv1);

  const doomed = orphanedBy(doc, ['base1']);
  assert.ok(doomed.has('base1'));
  assert.ok(doomed.has('grv1'), 'grv1 cuts INTO base1 -- deleting base1 must take grv1 with it');
});

test('danglingRefs: a pocket surviving without its `into` solid is reported, not silently ignored', () => {
  // Construct the pre-fix defect shape directly (rather than going through
  // orphanedBy/withoutFeatures) to prove danglingRefs() itself, which is
  // what the delete path and the load-time gate both actually call.
  const sk1 = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[5, 5], [15, 5], [15, 15], [5, 15]] };
  const p1 = { id: 'p1', kind: 'pocket', target: 'sk1', into: 'box1', depth: 5 };
  const doc = docWith(sk1, p1); // box1 is NOT declared

  const refs = danglingRefs(doc);
  assert.ok(
    refs.some((r) => r.feature === 'p1' && r.missing === 'box1'),
    `expected a dangling ref for p1 -> box1, got: ${JSON.stringify(refs)}`,
  );
});
