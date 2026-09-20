// Marquee (box) selection, pure (SPEC-mouse-parity.md Phase 2 item 5 "marquee
// select" / Phase 3 item 4 "box select" — one module serves both consumers).
// Everything here is a function of its arguments and nothing else -- no DOM,
// no React, no wasm -- so node --test can prove it (the sketch-canvas-core
// precedent). Reuses CoreGeom, segmentIntersection and sampleArc from
// sketch-canvas-core; no new coupling beyond that import.

import { type CoreGeom, type Pt, segmentIntersection, sampleArc, arcAngles } from './model/sketch-canvas-core.js';

/** The raw drag: where the press began and where it ended. Direction is
 *  recoverable only from the raw pair, so the API takes this and normalizes
 *  internally for the containment math. */
export interface MarqueeDrag {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/** Fusion-style marquee: dragged left-to-right is a WINDOW select (only fully
 *  enclosed geometry), right-to-left is a CROSSING select (touched counts).
 *  Decided by the drag's x direction alone; y is irrelevant to the kind. */
export function marqueeKind(drag: MarqueeDrag): 'window' | 'crossing' {
  return drag.endX >= drag.startX ? 'window' : 'crossing';
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function normalize(drag: MarqueeDrag): Rect {
  return {
    x0: Math.min(drag.startX, drag.endX),
    y0: Math.min(drag.startY, drag.endY),
    x1: Math.max(drag.startX, drag.endX),
    y1: Math.max(drag.startY, drag.endY),
  };
}

const inside = (p: Pt, r: Rect): boolean => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

/** The rect's four edges as segments, for segmentIntersection probes. */
function edges(r: Rect): Array<[Pt, Pt]> {
  const tl = { x: r.x0, y: r.y0 };
  const tr = { x: r.x1, y: r.y0 };
  const br = { x: r.x1, y: r.y1 };
  const bl = { x: r.x0, y: r.y1 };
  return [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ];
}

/** Does the segment a->b cross any rect edge (interior crossing, endpoints
 *  excluded — an endpoint ON the boundary is not a crossing)? */
function crossesEdges(a: Pt, b: Pt, r: Rect): boolean {
  for (const [p3, p4] of edges(r)) {
    const hit = segmentIntersection(a, b, p3, p4);
    if (!hit) continue;
    // segmentIntersection clamps to the segments' bounding boxes; a touch at
    // a shared endpoint is not a boundary crossing.
    const onAB = Math.hypot(hit.x - a.x, hit.y - a.y) < 1e-9 || Math.hypot(hit.x - b.x, hit.y - b.y) < 1e-9;
    if (!onAB) return true;
  }
  return false;
}

/** Window select: the geometry lies wholly inside the rect. */
function windowSelect(g: CoreGeom, r: Rect): boolean {
  switch (g.k) {
    case 'point':
      return inside({ x: g.p[0], y: g.p[1] }, r);
    case 'line': {
      const a = { x: g.a[0], y: g.a[1] };
      const b = { x: g.b[0], y: g.b[1] };
      return inside(a, r) && inside(b, r) && !crossesEdges(a, b, r);
    }
    case 'circle':
      // Bounding check: the rim must stay inside too.
      return (
        g.c[0] - g.r >= r.x0 &&
        g.c[0] + g.r <= r.x1 &&
        g.c[1] - g.r >= r.y0 &&
        g.c[1] + g.r <= r.y1
      );
    case 'arc': {
      const ang = arcAngles(g);
      if (!ang) return false;
      // Treat the arc as the hull of its sample points.
      return sampleArc(g.c[0], g.c[1], g.r, ang.a0, ang.sweep).every((p) => inside(p, r));
    }
  }
}

/** Crossing select: the geometry is touched OR inside. */
function crossingSelect(g: CoreGeom, r: Rect): boolean {
  if (windowSelect(g, r)) return true; // inside implies touched
  switch (g.k) {
    case 'point':
      return false; // a point is either inside or untouched
    case 'line': {
      const a = { x: g.a[0], y: g.a[1] };
      const b = { x: g.b[0], y: g.b[1] };
      return crossesEdges(a, b, r);
    }
    case 'circle': {
      // Overlap: distance from the centre to the rect's nearest point <= r,
      // or the centre inside (covered by the window probe above, kept for
      // clarity of the contract).
      const nx = Math.max(r.x0, Math.min(g.c[0], r.x1));
      const ny = Math.max(r.y0, Math.min(g.c[1], r.y1));
      return Math.hypot(g.c[0] - nx, g.c[1] - ny) <= g.r;
    }
    case 'arc': {
      const ang = arcAngles(g);
      if (!ang) return false;
      const pts = sampleArc(g.c[0], g.c[1], g.r, ang.a0, ang.sweep);
      if (pts.some((p) => inside(p, r))) return true;
      // The sampled polyline crossing an edge also counts as touched.
      for (let i = 0; i + 1 < pts.length; i++) {
        if (crossesEdges(pts[i], pts[i + 1], r)) return true;
      }
      return false;
    }
  }
}

/** Select geometry ids under a marquee drag. Window (left-to-right): fully
 *  inside only. Crossing (right-to-left): touched or inside. A degenerate
 *  drag (start == end, a click) has zero area and selects nothing. */
export function marqueeSelect(geoms: CoreGeom[], drag: MarqueeDrag): number[] {
  const r = normalize(drag);
  if (r.x1 - r.x0 <= 1e-12 || r.y1 - r.y0 <= 1e-12) return [];
  const kind = marqueeKind(drag);
  const pick = kind === 'window' ? windowSelect : crossingSelect;
  return geoms.filter((g) => pick(g, r)).map((g) => g.id);
}

/** Segment pairs of `pts` for the boundary-crossing probe: every consecutive
 *  pair, plus (only once there are more than two points) the pair that
 *  closes the last point back to the first. Two points (an edge's own
 *  endpoints) stay OPEN -- closing them back would just re-test the same
 *  segment reversed; four points (a face/body screen bbox's own corners,
 *  tl/tr/br/bl in order) close into the bbox's own four sides. */
function segmentsOf(pts: Pt[]): Array<[Pt, Pt]> {
  const segs: Array<[Pt, Pt]> = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
  if (pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  return segs;
}

/** Generic point-SET containment test for the SAME window/crossing rule
 *  windowSelect/crossingSelect above apply to a CoreGeom -- generalised so a
 *  caller whose candidate is not sketch geometry (BrepViewportThree.tsx's
 *  3D-projected face/edge/vertex/body picks, SPEC-mouse-parity.md Phase 3
 *  item 4) can reuse the exact same containment math rather than
 *  re-implementing it. `pts` is the candidate already reduced to screen
 *  points: one for a vertex, two (its own endpoints) for an edge, four (its
 *  bbox corners, tl/tr/br/bl) for a face or a whole body. Window: every
 *  point lies inside the rect AND no segment between them crosses its
 *  boundary (the same defensive pair windowSelect's own 'line' case
 *  checks). Crossing: window, OR any point lies inside, OR any segment
 *  crosses -- exactly crossingSelect's per-shape logic, generalised past
 *  one fixed point count. A degenerate drag (zero area) selects nothing,
 *  same as marqueeSelect(). */
export function pointSetSelect(pts: Pt[], drag: MarqueeDrag): boolean {
  const r = normalize(drag);
  if (r.x1 - r.x0 <= 1e-12 || r.y1 - r.y0 <= 1e-12) return false;
  const segs = segmentsOf(pts);
  const allInside = pts.every((p) => inside(p, r));
  const anyCrosses = segs.some(([a, b]) => crossesEdges(a, b, r));
  if (marqueeKind(drag) === 'window') return allInside && !anyCrosses;
  if (allInside && !anyCrosses) return true;
  return pts.some((p) => inside(p, r)) || anyCrosses;
}