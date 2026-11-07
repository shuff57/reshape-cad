/**
 * Sketching on a curved surface.
 *
 * A surface sketch is an ordinary 2D sketch whose coordinates are measured ALONG a surface instead of on a flat
 * plane: the sketch origin sits on an anchor point of the surface, the sketch x axis points along a chosen tangent
 * direction, and a sketch point (s, t) lands where a walk of length |(s, t)| from the anchor, straight ahead on the
 * surface (a geodesic), in the direction (s, t) makes with the x axis, ends. On a surface that can be unrolled flat
 * (a cylinder, two flat faces meeting at a corner of any angle) that walk is an exact unrolling: every length and
 * angle of the sketch is kept. On a surface that cannot (a sphere, a doubly curved wavy face) distances and directions
 * from the anchor are kept exactly and lengths across them stretch; the stretch is measured and the sketch is refused
 * when it is larger than the caller allows (`maxStretch`, default 1%).
 *
 * This module is pure (no kernel). It does three things:
 *   1. maps sketch outlines onto the surface (`surfaceMap`, `mapLoops`): closed forms for the cylinder, the sphere and
 *      the corner, and a numerical geodesic walk for any surface given as a height field over a plane (`graph`),
 *      which is what a wavy face is, measured from the kernel's own face points and fitted (`fitHeight`);
 *   2. plans kernel commands (`planSurfaceSketch`): the mapped outline is flattened onto a plane outside the part
 *      along one view direction, and that flat "shadow" sketch is what the kernel is given. The kernel puts it back on
 *      its own surface (split face) or cuts/raises the region with booleans. Nothing upstream is changed;
 *   3. predicts the result independently of the kernel (`Prediction`) and checks the built part against it
 *      (`verifySurfaceSketch`). Built-or-refused: a result that does not match the prediction is refused.
 *
 * Kernel facts this design rests on (SolidCraft v0.40.0-rc.2, solidcore kernel; docs/spikes/solidcraft-referee/
 * SURFACE-SKETCH.md): split face with a sketch extends every OPEN curve to the edge of the face, so only a single
 * smooth closed curve (or a curve running from edge to edge) can be imprinted; a projection goes through the whole
 * face, so a cylinder or sphere wall is marked on its far side too unless it is split in two first; sketch lines are
 * extended as well, while fit splines are placed accurately. Booleans of a shadow prism against the part give the
 * exact volume.
 */
import type { Cmd } from './types.js';

export type V2 = [number, number];
export type V3 = [number, number, number];

// ---------------------------------------------------------------------------------------------------------------
// vectors
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a);
  if (!(l > 1e-300)) throw new Error('zero vector');
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** `a` without its component along unit `n`. */
const perp = (a: V3, n: V3): V3 => sub(a, mul(n, dot(a, n)));
export const vec = { add, sub, mul, dot, cross, len, unit, perp };

// ---------------------------------------------------------------------------------------------------------------
// targets

/** The outside wall of a cylinder. `extent` is the wall's range along `axis`, measured from `origin`. */
export interface CylinderTarget {
  kind: 'cylinder';
  origin: V3;
  axis: V3;
  radius: number;
  extent?: [number, number];
}
/** The outside of a sphere. */
export interface SphereTarget {
  kind: 'sphere';
  center: V3;
  radius: number;
}
/**
 * Two flat faces meeting on a straight edge, at any angle, outside (convex) or inside (concave) corner. Face A holds
 * the anchor; `pointB` is any point of face B away from the edge (it says which half of B's plane is the face).
 * `extentA`/`extentB` optionally bound each face along the edge ([min, max] of (p - edgePoint) . edgeDir) and away
 * from it ([0, max] of the distance from the edge line within the face).
 */
export interface CornerTarget {
  kind: 'corner';
  edgePoint: V3;
  edgeDir: V3;
  normalA: V3;
  normalB: V3;
  pointB: V3;
  extentA?: { along: [number, number]; away: number };
  extentB?: { along: [number, number]; away: number };
}
/** One sample of a height field and its first and second derivatives. */
export interface HeightSample {
  z: number;
  zx: number;
  zy: number;
  zxx: number;
  zxy: number;
  zyy: number;
}
export type Height = (x: number, y: number) => HeightSample;
/**
 * A surface given as a height over a plane: point(x, y) = origin + x X + y Y + h(x, y) N with N = X x Y. A wavy face
 * is one of these: measured from the kernel's face points with `fitHeight`, or written down with `wavesHeight`.
 * `bounds` is the part of the plane over which the face exists.
 */
export interface GraphTarget {
  kind: 'graph';
  origin: V3;
  x: V3;
  y: V3;
  height: Height;
  bounds: { x: [number, number]; y: [number, number] };
}
export type SurfaceTarget = CylinderTarget | SphereTarget | CornerTarget | GraphTarget;

/** Where the sketch sits: its origin at the surface point nearest `anchor`, its x axis along `xDir` (made tangent). */
export interface Placement {
  anchor: V3;
  xDir: V3;
}

/** A sketch point mapped onto the surface, with the surface normal there and (corner only) which face it is on. */
export interface SurfacePoint {
  p: V3;
  n: V3;
  face?: 'A' | 'B';
}

export interface SurfaceMap {
  kind: SurfaceTarget['kind'];
  /** True when the map keeps every length (an unrolling); false when only lengths from the anchor are kept. */
  isometric: boolean;
  anchor: V3;
  /** The surface normal at the anchor and the sketch axes there (unit, tangent, e1 x e2 = normal). */
  normal: V3;
  e1: V3;
  e2: V3;
  at(q: V2): SurfacePoint;
  /** Corner only: signed distance of a sketch point from the fold line in the unrolled sketch (face A >= 0). */
  side?(q: V2): number;
}

// ---------------------------------------------------------------------------------------------------------------
// height fields

/** z = sum a sin(kx x + ky y + phase): an analytic wavy surface (the unit tests' oracle surface). */
export function wavesHeight(terms: { a: number; kx: number; ky: number; phase?: number }[]): Height {
  return (x, y) => {
    const s: HeightSample = { z: 0, zx: 0, zy: 0, zxx: 0, zxy: 0, zyy: 0 };
    for (const t of terms) {
      const arg = t.kx * x + t.ky * y + (t.phase ?? 0);
      const sn = Math.sin(arg), cs = Math.cos(arg);
      s.z += t.a * sn;
      s.zx += t.a * t.kx * cs;
      s.zy += t.a * t.ky * cs;
      s.zxx -= t.a * t.kx * t.kx * sn;
      s.zxy -= t.a * t.kx * t.ky * sn;
      s.zyy -= t.a * t.ky * t.ky * sn;
    }
    return s;
  };
}

/** The top of a sphere of radius R centred at (0, 0, -R): z = sqrt(R^2 - x^2 - y^2) - R. For cross-checking `graph`. */
export function sphereCapHeight(R: number): Height {
  return (x, y) => {
    const q = R * R - x * x - y * y;
    if (!(q > 0)) throw new Error('outside the cap');
    const w = Math.sqrt(q);
    return { z: w - R, zx: -x / w, zy: -y / w, zxx: -(R * R - y * y) / (q * w), zxy: -(x * y) / (q * w), zyy: -(R * R - x * x) / (q * w) };
  };
}

/** The top of a cylinder of radius R with its axis along y at z = -R: z = sqrt(R^2 - x^2) - R. */
export function cylinderTopHeight(R: number): Height {
  return (x) => {
    const q = R * R - x * x;
    if (!(q > 0)) throw new Error('outside the wall');
    const w = Math.sqrt(q);
    return { z: w - R, zx: -x / w, zy: 0, zxx: -(R * R) / (q * w), zxy: 0, zyy: 0 };
  };
}

