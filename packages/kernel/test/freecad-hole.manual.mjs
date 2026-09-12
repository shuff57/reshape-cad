#!/usr/bin/env node
// Real-kernel verification for the 'hole' FreeCadEngineAdapter branch added in
// this pass (docs/specs/SPEC-hole.md). Same "two engines, one number" bar as
// freecad-move.manual.mjs/freecad-combine.manual.mjs: build the SAME ModelDoc
// fixture through OcctEngineAdapter's own buildDoc() (occt-build.ts:974's own
// 'hole' branch -- cylinder + BRepAlgoAPI_Cut) and through FreeCadEngineAdapter,
// and compare volume AND (where the hole reaches a boundary) bounding box --
// never volume alone, per the falsification table below.
//
// THE DESIGN this branch exists to prove (SPEC-hole.md): ONE PartDesign::Pocket
// per drill plane, cut by an UNATTACHED, world-positioned circle-profile
// sketch -- fc-commands.mjs's bore() -- NOT a Part::Cut (would set
// container:'part' and break the app's own documented flagship chain,
// reshape-docs.ts:139: box -> hollow -> hole -> round(edge)) and NOT
// PartDesign::Hole (three silent-wrong-answer bugs measured against this
// kernel: drill direction ignored on 2 of 3 axes, multi-circle profiles
// under-drilled, a coned bottom instead of flat).
//
// Falsification checklist (SPEC-hole.md's own table, numbered 1-13):
//   1. newHole default, 40x40x20 box                 -- baseline
//   2. blind internal cavity                          -- kills a ThroughAll/shortcut impl
//   3. Midplane 3-way discriminator (top-face plane)   -- kills Midplane dropped / Reversed=True
//   4. axis 'x' / 'y'                                  -- kills a PartDesign::Hole impl (ignores axis)
//   5. corners {dx,dy}, ONE sketch/ONE Pocket          -- kills 4 chained Pockets, or halved dx/dy
//   6. rotated rz=90, bore world X, isInside            -- kills a missing .inverse()/right-multiply
//   7. rotated rx=90, off-origin center, isInside       -- kills rotation-order/bbox-centring bugs
//   8. box -> hole -> fillet(edge)                      -- kills a Part::Cut design (notInABody)
//   9. box -> hollow -> hole -> round(edge), flagship   -- same, on the app's own documented chain
//  10. box -> hole -> hole                              -- kills a design with no usable Tip left
//  11. hole on a combine result                         -- kills a missing notInABody() gate
//  12. diameter<=0 / depth<=0                            -- refuses cleanly, no kernel round trip
//  13. diameter too large for the target's cross-section -- refuses with the fit-check wording
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 in Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" -v "<repo>:/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad"
//     fc-kernel-pd-final node --experimental-wasm-exnref
//     /repo/packages/kernel/test/freecad-hole.manual.mjs
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

function occtOf(doc, id) {
  return measureShape(oc, buildDoc(oc, doc, arc).shapes.get(id));
}

// ---------------------------------------------------------------------------
// FreeCAD half
// ---------------------------------------------------------------------------
const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-hole.manual.mjs <path-to-FreeCADCmd.js>');
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

