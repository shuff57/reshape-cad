// engine/bridge/blend-test.mjs
//
// String-shape unit tests for sketchNewPlaced() (fc-sketch.mjs) and
// loftBetween() (fc-commands.mjs) -- the two new emitters docs/specs/
// SPEC-blend.md's 'blend' feature needs. NO engine: asserts on the emitted
// Python strings only, same discipline as bore-test.mjs/pattern-test.mjs.
// Engine integration (volume/bbox against the real kernel, all 24 fixtures)
// lives in packages/kernel/test/freecad-blend.manual.mjs.
//
// Run from the repo root:
//   node --test engine/bridge/blend-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit as sketchEmit } from '../../packages/engine/src/fc-sketch.mjs';
import { emit as cmdEmit } from '../../packages/engine/src/fc-commands.mjs';

const HEAD = 'import json\nimport FreeCAD as App\nimport Part\nimport Sketcher\ndoc = App.ActiveDocument\n';
const WRAP_HEAD = 'import json\nimport FreeCAD as App\nimport Part\nimport Sketcher\ndoc = App.ActiveDocument\n';

test('sketchNewPlaced opens with the bridge HEAD and creates an UNATTACHED sketch inside the named body', () => {
  const py = sketchEmit.sketchNewPlaced('Body1', 'bl1_lo', [0, 0, 0], [1, 0, 0], [0, 1, 0]);
  assert.ok(py.startsWith(HEAD), py.slice(0, 80));
  assert.ok(py.includes('body = doc.getObject("Body1")'), py);
  assert.ok(py.includes('sk = body.newObject("Sketcher::SketchObject", "bl1_lo")'), py);
  // No AttachmentSupport/MapMode -- positioned purely by its own Placement,
  // same discipline as bore()'s own profile sketch.
  assert.ok(!py.includes('AttachmentSupport'), py);
  assert.ok(!py.includes('MapMode'), py);
});

test('sketchNewPlaced positions via the world-frame proxy formula: body.Placement.inverse().multiply(world)', () => {
  const py = sketchEmit.sketchNewPlaced('Body1', 'sk', [0, 0, 0], [1, 0, 0], [0, 1, 0]);
  assert.ok(py.includes('sk.Placement = body.Placement.inverse().multiply(world)'), py);
});

// LOAD-BEARING pinning assertion (SPEC-blend.md's own handedness table): an
// xz@10 sketch (u=[1,0,0], v=[0,0,1], origin=[0,10,0]) must derive local Z as
// u x v = (0,-1,0) -- NOT (0,1,0), which is occt-build.ts's own PLANE_AXES.n
// for 'xz' and is LEFT-handed, silently rotating the sketch 180 degrees at an
// IDENTICAL volume (measured: a 30x5 rect landed at world bbox
// [[-30,0,-5],[0,20,0]] instead of [[0,0,0],[30,20,5]]).
test('sketchNewPlaced derives local Z as u x v, NOT the caller\'s plane normal -- the handedness pin', () => {
  const py = sketchEmit.sketchNewPlaced('Body1', 'sk', [0, 10, 0], [1, 0, 0], [0, 0, 1]);
  assert.ok(
    py.includes('world = App.Placement(App.Matrix(1,0,0,0, 0,0,-1,10, 0,1,0,0, 0,0,0,1))'),
    py,
  );
  // The wrong (left-handed, PLANE_AXES.n-derived) matrix would carry a
  // positive third column (0,1,0) instead -- must never appear.
  assert.ok(!py.includes('App.Matrix(1,0,0,0, 0,0,1,10, 0,1,0,0, 0,0,0,1)'), py);
});

test('sketchNewPlaced validates every coordinate -- non-finite numbers throw', () => {
  assert.throws(() => sketchEmit.sketchNewPlaced('Body1', 'sk', [0, NaN, 0], [1, 0, 0], [0, 1, 0]));
  assert.throws(() => sketchEmit.sketchNewPlaced('Body1', 'sk', [0, 0, 0], ['x', 0, 0], [0, 1, 0]));
});

const loftCall = () => cmdEmit.loftBetween('Body3', 'bl1_lo', 'bl1_hi', 'bl1_loft');

test('loftBetween opens with the wrapStatus head and ends with the status write', () => {
  const py = loftCall();
  assert.ok(py.startsWith(WRAP_HEAD), py.slice(0, 80));
  assert.ok(py.endsWith('open("/tmp/reshape_out.json", "w").write(json.dumps(_res))\n'), py.slice(-80));
});

test('loftBetween creates a PartDesign::AdditiveLoft, Profile = lo, Sections = [hi]', () => {
  const py = loftCall();
  assert.ok(py.includes('body.newObject("PartDesign::AdditiveLoft", "bl1_loft")'), py);
  assert.ok(py.includes('lo.Profile = doc.getObject("bl1_lo")'), py);
  assert.ok(py.includes('lo.Sections = [doc.getObject("bl1_hi")]'), py);
  // Ruled/Closed left at their False defaults -- deliberately never set here
  // (SPEC-blend.md: provably inert with exactly two sections, MEASURED
  // bit-identical to True on a real taper).
  assert.ok(!py.includes('.Ruled'), py);
  assert.ok(!py.includes('.Closed'), py);
});

test('loftBetween measures the LOFT\'s own Shape.Volume for the guard, not the Body\'s', () => {
  const py = loftCall();
  assert.ok(py.includes('_v0 = body.Shape.Volume'), py);
  assert.ok(py.includes('_v1 = lo.Shape.Volume'), py);
});

test('loftBetween\'s rollback removes the loft AND both proxy sketches, and restores Tip first', () => {
  const py = loftCall();
  const guardStart = py.indexOf("if ('Invalid' in lo.State)");
  assert.ok(guardStart >= 0, py);
  const body = py.slice(guardStart);
  const tipLine = body.indexOf('body.Tip = _tip');
  const removeLoftLine = body.indexOf('doc.removeObject(lo.Name)');
  const removeLoLine = body.indexOf('doc.removeObject("bl1_lo")');
  const removeHiLine = body.indexOf('doc.removeObject("bl1_hi")');
  assert.ok(tipLine >= 0 && removeLoftLine >= 0 && removeLoLine >= 0 && removeHiLine >= 0, body);
  assert.ok(tipLine < removeLoftLine, 'Tip restored before the loft is removed');
  assert.ok(removeLoftLine < removeLoLine && removeLoLine < removeHiLine, 'loft, then lo proxy, then hi proxy');
});

test('loftBetween does NOT explicitly advance body.Tip on success -- AdditiveLoft advances it automatically', () => {
  const py = loftCall();
  const successBody = py.slice(0, py.indexOf("if ('Invalid' in lo.State)"));
  assert.ok(!successBody.includes('body.Tip ='), successBody);
});

test('loftBetween\'s volume guard catches a zero-gain loft (self-intersecting outline), the same silent-success family as the sweep guard', () => {
  const py = loftCall();
  assert.ok(py.includes('abs(_v1 - _v0) < 1e-6'), py);
  assert.ok(py.includes("raise ValueError('the two outlines could not be skinned into one solid')"), py);
});

test('loftBetween does NOT echo additiveLoft()\'s own SAME_PLANE_HINT wording -- that hint is actively false for a blend', () => {
  const py = loftCall();
  assert.ok(!py.includes('same plane'), py);
  assert.ok(!py.includes('Pick a face'), py);
});
