// Convex hull, ours.
//
// WHY THIS FILE EXISTS, measured 2026-09-02. Every other name in the scripting
// surface survives the kernel swap: OpenCascade either has the operation, or the
// operation is arithmetic we already do, or the name only ever existed to tidy a
// mesh and a B-rep has no mesh to tidy. `hull` is the exception, and it is not a
// close call -- of the 498 exports in the replicad OpenCascade build, ZERO match
// /hull/i. OpenCascade ships no convex hull at all, in any build, so unlike
// non-uniform scale (which is real OCCT that this particular wasm build does not
// bind) there is nothing to go and enable. Either we own it or eleven documented
// pages stop working.
//
// See lib/script-surface.ts for the full classification and the page counts.
//
// WHAT A HULL IS, since the docs have to say it in one line: the shape a rubber
// sheet makes when it is stretched around everything and let go. No dents.
//
// THE ALGORITHM is incremental, not quickhull. Start with a tetrahedron of four
// points that are genuinely not flat; then for each remaining point, delete
// every face it can see, and stitch a new face onto each edge of the hole that
// leaves.
//
// THE FIRST VERSION OF THIS PARAGRAPH SAID the inputs would be "a student's
// shape corners -- tens of points, not millions -- so an O(n^2) loop that a
// person can read beats a faster one nobody can check." Both halves were wrong
// and measurement is what said so.
//
// The inputs are not tens of points. On a B-rep a sphere has no vertices to
// hull, so hulling anything curved means sampling its surface, and the docs' own
// example -- hull(sphere(10), translate([30,0,0], sphere(10))) -- lands at 2006
// points at the default mesh setting.
//
// And the readable loop was not O(n^2). It found the horizon by scanning every
// face for every edge of every visible face, which is cubic, and no amount of
// reading it revealed that: against JSCAD's own hull on that same example it was
// 10 to 40 times slower at equal accuracy and did not finish at all past ~2000
// points. Legibility did not buy correctness either -- the tolerance underneath
// it was wrong in a way that only a scaling test exposed (see the note on `tol`
// below). Measured after both were fixed, on that example:
//
//   accuracy    JSCAD              ours
//   1.66%       26 ms (24 seg)     -- what the docs ship today
//   0.47%       32 ms (48 seg)     19-71 ms at 2006 points
//   0.30%       57 ms (64 seg)     213 ms at 3538 points
//
// So the default mesh deflection already beats what students see now, at
// comparable cost, and NO new sampling dial is needed: the tessellation's own
// deflection is the density. Clean scaling, every point on the hull, Euler's
// F = 2V - 4 exact at every size: 4000 points in 0.66 s, 16000 in 9.8 s.
//
// EXACT FOR FLAT INPUTS, APPROXIMATE FOR ROUND ONES, and that asymmetry is worth
// stating because it runs the OPPOSITE way to the rest of this conversion.
// Everywhere else the B-rep answer is more correct than the tessellated one -- a
// cylinder's volume stops being a 32-sided prism's. Here it is the reverse: the
// hull of two spheres is only as round as the points fed in, so hulling a curved
// solid means sampling its surface and the answer is a polyhedron either way.
// That is the same trade JSCAD makes, so nothing is LOST at the swap; it is
// simply the one place where B-rep buys no accuracy.
//
// NO KERNEL, ON PURPOSE -- same split as lib/topo-name.ts against
// lib/topo-resolve.ts. Points in, triangles out, testable by arithmetic: the
// hull of a cube's eight corners has volume exactly s^3, and stays exactly s^3
// when interior points are added. Turning those triangles into a solid is the
// adapter's job, because that is the part that needs OpenCascade.

/** A point. Same shape as Vec3 in lib/model-types.ts, kept local so this file
 *  imports nothing. */
export type Pt = [number, number, number];

/** One face of the hull, as indices into the input points, wound
 *  counter-clockwise seen from outside. */
export type Tri = [number, number, number];

export interface Hull {
  /** The points that ended up ON the hull, in input order. */
  used: number[];
  /** The hull's triangles, indexing the ORIGINAL points array. */
  triangles: Tri[];
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Pt, b: Pt): Pt => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * How far `p` sits above the plane of triangle `t`, in the direction the
 * triangle faces. Positive means the point can SEE that face, which is the only
 * question the algorithm ever asks.
 *
 * Not normalised: the sign is what matters, and dividing by a length that could
 * be near zero on a sliver triangle is a way to turn a clear answer into a
 * noisy one.
 */
