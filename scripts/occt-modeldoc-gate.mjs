#!/usr/bin/env node
// The FIRST executable gate for the ModelDoc / OCCT surface. Lead-owned.
//
// WHY THIS DID NOT EXIST. packages/kernel/src/occt-build.ts turns a ModelDoc
// into a B-rep solid on replicad's OpenCascade build. That wasm is 23 MB,
// gitignored in both this repo and shCode, and fetched at RUNTIME from
// getKernelBaseUrl() by packages/studio's BrepViewportThree -- so nothing in
// this repo ever called buildDoc(), and every ModelDoc kind P1a added (prism,
// wedge, groove) shipped TYPED BUT NEVER EXECUTED. msgbox has the admission on
// record: "packages/kernel has no wasm dep, no test script ... I have no
// browser/replicad harness available this session."
//
// WHAT CHANGED. Measured 2026-09-09: replicad_single.js's emscripten factory
// initialises under plain Node given a locateFile that points at the sibling
// .wasm, and the repo's own dist/occt-build.js builds real solids against it.
// No browser, no container, no new dependency -- just a path to the kernel
// files shCode already hosts.
//
// THE ASSERTION IS ALWAYS A VOLUME, NEVER "IT RAN". This project's signature
// defect is an operation that SUCCEEDS AND DOES NOTHING: a stale STL from a
// failed export, three sweeps that recomputed clean and moved zero material, a
// helix that ground for 14 minutes instead of refusing. buildDoc() reports
// nothing in `refusals` for a branch that quietly produced no shape, and a
// Cut with a tool outside the material returns a perfectly valid solid of
// exactly the original size. So every slice below names the number that must
// change and by how much.
//
// USAGE
//   npm run test:occt
//   node scripts/occt-modeldoc-gate.mjs
//   RESHAPE_KERNEL_DIR=/path/to/kernel node scripts/occt-modeldoc-gate.mjs
//
// Run `npm run build --workspaces` FIRST -- this gate reads packages/*/dist,
// not src, because that is what the browser loads too.
//
// WHERE THE KERNEL COMES FROM. This used to require RESHAPE_KERNEL_DIR to
// point at a shCode checkout, which is the only place on this box that had the
// .wasm -- so the gate ran on exactly one machine and could never run in CI.
// `replicad-opencascadejs` is a real npm package shipping the same emscripten
// build, so it is now a pinned devDependency and `npm ci` is enough. The env
// var and the shCode path are kept as fallbacks, in that order, for a checkout
// that has not installed.
//
// THE TWO BUILDS ARE NOT BYTE-IDENTICAL, and that was checked rather than
// assumed. shCode's deployed replicad_single.js is byte-identical to the
// package's; the .wasm differs (sha256 69974ca4.. vs 4c9f22e9.., 22970161 vs
// 22980267 bytes -- 10 KB on 23 MB, consistent with a different patch version
// rather than a custom build). Measured 2026-09-09: all twelve slices below
// return IDENTICAL volumes on both, so the kernel build is not a confound for
// what this gate measures. It prints which kernel it used; if a slice ever
// disagrees across the two, that difference is itself the finding.

import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const require = createRequire(import.meta.url);

/** Where the package's dist sits, or null if it is not installed. Resolved
 *  through require.resolve rather than a hardcoded node_modules path so a
 *  hoisted or pnpm layout still finds it. */
function packagedKernel() {
  try {
    return path.dirname(require.resolve('replicad-opencascadejs/dist/replicad_single.js'));
  } catch {
    try {
      return path.join(path.dirname(require.resolve('replicad-opencascadejs/package.json')), 'dist');
    } catch {
      return null;
    }
  }
}

const CANDIDATES = [
  ['RESHAPE_KERNEL_DIR', process.env.RESHAPE_KERNEL_DIR],
  ['replicad-opencascadejs (devDependency)', packagedKernel()],
  ['shCode checkout', 'C:/Users/shuff57/Documents/GitHub/shCode/public/reshape/kernel'],
];

const found = CANDIDATES.find(
  ([, dir]) => dir && existsSync(path.join(dir, 'replicad_single.wasm'))
    && existsSync(path.join(dir, 'replicad_single.js')),
);

if (!found) {
  console.error('FAIL: no OpenCascade kernel found. Looked, in order:');
  for (const [label, dir] of CANDIDATES) {
    console.error(`  ${label}: ${dir ?? '(unset)'}`);
  }
  console.error('\nFix: `npm install` at the repo root -- replicad-opencascadejs is a');
  console.error('pinned devDependency and is all this needs. Or point RESHAPE_KERNEL_DIR');
  console.error('at any directory holding replicad_single.js and replicad_single.wasm.');
  process.exit(1);
}

