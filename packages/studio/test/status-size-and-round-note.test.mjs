// Two browser-walk bugs. (1) The status bar read a 40x40x20 box as
// 41.5x41.5x21.5: Box3.setFromObject counts the invisible edge-highlight
// tubes. (2) A plain single-edge click then Round said "fillet: ignoring 1
// feature -- edges only": the owner's feature item rides along every pick.
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { solidBounds } from '../dist/pick-helpers.js';
import { mixedSelectionNote } from '../dist/selection-model.js';

function boxWithTubes() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 20));
  group.add(mesh);
  // one fat highlight tube hugging an edge, as drawGeoms() builds them
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 40));
  tube.position.set(20, 20, 0);
  tube.visible = false;
  mesh.add(tube);
  return { group, tube };
}

test('1: setFromObject is inflated by an edge tube (the bug), solidBounds is not', () => {
  const { group, tube } = boxWithTubes();
  tube.userData.excludeFromBounds = true;
  const fat = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  assert.ok(fat.x > 40.5, 'premise: three counts the invisible tube');
  const s = solidBounds(group, () => new THREE.Box3()).getSize(new THREE.Vector3());
  assert.deepEqual([s.x, s.y, s.z].map((n) => Math.round(n * 1000) / 1000), [40, 40, 20]);
});

test('2: solidBounds honours the parent transform and an empty group is empty', () => {
  const { group, tube } = boxWithTubes();
  tube.userData.excludeFromBounds = true;
  group.position.set(100, 0, 0);
  const b = solidBounds(group, () => new THREE.Box3());
  assert.equal(Math.round(b.min.x), 80);
  assert.equal(Math.round(b.max.x), 120);
  assert.equal(solidBounds(new THREE.Group(), () => new THREE.Box3()).isEmpty(), true);
});

test('3: the viewport flags its highlight tubes and measures with solidBounds', () => {
  const src = fs.readFileSync(new URL('../src/model/BrepViewportThree.tsx', import.meta.url), 'utf8');
  assert.match(src, /tube\.userData\.excludeFromBounds = true/);
  assert.ok(!/setFromObject\(group\)/.test(src), 'no raw setFromObject over the solid group');
});

const edge = { kind: 'edge', target: 'box1', name: null };

test('4: a plain edge click ([edge, owner feature]) produces no note', () => {
  assert.equal(mixedSelectionNote([edge, { kind: 'feature', target: 'box1' }]), null);
  assert.equal(mixedSelectionNote([edge]), null);
});

test('5: a genuinely mixed selection still says what was ignored', () => {
  assert.equal(
    mixedSelectionNote([edge, { kind: 'feature', target: 'box1' }, { kind: 'face', target: 'box1', name: null }]),
    'fillet: ignoring 1 face — edges only',
  );
  assert.match(
    mixedSelectionNote([edge, { kind: 'face', target: 'b' }, { kind: 'face', target: 'b' }, { kind: 'vertex', target: 'b' }]),
    /2 faces, 1 vertex/,
  );
});