function above(pts: Pt[], t: Tri, p: Pt): number {
  const a = pts[t[0]];
  const n = cross(sub(pts[t[1]], a), sub(pts[t[2]], a));
  return dot(n, sub(p, a));
}

/**
 * The convex hull of a point set, or null when there is no hull to take.
 *
 * Returns null for fewer than four points, and for a set that is flat --
 * every point on one plane, or on one line. Those are real inputs a student can
 * produce (four corners of a rectangle, say) and they have no VOLUME, so a
 * caller that wants a shape out of this has to say so in words rather than
 * receive a degenerate solid. whyNoHull() below is that sentence.
 *
 * `eps` scales with the point set rather than being a fixed number, because
 * "flat" at the scale of a 200 mm bracket is not flat at the scale of a 0.2 mm
 * feature, and a constant would silently pick one of them.
 */
export function convexHull(pts: Pt[]): Hull | null {
  const n = pts.length;
  if (n < 4) return null;

  // A scale-relative flatness threshold, from the spread of the points.
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < lo[i]) lo[i] = p[i];
      if (p[i] > hi[i]) hi[i] = p[i];
    }
  }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(span > 0)) return null;
  const eps = span * 1e-9;

  // ---- a starting tetrahedron ---------------------------------------------
  //
  // Four points that are not flat. Taken greedily rather than cleverly: the
  // first two that differ, then the first that is off that line, then the first
  // that is off that plane. If the last search comes up empty the whole set is
  // planar, which is the null case above.
  let i0 = 0;
  let i1 = -1;
  for (let i = 1; i < n; i++) {
    if (Math.hypot(...sub(pts[i], pts[i0])) > eps) { i1 = i; break; }
  }
  if (i1 < 0) return null;                       // every point in one place

  let i2 = -1;
  const line = sub(pts[i1], pts[i0]);
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1) continue;
    if (Math.hypot(...cross(line, sub(pts[i], pts[i0]))) > eps * span) { i2 = i; break; }
  }
  if (i2 < 0) return null;                       // every point on one line

  let i3 = -1;
  const base: Tri = [i0, i1, i2];
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2) continue;
    if (Math.abs(above(pts, base, pts[i])) > eps * span * span) { i3 = i; break; }
  }
  if (i3 < 0) return null;                       // every point on one plane

  // ---- a face, carrying its own plane --------------------------------------
  //
  // The plane is cached rather than recomputed because the visibility test runs
  // once per face per point, and it was the whole cost of the first version: a
  // cross product, a subtraction and a Math.hypot, several million times over.
  // Stored as a normal and an offset, so the test is one dot product and a
  // compare.
  //
  // THE TOLERANCE IS A DISTANCE, and getting that wrong is what broke the first
  // two versions.
  //
  // `n . p - d` is twice a tetrahedron's volume, so it scales with the FACE as
  // well as with how far the point sits above it. Comparing that raw number
  // against a fixed floor therefore asks a different question of a big face than
  // of a small one. Dividing by the normal's length -- twice the triangle's area
  // -- turns it back into a distance, which is the quantity the threshold
  // actually means. Written as `> eps * area2` rather than as a division so a
  // zero-area face cannot produce a division by zero.
  //
  // The earlier floor of `max(area2, span * span)` looked like prudence and was
  // the defect. On a dense hull the faces get small, that floor stays at span
  // squared, and the tolerance ends up MILLIONS of times larger than the
  // distances being judged -- so genuinely visible faces read as invisible, the
  // horizon does not close, and the face set stops being a surface. Measured on
  // 6000 random sphere points: faces tracked 2i-4 exactly up to i=3000, then
  // went 6427 -> 178731 in five hundred points with 27818 faces reported visible
  // at once, and the run died on memory. It was diagnosed as allocation churn
  // first, wrongly; instrumenting the face count is what showed a topology
  // collapse rather than a slow leak.
  //
  // A floor remains, twenty orders of magnitude smaller, purely so a degenerate
  // face gets a non-zero threshold instead of an exactly-zero one.
  interface Face { t: Tri; nx: number; ny: number; nz: number; d: number; tol: number; dead: boolean }

  const makeFace = (a: number, b: number, c: number): Face => {
    const pa = pts[a];
    const nrm = cross(sub(pts[b], pa), sub(pts[c], pa));
    const area2 = Math.hypot(nrm[0], nrm[1], nrm[2]);
    return {
      t: [a, b, c],
      nx: nrm[0], ny: nrm[1], nz: nrm[2],
      d: nrm[0] * pa[0] + nrm[1] * pa[1] + nrm[2] * pa[2],
      tol: eps * Math.max(area2, span * span * 1e-12),
      dead: false,
    };
  };
  const sees = (f: Face, p: Pt): boolean =>
    f.nx * p[0] + f.ny * p[1] + f.nz * p[2] - f.d > f.tol;

  // Wind the seed faces outward. The fourth point is inside the tetrahedron by
  // construction, so any face it can see is wound the wrong way round.
  const centre: Pt = [
    (pts[i0][0] + pts[i1][0] + pts[i2][0] + pts[i3][0]) / 4,
    (pts[i0][1] + pts[i1][1] + pts[i2][1] + pts[i3][1]) / 4,
    (pts[i0][2] + pts[i1][2] + pts[i2][2] + pts[i3][2]) / 4,
  ];
  const faces: Face[] = [
    [i0, i1, i2], [i0, i2, i3], [i0, i3, i1], [i1, i3, i2],
  ].map(([a, b, c]) => (above(pts, [a, b, c], centre) > 0 ? makeFace(a, c, b) : makeFace(a, b, c)));

  // ---- add the rest, one at a time ----------------------------------------
  const seeded = new Set([i0, i1, i2, i3]);
  const visible: Face[] = [];
  const dir = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (seeded.has(i)) continue;
    const p = pts[i];

    visible.length = 0;
    for (const f of faces) if (sees(f, p)) { f.dead = true; visible.push(f); }
    if (visible.length === 0) continue;          // already inside the hull

    // THE HORIZON, and the reason this file was rewritten.
    //
    // An edge belongs to the horizon when the face on its other side is NOT
    // visible. The first version answered that by scanning every face for every
    // edge of every visible face -- correct, readable, and cubic, which no
    // amount of reading it revealed. Measured against JSCAD's own hull on the
    // docs' two-sphere example it was 10 to 40 times slower at equal accuracy,
    // and simply did not finish past about 2000 points.
    //
    // Answered with a lookup instead. Adjacent faces wind opposite ways, so a
    // shared edge appears once as (a,b) and once as (b,a). Put every directed
    // edge of the visible set in one map; an edge is on the horizon exactly when
    // its reverse is absent. Same answer, one hash probe instead of a scan.
    // Two indices packed into one number rather than a string key: at a few
    // thousand points this runs millions of times, and building a string per
    // probe was itself a measurable share of the cost. The Set is reused across
    // points for the same reason.
    dir.clear();
    for (const f of visible) {
      dir.add(f.t[0] * n + f.t[1]);
      dir.add(f.t[1] * n + f.t[2]);
      dir.add(f.t[2] * n + f.t[0]);
    }

    // COMPACT IN PLACE rather than building a new array.
    //
    // `faces = faces.filter(...)` reads better and is what the first two
    // versions did. It also allocates a fresh array of every surviving face once
    // per point, and on a hull of f faces over n points that is n*f references
    // of pure churn -- 8000 points over ~16000 faces is on the order of a
    // gigabyte of short-lived arrays. Measured: it did not merely run slowly, it
    // died, with "Ineffective mark-compacts near heap limit" at 8000 points and
    // again on the two-sphere fixture at the finest setting. Euler's formula
    // held at every size that finished, which is what said the algorithm was
    // right and the allocation was not.
    let w = 0;
    for (let k = 0; k < faces.length; k++) if (!faces[k].dead) faces[w++] = faces[k];
    faces.length = w;

    for (const f of visible) {
      const [a, b, c] = f.t;
      if (!dir.has(b * n + a)) faces.push(makeFace(a, b, i));
      if (!dir.has(c * n + b)) faces.push(makeFace(b, c, i));
      if (!dir.has(a * n + c)) faces.push(makeFace(c, a, i));
    }
  }

  const used = new Set<number>();
  for (const f of faces) { used.add(f.t[0]); used.add(f.t[1]); used.add(f.t[2]); }
  return {
    used: [...used].sort((a, b) => a - b),
    triangles: faces.map((f) => f.t),
  };
}

