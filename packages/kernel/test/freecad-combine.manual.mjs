#!/usr/bin/env node
// Real-kernel verification for the 'combine' FreeCadEngineAdapter branch added
// in this pass. Same "two engines, one number" bar as
// freecad-mirror.manual.mjs/freecad-move.manual.mjs: build the SAME ModelDoc
// fixture through OcctEngineAdapter's own buildDoc() (occt-build.ts's own
// 'combine' branch -- BRepAlgoAPI_Fuse/Cut/Common folded pairwise) and through
// FreeCadEngineAdapter, and compare volume AND bounding box, never volume
// alone -- a wrong pairwise base (e.g. re-cutting from the ORIGINAL target
// instead of chaining off the running result) can land on the right volume
// with the wrong shape in a 3-target chain.
//
// THE HEADLINE FINDING this branch exists to close (SPEC-engine-port.md
// §6.1's stale claim that combine "needs multi-body support v1 doesn't
// have"): PartDesign::Boolean exists on this kernel but has its own
// coordinate-frame bug (places the tool at its own world position but reads
// the base body-local); Part::Fuse/Cut/Common -- document-level features
// taking two finished Body shapes directly -- read both bodies' WORLD
// placements correctly with zero coordinate work and leave both input Bodies
// untouched and reusable. See fc-commands.mjs's own partBoolean() header and
// freecad-engine-adapter.ts's own 'combine' branch for the full account.
//
// Bounding-box note, same as freecad-mirror.manual.mjs's own header: a combine
// result's bodyName === objName (a document-level Part:: object, not a real
// PartDesign::Body -- see FcBuiltFeature's own `container: 'part'` field), so
// there is no separate Body.Placement layer to unwrap here the way mirror's
// own script needs -- the Part:: object's OWN Shape.BoundBox already reflects
// world coordinates directly, since Part::Fuse/Cut/Common reads its Base/Tool
// bodies' own (already-world) Shapes.
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 in Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" -v "<repo>:/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad"
//     fc-kernel-pd-final node --experimental-wasm-exnref
//     /repo/packages/kernel/test/freecad-combine.manual.mjs
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

function occtCombine(doc, resultId) {
  return measureShape(oc, buildDoc(oc, doc, arc).shapes.get(resultId));
}

// Base fixture, per the design's own measurement: box A 40x40x20 center
// [0,0,0], box B 40x40x20 center [20,0,0] -- overlapping by a 20x40x20 slab
// (x in [0,20]).
const boxA = { id: 'a', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] };
const boxB = { id: 'b', kind: 'box', size: [40, 40, 20], center: [20, 0, 0] };

// ---------------------------------------------------------------------------
// FreeCAD half
// ---------------------------------------------------------------------------
const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-combine.manual.mjs <path-to-FreeCADCmd.js>');
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

// A combine result's bodyName IS a real document object name (a Part::Fuse/
// Cut/Common, not a Body) -- session.mesh(objName) already returns its own
// Shape.Volume directly, no Body.Placement indirection needed (see this
// script's own header). session.mesh() does NOT return a bbox (fc-session.mjs's
// own mesh() emitter only ever computes positions/indices/volume), so bbox is
// read separately, straight off the SAME object -- same "query the object
// whose Shape is already world-frame" reasoning, just a second Python round
// trip rather than a second field on mesh()'s own payload.
function meshOf(entry) {
  return session.mesh(entry.objName);
}
function worldBbox(objName) {
  const { bbox } = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `bb = doc.getObject(${JSON.stringify(objName)}).Shape.BoundBox\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`
  );
  return bbox;
}

console.log('\n--- 2-target union ---');
{
  const doc = { version: 1, features: [boxA, boxB, { id: 'c1', kind: 'combine', op: 'union', targets: ['a', 'b'] }] };
  const occt = occtCombine(doc, 'c1');
  const fc = adapter.build(doc);
  checkTrue('union built (no refusal)', !fc.refusals?.get('c1'));
  const entry = fc.shapes.get('c1');
  checkTrue('container is "part" (document-level, not a Body)', entry.container === 'part');
  const m = meshOf(entry);
  check('union volume vs OCCT', m.volume, occt.volume, 1.0);
  check('union volume (expected 48000: two 32000 boxes overlapping in a 16000 slab)', m.volume, 48000, 1.0);
  const bboxU = worldBbox(entry.objName);
  checkBbox('union bbox vs OCCT', bboxU, occt.bbox, 1.0);
  checkBbox('union bbox (expected span)', bboxU, [[-20, -20, -10], [40, 20, 10]], 1.0);
}

