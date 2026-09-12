#!/usr/bin/env node
// Real-kernel verification for the 'shell' FreeCadEngineAdapter branch added
// in this pass. Same "two engines, one number" bar as
// freecad-pattern.manual.mjs: build the SAME ModelDoc fixture through
// OcctEngineAdapter's own buildDoc() and through FreeCadEngineAdapter, and
// compare volumes.
//
// THE HEADLINE FINDING this script exists to nail down, measured directly
// against fc-kernel-pd-final's own C++ (not assumed from reading
// fc-commands.mjs or occt-build.ts): FreeCAD's PartDesign::Thickness on
// this kernel CANNOT build a fully-closed hollow (no opening) at all.
//   - FeatureThickness.cpp's own execute(): `if (subStrings.empty()) { ...
//     this->Shape.setValue(TopShape); return StdReturn; }` -- an EMPTY
//     Base sub-element list returns the UNCHANGED base shape, no exception,
//     State stays 'Up-to-date'. Measured: Value=+2 AND Value=-2 with an
//     empty face list both left the box's volume at 32000 (unchanged).
//   - TopoShapeExpansion.cpp's TopoShape::makeElementThickSolid (the raw
//     OCCT call underneath): `if (faces.empty()) { FC_THROWM(...,
//     "Null input shape"); }` -- so even bypassing the PartDesign feature
//     and calling the shape method directly throws for an empty list.
// This is a real fork-level restriction on top of vanilla FreeCAD/OCCT's
// own BRepOffsetAPI_MakeThickSolid, which occt-build.ts's own shell branch
// comment documents as accepting an empty closing-face list for a genuine
// closed hollow. So on the FreeCAD engine, freecad-engine-adapter.ts's
// 'shell' branch refuses BOTH "no `open` given" and "`open` given but
// unresolvable" -- it does NOT fall back to a closed hollow the way
// occt-build.ts's own shell branch does, because that fallback is simply
// not buildable here.
//
// Sign convention, also measured directly rather than assumed:
// PartDesign::Thickness.Reversed defaults to true
// (Thickness::Thickness(), FeatureThickness.cpp), and execute() computes
// `thickness = (reversed ? -1. : 1.) * Value`. So Value must be POSITIVE
// (f.thickness itself, unnegated) for a correct inward hollow -- passing a
// negative Value with Reversed left at its (explicitly re-asserted) true
// default left the one-open-face fixture's volume UNCHANGED at 32000
// instead of erroring: a wrong sign fails silently, not loudly.
//
// USAGE (PowerShell, from repo root, MSYS_NO_PATHCONV=1 in Git Bash):
//   docker run --rm --privileged
//     -v "<repo>:/mnt/host/c/Users/<you>/.../reshape-cad" fc-kernel-pd-final
//     node --experimental-wasm-exnref
//     /mnt/host/.../packages/kernel/test/freecad-shell.manual.mjs
//     /work/build/bin/FreeCADCmd.js
// Run `npm run build` first (this script imports packages/kernel/dist/*).

import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

