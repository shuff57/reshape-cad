// SPIKE, referee only. An INDEPENDENT closed form for planar convex solids: intersect half-spaces, return exact volume and centre of
// mass. No kernel is involved (not OCCT, not brep-rs, not truck), so it can arbitrate when the oracles disagree or refuse.
//
//   planes: [{ n:[x,y,z] (unit, outward), d }]  meaning  n . p <= d
//   hollow(planes, openIndex, t): outer minus inner, where inner shifts every plane except the open one inwards by t
//   The open face's own plane is NOT shifted: the cavity runs out through it.
let B = 1e4; // starting cube half-size, far outside any fixture; solid() raises it to 10x the largest plane offset

function startCube() {
  const v = (x, y, z) => [x, y, z];
  const c = [v(-B, -B, -B), v(B, -B, -B), v(B, B, -B), v(-B, B, -B), v(-B, -B, B), v(B, -B, B), v(B, B, B), v(-B, B, B)];
  // faces as vertex loops, CCW seen from outside
  return [
    [c[0], c[3], c[2], c[1]], [c[4], c[5], c[6], c[7]],
    [c[0], c[1], c[5], c[4]], [c[2], c[3], c[7], c[6]],
    [c[1], c[2], c[6], c[5]], [c[3], c[0], c[4], c[7]],
  ];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };

function clip(faces, n, d) {
  const out = []; const cut = [];
  const eps = 1e-12;
  for (const f of faces) {
    const res = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const da = dot(n, a) - d, db = dot(n, b) - d;
      if (da <= eps) res.push(a);
      if ((da < -eps && db > eps) || (da > eps && db < -eps)) {
        const t = da / (da - db);
        const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
        res.push(p); cut.push(p);
      } else if (Math.abs(da) <= eps) cut.push(a);
    }
    if (res.length >= 3) out.push(res);
  }
  // cap
  const uniq = [];
  for (const p of cut) if (!uniq.some((q) => Math.hypot(...sub(p, q)) < 1e-7)) uniq.push(p);
  if (uniq.length >= 3) {
    const c = [0, 1, 2].map((i) => uniq.reduce((s, p) => s + p[i], 0) / uniq.length);
    const e1 = norm(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));
    const e2 = cross(n, e1);
    uniq.sort((p, q) => Math.atan2(dot(sub(p, c), e2), dot(sub(p, c), e1)) - Math.atan2(dot(sub(q, c), e2), dot(sub(q, c), e1)));
    out.push(uniq);
  }
  return out;
}
export function solid(planes) {
  B = Math.max(1e3, 10 * Math.max(...planes.map((p) => Math.abs(p.d)), 1));
  let faces = startCube();
  for (const p of planes) faces = clip(faces, p.n, p.d);
  return faces;
}
export function volCom(faces) {
  let V = 0; const C = [0, 0, 0];
  for (const f of faces) {
    for (let i = 1; i < f.length - 1; i++) {
      const a = f[0], b = f[i], c = f[i + 1];
      const v = dot(a, cross(b, c)) / 6;
      V += v;
      for (let k = 0; k < 3; k++) C[k] += v * (a[k] + b[k] + c[k]) / 4;
    }
  }
  return { volume: Math.abs(V), com: C.map((v) => v / V), faces: faces.length };
}
export function bboxOf(faces) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of faces) for (const p of f) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return [...lo, ...hi];
}
export const measure = (planes) => { const s = solid(planes); return { ...volCom(s), bbox: bboxOf(s) }; };

