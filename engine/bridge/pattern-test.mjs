// engine/bridge/pattern-test.mjs
//
// String-shape unit tests for the pattern emitters (linearPattern,
// polarPattern). NO engine: asserts on the emitted Python strings only.
// Engine integration is the lead's container gate.
//
// Run from the repo root:
//   node --test engine/bridge/pattern-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit } from '../../packages/engine/src/fc-commands.mjs';

const WRAP_HEAD = 'import json\nimport FreeCAD as App\nimport Part\nimport Sketcher\ndoc = App.ActiveDocument\n';

test('both patterns open with the wrapStatus head and end with the status write', () => {
  for (const py of [emit.linearPattern('Body', 'Pad', 3, 20), emit.polarPattern('Body', 'Pad', 4)]) {
    assert.ok(py.startsWith(WRAP_HEAD), py.slice(0, 80));
    assert.ok(py.endsWith('open("/tmp/reshape_out.json", "w").write(json.dumps(_res))\n'), py.slice(-80));
  }
});

test('linearPattern: PartDesign::LinearPattern, Originals by name, Length + Occurrences set', () => {
  const py = emit.linearPattern('Body', 'Pad', 3, 20);
  assert.ok(py.includes('doc.getObject("Body").newObject("PartDesign::LinearPattern", "LinearPattern")'), py);
  assert.ok(py.includes('lp.Originals = [doc.getObject("Pad")]'), py);
  assert.ok(py.includes('lp.Length = 20'), py);
  assert.ok(py.includes('lp.Occurrences = 3'), py);
});

test('linearPattern: the world axis resolves through the Body Origin datum by ROLE, not Name (a second Body auto-suffixes its axis names)', () => {
  const py = emit.linearPattern('Body', 'Pad', 3, 20, 'x');
  assert.ok(py.includes("origin = getattr(body, 'Origin', None)"), py);
  assert.ok(py.includes('for _f in origin.OriginFeatures'), py);
  assert.ok(py.includes('"X_Axis"'), py);
  assert.ok(py.includes("lp.Direction = (axisObj, [''])"), py);
});

test('polarPattern: PartDesign::PolarPattern, Axis + Angle + Occurrences set', () => {
  const py = emit.polarPattern('Body', 'Pad', 4, 180);
  assert.ok(py.includes('doc.getObject("Body").newObject("PartDesign::PolarPattern", "PolarPattern")'), py);
  assert.ok(py.includes('pp.Originals = [doc.getObject("Pad")]'), py);
  assert.ok(py.includes('pp.Angle = 180'), py);
  assert.ok(py.includes('pp.Occurrences = 4'), py);
  assert.ok(py.includes("pp.Axis = (axisObj, [''])"), py);
});

test('both patterns carry the clean-failure branch', () => {
  for (const [py, v] of [[emit.linearPattern('Body', 'Pad', 3, 20), 'lp'], [emit.polarPattern('Body', 'Pad', 4), 'pp']]) {
    assert.ok(py.includes(`if ('Invalid' in ${v}.State) or ${v}.Shape.isNull():`), py);
    assert.ok(py.includes(`doc.removeObject(${v}.Name)`), py);
  }
});

test('non-finite numbers throw', () => {
  assert.throws(() => emit.linearPattern('Body', 'Pad', NaN, 20));
  assert.throws(() => emit.polarPattern('Body', 'Pad', 4, 'x'));
});

test('patternName is requested by the caller, not hardcoded -- a second pattern in the same document must not collide on the return value', () => {
  const lp = emit.linearPattern('Body', 'Pad', 3, 20, 'x', 'pat1_pattern');
  assert.ok(lp.includes('newObject("PartDesign::LinearPattern", "pat1_pattern")'), lp);
  const pp = emit.polarPattern('Body', 'Pad', 4, 360, 'z', 'pat2_pattern');
  assert.ok(pp.includes('newObject("PartDesign::PolarPattern", "pat2_pattern")'), pp);
});

// ---------------------------------------------------------------------------
// Coordinate-frame fix (docs/specs/SPEC-coord-fix.md): patternAxis + worldAxis
// ---------------------------------------------------------------------------

test('emit.patternAxis contains the Placement/inverse/multiply lines', () => {
  const py = emit.patternAxis('Body', 'pat1_axis', [30, 0, 0], [0, 1, 0]);
  assert.ok(py.includes('worldPos = App.Vector(30, 0, 0)'), py);
  assert.ok(py.includes('worldDir = App.Vector(0, 1, 0)'), py);
  assert.ok(py.includes('worldRot = App.Rotation(App.Vector(0,1,0), worldDir)'), py);
  assert.ok(py.includes('pat1_axis_obj.Placement = body.Placement.inverse().multiply(App.Placement(worldPos, worldRot))'), py);
  assert.ok(py.includes('newObject("Sketcher::SketchObject", "pat1_axis")'), py);
});

