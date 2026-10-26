// TypeScript port of docs/spikes/solidcraft-referee/contract/booleans.slow.mjs (the booleans group's PREDICTIVE guard for kernel slowness; pure functions, no kernel).
// Behaviour-preserving: same arithmetic, same thresholds, same verdicts, line for line. A malformed primitive throws the same TypeError as the original (the callers turn it into
// the same translator-error refusal), so no field read here is made safer than it was.
//
// Measured in the original (booleans-r4/cost-grid1.jsonl, cost-grid2.jsonl): the kernel's boolean needs minutes of CPU whenever the CURVED SIDE of a cylinder or cone meets a FLAT
// FACE that is neither square to the axis nor parallel to it (the intersection curve is a slanted ellipse), and a few seconds when every flat face is square to the axis or parallel to it.
//   orient(id, ...)       walks a handle back through the feature list and returns the axes of its round parts and the normals of its flat faces
//   slantedMeeting(a, b)  the verdict for a pair of operands: 'slant' (predicted slow), 'unread' (an operand could not be read: NOT refused), or null
import type { V3 } from './types.js';

export const EPS_AXIS = 1e-6;
type Vec = number[];
const dot = (u: Vec, v: Vec): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u: Vec, v: Vec): Vec => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const norm = (v: Vec): number => Math.hypot(v[0], v[1], v[2]);
const unit = (v: Vec): Vec => { const n = norm(v); return n < 1e-12 ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n]; };
const add = (u: Vec, v: Vec): Vec => [u[0] + v[0], u[1] + v[1], u[2] + v[2]];
const sub = (u: Vec, v: Vec): Vec => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const scale = (v: Vec, k: number): Vec => [v[0] * k, v[1] * k, v[2] * k];
const canon = (v: Vec): Vec => { const u = unit(v); const s = (u.find((x) => Math.abs(x) > 1e-9) ?? 1) < 0 ? -1 : 1; return u.map((x) => Math.round(x * s * 1e9) / 1e9 + 0); }; // a normal and its negative are the same plane direction

/** The fields of a ModelDoc feature this module reads (loose on purpose: a malformed doc fails the same way as in the original). */
export interface SlowFeat {
  id?: string;
  kind: string;
  rotate?: Vec;
  center?: Vec;
  size?: Vec;
  radius?: number;
  height?: number;
  round?: number;
  roundStyle?: string;
  sides?: number;
  width?: number;
  depth?: number;
  ringRadius?: number;
  tubeRadius?: number;
  target?: string;
  targets?: string[];
  into?: string;
  plane?: string;
  mode?: string;
  count?: number;
  axis?: string;
  totalAngle?: number;
  angles?: Vec;
  angle?: number;
  taper?: number;
  direction?: unknown;
  countersink?: unknown;
}

/** R = Rz * Ry * Rx for the translator's [x, y, z] degrees (the same order as every turn in this group) */
export function rotMat(rot: Vec | undefined | null): number[][] {
  const d = Math.PI / 180; const [ax, ay, az] = (rot ?? [0, 0, 0]).map((v) => v * d);
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]; const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]; const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (A: number[][], B: number[][]): number[][] => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  return mul(Rz, mul(Ry, Rx));
}
const apply = (R: number[][], v: Vec): Vec => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);

