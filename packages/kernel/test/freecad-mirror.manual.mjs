#!/usr/bin/env node
// Real-kernel verification for the 'mirror' FreeCadEngineAdapter branch added
// in this pass. Same "two engines, one number" bar as
// freecad-draft.manual.mjs/freecad-pattern.manual.mjs: build the SAME
// ModelDoc fixture through OcctEngineAdapter's own buildDoc() and through
// FreeCadEngineAdapter, and compare volume AND bounding box -- not volume
// alone. occt-build.ts's own 'mirror' branch comment documents a REAL,
// previously-found bug of exactly this shape: mirroring through the world
// origin instead of the target's own near face gave the right VOLUME and a
// bounding box 40 units wrong. A volume-only check would not have caught
// that, so this script never trusts volume alone.
//
// THE HEADLINE FINDING this script exists to nail down, PROBED FRESH against
// the real kernel before this branch was written (engine/bridge/
// mirror-probe.mjs), not assumed from either of PartDesign::Draft's two
// properties (whose behaviour splits unpredictably per-property on this
// fork -- NeutralPlane honours a world-frame proxy sketch, PullDirection
// rejects every explicit reference tried): PartDesign::Mirrored.MirrorPlane
// joins NeutralPlane's side of that split. It accepts a world-frame proxy
// sketch (referenced as (sketchObj, ['']), same technique as NeutralPlane)
// and genuinely honours that proxy's own WORLD position, not just its
// orientation -- verified in the probe by placing the proxy's world position
// somewhere OTHER than the target body's own local origin and confirming the
// mirror reflects through the PROXY's position, not the body's.
//
// A SECOND finding, also probed rather than assumed: PartDesign::Mirrored
// keeps BOTH the original and its reflection fused into one Shape BY
// CONSTRUCTION (it is a PartDesign::FeatureTransformedPattern, the same
// family as LinearPattern/PolarPattern, not a DressUp) -- Shape.Volume comes
// back as exactly 2x the original with no separate boolean Fuse call, unlike
// occt-build.ts's own mirror branch which needs an explicit
// BRepAlgoAPI_Fuse. This is exactly reshape's own Mirror contract
// (MirrorFeature's own doc comment in model-types.ts: the source feature
// stays visible, the mirrored copy is added alongside it) -- the two engines
// converge on the same shape by a different route.
//
// Bounding-box comparison note: a PartDesign feature object's OWN .Shape
// (session.mesh(objName)) stays BODY-LOCAL -- only the owning BODY's own
// .Shape reflects Body.Placement into WORLD coordinates (see
// freecad-engine-adapter.ts's own comment on mesh() for the measurement this
// rests on, and this adapter's own 'mirror' branch, which queries the body's
// Shape for exactly this reason when finding the near-face world
// coordinate). So this script's own bbox comparison queries the BODY's
// Shape.BoundBox directly, not the mirror feature object's own.
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 in Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" fc-kernel-pd-final
//     node --experimental-wasm-exnref
//     /repo/packages/kernel/test/freecad-mirror.manual.mjs
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
function checkBbox(label, got, want, tol = 0.5) {
  const ok = Array.isArray(got) && Array.isArray(want)
    && got.every((corner, i) => corner.every((v, j) => Math.abs(v - want[i][j]) <= tol));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  ok ? pass++ : fail++;
}
function checkTrue(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  ok ? pass++ : fail++;
}

// ---------------------------------------------------------------------------
// OCCT reference
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

// Box 40x40x20, OFF-ORIGIN (center [30,0,0], world x span [10,50]) -- an
// off-origin target is the whole point: mirroring through the world origin
// instead of the near face would give a wildly different (and wrong) bbox,
// which is exactly the bug class this script exists to catch.
const mirrorDoc = {
  version: 1,
  features: [
    { id: 'box1', kind: 'box', size: [40, 40, 20], center: [30, 0, 0] },
    { id: 'm1', kind: 'mirror', target: 'box1', plane: 'yz' },
  ],
};
const occtMirror = measureShape(oc, buildDoc(oc, mirrorDoc, arc).shapes.get('m1'));
console.log(`OCCT mirror (occt-build.ts's own mirror branch, through the near face): volume ${occtMirror.volume}, bbox ${JSON.stringify(occtMirror.bbox)}`);
// Independently-derived expectation: box world x span [10,50], near face
// (nearer to zero) is x=10. Mirroring [10,50] through x=10 gives [-30,10].
// Union of [10,50] and [-30,10] -> [-30,50]. y/z unchanged: [-20,20]/[-10,10].
check('OCCT mirror volume is exactly 2x the box (no overlap)', occtMirror.volume, 2 * 40 * 40 * 20, 1.0);
checkBbox('OCCT mirror bbox matches the independently-derived near-face-mirror span', occtMirror.bbox, [[-30, -20, -10], [50, 20, 10]]);

// ---------------------------------------------------------------------------
// FreeCAD half
// ---------------------------------------------------------------------------
const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-mirror.manual.mjs <path-to-FreeCADCmd.js>');
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