console.log('\n--- 2-target subtract (a - b) ---');
{
  const doc = { version: 1, features: [boxA, boxB, { id: 'c2', kind: 'combine', op: 'subtract', targets: ['a', 'b'] }] };
  const occt = occtCombine(doc, 'c2');
  const fc = adapter.build(doc);
  checkTrue('subtract built (no refusal)', !fc.refusals?.get('c2'));
  const m = meshOf(fc.shapes.get('c2'));
  check('subtract volume vs OCCT', m.volume, occt.volume, 1.0);
  check('subtract volume (expected 16000: 32000 minus the 16000 overlap)', m.volume, 16000, 1.0);
}

console.log('\n--- 2-target intersect (a ^ b) ---');
{
  const doc = { version: 1, features: [boxA, boxB, { id: 'c3', kind: 'combine', op: 'intersect', targets: ['a', 'b'] }] };
  const occt = occtCombine(doc, 'c3');
  const fc = adapter.build(doc);
  checkTrue('intersect built (no refusal)', !fc.refusals?.get('c3'));
  const m = meshOf(fc.shapes.get('c3'));
  check('intersect volume vs OCCT', m.volume, occt.volume, 1.0);
  check('intersect volume (expected 16000: the overlap slab itself)', m.volume, 16000, 1.0);
}

console.log('\n--- 3-target subtract (a - b - c), chained off the RUNNING result ---');
{
  // A = box 40x40x20 center [-10,0,0], extent x:[-30,10]. B and C are two
  // 20x20x20 cubes fully inside A, together spanning A's full y range at
  // x:[-20,0] (B: y in [-20,0], C: y in [0,20]) -- so B union C removes the
  // ENTIRE x:[-20,0] slab across all y/z, leaving two disconnected slabs
  // (x:[-30,-20] and x:[0,10]) whose UNION bbox is A's own full span. This
  // exercises the pairwise fold genuinely (each of B, C removes real, disjoint
  // volume) while keeping the arithmetic hand-checkable: 32000 - 8000 - 8000
  // = 16000, and neither cut touches A's own x/y/z extremes, so the bbox
  // survives unchanged.
  const A = { id: 'a3', kind: 'box', size: [40, 40, 20], center: [-10, 0, 0] };
  const B = { id: 'b3', kind: 'box', size: [20, 20, 20], center: [-10, -10, 0] };
  const C = { id: 'c3t', kind: 'box', size: [20, 20, 20], center: [-10, 10, 0] };
  const doc = { version: 1, features: [A, B, C, { id: 'sub3', kind: 'combine', op: 'subtract', targets: ['a3', 'b3', 'c3t'] }] };
  const occt = occtCombine(doc, 'sub3');
  const fc = adapter.build(doc);
  checkTrue('3-target subtract built (no refusal)', !fc.refusals?.get('sub3'));
  const sub3Entry = fc.shapes.get('sub3');
  const m = meshOf(sub3Entry);
  check('3-target subtract volume vs OCCT', m.volume, occt.volume, 1.0);
  check('3-target subtract volume (expected 16000)', m.volume, 16000, 1.0);
  const bboxSub3 = worldBbox(sub3Entry.objName);
  checkBbox('3-target subtract bbox vs OCCT', bboxSub3, occt.bbox, 1.0);
  checkBbox('3-target subtract bbox (expected: two disjoint slabs spanning A\'s own bbox)', bboxSub3, [[-30, -20, -10], [10, 20, 10]], 1.0);
}

