// engine/bridge/hole-test.mjs
//
// String-shape unit tests for the holeThrough emitter. NO engine, NO external
// deps: asserts on the emitted Python strings only. Engine integration is the
// lead's job (transpile-integration.mjs runs inside the kernel container).
//
// Run from the repo root:
//   node --test engine/bridge/hole-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit } from '../../packages/engine/src/fc-commands.mjs';

test('holeThrough opens with the defensive import/rebind head (wrapStatus shape)', () => {
  const py = emit.holeThrough('Body', 'Sketch', 'Hole');
  // wrapStatus prepends `import json` before the defensive head
  assert.ok(py.startsWith('import json\nimport FreeCAD as App\nimport Part\nimport Sketcher\ndoc = App.ActiveDocument\n'), 'json + head imports + doc bind');
});

test('holeThrough creates a Pocket on the named body', () => {
  const py = emit.holeThrough('Body', 'Sketch', 'Hole');
  assert.ok(py.includes('doc.getObject("Body").newObject("PartDesign::Pocket", "Hole")'), py);
});

test('holeThrough sets Profile by sketch name', () => {
  const py = emit.holeThrough('Body', 'Sketch', 'Hole');
  assert.ok(py.includes('pk.Profile = doc.getObject("Sketch")'), py);
});

test('holeThrough sets Type to ThroughAll', () => {
  const py = emit.holeThrough('Body', 'Sketch', 'Hole');
  assert.ok(py.includes("pk.Type = 'ThroughAll'"), py);
});

test('holeThrough sets Midplane so the cut reaches material both directions', () => {
  // Kernel-measured (msgbox #59): a bare XY sketch under a Pad cuts -Z only —
  // the hole came out uncut. Midplane=True makes the cut symmetric about the
  // sketch plane, so it always reaches the material above.
  const py = emit.holeThrough('Body', 'Sketch', 'Hole');
  assert.ok(py.includes('pk.Midplane = True'), py);
});

test('holeThrough never emits a Length', () => {
  const py = emit.holeThrough('Body', 'Sketch', 'Hole');
  assert.ok(!py.includes('Length'), py);
});

test('holeThrough has the clean-failure body: removeObject + recompute in the failure branch', () => {
  const py = emit.holeThrough('Body', 'Sketch', 'Hole');
  assert.ok(py.includes("if ('Invalid' in pk.State) or pk.Shape.isNull():"), py);
  assert.ok(py.includes('doc.removeObject(pk.Name)'), py);
  assert.ok(py.includes('doc.recompute()'), py);
  assert.ok(py.includes("raise ValueError('hole failed — the profile must be one closed loop lying on the solid')"), py);
});

test('holeThrough ends the way pocket does (clean-status wrapper)', () => {
  const hole = emit.holeThrough('Body', 'Sketch', 'Hole');
  const pocket = emit.pocket('Body', 'Sketch', 'Pocket', 5);
  // both are wrapStatus bodies: same trailing status-write, same try/except shape
  assert.ok(hole.endsWith('open("/tmp/reshape_out.json", "w").write(json.dumps(_res))\n'), hole);
  assert.ok(hole.includes('_res = {"ok": True}'), hole);
  assert.ok(hole.includes('except Exception as _e:'), hole);
  assert.ok(hole.includes('_res = {"ok": False, "error": str(_e)}'), hole);
  // same shape, not same line count: holeThrough carries Midplane (one line
  // pocket does not), so count-parity was load-bearing only until the first
  // real difference -- assert the wrapper's suffix lines match instead.
  const last3 = (s) => s.split('\n').slice(-4).join('\n');
  assert.equal(last3(hole), last3(pocket));
});
