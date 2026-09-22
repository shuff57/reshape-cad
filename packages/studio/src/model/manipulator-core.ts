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
export const MANIPULATOR_KINDS = ['extrude', 'pocket', 'fillet', 'draft'] as const;
export type ManipulatorKind = (typeof MANIPULATOR_KINDS)[number];

/**
 * The parameter a manipulator drives for a selected feature, or null when
 * the feature has no manipulator. This is the CONVERGENCE point the
 * acceptance criteria name: the value box and the drag both end in this
 * exact generated-param name (`<featureId>_<slot>`), the same one
 * generatedParams() emits and applyParam() writes back, so neither path
 * can drift from the panel's slider.
 *
 * Phase 5.1 part 2 (todo 23) rides on top: DraftFeature.angle is the
 * confirmed angle-bearing parameter (ExtrudeFeature has no taper field --
 * verified at model-types.ts:591-604 during plan review), so a draft
 * manipulator gets a secondary TAPER ARC whose visibility is driven by
 * the feature's own parameter, never a global toggle.
 */
export function manipulatorParam(feature: Feature): { kind: ManipulatorKind; slot: string; param: string } | null {
  if (feature.kind === 'extrude') return { kind: 'extrude', slot: 'height', param: `${feature.id}_height` };
  if (feature.kind === 'pocket') return { kind: 'pocket', slot: 'depth', param: `${feature.id}_depth` };
  if (feature.kind === 'fillet') return { kind: 'fillet', slot: 'size', param: `${feature.id}_size` };
  if (feature.kind === 'draft') return { kind: 'draft', slot: 'angle', param: `${feature.id}_angle` };
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
  if (f.kind === 'draft' && slot === 'angle') return f.angle;
  return null;
}

/**
 * Does THIS feature carry a taper/angle parameter? The todo's visibility
 * rule verbatim: the arc handle's presence is driven by the feature's own
 * parameter schema, not a global toggle -- a draft has one, a fillet does
 * not, and nothing else in Phase 5.1's set does.
 */
export function hasAngleParam(feature: Feature): boolean {
  return feature.kind === 'draft';
}

/**
 * Why this typed text cannot drive a TAPER ANGLE, in a sentence, or null
 * when it can. Degrees: |angle| < 90 (89.9 is a near-parallel wall; 90
 * exactly is degenerate), and 0 is ALLOWED -- the kernel treats a 0-degree
 * draft as identity, and "remove the taper" is a real thing a student
 * types. Same write-nothing discipline as the extent error above.
 */
export function angleValueError(text: string): string | null {
  const t = String(text ?? '').trim();
  if (!t) return 'type an angle in degrees -- an empty box sets nothing';
  const v = Number(t);
  if (!Number.isFinite(v)) return `"${t}" is not a number`;
  if (Math.abs(v) >= 90) return `an angle of ${t} degrees would fold the wall over -- keep it under 90`;
  return null;
}

/**
 * Screen points along a taper ARC at an anchor: the arc of radius `r` px
 * centred on (cx,cy) from angle `fromDeg` to `toDeg` (SVG degrees, y-down,
 * the same convention MarkingMenu's wedges already use). Pure arithmetic
 * beside the SVG that draws it; the caller picks r and the sweep so the
 * arc sits beside the arrow instead of over the value box.
 */
export function arcPoints(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, samples = 24): string {
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = fromDeg + ((toDeg - fromDeg) * i) / samples;
    const rad = (t * Math.PI) / 180;
    pts.push(`${cx + r * Math.cos(rad)},${cy + r * Math.sin(rad)}`);
  }
  return pts.join(' ');
}

/**
 * The live-preview tint (todo 25) for a feature kind: 'add' renders
 * blue, 'cut' renders red -- SPEC-mouse-parity.md Phase 5.3's colour
 * convention verbatim. Fillet rounds a corner (additive, it fills the
 * corner with material); draft tilts a wall (the wall leans, the
 * silhouette changes) -- the honest colour for "the shape you see is not
 * committed yet" is the ADD one for both. Null for kinds with no
 * preview claim.
 */
export function previewTint(kind: Feature['kind']): 'add' | 'cut' | null {
  if (kind === 'extrude' || kind === 'fillet' || kind === 'draft') return 'add';
  if (kind === 'pocket') return 'cut';
  return null;
}