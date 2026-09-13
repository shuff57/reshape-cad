#!/usr/bin/env node
// Real-kernel regression test asking the same question
// freecad-extrude-mesh.manual.mjs asked for the rectangle starter (see that
// file's own header for the full rectangle bug account, already fixed in
// sketch-translate.ts), but for the app's other two Sketch-tool starters:
// model-types.ts's newCircleSketch() and newPolygonSketch(). Does Sketch ->
// Pull silently fail for these the same way it did for the default
// rectangle, and does the already-merged final redundant-constraint sweep
// (translateSketch()'s post-closure-loop block) already cover them?
//
// FINDING (confirmed against the real kernel, not guessed): NEITHER starter
// carries any pre-existing explicit constraint that could collide with
// DoF-closure's own corner pins, so neither can ever produce a REDUNDANT
// constraint the way RECTANGLE_CONSTRAINTS did:
//
//   - newCircleSketch() never sets `constraints` at all, and
//     translateSketch()'s circle branch (sketch-translate.ts:236-249) does
//     not go through the DoF-closure loop or the redundant sweep in the
//     first place -- it returns immediately after emitting exactly 3
//     constraints (radius, distanceX-to-origin, distanceY-to-origin) for a
//     circle's exact 3 degrees of freedom (center x, center y, radius). 3
//     constraints for 3 DoF is exactly determined, not over-determined.
//
//   - newPolygonSketch() also never sets `constraints` (unlike
//     newRectangleSketch(), which explicitly carries
//     RECTANGLE_CONSTRAINTS.slice()) -- model-types.ts:815-830 returns a
//     bare `{ id, kind: 'sketch', plane, offset, points }` with no
//     `constraints` field. sketch-translate.ts's `for (const c of
//     sketch.constraints ?? [])` loop (line 387) therefore adds ZERO
//     explicit constraints beyond the mandatory per-edge Coincident welds
//     (needed to close the loop at all, not optional). DoF-closure then
//     pins every corner's x AND y with nothing already fixing any of them
//     -- the same "zero explicit constraints" shape the rectangle bug's own
//     root-cause comment names for box/cylinder primitives ("its own inline
//     rectangle carries ZERO constraints, so it can never have a redundant
//     one"). A hexagon starter is structurally identical to that case, not
//     to the rectangle's.
//
// This file exists to CONFIRM that reasoning against the real kernel rather
// than trust it on paper -- sk.solve()'s own probe is exactly the thing the
// rectangle bug proved cannot be trusted alone (it reported the rectangle
// fixture as perfectly consistent right up until doc.recompute() silently
// refused to build a Shape). Both starters below pass with ZERO changes to
// sketch-translate.ts.
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 in Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" -v "<repo>:/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad"
//     fc-kernel-pd-final node --experimental-wasm-exnref
//     /repo/packages/kernel/test/freecad-circle-polygon-mesh.manual.mjs
//     /work/build/bin/FreeCADCmd.js
// Run `npm run build` first (this imports packages/kernel/dist/* + packages/engine/dist/*).

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

