// selection-model.ts's pure selection ops: encodes ModelEditor.tsx's pick()
// (line 1118-1125) and ReshapeStudio.tsx's selected/pickedEdge/pickedFace/
// pickedEdges/pickedFaces/pickedSize state (lines 229-272, 517, 686-705,
// 1223-1264). Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySelection,
  replace,
  toggle,
  add,
  clear,
  toggleFeature,
  selectAllFeatures,
  primaryOf,
  featuresOf,
  ownerScoped,
} from '../dist/selection-model.js';

const edgeName = (feature, part) => ({ cause: 'primitive', feature, kind: 'edge', part });
const faceName = (feature, part) => ({ cause: 'primitive', feature, kind: 'face', part });

const FEAT_A = { kind: 'feature', target: 'b1' };
const FEAT_B = { kind: 'feature', target: 'b2' };
const FEAT_C = { kind: 'feature', target: 'b3' };

function docWith(...ids) {
  return { version: 1, features: ids.map((id) => ({ id, kind: 'box', size: [10, 10, 10], center: [0, 0, 0] })) };
}

test('1: replace matches pick()\'s non-additive branch (ModelEditor.tsx:1122) -- clears then selects only the new item', () => {
  const before = add(add(emptySelection(), FEAT_A), FEAT_B);
  const after = replace(before, FEAT_C);
  assert.deepEqual(after.items, [FEAT_C]);
  assert.deepEqual(after.primary, FEAT_C);
});

test('2: toggle on an absent item adds it and it becomes primary, matching pick()\'s shift-click-add branch (ModelEditor.tsx:1121, "...:  [...selected, id]")', () => {
  const after = toggle(emptySelection(), FEAT_A);
  assert.deepEqual(after.items, [FEAT_A]);
  assert.deepEqual(after.primary, FEAT_A);
});

test('3: toggle on a present item removes it, matching pick()\'s shift-click-remove branch (ModelEditor.tsx:1121, "selected.filter((x) => x !== id)")', () => {
  const twoUp = toggle(toggle(emptySelection(), FEAT_A), FEAT_B);
  assert.deepEqual(twoUp.items, [FEAT_A, FEAT_B]);
  const after = toggle(twoUp, FEAT_A);
  assert.deepEqual(after.items, [FEAT_B]);
});

test('4: toggle-off leaves primary as the new last-remaining item', () => {
  const twoUp = toggle(toggle(emptySelection(), FEAT_A), FEAT_B);
  const after = toggle(twoUp, FEAT_A);
  assert.deepEqual(after.primary, FEAT_B);
});

test('5: toggle-off the only remaining item sets primary to null', () => {
  const oneUp = toggle(emptySelection(), FEAT_A);
  const after = toggle(oneUp, FEAT_A);
  assert.deepEqual(after.items, []);
  assert.equal(after.primary, null);
});

test('6: toggle round-trip is idempotent net-of-two -- toggling the same item twice restores the original state', () => {
  const before = toggle(emptySelection(), FEAT_B);
  const roundTripped = toggle(toggle(before, FEAT_A), FEAT_A);
  assert.deepEqual(roundTripped, before);
});

test('7: add on an existing state keeps prior items plus the new one, and does not disturb primary', () => {
  const before = replace(emptySelection(), FEAT_A);
  const after = add(before, FEAT_B);
  assert.deepEqual(after.items, [FEAT_A, FEAT_B]);
  assert.deepEqual(after.primary, FEAT_A);
});

test('8: add on an empty state makes the new item primary (it is the first item)', () => {
  const after = add(emptySelection(), FEAT_A);
  assert.deepEqual(after.items, [FEAT_A]);
  assert.deepEqual(after.primary, FEAT_A);
});

test('9: clear returns items=[] and primary=null regardless of prior state', () => {
  const before = add(add(emptySelection(), FEAT_A), FEAT_B);
  const after = clear(before);
  assert.deepEqual(after.items, []);
  assert.equal(after.primary, null);
});

test('10: clear preserves filters -- only items/primary are this op\'s concern', () => {
  const before = add(emptySelection(), FEAT_A);
  const after = clear(before);
  assert.deepEqual(after.filters, before.filters);
});

test('11: emptySelection defaults filters to all-true', () => {
  const state = emptySelection();
  assert.deepEqual(state.filters, { face: true, edge: true, vertex: true, body: true });
});

test('12: toggleFeature is pick(id, true) exactly -- add then remove by feature id alone (ModelEditor.tsx:1274 onClick)', () => {
  const added = toggleFeature(emptySelection(), 'b1');
  assert.deepEqual(added.items, [{ kind: 'feature', target: 'b1' }]);
  const removed = toggleFeature(added, 'b1');
  assert.deepEqual(removed.items, []);
  assert.equal(removed.primary, null);
});