/** What orient() knows about a handle: the axes of its round parts, the normals of its flat faces, and whether anything could not be read. */
export interface Orient { cyl: Vec[]; cone: Vec[]; torus: Vec[]; sphere: boolean; normals: Vec[]; unknownPlanes: boolean; unknownCurved: boolean }
const empty = (): Orient => ({ cyl: [], cone: [], torus: [], sphere: false, normals: [], unknownPlanes: false, unknownCurved: false });
const merge = (...xs: Orient[]): Orient => {
  const o = empty();
  for (const x of xs) { o.cyl.push(...x.cyl); o.cone.push(...x.cone); o.torus.push(...x.torus); o.sphere ||= x.sphere; o.normals.push(...x.normals); o.unknownPlanes ||= x.unknownPlanes; o.unknownCurved ||= x.unknownCurved; }
  const dd = (a: Vec[]): Vec[] => { const seen = new Set<string>(); return a.filter((v) => { const k = canon(v).join(','); if (seen.has(k)) return false; seen.add(k); return true; }); };
  o.cyl = dd(o.cyl); o.cone = dd(o.cone); o.torus = dd(o.torus); o.normals = dd(o.normals);
  return o;
};
const mapVec = (x: Orient, fn: (v: Vec) => Vec): Orient => ({ ...x, cyl: x.cyl.map(fn), cone: x.cone.map(fn), torus: x.torus.map(fn), normals: x.normals.map(fn) });
const MIRROR_N: Record<string, Vec> = { xy: [0, 0, 1], xz: [0, 1, 0], yz: [1, 0, 0] };
const PLANE_WORD: Record<string, Vec> = { 'left-right': [1, 0, 0], 'front-back': [0, 1, 0], 'top-bottom': [0, 0, 1] };
const AXIS_V: Record<string, Vec> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** orientation info of one primitive feature (kind, rotate) */
export function primInfo(f: SlowFeat): Orient {
  const R = rotMat(f.rotate); const ax = (i: number): Vec => apply(R, [[1, 0, 0], [0, 1, 0], [0, 0, 1]][i]);
  const o = empty();
  const z = ax(2);
  if (f.kind === 'box') { o.normals = [ax(0), ax(1), ax(2)]; if (f.round) { o.cyl = [ax(0), ax(1), ax(2)]; o.sphere = true; } }
  else if (f.kind === 'cylinder') { o.cyl = [z]; o.normals = [z]; if (f.round) o.torus = [z]; }
  else if (f.kind === 'cone') { o.cone = [z]; o.normals = [z]; }
  else if (f.kind === 'sphere') o.sphere = true;
  else if (f.kind === 'torus') o.torus = [z];
  else if (f.kind === 'prism') { const n = Math.max(3, Math.min(12, Math.round(f.sides!))); o.normals = [z]; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * (i + 0.5) / n; o.normals.push(apply(R, [Math.cos(a), Math.sin(a), 0])); } }
  else if (f.kind === 'wedge') { o.normals = [z, apply(R, [0, -1, 0]), apply(R, [-1, 0, 0]), apply(R, unit([f.depth!, f.width!, 0]))]; }
  else { o.unknownPlanes = true; o.unknownCurved = true; }
  o.normals = o.normals.map(canon);
  return o;
}

/** What the host knows about a sketch: its normal, the in-plane normals of its straight edges, whether it has arcs, and the axis of a spin (the sketch's v). */
export interface SketchRead { n: Vec; edgeNormals: Vec[]; arcs: boolean; axis?: Vec }
export type SketchInfoFn = (sketchId: string) => SketchRead | null;

/**
 * orient(id, featById, sketchInfo) -> info. sketchInfo(sketchId) -> {n, edgeNormals:[vec], arcs:boolean, axis?:vec} or null (cannot read: the result is marked unknown).
 * Everything is conservative in the direction of "more surfaces": a union of what the inputs bring.
 */
