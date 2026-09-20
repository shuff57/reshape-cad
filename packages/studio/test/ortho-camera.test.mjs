// ortho-camera.ts's frustum math + localStorage persistence.
// Imports from ../dist like every suite here; build first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CameraMode,
  loadCameraMode,
  saveCameraMode,
  orthoFrustumFromPerspective,
  orthoFrustumFromCamera,
} from '../dist/ortho-camera.js';

test('1: loadCameraMode falls back to perspective without localStorage', () => {
  const original = globalThis.localStorage;
  delete globalThis.localStorage;
  try {
    assert.equal(loadCameraMode(), CameraMode.PERSPECTIVE);
  } finally {
    if (original !== undefined) globalThis.localStorage = original;
  }
});

test('2: saveCameraMode + loadCameraMode round-trip through localStorage', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try {
    saveCameraMode(CameraMode.ORTHOGRAPHIC);
    assert.equal(loadCameraMode(), CameraMode.ORTHOGRAPHIC);
  } finally {
    delete globalThis.localStorage;
  }
});

test('3: orthoFrustumFromPerspective is symmetric about the origin', () => {
  const f = orthoFrustumFromPerspective({ fov: 90, aspect: 2, near: 0.1, far: 1000 }, 10);
  assert.equal(f.left, -f.right);
  assert.equal(f.bottom, -f.top);
  assert.equal(f.near, 0.1);
  assert.equal(f.far, 1000);
});

test('4: orthoFrustumFromPerspective widens with target distance', () => {
  const near = orthoFrustumFromPerspective({ fov: 60, aspect: 1, near: 0.1, far: 1000 }, 10);
  const far = orthoFrustumFromPerspective({ fov: 60, aspect: 1, near: 0.1, far: 1000 }, 100);
  assert.ok(far.right > near.right);
});

test('5: orthoFrustumFromPerspective scales width by aspect', () => {
  const f = orthoFrustumFromPerspective({ fov: 90, aspect: 2, near: 0.1, far: 1000 }, 10);
  assert.ok(Math.abs(f.right / f.top - 2) < 1e-9);
});

test('6: orthoFrustumFromCamera preserves an already-orthographic frustum', () => {
  const cam = { left: -5, right: 5, top: 3, bottom: -3, near: 0.1, far: 1000 };
  const f = orthoFrustumFromCamera(cam, 10, CameraMode.ORTHOGRAPHIC);
  assert.deepEqual(f, { left: -5, right: 5, top: 3, bottom: -3, near: 0.1, far: 1000 });
});

test('7: orthoFrustumFromCamera derives a frustum from a perspective camera', () => {
  const cam = { fov: 90, aspect: 2, near: 0.1, far: 1000 };
  const f = orthoFrustumFromCamera(cam, 10, CameraMode.PERSPECTIVE);
  assert.ok(f.right > 0);
  assert.equal(f.left, -f.right);
});