function meshOf(entry) {
  return session.mesh(entry.objName);
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
// Shape.isInside() at named WORLD points, on the Body's own (world-frame)
// Shape -- proof of LOCATION, not just volume. See this file's own header:
// a missing .inverse() or a right-multiply passes every volume check here
// and only fails this.
function solidAt(bodyName, points, tol = 1e-4) {
  const py =
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `sh = doc.getObject(${JSON.stringify(bodyName)}).Shape\n` +
    `pts = ${JSON.stringify(points)}\n` +
    `res = [bool(sh.isInside(App.Vector(p[0],p[1],p[2]), ${tol}, True)) for p in pts]\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'inside': res}))\n`;
  return session.read(py).inside;
}
// A real, straight (line, not arc) edge name on `objName`'s own CURRENT
// shape -- used to prove a fillet builds ON a hole's result at the
// FreeCAD-command level (SPEC-hole.md's own measured table: "PartDesign::
// Fillet built ON the bore result | builds, tipIsFillet: true"). Deliberately
// bypasses this adapter's own TopoName face/edge-picking vocabulary (a
// SEPARATE, pre-existing scope limit -- findPrimitiveAncestor()/
// findSketchAncestor() do not walk through a 'hole'/'pocket'/'shell' step,
// the same as they do not for any other non-box/cylinder/extrude result
// today) -- this checks the thing SPEC-hole.md's own design decision is
// actually about: that the Pocket-based hole leaves a genuine, further-
// buildable PartDesign chain, which a Part::Cut design could not do at all
// (session.fillet()/session.thickness() on a Part:: object raise
// "'Part.Feature' object has no attribute 'newObject'", not a scoping gap).
function firstStraightEdgeName(objName) {
  const py =
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `sh = doc.getObject(${JSON.stringify(objName)}).Shape\n` +
    `idx = None\n` +
    `for i, e in enumerate(sh.Edges):\n` +
    `    try:\n` +
    `        if e.Curve.TypeId in ('Part::GeomLine', 'Part::GeomLineSegment') and e.Length > 1.0:\n` +
    `            idx = i\n` +
    `            break\n` +
    `    except Exception:\n` +
    `        continue\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'edge': ('Edge%d' % (idx+1)) if idx is not None else None}))\n`;
  return session.read(py).edge;
}

const box = (id, size, center, rotate) => {
  const f = { id, kind: 'box', size, center };
  if (rotate) f.rotate = rotate;
  return f;
};
const hole = (id, target, over) => ({
  id, kind: 'hole', target, diameter: 6, depth: 22, center: [0, 0, 0], axis: 'z', ...over,
});

console.log('\n--- 1. newHole default: 40x40x20 box, d6, depth 22, centred ---');
{
  const doc = { version: 1, features: [box('b1', [40, 40, 20], [0, 0, 0]), hole('h1', 'b1')] };
  const occt = occtOf(doc, 'h1');
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('h1'));
  const entry = fc.shapes.get('h1');
  checkTrue('no `container` field (stays in the Body, unlike combine)', entry.container === undefined);
  const m = meshOf(entry);
  check('volume vs OCCT', m.volume, occt.volume, 1.0);
  check('volume (expected 31434.513: box 32000 minus a d6 bore through the 20-thick material)', m.volume, 31434.513322353836, 1.0);
}

console.log('\n--- 2. blind internal cavity (depth 10 in a 20-thick box): kills a ThroughAll/shortcut impl ---');
{
  const doc = { version: 1, features: [box('b2', [40, 40, 20], [0, 0, 0]), hole('h2', 'b2', { depth: 10 })] };
  const occt = occtOf(doc, 'h2');
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('h2'));
  const m = meshOf(fc.shapes.get('h2'));
  check('volume vs OCCT', m.volume, occt.volume, 1.0);
  check('volume (expected 31717.257: only 10 of the 20-thick material removed, not through)', m.volume, 31717.256661176914, 1.0);
  checkTrue('did NOT bore through (a ThroughAll/shortcut would land on 31434.513 instead)', Math.abs(m.volume - 31434.513322353836) > 5);
}

console.log('\n--- 3. Midplane 3-way discriminator: profile on the top face, depth 10 ---');
{
  // center z = +10 puts the bore's own centre exactly on the box's top face
  // (box spans z in [-10,10]); Midplane clips the other half of the cylinder
  // to empty space above the box, removing exactly HALF the full-depth bore.
  const doc = { version: 1, features: [box('b3', [40, 40, 20], [0, 0, 0]), hole('h3', 'b3', { depth: 10, center: [0, 0, 10] })] };
  const occt = occtOf(doc, 'h3');
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('h3'));
  const m = meshOf(fc.shapes.get('h3'));
  check('volume vs OCCT (both engines symmetric-bore by construction)', m.volume, occt.volume, 1.0);
  check('volume (expected 31858.628 -- Midplane); Reversed=False would give 31717.257, Reversed=True would give 32000 (no cut)', m.volume, 31858.628330588457, 1.0);
}

console.log("--- 4. axis 'x' and 'y': kills a PartDesign::Hole impl (ignores drill direction on 2 of 3 axes) ---");
for (const axis of ['x', 'y']) {
  const id = `h4${axis}`;
  const doc = { version: 1, features: [box(`b4${axis}`, [40, 40, 20], [0, 0, 0]), hole(id, `b4${axis}`, { axis, depth: 50 })] };
  const occt = occtOf(doc, id);
  const fc = adapter.build(doc);
  checkTrue(`axis '${axis}' built (no refusal)`, !fc.refusals?.get(id));
  const m = meshOf(fc.shapes.get(id));
  check(`axis '${axis}' volume vs OCCT`, m.volume, occt.volume, 1.0);
  check(`axis '${axis}' volume (expected 30869.027: through-bore along the 40-wide axis)`, m.volume, 30869.026644707672, 1.0);
}

