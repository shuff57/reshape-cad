// engine/bridge/rev-test.mjs
//
// Gate for Revolve. A 10x30 rect with its left edge on the sketch V-axis,
// revolved 360deg, is a cylinder r10 h30 -> vol pi*100*30 = 9424.78. A profile
// that CROSSES the axis is invalid: it must fail cleanly and leave the kernel
// alive (a fresh Pad afterward must still work — the fillet lesson: some OCCT
// failures corrupt wasm, so prove it doesn't here).
//
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/rev-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession, loadNodeKernel } from './fc-session.mjs';
import { attachCommands } from './fc-commands.mjs';
import { attachSketchCommands } from './fc-sketch.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachSketchCommands(attachCommands(createFcSession(await loadNodeKernel(kernelJs))));

// success: cylinder r10 h30
s.newDocument('rev');
s.newBody('Body');
s.sketchRect('Body', 'Sketch', 10, 30); // 0..10 x 0..30, left edge on the V-axis
s.revolve('Body', 'Sketch', 'Revolution', 360);
const vol = s.mesh().volume;
console.log(`revolve cylinder: vol=${vol} (want ~9424.78)`);
assert.ok(Math.abs(vol - 9424.78) < 1, `revolve makes a cylinder r10 h30 (got ${vol})`);

// failure: a profile that crosses the axis
s.newDocument('rev2');
s.newBody('B2');
s.sketchNew('B2', 'S2');
const g0 = s.sketchAddLine('S2', -5, 0, 10, 0);
const g1 = s.sketchAddLine('S2', 10, 0, 10, 30);
const g2 = s.sketchAddLine('S2', 10, 30, -5, 30);
const g3 = s.sketchAddLine('S2', -5, 30, -5, 0);
s.constrainCoincident('S2', g0, 2, g1, 1);
s.constrainCoincident('S2', g1, 2, g2, 1);
s.constrainCoincident('S2', g2, 2, g3, 1);
s.constrainCoincident('S2', g3, 2, g0, 1);
let threw = false;
try { s.revolve('B2', 'S2', 'Revolution', 360); } catch { threw = true; }
console.log(`crossing-axis revolve threw=${threw}`);
assert.ok(threw, 'a profile crossing the axis fails cleanly');

// kernel must still be alive: a fresh Pad in the same body still works
s.sketchRect('B2', 'S3', 20, 20);
s.pad('B2', 'S3', 'Pad', 10);
const alive = s.mesh().volume;
console.log(`kernel alive after failed revolve: pad vol=${alive} (want 4000)`);
assert.ok(Math.abs(alive - 4000) < 1, 'kernel alive: a fresh pad works after a failed revolve');

console.log('REV:PASS');
process.exit(0);
