// engine/bridge/bore-test.mjs
//
// String-shape unit tests for the bore() emitter (docs/specs/SPEC-hole.md,
// the 'hole' feature's own Pocket-based command). NO engine: asserts on the
// emitted Python strings only, same discipline as pattern-test.mjs/
// hole-test.mjs. Engine integration (volume/bbox/isInside against the real
// kernel) lives in packages/kernel/test/freecad-hole.manual.mjs.
//
// Run from the repo root:
//   node --test engine/bridge/bore-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit } from '../../packages/engine/src/fc-commands.mjs';

const WRAP_HEAD = 'import json\nimport FreeCAD as App\nimport Part\nimport Sketcher\ndoc = App.ActiveDocument\n';

const call = () => emit.bore('Body', 'h1_boresk0', 'h1_bore0', 3, [[0, 0, 0]], [0, 0, 0], [0, 0, 1], 22);

test('bore opens with the wrapStatus head and ends with the status write', () => {
  const py = call();
  assert.ok(py.startsWith(WRAP_HEAD), py.slice(0, 80));
  assert.ok(py.endsWith('open("/tmp/reshape_out.json", "w").write(json.dumps(_res))\n'), py.slice(-80));
});

test('bore builds an UNATTACHED Sketcher::SketchObject inside the named body, not on a face or datum', () => {
  const py = call();
  assert.ok(py.includes('doc.getObject("Body")'), py);
  assert.ok(py.includes('body.newObject("Sketcher::SketchObject", "h1_boresk0")'), py);
  // No AttachmentSupport/MapMode -- unlike sketchNewOnOrigin's own face-datum
  // attachment (fc-sketch.mjs), the profile is positioned purely by its own
  // Placement, per SPEC-hole.md's own design decision.
  assert.ok(!py.includes('AttachmentSupport'), py);
  assert.ok(!py.includes('MapMode'), py);
});

test('bore positions the sketch via the world-frame proxy formula: body.Placement.inverse().multiply(frame)', () => {
  const py = call();
  assert.ok(py.includes('s.Placement = body.Placement.inverse().multiply(frame)'), py);
});

test('bore projects every world centre into the sketch plane via inv.multVec (a Placement transforming a POINT), never inv.multiply (which only composes two Placements)', () => {
  const py = call();
  assert.ok(py.includes('_p = inv.multVec(App.Vector(*_w))'), py);
  // Regression guard for the exact bug this pass found and fixed against the
  // real kernel: Placement.multiply(Vector) raises "argument 1 must be
  // Base.Placement, not Base.Vector" -- this line must never come back.
  assert.ok(!py.includes('inv.multiply(App.Vector'), py);
});