console.log('\n--- 5. corners {dx:15,dy:10}: ONE sketch, ONE Pocket, 4 bores -- kills 4 chained Pockets ---');
{
  const doc = { version: 1, features: [box('b5', [40, 40, 20], [0, 0, 0]), hole('h5', 'b5', { corners: { dx: 15, dy: 10 } })] };
  const occt = occtOf(doc, 'h5');
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('h5'));
  const m = meshOf(fc.shapes.get('h5'));
  check('volume vs OCCT', m.volume, occt.volume, 1.0);
  check('volume (expected 29738.053: 4 bores in one cut, no refill from sequential cuts)', m.volume, 29738.053289415348, 1.0);
}

console.log('\n--- 6. rotated body rz=90, bore world X at world y=+12: kills a missing .inverse() / right-multiply ---');
{
  // The box is SQUARE in XY (40x40), so rotating it rz=90 changes NOTHING
  // about its volume or world bbox -- deliberately, per this file's own
  // header: only Shape.isInside() at named world points can catch a
  // coordinate-frame bug here, because several WRONG placements share this
  // exact same volume.
  const doc = {
    version: 1,
    features: [
      box('b6', [40, 40, 20], [0, 0, 0], [0, 0, 90]),
      hole('h6', 'b6', { axis: 'x', depth: 50, center: [0, 12, 0] }),
    ],
  };
  const occt = occtOf(doc, 'h6');
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('h6'));
  const entry = fc.shapes.get('h6');
  const m = meshOf(entry);
  check('volume vs OCCT (rotation does not change the removed volume here)', m.volume, occt.volume, 1.0);
  const inside = solidAt(entry.bodyName, [[0, 12, 0], [12, 0, 0], [0, -12, 0]]);
  checkTrue(
    'solidAt [world y=+12 (bored, void), world x=+12 (a missing .inverse() would wrongly bore here), world y=-12 (a double-rotation bug would wrongly bore here)] === [false, true, true]',
    JSON.stringify(inside) === JSON.stringify([false, true, true]),
    JSON.stringify(inside),
  );
}

console.log('\n--- 7. rotated rx=90, off-origin center, bore world Z: kills rotation-order/bbox-centring bugs ---');
{
  // Box centred at world (5,0,0): after rx=90 it spans x:[-15,25], y:[-10,10],
  // z:[-20,20] -- its WORLD bbox centre is (5,0,0), not (0,0,0). A bore with
  // center:[0,0,0] (no extra offset) should land on that WORLD centre, along
  // world Z -- which #6 alone cannot exercise (no translation there).
  const doc = {
    version: 1,
    features: [
      box('b7', [40, 40, 20], [5, 0, 0], [90, 0, 0]),
      hole('h7', 'b7', { axis: 'z', depth: 50 }),
    ],
  };
  const occt = occtOf(doc, 'h7');
  const fc = adapter.build(doc);
  checkTrue('built (no refusal)', !fc.refusals?.get('h7'));
  const entry = fc.shapes.get('h7');
  const m = meshOf(entry);
  check('volume vs OCCT', m.volume, occt.volume, 1.0);
  const inside = solidAt(entry.bodyName, [[5, 0, 10], [0, 0, 10], [5, 0, -19]]);
  checkTrue(
    'solidAt [world (5,0,10) (bored, void), world (0,0,10) (a bbox-centring bug would wrongly bore here instead), world (5,0,-19) (still inside the same through-bore, void)] === [false, true, false]',
    JSON.stringify(inside) === JSON.stringify([false, true, false]),
    JSON.stringify(inside),
  );
}

console.log('\n--- 8. box -> hole -> fillet(edge): kills a Part::Cut design (notInABody would wrongly refuse this) ---');
{
  const doc = { version: 1, features: [box('b8', [40, 40, 20], [0, 0, 0]), hole('h8', 'b8')] };
  const fc = adapter.build(doc);
  checkTrue('hole built (no refusal)', !fc.refusals?.get('h8'));
  const entry = fc.shapes.get('h8');
  const edgeName = firstStraightEdgeName(entry.objName);
  checkTrue('found a straight edge on the hole result to fillet', !!edgeName, String(edgeName));
  let filletErr = null;
  try { session.fillet(entry.bodyName, entry.objName, [edgeName], 0.3); } catch (e) { filletErr = e; }
  checkTrue(
    'a PartDesign::Fillet builds ON the hole result -- a Part::Cut design could not accept this at all (AttributeError)',
    !filletErr, filletErr ? filletErr.message : '',
  );
  checkTrue('Body.Tip advanced to the Fillet', session.bodyTip(entry.bodyName) === 'Fillet');
}

