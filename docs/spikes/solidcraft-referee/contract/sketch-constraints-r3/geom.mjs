// Plain 2D geometry helpers for the post-solve branch guard (round 2, group 'sketch-constraints'). No SolidCraft, no brep-rs.
export const TAU = Math.PI * 2;
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const unit = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l] : [0, 0]; };
export const dist = (a, b) => len(sub(a, b));
export const perp = (a) => [-a[1], a[0]]; // rotate +90 deg
export const sgn = (x, eps = 0) => (x > eps ? 1 : x < -eps ? -1 : 0);

/** the diagonal of the box around every geometry (scale for tolerances) */
export function sizeOf(geoms) {
  const pts = [];
  for (const g of geoms) {
    if (g.k === 'point') pts.push(g.p);
    else if (g.k === 'line') pts.push(g.a, g.b);
    else if (g.k === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]);
    else pts.push(g.a, g.b, [g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]);
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return Math.max(Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), 1e-9);
}

/** arc a -> b about c in `sense` ('cw' | 'ccw' (default)); returns {a0, sw} (start angle, signed sweep, ccw positive, |sw| in (0, TAU]) */
export function arcSweep(g) {
  const a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]);
  const a1 = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]);
  let sw = (((a1 - a0) % TAU) + TAU) % TAU;
  if (g.sense === 'cw') sw = sw === 0 ? -TAU : sw - TAU;
  else if (sw === 0) sw = TAU;
  return { a0, sw };
}
/** points along an arc a -> b (radius interpolated from |a-c| to |b-c|, so a 1e-4 end mismatch does not open a gap) */
export function arcPoints(g, n = 32) {
  const { a0, sw } = arcSweep(g);
  const ra = dist(g.a, g.c), rb = dist(g.b, g.c);
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n, r = ra + (rb - ra) * t, th = a0 + sw * t;
    return [g.c[0] + r * Math.cos(th), g.c[1] + r * Math.sin(th)];
  });
}
export function circlePoints(g, n = 64) {
  return Array.from({ length: n }, (_, k) => [g.c[0] + g.r * Math.cos((TAU * k) / n), g.c[1] + g.r * Math.sin((TAU * k) / n)]);
}
/** unit tangent of a line / arc at an end ('a' | 'b'), in the direction of travel a -> b (forward) */
export function tangentAt(g, end) {
  if (g.k === 'line') return unit(sub(g.b, g.a));
  const p = end === 'b' ? g.b : g.a;
  const t = unit(perp(sub(p, g.c)));
  return g.sense === 'cw' ? [-t[0], -t[1]] : t;
}
export const polyArea = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += cross(p, q); } return s / 2; };
export function polyCentroid(pts) {
  const A = polyArea(pts);
  if (Math.abs(A) < 1e-12) { const n = pts.length; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length], c = cross(p, q); cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
  return [cx / (6 * A), cy / (6 * A)];
}
/** winding number of a closed polygon around a point (angle summation: no ray, so no vertex / tangent-ray degeneracy) */
export function winding(pt, pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = sub(pts[i], pt), q = sub(pts[(i + 1) % pts.length], pt);
    s += Math.atan2(cross(p, q), dot(p, q));
  }
  return Math.round(s / TAU);
}
const orient = (a, b, c) => cross(sub(b, a), sub(c, a));
/** proper crossing of two segments, both endpoints of each strictly on opposite sides by more than `eps` (a length) */
export function segCross(p1, p2, q1, q2, eps) {
  const l1 = Math.max(dist(p1, p2), 1e-12), l2 = Math.max(dist(q1, q2), 1e-12);
  const d1 = orient(p1, p2, q1) / l1, d2 = orient(p1, p2, q2) / l1, d3 = orient(q1, q2, p1) / l2, d4 = orient(q1, q2, p2) / l2;
  return d1 * d2 < 0 && d3 * d4 < 0 && Math.min(Math.abs(d1), Math.abs(d2), Math.abs(d3), Math.abs(d4)) > eps;
}
/** does a closed polyline (list of points) cross itself? adjacent segments are never tested. */
export function selfCrosses(pts, eps) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n], eps)) return true;
  }
  return false;
}
export function polysCross(A, B, eps) {
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length], eps)) return true;
  return false;
}
