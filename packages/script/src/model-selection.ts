// Resolves a viewport pick back into the feature whose Dimensions rows should
// show for it. Split out of components/SandboxWorkspace.tsx so the resolution
// itself — not just the wiring around it — is unit-testable without a browser
// (see scripts/test-panel-selection.mjs).

import type { ModelDoc } from './model-types.js';
import { rootFeature, type TopoName } from './topo-name.js';

/** The two shapes a pick reaches `ownerOf` in.
 *
 *  `target` is the id of whichever top-level feature's OWN MESH BATCH the
 *  pick landed in (BrepViewportThree.tsx's `hit.mesh.userData.featureId` /
 *  `hit.line.userData.featureId`) — the feature currently at the TIP of the
 *  chain for that region, not necessarily the one that MADE it. Measured
 *  2026-09-03: after Box 1 then Hole 1, Box 1 stops drawing its own mesh (the
 *  Hole consumed it), so `target` reads "Hole 1" for every face on the shape,
 *  untouched box faces included — `target` alone cannot tell a plain box face
 *  from the hole's own wall.
 *
 *  The resolved TopoName from lib/topo-name.ts travels under TWO different
 *  field names depending on which object is in hand, and both reach this
 *  function at different call sites in components/SandboxWorkspace.tsx: the
 *  live pick straight from BrepViewportThree's `onPick` calls it `name`
 *  (ViewportPick's own shape); the `pickedFace`/`pickedEdge` state
 *  SandboxWorkspace mirrors it into calls it `face` or `edge` (so ModelEditor
 *  can tell which kind without a `kind` field). `PickName` below accepts
 *  either. A name DOES encode provenance: `rootFeature()` walks it back to
 *  the feature that actually produced that face — the primitive for an
 *  untouched primitive face, the hole for its own wall, the round for its own
 *  filleted face — so it is what `ownerOf` prefers whenever one is present.
 *  Absent (null/undefined) when the pick landed inside a rebuild's first
 *  frames and missed its name — see `unnamedFacePickRef`'s own comment in
 *  BrepViewportThree.tsx. */
export interface PickName {
  target: string;
  name?: TopoName | null;
  face?: TopoName | null;
  edge?: TopoName | null;
}

/**
 * The feature id the Dimensions panel should select for a pick.
 *
 * Prefers the pick's resolved name: `rootFeature(name)` is the feature that
 * actually MADE the picked face or edge (a primitive's own face, a hole's own
 * wall, a round's own filleted face — see PickName's own comment), which is
 * what "the feature that owns it" means to a student looking for that
 * feature's numbers. Falls back to `target` — the tip of the chain for that
 * mesh region — only when there is no name to resolve, or the name resolves
 * to a feature the doc no longer has.
 *
 * Returns `null` when NEITHER resolves against the current doc. That "no
 * longer has" case is not hypothetical: a pick event can still be in flight
 * (or a stale `pickedFace`/`pickedEdge` can still be held) the moment an
 * Undo, a rollback, or a structural edit removes the feature it pointed at —
 * the same staleness ModelEditor's own `selected` effect already prunes for
 * (see its "A selection can outlive its feature" comment). Returning `null`
 * here lets a caller leave the CURRENT selection alone instead of pointing it
 * at an id nothing in `doc.features` can produce rows for, which would
 * otherwise read as "This step has no numbers to adjust" for a step that
 * still very much exists.
 */
export function ownerOf(
  doc: ModelDoc,
  pick: PickName | null | undefined
): string | null {
  if (!pick) return null;
  const exists = (id: string) => doc.features.some((f) => f.id === id);

  const name: TopoName | null | undefined = pick.name ?? pick.face ?? pick.edge ?? null;
  if (name) {
    const made = rootFeature(name);
    if (exists(made)) return made;
  }

  return exists(pick.target) ? pick.target : null;
}