/**
 * Why a point set has no hull, phrased for a student, or null when it has one.
 *
 * The same contract as whyDeletingCosts() in lib/model-deps.ts and
 * whyNameLost() in lib/topo-name.ts: say what went wrong in words and let the
 * caller decide. Nothing here refuses anything on its own.
 *
 * The three flat cases are named separately because they are three different
 * mistakes. "All in one place" is usually a loop that forgot to move; "on one
 * line" is a row of shapes; "on one plane" is a 2D drawing where a 3D one was
 * meant, which is the common one and the least obvious from looking at it.
 */
export function whyNoHull(pts: Pt[]): string | null {
  if (pts.length < 4) {
    return `A hull needs at least four corners to have any thickness, and this has ${pts.length}.`;
  }
  if (convexHull(pts) !== null) return null;

  const same = (i: number) => pts.every((p) => Math.abs(p[i] - pts[0][i]) < 1e-9);
  if (pts.every((p) => Math.hypot(...sub(p, pts[0])) < 1e-9)) {
    return 'Every corner is in the same place, so there is no shape to wrap.';
  }
  const flatAxis = [0, 1, 2].filter(same);
  if (flatAxis.length >= 2) {
    return 'All the corners sit on one straight line, so there is no shape to wrap.';
  }
  const axis = ['x', 'y', 'z'];
  if (flatAxis.length === 1) {
    return `All the corners sit flat on one plane (every ${axis[flatAxis[0]]} is the same), `
      + 'so the hull would have no thickness.';
  }
  return 'All the corners sit flat on one plane, so the hull would have no thickness.';
}

