#!/usr/bin/env node
// Real-kernel verification for sketch-derived (Pad) topo-naming --
// resolveFace/resolveEdge/nameFace/nameEdge for `swept`/`rounded`/`cap`
// causes (SPEC-studio-canonical.md phase 3) -- the part
// freecad-engine-adapter-pick.test.mjs's fake session cannot prove: that a
// real FreeCAD Pad's own Shape.Faces really do come back in the ordinal
// order FcSweepInfo assumes, that querySketchGeometry()'s point-on-face
// matching finds the right wall/cap on a shape built on top of the Pad, and
// that a Fillet can actually be built from a pick on a sketch-derived wall.
//
// USAGE (same convention as freecad-picking.manual.mjs):
//   npm run build   (first, so dist/ is current)
//   node packages/kernel/test/freecad-sketch-picking.manual.mjs <pathToFreeCADCmd.js>
// Run inside fc-kernel-pd-final with the repo mounted at exactly
// /mnt/host/c/Users/.../reshape-cad -- see SPEC-engine-port.md §6.3 for why
// that exact mount path matters.

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = got === want || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-2);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  ok ? pass++ : fail++;
}
function checkTruthy(label, got) {
  console.log(`${got ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}`);
  got ? pass++ : fail++;
}

const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-sketch-picking.manual.mjs <pathToFreeCADCmd.js>');
  process.exit(1);
}

globalThis.resolveGlobalSymbol = globalThis.resolveGlobalSymbol
  || function resolveGlobalSymbolStub() { return { sym: undefined }; };

const { loadNodeKernel } = await load('packages/engine/src/fc-session-node.mjs');
const { FreeCadEngineAdapter } = await load('packages/kernel/dist/freecad-engine-adapter.js');

const Module = await loadNodeKernel(fcKernelJs);
const adapter = new FreeCadEngineAdapter({}, async () => Module);
await adapter.load();

// ---------------------------------------------------------------------------
// 1. Rectangle sketch -> extrude: all 4 walls + 2 caps name and round-trip.
// ---------------------------------------------------------------------------
console.log('\n--- rectangle sketch -> extrude: walls + caps name and round-trip ---');
const rectDoc = {
  version: 1,
  features: [
    { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 30], [0, 30]] },
    { id: 'e1', kind: 'extrude', target: 'sk1', height: 20 },
  ],
};
const rectBuilt = adapter.build(rectDoc);
const rectShape = rectBuilt.shapes.get('e1');
checkTruthy('extrude built', !!rectShape);

let namedWalls = 0;
for (let i = 0; i < 4; i++) {
  const ref = adapter.faceAt(rectShape, i);
  const name = adapter.nameFace(rectBuilt, rectDoc, 'e1', ref);
  if (!name) { console.log(`  wall ${i} (${ref.name}) did not name`); continue; }
  namedWalls++;
  check(`wall ${i} name.cause`, name.cause, 'swept');
  check(`wall ${i} name.edge`, name.edge, i);
  const resolved = adapter.resolveFace(name, rectBuilt);
  check(`wall ${i} resolveFace round-trips to the SAME face`, resolved && resolved.name, ref.name);
  const size = adapter.faceSize(ref);
  checkTruthy(`wall ${i} faceSize returns [w,d]`, Array.isArray(size) && size.length === 2);
}
check('all 4 walls named', namedWalls, 4);

let namedCaps = 0;
for (let i = 4; i < 6; i++) {
  const ref = adapter.faceAt(rectShape, i);
  const name = adapter.nameFace(rectBuilt, rectDoc, 'e1', ref);
  if (!name) { console.log(`  cap ${i} (${ref.name}) did not name`); continue; }
  namedCaps++;
  check(`cap ${i} name.cause`, name.cause, 'cap');
  const resolved = adapter.resolveFace(name, rectBuilt);
  check(`cap ${i} resolveFace round-trips to the SAME face`, resolved && resolved.name, ref.name);
}
check('both caps named', namedCaps, 2);
const bottomName = adapter.nameFace(rectBuilt, rectDoc, 'e1', adapter.faceAt(rectShape, 4));
check('cap 4 end', bottomName && bottomName.end, 'bottom');
const topName = adapter.nameFace(rectBuilt, rectDoc, 'e1', adapter.faceAt(rectShape, 5));
check('cap 5 end', topName && topName.end, 'top');

// ---------------------------------------------------------------------------
// 2. Edges between two walls, and between a wall and a cap, name + round-trip.
// ---------------------------------------------------------------------------
console.log('\n--- rectangle extrude: edges name and round-trip ---');
{
  const rawMesh = await (async () => {
    // Reuse the adapter's own session to enumerate real edges, same
    // technique freecad-picking.manual.mjs's own script 2 uses.
    const session = adapter['session'];
    return session.meshFaces(rectShape.objName);
  })();
  let namedEdges = 0;
  for (const e of rawMesh.edges) {
    const ref = { objName: rectShape.objName, name: `Edge${e.id + 1}` };
    const name = adapter.nameEdge(rectBuilt, rectDoc, 'e1', ref);
    if (!name) continue;
    namedEdges++;
    check(`edge ${ref.name} cause`, name.cause, 'between');
    const resolved = adapter.resolveEdge(name, rectBuilt);
    checkTruthy(`edge ${ref.name} resolveEdge round-trips`, resolved && resolved.name);
    const length = adapter.edgeLength(ref);
    checkTruthy(`edge ${ref.name} edgeLength returns a positive number`, typeof length === 'number' && length > 0);
  }
  console.log(`  ${namedEdges} of ${rawMesh.edges.length} edges named`);
  checkTruthy('at least the 4 vertical wall-to-wall edges named', namedEdges >= 4);
}

