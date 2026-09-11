#!/usr/bin/env node
// Real-kernel verification for the 'pattern' (linear + polar) FreeCadEngineAdapter
// branch added in this pass (see docs/specs/SPEC-studio-canonical.md phase 2).
// Same "two engines, one number" bar as freecad-new-kinds.manual.mjs: build the
// SAME ModelDoc fixture through OcctEngineAdapter's own buildDoc() and through
// FreeCadEngineAdapter, and compare volume + bounding-box SPAN.
//
// This script resolved three semantics that were not knowable from reading
// fc-commands.mjs alone -- each is exactly the kind of thing this port's own
// report calls out as needing a measured answer rather than an assumption,
// and each measurement found a real bug, since fixed (see fc-commands.mjs's
// own comments on linearPattern/polarPattern):
//   1. PartDesign::LinearPattern.Length -- per-step spacing, or the total
//      span from the first to the last instance (step * (count-1))? Confirmed
//      total span, by bbox extent.
//   2. A negative step/Length -- errors ("Pattern length too small") rather
//      than reversing direction. Fixed by moving direction into the separate
//      Reversed boolean property and always sending a positive Length.
//   3. Body.Tip does not auto-advance to a PartDesign::LinearPattern/
//      PolarPattern created via newObject() -- Body.Shape kept reflecting the
//      PRE-pattern feature until this script caught it (bbox showing a single
//      instance's extent, not the whole pattern's). Fixed by setting
//      body.Tip explicitly.
// A fourth, DIFFERENT-IN-KIND finding (not a bug in this pass's own code, a
// genuine semantic gap): a circular pattern of a sphere/cone/torus/prism
// target is a geometric no-op on this engine (every copy lands on the
// original) -- see freecad-engine-adapter.ts's own comment on
// `bodyLocalCentered` for why, and this port's own report. Verified below to
// REFUSE, not silently build a collapsed ring.
//
// Bbox comparisons use SPAN (max-min per axis), not absolute position. A
// separate, pre-existing, OUT-OF-SCOPE bug this pass found but did NOT fix
// (box/cylinder bake `center` into their own local sketch coordinates AND
// get it applied a second time via Body.Placement) shifts an off-origin
// box/cylinder's ABSOLUTE world position -- but never changes its SPAN or
// its volume, so both remain a valid, uncontaminated signal for whether the
// pattern feature itself is correct. See this port's own report for the
// pre-existing bug's own repro numbers.
//
// USAGE
//   node packages/kernel/test/freecad-pattern.manual.mjs <pathToFreeCADCmd.js>
// Run `npm run build` first.

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
function span(bbox) { return [0, 1, 2].map((i) => bbox[1][i] - bbox[0][i]); }

// ---------------------------------------------------------------------------
// OCCT reference volumes/bboxes
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

// Linear: 3 copies of a 10x10x10 box at the world origin, step 20 along +x
// -- non-overlapping (step 20 > box width 10), so fused volume must be
// exactly 3x one box, and bbox span 5 + 2*20 + 5 = 50 along x.
const linDoc = {
  version: 1,
  features: [
    { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
    { id: 'pat1', kind: 'pattern', target: 'box1', mode: 'linear', count: 3, step: [20, 0, 0] },
  ],
};
// Circular: 4 copies of a 10x10x10 box centred at [30,0,0], orbited a full
// 360 around world Z -- at 90 degree spacing (occt-build.ts's own
// totalAngle/count convention) the 4 copies sit at 0/90/180/270 around a
// radius-30 circle, far enough apart (30 >> 10) that none overlap, so fused
// volume must be exactly 4x one box. A 72-degree (Angle/(count-1)) spacing
// would instead place a duplicate at the seam and read back as 3x.
const circDoc = {
  version: 1,
  features: [
    { id: 'box2', kind: 'box', size: [10, 10, 10], center: [30, 0, 0] },
    { id: 'pat2', kind: 'pattern', target: 'box2', mode: 'circular', count: 4, axis: 'z', totalAngle: 360 },
  ],
};
// Negative step -- must reverse direction, not error.
const negDoc = {
  version: 1,
  features: [
    { id: 'box3', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
    { id: 'pat3', kind: 'pattern', target: 'box3', mode: 'linear', count: 3, step: [-15, 0, 0] },
  ],
};

const occtLin = measureShape(oc, buildDoc(oc, linDoc, arc).shapes.get('pat1'));
const occtCirc = measureShape(oc, buildDoc(oc, circDoc, arc).shapes.get('pat2'));
const occtNeg = measureShape(oc, buildDoc(oc, negDoc, arc).shapes.get('pat3'));

console.log(`OCCT linear pattern:   volume ${occtLin.volume}  bbox ${JSON.stringify(occtLin.bbox)}  span ${JSON.stringify(span(occtLin.bbox))}`);
console.log(`OCCT circular pattern: volume ${occtCirc.volume}  bbox ${JSON.stringify(occtCirc.bbox)}  span ${JSON.stringify(span(occtCirc.bbox))}`);
console.log(`OCCT negative-step pattern: volume ${occtNeg.volume}  bbox ${JSON.stringify(occtNeg.bbox)}  span ${JSON.stringify(span(occtNeg.bbox))}`);

// ---------------------------------------------------------------------------
// FreeCAD half
// ---------------------------------------------------------------------------
const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-pattern.manual.mjs <path-to-FreeCADCmd.js>');
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

function bodyBBox(bodyName) {
  return session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `bb = doc.getObject(${JSON.stringify(bodyName)}).Shape.BoundBox\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`
  ).bbox;
}
function tipName(bodyName) {
  return session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `b = doc.getObject(${JSON.stringify(bodyName)})\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'tip': b.Tip.Name if b.Tip else None}))\n`
  ).tip;
}

