#!/usr/bin/env node
// Real-kernel verification for the 'draft' FreeCadEngineAdapter branch added
// in this pass. Same "two engines, one number" bar as
// freecad-shell.manual.mjs/freecad-pattern.manual.mjs: build the SAME
// ModelDoc fixture through OcctEngineAdapter's own buildDoc() and through
// FreeCadEngineAdapter, and compare volumes -- PLUS an independently
// hand-derived frustum volume (not a guessed literal), since a draft is
// simple enough geometry to close-form.
//
// SCOPE this port actually ships, per freecad-engine-adapter.ts's own
// header/branch comments -- measured directly against this kernel
// (engine/bridge/draft-probe*.mjs, real-kernel scripts, not assumed):
//   - only a single named FACE (not `whole: true` Body Draft)
//   - only `pull: 'z'`, only on an UNROTATED target body -- PullDirection
//     cannot be set to any explicit reference on this kernel build (every
//     form tried failed identically), so a non-'z' pull or a rotated body
//     both refuse rather than silently build a wrong-frame draft.
//   - Angle is NEGATED internally (fc-commands.mjs's own draft()) to match
//     ModelDoc's own sign convention -- this script's fixture computation
//     already accounts for that; the ADAPTER's own `angle` field keeps
//     DraftFeature's documented meaning (positive = outward as you move in
//     +pull direction away from neutral).
//
// USAGE (PowerShell/Docker, MSYS_NO_PATHCONV=1 in Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" fc-kernel-pd-final
//     node --experimental-wasm-exnref
//     /repo/packages/kernel/test/freecad-draft.manual.mjs
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

const plusXFace = { cause: 'primitive', feature: 'box1', kind: 'face', part: '+x' };

// Box 40x40x20 centered at the world origin (world z spans [-10,10]), +X
// face drafted 10 degrees, pull='z', neutral at world z=-10 (the box's own
// bottom). Independently-derived frustum volume: the box's cross-section at
// world height z is a 40-wide (unchanged -X wall to the tapered +X wall) by
// 40-deep rectangle. MEASURED (not assumed from DraftFeature's own doc
// comment -- see fc-commands.mjs's draft() header for the negation this pass
// tried and found WRONG by exactly this cross-engine check): a POSITIVE
// f.angle SHRINKS the solid as z increases away from neutral, i.e.
// width(z) = 40 - tan(angle)*(z-(-10)) for z in [-10,10]. Volume =
// 40(depth) * integral_{-10}^{10} [40 - tan(10deg)*(z+10)] dz
//   = 40 * [40*20 - tan(10deg)*((z+10)^2/2)|_{-10}^{10}]
//   = 40 * [800 - tan(10deg)*200]
//   = 32000 - 8000*tan(10deg)
const angleDeg = 10;
const tanA = Math.tan((angleDeg * Math.PI) / 180);
const expectedFrustumVolume = 32000 - 8000 * tanA;
console.log(`Independently-derived frustum volume (angle=${angleDeg}deg, neutral=box bottom): ${expectedFrustumVolume.toFixed(4)}`);

const draftDoc = {
  version: 1,
  features: [
    { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'd1', kind: 'draft', target: 'box1', face: plusXFace, angle: angleDeg, pull: 'z', neutral: -10 },
  ],
};
const occtDraft = measureShape(oc, buildDoc(oc, draftDoc, arc).shapes.get('d1'));
console.log(`OCCT draft (occt-build.ts's own drafted(), same BRepOffsetAPI_DraftAngle algorithm): volume ${occtDraft.volume}`);
check('OCCT draft volume matches the independently-derived frustum formula', occtDraft.volume, expectedFrustumVolume, 1.0);

// ---------------------------------------------------------------------------
// FreeCAD half
// ---------------------------------------------------------------------------
const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-draft.manual.mjs <path-to-FreeCADCmd.js>');
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

console.log('\n--- closed box (no draft), sanity baseline ---');
const baseDoc = { version: 1, features: [{ id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] }] };
const fcBase = adapter.build(baseDoc);
const baseEntry = fcBase.shapes.get('box1');
check('base box volume', session.mesh(baseEntry.objName).volume, 32000, 0.5);

console.log('\n--- draft with a resolvable face, pull=z, unrotated body ---');
const fcDraft = adapter.build(draftDoc);
if (fcDraft.refusals?.size) console.log('refusals:', [...fcDraft.refusals.entries()]);
checkTrue('draft with a resolvable face built (no refusal)', !fcDraft.refusals?.get('d1'));
const draftEntry = fcDraft.shapes.get('d1');
check('FreeCAD draft volume vs OCCT (box 40x40x20, +X face, angle=10, neutral=box bottom)', session.mesh(draftEntry.objName).volume, occtDraft.volume, 1.0);
check('FreeCAD draft volume vs the independently-derived frustum formula', session.mesh(draftEntry.objName).volume, expectedFrustumVolume, 1.0);

