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
import { createFcSession, loadNodeKernel } from './fc-session.mjs';
import { attachCommands } from './fc-commands.mjs';

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

console.log('FEAT:PASS');
process.exit(0);