// ---- shapes -------------------------------------------------------------------------------------------------------------
const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
/** box planes, order: +x -x +y -y +z -z */
export function boxPlanes(lo, hi) {
  return [
    { n: [1, 0, 0], d: hi[0] }, { n: [-1, 0, 0], d: -lo[0] },
    { n: [0, 1, 0], d: hi[1] }, { n: [0, -1, 0], d: -lo[1] },
    { n: [0, 0, 1], d: hi[2] }, { n: [0, 0, -1], d: -lo[2] },
  ];
}
export const PLANE_INDEX = { '+x': 0, '-x': 1, '+y': 2, '-y': 3, '+z': 4, '-z': 5 };
/** regular n-gon prism along z (vertex at angle 0, as occt-build). planes: n side faces then +z, -z */
export function prismPlanes(sides, radius, height, center = [0, 0, 0]) {
  const a = radius * Math.cos(Math.PI / sides);
  const out = [];
  for (let i = 0; i < sides; i++) {
    const ang = 2 * Math.PI * (i + 0.5) / sides;
    const n = [Math.cos(ang), Math.sin(ang), 0];
    out.push({ n, d: a + dot(n, center) });
  }
  out.push({ n: [0, 0, 1], d: center[2] + height / 2 }, { n: [0, 0, -1], d: -(center[2] - height / 2) });
  return out;
}
/** convex polygon prism (points CCW in the plane z=base) */
export function polyPrismPlanes(pts, z0, z1) {
  const out = []; const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const e = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(...e);
    const nn = [e[1] / l, -e[0] / l, 0];
    out.push({ n: nn, d: nn[0] * a[0] + nn[1] * a[1] });
  }
  out.push({ n: [0, 0, 1], d: z1 }, { n: [0, 0, -1], d: -z0 });
  return out;
}
export function wedgePlanes(w, dep, h, center = [0, 0, 0]) {
  const pts = [[-w / 2, -dep / 2], [w / 2, -dep / 2], [-w / 2, dep / 2]].map((p) => [p[0] + center[0], p[1] + center[1]]);
  return polyPrismPlanes(pts, center[2] - h / 2, center[2] + h / 2);
}
/** rotate planes about the origin (x then y then z, degrees), as the translator rotates a primitive */
export function rotatePlanes(planes, r) {
  const rot = (p) => {
    let [x, y, z] = p;
    const R = (a) => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)];
    if (r[0]) { const [c, s] = R(r[0]); [y, z] = [c * y - s * z, s * y + c * z]; }
    if (r[1]) { const [c, s] = R(r[1]); [x, z] = [c * x + s * z, -s * x + c * z]; }
    if (r[2]) { const [c, s] = R(r[2]); [x, y] = [c * x - s * y, s * x + c * y]; }
    return [x, y, z];
  };
  return planes.map((p) => ({ n: rot(p.n), d: p.d })); // a rotation about the origin leaves d unchanged
}
export function translatePlanes(planes, t) {
  return planes.map((p) => ({ n: p.n, d: p.d + dot(p.n, t) }));
}
/** hollow: shift every plane but `open` inwards by t. The result is outer minus inner. */
export function hollow(planes, openIdx, t) {
  const outer = measure(planes);
  const inner = measure(planes.map((p, i) => (i === openIdx ? p : { n: p.n, d: p.d - t })));
  const V = outer.volume - inner.volume;
  const com = outer.com.map((c, k) => (outer.volume * c - inner.volume * inner.com[k]) / V);
  return { volume: V, com, outer, inner, bbox: outer.bbox };
}
/**
 * draft one face: rotate the plane about the line {n0 . p = d0, pull . p = neutral} by `deg`. sigma (+1 or -1) is the convention:
 * +1 leans the face OUTWARD as the pull coordinate grows past the neutral plane (the body gets wider with height for a positive angle).
 */
export function draftPlane(plane, pull, neutral, deg, sigma) {
  const a = deg * Math.PI / 180;
  const p = AX[pull];
  if (Math.abs(dot(plane.n, p)) > 1e-9) throw new Error('draftPlane: the face is not parallel to the pull direction');
  // the normal leans along the pull direction; the line {on the face, pull coordinate = neutral} stays fixed
  const n = norm([plane.n[0] * Math.cos(a) - sigma * p[0] * Math.sin(a), plane.n[1] * Math.cos(a) - sigma * p[1] * Math.sin(a), plane.n[2] * Math.cos(a) - sigma * p[2] * Math.sin(a)]);
  const p0 = [plane.n[0] * plane.d + p[0] * neutral, plane.n[1] * plane.d + p[1] * neutral, plane.n[2] * plane.d + p[2] * neutral];
  return { n, d: dot(n, p0) };
}

// ---- which plane does a face word name? (the OCCT resolver's rule: furthest centre along the word, ties to the larger face) --------
export function faceInfo(faces, plane) {
  const mine = faces.filter((f) => f.every((p) => Math.abs(dot(plane.n, p) - plane.d) < 1e-6));
  if (!mine.length) return null;
  const f = mine[0];
  let A = 0; const C = [0, 0, 0];
  for (let i = 1; i < f.length - 1; i++) {
    const a = f[0], b = f[i], c = f[i + 1];
    const ar = Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
    A += ar; for (let k = 0; k < 3; k++) C[k] += ar * (a[k] + b[k] + c[k]) / 3;
  }
  return { area: A, centre: C.map((v) => v / A) };
}
export function wordPlane(planes, word) {
  const dir = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }[word];
  const faces = solid(planes);
  let best = -1, bs = -Infinity, ba = -Infinity, ties = 0;
  planes.forEach((p, i) => {
    const fi = faceInfo(faces, p); if (!fi) return;
    const s = dot(fi.centre, dir);
    if (s > bs + 1e-7) { best = i; bs = s; ba = fi.area; ties = 1; }
    else if (Math.abs(s - bs) <= 1e-7) { ties++; if (fi.area > ba) { best = i; ba = fi.area; } }
  });
  return { index: best, ties };
}
