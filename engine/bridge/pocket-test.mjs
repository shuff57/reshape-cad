// engine/bridge/pocket-test.mjs
//
// Lead's gate for slice 3c: sketch-on-face + Pocket. Pad a 40x30x20 box, attach
// a sketch to its top face, draw a 10x10 window, pocket it 5 deep -> a valid
// solid with 500 mm^3 removed (vol 23500). Then an open-profile pocket must fail
// cleanly (not crash) and leave the box intact.
//
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/pocket-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession } from '../../packages/engine/src/fc-session.mjs';
import { loadNodeKernel } from '../../packages/engine/src/fc-session-node.mjs';
import { attachCommands } from '../../packages/engine/src/fc-commands.mjs';
import { attachSketchCommands } from '../../packages/engine/src/fc-sketch.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachSketchCommands(attachCommands(createFcSession(await loadNodeKernel(kernelJs))));

s.newDocument('pk');
s.newBody('Body');
s.sketchRect('Body', 'Sketch', 40, 30);
s.pad('Body', 'Sketch', 'Pad', 20);
assert.ok(Math.abs(s.mesh().volume - 24000) < 1, 'box starts at 24000');

// sketch attached to the top face, a 10x10 window drawn in its local plane
s.sketchNewOnFace('Body', 'PSketch', 'Pad', 'Face6');
const g0 = s.sketchAddLine('PSketch', 5, 5, 15, 5);
const g1 = s.sketchAddLine('PSketch', 15, 5, 15, 15);
const g2 = s.sketchAddLine('PSketch', 15, 15, 5, 15);
const g3 = s.sketchAddLine('PSketch', 5, 15, 5, 5);
s.constrainCoincident('PSketch', g0, 2, g1, 1);
s.constrainCoincident('PSketch', g1, 2, g2, 1);
s.constrainCoincident('PSketch', g2, 2, g3, 1);
s.constrainCoincident('PSketch', g3, 2, g0, 1);

s.pocket('Body', 'PSketch', 'Pocket', 5);
const vol = s.mesh().volume;
console.log(`pocket: vol=${vol} (want 23500)`);
assert.ok(Math.abs(vol - 23500) < 1, `pocket removes a 10x10x5 window (got ${vol})`);

// open-profile pocket must fail cleanly, box intact, kernel alive
s.newDocument('pk2');
s.newBody('B2');
s.sketchRect('B2', 'Sketch', 40, 30);
s.pad('B2', 'Sketch', 'Pad', 20);
s.sketchNewOnFace('B2', 'PS2', 'Pad', 'Face6');
s.sketchAddLine('PS2', 5, 5, 15, 5);   // a single open segment — not a closed loop
let threw = false;
try { s.pocket('B2', 'PS2', 'Pocket', 5); } catch { threw = true; }
console.log(`open-profile pocket threw=${threw}`);
assert.ok(threw, 'open-profile pocket fails cleanly');
assert.ok(Math.abs(s.mesh().volume - 24000) < 1, 'box intact after a failed pocket');

console.log('POCKET:PASS');
process.exit(0);
