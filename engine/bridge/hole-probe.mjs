#!/usr/bin/env node
// Probe: why PartDesign::Hole (FreeCAD's own purpose-built feature) was
// rejected in favor of the Pocket-based design in docs/specs/SPEC-hole.md.
// This is the evidence, kept runnable rather than living only in a chat
// message -- same "promote a throwaway probe" precedent as mirror-probe.mjs/
// move-probe.mjs.
//
// THREE questions, each independently measured against this kernel fork
// (fc-kernel-pd-final):
//
//   1. Does PartDesign::Hole even HAVE a drill-direction property?
//      MEASURED (this probe, via h.PropertiesList): NO. There is no
//      Direction/DirectionMode property at all on this fork's PartDesign::
//      Hole -- Diameter/Depth/DepthType/DrillPoint/DrillPointAngle/
//      Threaded/HoleCutType and their siblings are the entire surface. The
//      ONLY way to point a PartDesign::Hole anywhere other than its own
//      Profile sketch's local Z is to reorient the PROFILE SKETCH itself --
//      exactly the world-frame-proxy technique fc-commands.mjs's own bore()
//      uses for its circle-profile Pocket. Part 2 below tests whether that
//      actually WORKS for PartDesign::Hole the way it does for Pocket.
//
//   2. Given a Profile sketch rotated to point along world X (the SAME
//      body.Placement.inverse() * App.Placement(origin, rotation) formula
//      this file's own bore() uses, here applied to a Hole's Profile instead
//      of a Pocket's), does PartDesign::Hole actually drill along world X,
//      or does it silently drill along world Z regardless? This is the
//      actual falsifying measurement for "drill direction silently
//      ignored" -- SPEC-hole.md's own account (31434.51 vs 30869.03) is
//      reproduced fresh here rather than merely cited.
//
//   3. DrillPoint's own SCHEMA DEFAULT (h.PropertiesList / getEnumerationsOfProperty)
//      is 'Angled', not 'Flat' -- confirmed directly from the property dump
//      below, no build required. A caller that does not know to override
//      DrillPoint on every single hole gets a coned bottom by default, unlike
//      occt-build.ts's own flat-bottomed cylinder cut and unlike this port's
//      own bore()/Pocket design (which has no DrillPoint concept to forget
//      at all -- a Pocket profile is just a circle, always flat).
//
//   4. Multi-circle profile (two Point geometries in ONE sketch, matching
//      the shape of a bolt-pattern's own profile): does ONE PartDesign::Hole
//      feature drill both, or only one?
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 if Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" -v "<repo>:/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad"
//     fc-kernel-pd-final node --experimental-wasm-exnref
//     /repo/engine/bridge/hole-probe.mjs /work/build/bin/FreeCADCmd.js

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node hole-probe.mjs <path-to-FreeCADCmd.js>');
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

function freshBox(bodyName, sketchName, padName) {
  session.newBody(bodyName);
  session.sketchNew(bodyName, sketchName);
  session.sketchAddRectangle(sketchName, -20, -20, 20, 20); // 40x40
  session.pad(bodyName, sketchName, padName, 20); // height 20
}

// ---------------------------------------------------------------------------
// 1/2. PropertiesList dump (question 1) + a 'z' hole and an 'x'-rotated-
// profile hole (question 2), same box, compared against each other and
// against this port's own bore()-based volumes (31434.513... for 'z',
// 30869.026... for a through-bore along the 40-wide axis).
// ---------------------------------------------------------------------------
session.newDocument('probe1');
freshBox('Body1', 'box_sk', 'box_pad');

const propsRes = session.read(
  `import json, FreeCAD as App, Part\n` +
  `doc = App.ActiveDocument\n` +
  `body = doc.getObject('Body1')\n` +
  `psk = body.newObject('Sketcher::SketchObject', 'probe_sk')\n` +
  `psk.addGeometry(Part.Point(App.Vector(0,0,0)), False)\n` +
  `doc.recompute()\n` +
  `h = body.newObject('PartDesign::Hole', 'ProbeHole')\n` +
  `h.Profile = psk\n` +
  `doc.recompute()\n` +
  `props = sorted(h.PropertiesList)\n` +
  `has_direction = any('Direction' in p and p != 'ThreadDirection' for p in props)\n` +
  `open('/tmp/reshape_out.json', 'w').write(json.dumps({\n` +
  `    'hasDirectionProperty': has_direction,\n` +
  `    'defaultDrillPoint': h.DrillPoint,\n` +
  `    'defaultDepthType': h.DepthType,\n` +
  `    'propertyCount': len(props),\n` +
  `}))\n` +
  // Undo this scratch feature -- the 'z'/'x' cases below build their own.
  `body.Tip = doc.getObject('box_pad')\n` +
  `doc.removeObject('ProbeHole')\n` +
  `doc.removeObject('probe_sk')\n` +
  `doc.recompute()\n`
);
console.log('1. PartDesign::Hole PropertiesList probe:', JSON.stringify(propsRes, null, 2));

