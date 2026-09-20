// Pure math for the 2D sketch view: a state {cx, cy, pxPerMm} plus the zoom /
// pan / fit / transform arithmetic around it. Plain numbers in and out, no
// DOM, no three.js -- same shape as camera-fit.ts, so it is unit-testable
// under node --test (see test/sketch-view.test.mjs).
//
// WHY THIS EXISTS. SPEC-mouse-parity.md Phase 2 item 1: the sketch canvas
// today uses a fixed viewBox; this replaces it with a navigable view state.
// Wheel zoom keeps the world point under the cursor invariant (zoom-to-
// cursor, the same behaviour Phase 1 gave the 3D viewport), pan is in screen
// pixels, and SNAP_PX/HIT_PX stay in screen space -- converted to world
// units on demand via screenPxToWorld() so tolerances survive zoom.

import { bboxCenter, bboxLongestDimension, DEFAULT_FILL_FRACTION } from './camera-fit.js';

/** The 2D sketch view state: which world point (cx, cy) sits at the viewport
 *  centre, and how many screen pixels one millimetre of sketch spans. */
export interface SketchView {
  cx: number;
  cy: number;
  pxPerMm: number;
}

/** A 2D point or axis-aligned bbox, in sketch world units (mm). */
export interface Pt2Like {
  x: number;
  y: number;
}

export interface BBox2Like {
  min: [number, number];
  max: [number, number];
}

/** Viewport size in screen pixels. */
export interface SizePx {
  width: number;
  height: number;
}

/** Floor and ceiling for pxPerMm, so a runaway wheel cannot push the scale to
 *  zero (everything vanishes) or to Infinity (NaN in the transforms). */
export const MIN_PX_PER_MM = 1e-6;
export const MAX_PX_PER_MM = 1e6;

/** Clamp a scale into [MIN_PX_PER_MM, MAX_PX_PER_MM]. */
export function clampScale(pxPerMm: number): number {
  return Math.min(Math.max(pxPerMm, MIN_PX_PER_MM), MAX_PX_PER_MM);
}

/** Screen point -> world point for a view. Screen y grows downward, world y
 *  grows upward, hence the flip. */
export function screenToWorld(view: SketchView, pt: Pt2Like, size: SizePx): Pt2Like {
  return {
    x: view.cx + (pt.x - size.width / 2) / view.pxPerMm,
    y: view.cy - (pt.y - size.height / 2) / view.pxPerMm,
  };
}

/** World point -> screen point for a view (inverse of screenToWorld). */
export function worldToScreen(view: SketchView, pt: Pt2Like, size: SizePx): Pt2Like {
  return {
    x: size.width / 2 + (pt.x - view.cx) * view.pxPerMm,
    y: size.height / 2 - (pt.y - view.cy) * view.pxPerMm,
  };
}

/**
 * Wheel zoom about a cursor: multiply pxPerMm by `zoomFactor` (clamped), and
 * shift the centre so the world point under `cursorPx` before the zoom is
 * the same world point under it after. Derived by requiring
 * worldToScreen(post, w, size) == cursorPx for w = screenToWorld(pre, ...):
 * the centre must move by the cursor's offset from the viewport centre,
 * measured in the NEW scale.
 */
export function applyWheelZoom(
  view: SketchView,
  cursorPx: Pt2Like,
  size: SizePx,
  zoomFactor: number,
): SketchView {
  const pxPerMm = clampScale(view.pxPerMm * zoomFactor);
  return {
    cx: view.cx + (cursorPx.x - size.width / 2) * (1 / view.pxPerMm - 1 / pxPerMm),
    cy: view.cy - (cursorPx.y - size.height / 2) * (1 / view.pxPerMm - 1 / pxPerMm),
    pxPerMm,
  };
}

/** Pan by a screen-pixel drag (dx, dy). The view moves opposite to the
 *  drag: dragging right shows content further left. */
export function panByPx(view: SketchView, dxPx: number, dyPx: number): SketchView {
  return {
    cx: view.cx - dxPx / view.pxPerMm,
    cy: view.cy + dyPx / view.pxPerMm,
    pxPerMm: view.pxPerMm,
  };
}

/**
 * Fit a world bbox into the viewport: centre on the bbox centre, scale so
 * the bbox's longest dimension fills `DEFAULT_FILL_FRACTION` of the shorter
 * viewport side, then shrink that scale so `padPx` of margin survives on
 * every side. Reuses camera-fit's bbox helpers -- the same definitions of
 * "centre" and "longest" as the 3D Home view, not a second copy.
 *
 * A degenerate bbox (zero extent -- an empty sketch, or a single point) or
 * an unmeasurable viewport falls back to 1 px/mm centred on the bbox
 * centre, rather than a zero or infinite scale.
 */
export function fitView(bbox: BBox2Like, size: SizePx, padPx: number): SketchView {
  const center = bboxCenter({ min: [bbox.min[0], bbox.min[1], 0], max: [bbox.max[0], bbox.max[1], 0] });
  const longest = bboxLongestDimension({
    min: [bbox.min[0], bbox.min[1], 0],
    max: [bbox.max[0], bbox.max[1], 0],
  });
  if (!(longest > 0) || !(size.width > 0) || !(size.height > 0)) {
    return { cx: center[0], cy: center[1], pxPerMm: MIN_PX_PER_MM };
  }

  const fill = DEFAULT_FILL_FRACTION;
  const shorterSide = Math.min(size.width, size.height);
  const scale = (shorterSide * fill) / longest;
  // Shrink so the pad fits on every side: the content must occupy at most
  // (side - 2*pad) of each axis, relative to what it occupies now.
  const xRoom = Math.max(size.width - 2 * padPx, 1) / size.width;
  const yRoom = Math.max(size.height - 2 * padPx, 1) / size.height;
  const pxPerMm = clampScale(scale * Math.min(xRoom, yRoom));
  return { cx: center[0], cy: center[1], pxPerMm };
}

/** How many world units `px` screen pixels span in this view -- the screen
 *  -> world conversion for SNAP_PX/HIT_PX tolerances, which stay in screen
 *  space so they survive zoom. */
export function screenPxToWorld(px: number, view: SketchView): number {
  return px / view.pxPerMm;
}