// WORLD-frame bbox helper: the mirror feature object's OWN Shape stays
// body-local (see this script's own header) -- only the owning Body's Shape
// reflects Body.Placement, same fact freecad-engine-adapter.ts's own mesh()
// and 'mirror' branch both rely on.
function worldBbox(bodyName) {
  const { bbox } = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `bb = doc.getObject(${JSON.stringify(bodyName)}).Shape.BoundBox\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`
  );
  return bbox;
}

console.log('\n--- closed box (no mirror), sanity baseline ---');
const baseDoc = { version: 1, features: [{ id: 'box1', kind: 'box', size: [40, 40, 20], center: [30, 0, 0] }] };
const fcBase = adapter.build(baseDoc);
const baseEntry = fcBase.shapes.get('box1');
check('base box volume', session.mesh(baseEntry.objName).volume, 32000, 0.5);
checkBbox('base box WORLD bbox (off-origin, center [30,0,0])', worldBbox(baseEntry.bodyName), [[10, -20, -10], [50, 20, 10]]);

console.log('\n--- mirror across yz (world X), off-origin target -- volume AND bbox vs OCCT ---');
const fcMirror = adapter.build(mirrorDoc);
if (fcMirror.refusals?.size) console.log('refusals:', [...fcMirror.refusals.entries()]);
checkTrue('mirror built (no refusal)', !fcMirror.refusals?.get('m1'));
const mirrorEntry = fcMirror.shapes.get('m1');
check('FreeCAD mirror volume vs OCCT', session.mesh(mirrorEntry.objName).volume, occtMirror.volume, 1.0);
checkBbox('FreeCAD mirror WORLD bbox vs OCCT (the exact bug class occt-build.ts\'s own comment warns about)', worldBbox(mirrorEntry.bodyName), occtMirror.bbox, 1.0);

console.log('\n--- mirror across xy (world Z) and xz (world Y) -- both axes, not just X ---');
const yzDoc = { version: 1, features: [{ id: 'box2', kind: 'box', size: [40, 40, 20], center: [0, 0, 15] }, { id: 'm2', kind: 'mirror', target: 'box2', plane: 'xy' }] };
const occtZ = measureShape(oc, buildDoc(oc, yzDoc, arc).shapes.get('m2'));
const fcZ = adapter.build(yzDoc);
checkTrue('xy-plane (world Z) mirror built (no refusal)', !fcZ.refusals?.get('m2'));
const zEntry = fcZ.shapes.get('m2');
check('FreeCAD xy-mirror volume vs OCCT', session.mesh(zEntry.objName).volume, occtZ.volume, 1.0);
checkBbox('FreeCAD xy-mirror WORLD bbox vs OCCT', worldBbox(zEntry.bodyName), occtZ.bbox, 1.0);

const xzDoc = { version: 1, features: [{ id: 'box3', kind: 'box', size: [40, 40, 20], center: [0, 25, 0] }, { id: 'm3', kind: 'mirror', target: 'box3', plane: 'xz' }] };
const occtY = measureShape(oc, buildDoc(oc, xzDoc, arc).shapes.get('m3'));
const fcY = adapter.build(xzDoc);
checkTrue('xz-plane (world Y) mirror built (no refusal)', !fcY.refusals?.get('m3'));
const yEntry = fcY.shapes.get('m3');
check('FreeCAD xz-mirror volume vs OCCT', session.mesh(yEntry.objName).volume, occtY.volume, 1.0);
checkBbox('FreeCAD xz-mirror WORLD bbox vs OCCT', worldBbox(yEntry.bodyName), occtY.bbox, 1.0);

console.log('\n--- mirror of a cylinder -- confirms the branch is not box-only ---');
const cylDoc = { version: 1, features: [{ id: 'cyl1', kind: 'cylinder', radius: 10, height: 20, center: [30, 0, 0] }, { id: 'm4', kind: 'mirror', target: 'cyl1', plane: 'yz' }] };
const occtCyl = measureShape(oc, buildDoc(oc, cylDoc, arc).shapes.get('m4'));
const fcCyl = adapter.build(cylDoc);
checkTrue('cylinder mirror built (no refusal)', !fcCyl.refusals?.get('m4'));
const cylEntry = fcCyl.shapes.get('m4');
check('FreeCAD cylinder-mirror volume vs OCCT', session.mesh(cylEntry.objName).volume, occtCyl.volume, 1.0);
checkBbox('FreeCAD cylinder-mirror WORLD bbox vs OCCT', worldBbox(cylEntry.bodyName), occtCyl.bbox, 1.0);

console.log('\n--- mirror of a target centered exactly on the mirror plane (near face at world 0) ---');
const centeredDoc = { version: 1, features: [{ id: 'box5', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] }, { id: 'm5', kind: 'mirror', target: 'box5', plane: 'yz' }] };
const occtCentered = measureShape(oc, buildDoc(oc, centeredDoc, arc).shapes.get('m5'));
const fcCentered = adapter.build(centeredDoc);
checkTrue('centered-target mirror built (no refusal)', !fcCentered.refusals?.get('m5'));
const centeredEntry = fcCentered.shapes.get('m5');
check('FreeCAD centered-mirror volume vs OCCT', session.mesh(centeredEntry.objName).volume, occtCentered.volume, 1.0);
checkBbox('FreeCAD centered-mirror WORLD bbox vs OCCT', worldBbox(centeredEntry.bodyName), occtCentered.bbox, 1.0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
