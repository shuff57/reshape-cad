// engine/bridge/pattern-axis-live-test.mjs
//
// Real-kernel verification for docs/specs/SPEC-coord-fix.md: the world-frame
// axis-proxy fix (pattern's 3 documented refusals) and revolve/groove (the
// old "not yet supported" catch-all). Same "two engines, one number" bar as
// freecad-pattern.manual.mjs / freecad-new-kinds.manual.mjs: build the SAME
// ModelDoc fixture through the real FreeCadEngineAdapter and compare
// Body.Shape.Volume (tolerance 1e-4) and Shape.BoundBox (4 decimal places)
// against hand-computed expectations -- bbox is checked on every pattern
// case, not just volume, because the rotated-target bug produces the SAME
// volume whether broken or fixed; only bbox tells them apart.
//
// USAGE
//   node --experimental-wasm-exnref engine/bridge/pattern-axis-live-test.mjs <path-to-FreeCADCmd.js>
// Run `npm run build` first (this loads the COMPILED adapter, packages/kernel/dist).

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

let pass = 0;
let fail = 0;
function check(label, got, want, tol = 1e-4) {
  const ok = typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${typeof got === 'number' ? got.toFixed(4) : String(got)} (want ${want.toFixed(4)})`);
  ok ? pass++ : fail++;
}
function checkTrue(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  ok ? pass++ : fail++;
}
function checkBbox(label, gotBbox, wantBbox, decimals = 4) {
  const tol = 5 * 10 ** -decimals;
  let ok = true;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      if (wantBbox[j][i] === null) continue; // null = "don't care about this bound"
      if (Math.abs(gotBbox[j][i] - wantBbox[j][i]) > tol) ok = false;
    }
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(gotBbox)} want ${JSON.stringify(wantBbox)}`);
  ok ? pass++ : fail++;
}

// Polygon area + centroid (shoelace formula), CCW-positive. Used to compute
// Pappus's theorem volumes from the SAME 2D points the test builds, not a
// hardcoded literal, per the spec's own instruction.
function polygonAreaCentroid(points) {
  let a = 0, cx = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
  }
  const area = a / 2;
  const centroidX = cx / (6 * area);
  return { area: Math.abs(area), centroidX: Math.abs(centroidX) };
}
function pappusVolume(points) {
  const { area, centroidX } = polygonAreaCentroid(points);
  return 2 * Math.PI * area * centroidX;
}

const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node pattern-axis-live-test.mjs <path-to-FreeCADCmd.js>');
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

function bodyBBox(bodyName) {
  return session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `bb = doc.getObject(${JSON.stringify(bodyName)}).Shape.BoundBox\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`
  ).bbox;
}
function bodyVolume(bodyName) {
  return session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `b = doc.getObject(${JSON.stringify(bodyName)})\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'volume': b.Shape.Volume}))\n`
  ).volume;
}

// ===========================================================================
// 1. Rotated linear pattern -- closes gap 1
// ===========================================================================
console.log('\n--- 1. Rotated linear pattern (gap 1) ---');
{
  const doc = {
    version: 1,
    features: [
      { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0], rotate: [0, 0, 45] },
      { id: 'pat1', kind: 'pattern', target: 'box1', mode: 'linear', count: 3, step: [30, 0, 0] },
    ],
  };
  const r = adapter.build(doc);
  if (r.refusals?.size) console.log('refusals:', [...r.refusals.entries()]);
  checkTrue('rotated linear pattern built (no refusal)', !r.refusals?.get('pat1'));
  const entry = r.shapes.get('pat1');
  check('volume ~= 3x box (3000)', bodyVolume(entry.bodyName), 3000);
  checkBbox(
    'bbox proves copies moved along WORLD X, not the tilted local axis',
    bodyBBox(entry.bodyName),
    [[-7.0711, -7.0711, null], [67.0711, 7.0711, null]],
  );
}

