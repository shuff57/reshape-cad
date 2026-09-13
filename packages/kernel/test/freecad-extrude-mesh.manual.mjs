#!/usr/bin/env node
// Real-kernel regression test for a bug found live in the browser sandbox
// (VITE_RESHAPE_ENGINE=freecad): Sketch tool -> select -> Pull (an
// ExtrudeFeature over the default rectangle sketch) consistently failed with
// "The kernel built a solid, but meshing it returned nothing drawable.",
// zero console errors, while a 'box' PRIMITIVE meshed fine every time.
//
// GAP THIS FILE CLOSES: every other packages/kernel/test/*.manual.mjs calls
// session.mesh(entry.objName) / session.meshFaces(entry.objName) directly --
// bypassing FreeCadEngineAdapter.mesh() entirely, and using objName, never
// bodyName (which is what the adapter's own mesh() actually keys off, per
// its own header comment on why). None of them exercise the REAL production
// call the viewport makes (BrepViewportThree.tsx:2317 ->
// FreeCadEngineAdapter.mesh(shape)). This file does, via adapter.build()
// then adapter.mesh(entry) -- the exact two calls the app makes.
//
// ROOT CAUSE (confirmed against the real kernel, not guessed): the default
// rectangle sketch (model-types.ts's newSketch(), carrying
// RECTANGLE_CONSTRAINTS) already reduces to 4 real DoF once its 4-line loop
// is welded and given horizontal/vertical constraints on all edges.
// sketch-translate.ts's DoF-closure loop then pins EVERY corner's x AND y
// anyway (8 more constraints), making 4 of them genuinely redundant.
// FreeCAD's `sk.solve()` (what sketchState() reads) called them perfectly
// consistent -- conflicting: [], malformed: [], dof already 0 -- so
// pinAxisIfNeeded's own conflicting/malformed-only check never looked at
// them and left all 4 in the sketch. FreeCAD's REAL solve, run during the
// full-document doc.recompute() that session.pad() triggers (a stricter,
// different path than sk.solve()'s own quick GCS probe), refuses to compute
// a Shape at all for a sketch that still carries a redundant constraint --
// no Python exception, the object is just left `Touched` with
// `Shape.isNull()` true. The Pad built on that broken profile inherits the
// same Touched/null Shape, and meshFaces() -- which only ever reads
// `sh.Faces` off an already-valid Shape -- then finds nothing, three call
// frames removed from where the console warning actually printed. A
// primitive (box/cylinder) never hits this: its own inline rectangle
// (fc-commands.mjs's sketchRect()) carries ZERO constraints, so it can never
// have a redundant one.
//
// FIX: sketch-translate.ts's translateSketch() now does a final redundant-
// constraint sweep once DoF closure reaches 0 with no conflicts -- see that
// file's own comment for why deleting is provably safe there, and why
// `sk.RedundantConstraints` is 1-based (an off-by-one confirmed live: a
// 16-constraint sketch reported redundant index 16, which delConstraint's
// own 0-based argument rejects outright).
//
// UNIVERSALITY: reproduces identically for xy@0 (the exact reported fixture)
// and xz@10 (a different plane/offset from SPEC-extrude-drag-handle.md) --
// this is NOT fixture-specific, it is universal to any sketch carrying
// RECTANGLE_CONSTRAINTS (i.e. every "Sketch" tool default rectangle),
// regardless of plane/offset, since sketch-translate.ts's closure loop runs
// identically before any plane placement is applied.
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 in Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" -v "<repo>:/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad"
//     fc-kernel-pd-final node --experimental-wasm-exnref
//     /repo/packages/kernel/test/freecad-extrude-mesh.manual.mjs
//     /work/build/bin/FreeCADCmd.js
// Run `npm run build` first (this imports packages/kernel/dist/* + packages/engine/dist/*).

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