console.log('\n--- 3-target union, face-to-face chain ---');
{
  // Three 20x20x20 boxes, centers at x=0/20/40, touching faces (zero-volume
  // overlap) -- three separate additive chains meeting in one combine, the
  // exact "join two independent chains" case combine exists for.
  const X = { id: 'x1', kind: 'box', size: [20, 20, 20], center: [0, 0, 0] };
  const Y = { id: 'y1', kind: 'box', size: [20, 20, 20], center: [20, 0, 0] };
  const Z = { id: 'z1', kind: 'box', size: [20, 20, 20], center: [40, 0, 0] };
  const doc = { version: 1, features: [X, Y, Z, { id: 'uni3', kind: 'combine', op: 'union', targets: ['x1', 'y1', 'z1'] }] };
  const occt = occtCombine(doc, 'uni3');
  const fc = adapter.build(doc);
  checkTrue('3-target union built (no refusal)', !fc.refusals?.get('uni3'));
  const uni3Entry = fc.shapes.get('uni3');
  const m = meshOf(uni3Entry);
  check('3-target union volume vs OCCT', m.volume, occt.volume, 1.0);
  check('3-target union volume (expected 24000: three 8000 boxes, no overlap)', m.volume, 24000, 1.0);
  const bboxUni3 = worldBbox(uni3Entry.objName);
  checkBbox('3-target union bbox vs OCCT', bboxUni3, occt.bbox, 1.0);
  checkBbox('3-target union bbox (expected: the full face-to-face chain span)', bboxUni3, [[-10, -10, -10], [50, 10, 10]], 1.0);
}

console.log('\n--- disjoint intersect (no overlap) refuses cleanly, rest of the model still builds ---');
{
  const far = { id: 'far', kind: 'box', size: [40, 40, 20], center: [1000, 0, 0] };
  const doc = {
    version: 1,
    features: [
      boxA, far,
      { id: 'cdisjoint', kind: 'combine', op: 'intersect', targets: ['a', 'far'] },
      { id: 'sanity', kind: 'box', size: [10, 10, 10], center: [0, 0, 100] },
    ],
  };
  const fc = adapter.build(doc);
  checkTrue('disjoint intersect refuses (not a thrown exception)', !!fc.refusals?.get('cdisjoint'));
  checkTrue('refused entry falls back to the first live target', fc.shapes.get('cdisjoint') === fc.shapes.get('a'));
  checkTrue('rest of the model still built alongside the refusal', !!fc.shapes.get('sanity'));
}

console.log('\n--- fewer than 2 live targets refuses cleanly ---');
{
  const doc = { version: 1, features: [boxA, { id: 'conetarget', kind: 'combine', op: 'union', targets: ['a'] }] };
  const fc = adapter.build(doc);
  checkTrue('single-target combine refuses (not a thrown exception)', !!fc.refusals?.get('conetarget'));
  checkTrue('refused entry falls back to the one live target', fc.shapes.get('conetarget') === fc.shapes.get('a'));
}

console.log('\n--- fillet attempted on a combine result: notInABody refusal fires, not a kernel exception ---');
{
  const doc = {
    version: 1,
    features: [
      boxA, boxB,
      { id: 'cf', kind: 'combine', op: 'union', targets: ['a', 'b'] },
      { id: 'r1', kind: 'fillet', target: 'cf', edge: { cause: 'between', feature: 'cf', kind: 'edge', of: [{ cause: 'primitive', feature: 'cf', kind: 'face', part: '+x' }, { cause: 'primitive', feature: 'cf', kind: 'face', part: '+z' }] }, size: 3, style: 'fillet' },
    ],
  };
  const fc = adapter.build(doc);
  const why = fc.refusals?.get('r1');
  checkTrue('fillet on a combine result refuses (notInABody), not a kernel AttributeError', !!why);
  checkTrue('refusal names the real reason', !!why && why.includes('PartDesign'));
}

console.log('\n--- a combine\'s OWN inputs still name correctly after combining ---');
{
  // A face named on target `a` BEFORE combining must resolve the same way
  // AFTER `a` is folded into a combine -- a Part:: boolean never reads or
  // writes its input Bodies' own objects (see freecad-engine-adapter.ts's
  // own 'combine' branch header).
  const doc = { version: 1, features: [boxA, boxB, { id: 'cn', kind: 'combine', op: 'union', targets: ['a', 'b'] }] };
  const fc = adapter.build(doc);
  const aEntry = fc.shapes.get('a');
  const faceName = adapter.resolveFace(
    { cause: 'primitive', feature: 'a', kind: 'face', part: '+z' },
    { shapes: fc.shapes },
  );
  checkTrue('a face on combine input `a` still resolves after `a` was folded into a combine', !!faceName && faceName.objName === aEntry.objName);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
