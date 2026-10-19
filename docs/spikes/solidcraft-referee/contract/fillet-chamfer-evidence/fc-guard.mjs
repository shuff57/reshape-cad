// SPIKE, referee only. THE CONTRACT GUARD for round()/bevel() of one named edge. A pure function over the topology snapshot the phase 4+ bridge already
// produces (model.faces / model.edges of the target body just BEFORE the blend: faces with centroid / plane_normal / area / name, edges with
// start / mid / end / length / persistent `A|B` name), the pick point the translator is about to send, the size and the style.
// Nothing here runs a kernel. The product page has to run it between "name resolved to a pick point" and "send solid.fillet / solid.chamfer".
//
// What it replaces. Round 2 listed three CANDIDATE guards (G1 face count, G2 box face extent, G3 b/a ratio). Measured against the shipping pane they
// do not cover (a) a blend whose footprint reaches an EARLIER hole or pocket, (b) a chamfer on a concave pocket corner longer than the wall. This is one
// geometric rule that covers all of them, and it is evaluated on the real truck topology (fc-eval.mjs).
//
//   The blend REMOVES (or, on a concave edge, ADDS) material only inside the CROSS-SECTION TRIANGLE spanned by the edge and the two legs of length
//   `size` along the two faces it joins (a fillet's removal region lies inside that triangle too). So a blend is only trustworthy when
//     R1  that triangle lies inside both faces: no other boundary edge of face F comes closer to the blended edge than `size` (this is G2, made
//         exact for any planar face: non-rectangular faces, faces with holes, pocket walls, faces already shortened by an earlier bevel), and the
//         two neighbours of the edge in F reach at least `size` away from it;
//     R2  nothing else is inside the triangle: no edge of any other face (the wall of a hole drilled from the other side, a blind hole's floor) has a
//         point strictly inside it;
//     R3  the corners at the two ends are plain: no third face meeting an end point is curved (an earlier fillet or a cylinder boss there; the kernel's
//         "literal mitre" and OCCT's "tangent chain" then disagree: measured in fc-seq / sg-* cases);
//   and, for a circular rim (cylinder cap / side): the cap's other edges stay out of the annulus (R - size, R + size) and size < the height of the side.
//   A size equal to the extent is refused too (OCCT and brep-rs refuse it; the kernel builds the consumed-face solid for some of them and refuses others).
//
// Returns { ok: true, ... } or { ok: false, code, args } and the plain sentence comes from fc-sentences.mjs.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 0 ? mul(a, 1 / l) : a; };
const baseName = (n) => String(n ?? '').replace(/~\d+$/, '');

/** Points along an edge: a straight edge is its start/end; an arc is the circle through start, mid, end sampled (a full circle: start == end). */
export function edgePoints(e, nArc = 32) {
  const S = e.start; const M = e.mid; const T = e.end;
  const chord = len(sub(T, S));
  const scale = Math.max(1, len(S), len(T));
  if (chord > 1e-9 * scale) {
    const m2 = mul(add(S, T), 0.5);
    if (len(sub(M, m2)) <= 1e-7 * scale) return { straight: true, pts: [S, T] };
    // circle through S, M, T (circumcentre of the triangle, then the arc from S through M to T)
    const a = sub(S, M); const b = sub(T, M);
    const ab = cross(a, b); const d2 = 2 * dot(ab, ab);
    if (d2 < 1e-18) return { straight: true, pts: [S, T] };
    const centre = add(M, mul(cross(sub(mul(b, dot(a, a)), mul(a, dot(b, b))), ab), 1 / d2));
    const r = len(sub(S, centre));
    const n = unit(ab);
    const u0 = unit(sub(S, centre));
    const v0 = cross(n, u0);
    const ang = (P) => Math.atan2(dot(sub(P, centre), v0), dot(sub(P, centre), u0));
    const norm = (x) => { while (x < 0) x += 2 * Math.PI; while (x >= 2 * Math.PI) x -= 2 * Math.PI; return x; };
    const aM = norm(ang(M)); const aT = norm(ang(T));
    const sweep = aM < aT ? aT : aT - 2 * Math.PI; // M must lie between S (angle 0) and T
    const pts = [];
    for (let i = 0; i <= nArc; i++) { const t = (sweep * i) / nArc; pts.push(add(centre, add(mul(u0, r * Math.cos(t)), mul(v0, r * Math.sin(t))))); }
    return { straight: false, pts, centre, radius: r, normal: n };
  }
  // closed loop edge (start == end): centre is the midpoint of start-mid, normal from the faces is unknown here -> caller supplies one
  const centre = mul(add(S, M), 0.5);
  return { straight: false, closed: true, pts: null, centre, radius: len(sub(S, M)) / 2 };
}

