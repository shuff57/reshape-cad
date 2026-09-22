// The 3D feature manipulator's pure half (SPEC-mouse-parity.md Phase 5.1):
// which feature kinds get an arrow + value box, what the arrow points
// along, and how a typed/dragged number converges on the SAME parameter
// the Dimensions panel edits. The overlay half lives in HandleOverlay.tsx;
// tests import from ../dist/model/manipulator-core.js (build first).
import type { Feature, ModelDoc } from '@shuff57/reshape-script/model-types';

/**
 * Which feature kinds the Phase 5.1 manipulator covers: the ones whose
 * handle already names a single positive-extent parameter — extrude
 * (height), pocket (depth), fillet (size). A box/cylinder already carries
 * its own size handles, so they stay untouched.
 */
export const MANIPULATOR_KINDS = ['extrude', 'pocket', 'fillet'] as const;
export type ManipulatorKind = (typeof MANIPULATOR_KINDS)[number];

/**
 * The parameter a manipulator drives for a selected feature, or null when
 * the feature has no manipulator. This is the CONVERGENCE point the
 * acceptance criteria name: the value box and the drag both end in this
 * exact generated-param name (`<featureId>_<slot>`), the same one
 * generatedParams() emits and applyParam() writes back, so neither path
 * can drift from the panel's slider.
 */
export function manipulatorParam(feature: Feature): { kind: ManipulatorKind; slot: string; param: string } | null {
  if (feature.kind === 'extrude') return { kind: 'extrude', slot: 'height', param: `${feature.id}_height` };
  if (feature.kind === 'pocket') return { kind: 'pocket', slot: 'depth', param: `${feature.id}_depth` };
  if (feature.kind === 'fillet') return { kind: 'fillet', slot: 'size', param: `${feature.id}_size` };
  return null;
}

/** A short student-facing label for the value box (matches the captions
 *  the Dimensions panel already uses for these slots). */
export function manipulatorLabel(slot: string): string {
  return slot === 'depth' ? 'deep' : slot;
}

/**
 * Why this typed text cannot drive the parameter, in a sentence, or null
 * when it can. Extrude/pocket heights may not be negative (a negative
 * extent is a different feature, not this one driven backwards); a fillet
 * radius must be strictly positive. Zero is refused for all three -- every
 * zero-extent solid is degenerate. Plain non-numeric text is refused too.
 * The caller shows the sentence and writes NOTHING: a refused value must
 * not grow the undo stack (the same discipline as the sketch dimension
 * flow's dimensionValueError).
 */
export function manipulatorValueError(kind: ManipulatorKind, text: string): string | null {
  const t = String(text ?? '').trim();
  if (!t) return 'type a number -- an empty box sets nothing';
  const v = Number(t);
  if (!Number.isFinite(v)) return `"${t}" is not a number`;
  if (v <= 0) return `a ${manipulatorLabel(kind)} of ${t} is not a shape -- give a positive number`;
  return null;
}

/**
 * Current committed value of the manipulator's parameter, read off the
 * doc itself -- never off a slider cache. Returns null when the doc has
 * drifted from the selection (feature deleted mid-flight).
 */
export function manipulatorValue(doc: ModelDoc, param: string): number | null {
  const cut = param.lastIndexOf('_');
  if (cut < 0) return null;
  const id = param.slice(0, cut);
  const slot = param.slice(cut + 1);
  const f = doc.features.find((x) => x.id === id);
  if (!f) return null;
  if (f.kind === 'extrude' && slot === 'height') return f.height;
  if (f.kind === 'pocket' && slot === 'depth') return f.depth;
  if (f.kind === 'fillet' && slot === 'size') return f.size;
  return null;
}