console.log('\n--- linear pattern ---');
const fcLin = adapter.build(linDoc);
if (fcLin.refusals?.size) console.log('refusals:', [...fcLin.refusals.entries()]);
const linEntry = fcLin.shapes.get('pat1');
checkTrue('linear pattern built (no refusal)', !fcLin.refusals?.get('pat1'));
checkTrue('linear pattern object name is per-feature-id, not the emitter default', linEntry.objName === 'pat1_pattern', linEntry.objName);
checkTrue('LinearPattern became the Body Tip', tipName(linEntry.bodyName) === linEntry.objName, tipName(linEntry.bodyName));
const fcLinMesh = session.mesh(linEntry.objName);
check('FreeCAD linear pattern volume vs OCCT (3 non-overlapping boxes)', fcLinMesh.volume, occtLin.volume);
const fcLinBbox = bodyBBox(linEntry.bodyName);
const fcLinSpan = span(fcLinBbox);
console.log(`FreeCAD linear pattern bbox: ${JSON.stringify(fcLinBbox)}  span ${JSON.stringify(fcLinSpan)}`);
const occtLinSpan = span(occtLin.bbox);
for (let i = 0; i < 3; i++) {
  check(`linear span[${i}] (confirms Length = step*(count-1), not step alone)`, fcLinSpan[i], occtLinSpan[i], 0.5);
}

console.log('\n--- circular pattern ---');
const fcCirc = adapter.build(circDoc);
if (fcCirc.refusals?.size) console.log('refusals:', [...fcCirc.refusals.entries()]);
const circEntry = fcCirc.shapes.get('pat2');
checkTrue('circular pattern built (no refusal)', !fcCirc.refusals?.get('pat2'));
const fcCircMesh = session.mesh(circEntry.objName);
check('FreeCAD circular pattern volume vs OCCT (4 non-overlapping boxes -- rules out a 72-degree/duplicate-at-seam spacing)', fcCircMesh.volume, occtCirc.volume);
const fcCircBbox = bodyBBox(circEntry.bodyName);
const fcCircSpan = span(fcCircBbox);
console.log(`FreeCAD circular pattern bbox: ${JSON.stringify(fcCircBbox)}  span ${JSON.stringify(fcCircSpan)}`);
const occtCircSpan = span(occtCirc.bbox);
for (let i = 0; i < 3; i++) {
  check(`circular span[${i}] (a valid 90-degree-spaced ring has the same footprint regardless of the pre-existing box-placement bug's absolute shift)`, fcCircSpan[i], occtCircSpan[i], 0.5);
}

