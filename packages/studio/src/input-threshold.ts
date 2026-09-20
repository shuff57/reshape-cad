// Shared timing/pixel thresholds for viewport HOLD gestures (SPEC-mouse-
// parity.md Phase 3.5's click-and-hold "select other" cycling is the first
// consumer; Wave 3's marking-menu gesture and right-click guard import this
// same module rather than each declaring their own magic numbers).
//
// [CONFIRM behaviour] split, per `.omo/plans/mouse-parity-handover.md`'s
// "[CONFIRM] defaults taken" section: the NUMBERS below (300ms / 4px) are an
// owner-approved default already on record in that handover file, settled
// and not something this module invented or is re-guessing. What is NOT yet
// verified against real Fusion 360 is the qualitative claim that prompted a
// hold gesture to exist at all -- "Fusion cycles nearest-to-farthest" on a
// click-and-hold over stacked/occluded geometry. Do not treat that behavior
// claim as settled just because the numbers next to it are.

/** Milliseconds a pointer must stay within `HOLD_CYCLE_DEAD_ZONE_PX` after
 *  pointerdown before a hold gesture (as opposed to a plain click) fires. */
export const HOLD_CYCLE_DELAY_MS = 300;

/** CSS pixels of pointer movement from pointerdown that still counts as
 *  "stationary" for a hold gesture -- exceeding this before the delay
 *  elapses cancels the hold and lets the gesture continue as a normal
 *  click/drag (e.g. camera orbit) instead. */
export const HOLD_CYCLE_DEAD_ZONE_PX = 4;