/**
 * The volume the hull encloses.
 *
 * Here rather than left to the kernel because it is what makes this file
 * checkable on its own: the hull of a cube's eight corners must measure exactly
 * s^3, and must still measure s^3 once interior points are thrown in. That is
 * an arithmetic bar, not a golden number, and it is the control that catches a
 * hull which quietly kept a point it should have swallowed.
 *
 * Signed tetrahedron sum from the origin -- the standard divergence-theorem
 * form. Outward winding makes it positive.
 */
export function hullVolume(pts: Pt[], h: Hull): number {
  let v = 0;
  for (const t of h.triangles) {
    const [a, b, c] = [pts[t[0]], pts[t[1]], pts[t[2]]];
    v += dot(a, cross(b, c)) / 6;
  }
  return Math.abs(v);
}

// ---------------------------------------------------------------------------
// THE 2D CASE
// ---------------------------------------------------------------------------
//
// A 2D shape in this engine is a face on the XY plane (see the comment on
// `isSolid`/`isShape` in lib/occt-api.ts), and "hand hull two flat circles"
// must come back flat too -- a stadium outline, not a wedge with a floor and
// a ceiling. Tessellating a flat face and running it through convexHull()
// above answers a different question: that function's whole first act is
// hunting for a FOURTH point off the other three's plane, and a flat input
// has none by definition, so it always returns null there. Six documented
// pages need the flat answer instead of that null, and this is it.
//
// Deliberately NOT the 3D algorithm one dimension down. Gift-wrapping is the
// usual first instinct for a 2D hull -- start on the boundary and keep
// turning the same way -- and it is a worse fit here than it looks: a run of
// collinear points along one side makes "which neighbour comes next"
// ambiguous, and untangling that with a tie-break rule is exactly the kind of
// code that is easy to get subtly wrong and hard to catch failing. Monotone
// chain (Andrew's algorithm) sorts the points once and walks the sorted list
// twice; a collinear run resolves itself as a side effect of the sort instead
// of as a case the code has to notice and handle.

/** A 2D point. */
export type Pt2 = [number, number];

/** The 2D hull: the same two facts as Hull, one dimension down. There is no
 *  `triangles` here because a polygon does not need triangulating to be a
 *  shape -- `boundary` already is the shape, wound counter-clockwise. */
export interface Hull2 {
  /** The points that ended up ON the hull, in input order (a set, for a
   *  caller asking "was point i kept" -- same role as Hull.used). */
  used: number[];
  /** The hull polygon: indices into the input points, wound
   *  counter-clockwise, each one joined to the next and the last back to the
   *  first. This is what a caller turns into a wire. */
  boundary: number[];
}

