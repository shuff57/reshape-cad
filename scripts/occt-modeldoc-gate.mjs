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
//   node scripts/occt-modeldoc-gate.mjs
//   RESHAPE_KERNEL_DIR=/path/to/kernel node scripts/occt-modeldoc-gate.mjs
//
// Run `npm run build --workspaces` FIRST -- this gate reads packages/*/dist,
// not src, because that is what the browser loads too.

import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');

// shCode serves these at /reshape/kernel; that checkout is the default because
// it is the only place on any box that has the .wasm. Override for another.
const KERNEL_DIR = process.env.RESHAPE_KERNEL_DIR
  ?? 'C:/Users/shuff57/Documents/GitHub/shCode/public/reshape/kernel';

const WASM = path.join(KERNEL_DIR, 'replicad_single.wasm');
if (!existsSync(WASM)) {
  console.error(`FAIL: no kernel wasm at ${WASM}`);
  console.error('The replicad build is gitignored (23 MB). Point RESHAPE_KERNEL_DIR at a');
  console.error('checkout that has public/reshape/kernel/replicad_single.{js,wasm}.');
  process.exit(1);
}

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

// --- slice 1: groove, retro-gated ------------------------------------------
// P1a shipped this branch and it has never been executed. Not asserting an
// exact volume: the swept ring's geometry was never derived, and inventing an
// expected number now would be a guess dressed as a gate. What IS asserted is
// the thing that was actually in doubt -- that it removes material at all.
{
  const { doc, body } = boxDoc();
  const prof = mt.newRectangleSketch(doc, 'xz', [10, 5], [15, 12]);
  doc.features.push(prof);
  const gr = mt.newGroove(doc, prof.id, body.id);
  gr.angle = 360;
  doc.features.push(gr);
  const res = buildDoc(oc, doc, arc);
  const cut = res.shapes.get(gr.id);
  checkChanged('groove (P1a) removes material', 32000, cut ? volume(cut) : NaN);
}

// --- slice 2: pocket on xy, the headline number ----------------------------
// 40x40x20 box, a 10x8 profile on xy at offset 0, cut 5 deep.
// Exactly 32000 - 10*8*5 = 31600. Returning 32000 means the prism went the
// wrong way and cut air: the feature succeeded and did nothing.
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