export interface HeightFit {
  height: Height;
  bounds: { x: [number, number]; y: [number, number] };
  /** Largest and rms distance (along N) of the sample points from the fitted surface. */
  maxResidual: number;
  rmsResidual: number;
  samples: number;
  /** Knot spacing of the fitted cubic B-spline surface (mm). */
  cell: number;
}

/** Uniform cubic B-spline: the cell holding t, and the 4 basis values with first and second derivatives (per unit t). */
function bspline4(t: number, cells: number): { i: number; b: number[]; d: number[]; dd: number[] } {
  let i = Math.floor(t);
  if (i < 0) i = 0;
  if (i > cells - 1) i = cells - 1;
  const u = t - i, v = 1 - u;
  return {
    i,
    b: [(v * v * v) / 6, (3 * u * u * u - 6 * u * u + 4) / 6, (-3 * u * u * u + 3 * u * u + 3 * u + 1) / 6, (u * u * u) / 6],
    d: [-(v * v) / 2, (3 * u * u - 4 * u) / 2, (-3 * u * u + 2 * u + 1) / 2, (u * u) / 2],
    dd: [v, 3 * u - 2, -3 * u + 1, u],
  };
}

/**
 * A smooth height field through points measured on a face (for a wavy face: the kernel's own `inspect.isocurve`
 * points), as a least-squares cubic B-spline surface with knots `cell` mm apart over the points' box, lightly smoothed
 * so cells with few points stay tame. The residuals say how well it holds the face: the planner refuses a fit worse
 * than `fitTol`.
 */
export function fitHeight(points: V3[], frame: { origin: V3; x: V3; y: V3 }, cell = 2): HeightFit {
  const X = unit(frame.x), Y = unit(perp(frame.y, X)), N = cross(X, Y);
  const loc = points.map((p) => { const r = sub(p, frame.origin); return [dot(r, X), dot(r, Y), dot(r, N)] as V3; });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of loc) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), ny = Math.max(1, Math.ceil((y1 - y0) / cell));
  const hx = (x1 - x0) / nx || 1, hy = (y1 - y0) / ny || 1;
  const mx = nx + 3, my = ny + 3, m = mx * my;
  if (loc.length < m) throw new Error('too few points to fit the face');
  const A = new Float64Array(m * m), rhs = new Float64Array(m);
  for (const [x, y, z] of loc) {
    const U = bspline4((x - x0) / hx, nx), V = bspline4((y - y0) / hy, ny);
    const idx: number[] = [], val: number[] = [];
    for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) { idx.push((U.i + a) * my + V.i + c); val.push(U.b[a] * V.b[c]); }
    for (let r = 0; r < 16; r++) { rhs[idx[r]] += val[r] * z; for (let q = 0; q < 16; q++) A[idx[r] * m + idx[q]] += val[r] * val[q]; }
  }
  // smoothing: second differences of the control net in both directions, small against the data
  let tr = 0;
  for (let i = 0; i < m; i++) tr += A[i * m + i];
  const lam = (1e-7 * tr) / m;
  const pen = (k0: number, k1: number, k2: number): void => {
    const ks = [k0, k1, k2], w = [1, -2, 1];
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) A[ks[r] * m + ks[q]] += lam * w[r] * w[q];
  };
  for (let i = 0; i < mx; i++) for (let j = 0; j < my; j++) {
    if (i + 2 < mx) pen(i * my + j, (i + 1) * my + j, (i + 2) * my + j);
    if (j + 2 < my) pen(i * my + j, i * my + j + 1, i * my + j + 2);
  }
  // Cholesky solve (the matrix is banded: bandwidth 3 * my + 3)
  const bw = 3 * my + 3;
  const L = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let j = Math.max(0, i - bw); j <= i; j++) {
      let s = A[i * m + j];
      for (let k = Math.max(0, i - bw, j - bw); k < j; k++) s -= L[i * m + k] * L[j * m + k];
      if (i === j) { if (!(s > 0)) throw new Error('the face points do not determine a height field'); L[i * m + i] = Math.sqrt(s); } else L[i * m + j] = s / L[j * m + j];
    }
  }
  const yv = new Float64Array(m);
  for (let i = 0; i < m; i++) { let s = rhs[i]; for (let k = Math.max(0, i - bw); k < i; k++) s -= L[i * m + k] * yv[k]; yv[i] = s / L[i * m + i]; }
  const coef = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) { let s = yv[i]; for (let k = i + 1; k <= Math.min(m - 1, i + bw); k++) s -= L[k * m + i] * coef[k]; coef[i] = s / L[i * m + i]; }
  const height: Height = (x, y) => {
    const U = bspline4((x - x0) / hx, nx), V = bspline4((y - y0) / hy, ny);
    const s: HeightSample = { z: 0, zx: 0, zy: 0, zxx: 0, zxy: 0, zyy: 0 };
    for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) {
      const k = coef[(U.i + a) * my + V.i + c];
      s.z += k * U.b[a] * V.b[c];
      s.zx += (k * U.d[a] * V.b[c]) / hx;
      s.zy += (k * U.b[a] * V.d[c]) / hy;
      s.zxx += (k * U.dd[a] * V.b[c]) / (hx * hx);
      s.zxy += (k * U.d[a] * V.d[c]) / (hx * hy);
      s.zyy += (k * U.b[a] * V.dd[c]) / (hy * hy);
    }
    return s;
  };
  let mxr = 0, ss = 0;
  for (const [x, y, z] of loc) { const e = Math.abs(height(x, y).z - z); mxr = Math.max(mxr, e); ss += e * e; }
  return { height, bounds: { x: [x0, x1], y: [y0, y1] }, maxResidual: mxr, rmsResidual: Math.sqrt(ss / loc.length), samples: loc.length, cell };
}

// ---------------------------------------------------------------------------------------------------------------
// the maps

function tangentAxes(n: V3, xDir: V3): { e1: V3; e2: V3 } {
  const t = perp(xDir, n);
  if (len(t) < 1e-9 * Math.max(1, len(xDir))) throw new Error('the sketch x direction points straight out of the surface');
  const e1 = unit(t);
  return { e1, e2: cross(n, e1) };
}

function cylinderMap(t: CylinderTarget, pl: Placement): SurfaceMap {
  const a = unit(t.axis), R = t.radius;
  const r0 = sub(pl.anchor, t.origin);
  const z0 = dot(r0, a);
  const rh = unit(perp(r0, a));
  const c = cross(a, rh);
  const anchor = add(add(t.origin, mul(a, z0)), mul(rh, R));
  const { e1, e2 } = tangentAxes(rh, pl.xDir);
  return {
    kind: 'cylinder', isometric: true, anchor, normal: rh, e1, e2,
    at([s, q]) {
      const w = add(mul(e1, s), mul(e2, q));
      const sig = dot(w, c) / R, zeta = dot(w, a);
      const n = add(mul(rh, Math.cos(sig)), mul(c, Math.sin(sig)));
      return { p: add(add(t.origin, mul(a, z0 + zeta)), mul(n, R)), n };
    },
  };
}

function sphereMap(t: SphereTarget, pl: Placement): SurfaceMap {
  const R = t.radius, n0 = unit(sub(pl.anchor, t.center));
  const anchor = add(t.center, mul(n0, R));
  const { e1, e2 } = tangentAxes(n0, pl.xDir);
  return {
    kind: 'sphere', isometric: false, anchor, normal: n0, e1, e2,
    at([s, q]) {
      const w = add(mul(e1, s), mul(e2, q));
      const rho = len(w);
      if (rho < 1e-14) return { p: anchor, n: n0 };
      const u = mul(w, 1 / rho);
      const n = add(mul(n0, Math.cos(rho / R)), mul(u, Math.sin(rho / R)));
      return { p: add(t.center, mul(n, R)), n };
    },
  };
}