export function orient(id: string, featById: Record<string, SlowFeat>, sketchInfo: SketchInfoFn | null, affects: Record<string, string[]> = {}, _seen: Set<string> = new Set()): Orient {
  const base = orient1(id, featById, sketchInfo, affects, _seen);
  // a hole / pocket / groove / shell / fillet / draft leaves its target's id pointing at the changed part: those features belong to the handle too
  const extra = (affects[id] ?? []).filter((a) => !_seen.has(a)).map((a) => orient1(a, featById, sketchInfo, affects, new Set([..._seen, id])));
  return extra.length ? merge(base, ...extra) : base;
}
function orient1(id: string, featById: Record<string, SlowFeat>, sketchInfo: SketchInfoFn | null, affects: Record<string, string[]>, _seen: Set<string>): Orient {
  const f = featById[id];
  if (!f || _seen.has(id)) { const o = empty(); o.unknownPlanes = true; o.unknownCurved = true; return o; }
  const seen = new Set(_seen); seen.add(id);
  const rec = (t: string): Orient => (seen.has(t) ? empty() : orient(t, featById, sketchInfo, affects, seen));
  switch (f.kind) {
    case 'box': case 'cylinder': case 'sphere': case 'cone': case 'torus': case 'prism': case 'wedge': return primInfo(f);
    case 'combine': return merge(...f.targets!.map(rec));
    case 'rotate': { const R = rotMat(f.angles); return mapVec(rec(f.target!), (v) => canon(apply(R, v))); }
    case 'move': return rec(f.target!);
    case 'shell': return rec(f.target!);
    case 'mirror': {
      const c = rec(f.target!); const n = unit(PLANE_WORD[f.plane!] ?? MIRROR_N[f.plane!] ?? [1, 0, 0]);
      return merge(c, mapVec(c, (v) => canon(sub(v, scale(n, 2 * dot(v, n))))));
    }
    case 'pattern': {
      const c = rec(f.target!);
      if (f.mode !== 'circular') return c;
      const R0 = (a: number): number[][] => { const d = a * Math.PI / 180; const k = AXIS_V[f.axis ?? 'z']; const [x, y, z] = k; const cs = Math.cos(d), sn = Math.sin(d); return [[cs + x * x * (1 - cs), x * y * (1 - cs) - z * sn, x * z * (1 - cs) + y * sn], [y * x * (1 - cs) + z * sn, cs + y * y * (1 - cs), y * z * (1 - cs) - x * sn], [z * x * (1 - cs) - y * sn, z * y * (1 - cs) + x * sn, cs + z * z * (1 - cs)]]; };
      const step = (f.totalAngle ?? 360) / (f.totalAngle === 360 || f.totalAngle === undefined ? f.count! : Math.max(1, f.count! - 1));
      return merge(c, ...Array.from({ length: Math.max(0, f.count! - 1) }, (_, i) => { const R = R0(step * (i + 1)); return mapVec(c, (v) => canon(apply(R, v))); }));
    }
    case 'fillet': { // every edge of the part gets a round: its axis is the direction of an edge, i.e. a cross product of two face normals
      const c = rec(f.target!); const ax: Vec[] = [];
      for (let i = 0; i < c.normals.length; i++) for (let j = i + 1; j < c.normals.length; j++) { const w = cross(c.normals[i], c.normals[j]); if (norm(w) > 1e-6) ax.push(canon(w)); }
      return merge(c, { ...empty(), cyl: ax, sphere: true, unknownPlanes: c.unknownPlanes, unknownCurved: c.unknownCurved });
    }
    case 'draft': { const c = rec(f.target!); return { ...c, unknownPlanes: true }; } // a drafted wall is slanted by an angle the list does not give
    case 'hole': { const c = rec(f.target!); const a = AXIS_V[f.axis ?? 'z']; return merge(c, { ...empty(), cyl: [a], normals: [a], cone: f.countersink ? [a] : [] }); }
    case 'extrude': case 'revolve': case 'groove': case 'pocket': {
      const base = (f.kind === 'groove' || f.kind === 'pocket') ? rec(f.into!) : empty();
      const sk = sketchInfo ? sketchInfo(f.target!) : null;
      if (!sk) return merge(base, { ...empty(), unknownPlanes: true, unknownCurved: true });
      const o = empty();
      if (f.kind === 'extrude' || f.kind === 'pocket') { o.normals = [sk.n, ...sk.edgeNormals]; if (sk.arcs) o.cyl = [sk.n]; if (f.taper || f.direction) o.unknownPlanes = true; }
      else { o.normals = [sk.n]; const ax = sk.axis ?? sk.n; o.cyl = [ax]; o.cone = [ax]; o.unknownPlanes = false; } // a spin: cylinders and cones about its axis, flat rings square to it
      o.normals = o.normals.map(canon);
      return merge(base, o);
    }
    default: { const o = empty(); o.unknownPlanes = true; o.unknownCurved = true; return o; }
  }
}

const slantedAxisNormal = (a: Vec, n: Vec): boolean => { const c = Math.abs(dot(unit(a), unit(n))); return c > EPS_AXIS && c < 1 - EPS_AXIS; };
/** the verdict from orientation alone: does a round axis of one operand sit at a slant to a flat-face normal of the other? */
export function orientSlant(IA: Orient, IB: Orient): 'slant' | 'unread' | null {
  let unread = false;
  for (const [X, Y] of [[IA, IB], [IB, IA]]) {
    const axes = [...X.cyl, ...X.cone];
    if (!axes.length) continue;
    if (Y.unknownPlanes) unread = true;
    for (const a of axes) for (const n of Y.normals) if (slantedAxisNormal(a, n)) return 'slant';
  }
  for (const [X] of [[IA], [IB]]) if (X.unknownCurved) unread = true;
  return unread ? 'unread' : null;
}