test('bore emits ONE addGeometry(Part.Circle(...)) call, inside a for-loop over ALL world centres -- N circles in one sketch, not N sketches', () => {
  const py = emit.bore('Body', 'sk', 'pk', 3, [[0, 0, 0], [10, 0, 0], [-10, 0, 0], [0, 10, 0]], [0, 0, 0], [0, 0, 1], 22);
  // The circle-drawing line appears exactly ONCE in the emitted Python
  // (it is the body of a `for _w in [...]:` loop that runs 4 times at
  // RUNTIME, not something this string-level test can unroll) -- what proves
  // "4 centres, 1 sketch" at the source level is the length of the embedded
  // Python list literal the loop iterates over.
  const circleLines = (py.match(/addGeometry\(Part\.Circle\(/g) || []).length;
  assert.equal(circleLines, 1, 'exactly one addGeometry(Part.Circle(...)) call, inside the loop body');
  assert.ok(py.includes('addGeometry(Part.Circle(App.Vector(_p.x, _p.y, 0), App.Vector(0,0,1), 3)'), py);
  assert.ok(py.includes('for _w in [(0,0,0),(10,0,0),(-10,0,0),(0,10,0)]:'), py);
  const onlyOneSketch = (py.match(/newObject\("Sketcher::SketchObject"/g) || []).length;
  assert.equal(onlyOneSketch, 1, 'all four centres share the SAME sketch object');
  const onlyOnePocket = (py.match(/newObject\("PartDesign::Pocket"/g) || []).length;
  assert.equal(onlyOnePocket, 1, 'all four centres are cut by the SAME Pocket');
});

test('bore creates a PartDesign::Pocket, Profile = the sketch just built', () => {
  const py = call();
  assert.ok(py.includes('body.newObject("PartDesign::Pocket", "h1_bore0")'), py);
  assert.ok(py.includes('pk.Profile = s'), py);
});

test('bore sets Length from `depth`, and Midplane=True -- NEVER Reversed, NEVER ThroughAll', () => {
  const py = call();
  assert.ok(py.includes('pk.Length = 22'), py);
  assert.ok(py.includes('pk.Midplane = True'), py);
  // Reversed (pocket()'s own direction fix) and Type='ThroughAll'
  // (holeThrough()'s own idiom) are DIFFERENT designs entirely -- bore()
  // relies on Midplane alone (see its own header: "Midplane=True, Reversed
  // NEVER set -- Midplane makes the cut symmetric so pocket()'s direction
  // trap ... cannot recur").
  assert.ok(!py.includes('Reversed'), py);
  assert.ok(!py.includes('ThroughAll'), py);
  assert.ok(!py.includes("pk.Type"), py);
});

test('bore\'s rollback removes BOTH the Pocket and the sketch, and restores the Tip FIRST', () => {
  const py = call();
  assert.ok(py.includes("if ('Invalid' in pk.State) or pk.Shape.isNull():"), py);
  // Tip restored BEFORE either object is removed -- draft()/mirrored() both
  // document the same ordering requirement for the identical reason
  // (stranding Body.Tip pointed at a just-deleted object crashes the next
  // tessellation, "mesh: memory access out of bounds").
  const body = py.slice(py.indexOf("if ('Invalid' in pk.State)"));
  const tipLine = body.indexOf('body.Tip = _tip');
  const removePocketLine = body.indexOf('doc.removeObject(pk.Name)');
  const removeSketchLine = body.indexOf('doc.removeObject("h1_boresk0")');
  assert.ok(tipLine >= 0 && removePocketLine >= 0 && removeSketchLine >= 0, body);
  assert.ok(tipLine < removePocketLine, 'Tip must be restored BEFORE the Pocket is removed');
  assert.ok(removePocketLine < removeSketchLine, 'the Pocket is removed before the sketch (matches draft()/mirrored()\'s own ordering)');
});

test('bore does NOT explicitly advance body.Tip -- Pocket is a FeatureAddSub, newObject() advances it automatically', () => {
  const py = call();
  // Unlike linearPattern/polarPattern/mirrored (FeatureTransformedPattern,
  // which need an explicit `body.Tip = ...` on success), a Pocket's own
  // creation line should be the ONLY place `body.Tip` appears outside the
  // rollback branch.
  const successBody = py.slice(0, py.indexOf("if ('Invalid' in pk.State)"));
  assert.ok(!successBody.includes('body.Tip ='), successBody);
});

test('bore has NO volGuard -- a miss must not raise (parity with OCCT\'s own non-intersecting Cut)', () => {
  const py = call();
  assert.ok(!py.includes('_v0'), py);
  assert.ok(!py.includes('_v1'), py);
  assert.ok(!py.includes('removed nothing'), py);
});

test('non-finite numbers throw', () => {
  assert.throws(() => emit.bore('Body', 'sk', 'pk', NaN, [[0, 0, 0]], [0, 0, 0], [0, 0, 1], 22));
  assert.throws(() => emit.bore('Body', 'sk', 'pk', 3, [[0, 0, 0]], [0, 0, 0], [0, 0, 1], 'x'));
});