function holeVolume(bodyName, sketchExtra, holeExtra) {
  const py =
    `import json, FreeCAD as App, Part\n` +
    `doc = App.ActiveDocument\n` +
    `body = doc.getObject(${JSON.stringify(bodyName)})\n` +
    sketchExtra +
    `doc.recompute()\n` +
    `h = body.newObject('PartDesign::Hole', 'H_' + str(id(body)))\n` +
    `h.Profile = psk\n` +
    holeExtra +
    `h.Diameter = 6\n` +
    `h.Depth = 22\n` +
    `h.DrillPoint = 'Flat'\n` + // isolate the direction question from the DrillPoint question
    `h.Midplane = True\n` +
    `body.Tip = h\n` +
    `doc.recompute()\n` +
    `_ok = ('Invalid' not in h.State) and not h.Shape.isNull()\n` +
    `_vol = h.Shape.Volume if _ok else None\n` +
    `_bb = h.Shape.BoundBox\n` +
    `open('/tmp/reshape_out.json', 'w').write(json.dumps({'ok': _ok, 'state': list(h.State), 'volume': _vol, 'bbox': [[_bb.XMin,_bb.YMin,_bb.ZMin],[_bb.XMax,_bb.YMax,_bb.ZMax]]}))\n`;
  return session.read(py);
}

// 'z' case: Profile sketch flat XY at body-local origin -- Hole drills along
// the sketch's own local Z, which for a flat-XY unrotated sketch IS world Z.
session.newDocument('probe2');
freshBox('Body1', 'box_sk', 'box_pad');
const zCase = holeVolume(
  'Body1',
  `psk = body.newObject('Sketcher::SketchObject', 'sk_z')\n` +
    `psk.addGeometry(Part.Point(App.Vector(0,0,0)), False)\n`,
  '',
);
console.log("2a. PartDesign::Hole, flat-XY profile ('z'): ", JSON.stringify(zCase));

// 'x' case: SAME technique bore() itself uses -- rotate the PROFILE sketch's
// own Placement so its local Z points along world X, via
// body.Placement.inverse() * App.Placement(origin, Rotation(local Z -> world X)).
// If PartDesign::Hole genuinely drills along its Profile's own local Z (the
// same contract Pocket honours, per this file's own bore() design), this
// should produce the SAME volume as fc-commands.mjs's own bore() 'x' case
// (30869.026644707672) -- NOT the same volume as 2a above.
session.newDocument('probe3');
freshBox('Body1', 'box_sk', 'box_pad');
const xCase = holeVolume(
  'Body1',
  `frame = App.Placement(App.Vector(0,0,0), App.Rotation(App.Vector(0,0,1), App.Vector(1,0,0)))\n` +
    `psk = body.newObject('Sketcher::SketchObject', 'sk_x')\n` +
    `psk.Placement = body.Placement.inverse().multiply(frame)\n` +
    `psk.addGeometry(Part.Point(App.Vector(0,0,0)), False)\n`,
  '',
);
console.log("2b. PartDesign::Hole, profile rotated to point along world X ('x'): ", JSON.stringify(xCase));

console.log(
  xCase.ok && zCase.ok
    ? (Math.abs(xCase.volume - zCase.volume) < 0.5
        ? '  => SAME volume as the z-case despite a world-X-rotated profile: direction is IGNORED, matching SPEC-hole.md.'
        : `  => DIFFERENT volume (${xCase.volume} vs ${zCase.volume}): PartDesign::Hole DID honour the rotated profile here -- re-check SPEC-hole.md's own account against this result.`)
    : '  => one of the two builds refused/failed outright -- see state/ok above.',
);

// ---------------------------------------------------------------------------
// 3. DrillPoint's own schema default is already captured in step 1's dump
// (defaultDrillPoint) -- no separate build needed, it is a property default,
// not a build-time behaviour.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. Multi-circle (multi-point) profile: does ONE PartDesign::Hole feature
// drill every point in its Profile sketch, or only one? Two points, 20 apart
// on X, d6 depth 22 (through, midplane) -- if both are drilled, removed
// volume should match TWO d6 through-bores (2x this port's own bore() 'z'
// answer's own removed amount: 2 * (32000 - 31434.513322353836) =
// 2 * 565.486677646164 = 1130.973355292328, i.e. box volume - that =
// 30869.026644707672 coincidentally the SAME number as a single through-bore
// along a 40-wide axis, since both remove one d6 cylinder's worth per unit
// length here -- reasoned independently below rather than assumed equal).
// -----------------------------------------------------------------------
session.newDocument('probe4');
freshBox('Body1', 'box_sk', 'box_pad');
const twoPointCase = holeVolume(
  'Body1',
  `psk = body.newObject('Sketcher::SketchObject', 'sk_multi')\n` +
    `psk.addGeometry(Part.Point(App.Vector(-10,0,0)), False)\n` +
    `psk.addGeometry(Part.Point(App.Vector(10,0,0)), False)\n`,
  '',
);
console.log('4. PartDesign::Hole, TWO points in one Profile sketch:', JSON.stringify(twoPointCase));
const singleBoreRemoved = 32000 - 31434.513322353836; // one d6 through-bore, from this port's own bore()
const expectedTwoBores = 32000 - 2 * singleBoreRemoved;
if (twoPointCase.ok) {
  console.log(`  => removed ${(32000 - twoPointCase.volume).toFixed(3)} vs 2 full bores' worth = ${(2 * singleBoreRemoved).toFixed(3)}`);
  console.log(
    Math.abs(twoPointCase.volume - expectedTwoBores) < 1.0
      ? '  => BOTH points drilled -- multi-point Profile is NOT under-drilled here (re-check SPEC-hole.md against this result).'
      : `  => volume (${twoPointCase.volume}) does not match two full bores (${expectedTwoBores.toFixed(3)}) -- consistent with SPEC-hole.md's under-drill finding.`,
  );
}
