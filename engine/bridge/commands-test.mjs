// engine/bridge/commands-test.mjs
//
// String-shape unit tests for the fc-commands emitters. NO engine, NO external
// deps: asserts on the emitted Python strings only. Engine integration is the
// lead's job (session-test.mjs runs inside the kernel container).
//
// Run from the repo root:
//   node --test engine/bridge/commands-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit } from '../../packages/engine/src/fc-commands.mjs';

// Every snippet re-imports and rebinds defensively; the imports are part of
// the contract (idempotent, safe to exec one snippet at a time).
test('every snippet opens with the defensive import/rebind head', () => {
  for (const py of [
    emit.newBody(),
    emit.sketchRect('Body', 'Sketch', 40, 40),
    emit.sketchCircle('Body', 'S', 6),
    emit.pad('Body', 'Sketch', 'Pad', 20),
    emit.setParam('Pad', 'Length', 30),
  ]) {
    assert.ok(py.startsWith('import FreeCAD as App\nimport Part\nimport Sketcher\ndoc = App.ActiveDocument\n'), 'head imports + doc bind');
  }
});

test('newBody: addObject PartDesign::Body with the given name', () => {
  const py = emit.newBody();
  assert.ok(py.includes('doc.addObject("PartDesign::Body", "Body")'), py);
  const pyF = emit.newBody('Frame');
  assert.ok(pyF.includes('doc.addObject("PartDesign::Body", "Frame")'), pyF);
});

test('sketchRect: 4 LineSegment calls, correct corners, on the body, recomputes', () => {
  const py = emit.sketchRect('Body', 'Sketch', 40, 40);

  // exactly 4 Part.LineSegment addGeometry calls
  const segs = py.match(/Part\.LineSegment\(/g) || [];
  assert.equal(segs.length, 4, py);

  // closed wire corners in the proven order 0,0 -> 40,0 -> 40,40 -> 0,40 -> 0,0
  assert.ok(py.includes('Part.LineSegment(App.Vector(0,0,0), App.Vector(40,0,0)), False)'), py);
  assert.ok(py.includes('Part.LineSegment(App.Vector(40,0,0), App.Vector(40,40,0)), False)'), py);
  assert.ok(py.includes('Part.LineSegment(App.Vector(40,40,0), App.Vector(0,40,0)), False)'), py);
  assert.ok(py.includes('Part.LineSegment(App.Vector(0,40,0), App.Vector(0,0,0)), False)'), py);

  // sketch is created on the named body
  assert.ok(py.includes('doc.getObject("Body").newObject("Sketcher::SketchObject", "Sketch")'), py);

  // ends with recompute
  assert.ok(py.endsWith('doc.recompute()\n'), py);
});

test('sketchCircle: Part.Circle call carrying the radius', () => {
  const py = emit.sketchCircle('Body', 'S', 6);
  assert.ok(py.includes('Part.Circle('), py);
  assert.ok(py.includes('6'), py);
  assert.ok(py.includes('doc.getObject("Body").newObject("Sketcher::SketchObject", "S")'), py);
  assert.ok(py.endsWith('doc.recompute()\n'), py);
});

test('pad: newObject PartDesign::Pad, Profile by name, Length set, recomputes', () => {
  const py = emit.pad('Body', 'Sketch', 'Pad', 20);
  assert.ok(py.includes('doc.getObject("Body").newObject("PartDesign::Pad", "Pad")'), py);
  assert.ok(py.includes('pad.Profile = doc.getObject("Sketch")'), py);
  assert.ok(py.includes('pad.Length = 20'), py);
  assert.ok(py.endsWith('doc.recompute()\n'), py);
});

test('setParam: numeric setattr + recompute; name/prop are JSON-quoted strings', () => {
  const py = emit.setParam('Pad', 'Length', 30);
  assert.ok(py.includes('setattr(doc.getObject("Pad"), "Length", 30)'), py);
  assert.ok(py.endsWith('doc.recompute()\n'), py);

  // a string-ish name is quoted, never emitted as a bare identifier
  const sneaky = emit.setParam('obj); import os', 'Length', 1);
  assert.ok(sneaky.includes('doc.getObject("obj); import os")'), sneaky);
  // the payload must appear only inside the quoted literal, never as bare code
  assert.ok(!/\n\s*import os\b/.test(sneaky.slice(sneaky.indexOf('setattr('))), sneaky);
});

test('number formatting: integers stay integers, floats pass through', () => {
  const py = emit.pad('Body', 'Sketch', 'Pad', 20);
  assert.ok(py.includes('pad.Length = 20'), py);
  assert.ok(!py.includes('20.0'), py);

  const pyF = emit.pad('Body', 'Sketch', 'Pad', 2.5);
  assert.ok(pyF.includes('pad.Length = 2.5'), pyF);
});

test('non-finite numbers are rejected instead of interpolated', () => {
  assert.throws(() => emit.setParam('Pad', 'Length', '20'));
  assert.throws(() => emit.pad('Body', 'Sketch', 'Pad', NaN));
  assert.throws(() => emit.pad('Body', 'Sketch', 'Pad', Infinity));
});