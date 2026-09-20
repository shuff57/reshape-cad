/**
 * Orthographic camera mode + frustum sizing + localStorage persistence.
 * Pure numbers in/out so it is testable without a renderer.
 */

export enum CameraMode {
  PERSPECTIVE = 'perspective',
  ORTHOGRAPHIC = 'orthographic',
}

const STORAGE_KEY = 'reshape.cameraMode';

export function loadCameraMode(): CameraMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'perspective' || stored === 'orthographic') return stored as CameraMode;
  } catch { /* ignore */ }
  return CameraMode.PERSPECTIVE;
}

export function saveCameraMode(mode: CameraMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
}

/**
 * Compute orthographic frustum parameters from a perspective camera,
 * preserving the same visible area at the current target distance.
 */
export function orthoFrustumFromPerspective(
  perspCam: { fov: number; aspect: number; near: number; far: number },
  targetDistance: number
): { left: number; right: number; top: number; bottom: number; near: number; far: number } {
  const fovRad = (perspCam.fov * Math.PI) / 180;
  const halfHeight = Math.tan(fovRad / 2) * targetDistance;
  const halfWidth = halfHeight * perspCam.aspect;
  return {
    left: -halfWidth,
    right: halfWidth,
    top: halfHeight,
    bottom: -halfHeight,
    near: perspCam.near,
    far: perspCam.far,
  };
}

/**
 * Compute orthographic frustum parameters from any camera (perspective or ortho),
 * preserving the visible area at the target distance.
 */
export function orthoFrustumFromCamera(
  camera: { fov?: number; aspect?: number; left?: number; right?: number; top?: number; bottom?: number; near: number; far: number; zoom?: number },
  targetDistance: number,
  currentMode: CameraMode
): { left: number; right: number; top: number; bottom: number; near: number; far: number } {
  if (currentMode === CameraMode.ORTHOGRAPHIC && camera.left !== undefined && camera.right !== undefined && camera.top !== undefined && camera.bottom !== undefined) {
    // Already orthographic - preserve the current frustum
    return {
      left: camera.left,
      right: camera.right,
      top: camera.top,
      bottom: camera.bottom,
      near: camera.near,
      far: camera.far,
    };
  }
  // Perspective camera - compute equivalent ortho frustum
  const fov = camera.fov ?? 45;
  const aspect = camera.aspect ?? 1;
  const fovRad = (fov * Math.PI) / 180;
  const halfHeight = Math.tan(fovRad / 2) * targetDistance;
  const halfWidth = halfHeight * aspect;
  return {
    left: -halfWidth,
    right: halfWidth,
    top: halfHeight,
    bottom: -halfHeight,
    near: camera.near,
    far: camera.far,
  };
}