const [KERNEL_LABEL, KERNEL_DIR] = found;
console.log(`kernel: ${KERNEL_LABEL}`);
console.log(`        ${path.join(KERNEL_DIR, 'replicad_single.wasm')}`);
console.log(`        ${statSync(path.join(KERNEL_DIR, 'replicad_single.wasm')).size} bytes\n`);

const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

const glue = await import(pathToFileURL(path.join(KERNEL_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(KERNEL_DIR, f) });

const { buildDoc } = await load('packages/kernel/dist/occt-build.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');

/** Volume in mm^3. Same call occt-build.ts:1206 makes, same tolerance. */
function volume(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  return g.Mass();
}

let pass = 0;
let fail = 0;

function check(label, got, want, tol = 1e-3) {
  const ok = typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${typeof got === 'number' ? got.toFixed(3) : String(got)} (want ${want.toFixed(3)})`);
  ok ? pass++ : fail++;
}

/** Run one slice so a MISSING branch reports as a failed slice rather than
 *  aborting the run. A gate that dies on slice 2 never tells you about 3 and
 *  4, and "it crashed" reads as a broken gate rather than a missing feature. */
function slice(label, fn) {
  try {
    fn();
  } catch (err) {
    console.log(`FAIL  ${label}: threw ${err && err.message ? err.message : String(err)}`);
    fail++;
  }
}

function checkChanged(label, before, after) {
  const ok = typeof after === 'number' && Number.isFinite(after) && Math.abs(after - before) > 1e-6;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${before.toFixed(3)} -> ${typeof after === 'number' ? after.toFixed(3) : String(after)} (must differ)`);
  ok ? pass++ : fail++;
}

/** A 40x40x20 box centred at the origin. Volume 32000. */
function boxDoc() {
  const doc = { features: [] };
  const body = mt.newShape(doc, 'box');
  body.size = [40, 40, 20];
  doc.features.push(body);
  return { doc, body };
}

// --- slice 0: the harness itself is live -----------------------------------
// If this fails, nothing below means anything -- a gate that passes because it
// silently built nothing is the exact bug class this file exists to catch.
{
  const doc = { features: [] };
  const sk = mt.newRectangleSketch(doc, 'xy', [-10, -5], [10, 5]);
  doc.features.push(sk);
  const ex = mt.newExtrude(doc, sk.id);
  ex.height = 5;
  doc.features.push(ex);
  const res = buildDoc(oc, doc, arc);
  const s = res.shapes.get(ex.id);
  check('harness live: extrude 20x10 by 5', s ? volume(s) : NaN, 1000);
}

// --- slice 1: groove, with an exact number ---------------------------------
// This slice first shipped asserting only that material MOVED, because the
// swept ring's geometry had not been derived. It has been now.
//
// revolveProfileFace() maps a sketch point (u, v) with `a.u` and `a.n` -- NOT
// a.u and a.v -- so the profile is laid in the plane CONTAINING the rotation
// axis, which is what makes this a Pappus solid of revolution rather than a
// flat annulus of zero volume. A rectangle spanning radius r0..r1 and axial
// v0..v1, turned `deg`, removes:
//
//     pi * (r1^2 - r0^2) * (v1 - v0) * deg/360
//
// THE FIXTURE MUST SIT ENTIRELY INSIDE THE BOX. The original 10..15 ring stuck
// out past the box's z = +-10 faces, so the cut was a CLIPPED ring with no
// simple closed form -- which is exactly why no exact number was derivable
// from it, and why the first version of this slice settled for "it changed".
// 4..8 is wholly interior, so Pappus applies unmodified.
const ringVol = (r0, r1, h, deg) => Math.PI * (r1 * r1 - r0 * r0) * h * (deg / 360);

function grooveDoc(r0, r1, v0, v1, deg) {
  const { doc, body } = boxDoc();
  const prof = mt.newRectangleSketch(doc, 'xz', [r0, v0], [r1, v1]);
  doc.features.push(prof);
  const gr = mt.newGroove(doc, prof.id, body.id);
  gr.angle = deg;
  doc.features.push(gr);
  const res = buildDoc(oc, doc, arc);
  return res.shapes.get(gr.id);
}

slice('groove: full ring r4..8, 7 tall', () => {
  const s = grooveDoc(4, 8, 5, 12, 360);
  check('groove: full ring r4..8, 7 tall', s ? volume(s) : NaN, 32000 - ringVol(4, 8, 7, 360));
});

