#!/usr/bin/env node
// Probe: verify fc-commands.mjs's new moveBody()/copyBodyMoved()/bodyTip()
// emitters (added for FreeCadEngineAdapter's 'move' branch) against the real
// kernel, before trusting the manual cross-engine test suite
// (packages/kernel/test/freecad-move.manual.mjs) built on top of them.
//
// Three load-bearing claims checked here, each one a place a wrong
// implementation could pass every UNROTATED/simple fixture and only break
// on the case that actually matters:
//
//   1. LEFT-multiply, not right. offset is a WORLD translation, so
//      moveBody() must compose it as
//      App.Placement(offset, App.Rotation()).multiply(b.Placement) --
//      NOT b.Placement.multiply(...). On an unrotated body the two are
//      identical; only a body placed at some rotation shows the difference.
//      Fixture: box rotated rz=90, moveBody(+100,0,0) -- world +x is the
//      LOCAL -y direction once rotated 90 about Z, so a right-multiply bug
//      would move the box along world +y instead of +x.
//
//   2. Named survival across an in-place move (copy=false). A fillet named
//      BEFORE the move must still resolve and build AFTER it, because
//      Body.Placement is only ever the frame applied at Shape-read time --
//      moving never rewrites the underlying feature geometry. This is the
//      entire reason this feature is simpler on FreeCAD than on OCCT (see
//      freecad-engine-adapter.ts's own header comment on 'move').
//
//   3. True independence of a copy=true duplicate. Fillet the ORIGINAL
//      after copying it: the copy's own Shape must stay unrounded. If
//      copyBodyMoved() were secretly sharing geometry (a wrong doc.copyObject
//      call, or a pattern-like reference instead of a real duplicate), this
//      is the fixture that would catch it -- volume/bbox checks alone would
//      not.
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 if Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" fc-kernel-pd-final
//     node --experimental-wasm-exnref /repo/engine/bridge/move-probe.mjs
//     /work/build/bin/FreeCADCmd.js

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node move-probe.mjs <path-to-FreeCADCmd.js>');
  process.exit(1);
}

globalThis.resolveGlobalSymbol = globalThis.resolveGlobalSymbol
  || function resolveGlobalSymbolStub() { return { sym: undefined }; };

const { loadNodeKernel } = await load('packages/engine/src/fc-session-node.mjs');
const { createFcSession } = await load('packages/engine/src/fc-session.mjs');
const { attachCommands } = await load('packages/engine/src/fc-commands.mjs');
const { attachSketchCommands } = await load('packages/engine/src/fc-sketch.mjs');

const Module = await loadNodeKernel(fcKernelJs);
const session = attachSketchCommands(attachCommands(createFcSession(Module)));

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  ok ? pass++ : fail++;
}
function worldBbox(bodyName) {
  const { bbox } = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `bb = doc.getObject(${JSON.stringify(bodyName)}).Shape.BoundBox\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`
  );
  return bbox;
}

session.newDocument('probe');

console.log('\n--- 1. rotated-body left-vs-right-multiply discriminator ---');
{
  const bodyName = 'Body1';
  session.newBody(bodyName);
  const sketchName = 'box1_sk';
  session.sketchNew(bodyName, sketchName);
  session.sketchAddRectangle(sketchName, -20, -20, 20, 20);
  const padName = 'box1_pad';
  session.pad(bodyName, sketchName, padName, 20);
  // rz=90, centered at world origin (z-shift -10, same convention as
  // freecad-engine-adapter.ts's setBodyPlacement).
  session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `body = doc.getObject(${JSON.stringify(bodyName)})\n` +
    `body.Placement = App.Placement(App.Vector(0,0,-10), App.Rotation(App.Vector(0,0,1), 90))\n` +
    `doc.recompute()\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'ok': True}))\n`
  );
  const before = worldBbox(bodyName);
  console.log('before move, world bbox:', JSON.stringify(before));
  session.moveBody(bodyName, [100, 0, 0]);
  const after = worldBbox(bodyName);
  console.log('after moveBody(+100,0,0), world bbox:', JSON.stringify(after));
  const dx = after[0][0] - before[0][0];
  const dy = after[0][1] - before[0][1];
  check(
    'moveBody(+100,0,0) on a rz=90 body moves along WORLD +x, not +y',
    Math.abs(dx - 100) < 0.5 && Math.abs(dy) < 0.5,
    `dx=${dx.toFixed(3)} dy=${dy.toFixed(3)}`,
  );
}

