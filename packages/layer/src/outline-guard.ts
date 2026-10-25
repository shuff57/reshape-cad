// TypeScript port of docs/spikes/solidcraft-referee/contract/outline-guard.mjs (extrude-pocket group).
// Geometry guards the pull/pocket mapping runs BEFORE it hands an outline to the kernel. Plain 2-D arithmetic on the outline points
// (arcs sampled every 2 degrees); no kernel is involved and none is named. Behaviour-preserving: same thresholds, same walk.
import type { ArcApi, V2 } from './types.js';

export const GAP = 1e-3; // mm. Two non-neighbouring parts of an outline closer than this count as touching.
export const MIN_LEN = 1e-3; // mm. Smallest length / depth / outline dimension the mapping builds.
export const MIN_ROUND = 1e-2; // mm. Smallest round shape.
export const TOUCH = 1e-4; // mm. A plain outline whose own parts come closer than this counts as touching itself.
const ARC_STEP = (2 * Math.PI) / 180; // 2 degrees

/** An outline as the guards read it: the corner points, the bulge of each edge that is an arc, and the sketch's shape tag. */
export interface GuardOutline {
  points: V2[];
  bulges?: Record<number, number>;
  shape?: string;
}
export interface Sampled { pts: V2[]; owner: number[] }
export interface FoldHit { at: number; why: 'closes' | 'edge' | 'overlap' | 'loops' }
export interface LoopIn { poly: V2[]; depth: number }

/** The outline of a sketch feature as a dense closed polyline: {pts, owner: edge index of the segment pts[i]->pts[i+1]}. */
export function sampleOutline(o: GuardOutline, arc: Pick<ArcApi, 'arcFromBulge'>): Sampled {
  const P = o.points;
  const n = P.length;
  const pts: V2[] = [];
  const owner: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    pts.push([a[0], a[1]]); owner.push(i);
    const g = o.bulges?.[i];
    if (!g) continue;
    const { center, radius, startAngle, endAngle } = arc.arcFromBulge(a, b, g);
    let sweep = endAngle - startAngle;
    if (g > 0 && sweep < 0) sweep += Math.PI * 2;
    if (g < 0 && sweep > 0) sweep -= Math.PI * 2;
    const k = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP));
    for (let j = 1; j < k; j++) {
      const t = startAngle + (sweep * j) / k;
      pts.push([center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)]); owner.push(i);
    }
  }
  return { pts, owner };
}

function signedArea(P: V2[]): number {
  let a = 0;
  for (let i = 0; i < P.length; i++) { const p = P[i]; const q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Mitre offset of a closed polyline by d (positive = outward): offset each segment, intersect neighbours. */
export function offsetLoop(P: V2[], d: number): V2[] {
  const n = P.length;
  const sg = signedArea(P) >= 0 ? 1 : -1;
  const lines = P.map((p, i) => {
    const q = P[(i + 1) % n];
    const dx = q[0] - p[0]; const dy = q[1] - p[1]; const l = Math.hypot(dx, dy) || 1;
    return { p: [p[0] + (sg * dy / l) * d, p[1] - (sg * dx / l) * d], dir: [dx / l, dy / l] };
  });
  return P.map((_p, i) => {
    const A = lines[(i + n - 1) % n]; const B = lines[i];
    const den = A.dir[0] * B.dir[1] - A.dir[1] * B.dir[0];
    if (Math.abs(den) < 1e-9) return [B.p[0], B.p[1]];
    const t = ((B.p[0] - A.p[0]) * B.dir[1] - (B.p[1] - A.p[1]) * B.dir[0]) / den;
    return [A.p[0] + A.dir[0] * t, A.p[1] + A.dir[1] * t];
  });
}

export function segDist(p: V2, q: V2, r: V2, s: V2): number {
  const o = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(p, q, r); const d2 = o(p, q, s); const d3 = o(r, s, p); const d4 = o(r, s, q);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const pt = (a: V2, b: V2, c: V2) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l)) : 0; return Math.hypot(a[0] + t * dx - c[0], a[1] + t * dy - c[1]); };
  return Math.min(pt(p, q, r), pt(p, q, s), pt(r, s, p), pt(r, s, q));
}

/** Smallest distance between two segments of a closed polyline whose owner edges are neither the same nor neighbours. Infinity if none. */
export function selfClearance(P: V2[], owner: number[], nEdges: number, stopBelow = -1): number {
  const n = P.length;
  let best = Infinity;
  const near = (a: number, b: number) => { const d = Math.abs(a - b); return d <= 1 || d === nEdges - 1; };
  const bb = (i: number) => { const p = P[i]; const q = P[(i + 1) % n]; return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]; };
  const boxes = P.map((_, i) => bb(i));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (near(owner[i], owner[j])) continue;
      const a = boxes[i]; const b = boxes[j];
      const lim = Number.isFinite(best) ? Math.min(best, 1) : 1;
      if (a[0] > b[2] + lim || b[0] > a[2] + lim || a[1] > b[3] + lim || b[1] > a[3] + lim) continue;
      const d = segDist(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n]);
      if (d < best) best = d;
      if (best <= stopBelow) return best;
    }
  }
  return best;
}

/** A single outline must not cross or touch itself. Returns null when it is fine, else a short reason. */
export function selfTouch(o: GuardOutline, arc: Pick<ArcApi, 'arcFromBulge'>): 'cross' | 'touch' | null {
  if (o.shape === 'circle') return null;
  const { pts, owner } = sampleOutline(o, arc);
  const c = selfClearance(pts, owner, o.points.length, TOUCH);
  return c <= TOUCH ? (c === 0 ? 'cross' : 'touch') : null;
}

