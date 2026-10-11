// The model tree's view states across a new document, and the 'empty' status after a build. Imports from ../dist; build
// first.
//
// Two review findings. (3) loadDoc reset suppress and every eye, and every edit, undo, redo and panel OK goes through
// loadDoc, so a suppressed part came back on any unrelated edit: pruneSuppressed / pruneVisibility keep the ids the new
// doc still has. (2) the studio treated ANY toggled eye as "the eyes hid it", so a build that made nothing reported no
// 'empty' (and the engine dot went green) as soon as one eye had been clicked: emptyAfterBuild only lets the eyes off
// when they hid every shape that built (the viewport's hiddenByEye).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pruneSuppressed, pruneVisibility, emptyAfterBuild, shapesToDraw, withoutSuppressed,
} from '../dist/model/model-tree-core.js';

const sketch = (id) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [10, 0], [10, 10], [0, 10]] });
const doc = (...ids) => ({
  version: 1,
  features: ids.map((id) => (id.startsWith('sk') ? sketch(id) : { id, kind: 'box', size: [10, 10, 10], center: [0, 0, 0] })),
});

test('an unrelated edit keeps a suppressed part suppressed (the same set back, nothing to drop)', () => {
  const before = doc('box1', 'box2');
  const off = new Set(['box2']);
  // the student widens box1: a new doc object, the same ids
  const after = { ...before, features: [{ ...before.features[0], size: [20, 10, 10] }, before.features[1]] };
  assert.equal(pruneSuppressed(off, after), off);
  // and what the kernel is handed still leaves box2 out
  assert.deepEqual(withoutSuppressed(after, pruneSuppressed(off, after)).features.map((f) => f.id), ['box1']);
  // adding a feature keeps it too
  assert.equal(pruneSuppressed(off, doc('box1', 'box2', 'box3')), off);
});

test('an id the new doc no longer has is dropped (an undo past the feature, a delete)', () => {
  const off = new Set(['box2', 'box3']);
  const kept = pruneSuppressed(off, doc('box1', 'box2'));
  assert.notEqual(kept, off);
  assert.deepEqual([...kept], ['box2']);
  assert.deepEqual([...pruneSuppressed(off, doc())], []);
  const none = new Set();
  assert.equal(pruneSuppressed(none, doc('box1')), none);
});

test('eyes: a feature still there keeps its eye, a gone one loses it, the origin\'s own eyes always stay', () => {
  const eyes = new Map([['box1', false], ['sk1', true], ['origin:xy', true], ['box9', false]]);
  const kept = pruneVisibility(eyes, doc('box1', 'sk1'));
  assert.deepEqual([...kept], [['box1', false], ['sk1', true], ['origin:xy', true]]);
  // nothing to drop: the same map back, so the studio does not re-render (or rebuild) for it
  const same = new Map([['box1', false], ['origin:z', true]]);
  assert.equal(pruneVisibility(same, doc('box1')), same);
  // a cleared model keeps only the origin's eyes
  assert.deepEqual([...pruneVisibility(eyes, doc())], [['origin:xy', true]]);
});

test('an empty build is empty, whatever eye was toggled elsewhere; only the eyes hiding every built shape hides it', () => {
  // the finding: a doc that built nothing, with some eye toggled -> used to read as "fine"
  assert.equal(emptyAfterBuild({ triangles: 0 }, false), 'empty');
  assert.equal(emptyAfterBuild({ triangles: 0, hiddenByEye: false }, false), 'empty');
  // the eyes switched off every shape that DID build: the student's choice, not a failure
  assert.equal(emptyAfterBuild({ triangles: 0, hiddenByEye: true }, false), null);
  // something drawn, or a sketch-only doc, is never empty
  assert.equal(emptyAfterBuild({ triangles: 12 }, false), null);
  assert.equal(emptyAfterBuild({ triangles: 0 }, true), null);
});

test('hiddenByEye is the eyes hiding every BUILT shape, and never a build that made nothing', () => {
  const d = doc('box1', 'box2');
  const all = () => true;
  const none = () => false;
  // the finding's case: nothing built, and the student had toggled an eye (on a sketch, on the other box)
  for (const eyes of [new Map([['box2', false]]), new Map([['sk1', true]]), new Map([['origin:xy', false]])]) {
    const r = shapesToDraw(d, none, eyes);
    assert.deepEqual(r, { ids: [], hiddenByEye: false });
    assert.equal(emptyAfterBuild({ triangles: 0, hiddenByEye: r.hiddenByEye }, false), 'empty');
  }
  // both boxes built and both eyes off: hidden, not empty
  const off = shapesToDraw(d, all, new Map([['box1', false], ['box2', false]]));
  assert.deepEqual(off, { ids: [], hiddenByEye: true });
  assert.equal(emptyAfterBuild({ triangles: 0, hiddenByEye: off.hiddenByEye }, false), null);
  // one eye off: the other box is still drawn
  assert.deepEqual(shapesToDraw(d, all, new Map([['box1', false]])), { ids: ['box2'], hiddenByEye: false });
  // no eyes: every top-level shape that built
  assert.deepEqual(shapesToDraw(d, all), { ids: ['box1', 'box2'], hiddenByEye: false });
});

test('a refused top-level feature: the newest feature that built is drawn, and its eye can still hide it', () => {
  const d = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
      { id: 'hole1', kind: 'hole', target: 'box1', axis: 'z', center: [0, 0, 0], diameter: 2, depth: 12 },
    ],
  };
  const built = (id) => id === 'box1';
  assert.deepEqual(shapesToDraw(d, built), { ids: ['box1'], hiddenByEye: false });
  assert.deepEqual(shapesToDraw(d, built, new Map([['box1', false]])), { ids: [], hiddenByEye: true });
  // a consumed feature switched on is drawn beside the result
  assert.deepEqual(shapesToDraw(d, () => true, new Map([['box1', true]])), { ids: ['hole1', 'box1'], hiddenByEye: false });
});