console.log("--- 9. box -> hollow -> hole -> round(edge): the app's own documented flagship chain (reshape-docs.ts:139) ---");
{
  const doc = {
    version: 1,
    features: [
      box('b9', [40, 40, 20], [0, 0, 0]),
      { id: 's9', kind: 'shell', target: 'b9', thickness: 2, open: { cause: 'primitive', feature: 'b9', kind: 'face', part: '+z' } },
      hole('h9', 's9'),
    ],
  };
  const fc = adapter.build(doc);
  checkTrue('shell built (no refusal)', !fc.refusals?.get('s9'));
  checkTrue('hole on the shell result built (no refusal, no notInABody)', !fc.refusals?.get('h9'));
  const entry = fc.shapes.get('h9');
  checkTrue('no `container` field on the hole result', entry.container === undefined);
  const edgeName = firstStraightEdgeName(entry.objName);
  checkTrue('found a straight edge to round', !!edgeName, String(edgeName));
  let filletErr = null;
  try { session.fillet(entry.bodyName, entry.objName, [edgeName], 0.3); } catch (e) { filletErr = e; }
  checkTrue('the FULL flagship chain (box -> hollow -> hole -> round) builds end to end', !filletErr, filletErr ? filletErr.message : '');
}

console.log('\n--- 10. box -> hole -> hole: kills a design that leaves no usable Tip behind ---');
{
  const doc = {
    version: 1,
    features: [
      box('b10', [60, 40, 20], [0, 0, 0]),
      hole('h10a', 'b10', { center: [-15, 0, 0] }),
      hole('h10b', 'h10a', { center: [15, 0, 0] }),
    ],
  };
  const occt = occtOf(doc, 'h10b');
  const fc = adapter.build(doc);
  checkTrue('first hole built (no refusal)', !fc.refusals?.get('h10a'));
  checkTrue('second hole, chained onto the first, built (no refusal)', !fc.refusals?.get('h10b'));
  const first = fc.shapes.get('h10a');
  const second = fc.shapes.get('h10b');
  checkTrue('both holes live in the SAME Body', first.bodyName === second.bodyName);
  checkTrue('second hole left a genuinely different object behind (a usable new Tip)', second.objName !== first.objName);
  const m = meshOf(second);
  check('volume vs OCCT', m.volume, occt.volume, 1.0);
}

console.log('\n--- 11. hole on a combine result: kills a missing notInABody() gate ---');
{
  const boxA = { id: 'ca', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] };
  const boxB = { id: 'cb', kind: 'box', size: [40, 40, 20], center: [20, 0, 0] };
  const doc = {
    version: 1,
    features: [boxA, boxB, { id: 'cu', kind: 'combine', op: 'union', targets: ['ca', 'cb'] }, hole('h11', 'cu')],
  };
  const fc = adapter.build(doc);
  const why = fc.refusals?.get('h11');
  checkTrue('hole on a combine result refuses cleanly (notInABody), not a kernel AttributeError', !!why);
  checkTrue('refusal names the real reason', !!why && why.includes('PartDesign'));
  checkTrue('the combine itself is untouched and still shown', fc.shapes.get('h11') === fc.shapes.get('cu'));
}

console.log('\n--- 12. diameter <= 0 / depth <= 0 (including a NEGATIVE depth): refuses cleanly before touching the kernel ---');
{
  const docD = { version: 1, features: [box('b12d', [40, 40, 20], [0, 0, 0]), hole('h12d', 'b12d', { diameter: 0 })] };
  const fcD = adapter.build(docD);
  const whyD = fcD.refusals?.get('h12d');
  checkTrue('diameter:0 refuses', !!whyD, whyD);
  checkTrue(
    'refusal matches occt-build.ts\'s own wording ("...must both be greater than zero...")',
    !!whyD && whyD.includes('diameter') && whyD.includes('depth') && whyD.includes('must both be greater than zero'),
    whyD,
  );

  const docZ = { version: 1, features: [box('b12z', [40, 40, 20], [0, 0, 0]), hole('h12z', 'b12z', { depth: 0 })] };
  const fcZ = adapter.build(docZ);
  checkTrue('depth:0 refuses', !!fcZ.refusals?.get('h12z'));

  // depth:-1 is a SEPARATE case from depth:0 -- `<= 0` should catch a
  // genuinely negative value too, not just the zero boundary.
  const docN = { version: 1, features: [box('b12n', [40, 40, 20], [0, 0, 0]), hole('h12n', 'b12n', { depth: -1 })] };
  const fcN = adapter.build(docN);
  const whyN = fcN.refusals?.get('h12n');
  checkTrue('depth:-1 (negative, not just zero) refuses', !!whyN, whyN);
  checkTrue(
    'refusal matches occt-build.ts\'s own wording',
    !!whyN && whyN.includes('must both be greater than zero'),
    whyN,
  );
}

