/**
 * Window-zoom fit calculation + selection fit.
 * Pure numbers in/out so it is testable without a renderer -- no three.js
 * import (see camera-fit.ts, and packages/studio/AGENTS.md: three.js stays
 * dynamic-import-only inside BrepViewportThree.tsx's loadThree()).
 */

export type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function length(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}
function normalize(a: Vec3): Vec3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}
function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export interface WindowZoomFitResult {
  valid: boolean;
  target: Vec3;
  distance: number;
}

/**
 * Compute the camera target and distance to frame a screen-space rectangle
 * (the user's drag selection) in world space.
 */
export function computeWindowZoomFit(
  zoomRect: { x: number; y: number; width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
  camera: { position: Vec3; fov: number; near: number; far: number },
  target: Vec3,
  sceneBox: { min: Vec3; max: Vec3 } | null
): WindowZoomFitResult {
  const ndcMinX = (zoomRect.x / viewportWidth) * 2 - 1;
  const ndcMaxX = ((zoomRect.x + zoomRect.width) / viewportWidth) * 2 - 1;
  const ndcMinY = -((zoomRect.y + zoomRect.height) / viewportHeight) * 2 + 1;
  const ndcMaxY = -(zoomRect.y / viewportHeight) * 2 + 1;

  const direction = normalize(sub(camera.position, target));
  const right = normalize(cross(direction, [0, 0, 1]));
  const up = normalize(cross(right, direction));

  const targetDist = distance(camera.position, target);
  const fovRad = (camera.fov * Math.PI) / 180;
  const aspect = viewportWidth / viewportHeight;
  const tanHalfFov = Math.tan(fovRad / 2);
  const halfHeight = tanHalfFov * targetDist;
  const halfWidth = halfHeight * aspect;

  const centerNdcX = (ndcMinX + ndcMaxX) / 2;
  const centerNdcY = (ndcMinY + ndcMaxY) / 2;
  const spanNdcX = (ndcMaxX - ndcMinX) / 2;
  const spanNdcY = (ndcMaxY - ndcMinY) / 2;

  let newTarget = addScaled(target, right, centerNdcX * halfWidth * 2);
  newTarget = addScaled(newTarget, up, centerNdcY * halfHeight * 2);

  // Distance so the selection's world-space span fills the frustum on
  // whichever axis needs it. Width scales with aspect (halfWidth = halfHeight
  // * aspect), so its required distance divides by aspect; height does not.
  const selectionWorldWidth = spanNdcX * halfWidth * 2;
  const selectionWorldHeight = spanNdcY * halfHeight * 2;
  const neededDistX = selectionWorldWidth / (2 * tanHalfFov * aspect);
  const neededDistY = selectionWorldHeight / (2 * tanHalfFov);
  const newDistance = Math.max(neededDistX, neededDistY, camera.near * 2);

  let clampedDistance = newDistance;
  if (sceneBox) {
    const boxSize = Math.max(
      sceneBox.max[0] - sceneBox.min[0],
      sceneBox.max[1] - sceneBox.min[1],
      sceneBox.max[2] - sceneBox.min[2]
    );
    clampedDistance = Math.min(clampedDistance, boxSize * 10);
    clampedDistance = Math.max(clampedDistance, boxSize * 0.01);
  }

  return {
    valid: zoomRect.width > 5 && zoomRect.height > 5,
    target: newTarget,
    distance: clampedDistance,
  };
}

/**
 * Compute camera target and distance to frame the current selection.
 */
export function computeSelectionFit(
  selectionBoxes: Array<{ min: Vec3; max: Vec3 }>,
  camera: { position: Vec3; fov: number; near: number; far: number },
  target: Vec3,
  viewportWidth: number,
  viewportHeight: number
): WindowZoomFitResult {
  if (selectionBoxes.length === 0) {
    return { valid: false, target, distance: distance(camera.position, target) };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const box of selectionBoxes) {
    minX = Math.min(minX, box.min[0]);
    minY = Math.min(minY, box.min[1]);
    minZ = Math.min(minZ, box.min[2]);
    maxX = Math.max(maxX, box.max[0]);
    maxY = Math.max(maxY, box.max[1]);
    maxZ = Math.max(maxZ, box.max[2]);
  }

  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];

  const boxSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const fovRad = (camera.fov * Math.PI) / 180;
  const halfHeight = Math.tan(fovRad / 2);
  const halfWidth = halfHeight * (viewportWidth / viewportHeight);
  const neededDistance = (boxSize / 2) / Math.min(halfWidth, halfHeight);

  return {
    valid: true,
    target: center,
    distance: Math.max(neededDistance, camera.near * 2),
  };
}
