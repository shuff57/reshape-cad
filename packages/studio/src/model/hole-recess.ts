// 2026-10-01 (Track A slice A2, second half): giving an existing hole a recess.
//
// This is a PURE module on purpose. ModelEditor.tsx is a component with no test
// harness -- node --test can only grep its source text (see
// test/marking-menu.test.mjs:227, which says so and works around it). So the
// decision logic lives here, where it can be tested for real, and ModelEditor
// calls it as a thin arrow. That matches the studio's rule that pure modules stay
// pure so they are testable under node --test, and the ContextActions rule that
// each verb IS the same closure the ribbon button calls -- no second
// implementation of any verb.
//
// Slice A1 gave the language `counterbore: { across, deep }` and
// `countersink: { across, angle }`, and generatedParams (59d054b) made them
// visible and editable once they exist. What was missing is the way to CREATE
// one: a student working in the Build toolbar never types script, and the hole
// flyout's main action drills a NEW hole, so a "Counterbore" item there would
// fire on the wrong target. The precedent for a verb that mutates the already
// selected feature is `round` (ModelEditor.tsx:876), not the flyout.

/** The two recess kinds the model defines. Mutually exclusive: one mouth, one
 *  shape (SPEC-brep-feature-provenance 5.2b). */
export type RecessKind = 'counterbore' | 'countersink';

/** A hole feature, as narrowly as this module needs to read it. Structural so a
 *  missing or mistyped field is a type error rather than a silent `undefined`. */
export interface HoleLike {
  kind: string;
  id: string;
  diameter: number;
  depth: number;
  counterbore?: { diameter: number; depth: number };
  countersink?: { diameter: number; angleDeg: number };
}

/** Why this feature cannot take a recess, or null if it can. */
export function whyCannotRecess(f: { kind: string } | null | undefined): string | null {
  if (!f) return 'Pick a hole first.';
  if (f.kind !== 'hole') return 'A recess is cut at a hole’s mouth, so pick a hole.';
  return null;
}

/** The starting numbers for `kind` on `hole`.
 *
 *  Defaults are chosen so the result BUILDS. A recess that is degenerate (wider
 *  than its bore, or deeper than it) is a kernel refusal by the split pinned in
 *  slice A1 -- not a clamp -- so a default that refuses would greet a student with
 *  an error for clicking a button. `across` doubles the bore, which is the
 *  convention every measured case in this project uses (d6 bore with a d12 recess,
 *  in the spec, in the parity fixtures and in the countersink spike).
 */
export function recessDefaults(hole: HoleLike, kind: RecessKind) {
  const across = hole.diameter * 2;
  if (kind === 'countersink') return { diameter: across, angleDeg: 90 };
  // Deep, but never deeper than the bore: a counterbore reaches from the mouth
  // inward, so its depth must leave bore behind it.
  return { diameter: across, depth: Math.max(0.5, Math.min(6, hole.depth / 2)) };
}

/** `hole` with `kind` set. Applying the kind a hole already has REMOVES the
 *  recess rather than setting it again -- one click adds, the same click takes
 *  it back off, which is the usual behaviour for a detail button and is the only
 *  remove path the Build toolbar would otherwise have. Switching kind drops the
 *  other one, because the model says they are mutually exclusive and leaving both
 *  set would produce a doc the kernel refuses.
 *
 *  Every click moves something, so there is no no-op to skip.
 */
export function withRecess<T extends HoleLike>(hole: T, kind: RecessKind): T {
  const already = kind === 'counterbore'
    ? hole.counterbore !== undefined
    : hole.countersink !== undefined;
  const other = kind === 'counterbore' ? 'countersink' : 'counterbore';
  const dropOther = kind === 'counterbore'
    ? hole.countersink !== undefined
    : hole.counterbore !== undefined;

  if (already && !dropOther) {
    // Same click on a hole that already has it: take it off. The key to delete is
    // `kind` ITSELF. Deleting `other` here deleted the kind that was not set, so the
    // recess survived and the click did nothing -- a button that looks like it
    // toggles and does not.
    const out = { ...hole } as T & Record<string, unknown>;
    delete out[kind];
    return out as T;
  }

  const defaults = recessDefaults(hole, kind) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...hole, [kind]: defaults };
  delete out[other];
  return out as T;
}
