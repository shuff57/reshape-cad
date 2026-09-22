// Pure guard for todo 20 (SPEC-mouse-parity.md Phase 4.3: "Right-click must
// not break pan/orbit. Distinguish a click (menu) from a drag by movement
// threshold; right-drag should remain available if the mouse preset uses
// it."). Splits the right-button press's outcome by the active scheme's own
// button map, so the marking menu and the camera never both react to the
// same gesture:
//   - a right-press that leaves the dead zone before release stays a camera
//     gesture (pan/orbit/dolly, whatever the scheme binds right to) -- no
//     menu, no wedge;
//   - a right-press that stays within the dead zone through its release
//     opens the marking menu IF the scheme's right button is a CAMERA
//     action (the click itself is a no-op there); if the scheme's right
//     button is NOT a camera action (a hypothetical menu-only preset), the
//     click still opens the menu;
//   - todo 19's fast directional wedge gesture rides the same release and
//     wins over the camera when the drag is fast enough (classifyGesture
//     already decided 'wedge' before this guard runs; this module only
//     decides what the NON-wedge outcomes do).
// Pure: scheme + samples in, verdict out, no DOM.

import type { PointerSample } from './marking-menu-core.js';

/** The right button's role in the active scheme, as camera-controls.ts's
 *  MOUSE_SCHEMES bind it (0/1/2 or absent). 'none' means the scheme binds
 *  no camera action to the right button at all. */
export type RightButtonRole = 'orbit' | 'pan' | 'dolly' | 'none';

/** Which slot camera-controls.ts's scheme map binds the right button to.
 *  Mirrors MOUSE_SCHEMES' own buttons ({ ORBIT, PAN, DOLLY } of 0/1/2) --
 *  read from the scheme's shape, not hardcoded, so a todo-29 preset change
 *  flows through automatically. */
export function rightButtonRole(scheme: { ORBIT: number; PAN: number; DOLLY: number }): RightButtonRole {
  if (scheme.ORBIT === 2) return 'orbit';
  if (scheme.PAN === 2) return 'pan';
  if (scheme.DOLLY === 2) return 'dolly';
  return 'none';
}

/** The guard's verdict for one right-button release. */
export type RightGuardVerdict = 'camera-gesture' | 'menu' | 'ignore';

/** Is this right-button release a menu click, a camera gesture, or
 *  irrelevant? The movement threshold is the SHARED hold-cycle dead zone
 *  (passed in), so a drag beyond it is a camera gesture and a release
 *  within it is a menu -- the same split classifyRightClick draws, plus the
 *  scheme-aware answer for "who owns the right button": the camera keeps
 *  every drag regardless of role; the menu opens only on the click-shaped
 *  release, and only when the release did not already fire a wedge (the
 *  caller checks classifyGesture's 'wedge' verdict BEFORE consulting this).
 *  `down === null` (no right pointerdown seen) always ignores. */
export function rightClickGuard(
  down: PointerSample | null,
  up: PointerSample,
  deadZonePx: number,
): RightGuardVerdict {
  if (down === null) return 'ignore';
  const dist = Math.hypot(up.x - down.x, up.y - down.y);
  return dist <= deadZonePx ? 'menu' : 'camera-gesture';
}