/**
 * Does the outline survive a taper? `d` = signed wall travel at the far end of the sweep (positive = the walls lean outward, so the
 * outline grows; negative = it shrinks). Walks the offset in 64 steps. Returns null when the taper is clean, else {at, why}.
 */
export function taperFold(o: GuardOutline, arc: Pick<ArcApi, 'arcFromBulge'>, d: number, circleRadius: number | null = null): FoldHit | null {
  if (circleRadius !== null) {
    return circleRadius + d <= GAP ? { at: -circleRadius, why: 'closes' } : null;
  }
  const { pts, owner } = sampleOutline(o, arc);
  const nEdges = o.points.length;
  const n = pts.length;
  const K = 64;
  for (let k = 1; k <= K; k++) {
    const dk = (d * k) / K;
    const Q = offsetLoop(pts, dk);
    for (let i = 0; i < n; i++) {
      const p = pts[i]; const q = pts[(i + 1) % n];
      const e0 = [q[0] - p[0], q[1] - p[1]];
      const a = Q[i]; const b = Q[(i + 1) % n];
      const e1 = [b[0] - a[0], b[1] - a[1]];
      const l0 = Math.hypot(...e0); const l1 = Math.hypot(...e1);
      if (l0 > 1e-6 && (e0[0] * e1[0] + e0[1] * e1[1] <= 0 || l1 < 1e-6)) return { at: dk, why: 'edge' };
    }
    if (selfClearance(Q, owner, nEdges, GAP) <= GAP) return { at: dk, why: 'overlap' };
  }
  return null;
}

function pointIn(poly: V2[], p: V2): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * The same walk for a SKETCH WITH HOLES OR SEVERAL SHAPES. `loops` = [{poly, depth}] (depth from the even-odd rule: an even depth is the
 * outside of material, an odd depth is a hole). Material grows by `d` on every loop: an outer loop moves out by d, a hole moves IN by d.
 * Returns null when the taper is clean, else {at, why}.
 */
export function taperFoldLoops(loops: LoopIn[], d: number): FoldHit | null {
  const K = 64;
  const polys = loops.map((L) => L.poly);
  const sign = loops.map((L) => (L.depth % 2 === 0 ? 1 : -1));
  const owner = polys.map((P) => P.map((_, i) => i));
  const nest0 = polys.map((A) => polys.map((B) => (A === B ? false : pointIn(B, A[0]))));
  for (let k = 1; k <= K; k++) {
    const dk = (d * k) / K;
    const Q = polys.map((P, li) => offsetLoop(P, sign[li] * dk));
    for (let li = 0; li < polys.length; li++) {
      const P = polys[li]; const q = Q[li]; const n = P.length;
      for (let i = 0; i < n; i++) {
        const p0 = P[i]; const p1 = P[(i + 1) % n];
        const e0 = [p1[0] - p0[0], p1[1] - p0[1]];
        const a = q[i]; const b = q[(i + 1) % n];
        const e1 = [b[0] - a[0], b[1] - a[1]];
        const l0 = Math.hypot(...e0); const l1 = Math.hypot(...e1);
        if (l0 > 1e-6 && (e0[0] * e1[0] + e0[1] * e1[1] <= 0 || l1 < 1e-6)) return { at: dk, why: 'edge' };
      }
      if (selfClearance(q, owner[li], n, GAP) <= GAP) return { at: dk, why: 'overlap' };
    }
    // nesting must not change: two parallel walls can pass THROUGH each other between two steps without any segment crossing
    for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++) {
      if (a === b) continue;
      if (pointIn(Q[b], Q[a][0]) !== nest0[a][b]) return { at: dk, why: 'loops' };
    }
    for (let a = 0; a < Q.length; a++) for (let b = a + 1; b < Q.length; b++) {
      const A = Q[a]; const B = Q[b];
      for (let i = 0; i < A.length; i++) {
        const p = A[i]; const q = A[(i + 1) % A.length];
        const lox = Math.min(p[0], q[0]) - GAP; const hix = Math.max(p[0], q[0]) + GAP; const loy = Math.min(p[1], q[1]) - GAP; const hiy = Math.max(p[1], q[1]) + GAP;
        for (let j = 0; j < B.length; j++) {
          const r = B[j]; const s = B[(j + 1) % B.length];
          if (Math.max(r[0], s[0]) < lox || Math.min(r[0], s[0]) > hix || Math.max(r[1], s[1]) < loy || Math.min(r[1], s[1]) > hiy) continue;
          if (segDist(p, q, r, s) <= GAP) return { at: dk, why: 'loops' };
        }
      }
    }
  }
  return null;
}

/** Bounding box of the outline points (arcs included) -> width, height and the smallest arc radius. */
export function outlineSize(o: GuardOutline, arc: Pick<ArcApi, 'arcFromBulge'>): { w: number; h: number; minRadius: number } {
  if (o.shape === 'circle') { const [a, b] = o.points; const dd = Math.hypot(b[0] - a[0], b[1] - a[1]); return { w: dd, h: dd, minRadius: dd / 2 }; }
  const { pts } = sampleOutline(o, arc);
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  let minRadius = Infinity;
  for (const [i, g] of Object.entries(o.bulges ?? {})) {
    if (!g) continue;
    const a = o.points[Number(i)]; const b = o.points[(Number(i) + 1) % o.points.length];
    minRadius = Math.min(minRadius, arc.arcFromBulge(a, b, g).radius);
  }
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), minRadius };
}