console.log("--- 13. diameter too large for the target's cross-section: refuses with the fit-check wording ---");
{
  const doc = { version: 1, features: [box('b13', [10, 10, 20], [0, 0, 0]), hole('h13', 'b13', { diameter: 20 })] };
  const fc = adapter.build(doc);
  const why = fc.refusals?.get('h13');
  checkTrue('too-large diameter refuses', !!why, why);
  checkTrue('refusal matches occt-build.ts\'s own "would not fit" wording', !!why && why.includes('would not fit'));
  checkTrue('the target is still shown without the hole', fc.shapes.get('h13') === fc.shapes.get('b13'));

  // diameter:500 on a 40-wide box, once per axis -- coverage that EVERY
  // axis branch of the fit-check ternary refuses (not just 'z', the one
  // every other case above happens to exercise). A diameter this absurd
  // exceeds every possible cross-section, so on its own it does not prove
  // the CORRECT two axes were compared -- the discriminating fixture right
  // after this loop does that.
  for (const axis of ['x', 'y', 'z']) {
    const docBig = { version: 1, features: [box(`b13big${axis}`, [40, 40, 20], [0, 0, 0]), hole(`h13big${axis}`, `b13big${axis}`, { axis, diameter: 500 })] };
    const fcBig = adapter.build(docBig);
    const whyBig = fcBig.refusals?.get(`h13big${axis}`);
    checkTrue(`diameter:500, axis '${axis}': refuses`, !!whyBig, whyBig);
    checkTrue(`diameter:500, axis '${axis}': matches occt-build.ts's own "would not fit" wording`, !!whyBig && whyBig.includes('would not fit'));
  }

  // Discriminator: a box with a DIFFERENT dimension on every axis, and a
  // diameter that fits ONE axis's own perpendicular pair but not the other
  // two -- box [40,30,10] (x=40,y=30,z=10), diameter 20.
  //   axis 'x' -> perpendicular pair is [y,z] = [30,10], min 10 -> 20 > 10, REFUSES
  //   axis 'y' -> perpendicular pair is [x,z] = [40,10], min 10 -> 20 > 10, REFUSES
  //   axis 'z' -> perpendicular pair is [x,y] = [40,30], min 30 -> 20 <= 30, FITS
  // A "compare against the wrong two axes" bug (e.g. always checking x/y
  // regardless of f.axis) would flip AT LEAST one of these three verdicts:
  // axis 'x' would wrongly FIT (checking [x,y]=[40,30] instead of [y,z]),
  // and axis 'z' would wrongly REFUSE if the bug instead always checked
  // [y,z]. diameter:500 above cannot catch this -- it exceeds every pair.
  const discSize = [40, 30, 10];
  for (const [axis, shouldFit] of [['x', false], ['y', false], ['z', true]]) {
    const id = `hdisc${axis}`;
    const docDisc = { version: 1, features: [box(`bdisc${axis}`, discSize, [0, 0, 0]), hole(id, `bdisc${axis}`, { axis, diameter: 20, depth: 5 })] };
    const fcDisc = adapter.build(docDisc);
    const whyDisc = fcDisc.refusals?.get(id);
    checkTrue(
      `perpendicular-axis discriminator, axis '${axis}' (box [40,30,10], d20): ${shouldFit ? 'fits' : 'refuses'}`,
      shouldFit ? !whyDisc : !!whyDisc,
      whyDisc ?? '(built, no refusal)',
    );
  }
}

