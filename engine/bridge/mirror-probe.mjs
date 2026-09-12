#!/usr/bin/env node
// Probe: does PartDesign::Mirrored.MirrorPlane honor a world-frame proxy
// sketch's own world position (like NeutralPlane does), or does it reject
// every explicit reference the way PullDirection does?
//
// Setup deliberately puts the BODY's own local origin somewhere OTHER than
// the desired mirror plane, so a "works" result cannot be explained by
// MirrorPlane secretly falling back to body-local origin:
//   - box 40x40x20, CENTERED AT WORLD (20,0,0) -- so the body's own
//     Placement (set to the box's center, same convention as
//     freecad-engine-adapter.ts's setBodyPlacement()) sits at world x=20,
//     while the box spans world x in [0,40].
//   - desired mirror plane: world x=0 (the box's OWN near face, matching
//     occt-build.ts's "mirror through the near face" contract), normal
//     [1,0,0] -- 20 units away from the body's own local origin.
//
// If MirrorPlane genuinely honors the proxy's world position, the mirrored
// copy should land spanning world x in [-40,0], and PartDesign::Mirrored's
// own combined shape (original + mirror, per its own additive semantics)
// should span x in [-40,40], volume = 2x the box (no overlap since the
// planes only touch at x=0).
//
// If it instead resolves body-local (ignoring the proxy's world offset and
// only using orientation, or ignoring it entirely), the mirror would land
// through the BODY's own origin (world x=20) instead, spanning [0,40]
// mirrored to [0,40] (self-overlap, wrong bbox) or some other wrong result.
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 if Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" fc-kernel-pd-final
//     node --experimental-wasm-exnref /repo/engine/bridge/mirror-probe.mjs
//     /work/build/bin/FreeCADCmd.js

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node mirror-probe.mjs <path-to-FreeCADCmd.js>');
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

session.newDocument('probe');

// Build a body containing a box, placed off-origin -- exactly the
// freecad-engine-adapter.ts box branch's own sequence (sketch + pad,
// Placement set AFTER via a raw exec since we don't have setBodyPlacement
// here; reproduce it manually).
const bodyName = 'Body1';
session.newBody(bodyName);
const sketchName = 'box1_sk';
session.sketchNew(bodyName, sketchName);
session.sketchAddRectangle(sketchName, -20, -20, 20, 20); // 40x40, centered at sketch origin
const padName = 'box1_pad';
session.pad(bodyName, sketchName, padName, 20); // height 20, pad extrudes local +z from 0

// Place the body so the box (locally z in [0,20], x/y in [-20,20]) ends up
// centered at world (20,0,0): local->world shift is (20,0,0) + z-shift of
// -10 to center it (same as setBodyPlacement's own -h/2 convention).
const placeRes = session.read(
  `import json, FreeCAD as App\n` +
  `doc = App.ActiveDocument\n` +
  `body = doc.getObject(${JSON.stringify(bodyName)})\n` +
  `body.Placement = App.Placement(App.Vector(20,0,-10), App.Rotation(0,0,0))\n` +
  `doc.recompute()\n` +
  `bb = doc.getObject(${JSON.stringify(padName)}).Shape.BoundBox\n` +
  `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]],'vol':doc.getObject(${JSON.stringify(padName)}).Shape.Volume}))\n`
);
console.log('base box world bbox/volume:', JSON.stringify(placeRes));

// Now build a world-frame mirror-plane proxy sketch at world x=0, normal
// [1,0,0] -- EXACT same technique as fc-commands.mjs's emit.neutralPlane().
session.neutralPlane(bodyName, 'mirrorPlaneProxy', [0, 0, 0], [1, 0, 0]);

// Attempt PartDesign::Mirrored referencing the proxy the same way
// NeutralPlane's own caller (draft) references it: (sketchObj, ['']).
const mirrorPy =
  `import json, FreeCAD as App\n` +
  `doc = App.ActiveDocument\n` +
  `body = doc.getObject(${JSON.stringify(bodyName)})\n` +
  `mir = body.newObject("PartDesign::Mirrored", "Mirrored")\n` +
  `mir.Originals = [doc.getObject(${JSON.stringify(padName)})]\n` +
  `mir.MirrorPlane = (doc.getObject("mirrorPlaneProxy"), [''])\n` +
  `body.Tip = mir\n` +
  `_res = {'ok': True}\n` +
  `try:\n` +
  `    doc.recompute()\n` +
  `    if 'Invalid' in mir.State or mir.Shape.isNull():\n` +
  `        _res = {'ok': False, 'error': 'Invalid state or null shape', 'state': list(mir.State)}\n` +
  `    else:\n` +
  `        bb = mir.Shape.BoundBox\n` +
  `        _res = {'ok': True, 'bbox': [[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]], 'volume': mir.Shape.Volume}\n` +
  `except Exception as e:\n` +
  `    _res = {'ok': False, 'error': str(e)}\n` +
  `open('/tmp/reshape_out.json','w').write(json.dumps(_res))\n`;

const mirrorRes = session.read(mirrorPy);
console.log('MirrorPlane world-frame-proxy probe result:', JSON.stringify(mirrorRes, null, 2));

if (mirrorRes.ok) {
  const expectedBbox = [[-40, -20, -10], [40, 20, 10]]; // original [0,40] + mirror [-40,0], y/z unchanged
  const expectedVolume = 2 * 40 * 40 * 20;
  console.log('expected (if MirrorPlane honors world position):', JSON.stringify({ bbox: expectedBbox, volume: expectedVolume }));
} else {
  console.log('MirrorPlane REJECTED the world-frame proxy -- same failure class as PullDirection.');
}