/** The corner's two in-face directions away from the edge, and its interior angle. */
export function cornerFrame(t: CornerTarget, anchor?: V3): { e: V3; nA: V3; nB: V3; mA: V3; mB: V3; angleDeg: number; convex: boolean } {
  const e = unit(t.edgeDir), nA = unit(perp(t.normalA, e)), nB = unit(perp(t.normalB, e));
  let mA = cross(e, nA);
  if (anchor && dot(sub(anchor, t.edgePoint), mA) < 0) mA = mul(mA, -1);
  const vB = perp(perp(sub(t.pointB, t.edgePoint), e), nB);
  if (len(vB) < 1e-9) throw new Error('pointB lies on the edge');
  const mB = unit(vB);
  const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot(mA, mB)))) * 180) / Math.PI;
  // outside corner: face B bends away from A's normal side
  const convex = dot(mB, nA) < 0;
  return { e, nA, nB, mA, mB, angleDeg, convex };
}

function cornerMap(t: CornerTarget, pl: Placement): SurfaceMap {
  const nA0 = unit(perp(t.normalA, unit(t.edgeDir)));
  const anchor = sub(pl.anchor, mul(nA0, dot(sub(pl.anchor, t.edgePoint), nA0)));
  const { e, nA, nB, mA, mB } = cornerFrame(t, anchor);
  if (dot(sub(anchor, t.edgePoint), mA) < 0) throw new Error('the anchor is not on face A');
  const { e1, e2 } = tangentAxes(nA, pl.xDir);
  return {
    kind: 'corner', isometric: true, anchor, normal: nA, e1, e2,
    side([s, q]) { return dot(sub(add(anchor, add(mul(e1, s), mul(e2, q))), t.edgePoint), mA); },
    at([s, q]) {
      const D = add(anchor, add(mul(e1, s), mul(e2, q)));
      const r = sub(D, t.edgePoint);
      const al = dot(r, e), be = dot(r, mA);
      if (be >= 0) return { p: D, n: nA, face: 'A' };
      return { p: add(add(t.edgePoint, mul(e, al)), mul(mB, -be)), n: nB, face: 'B' };
    },
  };
}

/** Graph surfaces: geodesic walks by RK4 on the height field's geodesic equation (step `step` mm of arc). */
function graphMap(t: GraphTarget, pl: Placement, step = 0.05): SurfaceMap {
  const X = unit(t.x), Y = unit(perp(t.y, X)), N = cross(X, Y);
  const H = t.height;
  const point = (x: number, y: number, s = H(x, y)): V3 => add(add(add(t.origin, mul(X, x)), mul(Y, y)), mul(N, s.z));
  const normalOf = (s: HeightSample): V3 => unit(sub(sub(N, mul(X, s.zx)), mul(Y, s.zy)));
  const r0 = sub(pl.anchor, t.origin);
  const x0 = dot(r0, X), y0 = dot(r0, Y);
  const s0 = H(x0, y0);
  const anchor = point(x0, y0, s0), n0 = normalOf(s0);
  const { e1, e2 } = tangentAxes(n0, pl.xDir);
  const acc = (x: number, y: number, vx: number, vy: number): [number, number] => {
    const s = H(x, y);
    const k = (s.zxx * vx * vx + 2 * s.zxy * vx * vy + s.zyy * vy * vy) / (1 + s.zx * s.zx + s.zy * s.zy);
    return [-s.zx * k, -s.zy * k];
  };
  return {
    kind: 'graph', isometric: false, anchor, normal: n0, e1, e2,
    at([s, q]) {
      const w = add(mul(e1, s), mul(e2, q));
      const rho = len(w);
      if (rho < 1e-14) return { p: anchor, n: n0 };
      const u = mul(w, 1 / rho);
      let x = x0, y = y0, vx = dot(u, X), vy = dot(u, Y);
      const n = Math.max(1, Math.ceil(rho / step)), h = rho / n;
      for (let i = 0; i < n; i++) {
        const a1 = acc(x, y, vx, vy);
        const a2 = acc(x + (h / 2) * vx, y + (h / 2) * vy, vx + (h / 2) * a1[0], vy + (h / 2) * a1[1]);
        const vx2 = vx + (h / 2) * a1[0], vy2 = vy + (h / 2) * a1[1];
        const vx3 = vx + (h / 2) * a2[0], vy3 = vy + (h / 2) * a2[1];
        const a3 = acc(x + (h / 2) * vx2, y + (h / 2) * vy2, vx3, vy3);
        const vx4 = vx + h * a3[0], vy4 = vy + h * a3[1];
        const a4 = acc(x + h * vx3, y + h * vy3, vx4, vy4);
        x += (h / 6) * (vx + 2 * vx2 + 2 * vx3 + vx4);
        y += (h / 6) * (vy + 2 * vy2 + 2 * vy3 + vy4);
        vx += (h / 6) * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
        vy += (h / 6) * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
      }
      const sf = H(x, y);
      return { p: point(x, y, sf), n: normalOf(sf) };
    },
  };
}

export function surfaceMap(target: SurfaceTarget, placement: Placement, opts: { step?: number } = {}): SurfaceMap {
  switch (target.kind) {
    case 'cylinder': return cylinderMap(target, placement);
    case 'sphere': return sphereMap(target, placement);
    case 'corner': return cornerMap(target, placement);
    case 'graph': return graphMap(target, placement, opts.step);
  }
}

/** Largest relative stretch of sketch lengths at q (0 for an exact unrolling): from the singular values of the map. */
export function stretchAt(m: SurfaceMap, q: V2, d = 1e-4): number {
  const a = m.at(q).p;
  const ps = m.at([q[0] + d, q[1]]).p, pt = m.at([q[0], q[1] + d]).p;
  const js = mul(sub(ps, a), 1 / d), jt = mul(sub(pt, a), 1 / d);
  const E = dot(js, js), F = dot(js, jt), G = dot(jt, jt);
  const tr = (E + G) / 2, disc = Math.sqrt(Math.max(0, ((E - G) / 2) ** 2 + F * F));
  const s1 = Math.sqrt(tr + disc), s2 = Math.sqrt(Math.max(0, tr - disc));
  return Math.max(Math.abs(s1 - 1), Math.abs(s2 - 1));
}

// ---------------------------------------------------------------------------------------------------------------
// sketch outlines

/** One smooth piece of an outline (a line, an arc, a spline), as a dense polyline in order. */
export interface SketchPiece {
  points: V2[];
}
/** A chain of pieces, end to end. `closed`: the last piece ends where the first starts. */
export interface SketchLoop {
  pieces: SketchPiece[];
  closed: boolean;
}

export const shapes = {
  line(a: V2, b: V2, n = 64): SketchPiece {
    return { points: Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as V2) };
  },
  arc(c: V2, r: number, a0: number, a1: number, n = 0): SketchPiece {
    const k = n || Math.max(16, Math.ceil((Math.abs(a1 - a0) * r) / 0.05));
    return { points: Array.from({ length: k + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / k; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as V2; }) };
  },
  circle(c: V2, r: number): SketchLoop {
    return { pieces: [shapes.arc(c, r, 0, 2 * Math.PI)], closed: true };
  },
  ellipse(c: V2, a: number, b: number, n = 2048): SketchLoop {
    return { pieces: [{ points: Array.from({ length: n + 1 }, (_, i) => { const t = (2 * Math.PI * i) / n; return [c[0] + a * Math.cos(t), c[1] + b * Math.sin(t)] as V2; }) }], closed: true };
  },
  polygon(pts: V2[]): SketchLoop {
    return { pieces: pts.map((p, i) => shapes.line(p, pts[(i + 1) % pts.length], Math.max(16, Math.ceil(Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]) / 0.05)))), closed: true };
  },
  rect(x0: number, y0: number, x1: number, y1: number): SketchLoop {
    return shapes.polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  },
  /** A slot: two straight sides `length` apart (centre to centre) and two half-circle ends of radius r, along x. */
  slot(c: V2, length: number, r: number): SketchLoop {
    const h = length / 2;
    return {
      closed: true,
      pieces: [
        shapes.line([c[0] - h, c[1] - r], [c[0] + h, c[1] - r], Math.max(16, Math.ceil(length / 0.05))),
        shapes.arc([c[0] + h, c[1]], r, -Math.PI / 2, Math.PI / 2),
        shapes.line([c[0] + h, c[1] + r], [c[0] - h, c[1] + r], Math.max(16, Math.ceil(length / 0.05))),
        shapes.arc([c[0] - h, c[1]], r, Math.PI / 2, (3 * Math.PI) / 2),
      ],
    };
  },
};