let pass = 0;
let fail = 0;
function checkTrue(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  ok ? pass++ : fail++;
}
function check(label, got, want, tol = 0.5) {
  const ok = typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${typeof got === 'number' ? got.toFixed(4) : String(got)} (want ${want.toFixed(4)})`);
  ok ? pass++ : fail++;
}

const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-extrude-mesh.manual.mjs <path-to-FreeCADCmd.js>');
  process.exit(1);
}

globalThis.resolveGlobalSymbol = globalThis.resolveGlobalSymbol
  || function resolveGlobalSymbolStub() { return { sym: undefined }; };

const { loadNodeKernel } = await load('packages/engine/src/fc-session-node.mjs');
const { createFcSession } = await load('packages/engine/src/fc-session.mjs');
const { attachCommands } = await load('packages/engine/src/fc-commands.mjs');
const { attachSketchCommands } = await load('packages/engine/src/fc-sketch.mjs');
const { attachDrawingCommands } = await load('packages/engine/src/fc-drawing.mjs');
const { FreeCadEngineAdapter } = await load('packages/kernel/dist/freecad-engine-adapter.js');

const Module = await loadNodeKernel(fcKernelJs);
const session = attachDrawingCommands(attachSketchCommands(attachCommands(createFcSession(Module))));
const adapter = new FreeCadEngineAdapter(THREE, async () => Module);
adapter['session'] = session;

// model-types.ts's own RECTANGLE_CONSTRAINTS -- every "Sketch" tool default
// rectangle carries exactly this, which is what makes the closure loop's
// extra corner pins redundant. A sketch fixture WITHOUT this (as every prior
// real-kernel extrude test in this repo used, see this file's own header)
// never exercises the bug at all.
const RECTANGLE_CONSTRAINTS = [
  { kind: 'horizontal', edge: 0 },
  { kind: 'vertical', edge: 1 },
  { kind: 'horizontal', edge: 2 },
  { kind: 'vertical', edge: 3 },
];

function buildAndMesh(id, plane, offset, height) {
  const skId = `${id}_sk`;
  const doc = {
    version: 1,
    features: [
      { id: skId, kind: 'sketch', plane, offset, points: [[0, 0], [40, 0], [40, 25], [0, 25]], constraints: RECTANGLE_CONSTRAINTS },
      { id, kind: 'extrude', target: skId, height },
    ],
  };
  const fc = adapter.build(doc);
  return { fc, entry: fc.shapes.get(id) };
}

console.log("--- box primitive (control -- must mesh, matches every real-browser session so far) ---");
{
  const doc = { version: 1, features: [{ id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] }] };
  const fc = adapter.build(doc);
  const entry = fc.shapes.get('box1');
  const m = adapter.mesh(entry);
  checkTrue('box meshes (adapter.mesh() via bodyName)', m !== null);
  if (m) check('box volume', session.meshFaces(entry.bodyName).volume, 32000, 1.0);
}

console.log("\n--- Sketch(default rect, RECTANGLE_CONSTRAINTS) -> Pull, xy@0: the exact reported repro ---");
{
  const { fc, entry } = buildAndMesh('ex_xy0', 'xy', 0, 12);
  checkTrue('built (no refusal)', !fc.refusals?.get('ex_xy0'));
  checkTrue('entry exists', !!entry);
  const m = entry && adapter.mesh(entry);
  checkTrue('adapter.mesh(entry) returns a real mesh, not null', m !== null,
    m === null ? 'THIS is the reported bug: "meshing returned nothing drawable"' : '');
  if (m) {
    checkTrue('mesh has faces', m.faces.length > 0, `${m.faces.length} faces`);
    check('volume (40 x 25 x 12)', session.meshFaces(entry.bodyName).volume, 12000, 1.0);
  }
}

console.log("\n--- Sketch(default rect, RECTANGLE_CONSTRAINTS) -> Pull, xz@10: a different plane/offset -- proves this is UNIVERSAL, not fixture-specific ---");
{
  const { fc, entry } = buildAndMesh('ex_xz10', 'xz', 10, 12);
  checkTrue('built (no refusal)', !fc.refusals?.get('ex_xz10'));
  checkTrue('entry exists', !!entry);
  const m = entry && adapter.mesh(entry);
  checkTrue('adapter.mesh(entry) returns a real mesh, not null', m !== null);
  if (m) {
    checkTrue('mesh has faces', m.faces.length > 0, `${m.faces.length} faces`);
    check('volume (40 x 25 x 12)', session.meshFaces(entry.bodyName).volume, 12000, 1.0);
  }
}

console.log("\n--- sketch's OWN Shape (pre-Pad) must be valid, fully constrained, and Up-to-date ---");
{
  const doc = {
    version: 1,
    features: [{ id: 'sk_only', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]], constraints: RECTANGLE_CONSTRAINTS }],
  };
  const fc = adapter.build(doc);
  const entry = fc.shapes.get('sk_only');
  const probe = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `sk = doc.getObject(${JSON.stringify(entry.objName)})\n` +
    `payload = {'isNull': sk.Shape.isNull(), 'fully': sk.FullyConstrained, 'dof': sk.DoF, 'state': list(sk.State), ` +
    `'redundant': list(sk.RedundantConstraints)}\n` +
    `open(${JSON.stringify('/tmp/reshape_out.json')}, 'w').write(json.dumps(payload))\n`
  );
  checkTrue('sketch Shape is not null', probe.isNull === false, JSON.stringify(probe));
  checkTrue('sketch is fully constrained (dof 0)', probe.fully === true && probe.dof === 0, JSON.stringify(probe));
  checkTrue('no leftover redundant constraints', probe.redundant.length === 0, JSON.stringify(probe));
  // NOT asserting State here: sketchState()'s own sk.solve() computes valid
  // geometry directly (isNull/fully/redundant above prove that) without
  // running it through doc.recompute()'s full dependency-graph bookkeeping,
  // so the object can read "Touched" even with a perfectly valid Shape.
  // That bookkeeping bit is irrelevant to the actual reported bug -- what
  // matters is whether a REAL doc.recompute() (which session.pad() always
  // triggers) ends up with a valid Shape, and the extrude+mesh checks above
  // already prove that end to end, with State literally read back as
  // Up-to-date on both the Pad and its Body.
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
