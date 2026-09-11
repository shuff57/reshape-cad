// engine/bridge/commands-integration.mjs
//
// Lead's integration gate for fc-commands.mjs: drive the TYPED commands
// (not raw Python) through a real PartDesign kernel and check the geometry.
// Run inside the kernel-build-final container:
//   node --experimental-wasm-exnref engine/bridge/commands-integration.mjs \
//        /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession } from '../../packages/engine/src/fc-session.mjs';
import { loadNodeKernel } from '../../packages/engine/src/fc-session-node.mjs';
import { attachCommands } from '../../packages/engine/src/fc-commands.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const Module = await loadNodeKernel(kernelJs);
const s = attachCommands(createFcSession(Module));

s.newDocument('studio');

// Rectangle -> Pad, all via typed commands.
s.newBody('Body');
s.sketchRect('Body', 'Sketch', 40, 40);
s.pad('Body', 'Sketch', 'Pad', 20);
const m1 = s.mesh();
console.log(`RECT PAD: vol=${m1.volume} verts=${m1.positions.length / 3}`);
assert.ok(Math.abs(m1.volume - 32000) < 1, `rect pad vol ~32000, got ${m1.volume}`);

// Parametric edit via typed setParam.
s.setParam('Pad', 'Length', 30);
const m2 = s.mesh();
console.log(`EDIT Length=30: vol=${m2.volume}`);
assert.ok(Math.abs(m2.volume - 48000) < 1, `edited vol ~48000, got ${m2.volume}`);

// Circle -> Pad in a second body: volume = pi*r^2*h = pi*36*20.
s.newBody('Body2');
s.sketchCircle('Body2', 'Sketch2', 6);
s.pad('Body2', 'Sketch2', 'Pad2', 20);
const expectedCyl = Math.PI * 36 * 20;
const m3 = s.mesh('Pad2');
console.log(`CIRCLE PAD: vol=${m3.volume} expected≈${expectedCyl.toFixed(3)}`);
// tessellation-independent: Shape.Volume is exact, tolerance is generous anyway
assert.ok(Math.abs(m3.volume - expectedCyl) < 1, `circle pad vol ~${expectedCyl}, got ${m3.volume}`);

const names = s.tree().objects.map((o) => o.name);
console.log('TREE:', JSON.stringify(names));
assert.ok(['Body', 'Sketch', 'Pad', 'Body2', 'Sketch2', 'Pad2'].every((n) => names.includes(n)),
  'tree must contain both bodies, sketches and pads');

console.log('COMMANDS_INTEGRATION:PASS');
process.exit(0);