let pass = 0;
let fail = 0;
function checkTrue(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  ok ? pass++ : fail++;
}
function check(label, got, want, tol = 0.5) {
  const ok = typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${typeof got === 'number' ? got.toFixed(4) : String(got)} (want ${want.toFixed(4)})`);
  ok ? pass++ : fail++;
}

const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-circle-polygon-mesh.manual.mjs <path-to-FreeCADCmd.js>');
  process.exit(1);
}

globalThis.resolveGlobalSymbol = globalThis.resolveGlobalSymbol
  || function resolveGlobalSymbolStub() { return { sym: undefined }; };

const { loadNodeKernel } = await load('packages/engine/src/fc-session-node.mjs');
const { createFcSession } = await load('packages/engine/src/fc-session.mjs');
const { attachCommands } = await load('packages/engine/src/fc-commands.mjs');
const { attachSketchCommands } = await load('packages/engine/src/fc-sketch.mjs');
const { attachDrawingCommands } = await load('packages/engine/src/fc-drawing.mjs');
const { FreeCadEngineAdapter } = await load('packages/kernel/dist/freecad-engine-adapter.js');

const Module = await loadNodeKernel(fcKernelJs);
const session = attachDrawingCommands(attachSketchCommands(attachCommands(createFcSession(Module))));
const adapter = new FreeCadEngineAdapter(THREE, async () => Module);
adapter['session'] = session;

// model-types.ts's newCircleSketch(): two diameter-end points, tagged
// `shape: 'circle'`, NO `constraints` field -- see this file's header.
function circleDoc(id, plane, offset, centre, radius, height) {
  const skId = `${id}_sk`;
  return {
    version: 1,
    features: [
      {
        id: skId, kind: 'sketch', plane, offset,
        points: [[centre[0] - radius, centre[1]], [centre[0] + radius, centre[1]]],
        shape: 'circle',
      },
      { id, kind: 'extrude', target: skId, height },
    ],
  };
}

// model-types.ts's newPolygonSketch(): `sides` points around a centre/vertex
// pair, NO `constraints` field (unlike newRectangleSketch()'s
// RECTANGLE_CONSTRAINTS) -- see this file's header.
function polygonPoints(center, vertex, sides) {
  const dx = vertex[0] - center[0];
  const dy = vertex[1] - center[1];
  const radius = Math.hypot(dx, dy);
  const startAngle = Math.atan2(dy, dx);
  const points = [];
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (i / sides) * Math.PI * 2;
    points.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return points;
}
function polygonDoc(id, plane, offset, center, vertex, sides, height) {
  const skId = `${id}_sk`;
  return {
    version: 1,
    features: [
      { id: skId, kind: 'sketch', plane, offset, points: polygonPoints(center, vertex, sides) },
      { id, kind: 'extrude', target: skId, height },
    ],
  };
}

function meshAndCheck(label, doc, id, wantVolume, tol) {
  const fc = adapter.build(doc);
  const entry = fc.shapes.get(id);
  checkTrue(`${label}: built (no refusal)`, !fc.refusals?.get(id), fc.refusals?.get(id) ?? '');
  checkTrue(`${label}: entry exists`, !!entry);
  const m = entry && adapter.mesh(entry);
  checkTrue(`${label}: adapter.mesh(entry) returns a real mesh, not null`, m !== null,
    m === null ? 'silent redundant-constraint refusal, same shape as the rectangle bug' : '');
  if (m) {
    checkTrue(`${label}: mesh has faces`, m.faces.length > 0, `${m.faces.length} faces`);
    check(`${label}: volume`, session.meshFaces(entry.bodyName).volume, wantVolume, tol);
  }
  return { fc, entry };
}

console.log("--- Sketch(circle r=15) -> Pull, xy@0 ---");
{
  // volume = pi * r^2 * h = pi * 225 * 12
  meshAndCheck('circle xy@0', circleDoc('c_xy0', 'xy', 0, [0, 0], 15, 12), 'c_xy0', Math.PI * 225 * 12, 5.0);
}

console.log("\n--- Sketch(circle r=15, off-centre) -> Pull, xz@10: different plane/offset/centre ---");
{
  meshAndCheck(
    'circle xz@10', circleDoc('c_xz10', 'xz', 10, [20, -5], 15, 12), 'c_xz10', Math.PI * 225 * 12, 5.0,
  );
}

console.log("\n--- Sketch(regular hexagon, sides=6) -> Pull, xy@0 ---");
{
  // Regular hexagon area = (3*sqrt(3)/2) * r^2 for a hexagon whose vertices
  // sit on a circle of radius r (matching newPolygonSketch()'s own
  // construction: every point is `radius` from `center`).
  const r = 20;
  const area = (3 * Math.sqrt(3) / 2) * r * r;
  meshAndCheck(
    'hexagon xy@0', polygonDoc('hex_xy0', 'xy', 0, [0, 0], [r, 0], 6, 12), 'hex_xy0', area * 12, 5.0,
  );
}

console.log("\n--- Sketch(pentagon, sides=5) -> Pull, xz@10: different sides/plane/offset ---");
{
  const r = 18;
  // Regular n-gon area with circumradius r: (n/2) * r^2 * sin(2*pi/n).
  const sides = 5;
  const area = (sides / 2) * r * r * Math.sin((2 * Math.PI) / sides);
  meshAndCheck(
    'pentagon xz@10', polygonDoc('pent_xz10', 'xz', 10, [0, 0], [r, 0], sides, 12), 'pent_xz10', area * 12, 5.0,
  );
}

console.log("\n--- circle sketch's OWN Shape (pre-Pad) must be valid, fully constrained, and Up-to-date ---");
{
  const doc = {
    version: 1,
    features: [{ id: 'sk_circle', kind: 'sketch', plane: 'xy', offset: 0, points: [[-15, 0], [15, 0]], shape: 'circle' }],
  };
  const fc = adapter.build(doc);
  const entry = fc.shapes.get('sk_circle');
  const probe = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `sk = doc.getObject(${JSON.stringify(entry.objName)})\n` +
    // A lone Sketch with no dependent Pad/Extrude is NEVER pushed through
    // doc.recompute() by anything on this bridge -- fc-sketch.mjs's own
    // geometry/constraint emitters call only sk.solve() (found by reading
    // every emitter: addLine/addCircle/coincident/unary/binary/distance all
    // stop at sk.solve()), and doc.recompute() is called ONLY by
    // delConstraint/setDatum/trim/addPoint/addEllipse/sketchNew* -- none of
    // which this circle path ever calls (no redundant constraint to delete,
    // see this file's header). Measured live: without this explicit
    // recompute, sk.Shape.isNull() reads True here even though dof=0,
    // fully=True, redundant=[] -- a standalone-sketch bookkeeping artifact,
    // NOT the reported bug (which is specifically about a Pad silently
    // refusing to build from an over-constrained profile). The real
    // Sketch -> Pull path always builds a Pad, which always forces this
    // recompute anyway (proved by the passing mesh checks above) -- this
    // explicit call just makes the standalone probe test the same thing
    // fairly instead of a false negative.
    `doc.recompute()\n` +
    `payload = {'isNull': sk.Shape.isNull(), 'fully': sk.FullyConstrained, 'dof': sk.DoF, 'state': list(sk.State), ` +
    `'redundant': list(sk.RedundantConstraints)}\n` +
    // session.read()'s own OUT_PATH is hardcoded to this exact path
    // (fc-session.mjs) -- writing anywhere else leaves read() silently
    // reading back a STALE file from FreeCAD's own internal sketchState()
    // calls instead of this probe's payload (found live: an earlier version
    // of this file wrote to a differently-named path and got back
    // sketchState()'s own {geometry,constraints,dof,...} shape here).
    `open(${JSON.stringify('/tmp/reshape_out.json')}, 'w').write(json.dumps(payload))\n`
  );
  checkTrue('circle sketch Shape is not null', probe.isNull === false, JSON.stringify(probe));
  checkTrue('circle sketch is fully constrained (dof 0)', probe.fully === true && probe.dof === 0, JSON.stringify(probe));
  checkTrue('circle: no leftover redundant constraints', probe.redundant.length === 0, JSON.stringify(probe));
}

console.log("\n--- hexagon sketch's OWN Shape (pre-Pad) must be valid, fully constrained, and Up-to-date ---");
{
  const doc = {
    version: 1,
    features: [{ id: 'sk_hex', kind: 'sketch', plane: 'xy', offset: 0, points: polygonPoints([0, 0], [20, 0], 6) }],
  };
  const fc = adapter.build(doc);
  const entry = fc.shapes.get('sk_hex');
  const probe = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `sk = doc.getObject(${JSON.stringify(entry.objName)})\n` +
    // See the circle probe above for why this explicit recompute is here:
    // a lone hexagon sketch with no redundant constraint to delete never
    // gets doc.recompute()'d by anything on this bridge either.
    `doc.recompute()\n` +
    `payload = {'isNull': sk.Shape.isNull(), 'fully': sk.FullyConstrained, 'dof': sk.DoF, 'state': list(sk.State), ` +
    `'redundant': list(sk.RedundantConstraints)}\n` +
    `open(${JSON.stringify('/tmp/reshape_out.json')}, 'w').write(json.dumps(payload))\n`
  );
  checkTrue('hexagon sketch Shape is not null', probe.isNull === false, JSON.stringify(probe));
  checkTrue('hexagon sketch is fully constrained (dof 0)', probe.fully === true && probe.dof === 0, JSON.stringify(probe));
  checkTrue('hexagon: no leftover redundant constraints', probe.redundant.length === 0, JSON.stringify(probe));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