/** The loop's points in order, each piece's shared end point once. */
export function loopPoints(l: SketchLoop): V2[] {
  const out: V2[] = [];
  l.pieces.forEach((pc, k) => out.push(...(k === 0 ? pc.points : pc.points.slice(1))));
  if (l.closed && out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) out.pop();
  }
  return out;
}

export function polyArea(pts: V2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - a[1] * b[0]; }
  return s / 2;
}
const polyLen2 = (pts: V2[], closed: boolean): number => {
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  if (closed && pts.length > 2) s += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return s;
};
const polyLen3 = (pts: V3[], closed: boolean): number => {
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) s += len(sub(pts[i + 1], pts[i]));
  if (closed && pts.length > 2) s += len(sub(pts[0], pts[pts.length - 1]));
  return s;
};

/** Each piece's points made no further apart than `maxSeg` (linear subdivision of the given polyline). */
function densify(pts: V2[], maxSeg: number): V2[] {
  const out: V2[] = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg));
    for (let j = 1; j <= k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

export interface MappedPiece {
  sketch: V2[];
  surface: SurfacePoint[];
}
export interface MappedLoop {
  closed: boolean;
  pieces: MappedPiece[];
}

/**
 * Map each loop onto the surface. On a corner a piece is broken exactly where it crosses the fold, so each mapped
 * piece is smooth on one face (the outline has a crease there, which a single smooth curve would round off).
 */
export function mapLoops(m: SurfaceMap, loops: SketchLoop[], maxSeg = 0.1): MappedLoop[] {
  return loops.map((l) => {
    let pieces = l.pieces.map((pc) => densify(pc.points, maxSeg));
    if (m.side) {
      const side = m.side.bind(m);
      const out: V2[][] = [];
      let crossed = false;
      for (const pts of pieces) {
        let cur: V2[] = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], sa = side(a), sb = side(b);
          if ((sa >= 0) !== (sb >= 0)) {
            const lam = sa / (sa - sb);
            const x: V2 = [a[0] + (b[0] - a[0]) * lam, a[1] + (b[1] - a[1]) * lam];
            cur.push(x); out.push(cur); cur = [x]; crossed = true;
          }
          cur.push(b);
        }
        out.push(cur);
      }
      pieces = out.filter((p) => p.length >= 2);
      // a single smooth closed piece that crossed: its first and last bits meet at the loop's start, which is not a
      // fold crossing and not a corner -- join them. (With several pieces the start is a corner between two of them.)
      if (l.closed && crossed && l.pieces.length === 1 && pieces.length >= 2) {
        const first = pieces[0], last = pieces[pieces.length - 1];
        const a = first[0], b = last[last.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9 && (side(first[1]) >= 0) === (side(last[last.length - 2]) >= 0)) {
          pieces = [last.concat(first.slice(1)), ...pieces.slice(1, -1)];
        }
      }
    }
    // no repeated points (a sample landing exactly on the fold is also the crossing point)
    const dedup = (pts: V2[]): V2[] => pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 1e-12);
    pieces = pieces.map(dedup).filter((p) => p.length >= 2);
    return { closed: l.closed, pieces: pieces.map((sk) => ({ sketch: sk, surface: sk.map((q) => m.at(q)) })) };
  });
}

/**
 * The thin slivers between a smooth piece and its polyline: for each segment of chord c turning by alpha (the mean of
 * the turns at its two ends, so a piece's own ends and corners between pieces add nothing extra), c^2 alpha / 12,
 * signed by the turning. Added to the polygon area it makes the area of a densely sampled smooth outline accurate to
 * fourth order instead of second.
 */
export function sliverArea(pieces: V2[][]): number {
  let s = 0;
  for (const pc of pieces) {
    const n = pc.length;
    if (n < 3) continue;
    const turn: number[] = new Array(n).fill(0);
    for (let i = 1; i + 1 < n; i++) {
      const a = pc[i - 1], b = pc[i], c = pc[i + 1];
      const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      turn[i] = Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1));
    }
    for (let i = 0; i + 1 < n; i++) {
      const c2 = (pc[i + 1][0] - pc[i][0]) ** 2 + (pc[i + 1][1] - pc[i][1]) ** 2;
      const al = i === 0 ? turn[1] : i + 1 === n - 1 ? turn[i] : (turn[i] + turn[i + 1]) / 2;
      s += (c2 * al) / 12;
    }
  }
  return s;
}