let pass = 0;
let fail = 0;
function check(label, got, want, tol = 0.5) {
  const ok = typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${typeof got === 'number' ? got.toFixed(4) : String(got)} (want ${want.toFixed(4)})`);
  ok ? pass++ : fail++;
}
function checkTrue(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  ok ? pass++ : fail++;
}

// ---------------------------------------------------------------------------
// OCCT reference volume
// ---------------------------------------------------------------------------
function packagedKernel() {
  try { return path.dirname(require.resolve('replicad-opencascadejs/dist/replicad_single.js')); }
  catch { return path.join(path.dirname(require.resolve('replicad-opencascadejs/package.json')), 'dist'); }
}
const kernelDir = process.env.RESHAPE_KERNEL_DIR || packagedKernel();
const glue = await import(pathToFileURL(path.join(kernelDir, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(kernelDir, f) });

const { buildDoc, measureShape } = await load('packages/kernel/dist/occt-build.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');

const openTop = { cause: 'primitive', feature: 'box1', kind: 'face', part: '+z' };

// Box 40x40x20 centered at the world origin, thickness 2, top face open --
// the EXACT fixture occt-build.ts's own shell-branch comment already
// documents the answer for (8672), so this is a triple cross-check: OCCT via
// buildDoc(), the documented literal, and the FreeCAD engine.
const shellDoc = {
  version: 1,
  features: [
    { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 's1', kind: 'shell', target: 'box1', thickness: 2, open: openTop },
  ],
};
const occtShell = measureShape(oc, buildDoc(oc, shellDoc, arc).shapes.get('s1'));
console.log(`OCCT shell (open top): volume ${occtShell.volume}`);
check('OCCT shell volume matches occt-build.ts\'s own documented fixture number', occtShell.volume, 8672, 0.5);

// ---------------------------------------------------------------------------
// FreeCAD half
// ---------------------------------------------------------------------------
const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-shell.manual.mjs <path-to-FreeCADCmd.js>');
  process.exit(1);
}

globalThis.resolveGlobalSymbol = globalThis.resolveGlobalSymbol
  || function resolveGlobalSymbolStub() { return { sym: undefined }; };

const { loadNodeKernel } = await load('packages/engine/src/fc-session-node.mjs');
const { createFcSession } = await load('packages/engine/src/fc-session.mjs');
const { attachCommands } = await load('packages/engine/src/fc-commands.mjs');
const { attachSketchCommands } = await load('packages/engine/src/fc-sketch.mjs');
const { FreeCadEngineAdapter } = await load('packages/kernel/dist/freecad-engine-adapter.js');

const Module = await loadNodeKernel(fcKernelJs);
const session = attachSketchCommands(attachCommands(createFcSession(Module)));
const adapter = new FreeCadEngineAdapter({}, async () => Module);
adapter['session'] = session;

console.log('\n--- closed box (no shell), sanity baseline ---');
const baseDoc = { version: 1, features: [{ id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] }] };
const fcBase = adapter.build(baseDoc);
const baseEntry = fcBase.shapes.get('box1');
check('base box volume', session.mesh(baseEntry.objName).volume, 32000, 0.5);

console.log('\n--- shell with a resolvable open face (top) ---');
const fcShell = adapter.build(shellDoc);
if (fcShell.refusals?.size) console.log('refusals:', [...fcShell.refusals.entries()]);
checkTrue('shell with a resolvable open face built (no refusal)', !fcShell.refusals?.get('s1'));
const shellEntry = fcShell.shapes.get('s1');
check('FreeCAD shell volume vs OCCT (box 40x40x20, thickness 2, top open)', session.mesh(shellEntry.objName).volume, occtShell.volume, 0.5);
check('FreeCAD shell volume vs the analytical hollow-box formula (36*36*18 interior, 32000 - 23328 = 8672)', session.mesh(shellEntry.objName).volume, 8672, 0.5);

console.log('\n--- shell with NO `open` face at all: refuses (this kernel cannot build a closed hollow) ---');
const closedDoc = {
  version: 1,
  features: [
    { id: 'box2', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 's2', kind: 'shell', target: 'box2', thickness: 2 },
  ],
};
const fcClosed = adapter.build(closedDoc);
checkTrue('a shell with no open face refuses, not builds a surprise opening or silently no-ops', !!fcClosed.refusals?.get('s2'), fcClosed.refusals?.get('s2'));
checkTrue('the refused shell falls back to its target\'s own shape (pass-through, not a partial build)',
  fcClosed.shapes.get('s2') === fcClosed.shapes.get('box2'));

console.log('\n--- shell with an UNRESOLVABLE open face: also refuses, does NOT silently fall back to closed ---');
const unresolvableOpen = { cause: 'primitive', feature: 'box3', kind: 'face', part: 'not-a-real-part' };
const unresolvableDoc = {
  version: 1,
  features: [
    { id: 'box3', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 's3', kind: 'shell', target: 'box3', thickness: 2, open: unresolvableOpen },
  ],
};
const fcUnresolvable = adapter.build(unresolvableDoc);
checkTrue('an unresolvable open face refuses rather than faking a closed hollow', !!fcUnresolvable.refusals?.get('s3'), fcUnresolvable.refusals?.get('s3'));

console.log('\n--- thickness <= 0 refuses ---');
const zeroDoc = {
  version: 1,
  features: [
    { id: 'box4', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 's4', kind: 'shell', target: 'box4', thickness: 0, open: { cause: 'primitive', feature: 'box4', kind: 'face', part: '+z' } },
  ],
};
const fcZero = adapter.build(zeroDoc);
checkTrue('thickness <= 0 refuses', !!fcZero.refusals?.get('s4'), fcZero.refusals?.get('s4'));

console.log('\n--- a thickness that would collapse the box refuses ---');
const collapseDoc = {
  version: 1,
  features: [
    { id: 'box5', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    // smallest bbox dim is 20 (height); 2*11 = 22 >= 20 -> collapse.
    { id: 's5', kind: 'shell', target: 'box5', thickness: 11, open: { cause: 'primitive', feature: 'box5', kind: 'face', part: '+z' } },
  ],
};
const fcCollapse = adapter.build(collapseDoc);
checkTrue('a collapsing thickness refuses', !!fcCollapse.refusals?.get('s5'), fcCollapse.refusals?.get('s5'));

console.log('\n--- shell of a cylinder, open on top -- confirms the branch is not box-only ---');
const cylDoc = {
  version: 1,
  features: [
    { id: 'cyl1', kind: 'cylinder', radius: 10, height: 20, center: [0, 0, 0] },
    { id: 's6', kind: 'shell', target: 'cyl1', thickness: 2, open: { cause: 'primitive', feature: 'cyl1', kind: 'face', part: '+z' } },
  ],
};
const occtCyl = measureShape(oc, buildDoc(oc, cylDoc, arc).shapes.get('s6'));
const fcCyl = adapter.build(cylDoc);
if (fcCyl.refusals?.size) console.log('refusals:', [...fcCyl.refusals.entries()]);
checkTrue('cylinder shell with a resolvable open face built (no refusal)', !fcCyl.refusals?.get('s6'));
const cylEntry = fcCyl.shapes.get('s6');
check('FreeCAD cylinder-shell volume vs OCCT', session.mesh(cylEntry.objName).volume, occtCyl.volume, 0.5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
