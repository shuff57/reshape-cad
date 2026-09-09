// engine/bridge/p1c3-test.mjs
//
// Lead's gate for P1c-3 (the six studio buttons P1c never shipped).
// Written by the lead, not by the builder that wired them.
//
// *** THE REASON THIS FILE IS BIGGER THAN "ONE NEW EMITTER" ***
//
// The spec said subtractivePipe was the only unrun code. That was wrong, and
// the audit that wrote the spec found out afterwards: `sweep-test.mjs` says so
// in its own header --
//
//     "String-shape unit tests ... NO engine, NO external deps: asserts on the
//      emitted Python strings only."
//
// -- and it is the ONLY caller of emit.additivePipe outside fc-commands.mjs
// itself. So **additivePipe has never been executed either**. Nothing has ever
// asked FreeCAD to build a pipe on this bridge; we have only ever asserted the
// Python we would send.
//
// That matters beyond tidiness, because four entries in
// parity/freecad-partdesign.json are REFUSED on the strength of this sentence:
//
//     "the real FreeCAD PartDesign::AdditivePipe is kernel-gated -- the studio
//      button (SPEC-P1c) delivers it by mouse"
//
// Both halves of that were unsupported: the button did not exist (P1c-3 builds
// it) and the kernel gate did not exist (this file). A refusal may still be
// right, but it has to rest on something that ran.
//
// WHAT THIS GATE MEASURES, and why each slice is shaped the way it is:
//
//   * Every slice builds its sketches THE WAY THE BUTTON DOES -- plain
//     sketchNew() sketches, which are all on XY. The studio has no way to put
//     a sketch on another plane (sketchNewOnFace needs an existing face), so
//     testing pipe with a conveniently perpendicular spine would gate geometry
//     no user can produce. If the coplanar case fails, that IS the finding.
//   * Subtractive features are measured by VOLUME GOING DOWN against the same
//     document before the cut. A SubtractiveLoft that quietly removes nothing
//     still recomputes, still reports Valid, and still shows in the tree.
//     "It built" is not the assertion; "it cut" is.
//
// Run inside the PartDesign-enabled kernel container:
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/p1c3-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession, loadNodeKernel } from './fc-session.mjs';
import { attachCommands } from './fc-commands.mjs';
import { attachSketchCommands } from './fc-sketch.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachSketchCommands(attachCommands(createFcSession(await loadNodeKernel(kernelJs))));

const vol = () => s.mesh().volume;
const results = [];
/** Run one slice, record PASS/FAIL, and keep going. A kernel refusal is a
 *  RESULT here, not a crash: the point of the run is to learn which of the six
 *  buttons can actually build something from the sketches the studio can make,
 *  and one throw must not hide the other five. */
function slice(name, fn) {
  process.stdout.write(`slice: ${name}\n`);
  try {
    fn();
    results.push({ name, ok: true });
    console.log('  PASS');
  } catch (e) {
    const first = String(e && e.message || e).split('\n').filter(Boolean)[0];
    results.push({ name, ok: false, why: first });
    console.log(`  FAIL -- ${first}`);
  }
}

/** A 40x40 pad, 20 tall: the material every subtractive slice cuts into. */
function baseSolid(doc) {
  s.newDocument(doc);
  s.newBody('B');
  s.sketchNew('B', 'Base');
  s.sketchAddRectangle('Base', -20, -20, 20, 20);
  s.pad('B', 'Base', 'Pad', 20);
  const v = vol();
  assert.ok(Math.abs(v - 32000) < 1, `base pad is 40*40*20 = 32000 (got ${v})`);
  return v;
}

// === the same-plane group ===================================================
// THE FIRST RUN OF THIS GATE FOUND THESE THREE SILENTLY DOING NOTHING:
//
//   additivePipe    two XY sketches  ->  volume 0.000,   no error
//   subtractivePipe two XY sketches  ->  32000 -> 32000, no error
//   subtractiveLoft two XY sketches  ->  32000 -> 32000, no error
//
// Every one recomputed clean and reported no Invalid state. The emitters now
// carry a volume-change guard (fc-commands.mjs, volGuardHead/volGuardTail), so
// what these slices assert is the REFUSAL: the operation must roll back and
// say which mistake it was. A silent no-op is the regression they guard.
//
// Two XY sketches is not a contrived input -- it is what `Rect Sketch` twice
// gives you, and the only way to a second plane in the studio is picking a
// face and using New Sketch.
const sameplane = /same plane/;

slice('additivePipe REFUSES two coplanar sketches (what pipeBtn does)', () => {
  s.newDocument('pipe_add');
  s.newBody('B');
  s.sketchNew('B', 'Profile');
  s.sketchAddCircle('Profile', 0, 0, 3);
  s.sketchNew('B', 'Path');
  s.sketchAddLine('Path', 0, 0, 0, 40);
  assert.throws(() => s.additivePipe('B', 'Profile', 'Path', 'Pipe'), sameplane,
    'a pipe that adds nothing must say so, not return silently');
  console.log(`  refused; body volume still ${vol().toFixed(3)}`);
});