/** Area of a set of loops, a loop inside an odd number of others counting as a hole. */
export function regionArea(loops: V2[][], pieces?: V2[][][]): number {
  const inside = (p: V2, l: V2[]): boolean => {
    let c = false;
    for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
      const a = l[i], b = l[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  let s = 0;
  loops.forEach((l, i) => {
    const depth = loops.filter((o, j) => j !== i && inside(l[0], o)).length;
    const a = polyArea(l), sl = pieces ? sliverArea(pieces[i]) : 0;
    // the sliver sum has the loop's own orientation: it grows a counter-clockwise loop's area
    s += (depth % 2 ? -1 : 1) * Math.abs(a + sl);
  });
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// planning

export type SurfaceOp =
  | { op: 'imprint' }
  | { op: 'cut'; depth: number; floor?: 'view' | 'normal' }
  | { op: 'raise'; height: number; floor?: 'view' | 'normal' };

export interface PlanInput {
  /** The kernel body that carries the target surface. */
  body: string;
  target: SurfaceTarget;
  placement: Placement;
  loops: SketchLoop[];
  op: SurfaceOp;
  /** Feature id, used in names and sentences. */
  id?: string;
  /** Largest allowed relative stretch of sketch lengths on a surface that cannot be unrolled. Default 0.01. */
  maxStretch?: number;
  /** Largest angle between the surface and the view direction anywhere on the outline (degrees). Default 70. */
  maxTiltDeg?: number;
  /** Fitted height field quality (graph targets made by `fitHeight`): refuse when the face is held worse than this. */
  fit?: { maxResidual: number };
  fitTol?: number;
}

export interface Prediction {
  op: SurfaceOp['op'];
  /** Signed volume change of `body` (cut: negative, raise: positive), from closed forms or quadrature, not the kernel. */
  volumeDelta?: number;
  /** The mapped outline on the surface (dense) and its length; the imprint check compares kernel edges with it. */
  curves: { points: V3[]; closed: boolean; length: number }[];
  /** Area of the sketch's region on the surface (exact for an unrolling; quadrature otherwise). */
  surfaceArea?: number;
  /** For cut/raise: the depth across the region measured along the surface normal (min, max). */
  normalDepth?: [number, number];
  /** Largest measured stretch of sketch lengths (0 for an unrolling). */
  stretch: number;
  /** Largest tilt between surface normal and the view direction on the outline, degrees. */
  tiltDeg: number;
  view: V3;
  /** Imprint on a round face: the plane it is split in first (edges in it are not part of the mark). */
  seam?: { origin: V3; normal: V3 };
}

export type PlanResult =
  | { ok: true; commands: Cmd[]; prediction: Prediction; toolBodies: string[]; notes: string[] }
  | { ok: false; refusal: string; detail?: Record<string, unknown> };

const fmt = (x: number, d = 2): string => String(Number(x.toFixed(d)));
const DEG = 180 / Math.PI;

/** Distance along -view from a plane point (plane through `o` with normal `view`) to the target surface's first hit. */
function rayDepth(target: SurfaceTarget, o: V3, view: V3): number | null {
  const d = mul(view, -1);
  switch (target.kind) {
    case 'sphere': {
      const r = sub(o, target.center), b = dot(r, d), c = dot(r, r) - target.radius ** 2, D = b * b - c;
      return D < 0 ? null : -b - Math.sqrt(D);
    }
    case 'cylinder': {
      const a = unit(target.axis), r = perp(sub(o, target.origin), a), dd = perp(d, a);
      const A = dot(dd, dd), B = dot(r, dd), C = dot(r, r) - target.radius ** 2, D = B * B - A * C;
      return A < 1e-15 || D < 0 ? null : (-B - Math.sqrt(D)) / A;
    }
    default:
      return null;
  }
}

/** Integral over the shadow region (even-odd over all loops, shadow coordinates) of f(u, v), by scanlines. */
export function integrateRegion(loops: V2[][], f: (u: number, v: number) => number, rows = 1500, cols = 24): number {
  let v0 = Infinity, v1 = -Infinity;
  for (const l of loops) for (const p of l) { v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]); }
  const dv = (v1 - v0) / rows;
  let total = 0;
  for (let r = 0; r < rows; r++) {
    const v = v0 + (r + 0.5) * dv;
    const xs: number[] = [];
    for (const l of loops) for (let i = 0; i < l.length; i++) {
      const a = l[i], b = l[(i + 1) % l.length];
      if ((a[1] <= v) !== (b[1] <= v)) xs.push(a[0] + ((v - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const u0 = xs[k], u1 = xs[k + 1], n = cols, h = (u1 - u0) / n;
      let s = f(u0, v) + f(u1, v);
      for (let j = 1; j < n; j++) s += (j % 2 ? 4 : 2) * f(u0 + j * h, v);
      total += (s * h) / 3;
    }
  }
  return total * dv;
}

/**
 * Fit points for one shadow curve: kernel fit splines are accurate where points are a couple of millimetres apart on
 * gentle curves; spacing follows the curve's turning so tight bends get more points. At most 480 per spline.
 */
function fitPoints(pts: V2[], closed: boolean, joins: number[] = []): V2[] {
  // where two pieces meet smoothly the curvature can jump (a slot's side into its end): a cubic through points 0.5 mm
  // apart ripples there by ~3 um, so within 1.5 mm of such a join the points are 0.2 mm apart
  const sAt: number[] = [0];
  for (let i = 1; i < pts.length; i++) sAt.push(sAt[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const Ltot = sAt[sAt.length - 1];
  const nearJoin = (sv: number): boolean => joins.some((j) => { const d = Math.abs(sv - sAt[j]); return Math.min(d, closed ? Ltot - d : d) < 1.5; });
  // arc-length resample, weighted by the turning and by the joins
  const w: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) * (nearJoin((sAt[i - 1] + sAt[i]) / 2) ? 2.5 : 1);
    let turn = 0;
    if (i >= 2) {
      const p = pts[i - 2];
      const t1 = Math.atan2(a[1] - p[1], a[0] - p[0]), t2 = Math.atan2(b[1] - a[1], b[0] - a[0]);
      turn = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
    }
    w.push(w[i - 1] + seg + 2 * turn);
  }
  const W = w[w.length - 1];
  const target = Math.min(480, Math.max(12, Math.ceil(W / 0.5)));
  const n = closed ? target : target + 1;
  const out: V2[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = closed ? (W * k) / n : (W * k) / target;
    while (j + 1 < w.length - 1 && w[j + 1] < s) j++;
    const t = w[j + 1] > w[j] ? (s - w[j]) / (w[j + 1] - w[j]) : 0;
    const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
    out.push([a[0] + (b[0] - a[0]) * Math.min(1, Math.max(0, t)), a[1] + (b[1] - a[1]) * Math.min(1, Math.max(0, t))]);
  }
  if (!closed) out[out.length - 1] = pts[pts.length - 1];
  return out;
}

/** Direction of travel at a piece's start or end: second-order one-sided difference of its last (first) three points. */
function endDir(pts: V2[], atEnd: boolean): number {
  const n = pts.length;
  if (n < 3) { const a = pts[0], b = pts[n - 1]; return Math.atan2(b[1] - a[1], b[0] - a[0]); }
  const [p0, p1, p2] = atEnd ? [pts[n - 3], pts[n - 2], pts[n - 1]] : [pts[2], pts[1], pts[0]];
  const tx = 3 * p2[0] - 4 * p1[0] + p0[0], ty = 3 * p2[1] - 4 * p1[1] + p0[1];
  return atEnd ? Math.atan2(ty, tx) : Math.atan2(-ty, -tx);
}

/**
 * Join pieces that meet smoothly (their directions agree within 1 degree): a slot or a rounded rectangle becomes one
 * piece, and when every join of a closed loop is smooth, one periodic piece. Loose spline ends round off what they
 * hold; a periodic spline has none.
 */
export function groupSmooth(pieces: V2[][], closed: boolean): { groups: V2[][]; periodic: boolean; joins: number[][] } {
  const n = pieces.length;
  const smooth = (i: number): boolean => {
    const d = endDir(pieces[i], true) - endDir(pieces[(i + 1) % n], false);
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < Math.PI / 180;
  };
  const joins = Array.from({ length: n }, (_, i) => (i + 1 < n || closed ? smooth(i) : false));
  if (closed && joins.every(Boolean)) {
    const all: V2[] = [], at: number[] = [];
    pieces.forEach((pc, k) => { if (k > 0) at.push(all.length - 1); all.push(...(k === 0 ? pc : pc.slice(1))); });
    if (Math.hypot(all[0][0] - all[all.length - 1][0], all[0][1] - all[all.length - 1][1]) < 1e-9) all.pop();
    if (n > 1) at.push(0);
    return { groups: [all], periodic: true, joins: [at] };
  }
  // start at a sharp join so no group wraps past the loop's start
  let start = 0;
  if (closed) start = (joins.findIndex((j) => !j) + 1) % n;
  const groups: V2[][] = [], gj: number[][] = [];
  let cur: V2[] = [], cj: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (cur.length) cj.push(cur.length - 1);
    cur = cur.length ? cur.concat(pieces[i].slice(1)) : pieces[i].slice();
    if (!joins[i] || k === n - 1) { groups.push(cur); gj.push(cj); cur = []; cj = []; }
  }
  return { groups, periodic: false, joins: gj };
}

const straight = (pts: V2[]): boolean => {
  const a = pts[0], b = pts[pts.length - 1];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-9) return false;
  return pts.every((p) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L < 1e-7);
};

/**
 * Plan a surface sketch: map it, run the guards, and return the kernel commands with an independent prediction, or
 * one plain sentence saying why it is refused.
 */
export function planSurfaceSketch(input: PlanInput): PlanResult {
  const id = input.id ?? 'surface1';
  const maxStretch = input.maxStretch ?? 0.01;
  const maxTilt = input.maxTiltDeg ?? 70;
  const t = input.target;
  const refuse = (s: string, detail?: Record<string, unknown>): PlanResult => ({ ok: false, refusal: s, detail });
  if (input.loops.length === 0 || input.loops.some((l) => l.pieces.length === 0)) return refuse(`The sketch for ${id} has nothing in it to place on the surface.`);
  if (input.fit && input.fit.maxResidual > (input.fitTol ?? 2e-3)) {
    return refuse(`The face under ${id} is too irregular to sketch on: a smooth surface through its measured points misses some of them by ${fmt(input.fit.maxResidual, 4)} mm, more than ${fmt(input.fitTol ?? 2e-3, 4)} mm.`);
  }
  let m: SurfaceMap;
  try { m = surfaceMap(t, input.placement); } catch (e) { return refuse(`The sketch for ${id} cannot be placed there: ${(e as Error).message}.`); }
  const mapped = mapLoops(m, input.loops);

  // --- the surface region must stay on the face
  const allPts = mapped.flatMap((l) => l.pieces.flatMap((pc) => pc.surface));
  if (t.kind === 'cylinder' && t.extent) {
    const a = unit(t.axis);
    const zs = allPts.map((s) => dot(sub(s.p, t.origin), a));
    if (Math.min(...zs) < t.extent[0] + 1e-6 || Math.max(...zs) > t.extent[1] - 1e-6) return refuse(`The sketch for ${id} runs off the end of the round face it is on.`);
  }
  if (t.kind === 'graph') {
    const X = unit(t.x), Y = unit(perp(t.y, X));
    for (const s of allPts) {
      const r = sub(s.p, t.origin), x = dot(r, X), y = dot(r, Y);
      if (x < t.bounds.x[0] || x > t.bounds.x[1] || y < t.bounds.y[0] || y > t.bounds.y[1]) return refuse(`The sketch for ${id} runs off the edge of the face it is on.`);
    }
  }
  let corner: ReturnType<typeof cornerFrame> | null = null;
  if (t.kind === 'corner') {
    corner = cornerFrame(t, m.anchor);
    if (corner.angleDeg < 20) return refuse(`The two faces under ${id} meet at ${fmt(corner.angleDeg, 1)} degrees, too sharp a corner to sketch across.`);
    const ex = (s: SurfacePoint): boolean => {
      const f = s.face === 'B' ? t.extentB : t.extentA;
      if (!f) return true;
      const r = sub(s.p, t.edgePoint), al = dot(r, corner!.e), aw = len(perp(r, corner!.e));
      return al >= f.along[0] - 1e-9 && al <= f.along[1] + 1e-9 && aw <= f.away + 1e-9;
    };
    if (!allPts.every(ex)) return refuse(`The sketch for ${id} runs off the faces at the corner.`);
  }
  const onB = allPts.some((s) => s.face === 'B');
  const onA = allPts.some((s) => s.face !== 'B');

  // --- stretch (non-unrollable surfaces)
  let stretch = 0;
  if (!m.isometric) {
    for (const l of mapped) for (const pc of l.pieces) for (let i = 0; i < pc.sketch.length; i += 4) stretch = Math.max(stretch, stretchAt(m, pc.sketch[i], t.kind === 'graph' ? 1e-3 : 1e-4));
    if (stretch > maxStretch) {
      return refuse(
        `The sketch for ${id} is too big for this ${t.kind === 'sphere' ? 'sphere' : 'curved face'} to hold without stretching: lengths across it would change by up to ${fmt(stretch * 100, 1)}%, more than the ${fmt(maxStretch * 100, 1)}% allowed -- make it smaller, place it nearer its middle, or allow more stretch.`,
        { stretch },
      );
    }
  }


  // --- the view direction
  let view: V3;
  if (t.kind === 'graph') view = cross(unit(t.x), unit(perp(t.y, unit(t.x))));
  else if (t.kind === 'corner') {
    const s = add(corner!.nA, corner!.nB);
    view = onA && onB ? (len(s) < 1e-6 ? corner!.nA : unit(s)) : onB ? corner!.nB : corner!.nA;
  } else view = m.normal;
  let tilt = 0;
  for (const s of allPts) tilt = Math.max(tilt, Math.acos(Math.max(-1, Math.min(1, dot(s.n, view)))) * DEG);
  if (tilt > maxTilt) {
    return refuse(
      t.kind === 'corner'
        ? `The corner under ${id} is too sharp to work across in one go: its faces turn ${fmt(tilt, 1)} degrees away from the view, more than ${fmt(maxTilt, 0)} -- split the sketch so each part stays on one face.`
        : `The sketch for ${id} wraps too far round the surface: it reaches ${fmt(tilt, 1)} degrees round from where it is placed, more than ${fmt(maxTilt, 0)} -- make it shorter round the surface.`,
      { tiltDeg: tilt },
    );
  }

  // --- the shadow plane: outside the part along the view, axes from the sketch axes
  const op = input.op;
  const h = op.op === 'cut' ? op.depth : op.op === 'raise' ? op.height : 0;
  if (op.op !== 'imprint' && !(h > 0)) return refuse(`The ${op.op === 'cut' ? 'depth' : 'height'} for ${id} must be more than zero.`);
  const floor = op.op === 'imprint' ? 'view' : op.floor ?? 'view';
  if (floor === 'normal' && t.kind !== 'cylinder' && t.kind !== 'sphere') return refuse(`A ${op.op} of ${id} measured square to the surface is only available on round and spherical faces so far; use the view direction instead.`);
  const R = t.kind === 'cylinder' || t.kind === 'sphere' ? t.radius : 0;
  if (floor === 'normal' && op.op === 'cut' && h >= R * 0.5) return refuse(`The cut for ${id} is too deep for this round face (${fmt(h)} mm into a radius of ${fmt(R)} mm).`);
  let hi = -Infinity;
  for (const s of allPts) hi = Math.max(hi, dot(sub(s.p, m.anchor), view));
  const clear = Math.max(0, hi) + (op.op === 'raise' ? h * 1.5 : 0) + (floor === 'normal' && op.op === 'raise' ? h : 0) + 2;
  const O = add(m.anchor, mul(view, clear));
  const ux = unit(perp(m.e1, view));
  const uy = cross(mul(view, -1), ux); // ux x uy = -view: extruding the shadow goes into the part
  const toShadow = (p: V3): V2 => { const r = sub(p, O); return [dot(r, ux), dot(r, uy)]; };
  const fromShadow = (q: V2): V3 => add(add(O, mul(ux, q[0])), mul(uy, q[1]));

  const shadowLoops = mapped.map((l) => ({ closed: l.closed, pieces: l.pieces.map((pc) => pc.surface.map((s) => toShadow(s.p))) }));
  const curves = mapped.map((l) => {
    const pts: V3[] = [];
    l.pieces.forEach((pc, k) => pts.push(...(k === 0 ? pc.surface : pc.surface.slice(1)).map((s) => s.p)));
    if (l.closed && pts.length > 1 && len(sub(pts[0], pts[pts.length - 1])) < 1e-9) pts.pop();
    return { points: pts, closed: l.closed, length: polyLen3(pts, l.closed) };
  });
  // the shadow must not cross itself (the surface region seen along the view is one-to-one)
  for (const sl of shadowLoops) {
    const flat: V2[] = [];
    sl.pieces.forEach((pc, k) => flat.push(...(k === 0 ? pc : pc.slice(1))));
    if (selfCrosses(flat, sl.closed)) return refuse(`The sketch for ${id} folds over itself on the surface as seen from outside, so it cannot be worked from one side.`);
  }

  // --- surface area of the region (sketch area for an unrolling; quadrature otherwise)
  const sketchFlat = input.loops.map(loopPoints);
  const closedAll = input.loops.every((l) => l.closed);
  let surfaceArea: number | undefined;
  if (closedAll) {
    if (m.isometric) surfaceArea = regionArea(sketchFlat, input.loops.map((l) => l.pieces.map((pc) => pc.points)));
    else {
      // area element of the map |J_s x J_t| integrated over the sketch region
      const dd = 1e-4;
      surfaceArea = Math.abs(integrateRegion(sketchFlat, (u, v) => {
        const a = m.at([u, v]).p, js = mul(sub(m.at([u + dd, v]).p, a), 1 / dd), jt = mul(sub(m.at([u, v + dd]).p, a), 1 / dd);
        return len(cross(js, jt));
      }, t.kind === 'graph' ? 100 : 600, t.kind === 'graph' ? 8 : 24));
    }
  }

  const name = (k: string): string => `${id}_${k}`;
  const commands: Cmd[] = [];
  const notes: string[] = [];
  const toolBodies: string[] = [];
  const sketchCmd = (sk: string): Cmd => ({ command: 'sketch.create', params: { name: sk, plane: { origin: O, x_dir: ux, y_dir: uy } } });
  // Marks are checked to 2 um, so fit points crowd in where pieces meet; a prism for cut / raise keeps the plain
  // spacing (solidcore refuses to extrude some of those crowded splines, and the volume check does not need them).
  const emit = (pieces: V2[][], closed: boolean): void => {
    const g0 = groupSmooth(pieces, closed);
    const g = op.op === 'imprint' ? g0 : { ...g0, joins: g0.joins.map(() => []) };
    if (g.periodic) {
      commands.push({ command: 'sketch.spline.fit_point', params: { points: fitPoints(g.groups[0], true, g.joins[0]), periodic: true } });
      return;
    }
    g.groups.forEach((pc, k) => {
      if (straight(pc)) commands.push({ command: 'sketch.line', params: { points: [pc[0], pc[pc.length - 1]] } });
      else commands.push({ command: 'sketch.spline.fit_point', params: { points: fitPoints(pc, false, g.joins[k]) } });
    });
  };

  const prediction: Prediction = { op: op.op, curves, surfaceArea, stretch, tiltDeg: tilt, view };

  if (op.op === 'imprint') {
    // The kernel extends every open curve to the face's edge: only a single smooth closed curve can be marked.
    for (const sl of shadowLoops) {
      if (!sl.closed || !groupSmooth(sl.pieces, true).periodic) {
        return refuse(`${id} can only mark a smooth closed outline (a circle, an oval, a slot, a rectangle with rounded corners) on a curved face for now: an outline with sharp corners or loose ends would be carried on past them to the edge of the face. Cut or raise it instead, by a small depth.`);
      }
    }
    if (t.kind === 'corner' && onA && onB) {
      return refuse(`${id} cannot mark an outline that runs round a corner yet; cut or raise it instead, by a small depth.`);
    }
    // a projection goes through the whole face: split a round face in two first, square to the view, through its
    // centre, so the far side is not marked
    if (t.kind === 'cylinder' || t.kind === 'sphere') {
      const c = t.kind === 'cylinder' ? add(t.origin, mul(unit(t.axis), dot(sub(m.anchor, t.origin), unit(t.axis)))) : t.center;
      commands.push({ command: 'solid.split_face', params: { faces: [m.anchor], body: input.body, plane: { origin: c, normal: view } } });
      prediction.seam = { origin: c, normal: view };
      notes.push('The round face is split in two along the line where it turns away from the view, so the far side is not marked.');
    }
    const sk = name('mark');
    commands.push(sketchCmd(sk));
    for (const sl of shadowLoops) emit(sl.pieces, sl.closed);
    commands.push({ command: 'sketch.finish', params: {} });
    commands.push({ command: 'solid.split_face', params: { faces: [m.anchor], body: input.body, sketch: sk } });
    return { ok: true, commands, prediction, toolBodies, notes };
  }

  // --- cut / raise: a prism of the shadow region along the view, trimmed to a layer of the part
  if (!closedAll) return refuse(`The sketch for ${id} must be closed to ${op.op} it.`);
  const flatShadow = shadowLoops.map((sl) => { const f: V2[] = []; sl.pieces.forEach((pc, k) => f.push(...(k === 0 ? pc : pc.slice(1)))); return f; });
  const shadowArea = regionArea(flatShadow, shadowLoops.map((sl) => sl.pieces));
  const sk = name('shadow');
  commands.push(sketchCmd(sk));
  for (const sl of shadowLoops) emit(sl.pieces, sl.closed);
  commands.push({ command: 'sketch.finish', params: {} });

  // prism length: through the layer, but for round faces only as far as the centre (the far side stays untouched)
  let depthMax = -Infinity;
  for (const s of allPts) depthMax = Math.max(depthMax, dot(sub(O, s.p), view));
  if (t.kind === 'graph') {
    // a dip inside the outline can be deeper than the outline itself: take the whole face's deepest point
    const X = unit(t.x), Y = unit(perp(t.y, X)), N = cross(X, Y);
    for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
      const x = t.bounds.x[0] + ((t.bounds.x[1] - t.bounds.x[0]) * i) / 60, y = t.bounds.y[0] + ((t.bounds.y[1] - t.bounds.y[0]) * j) / 60;
      const p = add(add(add(t.origin, mul(X, x)), mul(Y, y)), mul(N, t.height(x, y).z));
      depthMax = Math.max(depthMax, dot(sub(O, p), view));
    }
  }
  const toCentre = t.kind === 'cylinder' || t.kind === 'sphere'
    ? dot(sub(O, t.kind === 'cylinder' ? add(t.origin, mul(unit(t.axis), dot(sub(m.anchor, t.origin), unit(t.axis)))) : t.center), view)
    : Infinity;
  const L = floor === 'normal' ? toCentre : Math.min(toCentre, depthMax + h + 1);
  if (floor === 'view' && op.op === 'cut' && depthMax + h >= toCentre) return refuse(`The cut for ${id} is too deep for this round face.`);
  const prism = name('prism');
  commands.push({ command: 'solid.extrude', params: { sketch: sk, distance: L, operation: 'new', body_name: prism } });
  toolBodies.push(prism);

  let volumeDelta: number;
  let normalDepth: [number, number];
  const normalsOnRegion = (): number[] => allPts.map((s) => dot(s.n, view));
  if (floor === 'view') {
    const shifted = `${input.body} (2)`;
    const sign = op.op === 'cut' ? -1 : 1;
    commands.push({ command: 'solid.move', params: { bodies: [input.body], translate: mul(view, sign * h), copy: true } });
    toolBodies.push(shifted);
    if (op.op === 'cut') {
      commands.push({ command: 'solid.combine', params: { target: prism, tools: [input.body], operation: 'intersect', keep_tools: true } });
      commands.push({ command: 'solid.combine', params: { target: prism, tools: [shifted], operation: 'cut' } });
      commands.push({ command: 'solid.combine', params: { target: input.body, tools: [prism], operation: 'cut' } });
    } else {
      commands.push({ command: 'solid.combine', params: { target: prism, tools: [shifted], operation: 'intersect' } });
      commands.push({ command: 'solid.combine', params: { target: prism, tools: [input.body], operation: 'cut', keep_tools: true } });
      commands.push({ command: 'solid.combine', params: { target: input.body, tools: [prism], operation: 'join' } });
    }
    volumeDelta = sign * shadowArea * h;
    const ns = normalsOnRegion();
    normalDepth = [h * Math.min(...ns), h * Math.max(...ns)];
    if (t.kind !== 'corner' || (onA && onB)) notes.push(`The ${op.op === 'cut' ? 'floor' : 'top'} follows the surface moved ${fmt(h)} mm along the view direction; square to the surface that is ${fmt(normalDepth[0], 3)} to ${fmt(normalDepth[1], 3)} mm.`);
  } else {
    // round faces: an inner (cut) or outer (raise) coaxial copy at radius R -/+ h
    const off = op.op === 'cut' ? R - h : R + h;
    const ob = name('offset');
    if (t.kind === 'cylinder') {
      const a = unit(t.axis);
      const ext = t.extent ?? [-1e3, 1e3];
      const base = add(t.origin, mul(a, ext[0] - 1));
      commands.push({ command: 'solid.cylinder', params: { radius: off, height: ext[1] - ext[0] + 2, base, axis: a, operation: 'new', body_name: ob } });
    } else commands.push({ command: 'solid.sphere', params: { radius: off, center: (t as SphereTarget).center, operation: 'new', body_name: ob } });
    toolBodies.push(ob);
    // every ray of the region must meet the inner surface (cut) inside the prism
    if (op.op === 'cut') {
      commands.push({ command: 'solid.combine', params: { target: prism, tools: [input.body], operation: 'intersect', keep_tools: true } });
      commands.push({ command: 'solid.combine', params: { target: prism, tools: [ob], operation: 'cut' } });
      commands.push({ command: 'solid.combine', params: { target: input.body, tools: [prism], operation: 'cut' } });
    } else {
      commands.push({ command: 'solid.combine', params: { target: prism, tools: [ob], operation: 'intersect' } });
      commands.push({ command: 'solid.combine', params: { target: prism, tools: [input.body], operation: 'cut', keep_tools: true } });
      commands.push({ command: 'solid.combine', params: { target: input.body, tools: [prism], operation: 'join' } });
    }
    const inner = { ...t, radius: off } as CylinderTarget | SphereTarget;
    let missed = false;
    const thick = (u: number, v: number): number => {
      const o = fromShadow([u, v]);
      const a = rayDepth(t, o, view), b = rayDepth(inner, o, view);
      if (a === null || b === null) { missed = true; return 0; }
      return Math.abs(b - a);
    };
    const vol = integrateRegion(flatShadow, thick);
    if (missed) return refuse(`The ${op.op} for ${id} reaches past the edge of the round face as seen from outside; make it smaller or shallower.`);
    volumeDelta = (op.op === 'cut' ? -1 : 1) * vol;
    normalDepth = [h, h];
    notes.push(`The ${op.op === 'cut' ? 'floor' : 'top'} is ${fmt(h)} mm from the surface, square to it; the side walls run along the view direction.`);
  }
  prediction.volumeDelta = volumeDelta;
  prediction.normalDepth = normalDepth;
  return { ok: true, commands, prediction, toolBodies, notes };
}

/** The sentence for a surface sketch the kernel refused, or whose result did not match its prediction. */
export function surfaceRefusal(id: string, op: SurfaceOp['op'], why: 'kernel' | 'mismatch'): string {
  const what = op === 'cut' ? 'cut' : op === 'raise' ? 'raised part' : 'outline';
  return why === 'kernel'
    ? `The ${what} for ${id} could not be built on this face, so the part is shown without it -- try a smaller or simpler outline.`
    : `The ${what} for ${id} did not come out where the sketch put it, so the part is shown without it -- try a smaller or simpler outline.`;
}

function selfCrosses(pts: V2[], closed: boolean): boolean {
  // coarse: test a decimated copy (crossings of a dense smooth outline survive decimation)
  const step = Math.max(1, Math.floor(pts.length / 400));
  const q = pts.filter((_, i) => i % step === 0);
  const n = q.length, segs = closed ? n : n - 1;
  const cr = (a: V2, b: V2, c: V2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < segs; i++) {
    const a = q[i], b = q[(i + 1) % n];
    for (let j = i + 2; j < segs; j++) {
      if (closed && i === 0 && j === segs - 1) continue;
      const c = q[j], d = q[(j + 1) % n];
      if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// verification against the built part

export interface EdgeView {
  start: V3;
  mid: V3;
  end: V3;
  length: number;
}
export interface VerifyInput {
  prediction: Prediction;
  /** inspect.measure volumes of the body before and after (cut / raise). */
  volumeBefore?: number;
  volumeAfter?: number;
  /** model.edges of the body before and after the imprint. */
  edgesBefore?: EdgeView[];
  edgesAfter?: EdgeView[];
  /** Relative volume tolerance (default 2e-4 of the change, plus 1e-9 of the body for the kernel's own rounding). */
  volumeRelTol?: number;
  /** How far (mm) an imprinted edge point may be from the predicted curve. Default 2e-3. */
  curveTol?: number;
}
export type VerifyResult = { ok: true; measured: Record<string, number> } | { ok: false; reason: string; measured: Record<string, number> };

function distToPolyline(p: V3, pts: V3[], closed: boolean): number {
  let best = Infinity;
  const n = pts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n], ab = sub(b, a), L2 = dot(ab, ab);
    const tt = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
    best = Math.min(best, len(sub(p, add(a, mul(ab, tt)))));
  }
  return best;
}

/** Compare the built part with the prediction. A mismatch is a refusal, not a warning. */
export function verifySurfaceSketch(v: VerifyInput): VerifyResult {
  const P = v.prediction;
  if (P.op !== 'imprint') {
    const before = v.volumeBefore ?? NaN, after = v.volumeAfter ?? NaN;
    const got = after - before, want = P.volumeDelta ?? NaN;
    // relative to the CHANGE: a floor tied to the body's size would let a wrong small feature on a big part through
    const tol = Math.abs(want) * (v.volumeRelTol ?? 2e-4) + 1e-9 * Math.abs(before) + 1e-6;
    const measured = { volumeBefore: before, volumeAfter: after, volumeDelta: got, predicted: want, relError: Math.abs(got - want) / Math.max(1e-12, Math.abs(want)) };
    if (!(Math.abs(got - want) <= tol)) return { ok: false, reason: `the part changed by ${fmt(got, 4)} mm3 where ${fmt(want, 4)} mm3 was expected`, measured };
    return { ok: true, measured };
  }
  const tol = v.curveTol ?? 2e-3;
  const before = v.edgesBefore ?? [], after = v.edgesAfter ?? [];
  const onCurve = (e: EdgeView): boolean => P.curves.some((c) => [e.start, e.mid, e.end].every((q) => distToPolyline(q, c.points, c.closed) <= tol));
  const sum = (es: EdgeView[]): number => es.reduce((s, e) => s + e.length, 0);
  const inSeam = (e: EdgeView): boolean => !!P.seam && [e.start, e.mid, e.end].every((q) => Math.abs(dot(sub(q, P.seam!.origin), P.seam!.normal)) <= tol);
  const marked = after.filter(onCurve), rest = after.filter((e) => !onCurve(e) && !inSeam(e));
  const want = P.curves.reduce((s, c) => s + c.length, 0);
  const measured = { markedEdges: marked.length, markedLength: sum(marked), predictedLength: want, otherLengthBefore: sum(before), otherLengthAfter: sum(rest) };
  // every predicted point is reached by a marked edge point within the longest marked edge
  const pts = marked.flatMap((e) => [e.start, e.mid, e.end]);
  const longest = Math.max(0, ...marked.map((e) => e.length));
  for (const c of P.curves) {
    const stride = Math.max(1, Math.floor(c.points.length / 200));
    for (let i = 0; i < c.points.length; i += stride) {
      const q = c.points[i];
      if (!pts.some((p) => len(sub(p, q)) <= longest / 2 + tol)) return { ok: false, reason: 'the marked outline does not follow the whole sketch', measured };
    }
  }
  if (Math.abs(measured.markedLength - want) > 0.01 * want) return { ok: false, reason: `the marked outline is ${fmt(measured.markedLength, 4)} mm long where ${fmt(want, 4)} mm was expected`, measured };
  if (Math.abs(measured.otherLengthAfter - measured.otherLengthBefore) > 1e-3 * Math.max(1, measured.otherLengthBefore)) {
    return { ok: false, reason: 'the face was marked in places the sketch does not reach', measured };
  }
  return { ok: true, measured };
}
