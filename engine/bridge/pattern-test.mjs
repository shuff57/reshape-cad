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
import { emit } from './fc-commands.mjs';

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

test('linearPattern: the world axis resolves through the Body Origin datum by NAME', () => {
  const py = emit.linearPattern('Body', 'Pad', 3, 20, 'x');
  assert.ok(py.includes("origin = getattr(body, 'Origin', None)"), py);
  assert.ok(py.includes('"X_Axis")'), py);
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