// ---- exact geometry for two PLAIN primitives (feature kind + center + rotate) ----------------------------------------------------------
const frameOf = (f: SlowFeat): { R: number[][]; c: Vec; ax: Vec[] } => { const R = rotMat(f.rotate); return { R, c: f.center ?? [0, 0, 0], ax: [0, 1, 2].map((j) => [R[0][j], R[1][j], R[2][j]]) }; };
interface Plane { n: Vec; d: number }
/** half-spaces {n (outward unit normal), d} of a convex polytope primitive in the world, or null. The body is built about its own centre c, turned (R = Rz Ry Rx) and moved to c, so the plane n_local.x = dLocal becomes n.p = dLocal + n.c with n = R n_local. */
function polytope(f: SlowFeat): Plane[] | null {
  const { R, c } = frameOf(f);
  const planes: Plane[] = [];
  const place = (nLocal: Vec, dLocal: number): void => { const n = unit(apply(R, nLocal)); planes.push({ n, d: dLocal + dot(n, c) }); };
  if (f.kind === 'box') { const [sx, sy, sz] = f.size!; place([1, 0, 0], sx / 2); place([-1, 0, 0], sx / 2); place([0, 1, 0], sy / 2); place([0, -1, 0], sy / 2); place([0, 0, 1], sz / 2); place([0, 0, -1], sz / 2); return planes; }
  if (f.kind === 'prism') { const n = Math.max(3, Math.min(12, Math.round(f.sides!))); const ap = f.radius! * Math.cos(Math.PI / n); for (let i = 0; i < n; i++) { const a = 2 * Math.PI * (i + 0.5) / n; place([Math.cos(a), Math.sin(a), 0], ap); } place([0, 0, 1], f.height! / 2); place([0, 0, -1], f.height! / 2); return planes; }
  if (f.kind === 'wedge') { // triangle (-w/2,-d/2) (w/2,-d/2) (-w/2,d/2) extruded along z about the centre; the slanted face passes through the local origin
    const w = f.width!, d = f.depth!;
    place([0, -1, 0], d / 2); place([-1, 0, 0], w / 2); place(unit([d, w, 0]), 0); place([0, 0, 1], f.height! / 2); place([0, 0, -1], f.height! / 2); return planes;
  }
  return null;
}
const insidePolytope = (planes: Plane[], p: Vec, tol: number): boolean => planes.every((pl) => dot(pl.n, p) - pl.d <= tol);
interface CylS { a: Vec; u: Vec; v: Vec; h: number; r: number; c: Vec; nTheta: number }
/** points around the two rims of a cylinder primitive, and samples along its side */
function cylSamples(f: SlowFeat, nTheta = 720): CylS {
  const { c, ax } = frameOf(f); const a = ax[2]; const u = ax[0]; const v = ax[1]; const h = f.height! / 2; const r = f.radius!;
  const centre = (f.rotate && f.rotate.some((x) => x)) ? c : c; // after the move the centre is c either way
  return { a, u, v, h, r, c: centre, nTheta };
}
/** does the SIDE of the cylinder primitive cross a face plane (slanted to its axis) of the polytope, inside the polytope's face? */
function cylSideMeetsSlantedFace(cf: SlowFeat, pf: SlowFeat): boolean | null {
  const cs = cylSamples(cf); const planes = polytope(pf); if (!planes) return null;
  const tol = 1e-7 * Math.max(1, cs.r, cs.h);
  for (const pl of planes) {
    const k = dot(pl.n, cs.a);
    if (!(Math.abs(k) > EPS_AXIS && Math.abs(k) < 1 - EPS_AXIS)) continue; // square or parallel to the axis: circle or lines, fast
    for (let i = 0; i < cs.nTheta; i++) {
      const th = 2 * Math.PI * i / cs.nTheta; const q = add(cs.c, add(scale(cs.u, cs.r * Math.cos(th)), scale(cs.v, cs.r * Math.sin(th))));
      const t = (pl.d - dot(pl.n, q)) / k; // slide along the axis until the point lies on the plane
      if (Math.abs(t) > cs.h + tol) continue; // beyond the cylinder's ends
      const p = add(q, scale(cs.a, t));
      if (insidePolytope(planes, p, 1e-6 * Math.max(1, cs.r))) return true; // the ellipse reaches the face
    }
  }
  return false;
}
/** is the cylinder primitive wholly inside the polytope primitive (both rims in, convexity does the rest)? */
function cylInsidePolytope(cf: SlowFeat, pf: SlowFeat): boolean | null {
  const cs = cylSamples(cf, 180); const planes = polytope(pf); if (!planes) return null;
  for (const s of [-1, 1]) for (let i = 0; i < cs.nTheta; i++) {
    const th = 2 * Math.PI * i / cs.nTheta; const p = add(add(cs.c, scale(cs.a, s * cs.h)), add(scale(cs.u, cs.r * Math.cos(th)), scale(cs.v, cs.r * Math.sin(th))));
    if (!insidePolytope(planes, p, -1e-6 * Math.max(1, cs.r))) return false;
  }
  return true;
}
/** is cylinder primitive B wholly inside cylinder primitive A (strictly)? */
export function cylInsideCyl(Bf: SlowFeat, Af: SlowFeat): boolean {
  const b = cylSamples(Bf, 180); const a = cylSamples(Af, 8);
  for (const s of [-1, 1]) for (let i = 0; i < b.nTheta; i++) {
    const th = 2 * Math.PI * i / b.nTheta; const p = add(add(b.c, scale(b.a, s * b.h)), add(scale(b.u, b.r * Math.cos(th)), scale(b.v, b.r * Math.sin(th))));
    const rel = sub(p, a.c); const axial = dot(rel, a.a); const rad = norm(sub(rel, scale(a.a, axial)));
    if (!(Math.abs(axial) < a.h - 1e-6 * Math.max(1, a.r) && rad < a.r - 1e-6 * Math.max(1, a.r))) return false;
  }
  return true;
}
const POLY = new Set(['box', 'prism', 'wedge']);
/**
 * Verdict for a pair of operands. A, B: {info, prim (feature or null), lo, hi}. Returns 'slant' | 'unread' | null.
 * The caller has already established that the bounding boxes overlap (otherwise no surface meets).
 */
