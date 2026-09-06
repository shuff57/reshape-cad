// A beginner-facing number display, used only for what a Dimensions-panel
// text box SHOWS when nothing is being typed into it right now -- see
// ReshapeParamsPanel.tsx's own comment on why `text` (full precision, used
// for parsed/settle/arrow-key math) and this are deliberately two different
// strings. The stored value, the slider, and a value the student actually
// typed all keep full float precision; only the resting display is cleaned
// up.
//
// WHY THIS EXISTS. A sketch corner moved by the least-squares solver settles
// at whatever float the solve landed on -- "39.99999630790447", not "40" --
// and the panel used to print that raw. Measured 2026-09-04: "Sketch 1
// corner 1 across" read "-0.00000369064424204246".

/**
 * Round to two decimal places for display, trimming trailing zeros
 * (40.00 -> "40", 22.50 -> "22.5") and never printing a negative zero
 * (rounding a tiny negative float that is really zero must not read as
 * "-0", which looks like a real, different number to a beginner).
 */
export function displayNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Number(n.toFixed(2));
  return String(rounded === 0 ? 0 : rounded);
}
