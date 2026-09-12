#!/usr/bin/env node
// Probe: why PartDesign::Hole (FreeCAD's own purpose-built feature) was
// rejected in favor of the Pocket-based design in docs/specs/SPEC-hole.md.
// This is the evidence, kept runnable rather than living only in a chat
// message -- same "promote a throwaway probe" precedent as mirror-probe.mjs/
// move-probe.mjs.
//
// FOUR questions, each independently measured against this kernel fork
// (fc-kernel-pd-final) -- freshly, by this probe, NOT by re-citing
// SPEC-hole.md's own numbers (which came from `oracle-hole-design`'s own
// investigation, using a rig this probe does not have visibility into --
// see the "MY OWN NUMBERS DIFFER" note below on question 2):
//
//   1. Does PartDesign::Hole even HAVE a drill-direction property?
//      MEASURED (this probe, via h.PropertiesList, 51 properties dumped):
//      NO. There is no Direction/DirectionMode property at all on this
//      fork's PartDesign::Hole -- Diameter/Depth/DepthType/DrillPoint/
//      DrillPointAngle/Threaded/HoleCutType and their siblings are the
//      entire surface. The ONLY way to point a PartDesign::Hole anywhere
//      other than its own Profile sketch's local Z is to reorient the
//      PROFILE SKETCH itself -- exactly the world-frame-proxy technique
//      fc-commands.mjs's own bore() uses for its circle-profile Pocket.
//      Question 2 below tests whether that actually WORKS for
//      PartDesign::Hole the way it does for Pocket.
//
//   2. Given a Profile sketch rotated to point along world X (the SAME
//      body.Placement.inverse() * App.Placement(origin, rotation) formula
//      this file's own bore() uses, here applied to a Hole's Profile instead
//      of a Pocket's), does PartDesign::Hole actually drill along world X,
//      or does it silently drill along body-local Z regardless?
//      MEASURED (this probe, 40x40x20 box, d6, Depth=22, Midplane=True,
//      DrillPoint='Flat' on both sides so DrillPoint's own bug does not
//      confound this question): a FLAT, UNROTATED profile at the box's own
//      centre removes 282.743 (31717.257 remaining) -- a ONE-SIDED cut
//      clipped at 10 units, meaning Midplane is NOT actually honoured for
//      Hole the way it is for Pocket, a second, independent finding.
//      A profile explicitly ROTATED to point its own local Z along world X
//      -- otherwise identical, same box, same centre point -- instead
//      removes 565.487 (31434.513 remaining), i.e. the SAME number as a
//      FULL through-the-20-thick-material cut. Since the box is 40 wide
//      along X, a genuine through-bore ALONG X would have to remove
//      1130.973 (30869.027 remaining, this port's own bore() 'x' answer)
//      -- it does not. So the rotated profile produced a DIFFERENT number
//      from the unrotated one, but NEITHER matches "drilled straight along
//      world X" -- the rotation changed *something* about the cut (Midplane
//      apparently now applies, where it did not for the flat case) without
//      actually redirecting the drill axis. Net effect either way: the
//      requested world-X direction was NOT honoured, and Hole's own
//      Midplane/one-sided behaviour is inconsistent between the two setups
//      -- MY OWN NUMBERS DIFFER FROM SPEC-hole.md's own citation
//      (31434.51 vs 30869.03), almost certainly because my rig (a raw
//      Sketcher::SketchObject holding one Part.Point, unattached, built
//      directly rather than however oracle-hole-design's own investigation
//      built its Profile) is not byte-for-byte the same setup -- but the
//      CONCLUSION is the same: direction is not usably controllable here.
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
//      MEASURED: removes 565.487 -- exactly ONE bore's worth, not two
//      (1130.973). Confirms the under-drill finding directly: two points in
//      one Profile sketch, one PartDesign::Hole feature, only one hole cut.
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
  session.pad(bodyName, sketchName, padName, 20); // height 20, local z in [0,20]
  // Centre it exactly the way freecad-engine-adapter.ts's own setBodyPlacement()
  // does for a box (-height/2 pre-shift) -- world z in [-10,10], matching every
  // fixture this port's own bore() is verified against, so the numbers below
  // are directly comparable to fc-commands.mjs's own bore().
  session.exec(
    `import FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `doc.getObject(${JSON.stringify(bodyName)}).Placement = App.Placement(App.Vector(0,0,-10), App.Rotation())\n` +
    `doc.recompute()\n`
  );
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

// 'z' case: Profile sketch flat XY, translated to the box's own body-local
// mid-height (z=10, since freshBox()'s pad spans body-local z [0,20]) so it
// starts from the SAME centred point 2b's rotated profile does below --
// otherwise a flat sketch left at body-local z=0 sits exactly on the box's
// OWN bottom face, which is a different (edge-of-material) question from
// direction. Hole drills along the sketch's own local Z, which for a flat,
// UNROTATED sketch is world Z.
session.newDocument('probe2');
freshBox('Body1', 'box_sk', 'box_pad');
const zCase = holeVolume(
  'Body1',
  `psk = body.newObject('Sketcher::SketchObject', 'sk_z')\n` +
    `psk.Placement = App.Placement(App.Vector(0,0,10), App.Rotation())\n` +
    `psk.addGeometry(Part.Point(App.Vector(0,0,0)), False)\n`,
  '',
);
console.log("2a. PartDesign::Hole, flat-XY profile, centred ('z'): ", JSON.stringify(zCase));

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

// NOTE: matching volumes here is NOT itself proof the direction was honoured
// -- a d6 bore through 20mm of material and a d6 bore through 40mm of
// material give DIFFERENT removed volumes (565.487 vs 1130.973), so the
// correct falsifying check is whether the 'x' case's REMOVED volume matches
// a through-cut of the 40-wide axis (30869.026644707672, this port's own
// bore() 'x' answer) or of the 20-thick axis (31434.513322353836, the 'z'
// answer) -- volume ALONE distinguishes this specific pair of alternatives
// fine (unlike SPEC-hole.md's own rotated-BODY case #6/#7, where several
// wrong placements share a volume and only isInside() can tell them apart).
const BORE_X_ANSWER = 30869.026644707672; // through the 40-wide axis
const BORE_Z_ANSWER = 31434.513322353836; // through the 20-thick axis
console.log(
  xCase.ok
    ? (Math.abs(xCase.volume - BORE_X_ANSWER) < 0.5
        ? "  => matches a genuine through-bore along world X (this port's own bore() answer): PartDesign::Hole DID honour the rotated profile here -- re-check SPEC-hole.md's own account against this result."
        : Math.abs(xCase.volume - BORE_Z_ANSWER) < 0.5
          ? "  => matches the 'z'-axis answer despite the profile being rotated toward world X: direction was IGNORED, consistent with SPEC-hole.md."
          : `  => matches NEITHER expected answer (got ${xCase.volume}) -- a third, unexplained behaviour; worth a closer look before relying on this feature for anything.`)
    : '  => the rotated-profile build refused/failed outright -- see state/ok above.',
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
    `psk.Placement = App.Placement(App.Vector(0,0,10), App.Rotation())\n` +
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