/** Face names can contain '|' themselves ("F2:blend:F1:+z|F1:-y"), so an edge name "A|B" is split at the '|' that leaves two names of faces that exist. */
const norm = (n) => baseName(n).replace(/#\d+$/, '');
function splitEdgeName(topo, name) {
  topo._fn ??= new Set(topo.faces.map((f) => norm(f.name)));
  const s = baseName(name);
  const out = [];
  for (let i = s.indexOf('|'); i >= 0; i = s.indexOf('|', i + 1)) { const l = s.slice(0, i); const r = s.slice(i + 1); if (topo._fn.has(norm(l)) && topo._fn.has(norm(r))) out.push([l, r]); }
  return out[0] ?? null;
}
function faceByName(topo, name) {
  const b = baseName(name);
  return topo.faces.filter((f) => f.name === b || f.name.startsWith(b + '#'));
}
function edgesOfFace(topo, face) {
  const fn = norm(face.name);
  return topo.edges.filter((e) => { const p = splitEdgeName(topo, e.name); return p && (norm(p[0]) === fn || norm(p[1]) === fn); });
}
const distToPolyline = (P, pts) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]; const b = pts[i + 1]; const ab = sub(b, a); const l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(P, a), ab) / l2)) : 0;
    best = Math.min(best, len(sub(P, add(a, mul(ab, t)))));
  }
  return best;
};
const scaleOf = (topo) => { let s = 1; for (const e of topo.edges) for (const p of [e.start, e.end]) for (const v of p) s = Math.max(s, Math.abs(v)); return s; };

/** the edge (and, for a split closed loop, its sibling halves) the pick lands on */
export function edgeOfPick(topo, P) {
  let best = null;
  for (const e of topo.edges) {
    const ep = edgePoints(e);
    const pts = ep.pts ?? [e.start, e.mid, e.end];
    const d = distToPolyline(P, pts);
    if (!best || d < best.d) best = { e, d };
  }
  return best;
}

/** segment (a0,p0)-(a1,p1) against the open rectangle (a in (lo,hi), p in (-inf, s)) : does it come strictly inside? coordinates are (along, perpendicular). */
function crossesStrip(p0, p1, lo, hi, s, eps) {
  // sample densely along the segment; the polyline is short and the test is conservative
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N; const a = p0[0] + (p1[0] - p0[0]) * t; const p = p0[1] + (p1[1] - p0[1]) * t;
    if (a > lo + eps && a < hi - eps && p < s - eps && p > -eps) return true;
  }
  return false;
}

/**
 * topo: { faces: [...], edges: [...] } of the target body BEFORE the blend. pick: the point the translator sends. size: > 0. style: 'fillet' | 'chamfer'.
 */