console.log('\n--- 2. named survival: fillet named BEFORE an in-place move still builds AFTER it ---');
{
  const bodyName = 'Body2';
  session.newBody(bodyName);
  const sketchName = 'box2_sk';
  session.sketchNew(bodyName, sketchName);
  session.sketchAddRectangle(sketchName, -20, -20, 20, 20);
  const padName = 'box2_pad';
  session.pad(bodyName, sketchName, padName, 20);
  session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `body = doc.getObject(${JSON.stringify(bodyName)})\n` +
    `body.Placement = App.Placement(App.Vector(0,0,-10), App.Rotation())\n` +
    `doc.recompute()\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'ok': True}))\n`
  );
  // Fillet an edge BEFORE the move.
  const filletName = session.fillet(bodyName, padName, ['Edge1'], 2);
  check('fillet built before the move', !!filletName);
  const tipBefore = session.bodyTip(bodyName);
  check('bodyTip() readback matches the fillet just built', tipBefore === filletName, `tip=${tipBefore}`);
  // Now move the WHOLE body (the fillet is its current tip).
  session.moveBody(bodyName, [30, 0, 0]);
  const afterMoveTip = session.bodyTip(bodyName);
  check('moving the body did not disturb its Tip', afterMoveTip === filletName, `tip=${afterMoveTip}`);
  // Confirm the fillet is still a valid, non-null shape after the move.
  const stateRes = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `o = doc.getObject(${JSON.stringify(filletName === 'Fillet' ? filletName : filletName)})\n` +
    `ok = o is not None and 'Invalid' not in o.State and not o.Shape.isNull()\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'ok': ok, 'volume': (o.Shape.Volume if ok else None)}))\n`
  );
  check('fillet named/built before the move is still valid after it', !!stateRes.ok, JSON.stringify(stateRes));
}

console.log('\n--- 3. copyBodyMoved independence: fillet the ORIGINAL after copying -- the copy must stay sharp ---');
{
  const bodyName = 'Body3';
  session.newBody(bodyName);
  const sketchName = 'box3_sk';
  session.sketchNew(bodyName, sketchName);
  session.sketchAddRectangle(sketchName, -20, -20, 20, 20);
  const padName = 'box3_pad';
  session.pad(bodyName, sketchName, padName, 20);
  session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `body = doc.getObject(${JSON.stringify(bodyName)})\n` +
    `body.Placement = App.Placement(App.Vector(0,0,-10), App.Rotation())\n` +
    `doc.recompute()\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'ok': True}))\n`
  );
  const before = worldBbox(bodyName);
  const { bodyName: copyBodyName, tipName: copyTipName } = session.copyBodyMoved(bodyName, [60, 0, 0]);
  console.log('copy result:', JSON.stringify({ copyBodyName, tipName: copyTipName }));
  const originalAfterCopy = worldBbox(bodyName);
  check('original body untouched by the copy', JSON.stringify(originalAfterCopy) === JSON.stringify(before));
  const copyBbox = worldBbox(copyBodyName);
  check('copy sits translated by the offset', Math.abs(copyBbox[0][0] - (before[0][0] + 60)) < 0.5, JSON.stringify(copyBbox));

  // Fillet the ORIGINAL (padName), then check the copy's own tip shape is
  // still unrounded (a fillet on the original must not leak into the copy).
  session.fillet(bodyName, padName, ['Edge1'], 2);
  const copyState = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `o = doc.getObject(${JSON.stringify(copyTipName)})\n` +
    `ok = o is not None and not o.Shape.isNull()\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'ok': ok, 'typeId': (o.TypeId if ok else None), 'volume': (o.Shape.Volume if ok else None)}))\n`
  );
  check(
    "copy's own tip is still a Pad (unrounded) after filleting the ORIGINAL",
    copyState.ok && copyState.typeId === 'PartDesign::Pad',
    JSON.stringify(copyState),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