/** Twice the signed area of triangle (o, a, b). Positive when b is to the
 *  left of the ray o->a (a genuine left turn), zero on the line, negative to
 *  the right. Not normalised, for the same reason `above()` above is cheap to
 *  compute and only its SIGN matters at the call site that needs no distance. */
const cross2 = (o: Pt2, a: Pt2, b: Pt2): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * The convex hull of a 2D point set, or null when there is no hull to take --
 * fewer than three points, every point in the same place, or every point on
 * one line. All three have zero area, which is the 2D analogue of the flat
 * (zero-volume) refusal above.
 *
 * COLLINEAR POINTS ARE DROPPED, not kept as extra hull vertices. Three points
 * in a row on the same edge would all "belong" to the hull under a loose
 * reading, but the middle one carries no information -- it sits exactly where
 * its two neighbours already say a straight edge must pass, and keeping it is
 * how a hull with four real corners ends up reporting seven vertices because
 * one side happened to have collinear input on it. This also matches the
 * reference engine's own hullPoints2, whose Graham scan pops a point the
 * instant the turn through it is `<= EPSILON` rather than keeping it -- so a
 * script that already runs against that engine sees the same vertex count
 * here. A caller that wants every input point lying ON an edge, not just the
 * corners, is asking point-in-polygon, which is a different question from
 * "what is the hull" and does not belong in this function.
 *
 * `tol` is a distance-scale tolerance built the same way the 3D code above
 * builds `eps` -- relative to the point set's own span, so a tiny sketch and
 * a room-sized one are not judged against the same fixed number. `cross2`
 * has the same units as the 3D file's line-off-axis test (a single cross
 * product), so it is compared against the identical `eps * span`, not a new
 * constant invented for this function.
 */
export function convexHull2(pts: Pt2[]): Hull2 | null {
  const n = pts.length;
  if (n < 3) return null;

  let lo: Pt2 = [Infinity, Infinity];
  let hi: Pt2 = [-Infinity, -Infinity];
  for (const p of pts) {
    if (p[0] < lo[0]) lo[0] = p[0];
    if (p[1] < lo[1]) lo[1] = p[1];
    if (p[0] > hi[0]) hi[0] = p[0];
    if (p[1] > hi[1]) hi[1] = p[1];
  }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  if (!(span > 0)) return null;                  // every point in the same place
  const tol = span * (span * 1e-9);               // eps * span, eps = span * 1e-9

  const order = [...pts.keys()].sort((i, j) =>
    (pts[i][0] !== pts[j][0] ? pts[i][0] - pts[j][0] : pts[i][1] - pts[j][1]));

  // One direction of the walk. Pop the last point on the chain while it and
  // its predecessor no longer make a strict left turn through the next point
  // -- collinear (== tol) and clockwise (< 0) are both dropped, per the
  // convention above.
  const chain = (seq: number[]): number[] => {
    const h: number[] = [];
    for (const i of seq) {
      while (h.length >= 2 && cross2(pts[h[h.length - 2]], pts[h[h.length - 1]], pts[i]) <= tol) {
        h.pop();
      }
      h.push(i);
    }
    return h;
  };

  const lower = chain(order);
  const upper = chain([...order].reverse());
  // Each half repeats the other half's first and last point at the seam;
  // drop one copy of each so the splice is a clean closed polygon.
  const boundary = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (boundary.length < 3) return null;           // every point on one line

  return { used: [...new Set(boundary)].sort((a, b) => a - b), boundary };
}

/**
 * The area the hull encloses. The 2D twin of hullVolume() above, for the same
 * reason: it is what makes this function checkable on its own arithmetic
 * rather than by eye -- a square's hull must measure exactly its own area,
 * still exactly once an interior point is added, and a concave outline's hull
 * must measure exactly the analytic area of its convex boundary.
 *
 * The shoelace formula, which `boundary` is already wound correctly for.
 */
export function hull2Area(pts: Pt2[], h: Hull2): number {
  let a = 0;
  const b = h.boundary;
  for (let i = 0; i < b.length; i++) {
    const p = pts[b[i]];
    const q = pts[b[(i + 1) % b.length]];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
