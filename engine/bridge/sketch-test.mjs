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
import { createFcSession } from '../../packages/engine/src/fc-session.mjs';
import { loadNodeKernel } from '../../packages/engine/src/fc-session-node.mjs';
import { attachCommands } from '../../packages/engine/src/fc-commands.mjs';
import { attachSketchCommands } from '../../packages/engine/src/fc-sketch.mjs';

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
const clash = s.constrainDistanceX('Sketch', g0, 1, g0, 2, 99.0);
st = s.sketchState('Sketch');
console.log(`after clash:    conflicting=${JSON.stringify(st.conflicting)}`);
assert.ok(st.conflicting.length > 0, 'a clashing dimension is reported as conflicting');

// delConstraint is the auto-constraint safety valve: rolling back the clashing
// constraint must clear the conflict and restore the good, fully-constrained state.
s.delConstraint('Sketch', clash);
st = s.sketchState('Sketch');
console.log(`after rollback: conflicting=${JSON.stringify(st.conflicting)} fully=${st.fully}`);
assert.equal(st.conflicting.length, 0, 'deleting the clashing constraint clears the conflict');
assert.equal(st.fully, true, 'sketch is fully constrained again after rollback');
assert.ok(Math.abs(lineLen(st.geometry[0]) - 60) < 1e-6, 'geometry back to the good 60mm width');

// --- slice 1: circle, arc, rectangle, delete ------------------------------
s.newDocument('sk2');
s.newBody('B2');
s.sketchNew('B2', 'S2');

// circle + radius dimension: r starts 5, Radius constraint drives it to 8
const gcirc = s.sketchAddCircle('S2', 20, 20, 5);
s.constrainRadius('S2', gcirc, 8);
let st2 = s.sketchState('S2');
let circRow = st2.geometry.find((g) => g.id === gcirc);
console.log(`circle: type=${circRow.type} r=${circRow.r}`);
assert.equal(circRow.type, 'Circle', 'circle geometry type');
assert.ok(Math.abs(circRow.r - 8) < 1e-6, 'Radius constraint drove the circle to 8');

// arc: center (0,0), r 10, 0..90deg -> start (10,0), end (0,10), mid (7.07,7.07)
const garc = s.sketchAddArc('S2', 0, 0, 10, 0, Math.PI / 2);
st2 = s.sketchState('S2');
const arcRow = st2.geometry.find((g) => g.id === garc);
console.log(`arc: type=${arcRow.type} r=${arcRow.r} mid=(${arcRow.mx},${arcRow.my})`);
assert.equal(arcRow.type, 'ArcOfCircle', 'arc geometry type');
assert.ok(Math.abs(arcRow.r - 10) < 1e-6, 'arc radius 10');
assert.ok(arcRow.mx !== undefined, 'arc carries a midpoint for SVG rendering');
assert.ok(Math.abs(arcRow.mx - 7.0710678) < 1e-3 && Math.abs(arcRow.my - 7.0710678) < 1e-3, 'arc midpoint at the 45deg sweep point');

// rectangle convenience: 4 constrained lines, bottom edge horizontal
const rectIds = s.sketchAddRectangle('S2', 40, 0, 60, 15);
assert.equal(rectIds.length, 4, 'rectangle returns 4 geoIds');
st2 = s.sketchState('S2');
const rb = st2.geometry.find((g) => g.id === rectIds[0]);
console.log(`rect bottom: y1=${rb.y1} y2=${rb.y2}`);
assert.ok(Math.abs(rb.y1 - rb.y2) < 1e-6, 'rectangle bottom edge solved horizontal');

// delete cascades: removing the circle drops one element (+ its Radius constraint)
const beforeGeo = s.sketchState('S2').geometry.length;
s.sketchDelGeometry('S2', gcirc);
const afterGeo = s.sketchState('S2').geometry.length;
console.log(`delete: geometry ${beforeGeo} -> ${afterGeo}`);
assert.equal(afterGeo, beforeGeo - 1, 'sketchDelGeometry removed one element');

console.log('SKETCH:PASS');
process.exit(0);