test('linearPattern/polarPattern called WITHOUT worldAxis still use the Body.Origin Role-lookup branch, unchanged (hard regression guard -- the 7 tests above already pin the exact byte-for-byte output of this path)', () => {
  const lp = emit.linearPattern('Body', 'Pad', 3, 20, 'x');
  assert.ok(lp.includes("origin = getattr(body, 'Origin', None)"), lp);
  assert.ok(lp.includes('for _f in origin.OriginFeatures'), lp);
  assert.ok(!lp.includes('Sketcher::SketchObject'), lp);
  assert.ok(!lp.includes('doc.removeObject("LinearPattern_axis")'), lp);

  const pp = emit.polarPattern('Body', 'Pad', 4, 180);
  assert.ok(pp.includes("origin = getattr(body, 'Origin', None)"), pp);
  assert.ok(pp.includes('for _f in origin.OriginFeatures'), pp);
  assert.ok(pp.includes('pp.Angle = 180'), pp); // no correction applied on the old path
  assert.ok(!pp.includes('Sketcher::SketchObject'), pp);
});

test('linearPattern called WITH worldAxis emits the axis-sketch + V_Axis reference, not the Body.Origin Role loop', () => {
  const py = emit.linearPattern('Body', 'Pad', 3, 20, 'x', 'pat1_pattern', { origin: [0, 0, 0], direction: [1, 0, 0] });
  assert.ok(!py.includes("getattr(body, 'Origin', None)"), py);
  assert.ok(!py.includes('OriginFeatures'), py);
  assert.ok(py.includes('newObject("Sketcher::SketchObject", "pat1_pattern_axis")'), py);
  assert.ok(py.includes("lp.Direction = (pat1_pattern_axis_obj, ['V_Axis'])"), py);
  assert.ok(py.includes('doc.removeObject("pat1_pattern_axis")'), py);
});

test('polarPattern called WITH worldAxis emits the axis-sketch + V_Axis reference, not the Body.Origin Role loop', () => {
  const py = emit.polarPattern('Body', 'Pad', 4, 360, 'z', 'pat2_pattern', { origin: [0, 0, 0], direction: [0, 0, 1] });
  assert.ok(!py.includes("getattr(body, 'Origin', None)"), py);
  assert.ok(!py.includes('OriginFeatures'), py);
  assert.ok(py.includes('newObject("Sketcher::SketchObject", "pat2_pattern_axis")'), py);
  assert.ok(py.includes("pp.Axis = (pat2_pattern_axis_obj, ['V_Axis'])"), py);
  assert.ok(py.includes('doc.removeObject("pat2_pattern_axis")'), py);
});

test('polarPattern WITH worldAxis corrects the angle-spacing bug (Angle*(count-1)/count) -- measured against the real kernel, coord-fix-probe.mjs P2', () => {
  const py = emit.polarPattern('Body', 'Pad', 4, 180, 'z', 'PP', { origin: [0, 0, 0], direction: [0, 0, 1] });
  assert.ok(py.includes('pp.Angle = 135'), py); // 180 * 3 / 4
  const full = emit.polarPattern('Body', 'Pad', 4, 360, 'z', 'PP', { origin: [0, 0, 0], direction: [0, 0, 1] });
  assert.ok(full.includes('pp.Angle = 270'), full); // 360 * 3 / 4
  // No worldAxis -- the OLD path is untouched, no correction applied.
  const old = emit.polarPattern('Body', 'Pad', 4, 180);
  assert.ok(old.includes('pp.Angle = 180'), old);
});

test('emit.sketchNewOnOrigin resolves by .Role, not .Name', async () => {
  const { emit: sketchEmit } = await import('../../packages/engine/src/fc-sketch.mjs');
  const py = sketchEmit.sketchNewOnOrigin('Body', 'RevSk', 'XZ_Plane');
  assert.ok(py.includes("getattr(_f, 'Role', None) == \"XZ_Plane\""), py);
  assert.ok(!py.includes("doc.getObject(\"XZ_Plane\")"), py);
  assert.ok(py.includes('sk.AttachmentSupport = [(planeObj, \'\')]'), py);
  assert.ok(py.includes("sk.MapMode = 'FlatFace'"), py);
});