// ===========================================================================
// 2. Non-'z' circular axis -- closes gap 2
// ===========================================================================
console.log("\n--- 2. Non-'z' circular axis (gap 2) ---");
{
  // NOTE: offset to y in [10,20] (not the more obvious y in [-5,5], symmetric
  // about the axis) -- a 10x10x10 cube at radius 5 from the axis (as [-5,5]
  // gives) has a half-diagonal of 7.07 in its rotating cross-section, bigger
  // than the radius, so adjacent 90-degree copies genuinely self-overlap
  // (verified independently by hand: 2D inclusion-exclusion on the 4 rotated
  // 10x10 squares gives union area 300 of 400, i.e. volume 3000, exactly
  // what the kernel measures) -- a real geometric fact about that fixture,
  // not a defect in this fix. Offsetting to radius sqrt(15^2+5^2)=15.81, well
  // past the 7.07 reach, gives 4 genuinely non-overlapping copies instead.
  const doc = {
    version: 1,
    features: [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[15, 10], [25, 10], [25, 20], [15, 20]] },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 10 },
      { id: 'pat2', kind: 'pattern', target: 'e1', mode: 'circular', count: 4, axis: 'x', totalAngle: 360 },
    ],
  };
  const r = adapter.build(doc);
  if (r.refusals?.size) console.log('refusals:', [...r.refusals.entries()]);
  checkTrue("circular pattern around 'x' built (no refusal)", !r.refusals?.get('pat2'));
  const entry = r.shapes.get('pat2');
  check('volume ~= 4x box (4000), non-overlapping', bodyVolume(entry.bodyName), 4000);
  const bbox = bodyBBox(entry.bodyName);
  console.log('bbox:', JSON.stringify(bbox));
  checkTrue(
    'bbox symmetric in y and z (orbiting a box around world X centres the ring on the X axis)',
    Math.abs(bbox[0][1] + bbox[1][1]) < 1e-3 && Math.abs(bbox[0][2] + bbox[1][2]) < 1e-3,
    JSON.stringify(bbox),
  );
}

// ===========================================================================
// 3. Circular pattern of a primitive -- closes gap 3
// ===========================================================================
console.log('\n--- 3. Circular pattern of a primitive (gap 3) ---');
{
  const doc = {
    version: 1,
    features: [
      { id: 'sph1', kind: 'sphere', radius: 5, center: [30, 0, 0] },
      { id: 'pat3', kind: 'pattern', target: 'sph1', mode: 'circular', count: 4, axis: 'z', totalAngle: 360 },
    ],
  };
  const r = adapter.build(doc);
  if (r.refusals?.size) console.log('refusals:', [...r.refusals.entries()]);
  checkTrue('circular pattern of a primitive built (no refusal)', !r.refusals?.get('pat3'));
  const entry = r.shapes.get('pat3');
  check('volume ~= 4x sphere (2094.3951) -- old broken behavior returned 523.5988 (collapsed to 1x)', bodyVolume(entry.bodyName), 2094.3951, 0.01);
  checkBbox('bbox spans the full orbit ring', bodyBBox(entry.bodyName), [[-35, -35, -5], [35, 35, 5]], 3);
}

// ===========================================================================
// 4. Circular partial angle -- P2's spacing bug, found in passing
// ===========================================================================
console.log("\n--- 4. Circular partial angle (P2's spacing bug) ---");
{
  const doc = {
    version: 1,
    features: [
      { id: 'box4', kind: 'box', size: [6, 6, 6], center: [20, 0, 0] },
      { id: 'pat4', kind: 'pattern', target: 'box4', mode: 'circular', count: 4, axis: 'z', totalAngle: 180 },
    ],
  };
  const r = adapter.build(doc);
  if (r.refusals?.size) console.log('refusals:', [...r.refusals.entries()]);
  checkTrue('circular partial-angle pattern built (no refusal)', !r.refusals?.get('pat4'));
  const entry = r.shapes.get('pat4');
  check('volume ~= 4x 6-box (864), non-overlapping at correct 45-degree spacing', bodyVolume(entry.bodyName), 864, 0.5);
  const angleCheck = session.read(
    `import json, FreeCAD as App, math\n` +
    `doc = App.ActiveDocument\n` +
    `b = doc.getObject(${JSON.stringify(entry.bodyName)})\n` +
    `solids = b.Shape.Solids\n` +
    `angles = []\n` +
    `for s in solids:\n` +
    `    c = s.CenterOfMass\n` +
    `    angles.append(math.degrees(math.atan2(c.y, c.x)) % 360)\n` +
    `angles.sort()\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'n': len(solids), 'angles': angles}))\n`
  );
  console.log('instance angles:', JSON.stringify(angleCheck));
  if (angleCheck.n === 4) {
    const diffs = [];
    for (let i = 1; i < angleCheck.angles.length; i++) diffs.push(angleCheck.angles[i] - angleCheck.angles[i - 1]);
    checkTrue('instances spaced at 45 degrees (0/45/90/135), not 60 (0/60/120/180)', diffs.every((d) => Math.abs(d - 45) < 1), JSON.stringify(diffs));
  } else {
    checkTrue('expected 4 non-overlapping instances', false, JSON.stringify(angleCheck));
  }
}

