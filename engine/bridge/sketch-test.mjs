// engine/bridge/sketch-test.mjs
//
// Lead's gate for the constraint sketcher (Phase 1: the solver pipe). Builds a
// real constrained sketch the way the UI will drive it -- four loose, crooked,
// wrong-size lines, then constraints and dimensions -- and asserts that
// FreeCAD's GCS solver does its job at every step:
//
//   * DoF falls 4 -> 2 -> 0 as dimensions and an origin pin are added
//   * the solved geometry lands EXACTLY on the typed dimensions (40 x 30)
//   * editing a datum (40 -> 60) moves the geometry (parametric edit)
//   * a constrained sketch feeds Pad and yields the expected solid volume
//   * the solver's conflicting-constraints list actually populates on a clash
//
// Run inside the PartDesign-enabled kernel container:
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/sketch-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession, loadNodeKernel } from './fc-session.mjs';
import { attachCommands } from './fc-commands.mjs';
import { attachSketchCommands } from './fc-sketch.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachSketchCommands(attachCommands(createFcSession(await loadNodeKernel(kernelJs))));

const lineLen = (row) => Math.hypot(row.x2 - row.x1, row.y2 - row.y1);

s.newDocument('sk');
s.newBody('Body');
s.sketchNew('Body', 'Sketch');

// four loose lines: off-size and not axis-aligned, so the solver MUST move them
const g0 = s.sketchAddLine('Sketch', 0, 0, 37, 2);    // bottom
const g1 = s.sketchAddLine('Sketch', 37, 2, 39, 26);  // right
const g2 = s.sketchAddLine('Sketch', 39, 26, 1, 28);  // top
const g3 = s.sketchAddLine('Sketch', 1, 28, 0, 0);    // left
assert.deepEqual([g0, g1, g2, g3], [0, 1, 2, 3], 'geoIds are sequential from 0');

// close the loop: end(2) of each line coincident with start(1) of the next
s.constrainCoincident('Sketch', g0, 2, g1, 1);
s.constrainCoincident('Sketch', g1, 2, g2, 1);
s.constrainCoincident('Sketch', g2, 2, g3, 1);
s.constrainCoincident('Sketch', g3, 2, g0, 1);
s.constrainHorizontal('Sketch', g0);
s.constrainHorizontal('Sketch', g2);
s.constrainVertical('Sketch', g1);
s.constrainVertical('Sketch', g3);

let st = s.sketchState('Sketch');
console.log(`after geom+H/V: DoF=${st.dof} fully=${st.fully}`);
assert.equal(st.dof, 4, 'a closed H/V rect with free position+size has 4 DoF');
assert.equal(st.fully, false, 'not fully constrained yet');

// dimensions: bottom 40 in X, left 30 in Y
const cx = s.constrainDistanceX('Sketch', g0, 1, g0, 2, 40.0);
const cy = s.constrainDistanceY('Sketch', g3, 2, g3, 1, 30.0);
st = s.sketchState('Sketch');
console.log(`after dims:     DoF=${st.dof}  bottom=${lineLen(st.geometry[0]).toFixed(4)} left=${lineLen(st.geometry[3]).toFixed(4)}`);
assert.equal(st.dof, 2, 'size pinned, position still free -> 2 DoF');
assert.ok(Math.abs(lineLen(st.geometry[0]) - 40) < 1e-6, 'bottom solved to exactly 40');
assert.ok(Math.abs(lineLen(st.geometry[3]) - 30) < 1e-6, 'left solved to exactly 30');

// pin a corner to the origin -> fully constrained
s.constrainPinOrigin('Sketch', g0, 1);
st = s.sketchState('Sketch');
console.log(`after pin:      DoF=${st.dof} fully=${st.fully}`);
assert.equal(st.dof, 0, 'pinning a corner to origin locks both x and y -> removes the last 2 DoF');
assert.equal(st.fully, true, 'sketch is now fully constrained');

// parametric edit: change the width datum 40 -> 60, geometry must follow
s.sketchSetDatum('Sketch', cx, 60.0);
st = s.sketchState('Sketch');
console.log(`after edit 60:  bottom=${lineLen(st.geometry[0]).toFixed(4)}`);
assert.ok(Math.abs(lineLen(st.geometry[0]) - 60) < 1e-6, 'edited datum moved the geometry to 60');
assert.ok(Math.abs(lineLen(st.geometry[3]) - 30) < 1e-6, 'height unchanged at 30');

// the constrained sketch must feed Pad like any profile: 60 x 30 x 10 = 18000
s.pad('Body', 'Sketch', 'Pad', 10);
const vol = s.mesh().volume;
console.log(`padded volume = ${vol} (want 18000)`);
assert.ok(Math.abs(vol - 18000) < 1, `constrained sketch pads to 18000, got ${vol}`);

// solver diagnostics must be real: add a clashing width (99) and confirm the
// conflicting list populates (this is what the UI turns red).
s.constrainDistanceX('Sketch', g0, 1, g0, 2, 99.0);
st = s.sketchState('Sketch');
console.log(`after clash:    conflicting=${JSON.stringify(st.conflicting)}`);
assert.ok(st.conflicting.length > 0, 'a clashing dimension is reported as conflicting');

console.log('SKETCH:PASS');
process.exit(0);