test('13: selectAllFeatures(doc) returns exactly one feature-kind SelectionItem per feature in doc.features', () => {
  const doc = docWith('b1', 'b2', 'b3');
  const state = selectAllFeatures(doc);
  assert.deepEqual(state.items, [
    { kind: 'feature', target: 'b1' },
    { kind: 'feature', target: 'b2' },
    { kind: 'feature', target: 'b3' },
  ]);
});

test('14: selectAllFeatures on an empty doc returns an empty state, no throw', () => {
  const doc = { version: 1, features: [] };
  const state = selectAllFeatures(doc);
  assert.deepEqual(state.items, []);
  assert.equal(state.primary, null);
  assert.deepEqual(state.filters, { face: true, edge: true, vertex: true, body: true });
});

test('15: primaryOf exposes target+name+size together, replacing separate pickedEdge/pickedFace/pickedSize reads (ReshapeStudio.tsx:236-246, :697-702)', () => {
  const edgeItem = { kind: 'edge', target: 'hole1', name: edgeName('b1', '+x'), size: 12 };
  const state = replace(emptySelection(), edgeItem);
  const primary = primaryOf(state);
  assert.deepEqual(primary, edgeItem);
  // The legacy trio, reconstructed exactly as this file's own header says:
  const pickedEdge = primary?.kind === 'edge' ? { target: primary.target, edge: primary.name ?? null } : null;
  const pickedFace = primary?.kind === 'face' ? { target: primary.target, face: primary.name ?? null } : null;
  const pickedSize = primary?.size ?? null;
  assert.deepEqual(pickedEdge, { target: 'hole1', edge: edgeName('b1', '+x') });
  assert.equal(pickedFace, null);
  assert.equal(pickedSize, 12);
});

test('16: primaryOf returns null on a fresh empty state, matching onPick\'s null-pick branch (ReshapeStudio.tsx:1224-1231)', () => {
  assert.equal(primaryOf(emptySelection()), null);
});

test('17: featuresOf extracts feature ids only, in item order, replacing `selected` reads (ReshapeStudio.tsx:517)', () => {
  const mixed = add(add(emptySelection(), FEAT_A), { kind: 'edge', target: 'b1', name: edgeName('b1', '+x') });
  const withSecondFeature = add(mixed, FEAT_B);
  assert.deepEqual(featuresOf(withSecondFeature), ['b1', 'b2']);
});

test('18: featuresOf on a state with no feature-kind items returns []', () => {
  const onlyEdges = add(emptySelection(), { kind: 'edge', target: 'b1', name: edgeName('b1', '+x') });
  assert.deepEqual(featuresOf(onlyEdges), []);
});

test('19: ownerScoped filters items to one owner via the real ownerOf(), replacing pickedEdges.filter((e) => ownerOf(doc, e) === id) at ReshapeStudio.tsx:686', () => {
  const doc = docWith('b1', 'b2');
  const edgeOnB1 = { kind: 'edge', target: 'b1', name: edgeName('b1', '+x') };
  const edgeOnB2 = { kind: 'edge', target: 'b2', name: edgeName('b2', '+y') };
  const state = add(add(emptySelection(), edgeOnB1), edgeOnB2);
  assert.deepEqual(ownerScoped(state, doc, 'b1'), [edgeOnB1]);
  assert.deepEqual(ownerScoped(state, doc, 'b2'), [edgeOnB2]);
});

test('20: ownerScoped prefers a name\'s rootFeature over target, matching ownerOf/PickName -- an edge whose owner consumed the primitive still scopes to the primitive (model-selection.ts PickName comment; ModelEditor.tsx:724-734 regression note)', () => {
  const doc = docWith('b1'); // 'hole1' deliberately absent: it was consumed, same as the "Hole 1 ate Box 1's mesh" case.
  const edgeFromB1ViaHole = { kind: 'edge', target: 'hole1', name: edgeName('b1', '+x') };
  const state = add(emptySelection(), edgeFromB1ViaHole);
  assert.deepEqual(ownerScoped(state, doc, 'b1'), [edgeFromB1ViaHole]);
  assert.deepEqual(ownerScoped(state, doc, 'hole1'), []);
});

test('21: ownerScoped falls back to target when the name is absent, same as ownerOf\'s own fallback', () => {
  const doc = docWith('b1');
  const unnamedFacePick = { kind: 'face', target: 'b1', name: null };
  const state = add(emptySelection(), unnamedFacePick);
  assert.deepEqual(ownerScoped(state, doc, 'b1'), [unnamedFacePick]);
});

test('22: a feature-kind item is its own owner (ownerOf falls through to target when name is absent)', () => {
  const doc = docWith('b1', 'b2');
  const state = add(add(emptySelection(), FEAT_A), FEAT_B);
  assert.deepEqual(ownerScoped(state, doc, 'b1'), [FEAT_A]);
});
