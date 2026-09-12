#!/usr/bin/env node
// Real-kernel verification for resolveFace/resolveEdge/nameFace/nameEdge/
// faceSize/edgeLength (this port's picking phase) -- the part
// freecad-engine-adapter-pick.test.mjs's fake session cannot prove: that the
// Python this file generates actually runs against a live FreeCAD document
// and returns geometry that round-trips through the real GCS/BRep kernel,
// not just a plausible-looking canned response.
//
// USAGE (same convention as freecad-vs-occt.manual.mjs):
//   npm run build   (first, so dist/ is current)
//   node packages/kernel/test/freecad-picking.manual.mjs <pathToFreeCADCmd.js>
// Run inside fc-kernel-pd-final (or equivalent) with the repo mounted at
// exactly /mnt/host/c/Users/.../reshape-cad -- see this port's own report
// (SPEC-engine-port.md §6.3) for why that exact mount path matters.

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
  console.error('usage: node freecad-picking.manual.mjs <pathToFreeCADCmd.js>');
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

// ---------------------------------------------------------------------------
// 1. A plain box: every face names, and every name round-trips through
//    resolveFace back to a face that measures the same size.
// ---------------------------------------------------------------------------
console.log('\n--- box: every face names and round-trips ---');
const boxDoc = { version: 1, features: [{ id: 'box1', kind: 'box', size: [40, 30, 20], center: [0, 0, 0] }] };
const boxBuilt = adapter.build(boxDoc);
const boxShape = boxBuilt.shapes.get('box1');

const expectedSize = { '+z': [30, 40], '-z': [30, 40], '+x': [20, 30], '-x': [20, 30], '+y': [20, 40], '-y': [20, 40] };
let namedCount = 0;
for (let i = 0; i < 6; i += 1) {
  const ref = adapter.faceAt(boxShape, i);
  checkTruthy(`faceAt(${i}) returns a ref`, ref && ref.objName && ref.name);
  const name = adapter.nameFace(boxBuilt, boxDoc, 'box1', ref);
  if (!name) { console.log(`  face ${i} (${ref.name}) did not name -- unexpected on a fresh box`); continue; }
  namedCount += 1;
  check(`face ${i} (${ref.name}) name.feature`, name.feature, 'box1');
  checkTruthy(`face ${i} (${ref.name}) part '${name.part}' is a real box part`, ['+x', '-x', '+y', '-y', '+z', '-z'].includes(name.part));

  const resolved = adapter.resolveFace(name, boxBuilt);
  checkTruthy(`resolveFace(${JSON.stringify(name)}) round-trips to a ref`, resolved && resolved.name);
  check(`resolveFace round-trip lands on the SAME face`, resolved && resolved.name, ref.name);

  const size = adapter.faceSize(ref);
  checkTruthy(`faceSize(${ref.name}) returns [w,d]`, Array.isArray(size) && size.length === 2);
  if (size) {
    const want = expectedSize[name.part];
    check(`faceSize(${ref.name}) matches box dims for part ${name.part}`, JSON.stringify([...size].sort()), JSON.stringify([...want].sort()));
  }
}
check('all 6 box faces named', namedCount, 6);

// ---------------------------------------------------------------------------
// 2. Every edge names as `between` two primitive faces, and round-trips.
// ---------------------------------------------------------------------------
console.log('\n--- box: edges name and round-trip ---');
// adapter.edges() needs a real THREE (constructor-injected, per this
// adapter's own header) to build line geometry -- this script injects `{}`
// for THREE (same convention freecad-vs-occt.manual.mjs uses) since it never
// draws anything, so edge refs are built directly here instead, the same
// {objName, name} shape edges() itself produces.
const rawMesh = session.meshFaces(boxShape.objName);
const edgeRefs = rawMesh.edges.map((e) => ({ edge: { objName: boxShape.objName, name: `Edge${e.id + 1}` } }));
check('box has 12 edges', edgeRefs.length, 12);
let namedEdges = 0;
for (const { edge } of edgeRefs) {
  const name = adapter.nameEdge(boxBuilt, boxDoc, 'box1', edge);
  if (!name) continue;
  namedEdges += 1;
  check(`edge ${edge.name} name.cause`, name.cause, 'between');
  const resolved = adapter.resolveEdge(name, boxBuilt);
  checkTruthy(`resolveEdge(${edge.name}) round-trips to a ref`, resolved && resolved.name);
  const length = adapter.edgeLength(edge);
  checkTruthy(`edgeLength(${edge.name}) returns a positive number`, typeof length === 'number' && length > 0);
}
check('all 12 box edges named (every edge of a plain box is between two primitive faces)', namedEdges, 12);