// ---------------------------------------------------------------------------
// 3. Fillet built from a PICK on a sketch-derived wall's own edge -- the
//    payoff this whole phase exists for: Fillet/Chamfer usable on a real
//    modeled part, not just a raw box/cylinder. Run BEFORE the next
//    build() call (which opens a fresh document and would strand
//    rectShape's own object), same reason section 5's pocket probe below
//    keeps its own extrude build separate too.
// ---------------------------------------------------------------------------
console.log('\n--- fillet built from a pick on a sketch-derived wall edge ---');
{
  const session = adapter['session'];
  const rawMesh = session.meshFaces(rectShape.objName);
  let pickedEdgeName = null;
  for (const e of rawMesh.edges) {
    const ref = { objName: rectShape.objName, name: `Edge${e.id + 1}` };
    const name = adapter.nameEdge(rectBuilt, rectDoc, 'e1', ref);
    if (name && name.cause === 'between') { pickedEdgeName = name; break; }
  }
  checkTruthy('found a nameable edge to fillet', !!pickedEdgeName);
  if (pickedEdgeName) {
    const filletDoc = {
      version: 1,
      features: [
        ...rectDoc.features,
        { id: 'r1', kind: 'fillet', style: 'fillet', target: 'e1', edge: pickedEdgeName, size: 2 },
      ],
    };
    const filletBuilt = adapter.build(filletDoc);
    check('fillet built with no refusal', filletBuilt.refusals ? [...filletBuilt.refusals.entries()] : null, null);
    const filletShape = filletBuilt.shapes.get('r1');
    checkTruthy('fillet result is a distinct solid', !!filletShape && filletShape.objName !== rectShape.objName);
  }
}

// ---------------------------------------------------------------------------
// 4. A rounded-corner sketch -> extrude: the arc's own wall names as
//    `rounded`, not `swept`, and round-trips; straight walls still `swept`.
// ---------------------------------------------------------------------------
console.log('\n--- rounded-corner sketch -> extrude ---');
const roundedDoc = {
  version: 1,
  features: [
    {
      id: 'sk2', kind: 'sketch', plane: 'xy', offset: 0,
      points: [[0, 0], [40, 0], [40, 30], [0, 30]],
      rounds: { 2: 8 },
    },
    { id: 'e2', kind: 'extrude', target: 'sk2', height: 15 },
  ],
};
const roundedBuilt = adapter.build(roundedDoc);
const roundedShape = roundedBuilt.shapes.get('e2');
checkTruthy('rounded extrude built', !!roundedShape);
let roundedCauseFound = false;
let sweptCauseCount = 0;
for (let i = 0; i < 5; i++) {
  const ref = adapter.faceAt(roundedShape, i);
  const name = adapter.nameFace(roundedBuilt, roundedDoc, 'e2', ref);
  if (!name) { console.log(`  wall ${i} (${ref.name}) did not name`); continue; }
  if (name.cause === 'rounded') {
    roundedCauseFound = true;
    check('rounded wall corner index', name.corner, 2);
  } else if (name.cause === 'swept') {
    sweptCauseCount++;
  }
  const resolved = adapter.resolveFace(name, roundedBuilt);
  check(`wall ${i} resolveFace round-trips`, resolved && resolved.name, ref.name);
}
checkTruthy('the arc wall named with cause "rounded"', roundedCauseFound);
check('the other 4 walls named with cause "swept"', sweptCauseCount, 4);