// Half the turn must remove half the material. An `angle` the branch reads but
// never applies would still pass the slice above.
slice('groove: half turn removes half', () => {
  const s = grooveDoc(4, 8, 5, 12, 180);
  check('groove: half turn removes half', s ? volume(s) : NaN, 32000 - ringVol(4, 8, 7, 180));
});

// Straddling the axial origin (v -4..4), because v0 and v1 are used as a
// difference and a fixture entirely on the positive side cannot tell a correct
// height from one measured off zero.
slice('groove: ring straddling v=0', () => {
  const s = grooveDoc(3, 6, -4, 4, 360);
  check('groove: ring straddling v=0', s ? volume(s) : NaN, 32000 - ringVol(3, 6, 8, 360));
});

// --- slice 2: pocket on xy, the headline number ----------------------------
// 40x40x20 box, a 10x8 profile on xy at offset 0, cut 5 deep.
// Exactly 32000 - 10*8*5 = 31600. Returning 32000 means the prism went the
// wrong way and cut air: the feature succeeded and did nothing.
// BLIND TO DIRECTION: the box is centred on the sketch plane (z -10..+10,
// profile at z=0), so 31600 comes back whichever way the prism points. G1-G5
// below (one-sided slabs thinner than the cut) are what can actually tell a
// correct direction from a wrong one.
slice('pocket on xy: 10x8 cut 5 deep', () => {
  const { doc, body } = boxDoc();
  const prof = mt.newRectangleSketch(doc, 'xy', [-5, -4], [5, 4]);
  doc.features.push(prof);
  const pk = mt.newPocket(doc, prof.id, body.id);
  pk.depth = 5;
  doc.features.push(pk);
  const res = buildDoc(oc, doc, arc);
  const cut = res.shapes.get(pk.id);
  check('pocket on xy: 10x8 cut 5 deep', cut ? volume(cut) : NaN, 31600);
});

// --- slice 3: pocket on xz, where PLANE_AXES.dir is -1 ---------------------
// The same 400 mm^3 removed on the one plane whose `dir` is negative. A sign
// that is accidentally right on xy and wrong here passes slice 2 and fails
// this one, which is the whole reason this slice exists.
// BLIND TO DIRECTION for the same reason slice 2 is: the box straddles the
// sketch plane, so 31600 comes back either way. G1-G5 are the fixtures that
// can actually see it.
slice('pocket on xz (dir = -1): 10x8 cut 5 deep', () => {
  const { doc, body } = boxDoc();
  const prof = mt.newRectangleSketch(doc, 'xz', [-5, -4], [5, 4]);
  doc.features.push(prof);
  const pk = mt.newPocket(doc, prof.id, body.id);
  pk.depth = 5;
  doc.features.push(pk);
  const res = buildDoc(oc, doc, arc);
  const cut = res.shapes.get(pk.id);
  check('pocket on xz (dir = -1): 10x8 cut 5 deep', cut ? volume(cut) : NaN, 31600);
});

// --- slice 4: depth scales the cut -----------------------------------------
// A depth the branch reads but never applies would still pass slice 2 if the
// prism happened to be the right size. Doubling it must double the loss.
// BLIND TO DIRECTION too -- same centred box, depth 10 still fits inside
// z +-10 either way it points. G1-G5 below are the ones that pin direction.
slice('pocket depth 10 removes twice as much', () => {
  const { doc, body } = boxDoc();
  const prof = mt.newRectangleSketch(doc, 'xy', [-5, -4], [5, 4]);
  doc.features.push(prof);
  const pk = mt.newPocket(doc, prof.id, body.id);
  pk.depth = 10;
  doc.features.push(pk);
  const res = buildDoc(oc, doc, arc);
  const cut = res.shapes.get(pk.id);
  check('pocket depth 10 removes twice as much', cut ? volume(cut) : NaN, 31200);
});

// --- slices G1-G5: fixtures that can actually see the cut direction --------
// docs/specs/SPEC-pocket-drag-handle.md §4.2. Slices 2-4 above cannot
// distinguish "correct" from "wrong direction" because their box straddles
// the sketch plane -- a prism pointed either way lands wholly inside 40mm of
// material. Put the solid ENTIRELY on one side of the plane and make it
// THINNER than the cut depth on that side: now the wrong direction clips
// against the far face and removes a different (smaller) volume than the
// right one, so volume alone is decisive.
//
// A slab merely placed on one side is not enough by itself -- if it is
// thicker than the depth, a wrong-direction cut that still lands in material
// removes the same volume as the right one. The thinness is load-bearing.
function slabDoc(size, center) {
  const doc = { features: [] };
  const body = mt.newShape(doc, 'box');
  body.size = size;
  body.center = center;
  doc.features.push(body);
  return { doc, body };
}