// ---------------------------------------------------------------------------
// 3. A box + fillet: the ROUNDED edge's own faces still name via the
//    primitive resolver where untouched, and the fillet's own new face does
//    NOT get a false primitive name (the "no answer over a wrong one" bar).
// ---------------------------------------------------------------------------
console.log('\n--- box + fillet: untouched faces still name against the CURRENT (post-fillet) shape ---');
const filletDoc = {
  version: 1,
  features: [
    { id: 'box2', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    {
      id: 'r1', kind: 'fillet', target: 'box2', size: 5, style: 'fillet',
      edge: {
        cause: 'between', feature: 'box2', kind: 'edge',
        of: [
          { cause: 'primitive', feature: 'box2', kind: 'face', part: '+x' },
          { cause: 'primitive', feature: 'box2', kind: 'face', part: '+z' },
        ],
      },
    },
  ],
};
const filletBuilt = adapter.build(filletDoc);
checkTruthy('fillet built with no refusal', !filletBuilt.refusals || !filletBuilt.refusals.get('r1'));
const filletShape = filletBuilt.shapes.get('r1');

let filletNamedCount = 0;
let filletUnnamedCount = 0;
const filletFaceRefs = [];
for (let i = 0; i < 8; i += 1) {
  const ref = adapter.faceAt(filletShape, i);
  filletFaceRefs.push(ref);
  const name = adapter.nameFace(filletBuilt, filletDoc, 'r1', ref);
  if (name) {
    filletNamedCount += 1;
    check(`filleted-solid face ${ref.name} names rooted at the BOX, not the fillet`, name.feature, 'box2');
  } else {
    filletUnnamedCount += 1;
  }
}
checkTruthy('at least 4 of the filleted box\'s flat faces still name (only +x/+z\'s corner is touched)', filletNamedCount >= 4);
checkTruthy('at least one face (the round\'s own new curved surface) is an honest null, not a guess', filletUnnamedCount >= 1);

// ---------------------------------------------------------------------------
// 4. Regression check for the box/cylinder double-translation fix
//    (SPEC-engine-port.md §6.1a): resolvePrimitiveEdgeName()/
//    queryPrimitiveGeometry() compute their own direction-scoring reference
//    frame from the shape's CURRENT BoundBox on every call, never from a
//    stored f.center, so moving box/cylinder's sketch geometry to local
//    (0,0) should not change anything here. Confirmed live, not assumed --
//    every case above already used center [0,0,0], which cannot tell the
//    old (buggy) and new (fixed) behavior apart.
// ---------------------------------------------------------------------------
console.log('\n--- off-origin box/cylinder: picking unaffected by the double-translation fix ---');
const offOriginBoxDoc = { version: 1, features: [{ id: 'box3', kind: 'box', size: [20, 30, 40], center: [30, 20, 5] }] };
const offOriginBoxBuilt = adapter.build(offOriginBoxDoc);
for (const part of ['+x', '-x', '+y', '-y', '+z', '-z']) {
  const ref = adapter.resolveFace({ cause: 'primitive', feature: 'box3', kind: 'face', part }, offOriginBoxBuilt);
  checkTruthy(`off-origin box resolveFace('${part}')`, !!ref);
}
const offOriginEdgeName = {
  cause: 'between',
  of: [
    { cause: 'primitive', feature: 'box3', kind: 'face', part: '+x' },
    { cause: 'primitive', feature: 'box3', kind: 'face', part: '+z' },
  ],
};
const offOriginEdgeRef = adapter.resolveEdge(offOriginEdgeName, offOriginBoxBuilt);
checkTruthy('off-origin box resolveEdge(between +x/+z)', !!offOriginEdgeRef);
if (offOriginEdgeRef) {
  // +x face spans (y,z), +z face spans (x,y) -- their shared edge runs
  // along Y, so its length is the box's own d = 30.
  check('off-origin box edgeLength matches d=30', adapter.edgeLength(offOriginEdgeRef), 30);
}
const offOriginFilletDoc = {
  version: 1,
  features: [
    { id: 'box4', kind: 'box', size: [20, 30, 40], center: [30, 20, 5] },
    {
      id: 'f2',
      kind: 'fillet',
      style: 'fillet',
      target: 'box4',
      size: 2,
      edge: {
        cause: 'between',
        of: [
          { cause: 'primitive', feature: 'box4', kind: 'face', part: '+x' },
          { cause: 'primitive', feature: 'box4', kind: 'face', part: '+z' },
        ],
      },
    },
  ],
};
const offOriginFilletBuilt = adapter.build(offOriginFilletDoc);
checkTruthy('fillet on off-origin box built with no refusal', !offOriginFilletBuilt.refusals || !offOriginFilletBuilt.refusals.get('f2'));

const offOriginCylDoc = { version: 1, features: [{ id: 'cyl1', kind: 'cylinder', radius: 5, height: 10, center: [30, 20, 5] }] };
const offOriginCylBuilt = adapter.build(offOriginCylDoc);
for (const part of ['+z', '-z', 'side']) {
  const ref = adapter.resolveFace({ cause: 'primitive', feature: 'cyl1', kind: 'face', part }, offOriginCylBuilt);
  checkTruthy(`off-origin cylinder resolveFace('${part}')`, !!ref);
}
const offOriginCylEdgeRef = adapter.resolveEdge({
  cause: 'between',
  of: [
    { cause: 'primitive', feature: 'cyl1', kind: 'face', part: 'side' },
    { cause: 'primitive', feature: 'cyl1', kind: 'face', part: '+z' },
  ],
}, offOriginCylBuilt);
checkTruthy('off-origin cylinder resolveEdge(between side/+z)', !!offOriginCylEdgeRef);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