slice('additiveLoft REFUSES two coplanar sketches (what loftBtn does — SHIPPED in P1c)', () => {
  s.newDocument('loft_add');
  s.newBody('B');
  s.sketchNew('B', 'LoA');
  s.sketchAddRectangle('LoA', -8, -8, 8, 8);
  s.sketchNew('B', 'LoB');
  s.sketchAddRectangle('LoB', -4, -4, 4, 4);
  assert.throws(() => s.additiveLoft('B', 'LoA', 'LoB', 'Loft'), sameplane,
    'the Loft button shipped in P1c with this same trap — it must refuse, not no-op');
});

slice('subtractivePipe REFUSES two coplanar sketches (what subPipeBtn does)', () => {
  const before = baseSolid('pipe_sub');
  s.sketchNew('B', 'Profile');
  s.sketchAddCircle('Profile', 0, 0, 3);
  s.sketchNew('B', 'Path');
  s.sketchAddLine('Path', 0, 0, 0, 40);
  assert.throws(() => s.subtractivePipe('B', 'Profile', 'Path', 'SubPipe'), sameplane,
    'a subtractive pipe that removes nothing must say so');
  assert.ok(Math.abs(vol() - before) < 1e-6, 'and the rollback leaves the solid untouched');
});

// --- 3. groove, exactly as grooveBtn calls it -------------------------------
slice('groove removes material (what grooveBtn does)', () => {
  const before = baseSolid('groove_doc');
  s.sketchNew('B', 'GrooveProfile');
  s.sketchAddRectangle('GrooveProfile', 5, 2, 12, 8);
  s.groove('B', 'GrooveProfile', 'Groove', 360);
  const after = vol();
  console.log(`  volume ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  assert.ok(after < before, `groove must REMOVE material (${before} -> ${after})`);
});

slice('subtractiveLoft REFUSES two coplanar sketches (what subLoftBtn does)', () => {
  const before = baseSolid('subloft_doc');
  s.sketchNew('B', 'LoA');
  s.sketchAddRectangle('LoA', -8, -8, 8, 8);
  s.sketchNew('B', 'LoB');
  s.sketchAddRectangle('LoB', -4, -4, 4, 4);
  assert.throws(() => s.subtractiveLoft('B', 'LoA', 'LoB', 'SubLoft', 0), sameplane,
    'a subtractive loft that removes nothing must say so');
  assert.ok(Math.abs(vol() - before) < 1e-6, 'and the rollback leaves the solid untouched');
});

// --- 5. subtractiveHelix, exactly as subHelixBtn calls it -------------------
slice('subtractiveHelix removes material (what subHelixBtn does)', () => {
  const before = baseSolid('subhelix_doc');
  s.sketchNew('B', 'Thread');
  s.sketchAddCircle('Thread', 15, 0, 2);
  s.subtractiveHelix('B', 'Thread', 'SubHelix', 20, 3);
  const after = vol();
  console.log(`  volume ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  assert.ok(after < before, `subtractive helix must REMOVE material (${before} -> ${after})`);
});

// --- additiveHelix, as helixBtn calls it ------------------------------------
// *** DO NOT OFFSET THE PROFILE FROM THE AXIS IN THIS SLICE. ***
// Measured 2026-09-09, the hard way: a circle at (15, 0) r=2 with Height 20 /
// Turns 3 -- an ordinary-looking spring, and the natural thing a student would
// draw -- pinned a core at 95% and 3.4GB for FOURTEEN MINUTES without
// finishing, and had to be killed. The pitch rule in transpile-integration.mjs
// (pitch >= profile diameter, msgbox #73) was satisfied: 20/3 = 6.67 vs a 4mm
// profile. So pitch is not the whole story, and an offset profile is its own
// hazard -- recorded, unexplained, and NOT gated here because a gate that may
// never terminate is not a gate.
//
// These are transpile-integration.mjs's known-good numbers: profile ON the
// axis, r=3, 50/5 = 10mm pitch.
slice('additiveHelix builds a solid (what helixBtn does)', () => {
  s.newDocument('helix_add');
  s.newBody('B');
  s.sketchNew('B', 'Spring');
  s.sketchAddCircle('Spring', 0, 0, 3);
  s.additiveHelix('B', 'Spring', 'Helix', 50, 5);
  const v = vol();
  console.log(`  helix volume = ${v.toFixed(3)}`);
  assert.ok(v > 0, 'the helix built a solid with volume');
});

// --- report -----------------------------------------------------------------
const bad = results.filter((r) => !r.ok);
console.log(`\nP1c-3 gate: ${results.length - bad.length}/${results.length} slices passed`);
for (const r of bad) console.log(`  FAILED  ${r.name}\n          ${r.why}`);
process.exit(bad.length ? 1 : 0);
