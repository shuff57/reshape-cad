// Step 8's self-check, the part that needs no live FreeCAD kernel: does
// FreeCadEngineAdapter.mesh() convert session.meshFaces()'s per-face JSON
// into a THREE.BufferGeometry + FaceRange[] correctly -- matching
// occt-three.ts's tessellateToThree() shape, per-face vertex offsetting and
// all. The session here is a FAKE returning synthetic, hand-computed
// per-face triangulations (a unit cube, two triangles per face), so the
// "known-good" answer (36 vertices, 36 indices, volume 1) is arithmetic,
// not something read off a real kernel run.
//
// Against ../dist/ -- TypeScript source, same convention as
// packages/sketch/test/sketch-solve.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FreeCadEngineAdapter } from '../dist/freecad-engine-adapter.js';

/** A unit cube [0,1]^3, six faces, two triangles each, vertices NOT shared
 *  across faces (matching FreeCAD's own per-face tessellate(), which meshes
 *  each Part.Face independently -- see fc-session.mjs's meshFaces() comment). */
function unitCubeMeshFacesJson() {
  // Each quad's 4 points are ordered so its fan triangulation ([0,1,2,0,2,3])
  // winds CCW as seen from OUTSIDE the cube -- verified by hand via
  // cross(P1-P0, P2-P0) for every face, so the volume computed from the
  // converted geometry below has a known, exact sign and magnitude (+1),
  // not merely a plausible one.
  const facesDef = [
    { normal: '-z', pts: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
    { normal: '+z', pts: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { normal: '-y', pts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { normal: '+y', pts: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
    { normal: '-x', pts: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { normal: '+x', pts: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  ];
  const faces = facesDef.map((f, id) => ({
    id,
    positions: f.pts.flat(),
    indices: [0, 1, 2, 0, 2, 3],
  }));
  return { object: 'Pad', faces, edges: [], volume: 1 };
}

/** Builds an adapter with its private `session` field set directly to a
 *  fake session, bypassing load() entirely -- these tests exercise mesh()'s
 *  pure data-transformation logic, not the real load-then-open-document
 *  sequence (which needs a real Emscripten Module and is covered instead by
 *  this port's kernel-dependent fixtures; see this port's own report on why
 *  those could not be run in this environment). */
function makeAdapter(meshFacesResult) {
  const adapter = new FreeCadEngineAdapter(THREE, async () => ({}));
  adapter['session'] = { meshFaces: () => meshFacesResult };
  return adapter;
}

test('mesh() converts meshFaces() JSON into an indexed BufferGeometry matching triangle count and bbox', () => {
  const raw = unitCubeMeshFacesJson();
  const adapter = makeAdapter(raw);

  const result = adapter.mesh({ objName: 'Pad', kind: 'solid', bodyName: 'Body1', featureId: 'box1', featureKind: 'box' });
  assert.ok(result, 'mesh() must return a geometry for a non-empty meshFaces() result');

  const { geometry, faces } = result;
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');

  assert.equal(position.count, 24, '4 verts x 6 faces, unshared across faces');
  assert.equal(index.count, 36, '2 triangles x 3 indices x 6 faces');
  assert.equal(faces.length, 6);
  faces.forEach((f, i) => assert.equal(f.index, i, 'FaceRange.index matches meshFaces() own face id'));

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  assert.ok(Math.abs(bb.min.x - 0) < 1e-9 && Math.abs(bb.max.x - 1) < 1e-9, 'bbox X spans [0,1]');
  assert.ok(Math.abs(bb.min.y - 0) < 1e-9 && Math.abs(bb.max.y - 1) < 1e-9, 'bbox Y spans [0,1]');
  assert.ok(Math.abs(bb.min.z - 0) < 1e-9 && Math.abs(bb.max.z - 1) < 1e-9, 'bbox Z spans [0,1]');

  // Manually computed volume from the SAME converted geometry, via the
  // signed-tetrahedron-sum formula occt-three.ts's own signedVolume() uses,
  // to prove the conversion (not just the raw JSON) carries a correct,
  // consistently-wound mesh -- the bar this step's own self-check sets:
  // "the converted geometry match what session.mesh()'s own volume ...
  // reports for the same shape" (raw.volume === 1 here).
  let vol = 0;
  const pos = geometry.getAttribute('position');
  const idx = geometry.getIndex();
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
    const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
    const bx = pos.getX(ib), by = pos.getY(ib), bz = pos.getZ(ib);
    const cx = pos.getX(ic), cy = pos.getY(ic), cz = pos.getZ(ic);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  assert.ok(Math.abs(Math.abs(vol) - raw.volume) < 1e-9, `converted geometry's signed volume (${vol}) must match meshFaces()'s reported volume (${raw.volume})`);
});

test('mesh() returns null for an empty meshFaces() result', () => {
  const adapter = makeAdapter({ faces: [], edges: [], empty: true });
  const result = adapter.mesh({ objName: 'Pad', kind: 'solid', bodyName: 'Body1', featureId: 'box1', featureKind: 'box' });
  assert.equal(result, null);
});

test('mesh() returns null for a sketch (non-solid) shape without calling the session', () => {
  let called = false;
  const adapter = new FreeCadEngineAdapter(THREE, async () => ({}));
  adapter['session'] = { meshFaces: () => { called = true; return unitCubeMeshFacesJson(); } };
  const result = adapter.mesh({ objName: 'Sketch', kind: 'sketch', bodyName: 'Body1', featureId: 'sk1', featureKind: 'sketch' });
  assert.equal(result, null);
  assert.equal(called, false, 'a sketch is never meshed');
});

test('faceAt()/edges() follow FreeCAD\'s own Face{n+1}/Edge{n+1} sub-element convention, tagged with their owning object', () => {
  const raw = unitCubeMeshFacesJson();
  raw.edges = [{ id: 0, points: [0, 0, 0, 1, 0, 0] }, { id: 1, points: [1, 0, 0, 1, 1, 0] }];
  const adapter = makeAdapter(raw);
  const shape = { objName: 'Pad', kind: 'solid', bodyName: 'Body1', featureId: 'box1', featureKind: 'box' };

  // faceAt()/edges() return an FcElementRef ({objName, name}), not a bare
  // name string -- a bare "Face3" is ambiguous the moment more than one
  // FreeCAD object exists, which is always true past the first feature, and
  // faceSize()/edgeLength()/nameFace()/nameEdge() all need to know WHICH
  // object's Shape to query. See freecad-engine-adapter.ts's own header.
  assert.deepEqual(adapter.faceAt(shape, 0), { objName: 'Pad', name: 'Face1' });
  assert.deepEqual(adapter.faceAt(shape, 5), { objName: 'Pad', name: 'Face6' });
  assert.equal(adapter.faceAt(shape, -1), null);

  const edges = adapter.edges(shape);
  assert.equal(edges.length, 2);
  assert.deepEqual(edges[0].edge, { objName: 'Pad', name: 'Edge1' });
  assert.deepEqual(edges[1].edge, { objName: 'Pad', name: 'Edge2' });
  assert.equal(edges[0].geometry.getAttribute('position').count, 2);
});
