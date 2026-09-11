// engine/bridge/feat-test.mjs
//
// Lead's gate for slice 3a/3b: Fillet + Chamfer on a picked edge. Pad a
// 40x30x20 box (vol 24000), fillet Edge1 (r5) -> a valid solid with LESS volume
// and one extra face; on a fresh box, chamfer Edge1 (s4) -> valid, less volume.
//
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/feat-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession } from '../../packages/engine/src/fc-session.mjs';
import { loadNodeKernel } from '../../packages/engine/src/fc-session-node.mjs';
import { attachCommands } from '../../packages/engine/src/fc-commands.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachCommands(createFcSession(await loadNodeKernel(kernelJs)));

// --- FILLET ---------------------------------------------------------------
s.newDocument('fil');
s.newBody('Body');
s.sketchRect('Body', 'Sketch', 40, 30);
s.pad('Body', 'Sketch', 'Pad', 20);
assert.ok(Math.abs(s.mesh().volume - 24000) < 1, 'box starts at 24000');

s.fillet('Body', 'Pad', ['Edge1'], 5);
const fm = s.meshFaces();          // tip is now the Fillet
const filVol = s.mesh().volume;
console.log(`fillet: vol=${filVol} faces=${fm.faces.length}`);
assert.ok(filVol < 24000 && filVol > 23000, `fillet removes material (got ${filVol})`);
assert.equal(fm.faces.length, 7, 'fillet adds one rounded face (6 -> 7)');

// --- CHAMFER (fresh box) --------------------------------------------------
s.newDocument('cham');
s.newBody('B2');
s.sketchRect('B2', 'Sketch', 40, 30);
s.pad('B2', 'Sketch', 'Pad', 20);
s.chamfer('B2', 'Pad', ['Edge1'], 4);
const chVol = s.mesh().volume;
console.log(`chamfer: vol=${chVol}`);
assert.ok(chVol < 24000 && chVol > 23000, `chamfer removes material (got ${chVol})`);

// --- oversized fillet must fail CLEANLY, not crash the wasm kernel ---------
// An impossible radius leaves an Invalid feature with a null shape; tessellating
// that crashes wasm ("memory access out of bounds"). The bridge guard must
// detect + delete it and RAISE, leaving the box intact and the kernel alive.
s.newDocument('fail');
s.newBody('B3');
s.sketchRect('B3', 'Sketch', 40, 30);
s.pad('B3', 'Sketch', 'Pad', 20);
let threw = false;
try { s.fillet('B3', 'Pad', ['Edge1'], 999); } catch { threw = true; }
console.log(`oversized fillet threw=${threw}`);
assert.ok(threw, 'oversized fillet raises instead of leaving a corrupt shape');
// These calls would crash if the bad fillet were still present + tessellated:
const survive = s.meshFaces('Pad');
assert.equal(survive.faces.length, 6, 'box survives a failed fillet — kernel not crashed');
assert.ok(Math.abs(s.mesh().volume - 24000) < 1, 'box volume intact (24000) after the failed fillet');
console.log(`survived: faces=${survive.faces.length} vol=${s.mesh().volume}`);

console.log('FEAT:PASS');
process.exit(0);