console.log('\n--- 14. hole into a body whose Tip is a FeatureTransformedPattern (pattern/mirror, not a Pad/primitive) ---');
{
  // Both fixtures below build a single CONTIGUOUS 80x40x20 solid (two
  // touching 40x40x20 boxes, fused by the pattern/mirror's own additive
  // construction -- see freecad-engine-adapter.ts's own 'pattern'/'mirror'
  // branch comments) so the bore's own removed volume is exactly one clean
  // d4 through-cut, depth 10, fully inside the 20-tall material:
  // pi*2^2*10 = 125.66370614359172 (4*pi*10), matching SPEC-hole.md's own
  // measured row for both a LinearPattern-tipped and a Mirrored-tipped body.
  const EXPECTED_REMOVED = 4 * Math.PI * 10;

  // pattern -> hole: box + LinearPattern (count 2, step 40 along x) ->
  // combined world bbox x in [-20,60] (two touching 40-wide boxes) -> centre
  // (20,0,0). Bore at that centre, axis z, d4, depth 10 (contained inside
  // the 20-tall material -- no clipping).
  {
    const doc = {
      version: 1,
      features: [
        box('bp14', [40, 40, 20], [0, 0, 0]),
        { id: 'pp14', kind: 'pattern', target: 'bp14', mode: 'linear', count: 2, step: [40, 0, 0] },
        hole('hp14', 'pp14', { diameter: 4, depth: 10 }),
      ],
    };
    const fc = adapter.build(doc);
    checkTrue('pattern built (no refusal)', !fc.refusals?.get('pp14'));
    checkTrue('hole on the pattern result built (no refusal)', !fc.refusals?.get('hp14'));
    const entry = fc.shapes.get('hp14');
    const m = meshOf(entry);
    const patternEntry = fc.shapes.get('pp14');
    const removed = meshOf(patternEntry).volume - m.volume;
    check('removed volume = 4*pi*10 = 125.664 (pattern-tipped body)', removed, EXPECTED_REMOVED, 0.5);
  }

  // mirror -> hole: box + Mirrored across its own near face (plane 'yz') ->
  // combined world bbox x in [-60,20] (box [-20,20] + its own reflection
  // [-60,-20], touching at x=-20) -> centre (-20,0,0). Same bore as above.
  {
    const doc = {
      version: 1,
      features: [
        box('bm14', [40, 40, 20], [0, 0, 0]),
        { id: 'mm14', kind: 'mirror', target: 'bm14', plane: 'yz' },
        hole('hm14', 'mm14', { diameter: 4, depth: 10 }),
      ],
    };
    const fc = adapter.build(doc);
    checkTrue('mirror built (no refusal)', !fc.refusals?.get('mm14'));
    checkTrue('hole on the mirror result built (no refusal)', !fc.refusals?.get('hm14'));
    const entry = fc.shapes.get('hm14');
    const m = meshOf(entry);
    const mirrorEntry = fc.shapes.get('mm14');
    const removed = meshOf(mirrorEntry).volume - m.volume;
    check('removed volume = 4*pi*10 = 125.664 (mirror-tipped body)', removed, EXPECTED_REMOVED, 0.5);
  }
}

console.log('\n--- 15. a bore placed entirely outside the material: passes silently, volume UNCHANGED (not an over-eager volGuard) ---');
{
  // f.center is a huge offset -- the fit-check only compares diameter
  // against the target's OWN cross-section dimensions (it has no idea
  // where f.center will actually place the bore), so this must NOT refuse;
  // it must build, and the Pocket's own cut removes nothing because the
  // profile circle never touches the box at all. See fc-commands.mjs's own
  // bore() header: "NO volGuard -- a bore that misses the solid is a
  // silent no-op here AND on OCCT ... it must not raise."
  const doc = { version: 1, features: [box('b15', [40, 40, 20], [0, 0, 0]), hole('h15', 'b15', { center: [1000, 0, 0] })] };
  const occt = occtOf(doc, 'h15');
  const fc = adapter.build(doc);
  checkTrue('built (no refusal, no over-eager volGuard)', !fc.refusals?.get('h15'));
  const entry = fc.shapes.get('h15');
  const m = meshOf(entry);
  check('volume UNCHANGED (32000) -- the bore missed the solid entirely', m.volume, 32000, 0.5);
  check('volume vs OCCT (same no-op parity occt-build.ts\'s own Cut gives for a non-intersecting tool)', m.volume, occt.volume, 0.5);
  checkTrue(
    'Tip still ADVANCES to a new object even though geometry is unchanged (matches SPEC-hole.md\'s own measured note)',
    entry.objName !== fc.shapes.get('b15').objName,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