// G1: xy, box [40,40,8] @ [0,0,4] (z 0..8), sketch xy@6, 10x8 profile, depth 5.
// Correct: cut z 1..6, wholly inside -- removes 400 -> 12400.
// Wrong: cut z 6..11, clipped to 6..8 -- removes 160 -> 12640.
slice('pocket G1: xy one-sided slab thinner than depth', () => {
  const { doc, body } = slabDoc([40, 40, 8], [0, 0, 4]);
  const prof = mt.newRectangleSketch(doc, 'xy', [-5, -4], [5, 4]);
  prof.offset = 6;
  doc.features.push(prof);
  const pk = mt.newPocket(doc, prof.id, body.id);
  pk.depth = 5;
  doc.features.push(pk);
  const res = buildDoc(oc, doc, arc);
  const cut = res.shapes.get(pk.id);
  check('pocket G1: xy one-sided slab thinner than depth', cut ? volume(cut) : NaN, 12400);
});

// G2: xz, box [40,8,40] @ [0,4,0] (y 0..8), sketch xz@2, 10x8 profile, depth 5.
// Correct: cut y 2..7, wholly inside -- removes 400 -> 12400.
// Wrong: cut y -3..2, clipped to 0..2 -- removes 160 -> 12640.
slice('pocket G2: xz one-sided slab thinner than depth', () => {
  const { doc, body } = slabDoc([40, 8, 40], [0, 4, 0]);
  const prof = mt.newRectangleSketch(doc, 'xz', [-5, -4], [5, 4]);
  prof.offset = 2;
  doc.features.push(prof);
  const pk = mt.newPocket(doc, prof.id, body.id);
  pk.depth = 5;
  doc.features.push(pk);
  const res = buildDoc(oc, doc, arc);
  const cut = res.shapes.get(pk.id);
  check('pocket G2: xz one-sided slab thinner than depth', cut ? volume(cut) : NaN, 12400);
});

// G3: yz, box [8,40,40] @ [4,0,0] (x 0..8), sketch yz@6, 10x8 profile, depth 5.
// Correct: cut x 1..6, wholly inside -- removes 400 -> 12400.
// Wrong: cut x 6..11, clipped to 6..8 -- removes 160 -> 12640.
slice('pocket G3: yz one-sided slab thinner than depth', () => {
  const { doc, body } = slabDoc([8, 40, 40], [4, 0, 0]);
  const prof = mt.newRectangleSketch(doc, 'yz', [-5, -4], [5, 4]);
  prof.offset = 6;
  doc.features.push(prof);
  const pk = mt.newPocket(doc, prof.id, body.id);
  pk.depth = 5;
  doc.features.push(pk);
  const res = buildDoc(oc, doc, arc);
  const cut = res.shapes.get(pk.id);
  check('pocket G3: yz one-sided slab thinner than depth', cut ? volume(cut) : NaN, 12400);
});

// G4: xz, box [60,14,30] @ [15,7,2.5] (y 0..14), sketch xz@10, 30x5 RECT
// profile, depth 6. Pins a NON-ZERO offset with the overshoot running the
// OTHER way round -- here the correct answer is the SMALLER cut, so a
// fixture that passes by accident on "correct removes more" fails this one.
// Correct: cut y 10..16, clipped to 10..14 -- removes 600 -> 24600.
// Wrong: cut y 4..10, wholly inside -- removes 900 -> 24300.
slice('pocket G4: xz non-zero offset, overshoot the other way', () => {
  const { doc, body } = slabDoc([60, 14, 30], [15, 7, 2.5]);
  const prof = mt.newRectangleSketch(doc, 'xz', [0, 0], [30, 5]);
  prof.offset = 10;
  doc.features.push(prof);
  const pk = mt.newPocket(doc, prof.id, body.id);
  pk.depth = 6;
  doc.features.push(pk);
  const res = buildDoc(oc, doc, arc);
  const cut = res.shapes.get(pk.id);
  check('pocket G4: xz non-zero offset, overshoot the other way', cut ? volume(cut) : NaN, 24600);
});

