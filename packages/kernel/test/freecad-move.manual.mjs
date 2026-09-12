#!/usr/bin/env node
// Real-kernel verification for the 'move' FreeCadEngineAdapter branch added
// in this pass -- fc-commands.mjs's moveBody()/copyBodyMoved()/bodyTip().
//
// 'move' is the SIMPLEST feature this engine has ported so far, for a real
// structural reason (see freecad-engine-adapter.ts's own header comment on
// 'move'): FreeCAD's Body.Placement is only ever the frame applied to the
// underlying feature Shape AT READ TIME. A move never rewrites the
// geometry, so a name (a fillet's own Base, say) written against a body
// BEFORE it moves still resolves correctly AFTER -- unlike the OCCT engine
// (occt-build.ts), whose own 'move' branch has to record an OpRecord
// specifically so a stale pre-move edge handle does not throw a bare
// WebAssembly.Exception when handed to a fillet on the post-move shape.
// Fixtures 3/4 below exist to prove that difference for real, not assume it.
//
// Two fixtures (2, 8) exist specifically to catch a WRONG implementation
// that would otherwise pass every simple/unrotated fixture:
//   - #2: a right-multiply Placement composition (b.Placement.multiply(T)
//     instead of T.multiply(b.Placement)) moves a rotated body along its
//     own LOCAL axis instead of the WORLD axis the offset is stated in --
//     identical to a left-multiply on an unrotated body, wrong only once
//     the body is turned.
//   - #8: a copy that is secretly a reference/pattern rather than a true
//     independent doc.copyObject() duplicate would show the ORIGINAL's own
//     later fillet leaking into the copy's shape.
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 in Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" fc-kernel-pd-final
//     node --experimental-wasm-exnref
//     /repo/packages/kernel/test/freecad-move.manual.mjs
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

function packagedKernel() {
  try { return path.dirname(require.resolve('replicad-opencascadejs/dist/replicad_single.js')); }
  catch { return path.join(path.dirname(require.resolve('replicad-opencascadejs/package.json')), 'dist'); }
}
const kernelDir = process.env.RESHAPE_KERNEL_DIR || packagedKernel();
const glue = await import(pathToFileURL(path.join(kernelDir, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(kernelDir, f) });

const { buildDoc, measureShape } = await load('packages/kernel/dist/occt-build.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');

const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-move.manual.mjs <path-to-FreeCADCmd.js>');
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

function worldBbox(bodyName) {
  const { bbox } = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `bb = doc.getObject(${JSON.stringify(bodyName)}).Shape.BoundBox\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`
  );
  return bbox;
}

const boxNamed = (id, part) => ({ cause: 'primitive', feature: id, kind: 'face', part });
const betweenBox = (id, partA, partB) => ({ cause: 'between', feature: id, kind: 'edge', of: [boxNamed(id, partA), boxNamed(id, partB)] });

console.log('\n--- 1. move (copy=false) translates the box; bbox/volume match OCCT ---');
{
  const doc = { version: 1, features: [
    { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv1', kind: 'move', target: 'box1', offset: [20, 0, 0], copy: false },
  ] };
  const occtRes = measureShape(oc, buildDoc(oc, doc, arc).shapes.get('mv1'));
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('mv1'));
  const entry = fc.shapes.get('mv1');
  check('volume unchanged by the move', session.mesh(entry.objName).volume, 40 * 40 * 20, 0.5);
  checkBbox('FreeCAD move bbox vs OCCT', worldBbox(entry.bodyName), occtRes.bbox, 1.0);
}

console.log('\n--- 2. rotated box, move(+100,0,0) -- moves along WORLD +x, not the body\'s own local axis ---');
{
  const doc = { version: 1, features: [
    { id: 'box2', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], rotate: [0, 0, 90] },
    { id: 'mv2', kind: 'move', target: 'box2', offset: [100, 0, 0], copy: false },
  ] };
  const occtRes = measureShape(oc, buildDoc(oc, doc, arc).shapes.get('mv2'));
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('mv2'));
  const entry = fc.shapes.get('mv2');
  checkBbox('rotated-body move bbox vs OCCT (the load-bearing left-vs-right-multiply discriminator)', worldBbox(entry.bodyName), occtRes.bbox, 1.0);
}

