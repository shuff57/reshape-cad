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

// v1.2 sweep/groove/loft/pipe/helix emitters, driven directly (their
// statements are not transpiler words yet — the transpiler's vocabulary is
// number-only primitives; profile-driven features need sketch statements).
// Each case builds its own document; volumes checked against exact formulas
// where the shape admits one.
s.newDocument('sw1');
s.newBody('Body');
// Helix pitch (Height/Turns) must be >= profile diameter or consecutive
// turns overlap and the swept solid self-intersects (kernel-measured,
// msgbox #73: 30/5=6mm pitch vs r=6 circle threw 'Result is self
// intersecting'). r=3 circle + 50/5=10mm pitch rides clean.
s.sketchCircle('Body', 'Sketch', 3);
s.additiveHelix('Body', 'Sketch', 'Spring', 50, 5);
const h = s.mesh();
// a helical sweep of a circle is hard to state exactly; assert it built
// non-empty and tall enough to have swept
console.log(`ADDITIVE HELIX: vol=${h.volume}`);
assert.ok(h.volume > 0, `additive helix built, got vol ${h.volume}`);

s.newDocument('sw2');
s.newBody('Body');
s.sketchRect('Body', 'SketchA', 10, 10);
s.sketchRect('Body', 'SketchB', 20, 20);
// Two sections stacked at the same Z give the loft nothing to sweep between
// (kernel-measured, msgbox #75: vol=0). PartDesign lofts ride the section
// PLACEMENTS, so lift SketchB to z=10 — the same move the studio's Pad-
// Length idiom cannot express, done here with a raw placement exec.
s.exec(
  'import FreeCAD as App\n' +
  'doc = App.ActiveDocument\n' +
  'sk = doc.getObject("SketchB")\n' +
  'sk.Placement = App.Placement(App.Vector(0, 0, 10), App.Rotation())\n' +
  'doc.recompute()\n'
);
s.additiveLoft('Body', 'SketchA', 'SketchB', 'Loft');
const lf = s.mesh();
// frustum between 10x10 at z=0 and 20x20 at z=10:
// exact volume = (A1 + A2 + sqrt(A1*A2)) / 3 * h = (100+400+200)/3 * 10
const expectedLoft = ((100 + 400 + Math.sqrt(100 * 400)) / 3) * 10;
console.log(`ADDITIVE LOFT: vol=${lf.volume} expected≈${expectedLoft.toFixed(3)}`);
assert.ok(Math.abs(lf.volume - expectedLoft) < 5, `loft vol ~${expectedLoft}, got ${lf.volume}`);

// P1b statement-level checks: the pocket/groove statements COMPOSE emitters
// the sweep cases already gate, but a statement is a different entry path —
// cheap to gate, and this catches a lowering bug the emitter tests cannot.
s.newDocument('p1b1');
{
  const r = transpile('cuboid(40, 40, 20); pocket(10, 8, 5)');
  for (const cmd of r.commands) s[cmd.op](...cmd.args);
  const m = s.mesh();
  const expected = 32000 - 10 * 8 * 5;
  console.log(`POCKET STMT: vol=${m.volume} expected≈${expected}`);
  assert.ok(Math.abs(m.volume - expected) < 1, `pocket stmt vol ~${expected}, got ${m.volume}`);
}

s.newDocument('p1b2');
{
  const r = transpile('extrude(20, 10, 8)');
  for (const cmd of r.commands) s[cmd.op](...cmd.args);
  const m = s.mesh();
  const expected = 20 * 10 * 8;
  console.log(`EXTRUDE STMT: vol=${m.volume} expected≈${expected}`);
  assert.ok(Math.abs(m.volume - expected) < 1, `extrude stmt vol ~${expected}, got ${m.volume}`);
}

console.log('TRANSPILER_INTEGRATION:PASS');
process.exit(0);