console.log('\n--- negative-step linear pattern (direction reversal) ---');
const fcNeg = adapter.build(negDoc);
if (fcNeg.refusals?.size) console.log('refusals:', [...fcNeg.refusals.entries()]);
const negEntry = fcNeg.shapes.get('pat3');
checkTrue('negative-step pattern built (no refusal)', !fcNeg.refusals?.get('pat3'));
const fcNegMesh = session.mesh(negEntry.objName);
check('FreeCAD negative-step pattern volume vs OCCT', fcNegMesh.volume, occtNeg.volume);
const fcNegBbox = bodyBBox(negEntry.bodyName);
const fcNegSpan = span(fcNegBbox);
console.log(`FreeCAD negative-step pattern bbox: ${JSON.stringify(fcNegBbox)}  span ${JSON.stringify(fcNegSpan)}`);
const occtNegSpan = span(occtNeg.bbox);
for (let i = 0; i < 3; i++) {
  check(`negative-step span[${i}] (confirms a negative step still spans the full 3 copies via Reversed, not a shrunk/invalid pattern)`, fcNegSpan[i], occtNegSpan[i], 0.5);
}
// Direction specifically (not just span, which is sign-blind): the negative-
// step pattern must extend in -x from the origin box, not +x.
checkTrue('negative-step pattern actually extends in -x (Reversed really reverses, not just "did not error")', fcNegBbox[0][0] < -20, `xMin=${fcNegBbox[0][0]}`);

console.log('\n--- two independent linear patterns in ONE document (patternName collision check) ---');
const bothDoc = {
  version: 1,
  features: [
    { id: 'box6', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
    { id: 'pat6', kind: 'pattern', target: 'box6', mode: 'linear', count: 3, step: [20, 0, 0] },
    { id: 'box7', kind: 'box', size: [8, 8, 8], center: [0, 100, 0] },
    { id: 'pat7', kind: 'pattern', target: 'box7', mode: 'linear', count: 2, step: [0, 20, 0] },
  ],
};
const occtBoth6 = measureShape(oc, buildDoc(oc, bothDoc, arc).shapes.get('pat6'));
const occtBoth7 = measureShape(oc, buildDoc(oc, bothDoc, arc).shapes.get('pat7'));
const fcBoth = adapter.build(bothDoc);
if (fcBoth.refusals?.size) console.log('refusals:', [...fcBoth.refusals.entries()]);
const both6 = fcBoth.shapes.get('pat6');
const both7 = fcBoth.shapes.get('pat7');
checkTrue('both patterns built with no refusal', !fcBoth.refusals?.get('pat6') && !fcBoth.refusals?.get('pat7'));
checkTrue('both patterns kept their own distinct, requested object names (no auto-suffix collision)',
  both6.objName === 'pat6_pattern' && both7.objName === 'pat7_pattern',
  `${both6.objName}, ${both7.objName}`);
check('pattern 1 of 2 volume unaffected by a second pattern in the same document', session.mesh(both6.objName).volume, occtBoth6.volume);
check('pattern 2 of 2 volume unaffected by a second pattern in the same document', session.mesh(both7.objName).volume, occtBoth7.volume);

console.log('\n--- refusal paths, run for real (not just against the fake session) ---');
const rotDoc = {
  version: 1,
  features: [
    { id: 'box4', kind: 'box', size: [10, 10, 10], center: [0, 0, 0], rotate: [0, 0, 30] },
    { id: 'pat4', kind: 'pattern', target: 'box4', mode: 'linear', count: 3, step: [20, 0, 0] },
  ],
};
const fcRot = adapter.build(rotDoc);
checkTrue('a rotated target refuses (not throws, not silently wrong)', !!fcRot.refusals?.get('pat4'), fcRot.refusals?.get('pat4'));
checkTrue('a refused pattern falls back to its target shape', fcRot.shapes.get('pat4') === fcRot.shapes.get('box4'));

const xAxisDoc = {
  version: 1,
  features: [
    { id: 'box5', kind: 'box', size: [10, 10, 10], center: [30, 0, 0] },
    { id: 'pat5', kind: 'pattern', target: 'box5', mode: 'circular', count: 4, axis: 'x', totalAngle: 360 },
  ],
};
const fcXAxis = adapter.build(xAxisDoc);
checkTrue("a non-z circular axis refuses", !!fcXAxis.refusals?.get('pat5'), fcXAxis.refusals?.get('pat5'));

const sphereCircDoc = {
  version: 1,
  features: [
    { id: 'sph1', kind: 'sphere', radius: 5, center: [30, 0, 0] },
    { id: 'pat8', kind: 'pattern', target: 'sph1', mode: 'circular', count: 4, axis: 'z', totalAngle: 360 },
  ],
};
const fcSphereCirc = adapter.build(sphereCircDoc);
checkTrue(
  'a circular pattern of a sphere target refuses (the real-kernel-only-visible no-op gap)',
  !!fcSphereCirc.refusals?.get('pat8'),
  fcSphereCirc.refusals?.get('pat8'),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
