// engine/bridge/p1d2-test.mjs
//
// Lead-owned kernel gate for P1d-2: construction geometry and Trim.  This is
// deliberately an execution gate, not an emitter-string test.  Both Sketcher
// APIs have strict Python types (a literal bool and App.Vector respectively),
// and a clean recompute says nothing about whether Trim changed the sketch.
//
// Run from PowerShell:
//   docker run --rm --privileged -v "${PWD}\engine:/engine" fc-kernel-pd-final
//     node --experimental-wasm-exnref /engine/bridge/p1d2-test.mjs
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession } from '../../packages/engine/src/fc-session.mjs';
import { loadNodeKernel } from '../../packages/engine/src/fc-session-node.mjs';
import { attachCommands } from '../../packages/engine/src/fc-commands.mjs';
import { attachSketchCommands } from '../../packages/engine/src/fc-sketch.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachSketchCommands(attachCommands(createFcSession(await loadNodeKernel(kernelJs))));
const results = [];

function slice(name, fn) {
  process.stdout.write(`slice: ${name}\n`);
  try {
    fn();
    results.push({ name, ok: true });
    console.log('  PASS');
  } catch (e) {
    const why = String(e?.message ?? e).split('\n').filter(Boolean)[0];
    results.push({ name, ok: false, why });
    console.log(`  FAIL -- ${why}`);
  }
}

const lineLength = (g) => Math.hypot(g.x2 - g.x1, g.y2 - g.y1);

slice('construction flag is explicit, round-trips, and leaves real geometry', () => {
  s.newDocument('construction_doc');
  s.newBody('B');
  s.sketchNew('B', 'Sketch');
  const g = s.sketchAddLine('Sketch', -8, 0, 8, 0);

  let state = s.sketchState('Sketch');
  assert.equal(state.geometry.find((row) => row.id === g)?.constr, false,
    'new geometry must report normal (not construction)');

  s.sketchSetConstruction('Sketch', g, true);
  state = s.sketchState('Sketch');
  const on = state.geometry.find((row) => row.id === g);
  assert.equal(on?.constr, true, 'setConstruction(True) must survive a state round-trip');
  assert.equal(lineLength(on), 16, 'construction must retain the underlying line');

  s.sketchSetConstruction('Sketch', g, false);
  state = s.sketchState('Sketch');
  assert.equal(state.geometry.find((row) => row.id === g)?.constr, false,
    'setConstruction(False) must be an explicit, reversible set');
});

slice('trim shortens the selected intersecting segment', () => {
  s.newDocument('trim_doc');
  s.newBody('B');
  s.sketchNew('B', 'Sketch');
  const horizontal = s.sketchAddLine('Sketch', -10, 0, 10, 0);
  s.sketchAddLine('Sketch', 0, -10, 0, 10);
  const before = s.sketchState('Sketch');
  const beforeLength = before.geometry.reduce((total, g) => total + (g.type === 'LineSegment' ? lineLength(g) : 0), 0);
  assert.equal(beforeLength, 40, 'fixture has two 20 mm crossing lines');

  // The right-hand piece contains (7,0), so Sketcher must remove it up to the
  // intersection at (0,0).  Success is not "no exception": the combined line
  // length has to fall from 40 to 30 mm, and some remaining endpoint must land
  // at the crossing.
  s.sketchTrim('Sketch', horizontal, 7, 0);
  const after = s.sketchState('Sketch');
  const afterLines = after.geometry.filter((g) => g.type === 'LineSegment');
  const afterLength = afterLines.reduce((total, g) => total + lineLength(g), 0);
  console.log(`  line length ${beforeLength.toFixed(3)} -> ${afterLength.toFixed(3)} mm`);
  assert.ok(Math.abs(afterLength - 30) < 1e-5,
    `trim must remove 10 mm of material, got ${afterLength} mm of line`);
  assert.ok(afterLines.some((g) =>
    (Math.abs(g.x1) < 1e-6 && Math.abs(g.y1) < 1e-6) ||
    (Math.abs(g.x2) < 1e-6 && Math.abs(g.y2) < 1e-6)),
  'trimmed geometry must terminate at the crossing');
});

const bad = results.filter((r) => !r.ok);
console.log(`\nP1d-2 gate: ${results.length - bad.length}/${results.length} slices passed`);
for (const r of bad) console.log(`  FAILED  ${r.name}\n          ${r.why}`);
process.exit(bad.length ? 1 : 0);
