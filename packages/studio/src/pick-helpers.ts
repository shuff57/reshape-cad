// Pure projection-selection math for viewport picking (SPEC-mouse-parity.md
// Phase 3 item 2: vertex + body picking). The IMPURE half -- projecting a
// mesh vertex to screen space through a live THREE.Camera -- has to stay in
// BrepViewportThree.tsx's hitAt(), the same way closestEdgeScreenDist()
// already does for edges; this is only the "given already-projected
// candidates, which one wins" decision, kept here so it is testable under
// node --test the same as camera-fit.ts.

/** A candidate already projected to screen space: how far it sits from the
 *  cursor in CSS pixels, and its depth (distance from the camera) for the
 *  occlusion check below. */
export interface ScreenCandidate {
  distPx: number;
  depth: number;
}

/** The nearest of `candidates` within `tolerancePx` screen distance whose
 *  depth does not exceed `maxDepth` -- mirrors hitAt()'s own edge-candidate
 *  selection in BrepViewportThree.tsx: closest screen distance wins, but
 *  only among candidates that survive an occlusion check against the
 *  nearest real surface at the cursor (a candidate behind that surface
 *  loses even if it projects closer to the cursor). `maxDepth` of Infinity
 *  skips the occlusion check entirely -- the same "no face hit at the
 *  cursor to reject against" fallback the edge candidates already use when
 *  their own reference hit is absent. Returns null when nothing is in
 *  tolerance, or every in-tolerance candidate is occluded. A tie in
 *  `distPx` keeps whichever candidate the caller listed first. */
export function nearestVisible<T extends ScreenCandidate>(
  candidates: T[], tolerancePx: number, maxDepth: number,
): T | null {
  let best: T | null = null;
  for (const c of candidates) {
    if (c.distPx > tolerancePx || c.depth > maxDepth) continue;
    if (!best || c.distPx < best.distPx) best = c;
  }
  return best;
}
