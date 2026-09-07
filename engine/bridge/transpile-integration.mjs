// engine/bridge/transpile-integration.mjs
//
// Lead's integration gate for the v1 transpiler: drive the TYPED commands
// produced by transpile() through a real PartDesign kernel and check the
// geometry. Run inside the kernel-build-final container:
//   node --experimental-wasm-exnref engine/bridge/transpile-integration.mjs \
//        /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession, loadNodeKernel } from './fc-session.mjs';
import { attachCommands } from './fc-commands.mjs';
import { transpile } from '../../packages/script/src/transpile.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const Module = await loadNodeKernel(kernelJs);
const s = attachCommands(createFcSession(Module));

// box(40, 40, 20); hole(6): 40*40*20 minus a through-hole of radius 3.
s.newDocument('c1');
const r1 = transpile('box(40, 40, 20); hole(6)');
for (const cmd of r1.commands) {
  s[cmd.op](...cmd.args);
}
const m1 = s.mesh();
const expected1 = 32000 - Math.PI * 9 * 20;
console.log(`BOX+HOLE: vol=${m1.volume} expected≈${expected1.toFixed(3)}`);
assert.ok(Math.abs(m1.volume - expected1) < 1, `box+hole vol ~${expected1}, got ${m1.volume}`);

// cylinder(10, 30): pi * r^2 * h = pi * 100 * 30, in a second document.
s.newDocument('c2');
const r2 = transpile('cylinder(10, 30)');
for (const cmd of r2.commands) {
  s[cmd.op](...cmd.args);
}
const m2 = s.mesh();
const expected2 = Math.PI * 100 * 30;
console.log(`CYLINDER: vol=${m2.volume} expected≈${expected2.toFixed(3)}`);
assert.ok(Math.abs(m2.volume - expected2) < 1, `cylinder vol ~${expected2}, got ${m2.volume}`);

// v1.1 primitives, each in its own document. Volumes are exact sphere /
// cone / torus formulas from the dimensions the statements give.
const cases = [
  // sphere(8): (4/3) * pi * r^3
  ['sphere(8)', (4 / 3) * Math.PI * 512, 'SPHERE'],
  // cone(4, 30): (1/3) * pi * r^2 * h
  ['cone(4, 30)', (1 / 3) * Math.PI * 16 * 30, 'CONE'],
  // torus(40, 8): 2 * pi^2 * R * r^2 with R=16, r=4 (diameters in, radii out)
  ['torus(40, 8)', 2 * Math.PI * Math.PI * 16 * 16, 'TORUS'],
];
let ci = 3;
for (const [src, expected, tag] of cases) {
  s.newDocument(`c${ci}`);
  const r = transpile(src);
  for (const cmd of r.commands) {
    s[cmd.op](...cmd.args);
  }
  const m = s.mesh();
  console.log(`${tag}: vol=${m.volume} expected≈${expected.toFixed(3)}`);
  assert.ok(Math.abs(m.volume - expected) < 1, `${tag.toLowerCase()} vol ~${expected.toFixed(3)}, got ${m.volume}`);
  ci++;
}

console.log('TRANSPILER_INTEGRATION:PASS');
process.exit(0);
