// cube-zone.ts's partition (SPEC-mouse-parity.md Phase 1.5, todo 28).
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUBE_ZONE_CELL,
  cubeZoneAt,
  cubeEdgeIds,
  cubeCornerIds,
  cubeZoneDirs,
} from '../dist/model/cube-zone.js';

const FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'];
const SIDE = 64;
const C = CUBE_ZONE_CELL;

test('all six face centres classify as face zones with their own id', () => {
  for (const face of FACES) {
    const z = cubeZoneAt(face, SIDE / 2, SIDE / 2, SIDE);
    assert.equal(z.kind, 'face', face);
    assert.equal(z.id, `face:${face}`);
  }
});

test('all 12 edges are distinct, non-overlapping hit zones', () => {
  const ids = cubeEdgeIds();
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12);
  // Every edge id is reachable from a face-plane click: sample each face's
  // four edge-band cells and confirm every hit's id lands in the set.
  const seen = new Set();
  for (const face of FACES) {
    for (const [px, py] of [[SIDE / 2, C / 2], [SIDE / 2, SIDE - C / 2], [C / 2, SIDE / 2], [SIDE - C / 2, SIDE / 2]]) {
      const z = cubeZoneAt(face, px, py, SIDE);
      assert.equal(z.kind, 'edge', `${face}@${px},${py}`);
      seen.add(z.id);
    }
  }
  assert.equal(seen.size, 12);
});

test('all 8 corners are distinct, non-overlapping hit zones', () => {
  const ids = cubeCornerIds();
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8);
  const seen = new Set();
  for (const face of FACES) {
    for (const [px, py] of [[C / 2, C / 2], [SIDE - C / 2, C / 2], [C / 2, SIDE - C / 2], [SIDE - C / 2, SIDE - C / 2]]) {
      const z = cubeZoneAt(face, px, py, SIDE);
      assert.equal(z.kind, 'corner', `${face}@${px},${py}`);
      seen.add(z.id);
    }
  }
  assert.equal(seen.size, 8);
});

test('face, edge and corner cells never overlap and cover the whole face', () => {
  let faceCells = 0;
  let edgeCells = 0;
  let cornerCells = 0;
  for (let px = 0; px < SIDE; px += 1) {
    for (let py = 0; py < SIDE; py += 1) {
      const z = cubeZoneAt('front', px + 0.5, py + 0.5, SIDE);
      if (z.kind === 'face') faceCells += 1;
      else if (z.kind === 'edge') edgeCells += 1;
      else if (z.kind === 'corner') cornerCells += 1;
      else assert.fail(`unclassified cell at ${px},${py}`);
    }
  }
  assert.equal(faceCells, (SIDE - 2 * C) ** 2);
  assert.equal(edgeCells, 4 * (SIDE - 2 * C) * C);
  assert.equal(cornerCells, 4 * C * C);
  assert.equal(faceCells + edgeCells + cornerCells, SIDE * SIDE);
});

test('out-of-plane points classify as none', () => {
  for (const [px, py] of [[-1, 10], [10, -1], [SIDE + 1, 10], [10, SIDE + 1]]) {
    assert.equal(cubeZoneAt('front', px, py, SIDE).kind, 'none');
  }
});

test('edge ids match their two faces and corner ids their three', () => {
  const frontTop = cubeZoneAt('front', SIDE / 2, C / 2, SIDE);
  assert.equal(frontTop.id, 'front|top');
  const topFront = cubeZoneAt('top', SIDE / 2, C / 2, SIDE);
  assert.equal(topFront.id, 'front|top'); // same cube edge from the other plane
  const frontRightTop = cubeZoneAt('front', SIDE - C / 2, C / 2, SIDE);
  assert.equal(frontRightTop.id, 'front|right|top');
  const rightTopFront = cubeZoneAt('right', C / 2, C / 2, SIDE);
  assert.equal(rightTopFront.id, 'front|right|top'); // same cube corner
});

test('cubeZoneDirs: edge dirs are the normalized two-face sums, corners the three-face sums', () => {
  const dirs = cubeZoneDirs({
    front: [0, 1, 0], back: [0, -1, 0], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 0, 1], bottom: [0, 0, -1],
  });
  const d = dirs['front|right'];
  assert.equal(d[2], 0);
  assert.equal(Math.round(d[0] * 1e6) / 1e6, Math.round(Math.SQRT1_2 * 1e6) / 1e6);
  assert.equal(Math.round(d[1] * 1e6) / 1e6, Math.round(Math.SQRT1_2 * 1e6) / 1e6);
  const c = dirs['front|right|top'];
  const t = 1 / Math.sqrt(3);
  for (const v of c) assert.equal(Math.round(v * 1e6) / 1e6, Math.round(t * 1e6) / 1e6);
  // All 20 zone dirs are unit length.
  const all = Object.values(dirs);
  assert.equal(all.length, 20);
  for (const [x, y, z] of all) assert.equal(Math.round(Math.hypot(x, y, z) * 1e6), 1e6);
});