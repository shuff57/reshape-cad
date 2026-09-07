// engine/bridge/prims-test.mjs
//
// String-shape unit tests for the additive PartDesign primitive emitters
// (sphere/cone/torus/prism/wedge). NO engine, NO external deps: asserts on the
// emitted Python strings only. Engine integration is the lead's job.
//
// Run from the repo root:
//   node --test engine/bridge/prims-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit } from './fc-commands.mjs';

const HEAD = 'import FreeCAD as App\nimport Part\nimport Sketcher\ndoc = App.ActiveDocument\n';

test('every primitive opens with the defensive import/rebind head and ends with recompute', () => {
  for (const py of [
    emit.sphere('Body', 'S', 8),
    emit.cone('Body', 'C', 4, 0, 30),
    emit.torus('Body', 'T', 14, 4),
    emit.prism('Body', 'P', 10, 20),
    emit.wedge('Body', 'W', 30, 40),
  ]) {
    assert.ok(py.startsWith(HEAD), 'head imports + doc bind');
    assert.ok(py.endsWith('doc.recompute()\n'), 'recompute');
  }
});

test('each primitive creates its PartDesign type on the named body with the given feature name', () => {
  assert.ok(emit.sphere('Body', 'S', 8).includes('doc.getObject("Body").newObject("PartDesign::Sphere", "S")'));
  assert.ok(emit.cone('Body', 'C', 4, 0, 30).includes('doc.getObject("Body").newObject("PartDesign::Cone", "C")'));
  assert.ok(emit.torus('Body', 'T', 14, 4).includes('doc.getObject("Body").newObject("PartDesign::Torus", "T")'));
  assert.ok(emit.prism('Body', 'P', 10, 20).includes('doc.getObject("Body").newObject("PartDesign::Prism", "P")'));
  assert.ok(emit.wedge('Body', 'W', 30, 40).includes('doc.getObject("Body").newObject("PartDesign::Wedge", "W")'));
});

test('property sets: each primitive drives its own parameters', () => {
  assert.ok(emit.sphere('Body', 'S', 8).includes('sp.Radius = 8'));
  const cone = emit.cone('Body', 'C', 4, 0, 30);
  assert.ok(cone.includes('cn.Radius1 = 4'));
  assert.ok(cone.includes('cn.Radius2 = 0'));
  assert.ok(cone.includes('cn.Height = 30'));
  const torus = emit.torus('Body', 'T', 14, 4);
  assert.ok(torus.includes('tr.Radius1 = 14'));
  assert.ok(torus.includes('tr.Radius2 = 4'));
  const prism = emit.prism('Body', 'P', 10, 20);
  assert.ok(prism.includes('pr.Polygon = 6'));
  assert.ok(prism.includes('pr.Circumradius = 10'));
  assert.ok(prism.includes('pr.Height = 20'));
  const wedge = emit.wedge('Body', 'W', 30, 40);
  assert.ok(wedge.includes('wd.Width = 30'));
  assert.ok(wedge.includes('wd.Height = 40'));
});

test('number formatting: integers stay integers, floats pass through', () => {
  const py = emit.sphere('Body', 'S', 8);
  assert.ok(py.includes('sp.Radius = 8'));
  assert.ok(!py.includes('8.0'), py);

  const pyF = emit.sphere('Body', 'S', 2.5);
  assert.ok(pyF.includes('sp.Radius = 2.5'), pyF);
});

test('non-finite numbers are rejected instead of interpolated', () => {
  assert.throws(() => emit.sphere('Body', 'S', NaN));
  assert.throws(() => emit.torus('Body', 'T', 'x', 4));
});

test('injection: body name is quoted, payload never appears as bare code', () => {
  const py = emit.sphere('obj); import os', 'S', 8);
  assert.ok(py.includes('doc.getObject("obj); import os")'), py);
  assert.ok(!/\n\s*import os\b/.test(py.slice(py.indexOf('doc.getObject('))), py);
});