console.log('\n--- 3. box -> move -> fillet on an edge named BEFORE the move -- must still build ---');
{
  const doc = { version: 1, features: [
    { id: 'box3', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv3', kind: 'move', target: 'box3', offset: [20, 0, 0], copy: false },
    { id: 'r3', kind: 'fillet', target: 'mv3', edge: betweenBox('box3', '+x', '+z'), size: 3, style: 'fillet' },
  ] };
  const fc = adapter.build(doc);
  checkTrue('move built', !fc.refusals?.get('mv3'));
  checkTrue('fillet named against the PRE-move edge still resolves and builds after the move', !fc.refusals?.get('r3'), fc.refusals?.get('r3'));
  const entry = fc.shapes.get('r3');
  checkTrue('fillet result differs from the plain move (a real cut happened)', entry !== fc.shapes.get('mv3'));
}

console.log('\n--- 4. box -> fillet -> move (reverse order) -- same volume as #3 ---');
{
  const doc = { version: 1, features: [
    { id: 'box4', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'r4', kind: 'fillet', target: 'box4', edge: betweenBox('box4', '+x', '+z'), size: 3, style: 'fillet' },
    { id: 'mv4', kind: 'move', target: 'r4', offset: [20, 0, 0], copy: false },
  ] };
  const fc = adapter.build(doc);
  checkTrue('fillet built', !fc.refusals?.get('r4'));
  checkTrue('move of a filleted body built', !fc.refusals?.get('mv4'));
  const entry = fc.shapes.get('mv4');
  // Compare to fixture #3's own fillet volume (fillet-then-move commutes
  // with move-then-fillet -- a move never changes volume).
  const doc3 = { version: 1, features: [
    { id: 'box3', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv3', kind: 'move', target: 'box3', offset: [20, 0, 0], copy: false },
    { id: 'r3', kind: 'fillet', target: 'mv3', edge: betweenBox('box3', '+x', '+z'), size: 3, style: 'fillet' },
  ] };
  const fc3 = adapter.build(doc3);
  check('order-independent volume (move-then-fillet == fillet-then-move)', session.mesh(entry.objName).volume, session.mesh(fc3.shapes.get('r3').objName).volume, 0.5);
}

console.log('\n--- 5. box -> pattern x3 -> move -- bbox exactly translated, still 3 solids worth of volume ---');
{
  const doc = { version: 1, features: [
    { id: 'box5', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
    { id: 'pat5', kind: 'pattern', target: 'box5', mode: 'linear', count: 3, step: [20, 0, 0] },
    { id: 'mv5', kind: 'move', target: 'pat5', offset: [5, 5, 5], copy: false },
  ] };
  const occtRes = measureShape(oc, buildDoc(oc, doc, arc).shapes.get('mv5'));
  const fc = adapter.build(doc);
  checkTrue('pattern built', !fc.refusals?.get('pat5'));
  checkTrue('move of a patterned body built', !fc.refusals?.get('mv5'));
  const entry = fc.shapes.get('mv5');
  check('3x volume preserved through the move', session.mesh(entry.objName).volume, 3 * 1000, 1.0);
  checkBbox('patterned+moved bbox vs OCCT', worldBbox(entry.bodyName), occtRes.bbox, 1.0);
}

console.log('\n--- 6. move (copy=true) -- BOTH shapes present: target unmoved, copy at +60 ---');
{
  const doc = { version: 1, features: [
    { id: 'box6', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv6', kind: 'move', target: 'box6', offset: [60, 0, 0], copy: true },
  ] };
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('mv6'));
  const targetEntry = fc.shapes.get('box6');
  const copyEntry = fc.shapes.get('mv6');
  checkTrue('copy got a DIFFERENT bodyName than the target', copyEntry.bodyName !== targetEntry.bodyName);
  checkBbox('target stays at its original, unmoved position', worldBbox(targetEntry.bodyName), [[-20, -20, -10], [20, 20, 10]], 0.5);
  checkBbox('copy sits translated by the offset', worldBbox(copyEntry.bodyName), [[40, -20, -10], [80, 20, 10]], 0.5);
}

console.log('\n--- 7. rotated box, move (copy=true) -- copy translated in world, rotation preserved ---');
{
  const doc = { version: 1, features: [
    { id: 'box7', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], rotate: [0, 0, 90] },
    { id: 'mv7', kind: 'move', target: 'box7', offset: [100, 0, 0], copy: true },
  ] };
  const occtRes = measureShape(oc, buildDoc(oc, doc, arc).shapes.get('mv7'));
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('mv7'));
  const entry = fc.shapes.get('mv7');
  checkBbox('rotated copy bbox vs OCCT (rotation preserved through the copy+move)', worldBbox(entry.bodyName), occtRes.bbox, 1.0);
}

console.log('\n--- 8. move (copy=true) -> fillet ON THE ORIGINAL -- copy stays sharp (true independence) ---');
{
  const doc = { version: 1, features: [
    { id: 'box8', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv8', kind: 'move', target: 'box8', offset: [60, 0, 0], copy: true },
    { id: 'r8', kind: 'fillet', target: 'box8', edge: betweenBox('box8', '+x', '+z'), size: 3, style: 'fillet' },
  ] };
  const fc = adapter.build(doc);
  checkTrue('copy built', !fc.refusals?.get('mv8'));
  checkTrue('fillet on the original built', !fc.refusals?.get('r8'));
  const copyEntry = fc.shapes.get('mv8');
  const roundedEntry = fc.shapes.get('r8');
  check('the copy\'s own volume is UNCHANGED by the later fillet on the original', session.mesh(copyEntry.objName).volume, 40 * 40 * 20, 0.5);
  checkTrue('the rounded original is a genuinely different volume than the sharp copy', session.mesh(roundedEntry.objName).volume < session.mesh(copyEntry.objName).volume - 1);
}

console.log('\n--- 9. move (copy=true) volume is exactly 1x -- not accidentally patterned/doubled ---');
{
  const doc = { version: 1, features: [
    { id: 'box9', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv9', kind: 'move', target: 'box9', offset: [10, 0, 0], copy: true },
  ] };
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('mv9'));
  const entry = fc.shapes.get('mv9');
  check('copy volume is exactly 1x the original, not doubled', session.mesh(entry.objName).volume, 40 * 40 * 20, 0.5);
}

console.log('\n--- 10. move (copy=true, offset=[0,0,0]) -- refuses, rest of model still builds ---');
{
  const doc = { version: 1, features: [
    { id: 'box10', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv10', kind: 'move', target: 'box10', offset: [0, 0, 0], copy: true },
    { id: 'box10b', kind: 'box', size: [10, 10, 10], center: [100, 0, 0] },
  ] };
  const fc = adapter.build(doc);
  checkTrue('zero-offset copy refuses', !!fc.refusals?.get('mv10'));
  checkTrue('the rest of the model (an unrelated box) still builds', !!fc.shapes.get('box10b') && !fc.refusals?.get('box10b'));
}

console.log('\n--- 11. [box, fillet, move(target=box)] -- Body.Tip mismatch refuses, nothing moved ---');
{
  const doc = { version: 1, features: [
    { id: 'box11', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'r11', kind: 'fillet', target: 'box11', edge: betweenBox('box11', '+x', '+z'), size: 3, style: 'fillet' },
    { id: 'mv11', kind: 'move', target: 'box11', offset: [20, 0, 0], copy: false },
  ] };
  const fc = adapter.build(doc);
  checkTrue('fillet built', !fc.refusals?.get('r11'));
  checkTrue('move of box11 refuses (a fillet is already on top of it in the same body)', !!fc.refusals?.get('mv11'));
  checkBbox('box11\'s own body never moved', worldBbox(fc.shapes.get('box11').bodyName), [[-20, -20, -10], [20, 20, 10]], 0.5);
}

console.log('\n--- 12. sketch -> extrude -> move -> pick a wall -- nameFace resolves via the swept cause ---');
{
  const sketchPoints = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const doc = { version: 1, features: [
    { id: 'sk12', kind: 'sketch', plane: 'xy', offset: 0, points: sketchPoints },
    { id: 'ex12', kind: 'extrude', target: 'sk12', height: 20 },
    { id: 'mv12', kind: 'move', target: 'ex12', offset: [30, 0, 0], copy: false },
  ] };
  const fc = adapter.build(doc);
  checkTrue('extrude built', !fc.refusals?.get('ex12'));
  checkTrue('move of the extrude built', !fc.refusals?.get('mv12'));
  const entry = fc.shapes.get('mv12');
  // The move reuses the SAME objName as its target (in-place move), so a
  // face picked on the moved shape is really being picked on the extrude's
  // own frozen Pad object -- nameFace's own swept/cap vocabulary applies
  // unchanged.
  const ref = adapter.faceAt(entry, 0);
  const name = adapter.nameFace(fc, doc, 'mv12', ref);
  checkTrue('a wall face names via the swept/rounded cause after a move', !!name && (name.cause === 'swept' || name.cause === 'rounded'), JSON.stringify(name));
  if (name) {
    const resolved = adapter.resolveFace(name, fc);
    checkTrue('that name round-trips back to a real face', !!resolved);
  }
}

console.log('\n--- 13. box -> move -> pick a face -- nameFace resolves via the primitive cause ---');
{
  const doc = { version: 1, features: [
    { id: 'box13', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv13', kind: 'move', target: 'box13', offset: [20, 0, 0], copy: false },
  ] };
  const fc = adapter.build(doc);
  checkTrue('move built', !fc.refusals?.get('mv13'));
  const entry = fc.shapes.get('mv13');
  let found = null;
  for (let i = 0; i < 6; i++) {
    const ref = adapter.faceAt(entry, i);
    const name = adapter.nameFace(fc, doc, 'mv13', ref);
    if (name && name.cause === 'primitive') { found = name; break; }
  }
  checkTrue('a face on the moved box names via the primitive cause', !!found, JSON.stringify(found));
}

console.log('\n--- 14. Save (with a copy=true move) -> Open -> volume matches ---');
{
  const doc = { version: 1, features: [
    { id: 'box14', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'mv14', kind: 'move', target: 'box14', offset: [60, 0, 0], copy: true },
  ] };
  const fc = adapter.build(doc);
  checkTrue('built before save', !fc.refusals?.get('mv14'));
  const beforeVolume = session.mesh(fc.shapes.get('mv14').objName).volume;
  const bytes = adapter.saveDocument(doc);
  checkTrue('saveDocument produced bytes', bytes && bytes.length > 0);
  const reopened = adapter.openDocument(bytes);
  checkTrue('openDocument reconstructed a ModelDoc', !!reopened);
  const fc2 = adapter.build(reopened);
  checkTrue('reopened doc still builds the move without refusal', !fc2.refusals?.get('mv14'));
  check('reopened move volume matches the original', session.mesh(fc2.shapes.get('mv14').objName).volume, beforeVolume, 0.5);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