console.log('\n--- negative angle inverts the taper (grows instead of shrinks) ---');
// A negative angle mirrors the positive case: width(z) = 40 + tan(10deg)*(z+10),
// same integral with the sign flipped -> 32000 + 8000*tan(10deg).
const expectedNegVolume = 32000 + 8000 * tanA;
const fcNeg = adapter.build({ version: 1, features: [{ id: 'box2', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] }, { id: 'd2', kind: 'draft', target: 'box2', face: { cause: 'primitive', feature: 'box2', kind: 'face', part: '+x' }, angle: -angleDeg, pull: 'z', neutral: -10 }] });
checkTrue('negative-angle draft built (no refusal)', !fcNeg.refusals?.get('d2'));
const negEntry = fcNeg.shapes.get('d2');
check('FreeCAD negative-angle draft volume matches the mirrored frustum formula', session.mesh(negEntry.objName).volume, expectedNegVolume, 1.0);

console.log('\n--- `whole: true` (Body Draft) refuses cleanly ---');
const wholeDoc = {
  version: 1,
  features: [
    { id: 'box3', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'd3', kind: 'draft', target: 'box3', whole: true, angle: 10, pull: 'z', neutral: 0 },
  ],
};
const fcWhole = adapter.build(wholeDoc);
checkTrue('whole:true refuses rather than throwing or silently misbuilding', !!fcWhole.refusals?.get('d3'), fcWhole.refusals?.get('d3'));
checkTrue('the refused whole-draft falls back to its target\'s own shape', fcWhole.shapes.get('d3') === fcWhole.shapes.get('box3'));

console.log('\n--- a pull other than \'z\' refuses cleanly ---');
const pullXDoc = {
  version: 1,
  features: [
    { id: 'box4', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'd4', kind: 'draft', target: 'box4', face: { cause: 'primitive', feature: 'box4', kind: 'face', part: '+z' }, angle: 10, pull: 'x', neutral: 0 },
  ],
};
const fcPullX = adapter.build(pullXDoc);
checkTrue('pull=x refuses -- PullDirection cannot be set to a custom reference on this kernel', !!fcPullX.refusals?.get('d4'), fcPullX.refusals?.get('d4'));

console.log('\n--- a rotated target body refuses cleanly ---');
const rotDoc = {
  version: 1,
  features: [
    { id: 'box5', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], rotate: [0, 0, 45] },
    { id: 'd5', kind: 'draft', target: 'box5', face: plusXFace, angle: 10, pull: 'z', neutral: 0 },
  ],
};
const fcRot = adapter.build(rotDoc);
checkTrue('a rotated body refuses -- the implicit pull direction would follow the tilt', !!fcRot.refusals?.get('d5'), fcRot.refusals?.get('d5'));

console.log('\n--- an unresolvable face refuses cleanly ---');
const badFaceDoc = {
  version: 1,
  features: [
    { id: 'box6', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'd6', kind: 'draft', target: 'box6', face: { cause: 'primitive', feature: 'box6', kind: 'face', part: 'not-a-real-part' }, angle: 10, pull: 'z', neutral: 0 },
  ],
};
const fcBadFace = adapter.build(badFaceDoc);
checkTrue('an unresolvable face refuses rather than throwing', !!fcBadFace.refusals?.get('d6'), fcBadFace.refusals?.get('d6'));

console.log('\n--- draft of a cylinder\'s side face -- confirms the branch is not box-only ---');
const cylDoc = {
  version: 1,
  features: [
    { id: 'cyl1', kind: 'cylinder', radius: 10, height: 20, center: [0, 0, 0] },
    { id: 'd7', kind: 'draft', target: 'cyl1', face: { cause: 'primitive', feature: 'cyl1', kind: 'face', part: 'side' }, angle: 5, pull: 'z', neutral: -10 },
  ],
};
const occtCyl = measureShape(oc, buildDoc(oc, cylDoc, arc).shapes.get('d7'));
const fcCyl = adapter.build(cylDoc);
if (fcCyl.refusals?.size) console.log('refusals:', [...fcCyl.refusals.entries()]);
checkTrue('cylinder side-face draft built (no refusal)', !fcCyl.refusals?.get('d7'));
const cylEntry = fcCyl.shapes.get('d7');
check('FreeCAD cylinder-draft volume vs OCCT', session.mesh(cylEntry.objName).volume, occtCyl.volume, 1.0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
