#!/usr/bin/env node
// Real-kernel verification for the cone/torus/prism FreeCadEngineAdapter
// branches added in this pass (see docs/specs/SPEC-engine-port.md §6.1).
// Same "two engines, one number" bar as freecad-vs-occt.manual.mjs: build
// the SAME ModelDoc fixture through OcctEngineAdapter's own buildDoc() and
// through FreeCadEngineAdapter, and compare volumes.
//
// USAGE
//   node packages/kernel/test/freecad-new-kinds.manual.mjs <pathToFreeCADCmd.js>
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

// ---------------------------------------------------------------------------
// OCCT reference volumes
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

const coneDoc = { version: 1, features: [{ id: 'c1', kind: 'cone', radius: 5, height: 10, center: [0, 0, 0] }] };
const torusDoc = { version: 1, features: [{ id: 't1', kind: 'torus', ringRadius: 10, tubeRadius: 2, center: [30, 0, 0] }] };
const prismDoc = { version: 1, features: [{ id: 'p1', kind: 'prism', sides: 8, radius: 6, height: 15, center: [0, 30, 0] }] };
const prismRotDoc = { version: 1, features: [{ id: 'p2', kind: 'prism', sides: 5, radius: 8, height: 12, center: [10, 10, 0], rotate: [0, 0, 20] }] };

const occtCone = measureShape(oc, buildDoc(oc, coneDoc, arc).shapes.get('c1'));
const occtTorus = measureShape(oc, buildDoc(oc, torusDoc, arc).shapes.get('t1'));
const occtPrism = measureShape(oc, buildDoc(oc, prismDoc, arc).shapes.get('p1'));
const occtPrismRot = measureShape(oc, buildDoc(oc, prismRotDoc, arc).shapes.get('p2'));

console.log(`OCCT cone volume:        ${occtCone.volume}`);
console.log(`OCCT torus volume:       ${occtTorus.volume}  bbox ${JSON.stringify(occtTorus.bbox)}`);
console.log(`OCCT prism volume:       ${occtPrism.volume}  bbox ${JSON.stringify(occtPrism.bbox)}`);
console.log(`OCCT rotated prism bbox: ${JSON.stringify(occtPrismRot.bbox)}`);

// ---------------------------------------------------------------------------
// FreeCAD half
// ---------------------------------------------------------------------------
const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-new-kinds.manual.mjs <path-to-FreeCADCmd.js>');
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

console.log('\n--- cone ---');
const fcCone = adapter.build(coneDoc);
if (fcCone.refusals?.size) console.log('refusals:', [...fcCone.refusals.entries()]);
const fcConeMesh = session.mesh(fcCone.shapes.get('c1').objName);
check('FreeCAD cone volume vs OCCT', fcConeMesh.volume, occtCone.volume);

console.log('\n--- torus ---');
const fcTorus = adapter.build(torusDoc);
if (fcTorus.refusals?.size) console.log('refusals:', [...fcTorus.refusals.entries()]);
const fcTorusMesh = session.mesh(fcTorus.shapes.get('t1').objName);
check('FreeCAD torus volume vs OCCT', fcTorusMesh.volume, occtTorus.volume);
// volume alone can't catch a torus built at the wrong world position (same
// volume, wrong place) -- read the placed object's own Shape.BoundBox too.
const fcTorusBbox = session.read(
  `import json, FreeCAD as App\n` +
  `doc = App.ActiveDocument\n` +
  `bb = doc.getObject(${JSON.stringify(fcTorus.shapes.get('t1').bodyName)}).Shape.BoundBox\n` +
  `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`
);
console.log(`FreeCAD torus bbox: ${JSON.stringify(fcTorusBbox.bbox)}`);
for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
  check(`torus bbox[${i}][${j}]`, fcTorusBbox.bbox[i][j], occtTorus.bbox[i][j], 0.5);
}

console.log('\n--- prism (octagon, unrotated) ---');
const fcPrism = adapter.build(prismDoc);
if (fcPrism.refusals?.size) console.log('refusals:', [...fcPrism.refusals.entries()]);
const fcPrismMesh = session.mesh(fcPrism.shapes.get('p1').objName);
check('FreeCAD prism volume vs OCCT', fcPrismMesh.volume, occtPrism.volume);

console.log('\n--- prism (pentagon, rotated) ---');
const fcPrismRot = adapter.build(prismRotDoc);
if (fcPrismRot.refusals?.size) console.log('refusals:', [...fcPrismRot.refusals.entries()]);
const fcPrismRotBbox = session.read(
  `import json, FreeCAD as App\n` +
  `doc = App.ActiveDocument\n` +
  `bb = doc.getObject(${JSON.stringify(fcPrismRot.shapes.get('p2').bodyName)}).Shape.BoundBox\n` +
  `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`
);
console.log(`FreeCAD rotated prism bbox: ${JSON.stringify(fcPrismRotBbox.bbox)}`);
for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
  check(`rotated prism bbox[${i}][${j}]`, fcPrismRotBbox.bbox[i][j], occtPrismRot.bbox[i][j], 0.5);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