// G5: xy, box [60,60,8] @ [0,0,4] (z 0..8), sketch xy@6, Ø10 circle profile
// off-centre at [12,-6], depth 5. Pins the circle-profile path and an
// off-centre profile at once.
// Correct: cut z 1..6, wholly inside -- removes pi*5^2*5 = 392.699 -> 28407.301.
// Wrong: cut z 6..11, clipped to 6..8 -- removes pi*5^2*2 = 157.08 -> 28642.92.
slice('pocket G5: xy off-centre circle profile', () => {
  const { doc, body } = slabDoc([60, 60, 8], [0, 0, 4]);
  const prof = mt.newCircleSketch(doc, 'xy', [12, -6]);
  prof.points = [[7, -6], [17, -6]];
  prof.offset = 6;
  doc.features.push(prof);
  const pk = mt.newPocket(doc, prof.id, body.id);
  pk.depth = 5;
  doc.features.push(pk);
  const res = buildDoc(oc, doc, arc);
  const cut = res.shapes.get(pk.id);
  check('pocket G5: xy off-centre circle profile', cut ? volume(cut) : NaN, 28407.301, 1e-1);
});

// --- slices 5-8: prism and wedge, retro-gated ------------------------------
// The other two ModelDoc kinds P1a added and never executed. Both have exact
// closed-form volumes, so unlike groove there is a real number to demand.
//
// The expectations are derived from the CONTRACT (model-types.ts's own field
// docs: `sides`, `radius` as circumradius, `height`; a right triangle of legs
// `width` and `depth` extruded `height`), NOT read back off occt-build.ts. A
// gate that reproduces the implementation's arithmetic agrees with the bug.
//
//   regular n-gon, circumradius R:  area = (n/2) R^2 sin(2*pi/n)
//   n = 6 folds to the closed form SPEC-P1-parity-closeout quotes: (3*sqrt3/2) R^2
//   right triangle, legs w and d:   area = w*d/2

const ngonArea = (n, R) => (n / 2) * R * R * Math.sin((2 * Math.PI) / n);

function primDoc(kind, fields) {
  const doc = { features: [] };
  const f = mt.newShape(doc, kind);
  Object.assign(f, fields);
  doc.features.push(f);
  const res = buildDoc(oc, doc, arc);
  return res.shapes.get(f.id);
}

slice('prism: hexagon R=10 h=20', () => {
  const s = primDoc('prism', { sides: 6, radius: 10, height: 20, center: [0, 0, 0] });
  // (3*sqrt3/2) * 100 * 20 = 5196.152
  check('prism: hexagon R=10 h=20', s ? volume(s) : NaN, ngonArea(6, 10) * 20);
});

// `sides` is the one field a prism cannot be right without, and a branch that
// ignored it would still pass the hexagon slice if it happened to hardcode 6.
slice('prism: triangle sides=3 R=10 h=20', () => {
  const s = primDoc('prism', { sides: 3, radius: 10, height: 20, center: [0, 0, 0] });
  check('prism: triangle sides=3 R=10 h=20', s ? volume(s) : NaN, ngonArea(3, 10) * 20);
});

slice('wedge: 20 x 10 legs, 6 tall', () => {
  const s = primDoc('wedge', { width: 20, depth: 10, height: 6, center: [0, 0, 0] });
  // (20 * 10 / 2) * 6 = 600
  check('wedge: 20 x 10 legs, 6 tall', s ? volume(s) : NaN, (20 * 10 / 2) * 6);
});

// A wedge is HALF the box of the same dimensions. Stated separately because
// the failure it catches is the one worth naming: a right-triangle profile
// that silently closed into a rectangle reads as a plausible solid and would
// pass any "did it build" check.
slice('wedge is half its bounding box', () => {
  const s = primDoc('wedge', { width: 30, depth: 12, height: 8, center: [0, 0, 0] });
  check('wedge is half its bounding box', s ? volume(s) : NaN, (30 * 12 * 8) / 2);
});

// --- slice 5: end to end, from student script text -------------------------
// Every slice above hand-builds the doc, which is exactly what the unit tests
// do too -- so nothing yet proves the doc the DSL actually PRODUCES is one the
// kernel can build. This is the path a student takes: type text, get a solid.
slice('end to end: script text -> solid', () => {
  const src = "const sk1 = sketch('top'); sk1.rect(10, 8); "
    + 'const box1 = cuboid(40, 40, 20); pocket(sk1, box1, 5)';
  const r = runScript(src);
  if (r.errors.length) throw new Error(`script errors: ${JSON.stringify(r.errors)}`);
  const pk = r.doc.features.find((f) => f.kind === 'pocket');
  if (!pk) throw new Error('runScript produced no pocket feature');
  const res = buildDoc(oc, r.doc, arc);
  const cut = res.shapes.get(pk.id);
  check('end to end: script text -> solid', cut ? volume(cut) : NaN, 31600);
});

console.log(`\nModelDoc/OCCT gate: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
