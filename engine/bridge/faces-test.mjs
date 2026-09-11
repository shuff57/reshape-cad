// engine/bridge/faces-test.mjs
//
// Lead's gate for the Slice-2 selection keystone: meshFaces() must return one
// tessellated mesh per OCCT face and one polyline per edge, each tagged with a
// 0-based sub-element id, so a 3D pick can resolve to a real FreeCAD face/edge.
// Pad a 40x30x20 box (6 faces, 12 edges, vol 24000) and assert the structure.
//
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/faces-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession } from '../../packages/engine/src/fc-session.mjs';
import { loadNodeKernel } from '../../packages/engine/src/fc-session-node.mjs';
import { attachCommands } from '../../packages/engine/src/fc-commands.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachCommands(createFcSession(await loadNodeKernel(kernelJs)));

s.newDocument('faces');
s.newBody('Body');
s.sketchRect('Body', 'Sketch', 40, 30);
s.pad('Body', 'Sketch', 'Pad', 20);

const fm = s.meshFaces('Pad');
console.log(`faces=${fm.faces.length} edges=${fm.edges.length} vol=${fm.volume}`);
assert.equal(fm.faces.length, 6, 'a box has 6 faces');
assert.equal(fm.edges.length, 12, 'a box has 12 edges');
assert.ok(Math.abs(fm.volume - 24000) < 1, 'volume 40*30*20');

// every face is a non-empty mesh, ids are sequential 0..5
fm.faces.forEach((f, i) => {
  assert.equal(f.id, i, `face id ${i} sequential`);
  assert.ok(f.positions.length > 0 && f.positions.length % 3 === 0, `face ${i} has xyz positions`);
  assert.ok(f.indices.length > 0 && f.indices.length % 3 === 0, `face ${i} has triangles`);
  // every triangle index is in range of this face's own vertices
  const nv = f.positions.length / 3;
  assert.ok(Math.max(...f.indices) < nv, `face ${i} indices in range`);
});

// every edge is a polyline of >=2 points (straight box edges discretize to 2)
fm.edges.forEach((e, i) => {
  assert.equal(e.id, i, `edge id ${i} sequential`);
  assert.ok(e.points.length >= 6 && e.points.length % 3 === 0, `edge ${i} is a >=2-point polyline`);
});

// active-solid fallback (no name) resolves to the same solid
const fm2 = s.meshFaces();
assert.equal(fm2.faces.length, 6, 'active-solid meshFaces also finds 6 faces');

console.log('FACES:PASS');
process.exit(0);