// ===========================================================================
// 5. Regression: multi-axis linear step must still refuse
// ===========================================================================
console.log('\n--- 5. Regression: multi-axis linear step still refuses ---');
{
  const doc = {
    version: 1,
    features: [
      { id: 'box5', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
      { id: 'pat5', kind: 'pattern', target: 'box5', mode: 'linear', count: 3, step: [20, 20, 0] },
    ],
  };
  const r = adapter.build(doc);
  checkTrue('multi-axis step still refuses', !!r.refusals?.get('pat5'), r.refusals?.get('pat5'));
}

// ===========================================================================
// 6. Negative-Y step -- App.Rotation antiparallel degeneracy
// ===========================================================================
console.log('\n--- 6. Negative-Y step (App.Rotation antiparallel degeneracy) ---');
{
  const doc = {
    version: 1,
    features: [
      { id: 'box6', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
      { id: 'pat6', kind: 'pattern', target: 'box6', mode: 'linear', count: 3, step: [0, -30, 0] },
    ],
  };
  const r = adapter.build(doc);
  if (r.refusals?.size) console.log('refusals:', [...r.refusals.entries()]);
  checkTrue('negative-Y step pattern built (no refusal, no throw)', !r.refusals?.get('pat6'));
  const entry = r.shapes.get('pat6');
  check('volume ~= 3x box (3000)', bodyVolume(entry.bodyName), 3000);
  const bbox = bodyBBox(entry.bodyName);
  checkTrue('extends in -Y, not misplaced', bbox[0][1] < -20, `yMin=${bbox[0][1]}`);
}

// ===========================================================================
// 7. Revolve -- trapezoid profile, Pappus-verified
// ===========================================================================
console.log('\n--- 7. Revolve (Pappus-verified) ---');
{
  const profilePoints = [[5, 0], [15, 0], [10, 10], [5, 10]];
  const expected = pappusVolume(profilePoints);
  const doc = {
    version: 1,
    features: [
      { id: 'sk7', kind: 'sketch', plane: 'xy', offset: 0, points: profilePoints },
      { id: 'rev7', kind: 'revolve', target: 'sk7', angle: 360 },
    ],
  };
  const r = adapter.build(doc);
  if (r.refusals?.size) console.log('refusals:', [...r.refusals.entries()]);
  checkTrue('revolve built (no refusal)', !r.refusals?.get('rev7'));
  const entry = r.shapes.get('rev7');
  check('volume matches Pappus theorem (2*pi*area*centroidDistance)', bodyVolume(entry.bodyName), expected, 1.0);
}

// ===========================================================================
// 8. Crossing-axis refusal -- revolve
// ===========================================================================
console.log('\n--- 8. Crossing-axis refusal (revolve) ---');
{
  const doc = {
    version: 1,
    features: [
      { id: 'sk8', kind: 'sketch', plane: 'xy', offset: 0, points: [[-5, 0], [15, 0], [10, 10], [-5, 10]] },
      { id: 'rev8', kind: 'revolve', target: 'sk8', angle: 360 },
    ],
  };
  const r = adapter.build(doc);
  checkTrue('a profile crossing the spin axis refuses cleanly (revolve)', !!r.refusals?.get('rev8'), r.refusals?.get('rev8'));
}

// ===========================================================================
// 9. Crossing-axis refusal -- groove (same body via the sk-reused-for-extrude
// trick: v1 has no sketchNewOnFace wiring through ModelDoc, same documented
// limitation as pocket's own build.test.mjs -- so target/into share a body
// only when `into` is built by extruding the SAME sketch id groove targets)
// ===========================================================================
console.log('\n--- 9. Crossing-axis refusal (groove) ---');
{
  const doc = {
    version: 1,
    features: [
      { id: 'sk9', kind: 'sketch', plane: 'xy', offset: 0, points: [[-5, 0], [15, 0], [10, 10], [-5, 10]] },
      { id: 'base9', kind: 'extrude', target: 'sk9', height: 5 },
      { id: 'grv9', kind: 'groove', target: 'sk9', into: 'base9', angle: 360 },
    ],
  };
  const r = adapter.build(doc);
  checkTrue('a profile crossing the spin axis refuses cleanly (groove)', !!r.refusals?.get('grv9'), r.refusals?.get('grv9'));
}

// ===========================================================================
// 10. Regression: groove across two different bodies still refuses
// (unrelated to this fix -- same pre-existing constraint pocket has)
// ===========================================================================
console.log('\n--- 10. Regression: groove across two different bodies still refuses ---');
{
  const doc = {
    version: 1,
    features: [
      { id: 'box10', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
      { id: 'sk10', kind: 'sketch', plane: 'xy', offset: 0, points: [[5, 5], [15, 5], [15, 15], [5, 15]] },
      { id: 'grv10', kind: 'groove', target: 'sk10', into: 'box10', angle: 360 },
    ],
  };
  try {
    adapter.build(doc);
    checkTrue('groove across two different bodies throws', false, 'did not throw');
  } catch (e) {
    checkTrue('groove across two different bodies throws', /cuts across two different bodies/.test(e.message), e.message);
  }
}

// ===========================================================================
// 11. Groove -- working cut, Pappus-verified (built via direct session calls:
// v1's ModelDoc 'sketch' branch always opens a FRESH body (no
// sketchNewOnFace wiring, same documented limitation pocket's own
// build.test.mjs carries), so a real "cut into a pre-existing solid" groove
// is exercised at the session level the same way the adapter's own emitters
// are proven elsewhere in this repo's manual test suite.)
// ===========================================================================
console.log('\n--- 11. Groove (working cut, Pappus-verified, session-level) ---');
{
  const profilePoints = [[5, 0], [15, 0], [10, 10], [5, 10]];
  const pappus = pappusVolume(profilePoints);
  session.newDocument('groove11doc');
  const body = session.newBody('Body11');
  // Base: a solid cylinder radius 20 height 10, fully containing the swept
  // ring (max profile x = 15 < 20; profile y range [0,10] matches height).
  session.sketchCircle(body, 'BaseSk', 20, 0, 0);
  session.pad(body, 'BaseSk', 'BasePad', 10);
  const baseVolume = bodyVolume(body);
  check('base cylinder volume matches pi*r^2*h', baseVolume, Math.PI * 20 * 20 * 10, 0.5);
  const grooveSketch = session.sketchNewOnOrigin(body, 'GrooveSk', 'XZ_Plane');
  // translateSketch expects a SketchFeature object -- reuse it (the compiled
  // dist, matching @shuff57/reshape-engine/sketch-translate's own export map)
  // for byte-identical geometry emission to the adapter's own revolve/groove
  // path, rather than hand-rolling addLine calls that could drift from it.
  const { translateSketch } = await load('packages/engine/dist/sketch-translate.js');
  translateSketch(session, grooveSketch, { id: 'sk11', kind: 'sketch', plane: 'xy', offset: 0, points: profilePoints });
  session.groove(body, grooveSketch, 'Grv11', 360);
  const afterVolume = bodyVolume(body);
  console.log(`base=${baseVolume} after=${afterVolume} expectedCut(Pappus)=${pappus} expectedAfter=${baseVolume - pappus}`);
  check('groove removed exactly the Pappus-computed swept volume', afterVolume, baseVolume - pappus, 1.0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