export function guardBlend(topo, pick, size, style) {
  const scale = scaleOf(topo);
  const eps = 1e-6 * scale;
  if (!(size >= 0.01)) return { ok: false, code: 'too-small', args: { size } }; // raw probe tiny-probe.txt: <= 1e-6 is refused as "must be positive", 3e-6..1e-3 builds a chamfer that adds NO face (6 faces for a box), 0.01 is the first size that does
  const hit = edgeOfPick(topo, pick);
  if (!hit || hit.d > 0.02 * scale + 1e-3) return { ok: false, code: 'no-edge', args: { dist: hit?.d } };
  const e0 = hit.e;
  const names = splitEdgeName(topo, e0.name);
  if (!names) return { ok: false, code: 'unknown-edge', args: { name: e0.name } };
  const A = faceByName(topo, names[0]); const B = faceByName(topo, names[1]);
  if (!A.length || !B.length) return { ok: false, code: 'unknown-edge', args: { name: e0.name } };
  const planar = (f) => f.plane_normal && len(f.plane_normal) > 0.5;
  const ep0 = edgePoints(e0);
  const info = { edge: e0.name, faces: names, size, style };
  // ---------------------------------------------------------------- circular rim: planar cap + curved side
  if (!ep0.straight) {
    const capF = [...A, ...B].filter(planar); const sideF = [...A, ...B].filter((f) => !planar(f));
    if (capF.length !== 1 || sideF.length < 1) return { ok: false, code: 'curved-edge', args: {} };
    const cap = capF[0];
    // all halves of this loop
    const normEdge = (n) => baseName(n).replace(/#\d+/g, '');
    const loop = topo.edges.filter((e) => normEdge(e.name) === normEdge(e0.name));
    const centre = ep0.centre; const R = ep0.radius;
    info.loop = loop.length; info.R = R;
    // near the radius the kernel returns garbage long before it refuses: raw probes (bbox-probe.txt) give bbox +10.6 % at R - size = 0.02..0.03 mm and a volume 35 % too large at R - size = 0.007 mm, so refuse inside a margin
    const margin = Math.max(0.1, 0.005 * R);
    if (size > R - margin) return { ok: false, code: 'too-big', args: { face: 'cap', extent: R, margin, ...info } };
    // other edges of the cap that come into the annulus (R - size, R + size)
    for (const e of edgesOfFace(topo, cap)) {
      if (loop.includes(e)) continue;
      const ep = edgePoints(e);
      const pts = ep.pts ?? [e.start, e.mid, e.end];
      for (const q of pts) {
        const d = len(sub(q, centre)); // 3D distance; the cap is planar and the centre is in its plane
        if (d > R - size + eps && d < R + size - eps) return { ok: false, code: 'in-the-way', args: { other: e.name, ...info } };
      }
    }
    // the side: the nearest other circle of the side face along the axis
    const ax = unit(cap.plane_normal);
    let hMin = Infinity;
    for (const sf of sideF) for (const e of edgesOfFace(topo, sf)) {
      if (loop.includes(e)) continue;
      const ep = edgePoints(e);
      const pts = ep.pts ?? [e.start, e.mid, e.end];
      for (const q of pts) { const h = Math.abs(dot(sub(q, centre), ax)); if (h > eps) hMin = Math.min(hMin, h); }
    }
    info.sideHeight = Number.isFinite(hMin) ? hMin : null;
    if (Number.isFinite(hMin) && size > hMin - margin) return { ok: false, code: 'too-big', args: { face: 'side', extent: hMin, ...info } };
    return { ok: true, rule: 'rim', ...info };
  }
  // ---------------------------------------------------------------- straight edge between two planar faces
  if (A.length !== 1 || B.length !== 1 || !planar(A[0]) || !planar(B[0])) return { ok: false, code: 'curved-face', args: {} };
  const S = e0.start; const T = e0.end; const L = len(sub(T, S)); const d = unit(sub(T, S));
  // R4: the edge is one piece of a longer edge that something cut through (a pocket opening onto the face, a hole tangent to it): the kernel blends the piece it was handed and nothing says so
  const stem = (n) => baseName(n).replace(/~\d+$/, '');
  const onLine = (P) => len(cross(sub(P, S), d)) <= 1e-6 * scale * 10;
  const cand = topo.edges.filter((x) => x !== e0 && stem(x.name) === stem(e0.name) && onLine(x.start) && onLine(x.end));
  // pieces that join end to end with e0 (a vertex in the middle of one straight edge) are the same edge; a piece with a GAP between it and the chain is the other side of a cut
  const chain = [e0]; let grew = true;
  const touch = (a, b) => [a.start, a.end].some((P) => [b.start, b.end].some((Q) => len(sub(P, Q)) <= 1e-6 * scale * 10));
  while (grew) { grew = false; for (const x of cand) if (!chain.includes(x) && chain.some((c) => touch(c, x))) { chain.push(x); grew = true; } }
  const pieces = cand.filter((x) => !chain.includes(x));
  if (pieces.length) return { ok: false, code: 'split', args: { pieces: pieces.map((x) => x.name), ...info } };
  const sides = [];
  const near = (P, Q) => len(sub(P, Q)) <= 1e-6 * scale * 10;
  for (const F of [A[0], B[0]]) {
    const nF = unit(F.plane_normal);
    let p = unit(cross(nF, d));
    const fe = edgesOfFace(topo, F).filter((x) => x !== e0);
    // which side of the edge the face lies on: even-odd ray test of a point just beside the edge against ALL boundary polylines of F (outer loop and holes)
    // (the end neighbours cannot tell it: at a pocket corner the face wraps 270 degrees and the neighbour heads AWAY from the face side)
    const segs2d = [];
    for (const x of edgesOfFace(topo, F)) {
      const pts = edgePoints(x).pts ?? [x.start, x.mid, x.end];
      for (let i = 0; i + 1 < pts.length; i++) segs2d.push([[dot(sub(pts[i], S), d), dot(sub(pts[i], S), p)], [dot(sub(pts[i + 1], S), d), dot(sub(pts[i + 1], S), p)]]);
    }
    const inside = (qa, qb) => { let c = 0; for (const [P, Q] of segs2d) { if ((P[1] > qb) !== (Q[1] > qb)) { const x = P[0] + ((qb - P[1]) * (Q[0] - P[0])) / (Q[1] - P[1]); if (x > qa) c++; } } return c % 2 === 1; };
    const delta = 1e-3 * Math.min(L, scale);
    const qa = L * 0.5 + 1e-4 * L; // off the middle of the edge so the ray does not graze a vertex
    const inPos = inside(qa, delta); const inNeg = inside(qa, -delta);
    if (inPos === inNeg) return { ok: false, code: 'orientation', args: { face: F.name } };
    if (inNeg) p = mul(p, -1);
    const nbrs = fe.filter((x) => near(x.start, S) || near(x.end, S) || near(x.start, T) || near(x.end, T));
    sides.push({ F, p, others: fe, nbrs });
  }
  info.legs = [];
  for (const sd of sides) {
    // R1a: a neighbour that heads into the face (not one that wraps around a 270-degree corner) must reach at least `size`
    for (const x of sd.nbrs) {
      // the neighbour may itself be stored as several collinear pieces ("name~2"): its reach is the reach of the whole chain
      const chain = topo.edges.filter((y) => y === x || (stem(y.name) === stem(x.name) && len(cross(sub(y.start, x.start), unit(sub(x.end, x.start)))) <= 1e-6 * scale * 10 && len(cross(sub(y.end, x.start), unit(sub(x.end, x.start)))) <= 1e-6 * scale * 10));
      const xp = chain.flatMap((y) => edgePoints(y).pts ?? [y.start, y.mid, y.end]);
      const reach = Math.max(...xp.map((q) => dot(sub(q, S), sd.p)));
      info.legs.push({ face: sd.F.name, nbr: x.name, reach });
      if (reach <= eps) continue;
      // a neighbour that is the END of an earlier blend (its other face is a blend face) may reach exactly `size` (two blends meeting in a mitre); any other neighbour is the far boundary of the face, and a blend as long as the face consumes it
      const pr = splitEdgeName(topo, x.name); const other = pr ? (norm(pr[0]) === norm(sd.F.name) ? pr[1] : pr[0]) : '';
      if (/:blend:/.test(other)) continue;
      if (reach < size + eps) return { ok: false, code: 'too-big', args: { face: sd.F.name, extent: reach, equal: reach > size - eps, ...info } };
    }
    // R1b: no other boundary edge of F in the strip
    for (const x of sd.others) {
      if (sd.nbrs.includes(x)) continue;
      const xp = edgePoints(x).pts ?? [x.start, x.mid, x.end];
      const ap = xp.map((q) => [dot(sub(q, S), d), dot(sub(q, S), sd.p)]);
      for (let i = 0; i + 1 < ap.length; i++) if (crossesStrip(ap[i], ap[i + 1], 0, L, size, eps)) return { ok: false, code: 'in-the-way', args: { face: sd.F.name, other: x.name, ...info } };
    }
  }
  // R2: nothing of any other face inside the cross-section triangle (edges not on A or B, not incident to the edge's end points)
  {
    const pA = sides[0].p; const pB = sides[1].p;
    // oblique basis (pA, pB) of the cross-section plane: q - S = a d + alpha pA + beta pB
    const nA = cross(pA, pB); const nl = len(nA);
    if (nl > 1e-9) {
      const aOf = (q) => {
        const w = sub(q, S); const a = dot(w, d);
        const w2 = sub(w, mul(d, a));
        // solve alpha pA + beta pB = w2 (2x2 in the plane spanned by pA, pB)
        const g11 = dot(pA, pA); const g12 = dot(pA, pB); const g22 = dot(pB, pB);
        const r1 = dot(w2, pA); const r2 = dot(w2, pB); const det = g11 * g22 - g12 * g12;
        const alpha = (r1 * g22 - r2 * g12) / det; const beta = (g11 * r2 - g12 * r1) / det;
        const resid = len(sub(w2, add(mul(pA, alpha), mul(pB, beta))));
        return { a, alpha, beta, resid };
      };
      const onFaces = new Set([...edgesOfFace(topo, A[0]), ...edgesOfFace(topo, B[0])]);
      for (const x of topo.edges) {
        if (onFaces.has(x)) continue;
        const xp = edgePoints(x).pts ?? [x.start, x.mid, x.end];
        for (let i = 0; i < xp.length; i++) for (let k = 0; k <= 4; k++) {
          const q = i + 1 < xp.length ? add(mul(xp[i], 1 - k / 4), mul(xp[i + 1], k / 4)) : xp[i];
          const c = aOf(q);
          if (c.a > eps && c.a < L - eps && c.alpha > eps && c.beta > eps && c.alpha + c.beta < size - eps) return { ok: false, code: 'in-the-way', args: { other: x.name, inside: true, ...info } };
        }
      }
    }
  }
  // R3: end corners plain
  for (const P of [S, T]) {
    const near = (Q) => len(sub(P, Q)) <= 1e-6 * scale * 10;
    for (const f of topo.faces) {
      if (A.includes(f) || B.includes(f)) continue;
      const touches = edgesOfFace(topo, f).some((x) => near(x.start) || near(x.end));
      if (touches && !planar(f)) return { ok: false, code: 'corner', args: { face: f.name, ...info } };
    }
  }
  return { ok: true, rule: 'planar', ...info };
}

/**
 * ROUND 4: the guard for a GROUP of edges blended in ONE call (a pocket rim, a loop of top edges, a list handed to round()). picks: one point per edge, all with the same size/style.
 * Every edge must pass the single-edge rules R1..R4 on the topology BEFORE the call (an earlier blend of this very call cannot be a curved third face: there is none yet), and
 *   R5  two edges of the group on the same face that do NOT share an end point need the face between them to be wider than the two blends together (2 x size): the OCCT and brep-rs
 *       refusal "would not fit its edge", and the case where the kernel builds a solid with a face missing (bevel of 4 top edges by 16 on a 30 deep top: 1782.0000, 5 faces);
 *   R6  the same edge named twice is refused (the second blend would act on an edge the first one consumed).
 * Edges that share an end point (a corner of the loop) are allowed to meet: that is the mitre the kernel builds and OCCT's simultaneous maker agrees with (fc-batch-fuzz.mjs).
 */
export function guardBatch(topo, picks, size, style) {
  if (!(size >= 0.01)) return { ok: false, code: 'too-small', args: { size } };
  const scale = scaleOf(topo); const eps = 1e-6 * scale;
  const hits = picks.map((p) => edgeOfPick(topo, p));
  for (const h of hits) if (!h || h.d > 0.02 * scale + 1e-3) return { ok: false, code: 'no-edge', args: { dist: h?.d } };
  const es = hits.map((h) => h.e);
  for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) if (es[i] === es[j]) return { ok: false, code: 'twice', args: { edge: es[i].name } };
  let rules = [];
  for (let i = 0; i < picks.length; i++) {
    const g = guardBlend(topo, picks[i], size, style);
    if (!g.ok) return { ...g, args: { ...g.args, member: i, ofGroup: picks.length } };
    rules.push(g.rule);
  }
  // R5: pairs on a common face that do not touch. The two strips (size wide, on the FACE side of each edge) overlap only if the face lies BETWEEN the edges: the midpoint of the nearest points must be
  //     inside the face (even-odd over its outer loop and holes). Opposite edges of a pocket opening lie on the two sides of a hole of the top face: their strips point away from each other, the
  //     face is not between them, and the kernel's simultaneous result equals OCCT's there (fc4 pocket fuzz seed 5303: 4 correct builds had been refused by the version that did not look at the side).
  const touch = (a, b) => [a.start, a.end].some((P) => [b.start, b.end].some((Q) => len(sub(P, Q)) <= 1e-6 * scale * 10));
  const faceSet = (e) => { const n = splitEdgeName(topo, e.name); return n ? [norm(n[0]), norm(n[1])] : []; };
  const insideFace = (F, P) => {
    // true / false, or null when the face has a closed circular boundary or is curved (cannot be decided here)
    if (!(F.plane_normal && len(F.plane_normal) > 0.5)) return null;
    const n = unit(F.plane_normal); const a0 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = unit(cross(n, a0)); const v = cross(n, u);
    const q = [dot(P, u), dot(P, v)]; let inside = false;
    for (const x of edgesOfFace(topo, F)) {
      const ep = edgePoints(x);
      if (!ep.pts) return null;
      const pts = ep.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const p0 = [dot(pts[i], u), dot(pts[i], v)]; const p1 = [dot(pts[i + 1], u), dot(pts[i + 1], v)];
        if ((p0[1] > q[1]) !== (p1[1] > q[1])) { const xi = p0[0] + ((q[1] - p0[1]) * (p1[0] - p0[0])) / (p1[1] - p0[1]); if (xi > q[0]) inside = !inside; }
      }
    }
    return inside;
  };
  for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
    const fi = faceSet(es[i]); const fj = faceSet(es[j]);
    const common = fi.filter((x) => fj.includes(x));
    if (!common.length || touch(es[i], es[j])) continue;
    const pi = edgePoints(es[i]).pts ?? [es[i].start, es[i].mid, es[i].end];
    const pj = edgePoints(es[j]).pts ?? [es[j].start, es[j].mid, es[j].end];
    const A = pi.length === 2 ? Array.from({ length: 33 }, (_, k) => add(mul(pi[0], 1 - k / 32), mul(pi[1], k / 32))) : pi;
    let dmin = Infinity;
    const B = pj.length === 2 ? Array.from({ length: 33 }, (_, k) => add(mul(pj[0], 1 - k / 32), mul(pj[1], k / 32))) : pj;
    for (const a of A) for (const b of B) { const d = len(sub(a, b)); if (d < dmin) dmin = d; }
    if (!(dmin < 2 * size - eps)) continue;
    // midpoints of every nearest pair; one that lies ON the boundary of the face (a pair at the very end of both edges) is no use for the even-odd test
    const mids = [];
    for (const a of A) for (const b of B) if (len(sub(a, b)) <= dmin + 1e-9 * scale) mids.push(mul(add(a, b), 0.5));
    let between = false;
    for (const cn of common) for (const F of faceByName(topo, cn)) {
      const bpolys = edgesOfFace(topo, F).map((x) => edgePoints(x).pts ?? [x.start, x.mid, x.end]);
      const usable = mids.filter((mm) => bpolys.every((pl) => distToPolyline(mm, pl) > 1e-6 * scale * 10));
      if (!usable.length) { between = true; continue; } // cannot decide: stay conservative
      const r = insideFace(F, usable[Math.floor(usable.length / 2)]);
      if (r === null || r === true) between = true;
    }
    if (between) return { ok: false, code: 'crowded', args: { face: common[0], gap: dmin, extent: dmin, equal: Math.abs(dmin - 2 * size) <= eps, a: es[i].name, b: es[j].name, size, ofGroup: picks.length } };
  }
  // R7: three or more CHAMFERS meeting at one corner. The kernel builds the corner of twelve one-at-a-time chamfers (no corner face); OCCT, brep-rs and FreeCAD's one-operation chamfer add a small triangle there.
  //     The two conventions differ at ANY size (fc4 a3-all12-bevel-*), so the student is not given either one silently.
  if (style === 'chamfer') {
    const key = (P) => P.map((v) => Math.round(v / (1e-6 * scale * 10))).join(',');
    const cnt = new Map();
    for (const e of es) for (const P of new Set([key(e.start), key(e.end)])) cnt.set(P, (cnt.get(P) ?? 0) + 1);
    for (const [P, n] of cnt) if (n >= 3) return { ok: false, code: 'corner3', args: { n, size, ofGroup: picks.length } };
  }
  return { ok: true, rule: 'group', rules, n: picks.length };
}