// ---------------------------------------------------------------------------
// 5. Multi-feature chain: pad then pocket. The pad's OWN untouched walls
//    still name when picked on the POCKET's current shape (findSketchAncestor
//    walks .into); the pocket's own new hole faces are an honest null.
//
//    A real pocket cannot be reached through adapter.build() with a plain
//    ModelDoc today -- v1's 'sketch' feature always opens a FRESH Body
//    (freshBody(), unconditional), and pocket's own build() branch throws
//    "cuts across two different bodies" the instant its target sketch is
//    not in the SAME body as `into` (see freecad-engine-adapter-build.
//    test.mjs's own "sketch -> pocket cuts into the same body as its
//    target" test, whose body actually PROVES the throw, not a success --
//    a face-attached "New Sketch on this face" is what would put a pocket's
//    profile in an EXISTING body, and that mechanism (sketchNewOnFace) does
//    not exist in this adapter -- a real, pre-existing, already-documented
//    v1 scope limit (this file's own header, "single-body-per-chain"), not
//    something this phase's naming work can or should fix.
//
//    So this section drives the SAME body directly through the session
//    (session.sketchNew/session.pocket), exactly the way
//    freecad-engine-adapter-build.test.mjs's own comment says a REAL pocket
//    always reaches an existing body, and hand-registers the resulting
//    FcBuiltFeature/doc-feature pair the same shape build() itself would
//    have produced -- proving querySketchGeometry()'s geometric matching
//    against the pocket's own CURRENT (reordered) Shape.Faces, without
//    needing pocket's own body-targeting gap fixed first.
// ---------------------------------------------------------------------------
console.log('\n--- pad + pocket: untouched walls still name on the pocket\'s current shape ---');
const chainDoc = {
  version: 1,
  features: [
    { id: 'sk3', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 30], [0, 30]] },
    { id: 'e3', kind: 'extrude', target: 'sk3', height: 20 },
  ],
};
const chainBuilt = adapter.build(chainDoc);
const padEntry = chainBuilt.shapes.get('e3');
checkTruthy('pad built', !!padEntry && !!padEntry.sweep);

const chainSession = adapter['session'];
// A pocket's cutting profile has to sit ON the solid it cuts, not float on
// a separate, unattached XY plane (a bare sketchNew()+sketchCircle() at
// world (20,15) built a profile that never actually touched the Pad, which
// is why the first version of this probe failed with "Linked shape object
// is empty" -- FreeCAD's own real usage, engine/bridge/pocket-test.mjs,
// attaches the cutting sketch to a FACE of the solid via sketchNewOnFace()
// instead, which this adapter's own build() 'pocket' branch does not wire
// up (see this section's own header) but the bridge itself supports.
const topFaceName = `Face${padEntry.sweep.topFaceIndex + 1}`;
chainSession.sketchNewOnFace(padEntry.bodyName, 'sk4_manual', padEntry.objName, topFaceName);
chainSession.sketchAddCircle('sk4_manual', 20, 15, 5);
// session.pocket()'s own emitter (fc-commands.mjs) hardcodes Reversed=True,
// measured correct for the ONLY case FreeCadEngineAdapter.build() actually
// produces -- a BARE, unattached XY sketch (translateSketch() never calls
// sketchNewOnFace). Measured HERE, separately, that Reversed=True is a
// silent NO-OP on a FACE-attached sketch instead (vol stayed exactly
// 24000, not 23371.68) -- the attached sketch's local +Z sense runs the
// opposite way for this direction property. This is a genuine, narrower
// finding than a bug in shipped code: the real adapter never builds a
// face-attached pocket today (that would need sketchNewOnFace wired into
// the 'pocket' build() branch, real unscheduled design work, not part of
// this phase), so this convention difference has no shipped consequence --
// named here rather than silently worked around, per this port's own
// report. Driven via raw exec() with Reversed=False instead of
// session.pocket() so this probe's own workaround does not misreport a
// pocket failure that has nothing to do with the naming work being tested.
const pocketObjName = 'p1_pocket';
{
  const py =
    `import FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `pk = doc.getObject(${JSON.stringify(padEntry.bodyName)}).newObject("PartDesign::Pocket", ${JSON.stringify(pocketObjName)})\n` +
    `pk.Profile = doc.getObject("sk4_manual")\n` +
    `pk.Length = 8\n` +
    `pk.Reversed = False\n` +
    `doc.recompute()\n`;
  const { rc, out } = chainSession.exec(py);
  checkTruthy('pocket exec rc == 0', rc === 0);
  if (rc !== 0) console.log('  pocket exec failed:', out);
}
const pocketEntry = {
  bodyName: padEntry.bodyName, objName: pocketObjName, kind: 'solid', featureId: 'p1', featureKind: 'pocket',
};
chainBuilt.shapes.set('p1', pocketEntry);
chainDoc.features.push({ id: 'p1', kind: 'pocket', target: 'sk4_manual_id', into: 'e3', depth: 8 });

let namedOnPocket = 0;
let unnamedNewFaces = 0;
const pocketMesh = chainSession.meshFaces(pocketEntry.objName);
for (const face of pocketMesh.faces) {
  const ref = { objName: pocketEntry.objName, name: `Face${face.id + 1}` };
  const name = adapter.nameFace(chainBuilt, chainDoc, 'p1', ref);
  if (name) {
    namedOnPocket++;
    checkTruthy(`face ${ref.name} rooted at the Pad e3, not the pocket`, name.feature === 'e3');
    const resolved = adapter.resolveFace(name, chainBuilt);
    checkTruthy(`face ${ref.name} resolveFace still finds a face (on the FROZEN Pad object, ordinal)`, !!resolved);
  } else {
    unnamedNewFaces++;
  }
}
console.log(`  ${namedOnPocket} named (carried from the Pad), ${unnamedNewFaces} unnamed (the pocket's own new geometry)`);
checkTruthy('at least some walls/caps still named on the pocket\'s current shape', namedOnPocket >= 4);
checkTruthy('at least some faces are the pocket\'s own new (unnamed) geometry', unnamedNewFaces >= 1);

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