export function slantedMeeting(A: { info: Orient; prim: SlowFeat | null }, B: { info: Orient; prim: SlowFeat | null }): 'slant' | 'unread' | null {
  const v = orientSlant(A.info, B.info);
  if (v !== 'slant') return v;
  // two plain primitives: look at the real geometry
  for (const [X, Y] of [[A, B], [B, A]]) {
    if (X.prim?.kind === 'cylinder' && !X.prim.round && Y.prim && POLY.has(Y.prim.kind) && !Y.prim.round) {
      if (cylInsidePolytope(X.prim, Y.prim)) return null; // surfaces never meet
      const m = cylSideMeetsSlantedFace(X.prim, Y.prim);
      if (m === false) return null;
      if (m === true) return 'slant';
    }
  }
  return 'slant';
}

// ---- a rounded box (whole-shape round, fillet style) meeting a cylinder or ball: the kernel needs minutes only when the round shape's surface reaches the fillet band ---------------
// MEASURED: booleans-r3 r3-rnd-join-cyl 4.2 s, r3-rnd-cut-cyl 3.5 s (the bore stays in the flat of the faces), r4-op-round-keep >100 s (a big cylinder crosses the rounded vertical AND horizontal edges).
/** true: some point of the cylinder / ball surface lies inside the part and within the round radius of two faces (the fillet band); false: it does not; null: cannot tell */
export function roundBandHit(boxFeat: SlowFeat | null | undefined, other: SlowFeat): boolean | null {
  if (!boxFeat || boxFeat.kind !== 'box' || !boxFeat.round || boxFeat.roundStyle === 'chamfer') return null;
  const planes = polytope(boxFeat); if (!planes) return null;
  const rf = boxFeat.round; const tol = 1e-6 * Math.max(1, ...boxFeat.size!);
  const test = (p: Vec): boolean => {
    const gaps = planes.map((pl) => pl.d - dot(pl.n, p));
    if (gaps.some((g) => g < -tol)) return false; // outside the part
    return gaps.filter((g) => g < rf + tol).length >= 2; // within the round radius of two faces: in the band of an edge or corner
  };
  if (other.kind === 'cylinder' && !other.round) {
    const cs = cylSamples(other, 360);
    for (let k = 0; k <= 60; k++) {
      const t = -cs.h + 2 * cs.h * k / 60;
      for (let i = 0; i < cs.nTheta; i++) { const th = 2 * Math.PI * i / cs.nTheta; if (test(add(add(cs.c, scale(cs.a, t)), add(scale(cs.u, cs.r * Math.cos(th)), scale(cs.v, cs.r * Math.sin(th)))))) return true; }
    }
    return false;
  }
  if (other.kind === 'sphere') {
    const c = other.center ?? [0, 0, 0]; const r = other.radius!;
    for (let i = 0; i <= 90; i++) { const ph = Math.PI * i / 90; for (let j = 0; j < 180; j++) { const th = 2 * Math.PI * j / 180; if (test([c[0] + r * Math.sin(ph) * Math.cos(th), c[1] + r * Math.sin(ph) * Math.sin(th), c[2] + r * Math.cos(ph)])) return true; } }
    return false;
  }
  return null;
}

export type { V3 };