/**
 * ROUND 4: hollow() after a FILLET of an edge of the face it opens. A fillet at least as large as the wall leaves the rim with no thickness (a knife edge): the page builds it
 * silently (b-edge-then-hollow-r2: 5014.2309, r3: 5039.6194 with 14 faces) while OCCT and brep-rs refuse the hollow. features: the whole doc, idx: the index of the shell feature.
 * Only names the guard can read are used (a `between` edge of two primitive faces, one of them the face being opened); anything else is left alone. A chamfer as large as the wall is
 * NOT refused: OCCT builds it and the page's result equals OCCT's (b-edge-then-hollow-bevel2).
 */
export function guardShellRim(features, idx) {
  const f = features[idx];
  if (!f || f.kind !== 'shell' || !f.open || !(f.thickness > 0)) return { ok: true };
  const byId = new Map(features.map((x) => [x.id, x]));
  const same = (a, b) => a && b && a.cause === 'primitive' && b.cause === 'primitive' && a.feature === b.feature && a.part === b.part;
  let cur = f.target; const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const g = byId.get(cur);
    if (!g || g.kind !== 'fillet') break;
    if (g.style === 'fillet' && g.size >= f.thickness - 1e-9 && (g.edge?.of ?? []).some((x) => same(x, f.open))) return { ok: false, code: 'knife-rim', args: { size: g.size, wall: f.thickness } };
    cur = g.target;
  }
  return { ok: true };
}

/** Document-level guard for a whole-shape primitive round (ModelDoc `round` + `roundStyle` on a box / cylinder). */
export function guardPrimitiveRound(f) {
  if (f.kind === 'box' && f.round && f.roundStyle === 'chamfer') return { ok: false, code: 'whole-chamfer', args: { size: f.round } }; // measured: 12 chamfers of the box are NOT what OCCT and brep-rs build (8 corner triangles) at any size, error grows with d
  if (typeof f.round === 'number' && f.round < 0) return { ok: false, code: 'negative', args: { size: f.round } };
  if (f.round !== undefined && !(f.round >= 0.01)) return { ok: false, code: 'too-small', args: { size: f.round } }; // 0 included: the edge-level blend refuses 0 too, so both paths now say the same thing (round 4); the plain primitive is still shown
  return { ok: true };
}

/** Post-build net: a blend of ONE straight edge between two planar faces must add exactly one face (the size == extent case is refused before the build). */
export function postCheck(facesBefore, facesAfter, rule) {
  if (rule !== 'planar') return { ok: true };
  return facesAfter === facesBefore + 1 ? { ok: true } : { ok: false, code: 'face-count', args: { facesBefore, facesAfter } };
}
