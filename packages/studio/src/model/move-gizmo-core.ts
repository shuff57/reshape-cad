// Incremental Move's snap math (todo 24, SPEC-mouse-parity.md Phase 5.2 +
// the nav bar's "Adaptive vs Fixed grid"). Generalized from
// sketch-canvas-core.ts's findSnap grid case -- the optional Phase 2.3
// grid snap DID exist (its `gridStep` option), so this is that exact
// rounding generalized to three axes, not fresh math.
//
// ADAPTIVE vs FIXED, measured not invented: the sketch's own grid step is
// whatever the caller passes; here "adaptive" reads the model's own
// extent so the increment is always a sane fraction of the part (never
// 0.1mm steps on a 300mm part, never 50mm steps on a 12mm boss), and
// "fixed" is the student's own number. Pure: numbers in, numbers out --
// testable under node --test with no renderer.

/** One decimal-step ladder of "sane" increments, in world mm. Each step is
 *  1/2/5 x 10^n -- the ruler convention, so a snapped position reads as a
 *  round number a beginner can reproduce by typing. */
const STEP_LADDER = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

/**
 * The ADAPTIVE increment for a model whose longest extent is `extent` mm:
 * the largest ruler step whose ladder value keeps a full drag of `extent`
 * to at most ~20 stops. A 40mm part snaps in 2mm jumps; a 300mm part in
 * 20mm jumps. Degenerate (extent <= 0) falls back to 1mm -- a number, not
 * a NaN.
 */
export function adaptiveStep(extent: number): number {
  if (!(extent > 0)) return 1;
  // ~20 stops across the extent: step >= extent/20, from the ladder.
  for (const s of STEP_LADDER) {
    if (extent / s <= 20) return s;
  }
  return STEP_LADDER[STEP_LADDER.length - 1];
}

/**
 * Snap a world-space drag delta to the nearest increment, per mode.
 * `fixedStep <= 0` (or non-finite) means "no increment" -- the raw delta
 * passes through, which is what the toggle-off case must do, not 0.
 */
export function snapDelta(
  delta: [number, number, number],
  mode: 'adaptive' | 'fixed' | 'off',
  fixedStep: number,
  modelExtent: number,
): [number, number, number] {
  if (mode === 'off') return delta;
  const step = mode === 'fixed' ? fixedStep : adaptiveStep(modelExtent);
  if (!(step > 0) || !Number.isFinite(step)) return delta;
  return [
    Math.round(delta[0] / step) * step,
    Math.round(delta[1] / step) * step,
    Math.round(delta[2] / step) * step,
  ];
}
