//! Layer `ops`: booleans (§4.5).
//!
//! This is a real B-rep boolean, not a 2.5D slice. It intersects the ACTUAL
//! analytic faces of the two operands (plane-plane, plane-cylinder, plane-sphere,
//! cylinder-plane, and — for the wall case — cylinder against the other solid's
//! supporting surfaces), classifies every face region as in / out / on by
//! probing just inside and just outside the face along its own normal, splits
//! the kept regions along the intersection curves using their pcurves, and
//! reassembles the kept faces into a closed shell. Curves are never sampled into
//! polygons: a plane-cylinder intersection is a genuine `Curve::Circle`.
//!
//! DEPARTURE 3 (SPEC §4.5): coplanar and tangent faces are handled, not treated
//! as edge cases. A face that lies exactly on the other solid's boundary is
//! classified by the probe offset (§ [`boolean`]), and coincident output faces
//! are de-duplicated so a shared face is not counted twice.
//!
//! Anything outside what is implemented here (a cone/torus intersection, a
//! partial-arc cylinder as an operand, a sphere being trimmed) returns None and
//! the caller refuses the feature in words rather than returning a wrong solid.

use std::cell::RefCell;
use std::rc::Rc;

use crate::build::{self, Curve3, Surface3, TFace, TSolid};
use crate::geom::{Cone, Curve, Cylinder, Plane, Surface};
use crate::math::{add, cross, dot, normalize, scale, sub, Vec3};
use crate::topo::{self, Face, Shell, Solid, Wire};

pub use crate::build::transform_solid;

/// Distance used to probe just inside / just outside a face. Larger than the
/// kernel's geometric tolerance so an exact-on-boundary face is decided cleanly,
/// small enough that it does not cross a real feature of the fixtures.
const PROBE: f64 = 1e-6;
const TOL: f64 = 1e-9;
/// Clearance a strictly-enclosed tool must keep from its base's faces. A
/// pocket whose tool touches or grazes the base is not a clean cavity and is
/// refused rather than guessed at (SPEC-brep-pocket.md constraint 4).
const CAVITY_MARGIN: f64 = 1e-6;
const TWO_PI: f64 = 2.0 * std::f64::consts::PI;

/// True when two boxes are close enough to possibly meet (touching counts).
/// The negation of this is a safe "cannot interact" filter: two AABBs that are
/// separated on some axis cannot share any point.
fn aabbs_touch(a: &crate::math::Aabb, b: &crate::math::Aabb) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    (0..3).all(|i| a.lo[i] <= b.hi[i] + TOL && b.lo[i] <= a.hi[i] + TOL)
}

/// A face's own extent as a box. A planar face is measured from its boundary
/// ring (its surface has no finite extent); a curved face uses its surface's
/// exact box. `None` when the extent cannot be established, which callers must
/// read as "might interact" rather than "safe to ignore".
pub(crate) fn face_reach_box(face: &TFace) -> Option<crate::math::Aabb> {
    let fb = face.borrow();
    let b = match &fb.surface {
        Surface::Plane(_) => {
            let mut b = crate::math::Aabb::empty();
            for p in build::face_ring_points(&fb) {
                b.expand(p);
            }
            // A whole-circle edge contributes only its seam vertex above, so a
            // disk (a cone's base, a cylinder's cap) read as a POINT and was
            // judged "cannot interact" with a wall that crosses it. Cover the
            // circle's own extent (a cube around it: conservative, which only
            // ever means "might interact").
            for w in &fb.boundary {
                for u in &w.borrow().edges {
                    if let Curve::Circle { center, radius, .. } = &u.edge.borrow().curve {
                        for k in 0..3 {
                            let (mut lo, mut hi) = (*center, *center);
                            lo[k] -= radius;
                            hi[k] += radius;
                            b.expand(lo);
                            b.expand(hi);
                        }
                    }
                }
            }
            b
        }
        s => s.aabb(),
    };
    if b.is_empty() { None } else { Some(b) }
}

// ---------------------------------------------------------------------------
// Point / surface tests.
// ---------------------------------------------------------------------------

/// Is `p` inside the solid? A solid is the union of its shells; an
/// intersection of half-spaces is only correct for a CONVEX solid, and an
/// extrapolated profile (the L fixture) is not convex, so instead we count how
/// many times a generic ray from `p` crosses the closed boundary: odd means
/// inside. Exact for planar and full-cylinder faces; an unsupported surface
/// falls back to the half-space test, which is right whenever `other` is convex.
/// True when `p` is boxed in by the solid's skin: rays along the six axis
/// directions (tilted a hair) meet it in at least four. A point in a shell's own
/// cavity or open mouth is; a point in the open air beside a convex part is not,
/// whatever the part's bounding box says. Used only to tell a tool sitting in a
/// void from one sitting in empty space (`cut_missed`), never to classify inside.
pub(crate) fn boxed_in(solid: &TSolid, p: Vec3) -> bool {
    // Near-axis rays, each tilted by an irrational sliver so none runs along a face
    // or through a seam; a cup's cavity is met by five of the six, a point beside a
    // convex part by at most two.
    let mut hit = 0usize;
    for axis in 0..3 {
        for sgn in [1.0, -1.0] {
            let mut d = [0.0123456789, 0.0234567891, 0.0345678912];
            d[axis] = sgn;
            if let Some((n, _)) = crossings(solid, p, normalize(d)) {
                if n > 0 {
                    hit += 1;
                }
            }
        }
    }
    hit >= 4
}

thread_local! {
    /// Boxes of faces whose ray-crossing count cannot be trusted (a sphere, torus, cone or trimmed
    /// wall) that a boolean is carrying through untouched. While non-empty, `inside_solid` votes
    /// only with rays that miss every box, so those faces cannot be counted at all. If fewer than
    /// three such rays exist, or they tie, the failure flag is set and the boolean must refuse.
    pub(crate) static RAY_AVOID: RefCell<Vec<crate::math::Aabb>> = const { RefCell::new(Vec::new()) };
    pub(crate) static RAY_AVOID_FAILED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// A face whose ray-crossing count is not exact: anything but a plane and a whole cylinder.
pub(crate) fn unsafe_surface(f: &TFace) -> bool {
    match &f.borrow().surface {
        Surface::Plane(_) => false,
        Surface::Cylinder(c) => c.arc.is_some() || c.cross.is_some(),
        _ => true,
    }
}

/// Where a face is, as many small boxes: one per triangle of a mesh of it, inflated past the
/// mesh's chord error. Much tighter than one box for a ring-shaped face (a chamfer's cone, a
/// rim round), which a single box would make look like a solid block. `None` when it cannot be meshed.
pub(crate) fn face_cover_boxes(face: &TFace) -> Option<Vec<crate::math::Aabb>> {
    let reach = face_reach_box(face)?;
    let diag = crate::math::len(sub(reach.hi, reach.lo));
    let defl = (0.002 * diag).clamp(0.005, 0.1);
    let solid = TSolid { shells: vec![Rc::new(RefCell::new(Shell { faces: vec![face.clone()] }))] };
    let mesh = crate::mesh::mesh_solid(&solid, defl)?;
    let pad = 3.0 * defl + 1e-6;
    let mut out = Vec::new();
    for t in mesh.indices.chunks(3) {
        let mut b = crate::math::Aabb::empty();
        for &i in t {
            b.expand(mesh.positions[i as usize]);
        }
        for k in 0..3 {
            b.lo[k] -= pad;
            b.hi[k] += pad;
        }
        out.push(b);
    }
    if out.is_empty() { None } else { Some(out) }
}

/// The boxes `RAY_AVOID` needs for `solid`: the cover of every face whose ray count is not exact.
pub(crate) fn unsafe_face_boxes(solid: &TSolid) -> Option<Vec<crate::math::Aabb>> {
    let mut out = Vec::new();
    for f in solid.faces() {
        if unsafe_surface(&f) {
            out.extend(face_cover_boxes(&f)?);
        }
    }
    Some(out)
}

/// Does the ray from `p` along `d` (t >= 0) meet the box? Slab test, conservative by a sliver.
fn ray_meets_box(p: Vec3, d: Vec3, b: &crate::math::Aabb) -> bool {
    let (mut t0, mut t1) = (0.0f64, f64::INFINITY);
    for i in 0..3 {
        let (lo, hi) = (b.lo[i] - 1e-6, b.hi[i] + 1e-6);
        if d[i].abs() < 1e-15 {
            if p[i] < lo || p[i] > hi {
                return false;
            }
        } else {
            let (mut a, mut c) = ((lo - p[i]) / d[i], (hi - p[i]) / d[i]);
            if a > c {
                std::mem::swap(&mut a, &mut c);
            }
            t0 = t0.max(a);
            t1 = t1.min(c);
            if t0 > t1 {
                return false;
            }
        }
    }
    true
}

/// `inside_solid` while `RAY_AVOID` is set: a majority over the generic rays that miss every
/// avoided box. Counting along such a ray is exact, so the answer is exact; no half-space guess.
fn inside_solid_avoiding(solid: &TSolid, p: Vec3, avoid: &[crate::math::Aabb]) -> bool {
    // The ray count is exact for a plane and a whole cylinder. Every other face is left out of
    // the count; a ray that could meet one of them is skipped below, so leaving it out is exact.
    let safe = |f: &TFace| match &f.borrow().surface {
        Surface::Plane(_) => true,
        Surface::Cylinder(c) => c.arc.is_none() && c.cross.is_none(),
        _ => false,
    };
    let kept: Vec<TFace> = solid.faces().into_iter().filter(|f| safe(f)).collect();
    let solid = &TSolid { shells: vec![Rc::new(RefCell::new(Shell { faces: kept }))] };
    let mut dirs: Vec<Vec3> = Vec::new();
    for axis in 0..3 {
        for sgn in [1.0, -1.0] {
            let mut d = [0.0123456789, 0.0234567891, 0.0345678912];
            d[axis] = sgn;
            dirs.push(normalize(d));
            let mut e = [-0.0211, 0.0137, -0.0089];
            e[axis] = sgn;
            dirs.push(normalize(e));
        }
    }
    for (a, b, c) in [(1.0, 0.5, 0.25), (0.3, 1.0, 0.7), (0.8123, 0.3517, 0.4671), (-0.62, 0.41, 0.77), (0.55, -0.71, 0.38), (-0.43, -0.52, 0.91)] {
        dirs.push(normalize([a, b, c]));
        dirs.push(normalize([-a, -b, -c]));
    }
    let (mut odd, mut even, mut used) = (0usize, 0usize, 0usize);
    for d in dirs {
        if avoid.iter().any(|b| ray_meets_box(p, d, b)) {
            continue;
        }
        if let Some((n, true)) = crossings(solid, p, d) {
            used += 1;
            if n % 2 == 1 {
                odd += 1;
            } else {
                even += 1;
            }
        }
    }
    // Rays along a face or through an edge can still miscount, so demand a clear majority.
    if used >= 3 && odd != even && (odd >= 2 * even + 1 || even >= 2 * odd + 1) {
        return odd > even;
    }
    RAY_AVOID_FAILED.with(|f| f.set(true));
    false
}

pub(crate) fn inside_solid(solid: &TSolid, p: Vec3) -> bool {
    let avoid = RAY_AVOID.with(|a| a.borrow().clone());
    if !avoid.is_empty() {
        return inside_solid_avoiding(solid, p, &avoid);
    }
    // One fixed diagonal ray can pass exactly through a shared edge or vertex
    // of the boundary, where two faces both register the crossing and parity
    // flips (a real case: a bore probe at a box's top/side corner). Take a
    // majority over several generic directions instead of trusting one.
    // Three simple directions were not enough: a probe at (0,10,0) in a 40x40x20
    // box has TWO of them (1,.5,.25) and the diagonal run through the x=20,y=20
    // edge, outvoting the one clean ray and calling a point inside the box
    // outside it (which let a sealed pocket slip past `subtract_enclosed` as a
    // one-shell 12-face solid). Two irrational-ish extras make a 3-of-5 majority.
    let dirs: [Vec3; 5] = [
        normalize([0.5773502691896258, 0.5773502691896257, 0.5773502691896255]),
        normalize([1.0, 0.5, 0.25]),
        normalize([0.3, 1.0, 0.7]),
        normalize([0.8123, 0.3517, 0.4671]),
        normalize([0.1913, 0.7321, 0.6529]),
    ];
    let mut odd = 0usize;
    let mut even = 0usize;
    for d in dirs {
        if let Some((n, true)) = crossings(solid, p, d) {
            if n % 2 == 1 {
                odd += 1;
            } else {
                even += 1;
            }
        }
    }
    if odd > even {
        return true;
    }
    if even > odd {
        return false;
    }
    // No consensus (or nothing supported): the half-space test is right
    // whenever `other` is convex.
    for f in solid.faces() {
        let s = f.borrow().surface.clone();
        if !inside_surface(&s, p) {
            return false;
        }
    }
    true
}

/// Whether a point's membership can be decided by ray parity at all.
///
/// This is the distinction `inside_solid` above cannot express: it votes, and on a tie it
/// falls back to an `inside_surface` half-space test whose own comment says it is "right
/// whenever the solid is convex". That fallback is the assumption arrangement plus parity
/// retires, so the arrangement needs the answer WITHOUT it: a point whose membership cannot
/// be established must be Unavailable, not guessed. See
/// `.omo/plans/region-arrangement-design.md` section 3.4.
///
/// Deliberately additive: `inside_solid` is unchanged and still half-spaces on a tie. Nothing
/// routes here yet; this exists so section 3.2's cell classification can refuse instead of
/// inheriting the guess.
pub(crate) enum ParityClassification {
    /// Every face is a type where the crossing count is exact (Plane, Cylinder), and the
    /// majority of generic rays agreed. `inside` is that answer.
    Consensus { inside: bool },
    /// Membership is NOT decidable by parity here. Either some face makes the crossing
    /// count untrustworthy, or the rays did not reach a majority. Callers must refuse or
    /// fall back to something they can justify -- never to the half-space test.
    Unavailable,
}

/// Is ray parity an exact membership test for every face of `solid`?
///
/// Only Plane and full Cylinder. A Sphere counts ray roots with NO finite-face containment
/// check, so a crossing can be double-counted or missed and the count is not a boundary
/// count; `crossings` still reports it as supported, which is why support cannot be read off
/// that flag. Cone now has a real arm (K3) but parity over a cone is UNVERIFIED, and
/// region-arrangement-design.md section 3.4 says so explicitly. Torus and anything else make
/// ray counting abstain outright. All of them are Unavailable here, which is the honest
/// answer rather than a claim nobody has measured.
fn parity_is_exact(solid: &TSolid) -> bool {
    solid.faces().iter().all(|f| match &f.borrow().surface {
        Surface::Plane(_) => true,
        // A partial (arc-bounded) cylinder is not a full one; its crossing count
        // covers only the trimmed band, so parity does not decide membership.
        Surface::Cylinder(c) => c.arc.is_none(),
        _ => false,
    })
}

/// Classify `p` against `solid` by ray parity, refusing to guess. See
/// [`ParityClassification`].
pub(crate) fn parity_classification(solid: &TSolid, p: Vec3) -> ParityClassification {
    if !parity_is_exact(solid) {
        return ParityClassification::Unavailable;
    }
    // The same generic directions inside_solid uses. `crossings` cannot return None
    // for these surface types, and it reports supported, so every vote here is an exact
    // crossing count.
    let dirs: [Vec3; 3] = [
        normalize([0.5773502691896258, 0.5773502691896257, 0.5773502691896255]),
        normalize([1.0, 0.5, 0.25]),
        normalize([0.3, 1.0, 0.7]),
    ];
    let mut odd = 0usize;
    let mut even = 0usize;
    for d in dirs {
        if let Some((n, _)) = crossings(solid, p, d) {
            if n % 2 == 1 {
                odd += 1;
            } else {
                even += 1;
            }
        }
    }
    if odd > even {
        ParityClassification::Consensus { inside: true }
    } else if even > odd {
        ParityClassification::Consensus { inside: false }
    } else {
        // Unreachable with three votes and exact crossings, but the answer is NOT a
        // half-space guess. If it ever becomes reachable it must be Unavailable.
        ParityClassification::Unavailable
    }
}

/// One open cell of the arrangement: the piece of a source face's plane that a
/// cell decomposition produced, carrying its EXACT loop boundaries.
///
/// This type exists to make one specific mistake impossible. Design section 3.2
/// requires the arrangement to hold "multiple disjoint components, nested loops,
/// and non-convex unions", and says it "must not be compressed back into `Region`,
/// whose representation is intentionally convex". `Region` is an intersection of
/// half-planes, so it cannot express a face carrying a hole AT ALL -- and a hole is
/// the common case here, since every candidate trace comes from a face of `other`
/// crossing this face. A `Cell` can. If a later slice routes faces through the
/// arrangement and reaches for `Region` to hold the pieces, that is the bug this type
/// was added to catch.
///
/// Nothing constructs a `Cell` yet -- step 1b's decomposition does. This is the
/// representation plus the containment predicate that pairs with
/// [`parity_classification`]: the arrangement decides WHICH cells exist, this decides
/// what a point in one means.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Cell {
    /// Loops in the source plane's `(u, v)` coordinates. `loops[0]` is the outer
    /// boundary; every later loop is a hole in it. Windings are assumed consistent
    /// within a cell -- outer one way, holes the other -- and `cell_contains` does
    /// not care which, because it counts crossings across ALL loops together. Each
    /// cell is a separate value, so a disconnected arrangement is several `Cell`s
    /// rather than one that unions them.
    pub loops: Vec<Vec<[f64; 2]>>,
}

/// Crossings of a +u ray from `p` through one loop. Counting them per loop and
/// summing is what makes a hole subtract: its winding is opposite, so its crossings
/// land in the opposite parity bucket rather than being special-cased.
fn loop_crossings(loop_pts: &[[f64; 2]], p: [f64; 2]) -> usize {
    let mut n = 0usize;
    for i in 0..loop_pts.len() {
        let a = loop_pts[i];
        let b = loop_pts[(i + 1) % loop_pts.len()];
        // Half-open in y so a ray grazing a vertex is counted exactly once.
        if (a[1] > p[1]) != (b[1] > p[1]) {
            let dy = b[1] - a[1];
            if dy != 0.0 {
                let x = a[0] + (p[1] - a[1]) / dy * (b[0] - a[0]);
                if x > p[0] {
                    n += 1;
                }
            }
        }
    }
    n
}

/// Is `p`, in the source plane's `(u, v)`, inside `cell`?
///
/// Even-odd across ALL of the cell's loops, so a hole is genuinely outside and a
/// non-convex outer boundary needs no decomposition into convex pieces. A point ON a
/// boundary lands on whichever side the crossing count gives, which is why the
/// arrangement must sample strictly interior points (design section 3.3).
pub(crate) fn cell_contains(cell: &Cell, p: [f64; 2]) -> bool {
    cell.loops
        .iter()
        .map(|l| loop_crossings(l, p))
        .sum::<usize>()
        % 2
        == 1
}

/// Why a candidate face of `other` contributes no TRANSVERSE trace on `P`.
///
/// Both variants are refusals rather than approximations. Design section 3.1 is
/// explicit: "A candidate without an exact trace cannot be silently omitted. It causes a
/// refusal until the relevant face-pair geometry is supported." Sampling a curve into
/// facets to fill one of these is the forbidden move.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum NoTrace {
    /// The face's plane is parallel to `P`: the two planes share no transverse
    /// interval, so they cannot separate two open cells. A COPLANAR face is a
    /// different case entirely -- its bounded FOOTPRINT belongs in the arrangement
    /// (section 3.1) -- but it is not a trace and is not produced here.
    ParallelPlane,
    /// Curved. A plane cuts a full cylinder or a cone in an ellipse or conic, which
    /// must be carried ANALYTICALLY, never sampled (section 3.1).
    CurvedUnsupported,
}

/// The exact bounded trace of a PLANAR face of `other` on the probe plane `P`, in
/// `P`'s own `(u, v)` coordinates. Each returned polyline is one connected piece.
///
/// This is section 3.1's "exact bounded trace": the line where the face's plane meets
/// `P`, clipped to the face's OWN boundary. Nothing is sampled -- a planar face's trace
/// on another plane is a straight segment by construction.
///
/// Planar only, deliberately. C2 -- the case option (b) exists to fix -- has a BOX as
/// its tool, so every face of `other` is planar and this covers it. Curved faces
/// refuse rather than approximate, for the same reason [`parity_classification`]
/// refuses a sphere: an honest refusal beats a guess nobody has measured.
pub(crate) fn planar_face_trace_on_plane(f: &TFace, p: &Plane) -> Result<Vec<Vec<[f64; 2]>>, NoTrace> {
    let fb = f.borrow();
    let Surface::Plane(g) = &fb.surface else {
        return Err(NoTrace::CurvedUnsupported);
    };
    let d = crate::math::cross(g.n, p.n);
    let dd = crate::math::dot(d, d);
    if dd <= TOL * TOL {
        return Err(NoTrace::ParallelPlane);
    }
    // The line where the two planes meet. For planes n1.x = c1 and n2.x = c2 the
    // intersection is the line through `a` along `d`, where
    //   d = n1 x n2,   a = (c1*(n2 x d) + c2*(d x n1)) / |d|^2.
    // Both cross products are perpendicular to d, so `a` lies in the span that keeps
    // the point on BOTH planes, and |d|^2 fixes the scale.
    let c1 = dot(g.n, g.origin);
    let c2 = dot(p.n, p.origin);
    let a = add(scale(cross(p.n, d), c1 / dd), scale(cross(d, g.n), c2 / dd));
    let dir = normalize(d);
    // Clip that line to the face's own boundary. Each boundary edge meets it at at
    // most one parameter; the crossings sort and consecutive PAIRS bound the pieces.
    // Pairing rather than first-to-last is what makes a CONCAVE face yield two
    // segments instead of one that runs outside it.
    let mut ts: Vec<f64> = Vec::new();
    for w in &fb.boundary {
        let wb = w.borrow();
        for u in &wb.edges {
            let (pa, pb) = {
                let eb = u.edge.borrow();
                let (x, y) = (eb.a.borrow().point, eb.b.borrow().point);
                if u.forward {
                    (x, y)
                } else {
                    (y, x)
                }
            };
            // The edge meets the line where pa + t*v = a + s*dir, i.e. t*v - s*dir =
            // w0. Crossing both sides with `dir` removes s and leaves t solvable --
            // but only when the two cross products are PARALLEL, which is exactly the
            // coplanarity test. So a non-parallel pair means "no intersection", not a
            // bad solve, and there is no epsilon to tune.
            let v = sub(pb, pa);
            let w0 = sub(a, pa);
            let cvd = crate::math::cross(v, dir);
            let c0d = crate::math::cross(w0, dir);
            let par = crate::math::cross(cvd, c0d);
            let par_len2 = dot(par, par);
            let den = dot(cvd, cvd);
            if den.abs() <= 1e-300 || par_len2 > 1e-18 {
                continue;
            }
            let t = dot(c0d, cvd) / den;
            if (-1e-9..=1.0 + 1e-9).contains(&t) {
                // `t` is the parameter along THIS EDGE. The arrangement needs a
                // parameter along the intersection LINE, which is a different
                // quantity -- using `t` for both is what made every segment
                // collapse to a point. Project the crossing onto the line first.
                let at = add(pa, scale(v, t));
                ts.push(dot(sub(at, a), dir));
            }
        }
    }
    ts.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
    // A polygon vertex belongs to two edges, so both report the same crossing and
    // it lands in `ts` twice -- which paired with itself into a zero-length
    // segment. Collapsing duplicates also makes the pairing robust to a face whose
    // boundary grazes the line, which is exactly where a near-tie must not become
    // a real cut.
    let span = ts.last().copied().unwrap_or(0.0) - ts.first().copied().unwrap_or(0.0);
    let dedup = span.abs() * 1e-9;
    let mut uniq: Vec<f64> = Vec::with_capacity(ts.len());
    for t in ts {
        if uniq.last().map_or(true, |l: &f64| (t - *l).abs() > dedup) {
            uniq.push(t);
        }
    }
    let ts = uniq;
    let mut out: Vec<Vec<[f64; 2]>> = Vec::new();
    for pair in ts.chunks_exact(2) {
        let (t0, t1) = (pair[0], pair[1]);
        let q0 = p.project(add(a, scale(dir, t0)));
        let q1 = p.project(add(a, scale(dir, t1)));
        out.push(vec![[q0[0], q0[1]], [q1[0], q1[1]]]);
    }
    Ok(out)
}

/// Absolute area of a cell: outer boundary plus its holes. A DEGENERATE cell has
/// zero area and a caller must drop it rather than emit a zero-area face, which is
/// what design section 3.2 means by "non-zero-area open cells".
pub(crate) fn cell_area(cell: &Cell) -> f64 {
    let mut acc = 0.0f64;
    for l in &cell.loops {
        let mut a = 0.0f64;
        for i in 0..l.len() {
            let p = l[i];
            let q = l[(i + 1) % l.len()];
            a += p[0] * q[1] - q[0] * p[1];
        }
        acc += a * 0.5;
    }
    acc.abs()
}

/// Does point `q`, already ON the sphere's surface, lie on this face's trimmed
/// patch? The patch is the (u, v) box `u_range` x `v_range` less the two polar
/// square caps a centred tube removes (`trim`). A full, untrimmed sphere
/// contains every point. Without this a ray root on a zone or a tube-drilled
/// sphere counted whether or not the face existed there.
fn sphere_face_contains(sp: &crate::geom::SphereSurf, q: Vec3) -> bool {
    let tol = 1e-7;
    let w = sub(q, sp.center);
    let r = crate::math::len(w);
    if r < 1e-12 {
        return false;
    }
    if let Some(h) = sp.trim {
        if dot(w, normalize(sp.e1)).abs() < h - tol && dot(w, normalize(sp.e2)).abs() < h - tol {
            return false;
        }
    }
    let axis = normalize(sp.axis);
    let v = (dot(w, scale(axis, -1.0)) / r).clamp(-1.0, 1.0).acos();
    if v < sp.v_range[0] - tol || v > sp.v_range[1] + tol {
        return false;
    }
    if (sp.u_range[1] - sp.u_range[0] - TWO_PI).abs() < 1e-9 {
        return true;
    }
    let mut u = dot(w, normalize(sp.e2)).atan2(dot(w, normalize(sp.e1))) - sp.u_range[0];
    while u < -tol {
        u += TWO_PI;
    }
    u <= sp.u_range[1] - sp.u_range[0] + tol
}

/// Parameters t > 0 where the ray p + t d (d unit) crosses the FULL torus of
/// `tor`, found by sign changes of the quartic
///   (|x|^2 + R^2 - r^2)^2 - 4 R^2 (|x|^2 - (x . a)^2),  x = p + t d - centre.
/// A torus lies inside a ball of radius R + r, so no root exceeds |w| + R + r.
/// Roots are bracketed on a fixed grid and bisected; an even-multiplicity (tangent)
/// root shows no sign change and is missed, which `inside_solid`'s majority over
/// several generic rays already tolerates.
fn ray_torus(d: Vec3, p: Vec3, tor: &crate::geom::TorusSurf) -> Vec<f64> {
    let a = normalize(tor.axis);
    let w = sub(p, tor.center);
    let (big_r, r) = (tor.ring, tor.tube);
    let k = big_r * big_r - r * r;
    let f = |t: f64| {
        let x = add(w, scale(d, t));
        let xx = dot(x, x);
        let ax = dot(x, a);
        (xx + k) * (xx + k) - 4.0 * big_r * big_r * (xx - ax * ax)
    };
    let t_max = crate::math::len(w) + big_r + r;
    const STEPS: usize = 512;
    let mut roots = Vec::new();
    let mut t0 = 0.0;
    let mut f0 = f(t0);
    for i in 1..=STEPS {
        let t1 = t_max * i as f64 / STEPS as f64;
        let f1 = f(t1);
        if f0 == 0.0 {
            roots.push(t0);
        } else if f0 * f1 < 0.0 {
            let (mut lo, mut hi, mut flo) = (t0, t1, f0);
            for _ in 0..80 {
                let mid = 0.5 * (lo + hi);
                let fm = f(mid);
                if flo * fm <= 0.0 {
                    hi = mid;
                } else {
                    lo = mid;
                    flo = fm;
                }
            }
            roots.push(0.5 * (lo + hi));
        }
        t0 = t1;
        f0 = f1;
    }
    roots
}

/// Does `q`, already ON the torus, lie on this face's patch? Only the tube angle
/// v is ever trimmed (`v_range`); the ring angle u is always the full turn.
fn torus_face_contains(tor: &crate::geom::TorusSurf, q: Vec3) -> bool {
    let tol = 1e-7;
    let a = normalize(tor.axis);
    let w = sub(q, tor.center);
    let h = dot(w, a);
    let rho = crate::math::len(sub(w, scale(a, h)));
    let mut v = h.atan2(rho - tor.ring);
    if v < 0.0 {
        v += TWO_PI;
    }
    let (lo, hi) = (tor.v_range[0], tor.v_range[1]);
    if (hi - lo - TWO_PI).abs() < 1e-9 {
        return true;
    }
    // A range may wrap past 2pi; compare modulo a turn.
    let rel = (v - lo).rem_euclid(TWO_PI);
    rel <= hi - lo + tol || rel >= TWO_PI - tol
}

/// The number of boundary crossings of a ray from `p` along unit direction `d`,
/// and whether every face was a supported type. Callers pick `d` so it is not
/// parallel to a face or grazing an edge.
fn crossings(solid: &TSolid, p: Vec3, d: Vec3) -> Option<(usize, bool)> {
    let mut count = 0usize;
    let mut supported = true;
    for f in solid.faces() {
        let f = f.borrow();
        match &f.surface {
            Surface::Plane(g) => {
                let den = dot(d, g.n);
                if den.abs() < 1e-12 {
                    continue;
                }
                let t = dot(sub(g.origin, p), g.n) / den;
                if t > 1e-9 {
                    let q = add(p, scale(d, t));
                    if plane_face_contains(g, &f, q) {
                        count += 1;
                    }
                }
            }
 Surface::Cylinder(c) => {
                match ray_cylinder(d, p, c) {
                    None => {}
                    Some(ts) => {
                        for t in ts {
                            if t <= 1e-9 {
                                continue;
                            }
                            let q = add(p, scale(d, t));
                            if cyl_face_contains(c, q) {
                                count += 1;
                            }
                        }
                    }
                }
 }
 Surface::Cone(c) => {
 if let Some(ts) = ray_cone(d, p, c) {
 for t in ts {
 if t > 1e-9 && cone_face_contains(c, add(p, scale(d, t))) {
 count += 1;
 }
 }
 }
 }
 Surface::Sphere(s) => {
                let w = sub(p, s.center);
                let a = dot(d, d);
                let b = 2.0 * dot(w, d);
                let cc = dot(w, w) - s.radius * s.radius;
                for t in crate::math::solve_quadratic(a, b, cc) {
                    if t > 1e-9 && sphere_face_contains(s, add(p, scale(d, t))) {
                        count += 1;
                    }
                }
            }
            Surface::Torus(tor) => {
                for t in ray_torus(d, p, tor) {
                    if t > 1e-9 && torus_face_contains(tor, add(p, scale(d, t))) {
                        count += 1;
                    }
                }
            }
        }
    }
    Some((count, supported))
}

fn plane_face_contains(g: &Plane, f: &Face<Curve3, Surface3>, q: Vec3) -> bool {
    if let Some(inside) = crate::ops_planar::face_contains_exact(g, f, q) {
        return inside;
    }
    // A disk cap is a single circular boundary.
    if f.boundary.len() == 1 {
        let w = f.boundary.first().unwrap();
        let uses = w.borrow().edges.clone();
        if uses.len() == 1 {
            if let Curve::Circle { center, radius, .. } = &uses[0].edge.borrow().curve {
                return crate::math::len(sub(q, *center)) <= *radius + 1e-7;
            }
        }
    }
    let uv = g.project(q);
    let mut inside = false;
    for (wi, w) in f.boundary.iter().enumerate() {
        let wb = w.borrow();
        let uses = wb.edges.clone();
        if uses.len() == 1 {
            if let Curve::Circle { center, radius, .. } = &uses[0].edge.borrow().curve {
                let c_uv = g.project(*center);
                let d = [(uv[0] - c_uv[0]) as f64, (uv[1] - c_uv[1]) as f64];
                let in_disk = d[0] * d[0] + d[1] * d[1] <= radius * radius + 1e-7;
                if wi == 0 && in_disk {
                    inside = true;
                } else if wi > 0 && in_disk {
                    return false;
                }
                continue;
            }
        }
        let mut pts = Vec::new();
        for u in &uses {
            let eb = u.edge.borrow();
            let pk = if u.forward { eb.a.borrow().point } else { eb.b.borrow().point };
            pts.push(g.project(pk));
            // An Arc edge bulges away from the straight chord between its
            // endpoints: an annulus sector bounded by two arcs would otherwise
            // project to a collinear quad of its four corners and register no
            // interior at all. Sample the curve (in traversal order) so the
            // polygon follows the real boundary.
            if matches!(eb.curve, Curve::Arc { .. } | Curve::Circle { .. }) {
                let steps = 16;
                for k in 1..steps {
                    let frac = (k as f64) / (steps as f64);
                    let t = if u.forward { frac } else { 1.0 - frac };
                    pts.push(g.project(eb.curve.point_at(t)));
                }
            }
        }
        if pts.len() < 3 {
            continue;
        }
        let in_poly = point_in_poly(&pts, uv);
        if wi == 0 && in_poly {
            inside = true;
        } else if wi > 0 && in_poly {
            return false;
        }
    }
    inside
}

fn cyl_face_contains(c: &Cylinder, q: Vec3) -> bool {
    let dv = sub(q, c.origin);
    let av = dot(dv, c.axis);
    if av < c.vmin - 1e-7 || av > c.vmax + 1e-7 {
        return false;
    }
    if let Some(arc) = &c.arc {
        let r = sub(dv, scale(c.axis, av));
        let e1 = dot(r, c.e1);
        let e2 = dot(r, c.e2);
        let mut a = e2.atan2(e1) - arc.start;
        a = a.rem_euclid(TWO_PI);
        if a > arc.span + 1e-7 {
            return false;
        }
    }
    true
}

fn ray_cylinder(d: Vec3, p: Vec3, c: &Cylinder) -> Option<Vec<f64>> {
    let w = sub(p, c.origin);
    let dw = dot(d, c.axis);
    let ww = dot(w, c.axis);
    let dp = sub(d, scale(c.axis, dw));
    let wp = sub(w, scale(c.axis, ww));
    let a = dot(dp, dp);
    let b = 2.0 * dot(wp, dp);
    let cc = dot(wp, wp) - c.radius * c.radius;
    if a.abs() < 1e-12 {
        return None;
    }
    Some(crate::math::solve_quadratic(a, b, cc))
}

fn cone_face_contains(c: &Cone, q: Vec3) -> bool {
 let along = dot(sub(q, c.base), c.axis);
 let v = along / c.half_angle.cos();
 v >= c.v_range[0] - 1e-7 && v <= c.v_range[1] + 1e-7
}

fn ray_cone(d: Vec3, p: Vec3, c: &Cone) -> Option<Vec<f64>> {
 let w = sub(p, c.base);
 let dw = dot(d, c.axis);
 let ww = dot(w, c.axis);
 let dp = sub(d, scale(c.axis, dw));
 let wp = sub(w, scale(c.axis, ww));
 let tan = c.half_angle.tan();
 let radius = c.base_radius - ww * tan;
 let a = dot(dp, dp) - tan * tan * dw * dw;
 let b = 2.0 * (dot(wp, dp) + radius * tan * dw);
 let cc = dot(wp, wp) - radius * radius;
 if a.abs() < 1e-12 {
 return if b.abs() < 1e-12 { None } else { Some(vec![-cc / b]) };
 }
 Some(crate::math::solve_quadratic(a, b, cc))
}

fn inside_surface(s: &Surface, p: Vec3) -> bool {
    match s {
        Surface::Plane(pl) => dot(sub(p, pl.origin), pl.n) <= TOL,
        Surface::Cylinder(c) => {
            let d = sub(p, c.origin);
            let along = dot(d, c.axis);
            if along < c.vmin - TOL || along > c.vmax + TOL {
                return false;
            }
            let radial = sub(d, scale(c.axis, along));
            if crate::math::len(radial) > c.radius + TOL {
                return false;
            }
            if let Some(arc) = &c.arc {
                let ang = c.e2[0] * radial[0] + c.e2[1] * radial[1] + c.e2[2] * radial[2];
                let _ = ang;
                let e1 = dot(radial, c.e1);
                let e2v = dot(radial, c.e2);
                let mut a = e2v.atan2(e1) - arc.start;
                a = a.rem_euclid(TWO_PI);
                if a > arc.span + TOL {
                    return false;
                }
            }
            true
        }
        Surface::Sphere(s) => crate::math::len(sub(p, s.center)) <= s.radius + TOL,
 Surface::Cone(c) => {
 let d = sub(p, c.base);
 let along = dot(d, c.axis);
 let v = along / c.half_angle.cos();
 if v < c.v_range[0] - TOL || v > c.v_range[1] + TOL {
 return false;
 }
 let radial = sub(d, scale(c.axis, along));
 let r = c.base_radius - v * c.half_angle.sin();
            crate::math::len(radial) <= r + TOL
        }
 Surface::Torus(t) => {
            let d = sub(p, t.center);
            let axial = dot(d, t.axis);
            let radial = sub(d, scale(t.axis, axial));
            let rho = crate::math::len(radial);
            let dr = rho - t.ring;
            dr * dr + axial * axial <= t.tube * t.tube + TOL
        }
    }
}

// ---------------------------------------------------------------------------
// 2D region algebra on a planar face, in the plane's own (u, v) frame.
// ---------------------------------------------------------------------------

/// A convex-in-2D region expressed as an intersection of half-planes
/// `a*u + b*v + c <= 0` and an optional disk `|p - c| <= r`.
#[derive(Clone, Default)]
struct Region {
    hs: Vec<[f64; 3]>,
    disk: Option<([f64; 2], f64)>,
    /// A subtractive circle: the region is the disk/half-planes MINUS this
    /// circle. How a torus band cut by a perpendicular plane (an annulus)
    /// is expressed. At most one.
    hole: Option<([f64; 2], f64)>,
    empty: bool,
}

impl Region {
    fn empty() -> Self {
        Region { hs: Vec::new(), disk: None, hole: None, empty: true }
    }
    fn all() -> Self {
        Region { hs: Vec::new(), disk: None, hole: None, empty: false }
    }
    fn with_disk(c: [f64; 2], r: f64) -> Self {
        Region { hs: Vec::new(), disk: Some((c, r)), hole: None, empty: false }
    }
    fn push_hl(&mut self, h: [f64; 3]) {
        self.hs.push(h);
    }
    fn intersect_disk(&mut self, c: [f64; 2], r: f64) {
        match self.disk {
            None => self.disk = Some((c, r)),
            Some((oc, orr)) => {
                // Two disks: keep the smaller if it is contained, else cannot
                // represent -- mark empty conservatively. Not hit by fixtures.
                if crate::math::len([c[0] - oc[0], c[1] - oc[1], 0.0]) + r <= orr + 1e-7 {
                    self.disk = Some((c, r));
                } else if crate::math::len([c[0] - oc[0], c[1] - oc[1], 0.0]) + orr <= r + 1e-7 {
                    // keep larger
                } else {
                    self.empty = true;
                }
            }
        }
    }
}

fn signed_area2(p: &[[f64; 2]]) -> f64 {
    let n = p.len();
    let mut a = 0.0;
    for i in 0..n {
        let q = p[(i + 1) % n];
        a += p[i][0] * q[1] - q[0] * p[i][1];
    }
    a
}

fn poly_area(p: &[[f64; 2]]) -> f64 {
    (signed_area2(p) * 0.5).abs()
}

fn point_in_poly(poly: &[[f64; 2]], p: [f64; 2]) -> bool {
    let n = poly.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (poly[i][0], poly[i][1]);
        let (xj, yj) = (poly[j][0], poly[j][1]);
        if ((yi > p[1]) != (yj > p[1]))
            && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Strictly-inside variant: an on-edge or on-vertex point reads false, so a
/// bite sharing edges with the face is detectable (the coplanar rescue's
/// complement path).
fn point_in_poly_strict(poly: &[[f64; 2]], p: [f64; 2]) -> bool {
    let n = poly.len();
    let eps = 1e-9;
    // On-edge check first: distance from p to each segment.
    for i in 0..n {
        let a = poly[i];
        let b = poly[(i + 1) % n];
        let ab = [b[0] - a[0], b[1] - a[1]];
        let ap = [p[0] - a[0], p[1] - a[1]];
        let denom = ab[0] * ab[0] + ab[1] * ab[1];
        if denom < 1e-18 {
            continue;
        }
        let t = (ap[0] * ab[0] + ap[1] * ab[1]) / denom;
        if !(0.0..=1.0).contains(&t) {
            continue;
        }
        let dx = ap[0] - ab[0] * t;
        let dy = ap[1] - ab[1] * t;
        if dx * dx + dy * dy <= eps * eps {
            return false;
        }
    }
    point_in_poly(poly, p)
}

/// Sutherland-Hodgman clip of `subj` by the half-plane `a*u + b*v + c <= 0`.
/// Clip `subj` to the half-plane `a*u + b*v + c <= 0`, returning ONE loop.
///
/// **THE SUBJECT MUST BE CONVEX.** A half-plane is convex, so clipping a non-convex
/// subject to one half-plane gives the right REGION -- but that region can need
/// several contours, and this returns only the first.
///
/// Measured 2026-10-01 on a dumbbell -- two 2x2 squares joined by a bridge, a
/// single genuinely-connected loop -- a clip keeping one side of the bridge returns
/// ONE eight-point loop covering the full 8x2 span, area **16**. The correct answer
/// is the two squares, area **8**. The gap between them is filled in and nothing is
/// reported.
///
/// The merge leaves NO topological trace: the result is a SIMPLE polygon, with no
/// self-intersection and no coincident non-adjacent vertices -- the only sign is
/// collinear vertices flattened into a straight edge. So a connectivity check on the
/// output cannot catch it, and a guard written to try will report false confidence.
/// Catching it needs a real multi-contour clip emitting one loop per piece.
///
/// Both live callers (`clip_poly_by_poly`, `poly_minus_poly`) pass CONVEX subjects by
/// contract, so neither is affected. Recorded for the arrangement, whose `Cell` is
/// non-convex BY DESIGN: step 2 must not reach for this on a cell.
fn clip_halfplane(subj: &[[f64; 2]], a: f64, b: f64, c: f64) -> Vec<[f64; 2]> {
    if subj.len() < 3 {
        return Vec::new();
    }
    let norm = (a * a + b * b).sqrt().max(1e-12);
    let tol = 1e-9 * norm;
    let f = |p: [f64; 2]| a * p[0] + b * p[1] + c;
    let mut out: Vec<[f64; 2]> = Vec::with_capacity(subj.len() + 2);
    for i in 0..subj.len() {
        let p = subj[i];
        let q = subj[(i + 1) % subj.len()];
        let fp = f(p);
        let fq = f(q);
        if fp <= tol {
            out.push(p);
        }
        if (fp <= tol) != (fq <= tol) {
            let t = fp / (fp - fq);
            out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
    }
    out
}

/// The half-plane equation in `plane`'s frame for the other face's plane `g`,
/// evaluated at `plane.origin + offset` (the probe point).
fn halfplane_of(plane: &Plane, g: &Plane, offset: Vec3) -> [f64; 3] {
 let a = dot(g.n, plane.u);
 let b = dot(g.n, plane.v);
 let c = dot(sub(add(plane.origin, offset), g.origin), g.n);
 [a, b, c]
}

/// The region of `plane` that is inside a cylinder face, when the cylinder axis
/// is PARALLEL to the plane (the radial condition is a slab, the cap condition
/// is a slab: four half-planes).
fn cyl_parallel_region(cy: &Cylinder, plane: &Plane, offset: Vec3) -> Region {
    if cy.arc.is_some() {
        return Region::empty();
    }
    let a = normalize(cy.axis);
    let n = plane.n;
    // Perpendicular distance from the axis line to the plane.
    let dist = dot(sub(plane.origin, cy.origin), n).abs();
    if dist > cy.radius + 1e-9 {
        return Region::empty();
    }
    if dist > cy.radius - 1e-9 {
        // Tangent: the intersection is a line of measure zero.
        return Region::empty();
    }
    let e2 = normalize(cross(n, a));
    let base = sub(add(plane.origin, offset), cy.origin);
    let base_e2 = dot(base, e2);
    let ue2 = dot(plane.u, e2);
    let ve2 = dot(plane.v, e2);
    let base_a = dot(base, a);
    let ua = dot(plane.u, a);
    let va = dot(plane.v, a);
    let mut r = Region::all();
    r.push_hl([ue2, ve2, base_e2 - cy.radius]);
    r.push_hl([-ue2, -ve2, -base_e2 - cy.radius]);
    r.push_hl([ua, va, base_a - cy.vmin]);
    r.push_hl([-ua, -va, cy.vmax - base_a]);
    r
}

/// The region of `plane` inside a cylinder face whose axis is PERPENDICULAR to
/// the plane: a disk (or empty when the plane lies beyond a cap).
fn cyl_perp_region(cy: &Cylinder, plane: &Plane, offset: Vec3) -> Region {
    // A HALF-cylinder wall (a 180-degree revolve) is the disk here: the two
    // coplanar diametral faces of the same solid carry the half-plane that
    // makes it a half disk. Any other arc stays "constrains nothing".
    if let Some(arc) = &cy.arc {
        if (arc.span - std::f64::consts::PI).abs() > 1e-9 {
            return Region::empty();
        }
    }
    let ad = dot(cy.axis, plane.n);
    let t = dot(sub(plane.origin, cy.origin), plane.n) / ad;
    let along_q = t + dot(offset, cy.axis);
    if along_q < cy.vmin - TOL || along_q > cy.vmax + TOL {
        return Region::empty();
    }
    let center3 = add(cy.origin, scale(cy.axis, t));
    Region::with_disk(plane.project(center3), cy.radius)
}

/// The region of `plane` inside a sphere surface: a disk (or empty/all).
fn sphere_region(sp: &crate::geom::SphereSurf, plane: &Plane) -> Region {
 let c = sp.center;
    let d = dot(sub(c, plane.origin), plane.n);
    let r2 = sp.radius * sp.radius - d * d;
    if r2 <= 1e-12 {
        // Tangential or clear: no interior area on the plane.
        return Region::empty();
    }
    let foot = sub(c, scale(plane.n, d));
    Region::with_disk(plane.project(foot), r2.sqrt())
}

/// The set of points of `plane` (probe-shifted by `offset`) that lie inside
/// `other`. `None` means the kernel cannot express the intersection and the
/// caller must refuse.
fn region_inside(other: &TSolid, plane: &Plane, offset: Vec3) -> Option<Region> {
    let mut region = Region::all();
    for f in other.faces() {
        let s = f.borrow().surface.clone();
 match &s {
 Surface::Plane(g) => {
                // A planar face PARALLEL to the probe plane contributes the
                // degenerate (0,0,c) half-plane: a CONSTANT over the whole
                // probe plane. For a MATERIAL cap that is right (the solid
                // ends at that plane); for a VOID face (a prior bore's
                // floor/ceiling) it is wrong — material continues behind the
                // plane everywhere else, and the constant kills the next
                // bore's floor probes (the pi*9*8/3 residual of msgbox #329's
                // flush case). Void signature: material EXISTS behind the
                // plane (−n step) at a point OUTSIDE the face's own area —
                // a material cap has nothing behind its plane except within
                // its own area, a void face has the rest of the solid there.
 {
 let fb = f.borrow();
 let (a_, b_) = (dot(g.n, plane.u).abs(), dot(g.n, plane.v).abs());
 if a_ < 1e-9 && b_ < 1e-9 {
                        // Parallel. Sample beside the face: face centroid plus
                        // 2x its own bbox half-diagonal, in-plane.
                        let (area, c3) = build::face_area_centroid(&fb);
                        if area > 0.0 {
                            // face bbox in-plane radius
                            let mut rr = 0.0f64;
                            for w in &fb.boundary {
                                let wb = w.borrow();
                                for u in &wb.edges {
                                    let eb = u.edge.borrow();
                                    for p in [eb.a.borrow().point, eb.b.borrow().point] {
                                        let d = crate::math::len(sub(p, c3));
                                        if d > rr {
                                            rr = d;
                                        }
                                    }
                                }
                            }
                            // In-plane directions away from the face: sample
                            // BOTH signs of BOTH in-plane axes. The earlier
                            // single +plane.u sample was frame-luck: for the
                            // Y1 pocket floor probed from the leg-bottom
                            // plane, plane.u pointed away from the material,
                            // the sample landed outside the solid, the void
                            // went undetected and the floor's constant
                            // ("z <= 5" on the z=10 plane) leaked into the
                            // leg-bottom rescue's region0 and emptied it.
                            let mut void_face = false;
                            for dir in [plane.u, scale(plane.u, -1.0), plane.v, scale(plane.v, -1.0)] {
                                let beside = add(c3, scale(dir, 2.0 * rr + 1.0));
                                let behind = sub(beside, scale(g.n, 4.0 * PROBE));
                                if inside_solid(other, behind) {
                                    // Material continues behind this plane at
                                    // a point beside the face's area: void.
                                    void_face = true;
                                    break;
                                }
                            }
                            if void_face {
                                continue;
                            }
                        }
                        // A STEP face -- a counterbore tool's shoulder, the
                        // annulus between its two radii -- is parallel but not a
                        // supporting plane: its constant holds only across its
                        // own area, which the half-plane algebra cannot say.
                        // With the probe past it (outer side) while some face of
                        // `other` crosses the probe plane, `other` has material
                        // on that plane and "nothing here" is false: leave the
                        // section to the walls crossing it. A probe past the
                        // whole solid crosses nothing, so the solid's own end
                        // caps still end it.
                        let probe = add(plane.origin, offset);
                        if dot(sub(probe, g.origin), g.n) > TOL && crosses_probe_plane(other, probe, plane.n) {
                            continue;
                        }
                    }
                }
 let h = halfplane_of(plane, g, if dot(g.n, plane.u).abs() < 1e-9 && dot(g.n, plane.v).abs() < 1e-9 { offset } else { [0.0; 3] });
 region.push_hl(h);
            }
 Surface::Cylinder(cy) => {
                let ad = dot(cy.axis, plane.n).abs();
                if (ad - 1.0).abs() < 1e-9 {
                    // Cylinder axis perpendicular to plane: the intersection is a disk.
                    // But if this cylindrical face bounds a void (inward-facing normal),
                    // it should not constrain the region. Void walls occur when a prior
                    // bore's wall becomes part of the base solid -- its normal points
                    // toward the cylinder axis (into the void), not away into material.
                    let face = f.borrow();
                    // Use a point on the cylinder surface (u=0, v=mid) to compute radial.
                    let vm = 0.5 * (cy.vmin + cy.vmax);
                    let point_on_surface = add(cy.origin, add(scale(cy.e1, cy.radius), scale(cy.axis, vm)));
                    let axis_proj = add(cy.origin, scale(cy.axis, dot(sub(point_on_surface, cy.origin), cy.axis)));
                    let radial = sub(point_on_surface, axis_proj);
                    // Face normal at u=0. p(u,v)=origin+R(e1·cosu+e2·sinu)+axis·v;
                    // dp/du at u=0 is R·e2, dp/dv is axis, and the outward
                    // normal (dp/du × dp/dv) is R·(e2×axis) — i.e. +e1, the
                    // radial direction, for the original frame. `flip_face`
                    // reverses a bore wall by negating e2 with forward kept
                    // true, which flips dp/du and hence the normal, so the
                    // face's outward normal at u=0 is
                    // cross(cy.e2, cy.axis) · (face.forward ? 1 : -1).
                    // A void wall's normal points INTO the void: dot < 0 vs
                    // the radial direction (probe at u=0, v=mid).
                    let surface_normal = cross(cy.e2, cy.axis);
                    let face_normal = if face.forward { surface_normal } else { scale(surface_normal, -1.0) };
                    if dot(face_normal, radial) < 0.0 {
                        // Void wall - skip (bounds empty space, not material)
                        continue;
                    }
                    let r = cyl_perp_region(cy, plane, offset);
                    if r.empty {
                        // Beyond the wall's own v-band the wall surface does
                        // not exist on this plane: it constrains nothing --
                        // the solid's cap planes bound the region instead
                        // (the same fall-through the torus and cone arms
                        // use). Returning empty here killed the whole region
                        // whenever the probe plane sat past a SHORTENED wall
                        // (the Y2 filleted flange: wall z[-3,0], probe plane
                        // z=3), declaring "outside the solid" material the
                        // torus and top disk still bound.
                        continue;
                    }
                    if let Some((c, rr)) = r.disk {
                        region.intersect_disk(c, rr);
                    }
                } else if ad < 1e-9 {
                    // A VOID WALL (an inward-facing cylindrical face left by a
                    // prior bore) bounds empty space, not material: it must
                    // not constrain the region. Without this skip the wall's
                    // half-planes collapse the region to the old bore's
                    // cross-section and every later bore's floor is silently
                    // dropped (msgbox #329: floors lost == prior-bore count).
                    // Same normal formula the perpendicular arm uses: the
                    // face's outward normal at u=0 is cross(cy.e2, cy.axis)
                    // · forward; a void wall's points INTO the void.
                    {
                        let face = f.borrow();
                        let vm = 0.5 * (cy.vmin + cy.vmax);
                        let point_on_surface = add(cy.origin, add(scale(cy.e1, cy.radius), scale(cy.axis, vm)));
                        let axis_proj = add(cy.origin, scale(cy.axis, dot(sub(point_on_surface, cy.origin), cy.axis)));
                        let radial = sub(point_on_surface, axis_proj);
                        let surface_normal = cross(cy.e2, cy.axis);
                        let face_normal = if face.forward { surface_normal } else { scale(surface_normal, -1.0) };
                        if dot(face_normal, radial) < 0.0 {
                            continue;
                        }
                    }
                    let r = cyl_parallel_region(cy, plane, offset);
                    if r.empty {
                        return Some(Region::empty());
                    }
                    for h in r.hs {
                        region.push_hl(h);
                    }
                } else {
                    return None;
                }
            }
            Surface::Torus(t) => {
                // A torus band cut by a plane PERPENDICULAR to its axis is
                // an annulus: expressed as disk(outer) MINUS hole(inner).
                // A plane parallel or oblique cuts it in two circles — not
                // expressible in one convex region; refuse.
                let ad = dot(t.axis, plane.n).abs();
                if (ad - 1.0).abs() < 1e-9 {
                    let probe = add(plane.origin, offset);
                    let d = sub(probe, t.center);
                    let axial = dot(d, t.axis);
                    // Outside the tube's axial span the torus surface does
                    // not exist on this plane: it constrains nothing.
                    if axial.abs() > t.tube + 1e-9 {
                        continue;
                    }
                    // Ring radii at this axial cut: the tube circle of
                    // radius `tube` centered (ring, axial) gives
                    // rho = ring ± sqrt(tube^2 - axial^2).
                    let half = (t.tube * t.tube - axial * axial).sqrt();
                    let r_out = t.ring + half;
                    let r_in = (t.ring - half).max(0.0);
                    let center_uv = plane.project(add(t.center, scale(t.axis, axial)));
                    region.disk = Some((center_uv, r_out));
                    if r_in > 1e-9 {
                        region.hole = Some((center_uv, r_in));
                    }
                } else {
                    return None;
                }
            }
 Surface::Cone(c) => {
 let ad = dot(c.axis, plane.n).abs();
 if (ad - 1.0).abs() < 1e-9 {
                    // Plane perpendicular to the axis: the cross-section is a
                    // disk of radius r(along) = base_radius − along·tan,
                    // centered on the axis — expressible. Outside the face's
                    // own v band the face bounds nothing here; the solid's
                    // cap planes constrain the region instead (the same
                    // fall-through the sphere arm uses).
 let axis = normalize(c.axis);
 let face = f.borrow();
 let vm = 0.5 * (c.v_range[0] + c.v_range[1]);
 let r_mid = c.base_radius - vm * c.half_angle.sin();
 let radial = scale(c.e1, r_mid);
 let dv = add(scale(c.e1, -c.half_angle.sin()), scale(axis, c.half_angle.cos()));
 let surface_normal = cross(scale(c.e2, r_mid), dv);
 let face_normal = if face.forward { surface_normal } else { scale(surface_normal, -1.0) };
 if dot(face_normal, radial) < 0.0 {
 continue;
 }
 let probe = add(plane.origin, offset);
 let along_probe = dot(sub(probe, c.base), axis);
 let band_lo = c.v_range[0] * c.half_angle.cos();
 let band_hi = c.v_range[1] * c.half_angle.cos();
 // Past a cone that runs all the way to its apex there is no material at
 // all, not "a face that bounds nothing here".
 if c.base_radius - c.v_range[1] * c.half_angle.sin() <= 1e-9 && along_probe > band_hi + TOL {
     return Some(Region::empty());
 }
 if along_probe >= band_lo - TOL && along_probe <= band_hi + TOL {
 let along = dot(sub(plane.origin, c.base), axis);
 let r = c.base_radius - along * c.half_angle.tan();
                        if r <= TOL {
                            return Some(Region::empty());
                        }
                        let centre3 = add(c.base, scale(axis, along));
                        region.intersect_disk(plane.project(centre3), r);
                    }
 } else if ad < 1e-9 {
 let axis = normalize(c.axis);
 let probe = add(plane.origin, offset);
 let along = dot(sub(probe, c.base), axis);
 let v = along / c.half_angle.cos();
 if v < c.v_range[0] - TOL || v > c.v_range[1] + TOL {
 continue;
 }
 let radial = sub(sub(probe, c.base), scale(axis, along));
 let r = c.base_radius - v * c.half_angle.sin();
 if crate::math::len(radial) > r + TOL {
 return Some(Region::empty());
 }
 return None;
 } else {
 return None;
 }
            }
            Surface::Sphere(sp) => {
 let r = sphere_region(sp, plane);
                if let Some((c, rr)) = r.disk {
                    region.intersect_disk(c, rr);
                } else if r.empty {
                    // A sphere can also contain the whole plane region; fall
                    // through as unconstrained only when the plane is fully
                    // inside. Otherwise this face alone cannot bound it.
                    if crate::math::len(sub(add(plane.origin, offset), sp.center)) > sp.radius {
                        return Some(Region::empty());
                    }
                }
            }
            _ => return None,
        }
    }
    Some(region)
}

/// Does some face of `other` cross the probe plane (through `probe`, normal
/// `n`), with vertices strictly on both sides of it? Then `other` has material
/// ON that plane -- a boundary face passing through it has material beside it --
/// so a parallel face's constant saying "nothing here" is false, whichever face
/// it came from. Two separate lumps stacked with a gap cross nothing at the gap,
/// so their caps still empty it. Vertices only: a curved face bulging past its
/// vertices is under-read, which keeps the constant -- the behaviour before.
fn crosses_probe_plane(other: &TSolid, probe: Vec3, n: Vec3) -> bool {
    other.faces().iter().any(|f| {
        let (mut below, mut above) = (false, false);
        for w in &f.borrow().boundary {
            for u in &w.borrow().edges {
                let eb = u.edge.borrow();
                for p in [eb.a.borrow().point, eb.b.borrow().point] {
                    let h = dot(sub(p, probe), n);
                    below |= h < -TOL;
                    above |= h > TOL;
                }
            }
        }
        below && above
    })
}

/// A region clamped to the face polygon `f`.
enum Clamped {
    Empty,
    Full,
    Disk([f64; 2], f64),
    /// A half disk strictly inside the face: (centre, radius, phi) as `Hole::Half`.
    Half([f64; 2], f64, f64),
    /// The region's disk with a subtractive hole (a torus band cut by a
    /// perpendicular plane): the kept face is face_with_hole(Hole::Circle).
    Annulus([f64; 2], f64, [f64; 2], f64),
    Poly(Vec<[f64; 2]>),
    /// A polygon clipped by a disk that neither contains it nor sits fully
    /// inside it (SPEC pinned math: a box wall cut by a sphere). Pieces plus
    /// the disk's own (center, radius) so the arcs can be rebuilt exactly.
    Mixed(Vec<LoopPiece>, [f64; 2], f64),
    /// The coplanar rescue's complement: the kept face is f minus the bite,
    /// as disjoint convex pieces (each emitted with the face's surviving
    /// inner wires attached).
    Complement(Vec<Vec<[f64; 2]>>),
    /// The coplanar rescue's bite polygon strictly inside the face: the
    /// kept face is face_with_hole(Hole::Poly).
    Bite(Vec<[f64; 2]>),
}

/// One boundary piece of a mixed polygon/disk loop, in a plane's own uv.
#[derive(Clone, Copy)]
enum LoopPiece {
    Line([f64; 2], [f64; 2]),
    Arc([f64; 2], [f64; 2]),
}

/// Reverse a mixed loop's winding: reverse piece order AND swap each
/// piece's own endpoints, matching how `Clamped::Poly`'s `rp.reverse()`
/// flips a straight polygon for the subtracted-tool case.
fn reverse_pieces(pieces: &[LoopPiece]) -> Vec<LoopPiece> {
    pieces
        .iter()
        .rev()
        .map(|p| match p {
            LoopPiece::Line(a, b) => LoopPiece::Line(*b, *a),
            LoopPiece::Arc(a, b) => LoopPiece::Arc(*b, *a),
        })
        .collect()
}

/// The intersection of convex polygon `poly` (CCW, in a plane's uv) and disk
/// `(c, r)`, as an ordered mix of kept polygon-edge runs and circle arcs
/// bridging them, in `poly`'s own winding. Called only for the genuinely
/// mixed case (some of the boundary is Interior to the other shape and some
/// is not) -- the caller already resolved full/empty/pure-disk beforehand.
/// `None` when no part of `poly` lies in the disk (nothing to rescue; the
/// caller refuses as it always did).
fn clip_convex_poly_by_disk(poly: &[[f64; 2]], c: [f64; 2], r: f64) -> Option<Vec<LoopPiece>> {
    let n = poly.len();
    let mut lines: Vec<([f64; 2], [f64; 2])> = Vec::new();
    for i in 0..n {
        let p = poly[i];
        let q = poly[(i + 1) % n];
        let d = [q[0] - p[0], q[1] - p[1]];
        let fx = p[0] - c[0];
        let fy = p[1] - c[1];
        let a = d[0] * d[0] + d[1] * d[1];
        let bq = 2.0 * (fx * d[0] + fy * d[1]);
        let cc = fx * fx + fy * fy - r * r;
        let mut ts: Vec<f64> = Vec::new();
        if a > 1e-15 {
            let disc = bq * bq - 4.0 * a * cc;
            if disc > 0.0 {
                let sq = disc.sqrt();
                for t in [(-bq - sq) / (2.0 * a), (-bq + sq) / (2.0 * a)] {
                    if t > 1e-9 && t < 1.0 - 1e-9 {
                        ts.push(t);
                    }
                }
                ts.sort_by(|x, y| x.partial_cmp(y).unwrap());
            }
        }
        let mut params = vec![0.0];
        params.extend(ts);
        params.push(1.0);
        for w in params.windows(2) {
            let (t0, t1) = (w[0], w[1]);
            if t1 - t0 < 1e-12 {
                continue;
            }
            let mid = [p[0] + d[0] * (t0 + t1) * 0.5, p[1] + d[1] * (t0 + t1) * 0.5];
            let mdx = mid[0] - c[0];
            let mdy = mid[1] - c[1];
            if mdx * mdx + mdy * mdy <= r * r {
                let a_pt = [p[0] + d[0] * t0, p[1] + d[1] * t0];
                let b_pt = [p[0] + d[0] * t1, p[1] + d[1] * t1];
                lines.push((a_pt, b_pt));
            }
        }
    }
    if lines.is_empty() {
        return None;
    }
    let m = lines.len();
    let mut pieces: Vec<LoopPiece> = Vec::with_capacity(m * 2);
    for i in 0..m {
        let (a_pt, b_pt) = lines[i];
        pieces.push(LoopPiece::Line(a_pt, b_pt));
        let (next_a, _) = lines[(i + 1) % m];
        if crate::math::len([b_pt[0] - next_a[0], b_pt[1] - next_a[1], 0.0]) > 1e-9 {
            pieces.push(LoopPiece::Arc(b_pt, next_a));
        }
    }
    Some(pieces)
}

/// Compute the angular intervals on circle 1 (radius r1, center at origin in its own frame)
/// that lie inside circle 2 (radius r2, center at offset d from circle 1's center).
/// Returns a list of (start, end) angles in [0, 2π), CCW from e1.
/// The frame is defined by e1 (x-axis) and e2 (y-axis) of the base cylinder.
fn circle_intersection_arcs(
    r1: f64,
    r2: f64,
    dist: f64,
    e1: Vec3,
    e2: Vec3,
    d: Vec3,
) -> Vec<(f64, f64)> {
    if dist >= r1 + r2 - 1e-9 {
        // Separate or tangent externally: no overlap
        return Vec::new();
    }
    if dist <= (r1 - r2).abs() + 1e-9 {
        // One circle contains the other
        if r1 <= r2 {
            // Circle 1 fully inside circle 2
            return vec![(0.0, TWO_PI)];
        } else {
            // Circle 2 fully inside circle 1: no part of circle 1's boundary is inside
            return Vec::new();
        }
    }
    // Partial overlap: two intersection points
    // Law of cosines: cos(θ) = (r1² + d² - r2²) / (2*r1*d)
    let cos_theta = (r1 * r1 + dist * dist - r2 * r2) / (2.0 * r1 * dist);
    let cos_theta = cos_theta.clamp(-1.0, 1.0);
    let theta = cos_theta.acos();
    // Direction from base center to tool center in base's (e1, e2) frame
    let dx = dot(d, e1);
    let dy = dot(d, e2);
    let phi = dy.atan2(dx); // angle of tool center from base's e1
    // Intersection points are at phi ± theta
    let start = phi - theta;
    let end = phi + theta;
    // Normalize to [0, 2π)
    let norm = |a: f64| {
        let mut a = a % TWO_PI;
        if a < 0.0 { a += TWO_PI; }
        a
    };
    let start = norm(start);
    let end = norm(end);
    if end > start {
        vec![(start, end)]
    } else {
        // Wraps around 2π
        vec![(start, TWO_PI), (0.0, end)]
    }
}

/// Intersect two lists of arc intervals (each as (start, end) with start < end, no wrap).
fn intersect_arc_intervals(a: &[(f64, f64)], b: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut result = Vec::new();
    for (a_start, a_end) in a {
        for (b_start, b_end) in b {
            let start = a_start.max(*b_start);
            let end = a_end.min(*b_end);
            if end - start > 1e-9 {
                result.push((start, end));
            }
        }
    }
    result
}

/// A partial cylindrical wall with an arc range (u-clipping for cylinder-cylinder boolean).
/// An arc-bounded partial cylindrical wall, spanning angles
/// [arc.start, arc.start + arc.span] at radius `cy.radius`, v in [vlo, vhi].
/// Four edges like `extrude_profile`'s corner wall (build.rs:1567): two
/// vertical seams at the arc's ends, and two true arc rims (Curve::Arc) that
/// the adjoining caps share — so the wire closes at four distinct corners and
/// the surface integral covers only the arc's own angular range. A reversed
/// wall (the tool side of a subtract) is produced by [`flip_face`], which
/// already knows how to negate e2 and reflect the arc range while KEEPING
/// the boundary wires — this builder stays un-reflected so its pcurves,
/// rims and surface domain all live in the same (unreflected) u frame.
fn partial_wall_arc(cy: &Cylinder, vlo: f64, vhi: f64, arc: crate::geom::ArcRange) -> TFace {
    let axis = normalize(cy.axis);
    let a0 = arc.start;
    let span = arc.span;
    let p_lo = add(cy.origin, scale(axis, vlo));
    let p_hi = add(cy.origin, scale(axis, vhi));
    let at_angle = |p: Vec3, ang: f64| -> Vec3 {
        add(p, add(scale(cy.e1, cy.radius * ang.cos()), scale(cy.e2, cy.radius * ang.sin())))
    };
    // The two seam vertices per rim: arc start (s) and arc end (t).
    let v_lo_s = topo::vertex(at_angle(p_lo, a0));
    let v_lo_t = topo::vertex(at_angle(p_lo, a0 + arc.span));
    let v_hi_s = topo::vertex(at_angle(p_hi, a0));
    let v_hi_t = topo::vertex(at_angle(p_hi, a0 + arc.span));
    let seam_s = topo::edge(
        v_lo_s.clone(),
        v_hi_s.clone(),
        true,
        Curve::Segment { a: v_lo_s.borrow().point, b: v_hi_s.borrow().point },
    );
    let seam_t = topo::edge(
        v_lo_t.clone(),
        v_hi_t.clone(),
        true,
        Curve::Segment { a: v_lo_t.borrow().point, b: v_hi_t.borrow().point },
    );
    // Rim arcs as real Curve::Arc: x_axis rotated to the edge's own start
    // angle (Curve::Arc always begins at angle 0 from x_axis), sweep = ±span.
    // The top rim is traversed a0 -> a0+span (x_axis at a0, sweep +span);
    // the bottom rim closes the wire the other way, a0+span -> a0
    // (x_axis at a0+span, sweep -span), so the wire walks a closed loop.
    let rim_hi_f = topo::edge(
        v_hi_s.clone(),
        v_hi_t.clone(),
        true,
        Curve::Arc {
            center: p_hi,
            radius: cy.radius,
            normal: axis,
            x_axis: add(scale(cy.e1, a0.cos()), scale(cy.e2, a0.sin())),
            sweep: arc.span,
        },
    );
    let rim_lo_b = topo::edge(
        v_lo_t.clone(),
        v_lo_s.clone(),
        true,
        Curve::Arc {
            center: p_lo,
            radius: cy.radius,
            normal: axis,
            x_axis: add(scale(cy.e1, (a0 + arc.span).cos()), scale(cy.e2, (a0 + arc.span).sin())),
            sweep: -arc.span,
        },
    );
    let vm = 0.5 * (vlo + vhi);
    let uses = vec![
        topo::EdgeUse { edge: seam_s.clone(), forward: true, pcurve: topo::Pcurve { start: [a0, vlo], end: [a0, vhi], mid: [a0, vm] } },
        topo::EdgeUse { edge: rim_hi_f.clone(), forward: true, pcurve: topo::Pcurve { start: [a0, vhi], end: [a0 + arc.span, vhi], mid: [a0 + arc.span * 0.5, vhi] } },
        topo::EdgeUse { edge: seam_t.clone(), forward: true, pcurve: topo::Pcurve { start: [a0 + arc.span, vhi], end: [a0 + arc.span, vlo], mid: [a0 + arc.span, vm] } },
        topo::EdgeUse { edge: rim_lo_b.clone(), forward: true, pcurve: topo::Pcurve { start: [a0 + arc.span, vlo], end: [a0, vlo], mid: [a0 + arc.span * 0.5, vlo] } },
    ];
    let surf = Surface::Cylinder(Cylinder {
        origin: cy.origin,
        axis: cy.axis,
        e1: cy.e1,
        e2: cy.e2,
        radius: cy.radius,
        vmin: vlo,
        vmax: vhi,
        arc: Some(arc), cross: None,
    });
    Rc::new(RefCell::new(Face {
        boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
        forward: true,
        surface: surf,
        uv_domain: [[a0, a0 + span], [vlo, vhi]],
    }))
}

/// Signed sweep (CCW positive, matching `normal = cross`-derived y_axis) from
/// `a_uv` to `b_uv` around `c`, both on the same circle. Independent of which
/// 3D frame later carries it -- (u, v, n) is right-handed (§ [`Plane::new`]),
/// so a uv-plane rotation and the matching 3D rotation around `n` agree.
fn uv_arc_sweep(c: [f64; 2], a_uv: [f64; 2], b_uv: [f64; 2]) -> f64 {
    let ax = a_uv[0] - c[0];
    let ay = a_uv[1] - c[1];
    let bx = b_uv[0] - c[0];
    let by = b_uv[1] - c[1];
    let cross_z = ax * by - ay * bx;
    let dot_v = ax * bx + ay * by;
    cross_z.atan2(dot_v)
}

/// A planar face built from a mixed loop of straight and circular pieces
/// (SPEC pinned math: a box wall cut by a sphere -- 2 segments, 2 arcs, no
/// sampling).
fn build_mixed_face(plane: &Plane, pieces: &[LoopPiece], c: [f64; 2], r: f64) -> TFace {
    // `uv_arc_sweep` is CCW-positive assuming (u, v, normal) is right-handed.
    // That only matches `plane.n` when u x v == +n; a reversed wall
    // (subtract's kept tool face) keeps the SAME u, v but flips n, making
    // the triple left-handed, which flips the sweep's sign. Correct for it
    // here rather than at the call site, so every caller of `uv_arc_sweep`
    // can keep assuming its own plane's own normal.
    let orient = if dot(cross(plane.u, plane.v), plane.n) >= 0.0 { 1.0 } else { -1.0 };
    let mut uses = Vec::with_capacity(pieces.len());
    for piece in pieces {
        match piece {
            LoopPiece::Line(a_uv, b_uv) => {
                let a = plane.point(*a_uv);
                let b = plane.point(*b_uv);
                let e = mk_segment_edge(a, b);
                uses.push(planar_use(plane, &e, true, a, b));
            }
            LoopPiece::Arc(a_uv, b_uv) => {
                let a = plane.point(*a_uv);
                let b = plane.point(*b_uv);
                let center3 = plane.point(c);
                let x_axis = normalize(sub(a, center3));
                let sweep = orient * uv_arc_sweep(c, *a_uv, *b_uv);
                let curve = Curve::Arc { center: center3, radius: r, normal: plane.n, x_axis, sweep };
                let e = topo::edge(topo::vertex(a), topo::vertex(b), true, curve);
                uses.push(topo::EdgeUse {
                    edge: e,
                    forward: true,
                    pcurve: topo::Pcurve {
                        start: *a_uv,
                        end: *b_uv,
                        mid: [(a_uv[0] + b_uv[0]) * 0.5, (a_uv[1] + b_uv[1]) * 0.5],
                    },
                });
            }
        }
    }
    make_face(Surface::Plane(plane.clone()), [[0.0, 1.0], [0.0, 1.0]], uses)
}

/// The 4-arc boundary of the polar cap removed from `sp` by a centered
/// square tube of half-width `h` along (`sp.e1`, `sp.e2`), on the
/// `pole_sign` side of `sp.axis`. Real trims (SPEC constraint 1): each arc
/// is the actual sphere/wall intersection curve, not a sampled one -- it is
/// the SAME circle a box wall's own boundary arc lies on (§ pinned math).
fn polar_hole_wire(sp: &crate::geom::SphereSurf, pole_sign: f64, h: f64) -> topo::WireRef<Curve3> {
    let r = sp.radius;
    let zc = (r * r - 2.0 * h * h).max(0.0).sqrt();
    let corner = |sp1: f64, sq: f64| {
        add(sp.center, add(add(scale(sp.e1, sp1 * h), scale(sp.e2, sq * h)), scale(sp.axis, pole_sign * zc)))
    };
    let corners = [corner(1.0, 1.0), corner(1.0, -1.0), corner(-1.0, -1.0), corner(-1.0, 1.0)];
    let walls: [(Vec3, f64); 4] = [(sp.e1, h), (sp.e2, -h), (sp.e1, -h), (sp.e2, h)];
    let mut uses = Vec::with_capacity(4);
    for i in 0..4 {
        let (dir, fixed) = walls[i];
        let start = corners[i];
        let end = corners[(i + 1) % 4];
        let arc_center = add(sp.center, scale(dir, fixed));
        let arc_r = (r * r - fixed * fixed).max(0.0).sqrt();
        let x_axis = normalize(sub(start, arc_center));
        let y_axis = normalize(cross(dir, x_axis));
        let to_end = sub(end, arc_center);
        let ex = dot(to_end, x_axis);
        let ey = dot(to_end, y_axis);
        let sweep = ey.atan2(ex);
        let curve = Curve::Arc { center: arc_center, radius: arc_r, normal: dir, x_axis, sweep };
        let e = topo::edge(topo::vertex(start), topo::vertex(end), true, curve);
        uses.push(topo::EdgeUse {
            edge: e,
            forward: true,
            pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] },
        });
    }
    Rc::new(RefCell::new(Wire { edges: uses }))
}

fn clamp(region: &Region, f: &[[f64; 2]]) -> Option<Clamped> {
    if region.empty {
        return Some(Clamped::Empty);
    }
    if let Some((c, r)) = region.disk {
        for h in &region.hs {
            if h[0] * c[0] + h[1] * c[1] + h[2] > 1e-6 {
                return None;
            }
        }
        // A half-plane whose line runs through the disk's centre makes the
        // region a HALF disk. Exactly one distinct such line is built; every
        // other half-plane must leave the whole disk alone.
        let mut half_phi: Option<f64> = None;
        for h in &region.hs {
            let den = (h[0] * h[0] + h[1] * h[1]).sqrt();
            if den < 1e-7 {
                continue;
            }
            let at_c = (h[0] * c[0] + h[1] * c[1] + h[2]) / den;
            if at_c + r <= 1e-7 {
                continue; // the whole disk satisfies it
            }
            if at_c.abs() > 1e-7 {
                return None; // an off-centre chord: a segment, not built
            }
            let phi = h[1].atan2(h[0]);
            match half_phi {
                None => half_phi = Some(phi),
                Some(q) => {
                    let d = (phi - q).rem_euclid(TWO_PI);
                    if d > 1e-7 && TWO_PI - d > 1e-7 {
                        return None; // a wedge or a slab, not a half disk
                    }
                }
            }
        }
        if let Some(phi) = half_phi {
            if !point_in_poly(f, c) {
                return None;
            }
            for k in 0..32 {
                let a = TWO_PI * k as f64 / 32.0;
                let p = [c[0] + r * a.cos(), c[1] + r * a.sin()];
                if !point_in_poly(f, p) {
                    return None;
                }
            }
            return Some(Clamped::Half(c, r, phi));
        }
        let a_f = poly_area(f);
        let disk_area = std::f64::consts::PI * r * r;
        if !point_in_poly(f, c) {
            // Maybe the face lies entirely inside the disk.
            if f.iter().all(|p| {
                let d = [(p[0] - c[0]) as f64, (p[1] - c[1]) as f64];
                d[0] * d[0] + d[1] * d[1] <= r * r + 1e-7
            }) && disk_area >= a_f
            {
                return Some(Clamped::Full);
            }
            // The disk may still touch the face at a single tangent point, or
            // at a vanishing sliver. Approximate the overlap area; anything
            // below the face tolerance is a tangency, not a real region.
            let mut inside = 0usize;
            const N: usize = 24;
            let mut pts = Vec::with_capacity(N * N);
            for gi in 0..N {
                for gj in 0..N {
                    let x = f[0][0] + (f[1][0] - f[0][0]) * (gi as f64 + 0.5) / N as f64
                        + (f[2][0] - f[0][0]) * (gj as f64 + 0.5) / N as f64;
                    let y = f[0][1] + (f[1][1] - f[0][1]) * (gi as f64 + 0.5) / N as f64
                        + (f[2][1] - f[0][1]) * (gj as f64 + 0.5) / N as f64;
                    pts.push([x, y]);
                }
            }
            for p in pts {
                let d = [(p[0] - c[0]) as f64, (p[1] - c[1]) as f64];
                if d[0] * d[0] + d[1] * d[1] <= r * r + 1e-7 && point_in_poly(f, p) {
                    inside += 1;
                }
            }
            let approx_overlap = a_f * inside as f64 / (N * N) as f64;
            if approx_overlap <= 1e-6 * a_f.max(1.0) {
                return Some(Clamped::Empty);
            }
            return None;
        }
        for k in 0..32 {
            let a = TWO_PI * k as f64 / 32.0;
            let p = [c[0] + r * a.cos(), c[1] + r * a.sin()];
            if !point_in_poly(f, p) {
                return None;
            }
        }
        return Some(Clamped::Disk(c, r));
    }
    if let Some((hc, hr)) = region.hole {
        // A hole region (a torus band's annulus): the face must contain the
        // OUTER disk entirely (same 32-probe check the plain disk uses) and
        // the hole circle must sit strictly inside the face too. The kept
        // face is the face minus the hole circle.
        if let Some((c, r)) = region.disk {
            if !point_in_poly(f, c) {
                return None;
            }
            for k in 0..32 {
                let a = TWO_PI * k as f64 / 32.0;
                let p = [c[0] + r * a.cos(), c[1] + r * a.sin()];
                if !point_in_poly(f, p) {
                    return None;
                }
            }
            if !point_in_poly(f, hc) {
                return None;
            }
            for k in 0..32 {
                let a = TWO_PI * k as f64 / 32.0;
                let p = [hc[0] + hr * a.cos(), hc[1] + hr * a.sin()];
                if !point_in_poly(f, p) {
                    return None;
                }
            }
            return Some(Clamped::Annulus(c, r, hc, hr));
        }
        return None;
    }
    if region.hs.is_empty() {
        return Some(Clamped::Full);
    }
    let a_f = poly_area(f);
    let mut poly = f.to_vec();
    for h in &region.hs {
        poly = clip_halfplane(&poly, h[0], h[1], h[2]);
        if poly.len() < 3 || poly_area(&poly) < 1e-12 {
            return Some(Clamped::Empty);
        }
    }
    let a_p = poly_area(&poly);
    if a_p < 1e-12 {
        return Some(Clamped::Empty);
    }
    if (a_p - a_f).abs() <= 1e-6 * a_f.max(1.0) {
        return Some(Clamped::Full);
    }
    Some(Clamped::Poly(poly))
}

// ---------------------------------------------------------------------------
// Building output faces.
// ---------------------------------------------------------------------------

fn mk_segment_edge(a: Vec3, b: Vec3) -> topo::EdgeRef<Curve3> {
    topo::edge(topo::vertex(a), topo::vertex(b), true, Curve::Segment { a, b })
}

fn planar_use(plane: &Plane, e: &topo::EdgeRef<Curve3>, forward: bool, sa: Vec3, sb: Vec3) -> topo::EdgeUse<Curve3> {
    topo::EdgeUse {
        edge: e.clone(),
        forward,
        pcurve: topo::Pcurve {
            start: plane.project(sa),
            end: plane.project(sb),
            mid: plane.project(scale(add(sa, sb), 0.5)),
        },
    }
}

fn make_face(surface: Surface, uv_domain: [[f64; 2]; 2], uses: Vec<topo::EdgeUse<Curve3>>) -> TFace {
    let w = Rc::new(RefCell::new(Wire { edges: uses }));
    Rc::new(RefCell::new(Face {
        boundary: vec![w],
        forward: true,
        surface,
        uv_domain,
    }))
}

/// A planar face from an ordered loop of (u, v) points.
fn build_poly_face(plane: &Plane, uv: &[[f64; 2]]) -> TFace {
    let mut uses = Vec::with_capacity(uv.len());
    for i in 0..uv.len() {
        let a = plane.point(uv[i]);
        let b = plane.point(uv[(i + 1) % uv.len()]);
        let e = mk_segment_edge(a, b);
        uses.push(planar_use(plane, &e, true, a, b));
    }
    make_face(Surface::Plane(plane.clone()), [[0.0, 1.0], [0.0, 1.0]], uses)
}

/// Build the wire for a circular hole in `plane`. `forward` is chosen so the
/// hole winds opposite to the face's outer loop.
fn hole_wire(plane: &Plane, center_uv: [f64; 2], radius: f64, outer_ccw: bool) -> topo::WireRef<Curve3> {
    let center = plane.point(center_uv);
    let v = add(center, scale(plane.u, radius));
    let e = topo::edge(
        topo::vertex(v),
        topo::vertex(v),
        true,
        Curve::Circle { center, radius, normal: plane.n },
    );
    // A circle runs CCW about `plane.n`. In (u, v) that is CCW only when the
    // frame is right-handed (u x v = n); a face whose normal was REVERSED
    // (an inner shell wall) keeps its old u, v, so u x v = -n and the same
    // circle runs CW in uv. planar_measure sums signed uv loops, so the hole
    // must oppose the outer IN UV, or its area is ADDED (shell + hole through
    // both walls measured 10849.31 against the exact 11150.90).
    let right_handed = dot(cross(plane.u, plane.v), plane.n) > 0.0;
    let forward = if right_handed { !outer_ccw } else { outer_ccw };
    Rc::new(RefCell::new(Wire {
        edges: vec![topo::EdgeUse {
            edge: e,
            forward,
            pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] },
        }],
    }))
}

/// Is `hole` wholly inside one of the face's existing inner wires?
///
/// `geom::planar_measure` sums each wire loop's SIGNED area (Green's theorem,
/// `geom.rs:336`), so a hole nested inside another hole is subtracted twice:
/// a d12 wire contributes -36*pi and a concentric d6 wire inside it another -9*pi,
/// where the void is only -36*pi. That double count is the coaxial-bore 60*pi of
/// SPEC-brep-feature-provenance §4.3b -- the d6 tool lies wholly inside the d12 hole
/// already present, removes nothing (`a - b = a` when `b` is inside the void), and
/// must not be added as a second wire.
///
/// Circle-vs-circle is decided analytically, so a duplicate (concentric and equal,
/// the second of two identical coaxial bores) counts as inside and is skipped too.
/// A hole that merely CROSSES an existing wire is neither inside nor containing,
/// so it takes the old path -- the case that still needs arc handling.
fn hole_wholly_inside_inner(boundary: &[topo::WireRef<Curve3>], plane: &Plane, hole: &Hole) -> bool {
    // boundary[0] is the outer loop; only inner wires bound void.
    for w in boundary.iter().skip(1) {
        let wb = w.borrow();
        if wb.edges.len() == 1 {
            if let Curve::Circle { center, radius, .. } = &wb.edges[0].edge.borrow().curve {
                let ci = plane.project(*center);
                let Hole::Circle(c, r) = hole else { continue };
                let d = [c[0] - ci[0], c[1] - ci[1]];
                let dist = (d[0] * d[0] + d[1] * d[1]).sqrt();
                if dist + r <= *radius + 1e-9 * r.max(*radius).max(1.0) {
                    return true;
                }
                continue;
            }
        }
        let poly = wire_uv_points(w, plane);
        if poly.len() < 3 {
            continue;
        }
        let inside = match hole {
            Hole::Circle(c, r) => {
                (0..8).all(|k| {
                    let t = k as f64 * std::f64::consts::FRAC_PI_4;
                    point_in_poly_strict(&poly, [c[0] + r * t.cos(), c[1] + r * t.sin()])
                })
            }
            Hole::Poly(uv) => {
                uv.len() >= 3 && uv.iter().all(|p| point_in_poly_strict(&poly, *p))
            }
            Hole::Half(..) => false,
        };
        if inside {
            return true;
        }
    }
    false
}

/// Indices of inner wires that a new hole wholly contains, or `None` when any
/// wire straddles the new hole's boundary.
///
/// A contained wire becomes interior to the new hole, and `planar_measure`
/// (`geom.rs:336`) sums every wire's signed area without collapsing nesting, so
/// keeping it double-counts the void. That is the coaxial d6-inside-d12 case.
///
/// But a wire that CROSSES the new hole's boundary means the region is not
/// fully consumed: the straddler's outer sliver still has to bound something, and
/// removing its neighbours shifts the cap's area by exactly their areas. That is
/// `y2_bench_final_exact`: an r=20 bite over a cap carrying four r=2.5 wires at
/// v = -50, -38, -26, -14 swallows the two wholly-inside ones and moves the volume
/// by `2*pi*2.5^2 = 39.269971931595` -- bit-for-bit that fixture's regression. So
/// bailing out entirely is the safe answer whenever anything straddles.
fn wires_consumed_by_hole(
    boundary: &[topo::WireRef<Curve3>],
    plane: &Plane,
    hole: &Hole,
) -> Option<Vec<usize>> {
    let Hole::Circle(c, r) = hole else { return Some(Vec::new()) };
    let mut inside: Vec<usize> = Vec::new();
    for (i, w) in boundary.iter().enumerate().skip(1) {
        let wb = w.borrow();
        if wb.edges.len() != 1 {
            continue;
        }
        let Curve::Circle { center, radius, .. } = &wb.edges[0].edge.borrow().curve else {
            continue;
        };
        let ci = plane.project(*center);
        let d = [c[0] - ci[0], c[1] - ci[1]];
        let dist = (d[0] * d[0] + d[1] * d[1]).sqrt();
        let eps = 1e-9 * r.max(*radius).max(1.0);
        if dist + *radius <= r + eps {
            inside.push(i);
        } else if dist < r + *radius - eps {
            // Crosses the new hole's boundary: the region is not fully consumed.
            return None;
        }
    }
    Some(inside)
}

/// A face that keeps `face`'s outer wire and adds one hole (a disk or a
/// polygon) in the same plane.
fn face_with_hole(face: &TFace, plane: &Plane, hole: &Hole) -> TFace {
    // A hole already inside existing void must not be added: planar_measure
    // would count the same void twice. See hole_wholly_inside_inner.
    if hole_wholly_inside_inner(&face.borrow().boundary, plane, hole) {
        return face.clone();
    }
    // Wires this hole wholly contains become interior to it; drop them so the
    // same void is not counted twice. Empty whenever anything straddles.
    let swallow = wires_consumed_by_hole(&face.borrow().boundary, plane, hole).unwrap_or_default();
    let outer_ccw = {
        let fb = face.borrow();
        let mut ring = Vec::new();
        if let Some(w) = fb.boundary.first() {
            for u in &w.borrow().edges {
                let eb = u.edge.borrow();
                let p = if u.forward { eb.a.borrow().point } else { eb.b.borrow().point };
                ring.push(plane.project(p));
            }
        }
        let area = signed_area2(&ring);
        if ring.len() == 1 {
            // A single full-circle outer wire: its vertex ring collapses to
            // ONE point (start == end) and the shoelace sum is 0, which would
            // read as "not CCW" and wind the hole the SAME way as the outer —
            // an annulus whose hole ADDS its area (measured: the open-top
            // hollow's outer cap came out pi*(R^2+r^2) instead of the
            // annulus). A circle traversed forward is CCW about its own
            // normal; in the plane's right-handed (u, v, n) that is CCW in
            // uv exactly when the circle's normal agrees with plane.n.
            let w = fb.boundary.first().expect("checked above");
            let u0 = &w.borrow().edges[0];
            let eb = u0.edge.borrow();
            match &eb.curve {
                Curve::Circle { normal, .. } => {
                    let right_handed = dot(cross(plane.u, plane.v), plane.n) > 0.0;
                    let fwd = (dot(*normal, plane.n) > 0.0) == right_handed;
                    if u0.forward { fwd } else { !fwd }
                }
                _ => area > 0.0,
            }
        } else {
            area > 0.0
        }
    };
    let mut wires: Vec<topo::WireRef<Curve3>> = Vec::new();
    {
        let fb = face.borrow();
        for (i, w) in fb.boundary.iter().enumerate() {
            if swallow.contains(&i) {
                continue;
            }
            wires.push(w.clone());
        }
    }
    match hole {
        Hole::Circle(c, r) => wires.push(hole_wire(plane, *c, *r, outer_ccw)),
        Hole::Poly(uv) => {
            let mut pts = uv.clone();
            // Hole must wind opposite the outer loop.
            let want_positive = !outer_ccw;
            if (signed_area2(&pts) > 0.0) != want_positive {
                pts.reverse();
            }
            let mut uses = Vec::new();
            for i in 0..pts.len() {
                let a = plane.point(pts[i]);
                let b = plane.point(pts[(i + 1) % pts.len()]);
                let e = mk_segment_edge(a, b);
                uses.push(planar_use(plane, &e, true, a, b));
            }
            wires.push(Rc::new(RefCell::new(Wire { edges: uses })));
        }
        Hole::Half(c, r, phi) => {
            // The outer loop's winding is read in uv, as for every other hole;
            // a half disk wound CCW is its arc (S -> E, a pi sweep) then the
            // chord back, and CW is the chord then the arc the other way.
            let orient = if dot(cross(plane.u, plane.v), plane.n) >= 0.0 { 1.0 } else { -1.0 };
            let ang = |t: f64| [c[0] + r * t.cos(), c[1] + r * t.sin()];
            let s_uv = ang(phi + std::f64::consts::FRAC_PI_2);
            let e_uv = ang(phi + 3.0 * std::f64::consts::FRAC_PI_2);
            let (s, e, center3) = (plane.point(s_uv), plane.point(e_uv), plane.point(*c));
            let ccw_hole = !outer_ccw;
            let (arc_from, arc_to, arc_from_uv, arc_to_uv, sweep) = if ccw_hole {
                (s, e, s_uv, e_uv, orient * std::f64::consts::PI)
            } else {
                (e, s, e_uv, s_uv, -orient * std::f64::consts::PI)
            };
            let arc_curve = Curve::Arc {
                center: center3,
                radius: *r,
                normal: plane.n,
                x_axis: normalize(sub(arc_from, center3)),
                sweep,
            };
            let arc_edge = topo::edge(topo::vertex(arc_from), topo::vertex(arc_to), true, arc_curve);
            let arc_use = topo::EdgeUse {
                edge: arc_edge,
                forward: true,
                pcurve: topo::Pcurve {
                    start: arc_from_uv,
                    end: arc_to_uv,
                    mid: [0.0, 0.0],
                },
            };
            // The chord is split at the centre: the revolved tool's two
            // diametral faces meet on the axis, so a whole chord would leave a
            // T-junction against their two edges.
            let (line_from, line_to) = (arc_to, arc_from);
            let mid = center3;
            let line_a = mk_segment_edge(line_from, mid);
            let line_b = mk_segment_edge(mid, line_to);
            let use_a = planar_use(plane, &line_a, true, line_from, mid);
            let use_b = planar_use(plane, &line_b, true, mid, line_to);
            let uses = if ccw_hole { vec![arc_use, use_a, use_b] } else { vec![use_a, use_b, arc_use] };
            wires.push(Rc::new(RefCell::new(Wire { edges: uses })));
        }
    }
    Rc::new(RefCell::new(Face {
        boundary: wires,
        forward: true,
        surface: Surface::Plane(plane.clone()),
        uv_domain: [[0.0, 1.0], [0.0, 1.0]],
    }))
}

enum Hole {
    Circle([f64; 2], f64),
    Poly(Vec<[f64; 2]>),
    /// A half disk: the disk (centre, radius) on the side OPPOSITE the uv
    /// direction at angle `phi`, cut by a chord through its centre. Built only
    /// from a revolved half-cylinder tool crossing a face (a 180-degree groove).
    Half([f64; 2], f64, f64),
}

/// A partial cylindrical wall, `v` running from `vlo` to `vhi` on `cy`.
/// `reverse` flips the surface orientation (used for the wall of a subtracted
/// tool, whose outward normal must point into the void).
fn partial_wall(cy: &Cylinder, vlo: f64, vhi: f64, reverse: bool) -> TFace {
    let e2 = if reverse { scale(cy.e2, -1.0) } else { cy.e2 };
    let surf = Surface::Cylinder(Cylinder {
        origin: cy.origin,
        axis: cy.axis,
        e1: cy.e1,
        e2,
        radius: cy.radius,
        vmin: vlo,
        vmax: vhi,
        arc: None, cross: None,
    });
    let p_lo = add(cy.origin, scale(cy.axis, vlo));
    let p_hi = add(cy.origin, scale(cy.axis, vhi));
    let v_lo = topo::vertex(add(p_lo, scale(cy.e1, cy.radius)));
    let v_hi = topo::vertex(add(p_hi, scale(cy.e1, cy.radius)));
    let seam = topo::edge(
        v_lo.clone(),
        v_hi.clone(),
        true,
        Curve::Segment { a: v_lo.borrow().point, b: v_hi.borrow().point },
    );
    let rim_lo = topo::edge(
        v_lo.clone(),
        v_lo.clone(),
        true,
        Curve::Circle { center: p_lo, radius: cy.radius, normal: cy.axis },
    );
    let rim_hi = topo::edge(
        v_hi.clone(),
        v_hi.clone(),
        true,
        Curve::Circle { center: p_hi, radius: cy.radius, normal: cy.axis },
    );
    let vm = 0.5 * (vlo + vhi);
    let uses = vec![
        topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vlo], end: [0.0, vhi], mid: [0.0, vm] } },
        topo::EdgeUse { edge: rim_hi.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vhi], end: [TWO_PI, vhi], mid: [std::f64::consts::PI, vhi] } },
        topo::EdgeUse { edge: seam.clone(), forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vhi], end: [TWO_PI, vlo], mid: [TWO_PI, vm] } },
        topo::EdgeUse { edge: rim_lo.clone(), forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vlo], end: [0.0, vlo], mid: [std::f64::consts::PI, vlo] } },
    ];
    Rc::new(RefCell::new(Face {
        boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
        forward: true,
        surface: surf,
        uv_domain: [[0.0, TWO_PI], [vlo, vhi]],
    }))
}

/// The farthest a planar face's outer boundary gets from the line through
/// `origin` along `axis`. A whole circle counts as its centre's distance plus
/// its radius; an arc too (conservative). `None` when it cannot be read.
fn plane_face_radial_reach(face: &Face<Curve3, Surface3>, origin: Vec3, axis: Vec3) -> Option<f64> {
    let w = face.boundary.first()?;
    let radial = |p: Vec3| {
        let d = sub(p, origin);
        crate::math::len(sub(d, scale(axis, dot(d, axis))))
    };
    let mut far = 0.0f64;
    for u in &w.borrow().edges {
        let e = u.edge.borrow();
        match &e.curve {
            Curve::Circle { center, radius, .. } | Curve::Arc { center, radius, .. } => {
                far = far.max(radial(*center) + radius);
            }
            Curve::Segment { .. } => {
                far = far.max(radial(e.a.borrow().point)).max(radial(e.b.borrow().point));
            }
            // Conservative: the curve stays within both radii of its centre.
            Curve::CylCyl { center, big_r, r, .. } => {
                far = far.max(radial(*center) + big_r + r);
            }
        }
    }
    Some(far)
}

/// How a whole-turn cylinder meets a cone face.
enum ConeCyl {
    /// Same axis: the meeting curve is a circle at slant parameter `v_cross`
    /// (None when the radii never match within the shared axial band).
    Coaxial { v_cross: Option<f64> },
    /// Parallel off-axis cylinder that stays strictly inside or strictly
    /// outside the cone over the shared band: they never meet.
    Clear,
    /// Anything else (tilted axes, an off-axis wall that reaches the cone, an
    /// arc wall): the meeting curve is not a circle, so the caller refuses.
    Crosses,
}

fn cone_cyl_relation(c: &Cone, cy: &Cylinder) -> ConeCyl {
    if cy.arc.is_some() {
        return ConeCyl::Crosses;
    }
    let ax = normalize(c.axis);
    let a2 = normalize(cy.axis);
    let par = dot(ax, a2);
    if (par.abs() - 1.0).abs() > 1e-9 {
        return ConeCyl::Crosses;
    }
    let (sin, cos, tan) = (c.half_angle.sin(), c.half_angle.cos(), c.half_angle.tan());
    let d = sub(cy.origin, c.base);
    let p0 = dot(d, ax);
    let off = crate::math::len(sub(d, scale(ax, p0)));
    let (q1, q2) = (p0 + par * cy.vmin, p0 + par * cy.vmax);
    let lo = q1.min(q2).max(c.v_range[0] * cos);
    let hi = q1.max(q2).min(c.v_range[1] * cos);
    if hi - lo <= 1e-9 {
        return ConeCyl::Clear;
    }
    let r2 = cy.radius;
    let r_at = |along: f64| c.base_radius - along * tan;
    if off < 1e-9 {
        if sin <= 1e-12 {
            return ConeCyl::Crosses;
        }
        let v = (c.base_radius - r2) / sin;
        let along = v * cos;
        let v_cross = if along >= lo - 1e-9 && along <= hi + 1e-9 { Some(v) } else { None };
        return ConeCyl::Coaxial { v_cross };
    }
    if off + r2 < r_at(hi) - 1e-7 || off - r2 > r_at(lo) + 1e-7 {
        return ConeCyl::Clear;
    }
    ConeCyl::Crosses
}

fn partial_cone_wall(c: &Cone, vlo: f64, vhi: f64, reverse: bool, boundary: &[topo::WireRef<Curve3>]) -> TFace {
 let e2 = if reverse { scale(c.e2, -1.0) } else { c.e2 };
 let mut cone = c.clone();
 cone.e2 = e2;
 cone.v_range = [vlo, vhi];
 let at = |v: f64| {
 let radius = c.base_radius - v * c.half_angle.sin();
 let center = add(c.base, scale(c.axis, v * c.half_angle.cos()));
 (center, radius)
 };
 let (center_lo, radius_lo) = at(vlo);
 let (center_hi, radius_hi) = at(vhi);
 if (vlo - c.v_range[0]).abs() < 1e-9 && (vhi - c.v_range[1]).abs() < 1e-9 {
 return Rc::new(RefCell::new(Face {
 boundary: boundary.to_vec(),
 forward: true,
 surface: Surface::Cone(cone),
 uv_domain: [[0.0, TWO_PI], [vlo, vhi]],
 }));
 }
 let v_lo = topo::vertex(add(center_lo, scale(c.e1, radius_lo)));
 let v_hi = topo::vertex(add(center_hi, scale(c.e1, radius_hi)));
 let seam = topo::edge(
 v_lo.clone(),
 v_hi.clone(),
 true,
 Curve::Segment { a: v_lo.borrow().point, b: v_hi.borrow().point },
 );
 let rim_lo = topo::edge(
 v_lo.clone(),
 v_lo.clone(),
 true,
 Curve::Circle { center: center_lo, radius: radius_lo, normal: c.axis },
 );
 let rim_hi = topo::edge(
 v_hi.clone(),
 v_hi.clone(),
 true,
 Curve::Circle { center: center_hi, radius: radius_hi, normal: c.axis },
 );
 let vm = 0.5 * (vlo + vhi);
 make_face(
 Surface::Cone(cone),
 [[0.0, TWO_PI], [vlo, vhi]],
 vec![
 topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vlo], end: [0.0, vhi], mid: [0.0, vm] } },
 topo::EdgeUse { edge: rim_hi, forward: true, pcurve: topo::Pcurve { start: [0.0, vhi], end: [TWO_PI, vhi], mid: [std::f64::consts::PI, vhi] } },
 topo::EdgeUse { edge: seam, forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vhi], end: [TWO_PI, vlo], mid: [TWO_PI, vm] } },
 topo::EdgeUse { edge: rim_lo, forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vlo], end: [0.0, vlo], mid: [std::f64::consts::PI, vlo] } },
 ],
 )
}

// ---------------------------------------------------------------------------
// The operation.
// ---------------------------------------------------------------------------

/// Append one edge use's start point to a uv ring, plus, for a circular arc,
/// enough interior samples that the ring follows the arc instead of cutting it
/// with a chord. A chord ring drops the arc's bulge, so a containment test
/// against it (and a region clamped to it) is wrong by the circular segment.
/// Segments and whole circles add just the start point, as before.
fn push_edge_use_uv(u: &topo::EdgeUse<Curve3>, plane: &Plane, pts: &mut Vec<[f64; 2]>) {
    let eb = u.edge.borrow();
    let p = if u.forward { eb.a.borrow().point } else { eb.b.borrow().point };
    pts.push(plane.project(p));
    if let Curve::Arc { sweep, .. } = &eb.curve {
        // ~11 degrees per chord: the sagitta is under 0.5% of the radius.
        let n = (sweep.abs() / (std::f64::consts::PI / 16.0)).ceil().max(2.0) as usize;
        for k in 1..n {
            let t = k as f64 / n as f64;
            let t = if u.forward { t } else { 1.0 - t };
            pts.push(plane.project(eb.curve.point_at(t)));
        }
    }
}

/// The outer boundary ring of a planar face in `plane`'s uv. A face that
/// already carries holes (a later boolean's input) has more than one wire; the
/// outer wire is first by construction (`face_with_hole` appends holes). Only
/// that ring bounds the face's material, so the holes are ignored here and
/// re-carried by `face_with_hole` when a new cut is added.
fn outer_uv(fb: &Face<Curve3, Surface3>, plane: &Plane) -> Option<Vec<[f64; 2]>> {
    let w = fb.boundary.first()?;
    let mut pts = Vec::new();
    for u in &w.borrow().edges {
        push_edge_use_uv(u, plane, &mut pts);
    }
    if pts.len() < 3 {
        return None;
    }
    Some(pts)
}

/// The single circular boundary of a disk-shaped planar face, if it has one.
fn circle_boundary(fb: &Face<Curve3, Surface3>) -> Option<(Vec3, f64)> {
    if fb.boundary.len() != 1 {
        return None;
    }
    let w = fb.boundary.first()?;
    let uses = w.borrow().edges.clone();
    let mut found: Option<(Vec3, f64)> = None;
    for u in &uses {
        match &u.edge.borrow().curve {
            Curve::Circle { center, radius, .. } => found = Some((*center, *radius)),
            _ => return None,
        }
    }
    found
}

/// Does the solid lie inside `other`? `sign` is -1 to probe toward the face's
/// material (interior) and +1 to probe away from it (exterior). The boolean's
/// keep/remove decision follows from which side is where (SPEC §4.5).
fn offset_sign(op: &str, is_a: bool) -> Option<f64> {
    match (op, is_a) {
        ("subtract", true) => Some(-1.0),
        ("union", true) => Some(1.0),
        ("intersect", true) => Some(-1.0),
        ("subtract", false) => Some(1.0),
        ("union", false) => Some(1.0),
        ("intersect", false) => Some(-1.0),
        _ => None,
    }
}

/// True when the operation KEEPS the region inside the other solid; false when
/// it keeps the region outside (and cuts the inside out as a hole).
fn keeps_inside(op: &str, is_a: bool) -> bool {
    op == "intersect" || (op == "subtract" && !is_a)
}

/// The region of a planar face (given as a polygon) that survives.
/// The uv wires (outer + holes) of a face of `other` COPLANAR with the
/// probe plane, if any. Coplanar contacts (the Y1 leg bottom against the
/// pocketed plate's top face) need the partner's exact footprint: the
/// half-plane algebra cannot represent a cross-section with recessed voids
/// (the pocket walls leak constants that empty the region). The coplanar
/// face's own boundary IS the cross-section, holes included.
fn coplanar_face_wires(other: &TSolid, plane: &Plane) -> Option<Vec<Vec<[f64; 2]>>> {
    for f in other.faces() {
        let fb = f.borrow();
        if let Surface::Plane(g) = &fb.surface {
            // Same normal (either sign) and the planes coincide.
            let parallel = dot(g.n, plane.n).abs() >= 1.0 - 1e-9;
            let together = dot(sub(g.origin, plane.origin), plane.n).abs() <= 1e-7;
            if parallel && together {
                // Skip void faces of `other` (a prior bore's ceiling at this
                // plane is not the material footprint). A void face has
                // material behind it beside its own area; a cap does not.
                let (area, c3) = build::face_area_centroid(&fb);
                if area <= 0.0 {
                    continue;
                }
                let mut rr = 0.0f64;
                for w in &fb.boundary {
                    for u in &w.borrow().edges {
                        let eb = u.edge.borrow();
                        for p in [eb.a.borrow().point, eb.b.borrow().point] {
                            let d = crate::math::len(sub(p, c3));
                            if d > rr {
                                rr = d;
                            }
                        }
                    }
                }
                let mut void_face = false;
                for dir in [plane.u, scale(plane.u, -1.0), plane.v, scale(plane.v, -1.0)] {
                    let beside = add(c3, scale(dir, 2.0 * rr + 1.0));
                    let behind = sub(beside, scale(g.n, 4.0 * PROBE));
                    if inside_solid(other, behind) {
                        void_face = true;
                        break;
                    }
                }
                if void_face {
                    continue;
                }
                let mut wires = Vec::new();
                for w in &fb.boundary {
                    let mut pts = Vec::new();
                    for u in &w.borrow().edges {
                        push_edge_use_uv(u, plane, &mut pts);
                    }
                    if pts.len() >= 3 {
                        wires.push(pts);
                    } else if pts.len() == 1 {
                        // A collapsed circle wire: reconstruct it from the
                        // edge curve so containment tests see the ring.
                        let u0 = &w.borrow().edges[0];
                        let eb = u0.edge.borrow();
                        if let Curve::Circle { center, radius, .. } = &eb.curve {
                            let cuv = plane.project(*center);
                            let mut ring = Vec::with_capacity(33);
                            for k in 0..32 {
                                let a = TWO_PI * k as f64 / 32.0;
                                ring.push([cuv[0] + radius * a.cos(), cuv[1] + radius * a.sin()]);
                            }
                            ring.push(ring[0]);
                            wires.push(ring);
                        }
                    }
                }
                if !wires.is_empty() {
                    return Some(wires);
                }
            }
        }
    }
    None
}


fn keep_polygon(
    face: &TFace,
    plane: &Plane,
    other: &TSolid,
    op: &str,
    is_a: bool,
    out: &mut Vec<TFace>,
) -> Option<()> {
    // A disk face that already carries inner wires (a circle-bitten cap:
    // the Y2 flange's top disk after hole1, meeting bore2) collapses to a
    // one-point uv ring that outer_uv cannot walk: route it through the
    // disk logic directly. The region's disk bites a new hole;
    // face_with_hole clones the existing wires so earlier holes survive.
    {
        let fb = face.borrow();
        if fb.boundary.len() >= 1 {
            if let Some((center, radius)) = circle_boundary_of_wire(&fb) {
                if fb.boundary.len() >= 2 {
                    drop(fb);
                    let sign = offset_sign(op, is_a)?;
                    let region = region_inside(other, plane, scale(plane.n, sign * PROBE))?;
                    let c_uv = plane.project(center);
                    let keep_outside = !keeps_inside(op, is_a);
                    let in_region = |p: Vec3| -> bool {
                        match &region.disk {
                            Some((c, r)) => {
                                let uv = plane.project(p);
                                let d = [(uv[0] - c[0]) as f64, (uv[1] - c[1]) as f64];
                                d[0] * d[0] + d[1] * d[1] <= r * r + 1e-7
                                    && region.hs.iter().all(|h| {
                                        h[0] * uv[0] + h[1] * uv[1] + h[2] <= 1e-9
                                    })
                            }
                            None => false,
                        }
                    };
                    let covered = in_region(center)
                        && (0..32).all(|k| {
                            let a = TWO_PI * k as f64 / 32.0;
                            in_region(add(center, add(
                                scale(plane.u, radius * a.cos()),
                                scale(plane.v, radius * a.sin()),
                            )))
                        });
                    let _ = (keep_outside, covered, in_region);
                    // Nothing of the face is bitten: keep whole. (Checked
                    // BEFORE the disk unwrap: Region::empty() carries no
                    // disk, and falling through to the partial-overlap
                    // refusal would refuse faces the tool never touches.)
                    // An unsatisfiable (0,0,c) constant is a de-facto empty
                    // region too: the tool's far cap sits beyond the probe
                    // plane entirely (the flange's bottom disk vs the
                    // cylinder whose body starts 6 above the plane).
                    let de_facto_empty = region.hs.iter().any(|h| {
                        h[0] * h[0] + h[1] * h[1] < 1e-18 && h[2] > 1e-9
                    }) || region.empty;
                    if de_facto_empty {
                        let reverse = op == "subtract" && !is_a;
                        let kept_plane = if reverse {
                            Plane { origin: plane.origin, n: scale(plane.n, -1.0), u: plane.u, v: plane.v }
                        } else {
                            plane.clone()
                        };
                        out.push(if keeps_inside(op, is_a) && reverse {
                            flip_planar(face)
                        } else {
                            face.clone()
                        });
                        return Some(());
                    }
                    // Two exact verdicts, ahead of the lens/lune refusal below.
                    // WHOLE: the face lies inside `other` -- a counterbore
                    // tool's shoulder (an annulus) wholly in the target, whose
                    // region here is the box's half-planes with no disk at all.
                    // CLEAR: none of it does -- a first counterbore's shoulder
                    // against a second tool standing clear across the part.
                    // Exact, not sampled: the outer circle against every
                    // half-plane (by its radius) and against the region's disk.
                    // (An empty region and the (0,0,c) constants took the
                    // branch above.)
                    let whole = region.hole.is_none()
                        && region.disk.map_or(true, |(c, r)| {
                            let d = ((c[0] - c_uv[0]).powi(2) + (c[1] - c_uv[1]).powi(2)).sqrt();
                            d + radius <= r + 1e-7
                        })
                        && region.hs.iter().all(|h| {
                            h[0] * c_uv[0] + h[1] * c_uv[1] + h[2]
                                + radius * (h[0] * h[0] + h[1] * h[1]).sqrt()
                                <= 1e-9
                        });
                    let clear = region.disk.map_or(false, |(c, r)| {
                        ((c[0] - c_uv[0]).powi(2) + (c[1] - c_uv[1]).powi(2)).sqrt() >= r + radius - 1e-7
                    }) || region.hs.iter().any(|h| {
                        h[0] * c_uv[0] + h[1] * c_uv[1] + h[2]
                            - radius * (h[0] * h[0] + h[1] * h[1]).sqrt()
                            >= -1e-9
                    });
                    // But the region is exact only for a convex `other`: a
                    // base's void walls push half-planes that contradict (a
                    // prior pocket's x<=4 and x>=8), and CLEAR then read a
                    // shoulder crossing that pocket as untouched -- MEASURED,
                    // caught downstream only by where a soundness sample fell.
                    // So a verdict must also hold point by point, on rings over
                    // the face outside its holes. A face whose holes are not
                    // all circles is not sampled, and refuses.
                    if whole || clear {
                        let holes: Option<Vec<(Vec3, f64)>> = face
                            .borrow()
                            .boundary
                            .iter()
                            .skip(1)
                            .map(|w| {
                                let mut c = None;
                                for u in &w.borrow().edges {
                                    match &u.edge.borrow().curve {
                                        Curve::Circle { center, radius, .. } => c = Some((*center, *radius)),
                                        _ => return None,
                                    }
                                }
                                c
                            })
                            .collect();
                        let mut votes: Vec<bool> = Vec::new();
                        if let Some(holes) = &holes {
                            for f in [0.95, 0.8, 0.65, 0.5, 0.35, 0.2] {
                                for k in 0..16 {
                                    let a = TWO_PI * k as f64 / 16.0;
                                    let p = add(center, add(
                                        scale(plane.u, f * radius * a.cos()),
                                        scale(plane.v, f * radius * a.sin()),
                                    ));
                                    if holes.iter().any(|(hc, hr)| crate::math::len(sub(p, *hc)) <= hr + 1e-7) {
                                        continue;
                                    }
                                    votes.push(inside_solid(other, add(p, scale(plane.n, sign * PROBE))));
                                }
                            }
                        }
                        if whole && !votes.is_empty() && votes.iter().all(|&v| v) {
                            if keeps_inside(op, is_a) {
                                let reverse = op == "subtract" && !is_a;
                                out.push(if reverse { flip_planar(face) } else { face.clone() });
                            }
                            return Some(());
                        }
                        if clear && !votes.is_empty() && votes.iter().all(|&v| !v) {
                            if !keeps_inside(op, is_a) {
                                out.push(face.clone());
                            }
                            return Some(());
                        }
                    }
                    if let Some((c, r)) = region.disk {
                        // Containment in the face disk: compare in uv.
                        let cuv = plane.project(center);
                        let dist = ((c[0] - cuv[0]) * (c[0] - cuv[0])
                            + (c[1] - cuv[1]) * (c[1] - cuv[1]))
                        .sqrt();
                        if dist + r <= radius - 1e-7 {
                            if keeps_inside(op, is_a) {
                                // Interior: drop the face.
                                return Some(());
                            }
                            out.push(face_with_hole(face, &plane, &Hole::Circle(c, r)));
                            return Some(());
                        }
                    }
                    // Partial overlap of two circles is W8's lens/lune work:
                    // refuse honestly rather than guess.
                    return None;
                }
            }
        }
    }
    let f = outer_uv(&face.borrow(), plane)?;
    let sign = offset_sign(op, is_a)?;
    let region = region_inside(other, plane, scale(plane.n, sign * PROBE))?;
    let clamped = match clamp(&region, &f) {
        Some(c) => c,
        None => {
            // `clamp` only returns None for a disk region that neither
            // contains the face nor sits fully inside it: a sphere cutting
            // a flat wall (SPEC pinned math). Rescue that one case with a
            // real mixed segment/arc loop; anything else still refuses.
            let (c, r) = region.disk.filter(|_| region.hs.is_empty())?;
            let pieces = clip_convex_poly_by_disk(&f, c, r)?;
            Clamped::Mixed(pieces, c, r)
        }
    };
    // The coplanar-pair rescue (same reasoning as keep_disk's W3 arm): a
    // face COPLANAR with a face of `other` reads its region EMPTY at the
    // +PROBE probe (the probe sits PROBE past the partner face), yet for a
    // keep-outside op the partner still bites its footprint out of this
    // face -- the Y1 box-join: A's y=30 wall and B's coplanar y=30 wall
    // both kept whole, the shared band double-counted (+6000 volume).
    // Re-probe AT the plane: the partner's material is AT the plane, so
    // its true footprint appears; bite it out (a hole), or if it covers
    // the whole face, drop the face (interior to the union). Subtract's
    // keep-inside faces never reach this arm.
    // Tool faces only: the base's coplanar face is the one that keeps the
    // shared band (emitted once); the tool must drop it. Either side could
    // own the band, but both rescuing drops it TWICE-less-than-once -- the
    // band vanished entirely (60000 vs 66000).
    let clamped = if !is_a && !keeps_inside(op, is_a) && matches!(clamped, Clamped::Empty) {
        // Preferred source: a face of `other` coplanar with the probe
        // plane. Its own wires are the partner's exact footprint (the
        // Y1 leg bottom against the pocketed plate's top face); the
        // half-plane algebra cannot represent that cross-section's
        // recessed voids without leaking constants.
        if let Some(wires) = coplanar_face_wires(other, plane) {
            let outer = &wires[0];
            let covered = f.iter().all(|q| {
                point_in_poly(outer, *q)
                    && !wires[1..].iter().any(|h| point_in_poly(h, *q))
            });
            let poked = f.iter().any(|q| wires[1..].iter().any(|h| point_in_poly(h, *q)));
            if covered && !poked {
                // Interior to the union: drop the face.
                Clamped::Full
            } else {
                // Partial overlap: the bite is the partner's outer wire
                // clipped INTO this face's polygon (both convex for the
                // fixtures). Touching the face's boundary -> the complement
                // path; strictly inside -> a hole. The partner's holes are
                // respected: a face corner inside a partner hole pokes
                // through a void, which the complement cannot express.
                let bite = clip_poly_by_poly(outer, &f);
                if bite.len() < 3 || poly_area(&bite) <= 1e-9 {
                    // Disjoint or touching at an edge: keep whole.
                    Clamped::Empty
                } else {
                    let bite_touches_c = f.iter().any(|p| point_in_poly(&bite, *p))
                        || bite.iter().any(|q| !point_in_poly_strict(&f, *q));
                    if bite_touches_c {
                        let pieces = poly_minus_poly(&f, &bite);
                        if pieces.is_empty() {
                            Clamped::Full
                        } else {
                            Clamped::Complement(pieces)
                        }
                    } else {
                        Clamped::Bite(bite)
                    }
                }
            }
        } else if let Some(region0) = region_inside(other, plane, [0.0, 0.0, 0.0]) {
            if !region0.empty {
                match clamp(&region0, &f) {
                    // The zero-probe region must be a real bite
                    // (Poly/Disk/Annulus inside the face) or a Full cover;
                    // anything else keeps the Empty reading.
                    Some(c @ (Clamped::Poly(_) | Clamped::Disk(_, _) | Clamped::Annulus(_, _, _, _) | Clamped::Full)) => c,
                    _ => Clamped::Empty,
                }
            } else {
                Clamped::Empty
            }
        } else {
            Clamped::Empty
        }
    } else {
        clamped
    };
    let reverse = op == "subtract" && !is_a;
    let kept_plane = if reverse {
        Plane { origin: plane.origin, n: scale(plane.n, -1.0), u: plane.u, v: plane.v }
    } else {
        plane.clone()
    };
    if keeps_inside(op, is_a) {
        match clamped {
            Clamped::Empty => {}
            Clamped::Complement(_) | Clamped::Bite(_) => {
                // Keep-inside ops never receive the coplanar rescue's
                // variants (it is keep-outside only); a stray one is a
                // logic error -- refuse rather than guess.
                return None;
            }
            Clamped::Full => {
                out.push(if reverse { flip_planar(face) } else { face.clone() })
            }
            Clamped::Disk(c, r) => out.push(build_circle_face(&kept_plane, c, r)),
            Clamped::Half(..) => return None,
            Clamped::Poly(poly) => {
                if reverse {
                    let mut rp = poly.clone();
                    rp.reverse();
                    out.push(build_poly_face(&kept_plane, &rp));
                } else {
                    out.push(build_poly_face(&kept_plane, &poly));
                }
            }
            Clamped::Annulus(c, r, hc, hr) => {
                let _ = (hc, hr);
                let kept = if reverse { flip_planar(face) } else { face.clone() };
                out.push(face_with_hole(&kept, &kept_plane, &Hole::Circle(c, r)));
            }
            Clamped::Mixed(pieces, c, r) => {
                if reverse {
                    out.push(build_mixed_face(&kept_plane, &reverse_pieces(&pieces), c, r));
                } else {
                    out.push(build_mixed_face(&kept_plane, &pieces, c, r));
                }
            }
        }
    } else {
        match clamped {
            Clamped::Empty => out.push(face.clone()),
            Clamped::Full => {}
            Clamped::Disk(c, r) => out.push(face_with_hole(face, &kept_plane, &Hole::Circle(c, r))),
            Clamped::Half(c, r, phi) => out.push(face_with_hole(face, &kept_plane, &Hole::Half(c, r, phi))),
            Clamped::Complement(pieces) => {
                for piece in pieces {
                    let piece = if reverse { let mut rp = piece.clone(); rp.reverse(); rp } else { piece };
                    let mut face_out = build_poly_face(&kept_plane, &piece);
                    let inner: Vec<topo::WireRef<Curve3>> = {
                        let fb = face.borrow();
                        fb.boundary.iter().skip(1).cloned().collect()
                    };
                    for w in &inner {
                        let pts = wire_uv_points(w, &kept_plane);
                        if !pts.is_empty() && pts.iter().all(|q| point_in_poly(&piece, *q)) {
                            face_out.borrow_mut().boundary.push(w.clone());
                        }
                    }
                    out.push(face_out);
                }
            }
            Clamped::Bite(bite) => {
                out.push(face_with_hole(face, &kept_plane, &Hole::Poly(bite)));
            }
            Clamped::Poly(poly) => {
                // The removed region must sit inside the face for a clean hole.
                // A bite TOUCHING the face boundary (its corners on the face's
                // own edges -- the coplanar rescue where the partner footprint
                // spans the face's full extent) cannot be a hole: emit the
                // complement pieces instead (f minus bite, disjoint convex
                // polys). Any face corner inside the bite is still a refusal:
                // the bite would cover a corner the complement cannot express.
                let bite_touches = f.iter().any(|p| point_in_poly(&poly, *p))
                    || poly.iter().any(|q| !point_in_poly_strict(&f, *q));
                if bite_touches {
                    let pieces = poly_minus_poly(&f, &poly);
                    if pieces.is_empty() {
                        // Bite covers the whole face.
                        return Some(());
                    }
                    // The original face's INNER wires (existing holes) must
                    // survive on whichever piece contains them: the holed
                    // plate + leg join loses the bore voids otherwise (the
                    // Y1 bench: the L-join refilled one hole's volume).
                    let inner: Vec<topo::WireRef<Curve3>> = {
                        let fb = face.borrow();
                        fb.boundary.iter().skip(1).cloned().collect()
                    };
                    for piece in pieces {
                        let piece = if reverse { let mut rp = piece.clone(); rp.reverse(); rp } else { piece };
                        let mut face_out = build_poly_face(&kept_plane, &piece);
                        for w in &inner {
                            // Every point of the hole wire must sit inside
                            // this piece for a clean attachment.
                            let pts = wire_uv_points(w, &kept_plane);
                            if !pts.is_empty() && pts.iter().all(|q| point_in_poly(&piece, *q)) {
                                face_out.borrow_mut().boundary.push(w.clone());
                            }
                        }
                        out.push(face_out);
                    }
                    return Some(());
                }
                out.push(face_with_hole(face, &kept_plane, &Hole::Poly(poly)));
            }
            // A mixed-shaped hole (arc-bounded cut into a face) isn't built
            // yet -- no fixture needs it, and a wrong hole is worse than a
            // refusal (SPEC constraint 4).
            Clamped::Annulus(_, _, _, _) => return None,
            Clamped::Mixed(_, _, _) => return None,
        }
    }
    Some(())
}

/// A disk-shaped planar face: sample its interior to decide full/empty/mixed.
fn keep_disk(
    face: &TFace,
    plane: &Plane,
    center: Vec3,
    radius: f64,
    other: &TSolid,
    op: &str,
    is_a: bool,
    out: &mut Vec<TFace>,
) -> Option<()> {
    let sign = offset_sign(op, is_a)?;
    // UNION's kept tool faces are the tool's own OUTSIDE: the tool cap in a
    // union is kept where it lies OUTSIDE the base. A tool cap COPLANAR with
    // a base cap must be probed AT the plane (offset 0, inclusive) — probing
    // +PROBE past it classifies every point of the coplanar base face as
    // outside, which would keep the tool's whole disk (a full overlap, a
    // wrong union) instead of the lune. Subtract does not take this path (a
    // flush tool cap must vanish, which the +PROBE probe achieves), and the
    // base's own faces keep the coplanar-reads-outside rule either way, so
    // the branch is union+tool only.
    let region = if op == "union" && !is_a {
        region_inside(other, plane, scale(plane.n, 0.0))?
    } else {
        region_inside(other, plane, scale(plane.n, sign * PROBE))?
    };
    // Region membership slack, in plane-uv units. MUST be strictly below PROBE:
    // when this face is coplanar with a face of `other`, the probe sits exactly
    // PROBE past that face, so its half-plane evaluates to +PROBE. A slack equal
    // to PROBE read that as "inside" and kept a spurious flipped cap on the
    // opening of a flush blind hole (volume off by the cap's own term, no
    // refusal); anything below PROBE classifies the coincidence as outside,
    // which is what "this surface is on the base's boundary" means. For the
    // union-at-zero probe above the same slack makes the coplanar boundary
    // itself (exactly 0) read inside, which is what that probe wants.
    const REGION_EPS: f64 = 1e-9;
    let mut inside_count = 0;
    let mut total = 0;
    let probe = |p: Vec3, inside_count: &mut usize, total: &mut usize| {
        let uv = plane.project(p);
        let yes = if region.empty {
            false
        } else {
            let in_hs = region.hs.iter().all(|h| h[0] * uv[0] + h[1] * uv[1] + h[2] <= REGION_EPS);
            let in_disk = match region.disk {
                Some((c, r)) => {
                    let d = [(uv[0] - c[0]) as f64, (uv[1] - c[1]) as f64];
                    d[0] * d[0] + d[1] * d[1] <= r * r + 1e-7
                }
                None => true,
            };
            let out_of_hole = match region.hole {
                Some((c, r)) => {
                    let d = [(uv[0] - c[0]) as f64, (uv[1] - c[1]) as f64];
                    d[0] * d[0] + d[1] * d[1] >= r * r - 1e-7
                }
                None => true,
            };
            in_hs && in_disk && out_of_hole
        };
        *total += 1;
        if yes { *inside_count += 1; }
    };
    probe(center, &mut inside_count, &mut total);
    for k in 0..32 {
        let a = TWO_PI * k as f64 / 32.0;
        let p = add(center, add(scale(plane.u, radius * a.cos()), scale(plane.v, radius * a.sin())));
        probe(p, &mut inside_count, &mut total);
    }
    // A tangent contact puts a single probe on the boundary; treat a
    // negligible or overwhelming inside fraction as empty/full so a tangency
    // does not read as a partial overlap, while a genuine sliver still does.
    let full = inside_count * 20 >= total * 19;
    let empty = inside_count * 20 <= total;
    let center_uv = plane.project(center);
    // Does the disk region (centre `c`, radius `r`), possibly cut by the
    // half-planes, sit strictly inside this face's disk? In-plane cuts are
    // real boundaries (a half-plane whose line crosses the disk); a
    // degenerate (0,0,c) half-plane is the coplanar face itself and cuts
    // nothing in-plane.
    let cuts = |hs: &[[f64; 3]], cuv: [f64; 2]| -> bool {
        hs.iter().any(|h| {
            let den = (h[0] * h[0] + h[1] * h[1]).sqrt();
            if den < 1e-7 {
                return false;
            }
            let num = h[0] * cuv[0] + h[1] * cuv[1] + h[2];
            (num / den).abs() < radius - 1e-7
        })
    };
    if !full && !empty {
        // A partial overlap between two COPLANAR cylinders' caps (W8): the
        // kept shape is a lens (inside the other's disk) or a lune (this disk
        // minus the other's) — buildable exactly as two circle arcs, unless a
        // half-plane cuts the base disk (a three-piece loop, still not built).
        if !cuts(&region.hs, center_uv) {
            if let Some((c, r)) = region.disk {
                // Containment: the other's disk entirely inside this face's
                // disk. A tool cap fully inside a base cap is interior (kept
                // inside = drop it); a keep-outside operation instead bites a
                // circular hole out of this cap (an annulus).
                let d = [c[0] - center_uv[0], c[1] - center_uv[1]];
                let dist = (d[0] * d[0] + d[1] * d[1]).sqrt();
                if dist + r <= radius - 1e-7 {
                    if keeps_inside(op, is_a) {
                        return Some(());
                    }
                    let reverse = op == "subtract" && !is_a;
                    let kept_plane = if reverse {
                        Plane { origin: plane.origin, n: scale(plane.n, -1.0), u: plane.u, v: plane.v }
                    } else {
                        plane.clone()
                    };
                    out.push(face_with_hole(face, &kept_plane, &Hole::Circle(c, r)));
                    return Some(());
                }
                return keep_disk_two_arcs(&plane, center_uv, radius, c, r, op, is_a, out);
            }
        }
        return None;
    }
    // W3 (open-top hollow): a tool disk strictly inside this cap reads
    // "empty" at the +PROBE probe — the tool's own flush cap plane sits
    // exactly PROBE past this face, so every probe fails it — yet for a
    // keep-outside operation the tool still bites a circular hole out of
    // this cap (the outer cap of a hollowed cylinder becomes an annulus).
    // Re-probe AT the plane: coplanar faces then satisfy their own
    // half-planes (exactly 0 <= eps) and the region is the tool's true
    // cross-section; containment (its disk inside this one) builds the
    // annulus. A cutting half-plane or a non-contained disk still refuses.
    if empty && !keeps_inside(op, is_a) {
        if let Some(region0) = region_inside(other, plane, [0.0, 0.0, 0.0]) {
            if !region0.empty {
                if let Some((c, r)) = region0.disk {
                    if !cuts(&region0.hs, center_uv) {
                        let d = [c[0] - center_uv[0], c[1] - center_uv[1]];
                        let dist = (d[0] * d[0] + d[1] * d[1]).sqrt();
                        if dist + r <= radius - 1e-7 {
                            // The bite circle is inside the face. But if the
                            // bite EQUALS the face (same centre, same radius),
                            // the kept region is empty: drop the face (it is
                            // interior to the union), do not emit a zero-area
                            // face-with-hole (the Y2 touch bug: the filleted
                            // flange's torus band hid the r35 containment from
                            // the +PROBE probe, the cap read empty, and the
                            // equal-bite emitted the full cap back).
                            let same = dist <= 1e-7 && (r - radius).abs() <= 1e-7 * radius.max(1.0);
                            if same {
                                return Some(());
                            }
                            out.push(face_with_hole(face, &plane, &Hole::Circle(c, r)));
                            return Some(());
                        }
                        // The region's disk CONTAINS the face (opposite
                        // containment): every probe of the face sits inside
                        // the region -> the face is interior -> drop it.
                        let mut face_covered = true;
                        {
                            let mut probe_face = |p: Vec3| {
                                let uv = plane.project(p);
                                let d = [(uv[0] - c[0]) as f64, (uv[1] - c[1]) as f64];
                                if !(d[0] * d[0] + d[1] * d[1] <= r * r + 1e-7
                                    && region0.hs.iter().all(|h| h[0] * uv[0] + h[1] * uv[1] + h[2] <= 1e-9))
                                {
                                    face_covered = false;
                                }
                            };
                            probe_face(center);
                            for k in 0..32 {
                                let a = TWO_PI * k as f64 / 32.0;
                                probe_face(add(center, add(scale(plane.u, radius * a.cos()), scale(plane.v, radius * a.sin()))));
                            }
                        }
                        if face_covered {
                                                return Some(());
                        }
                    }
                }
            }
        }
    }
    let reverse = op == "subtract" && !is_a;
    let kept_plane = if reverse {
        Plane { origin: plane.origin, n: scale(plane.n, -1.0), u: plane.u, v: plane.v }
    } else {
        plane.clone()
    };
    if keeps_inside(op, is_a) {
        if full {
            out.push(if reverse { flip_planar(face) } else { face.clone() });
        }
    } else if empty {
        out.push(face.clone());
    } else {
        // The whole disk is removed.
    }
    let _ = kept_plane;
    Some(())
}


/// The uv points of a wire's edge endpoints in `plane` (walk orientation kept).
fn wire_uv_points(w: &topo::WireRef<Curve3>, plane: &Plane) -> Vec<[f64; 2]> {
    let mut pts = Vec::new();
    for u in &w.borrow().edges {
        let eb = u.edge.borrow();
        let p = if u.forward { eb.a.borrow().point } else { eb.b.borrow().point };
        pts.push(plane.project(p));
    }
    pts
}

/// Clip convex polygon `p` by convex polygon `clip`: each of clip's edges
/// becomes a keep-side half-plane oriented toward clip's centroid.
fn clip_poly_by_poly(p: &[[f64; 2]], clip: &[[f64; 2]]) -> Vec<[f64; 2]> {
    if p.len() < 3 || clip.len() < 3 {
        return Vec::new();
    }
    let mut pc = [0.0f64, 0.0];
    for q in clip {
        pc[0] += q[0];
        pc[1] += q[1];
    }
    let pc = [pc[0] / clip.len() as f64, pc[1] / clip.len() as f64];
    let mut out = p.to_vec();
    for i in 0..clip.len() {
        let p1 = clip[i];
        let p2 = clip[(i + 1) % clip.len()];
        let a = p2[1] - p1[1];
        let b = -(p2[0] - p1[0]);
        let c = -(a * p1[0] + b * p1[1]);
        let (a, b, c) = if a * pc[0] + b * pc[1] + c > 0.0 { (-a, -b, -c) } else { (a, b, c) };
        out = clip_halfplane(&out, a, b, c);
        if out.len() < 3 {
            return Vec::new();
        }
    }
    out
}

/// The pieces of convex polygon `f` outside convex polygon `p` (f minus p),
/// as disjoint convex polys via half-plane decomposition: for each edge
/// half-plane of p, one piece clipped inside every earlier half-plane and
/// OUTSIDE that one. Empty pieces dropped. Used by the coplanar rescue when
/// the bite touches the face boundary (a hole would be non-manifold).
fn poly_minus_poly(f: &[[f64; 2]], p: &[[f64; 2]]) -> Vec<Vec<[f64; 2]>> {
    if p.len() < 3 || f.len() < 3 {
        return Vec::new();
    }
    // p's centroid, to decide each edge's inside side.
    let mut pc = [0.0f64, 0.0];
    for q in p {
        pc[0] += q[0];
        pc[1] += q[1];
    }
    let pc = [pc[0] / p.len() as f64, pc[1] / p.len() as f64];
    let edge_h = |p1: [f64; 2], p2: [f64; 2]| -> [f64; 3] {
        let a = p2[1] - p1[1];
        let b = -(p2[0] - p1[0]);
        let c = -(a * p1[0] + b * p1[1]);
        // Keep the side the centroid of p is on (that is "inside p").
        if a * pc[0] + b * pc[1] + c > 0.0 {
            [-a, -b, -c]
        } else {
            [a, b, c]
        }
    };
    let hs: Vec<[f64; 3]> = (0..p.len())
        .map(|i| edge_h(p[i], p[(i + 1) % p.len()]))
        .collect();
    let mut pieces = Vec::new();
    for i in 0..hs.len() {
        // Outside h_i, inside all h_j (j < i).
        let mut piece = f.to_vec();
        for j in 0..=i {
            let h = hs[j];
            let (a, b, c) = if j == i { (-h[0], -h[1], -h[2]) } else { (h[0], h[1], h[2]) };
            piece = clip_halfplane(&piece, a, b, c);
        }
        if piece.len() >= 3 && poly_area(&piece) > 1e-9 {
            pieces.push(piece.clone());
        }
        if piece.is_empty() {
            // Fully consumed: the rest would be empty too.
            if i + 1 == hs.len() {
                break;
            }
        }
    }
    pieces
}

/// A disk-shaped planar face partially overlapped by another disk (W8
/// coplanar caps): the kept region is a lens (inside both disks) or a lune
/// (this disk minus the other), built exactly as two circle arcs. Worked
/// example behind the angle bookkeeping: disk1 R5 at origin, disk2 R5 at
/// (6,0) — intersections (3,±4); the lens walks circle1's near arc
/// (angles −θ₁→+θ₁, through (5,0)) then circle2's near arc back (through
/// (1,0)), both CCW; the lune walks circle1's long arc CCW (through (−5,0))
/// then circle2's near arc clockwise. `None` when containment makes the
/// partial shape undefined (the callers' probes already routed those).
fn keep_disk_two_arcs(
    plane: &Plane,
    center: [f64; 2],
    radius: f64,
    other_c: [f64; 2],
    other_r: f64,
    op: &str,
    is_a: bool,
    out: &mut Vec<TFace>,
) -> Option<()> {
    let d = [other_c[0] - center[0], other_c[1] - center[1]];
    let dist = (d[0] * d[0] + d[1] * d[1]).sqrt();
    if dist < 1e-12 {
        return None; // concentric: a pure containment, not a partial overlap
    }
    if dist >= radius + other_r - 1e-9 || dist <= (radius - other_r).abs() + 1e-9 {
        return None; // tangent or containment: not this builder's case
    }
    let theta1 = ((radius * radius + dist * dist - other_r * other_r) / (2.0 * radius * dist))
        .clamp(-1.0, 1.0)
        .acos();
    let theta2 = ((other_r * other_r + dist * dist - radius * radius)
        / (2.0 * other_r * dist))
        .clamp(-1.0, 1.0)
        .acos();
    let phi = d[1].atan2(d[0]); // from this disk's centre toward the other's
    let keep_inside = keeps_inside(op, is_a);
    // Arc pieces as (centre_uv, radius, start_angle, signed span), chained
    // CCW for the lens and per the worked example for the lune.
    let pieces: Vec<([f64; 2], f64, f64, f64)> = if keep_inside {
        vec![
            (center, radius, phi - theta1, 2.0 * theta1),
            (other_c, other_r, phi + std::f64::consts::PI - theta2, 2.0 * theta2),
        ]
    } else {
        vec![
            (center, radius, phi + theta1, TWO_PI - 2.0 * theta1),
            (other_c, other_r, phi + std::f64::consts::PI + theta2, -2.0 * theta2),
        ]
    };
    let reverse = op == "subtract" && !is_a;
    let kept_plane = if reverse {
        Plane { origin: plane.origin, n: scale(plane.n, -1.0), u: plane.u, v: plane.v }
    } else {
        plane.clone()
    };
    out.push(build_arc_loop_face(&kept_plane, &pieces));
    if reverse {
        // flip_planar keeps the boundary and negates the surface normal; the
        // built face's own plane is `kept_plane`, so flipping it restores the
        // original n as the OUTWARD one pointing into the removed void.
        let built = out.pop().expect("just pushed");
        out.push(flip_planar(&built));
    }
    Some(())
}

/// A planar face whose single boundary wire is a chain of circular arcs given
/// in the plane's uv: (centre, radius, start angle, signed sweep) per piece,
/// each starting where the previous ended. Angles are CCW in (plane.u,
/// plane.v) when the (u, v, n) triple is right-handed; the arcs are built as
/// real Curve::Arc so measurement, meshing and STEP all treat them exactly.
fn build_arc_loop_face(plane: &Plane, pieces: &[([f64; 2], f64, f64, f64)]) -> TFace {
    let pt = |c: [f64; 2], r: f64, ang: f64| -> [f64; 2] {
        [c[0] + r * ang.cos(), c[1] + r * ang.sin()]
    };
    let mut uses: Vec<topo::EdgeUse<Curve3>> = Vec::with_capacity(pieces.len());
    let n = pieces.len();
    for (i, (c, r, start, sweep)) in pieces.iter().enumerate() {
        let a_uv = pt(*c, *r, *start);
        let b_uv = pt(*c, *r, *start + *sweep);
        let a3 = plane.point(a_uv);
        let b3 = plane.point(b_uv);
        let mid_ang = *start + 0.5 * *sweep;
        let m3 = plane.point(pt(*c, *r, mid_ang));
        let e = topo::edge(
            topo::vertex(a3),
            topo::vertex(b3),
            true,
            Curve::Arc {
                center: plane.point(*c),
                radius: *r,
                normal: plane.n,
                x_axis: add(scale(plane.u, start.cos()), scale(plane.v, start.sin())),
                sweep: *sweep,
            },
        );
        let _last = i + 1 == n;
        uses.push(topo::EdgeUse {
            edge: e,
            forward: true,
            pcurve: topo::Pcurve { start: a_uv, end: b_uv, mid: plane.project(m3) },
        });
    }
    Rc::new(RefCell::new(Face {
        boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
        forward: true,
        surface: Surface::Plane(plane.clone()),
        uv_domain: [[0.0, 1.0], [0.0, 1.0]],
    }))
}

/// Process one face of a source solid, emitting the faces of the result that
/// descend from it. `None` refuses the whole boolean.
fn process_face(
    face: &TFace,
    other: &TSolid,
    op: &str,
    is_a: bool,
    out: &mut Vec<TFace>,
) -> Option<()> {
    let fb = face.borrow();
    match &fb.surface {
        Surface::Plane(p) => {
            let plane = p.clone();
        if let Some((center, radius)) = circle_boundary(&fb) {
            return keep_disk(face, &plane, center, radius, other, op, is_a, out);
        }
        keep_polygon(face, &plane, other, op, is_a, out)
    }
        Surface::Cylinder(cy) => {
            // A partial wall (a revolved tool's half-cylinder) is clipped only
            // along its axis, by planes perpendicular to it; any other tool
            // face needs u-clipping an arc range does not have yet.
            let wall_arc = cy.arc.clone();
            let sign = offset_sign(op, is_a)?;
            let keep_inside = keeps_inside(op, is_a);
            let reverse = op == "subtract" && !is_a;
            let axis = normalize(cy.axis);
            let mut breaks = vec![cy.vmin, cy.vmax];
            // A face of `other` whose own AABB cannot reach this wall (touching
            // counts as reaching) plays no part in splitting it, whatever its
            // surface. Skipping it lets successive DISJOINT cuts work: after the
            // first bore the base carries a cylindrical wall, and a second bore
            // far away would otherwise refuse on a surface kind it never meets.
            let wall_box = fb.surface.aabb();
            // Collect parallel cylinder tools for u-clipping (W8).
            let mut parallel_cylinders: Vec<Cylinder> = Vec::new();
            let mut saw_cone = false;
            for f in other.faces() {
                let s = f.borrow().surface.clone();
                if let Some(fb_box) = face_reach_box(&f) {
                    if !aabbs_touch(&wall_box, &fb_box) {
                        continue;
                    }
                }
                match &s {
                    Surface::Plane(g) => {
                        let an = dot(g.n, axis).abs();
                        if (an - 1.0).abs() < 1e-9 {
                            let t = dot(sub(g.origin, cy.origin), g.n) / dot(axis, g.n);
                            if t > cy.vmin + 1e-9 && t < cy.vmax - 1e-9 {
                                breaks.push(t);
                            }
                        } else if an < 1e-9 {
                            // A wall parallel to the axis: only refuses if it
                            // actually cuts the circle (needs u-clipping).
                            let dist = dot(sub(g.origin, cy.origin), g.n).abs();
                            if dist < cy.radius - 1e-7 {
                                return None;
                            }
                        } else {
                            return None;
                        }
                    }
                    Surface::Sphere(_) => {
                        // A sphere can cut the wall; u-clipping is not built.
                        return None;
                    }
                    Surface::Cylinder(cy2) => {
                        // Cylinder vs Cylinder: handle parallel axes case (W8 keystone).
                        // If axes are parallel, the tool cylinder's caps (planes) are already
                        // handled above as they appear as Planes in other.faces(). The wall
                        // intersection requires u-clipping at each v-segment.
                        let a2 = normalize(cy2.axis);
                        let parallel = (dot(axis, a2).abs() - 1.0).abs() < 1e-9;
                        if !parallel {
                            return None; // non-parallel axes: not yet implemented
                        }
                        // Axes are parallel. Store for u-clipping in v-segment loop.
                        // A VOID wall (a prior bore's wall, its outward normal
                        // pointing INTO the void) does not bound material: the
                        // u-clip treats every parallel cylinder as a material
                        // constraint, so a second bore beside the first lost
                        // its whole wall (hole2 at rho 6 vs hole1's void wall
                        // at rho 18: disjoint circles emptied the arcs and the
                        // bore's wall dropped everywhere). Same normal test the
                        // region_inside void-wall skips use: the face's outward
                        // normal at u=0 is cross(e2, axis) * forward-sign; a
                        // void wall's points inward. cy2 carries that sign in
                        // its own frame: flip_face negates e2 with forward kept,
                        // so cross(cy2.e2, cy2.axis) already encodes the flip.
                        {
                            let radial0 = scale(cy2.e1, cy2.radius);
                            let normal0 = cross(cy2.e2, cy2.axis);
                            if dot(normal0, radial0) < 0.0 {
                                continue; // void wall: bounds no material
                            }
                        }
                        parallel_cylinders.push(cy2.clone());
                    }
                    Surface::Torus(t2) => {
                        // Cylinder wall vs a TORUS band (a filleted rim): the
                        // band shares the base axis (a round-primitive rim is
                        // coaxial with its own cylinder). Its axial reach is
                        // the tube's span about ITS center. If the wall's
                        // band does not share axial space with the torus's
                        // tube span, the torus constrains nothing here —
                        // skip. A genuine overlap needs torus/cyl arc math
                        // (W5): refuse.
                        let a2 = normalize(t2.axis);
                        let parallel = (dot(axis, a2).abs() - 1.0).abs() < 1e-9;
                        if !parallel {
                            return None;
                        }
                        let t_lo = dot(t2.center, axis) - t2.tube;
                        let t_hi = dot(t2.center, axis) + t2.tube;
                        let w_lo = dot(cy.origin, axis) + cy.vmin;
                        let w_hi = dot(cy.origin, axis) + cy.vmax;
                        if (w_hi.min(t_hi) - w_lo.max(t_lo)) <= 1e-9 {
                            continue;
                        }
                        // Radial clearance: a coaxial torus band occupies
                        // rho in [ring - tube, ring + tube] about ITS axis.
                        // If the wall's whole circle lies inside the torus's
                        // hole (dist + radius <= ring - tube) or entirely
                        // outside its outer reach (dist - radius >= ring +
                        // tube), the torus cannot touch this wall: skip.
                        // (The Y2 bench: Ø5 holes at rho 6/18 under a fillet
                        // band at rho 32..35 -- axially coincident, radially
                        // clear; refusing here made every flange hole
                        // unbuildable.) A genuine radial overlap needs
                        // torus/cyl arc math (W5): still refuses.
                        let wall_axis_dist = {
                            let dc = sub(cy.origin, t2.center);
                            crate::math::len(sub(dc, scale(a2, dot(dc, a2))))
                        };
                        if wall_axis_dist + cy.radius <= t2.ring - t2.tube + 1e-9
                            || wall_axis_dist - cy.radius >= t2.ring + t2.tube - 1e-9
                        {
                            continue;
                        }
                        return None;
                    }
                    Surface::Cone(c2) => {
                        // This wall against a cone face of `other` (the other
                        // operand is a cone, or carries a countersink-like
                        // band): a circle when coaxial, nothing when clear.
                        match cone_cyl_relation(c2, cy) {
                            ConeCyl::Coaxial { v_cross } => {
                                saw_cone = true;
                                if let Some(v) = v_cross {
                                    let ax2 = normalize(c2.axis);
                                    let pt = add(c2.base, scale(ax2, v * c2.half_angle.cos()));
                                    let t = dot(sub(pt, cy.origin), axis);
                                    if t > cy.vmin + 1e-9 && t < cy.vmax - 1e-9 {
                                        breaks.push(t);
                                    }
                                }
                            }
                            ConeCyl::Clear => saw_cone = true,
                            ConeCyl::Crosses => return None,
                        }
                    }
                    _ => return None,
                }
            }
            // The u-clip arithmetic below is only valid for cylinder tools; a
            // cone beside it would be skipped by it, so that mix refuses.
            if saw_cone && !parallel_cylinders.is_empty() {
                return None;
            }
            // A parallel tool cylinder's own band edges cut this wall's v
            // domain: above/below the tool's band the tool does not exist and
            // the wall keeps its full circle; inside the overlap the
            // u-clip applies. Without these breaks the radial circles were
            // compared at a v the tool never reaches (the Y2 flange bug: a
            // flange circle 15mm axially away swallowed the small
            // cylinder's entire wall).
            for cy2 in &parallel_cylinders {
                // The band edges must land in THIS wall's v-frame (relative
                // to cy.origin), not world height: a wall whose origin sits
                // elsewhere would otherwise split at a phantom height (the
                // overlap-cylinder bug: b's wall origin z=1, a's wall band
                // edge z=3 pushed as v=3 -> a phantom split at z=4 merged
                // the inside band z[1,3] with the outside band z[3,4] and
                // dropped both).
                let a2 = normalize(cy2.axis);
                for end in [cy2.vmin, cy2.vmax] {
                    let p_world = add(cy2.origin, scale(a2, end));
                    let v = dot(sub(p_world, cy.origin), axis);
                    if v > cy.vmin + 1e-9 && v < cy.vmax - 1e-9 {
                        breaks.push(v);
                    }
                }
            }
            if wall_arc.is_some() && !parallel_cylinders.is_empty() {
                return None;
            }
            breaks.sort_by(|a, b| a.partial_cmp(b).unwrap());
            breaks.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            for w in breaks.windows(2) {
                let (vlo, vhi) = (w[0], w[1]);
                if vhi - vlo < 1e-9 {
                    continue;
                }
                // If there are parallel cylinder tools, compute arc intervals at mid-v.
                if !parallel_cylinders.is_empty() {
                    let vm = 0.5 * (vlo + vhi);
                    let base_center = add(cy.origin, scale(axis, vm));
                    // Compute arcs where base cylinder is inside each tool cylinder.
                    // The u-clip is only valid over the SHARED axial band of
                    // base and tool: a zero-length overlap means the tool's
                    // wall does not exist in this segment at all - the tool
                    // keeps its full circle. Without this the radial circles
                    // were compared at a v the tool never reaches (the Y2
                    // flange bug: a flange circle 15mm axially away swallowed
                    // the small cylinder's whole wall).
                    let base_band_lo = dot(cy.origin, axis) + vlo;
                    let base_band_hi = dot(cy.origin, axis) + vhi;
                    let mut arcs: Vec<(f64, f64)> = vec![(0.0, TWO_PI)]; // start with full circle
                    // Whether any tool actually constrained this v-band: a
                    // band-clear tool is skipped below (no constraint), and
                    // when NO tool constrains the wall keeps its WHOLE
                    // circle in both keep senses. The vacuous initial
                    // arcs=[full] is only the intersection identity -- it
                    // must not decide a keep_outside drop (the overlap-stack
                    // upper wall was dropped whole when the only tool's band
                    // ended exactly at the window's lower edge).
                    let mut any_tool = false;
                    for cy2 in &parallel_cylinders {
                        let tool_lo = dot(cy2.origin, axis) + cy2.vmin;
                        let tool_hi = dot(cy2.origin, axis) + cy2.vmax;
                        let _shared = base_band_hi.min(tool_hi) - base_band_lo.max(tool_lo);
                        // A tool whose band does not overlap this v-band
                        // constrains NOTHING here: the band-clear skip
                        // below leaves `arcs` untouched, which is exactly
                        // "no constraint" for BOTH keep senses. (An earlier
                        // version intersected with an empty set here, which
                        // emptied the arcs and, for keep_inside bores, cut
                        // the wall everywhere the base band outlived the
                        // tool band -- a Ø5 bore through the Y2 flange lost
                        // its upper half at the flange wall's z=0 band edge
                        // and the shell cracked.)
                        // The tool cylinder only reaches v in its own band
                        // along the axis (its origin + [vmin, vmax]). If that
                        // band does not overlap this v-band segment, the
                        // tool's wall does not exist here at all: comparing
                        // the RADIAL circles alone would drop walls the tool
                        // never touches (the Y2 flange bug: the flange circle
                        // 15mm away axially swallowed the small cylinder's
                        // whole wall). Skip tools whose band is clear of
                        // [vlo, vhi].
                        let tool_lo = dot(cy2.origin, axis) + cy2.vmin;
                        let tool_hi = dot(cy2.origin, axis) + cy2.vmax;
                        let base_lo = dot(cy.origin, axis) + vlo;
                        let base_hi = dot(cy.origin, axis) + vhi;
                        // Touching bands share only a measure-zero plane:
                        // treat as clear (the tool's wall does not exist in
                        // this v-band).
                        if tool_lo >= base_hi - 1e-9 || tool_hi <= base_lo + 1e-9 {
                            continue;
                        }
                        any_tool = true;
                        // Tool cylinder center at this v (same axis, so center projects to same line).
                        let tool_center = add(cy2.origin, scale(axis, vm));
                        let d = sub(tool_center, base_center);
                        let dist = crate::math::len(d);
                        let r1 = cy.radius;
                        let r2 = cy2.radius;
                        // Two circles intersection: find angular intervals on base circle inside tool circle.
                        let new_arcs = circle_intersection_arcs(r1, r2, dist, cy.e1, cy.e2, d);
                        arcs = intersect_arc_intervals(&arcs, &new_arcs);
                        if arcs.is_empty() {
                            break; // completely outside all tool cylinders
                        }
                    }
                    // For keep_inside=true (tool faces in subtract), keep arcs inside other.
                    // For keep_inside=false (base faces in subtract), keep arcs outside other (complement).
                    // The complement walks [0, 2π) in order, so the intervals
                    // must be sorted with wrap-fragments rotated to the start
                    // (a (5.56, 2π) piece sorts BEFORE (0, 0.72) but walks last).
                    let mut sorted = arcs.clone();
                    // Clamp any piece whose end exceeds 2π (a defensive clamp;
                    // `circle_intersection_arcs` never emits one) so the
                    // complement walk below stays inside [0, 2π).
                    for (_start, end) in sorted.iter_mut() {
                        if *end > TWO_PI { *end = TWO_PI; }
                    }
                    let head = sorted.iter().position(|(s, _)| *s < 1e-9);
                    let ordered: Vec<(f64, f64)> = match head {
                        Some(h) => {
                            let mut it = sorted[h..].to_vec();
                            it.extend_from_slice(&sorted[..h]);
                            it
                        }
                        None => sorted,
                    };
                    let final_arcs: Vec<(f64, f64)> = if !any_tool {
                        // No tool constrains this band: keep the whole circle.
                        vec![(0.0, TWO_PI)]
                    } else if keep_inside {
                        ordered
                    } else {
                        // Complement of arcs in [0, 2π)
                        let mut comp = Vec::new();
                        let mut prev_end = 0.0;
                        for (start, end) in &ordered {
                            if *start - prev_end > 1e-9 {
                                comp.push((prev_end, *start));
                            }
                            prev_end = prev_end.max(*end);
                        }
                        if TWO_PI - prev_end > 1e-9 {
                            comp.push((prev_end, TWO_PI));
                        }
                        comp
                    };
                    if !final_arcs.is_empty() {
                        for (start, end) in final_arcs {
                            let span = end - start;
                            if start <= 1e-9 && span >= TWO_PI - 1e-9 {
                                // A full circle: emit the seam-carrying full
                                // wall (arc None). A 2pi ArcRange face would
                                // refuse on its own reprocessing (cy.arc.is_
                                // some() -> None) -- the second bore beside
                                // the first died exactly there.
                                let wall = partial_wall(cy, vlo, vhi, reverse);
                                out.push(wall);
                            } else {
                                let arc_range = crate::geom::ArcRange { start, span };
                                let wall = partial_wall_arc(cy, vlo, vhi, arc_range);
            out.push(if reverse { flip_face(&wall)? } else { wall });
                            }
                        }
                    }
                    continue;
                }
                let vm = 0.5 * (vlo + vhi);
                if let Some(arc) = &wall_arc {
                    let am = arc.start + 0.5 * arc.span;
                    let radial = add(scale(cy.e1, am.cos()), scale(cy.e2, am.sin()));
                    let p = add(add(cy.origin, scale(axis, vm)), scale(radial, cy.radius));
                    let in_other = inside_solid(other, add(p, scale(radial, sign * PROBE)));
                    let keep = if keep_inside { in_other } else { !in_other };
                    if keep {
                        let wall = partial_wall_arc(cy, vlo, vhi, arc.clone());
                        out.push(if reverse { flip_face(&wall)? } else { wall });
                    }
                    continue;
                }
                let p = add(add(cy.origin, scale(axis, vm)), scale(cy.e1, cy.radius));
                let in_other = inside_solid(other, add(p, scale(cy.e1, sign * PROBE)));
                let keep = if keep_inside { in_other } else { !in_other };
                if keep {
                    out.push(partial_wall(cy, vlo, vhi, reverse));
                }
            }
            Some(())
        }
                Surface::Torus(t) => {
            // A round-primitive rim band (a quarter torus, SPEC-brep-round).
            // Keep/drop it WHOLESALE by probing the band against `other` --
            // exact whenever the band lies entirely on one side (the Y2
            // flanged cylinder: the rim is fully outside the standing
            // cylinder). A band genuinely cut by `other` needs torus/cyl
            // arc math (W5) and still refuses: four band probes (the tube-
            // angle ends at mid-turn) must agree with the middle.
            offset_sign(op, is_a)?;
            let keep_inside = keeps_inside(op, is_a);
            let reverse = op == "subtract" && !is_a;
            let axis = normalize(t.axis);
            let (e1, e2, _) = crate::geom::frame(axis);
            // TorusSurf param (geom.rs): p(u, v) = center + (ring +
            // tube*cos v)*(cos u*e1 + sin u*e2) + tube*sin v*axis; v the
            // tube angle in t.v_range, u the full turn.
            let pt_at = |u: f64, v: f64| {
                let rho = t.ring + t.tube * v.cos();
                add(
                    t.center,
                    add(
                        scale(axis, t.tube * v.sin()),
                        add(scale(e1, rho * u.cos()), scale(e2, rho * u.sin())),
                    ),
                )
            };
            // A torus band meeting another torus: the two surfaces can cross only when the
            // centre circles come closer than the tube radii add up. Prove they cannot, or
            // refuse; the probes below cannot tell "disjoint" from "overlapping with every probe
            // outside" (G6: two overlapping rings were built as two disjoint shells, V1 + V2).
            let band_box = fb.surface.aabb();
            for f in other.faces() {
                let g = f.borrow();
                if let Surface::Torus(t2) = &g.surface {
                    if let Some(gb) = face_reach_box(&f) {
                        if !aabbs_touch(&band_box, &gb) {
                            continue;
                        }
                    }
                    if !tori_provably_apart(t, t2) {
                        return None;
                    }
                }
            }
            // The band must lie wholly on one side of `other`: probe a grid over it (every
            // interior cell centre), not four points at one tube angle.
            let mut probes: Vec<Vec3> = Vec::with_capacity(96);
            for i in 0..16 {
                for j in 0..6 {
                    let u = TWO_PI * (i as f64 + 0.5) / 16.0;
                    let v = t.v_range[0] + (t.v_range[1] - t.v_range[0]) * (j as f64 + 0.5) / 6.0;
                    probes.push(pt_at(u, v));
                }
            }
            let inside_flags: Vec<bool> = probes.iter().map(|&p| inside_solid(other, p)).collect();
            let all_same = inside_flags.iter().all(|&b| b == inside_flags[0]);
            if !all_same {
                return None;
            }
            let in_other = inside_solid(other, probes[0]);
            let keep = if keep_inside { in_other } else { !in_other };
            if keep {
            out.push(if reverse { flip_face(face)? } else { face.clone() });
            }
 Some(())
 }
 Surface::Cone(c) => {
 let sign = offset_sign(op, is_a)?;
 let keep_inside = keeps_inside(op, is_a);
 let reverse = op == "subtract" && !is_a;
 let axis = normalize(c.axis);
 let mut breaks = vec![c.v_range[0], c.v_range[1]];
 let wall_box = fb.surface.aabb();
 for f in other.faces() {
 let s = f.borrow().surface.clone();
 if let Some(fb_box) = face_reach_box(&f) {
 if !aabbs_touch(&wall_box, &fb_box) {
 continue;
 }
 }
 match &s {
 Surface::Plane(g) => {
 let an = dot(g.n, axis).abs();
 if (an - 1.0).abs() < 1e-9 {
 let along = dot(sub(g.origin, c.base), axis);
 let v = along / c.half_angle.cos();
 // A face lying strictly inside the cone's own cross-section
 // at this height (a bore's flat end) never meets the wall:
 // no break, so the wall is not split for nothing.
 let r_here = c.base_radius - along * c.half_angle.tan();
 let reach = plane_face_radial_reach(&f.borrow(), c.base, axis);
 let clear = matches!(reach, Some(rr) if rr < r_here - 1e-7);
 if !clear && v > c.v_range[0] + 1e-9 && v < c.v_range[1] - 1e-9 {
 breaks.push(v);
 }
 } else if an < 1e-9 {
 let dist = dot(sub(g.origin, c.base), g.n).abs();
 let r = c.base_radius - c.v_range[0] * c.half_angle.sin();
 if dist < r - 1e-7 {
 return None;
 }
 } else {
 return None;
 }
 }
 // A whole-turn cylinder against this cone wall (a bore): the
 // meeting curve is a circle only when the axes coincide; an
 // off-axis cylinder that never reaches the wall constrains
 // nothing; anything else is a space curve and refuses.
 Surface::Cylinder(cy2) => match cone_cyl_relation(c, cy2) {
 ConeCyl::Coaxial { v_cross } => {
 if let Some(v) = v_cross {
 if v > c.v_range[0] + 1e-9 && v < c.v_range[1] - 1e-9 {
 breaks.push(v);
 }
 }
 }
 ConeCyl::Clear => {}
 ConeCyl::Crosses => return None,
 },
 _ => return None,
 }
 }
 breaks.sort_by(|a, b| a.partial_cmp(b).unwrap());
 breaks.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
 for pair in breaks.windows(2) {
 let (vlo, vhi) = (pair[0], pair[1]);
 if vhi - vlo < 1e-9 {
 continue;
 }
 let vm = 0.5 * (vlo + vhi);
 let r = c.base_radius - vm * c.half_angle.sin();
 let rho = c.e1;
 let p = add(c.base, add(scale(rho, r), scale(axis, vm * c.half_angle.cos())));
 let dv = add(scale(rho, -c.half_angle.sin()), scale(axis, c.half_angle.cos()));
 let n = cross(scale(c.e2, r), dv);
 let len = crate::math::len(n);
 if len < 1e-12 {
 return None;
 }
 let in_other = inside_solid(other, add(p, scale(n, sign * PROBE / len)));
 let keep = if keep_inside { in_other } else { !in_other };
 if keep {
 out.push(partial_cone_wall(c, vlo, vhi, reverse, &fb.boundary));
 }
 }
 Some(())
 }
 Surface::Sphere(sp) => {
            // The only sphere-boolean case this kernel builds (SPEC pinned
            // math): a sphere with a centered, symmetric square tube of
            // planes drilled all the way through it along one of the
            // sphere's own equatorial axes. Detected from `other`'s actual
            // geometry, not assumed -- anything else refuses honestly.
            offset_sign(op, is_a)?;
            if keeps_inside(op, is_a) {
                // Not needed by any fixture yet (a sphere kept whole inside
                // another solid): refuse rather than guess.
                return None;
            }
            let other_faces = other.faces();
            let mut planes: Vec<Plane> = Vec::with_capacity(other_faces.len());
            for f in &other_faces {
                match &f.borrow().surface {
                    Surface::Plane(p) => planes.push(p.clone()),
                    _ => return None,
                }
            }
            let mut h1: Option<f64> = None;
            let mut h2: Option<f64> = None;
            for p in &planes {
                let d = dot(sub(p.origin, sp.center), p.n);
                if d.abs() >= sp.radius - 1e-9 {
                    continue; // does not reach the sphere -- not a cutting plane
                }
                let a1 = dot(p.n, sp.e1).abs();
                let a2 = dot(p.n, sp.e2).abs();
                if (a1 - 1.0).abs() < 1e-7 {
                    match h1 {
                        None => h1 = Some(d.abs()),
                        Some(v) => {
                            if (v - d.abs()).abs() > 1e-6 {
                                return None;
                            }
                        }
                    }
                } else if (a2 - 1.0).abs() < 1e-7 {
                    match h2 {
                        None => h2 = Some(d.abs()),
                        Some(v) => {
                            if (v - d.abs()).abs() > 1e-6 {
                                return None;
                            }
                        }
                    }
                } else {
                    // A cutting plane not aligned to the sphere's own frame:
                    // the general trimmed-sphere case isn't built.
                    return None;
                }
            }
            let (Some(h1), Some(h2)) = (h1, h2) else {
                return None;
            };
            if (h1 - h2).abs() > 1e-6 {
                return None; // not a square cross-section
            }
            let h = h1;
            if h <= 1e-9 || h >= sp.radius - 1e-9 {
                return None;
            }
            let mut trimmed = sp.clone();
            trimmed.trim = Some(h);
            let seam_v = topo::vertex(add(sp.center, scale(sp.e1, sp.radius)));
            let seam = topo::edge(
                seam_v.clone(),
                seam_v.clone(),
                true,
                Curve::Circle { center: sp.center, radius: sp.radius, normal: sp.axis },
            );
            let boundary = vec![
                Rc::new(RefCell::new(Wire {
                    edges: vec![
                        topo::EdgeUse {
                            edge: seam.clone(),
                            forward: true,
                            pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, std::f64::consts::PI], mid: [0.0, std::f64::consts::FRAC_PI_2] },
                        },
                        topo::EdgeUse {
                            edge: seam,
                            forward: false,
                            pcurve: topo::Pcurve { start: [TWO_PI, std::f64::consts::PI], end: [0.0, 0.0], mid: [std::f64::consts::PI, std::f64::consts::FRAC_PI_2] },
                        },
                    ],
                })),
                polar_hole_wire(sp, 1.0, h),
                polar_hole_wire(sp, -1.0, h),
            ];
            out.push(Rc::new(RefCell::new(Face {
                boundary,
                forward: true,
                surface: Surface::Sphere(trimmed),
                uv_domain: [[0.0, TWO_PI], [0.0, std::f64::consts::PI]],
            })));
            Some(())
        }
        _ => None,
    }
}

/// Drop coincident planar output faces (same plane, same area and centroid) so
/// a face that lies on both operands' boundary is not counted twice. This is
/// what makes an intersect whose operands share a side plane exact.
fn dedupe(faces: &mut Vec<TFace>) {
    let mut keep: Vec<TFace> = Vec::new();
    for f in faces.drain(..) {
        let mut dup = false;
        for g in &keep {
            if same_planar_patch(&f, g) {
                dup = true;
                break;
            }
        }
        if !dup {
            keep.push(f);
        }
    }
    *faces = keep;
}

/// A copy of a planar face with its outward normal reversed. Used when a
/// subtracted tool's face becomes a wall of the resulting cavity.
fn flip_planar(face: &TFace) -> TFace {
    let fb = face.borrow();
    if let Surface::Plane(p) = &fb.surface {
        let flipped = Plane { origin: p.origin, n: scale(p.n, -1.0), u: p.u, v: p.v };
        // Keep the ORIGINAL boundary wires, exactly as flip_face does and for
        // the same measured reason: rebuilding from a vertex ring collapses a
        // DISK cap (its wire is a single closed circle, so the ring has one
        // point) to zero area, and drop_degenerate_faces then deletes the face
        // silently -- a blind hole whose mouth is coplanar with a base face
        // lost its floor that way, with no refusal (volume off by exactly the
        // floor's divergence term). Only the surface's outward normal is
        // reversed; the wires are geometry, not orientation.
        Rc::new(RefCell::new(Face {
            boundary: fb.boundary.clone(),
            forward: fb.forward,
            surface: Surface::Plane(flipped),
            uv_domain: fb.uv_domain,
        }))
    } else {
        // Unreachable today: all 7 of this fn's call sites pass a Plane,
        // so the fall-through clone is dead. flip_face is the fail-closed
        // variant for surfaces without a reversal arm.
        face.clone()
    }
}

/// A disk-shaped planar face with outward normal `plane.n`.
fn build_circle_face(plane: &Plane, center_uv: [f64; 2], radius: f64) -> TFace {
    let center = plane.point(center_uv);
    let v = topo::vertex(add(center, scale(plane.u, radius)));
    let e = topo::edge(
        v.clone(),
        v.clone(),
        true,
        Curve::Circle { center, radius, normal: plane.n },
    );
    make_face(
        Surface::Plane(plane.clone()),
        [[0.0, 1.0], [0.0, 1.0]],
        vec![topo::EdgeUse {
            edge: e,
            forward: true,
            pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] },
        }],
    )
}

fn same_planar_patch(a: &TFace, b: &TFace) -> bool {
    let (pa, pb) = (a.borrow(), b.borrow());
    let (sa, sb) = (&pa.surface, &pb.surface);
    match (sa, sb) {
        (Surface::Plane(x), Surface::Plane(y)) => {
            if dot(x.n, y.n) < 1.0 - 1e-7 {
                return false;
            }
            if dot(sub(x.origin, y.origin), x.n).abs() > 1e-6 {
                return false;
            }
            let (aa, ca) = build::face_area_centroid(&pa);
            let (ab, cb) = build::face_area_centroid(&pb);
            (aa - ab).abs() <= 1e-6 * ab.max(1.0)
                && (0..3).all(|i| (ca[i] - cb[i]).abs() <= 1e-6 * cb[i].abs().max(1.0))
        }
        _ => false,
    }
}

/// W8: boolean of two parallel-axis cylinders whose caps are coplanar
/// (same height). The dedicated builder exists because the generic
/// face-by-face path builds each side in its own frame — a cap arc in the
/// cap plane's (u, v) samples a different point set than the wall rim it
/// borders, which the mesh gate catches as T-vertex cracks. Here every
/// wall rim AND cap arc is built in the owning cylinder's own (e1, e2)
/// frame at the arc's start angle, so a rim and the cap arc sharing one
/// world arc are the same polyline pointwise, before any welding.
///
/// Layout (subtract, a − b): a's wall keeps its outside arc, b's wall keeps
/// its inside arc flipped (via [`flip_face`]), a's caps are the LUNE
/// (a's disk minus b's), b's caps are dropped (interior). Union: both walls
/// keep their outside arcs, a's caps stay whole, b's caps become the lune.
/// Intersect: both walls keep their inside arcs, caps become the lens.
/// `None` for any configuration this does not cover (different heights,
/// non-coplanar caps, non-parallel axes) — the caller falls through to the
/// general path, which refuses honestly if it cannot build it either.
pub fn cylinder_pair_boolean(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    let Some((wa, ca_lo, ca_hi, fa_lo, fa_hi)) = cylinder_parts(a) else { return None };
    let (wb, cb_lo, cb_hi, fb_lo, fb_hi) = cylinder_parts(b)?;
    // Parallel axes, coplanar caps, matching v-ranges (equal heights).
    let axis_a = normalize(wa.axis);
    if (dot(axis_a, normalize(wb.axis)).abs() - 1.0).abs() > 1e-9 {
        return None;
    }
    for (p, q) in [(ca_lo, cb_lo), (ca_hi, cb_hi)] {
        // Coplanar caps: same HEIGHT along the axis. The centres differ by
        // the radial offset (that is the whole point of the pair), so only
        // the axial component must agree.
        if dot(sub(p, q), axis_a).abs() > 1e-7 {
            return None;
        }
    }
    if (wa.vmin - wb.vmin).abs() > 1e-9 || (wa.vmax - wb.vmax).abs() > 1e-9 {
        return None;
    }
    // The circles in the world plane of the caps, in a's own (e1, e2) frame.
    // b's frame may be rotated (both come from geom::frame, which is
    // deterministic per axis, so if the axes AGREE in direction the frames
    // agree too; opposite axes are mirrored — reject rather than re-derive,
    // the fixtures build both cylinders the same way).
    if dot(axis_a, normalize(wb.axis)) < 1.0 - 1e-9 {
        return None;
    }
    let (r1, r2) = (wa.radius, wb.radius);
    let d = sub(cb_lo, ca_lo);
    let dx = dot(d, wa.e1);
    let dy = dot(d, wa.e2);
    let dist = crate::math::len([dx, dy, 0.0]);
    let phi = dy.atan2(dx); // b's centre seen from a's centre, in a's frame
    // Disjoint / contained cases reduce to full or empty arcs.
    let (theta1, theta2) = if dist < 1e-12 {
        // concentric
        if r1 <= r2 + 1e-9 { (0.0f64, std::f64::consts::PI) } else { (std::f64::consts::PI, 0.0) }
    } else {
        let t1 = ((r1 * r1 + dist * dist - r2 * r2) / (2.0 * r1 * dist)).clamp(-1.0, 1.0).acos();
        let t2 = ((r2 * r2 + dist * dist - r1 * r1) / (2.0 * r2 * dist)).clamp(-1.0, 1.0).acos();
        (t1, t2)
    };
    let disjoint = dist >= r1 + r2 - 1e-9;
    let b_in_a = dist + r2 <= r1 + 1e-9;
    let a_in_b = dist + r1 <= r2 + 1e-9;
    // The two crossing world angles on EACH circle (a's frame for circle-a,
    // b's frame for circle-b: b's frame == a's frame given the axis check).
    let a_in = phi - theta1; // where a's rim enters b's disk
    let a_in2 = phi + theta1;
    let phi_b = (-dy).atan2(-dx); // a's centre seen from b's centre
    let b_in = phi_b - theta2;
    let b_in2 = phi_b + theta2;
    let _ = (a_in, a_in2, b_in, b_in2, disjoint, b_in_a, a_in_b, fa_lo, fa_hi, fb_lo, fb_hi);
    build_cyl_pair_result(op, &wa, ca_lo, ca_hi, &wb, cb_lo, r1, r2, dist, phi, phi_b, theta1, theta2)
}

/// The wall face and cap planes/circles of a "pure" cylinder solid: one
/// full-turn wall (arc None) plus two planar disk caps. Returns
/// (wall_cylinder, bottom_cap_center, top_cap_center, bottom_rim_edge, top_rim_edge).
/// The rim edges are reused in the output so the caps and walls share
/// handles by construction, not by welding.
#[allow(clippy::type_complexity)]
pub fn cylinder_parts(
    s: &TSolid,
) -> Option<(
    Cylinder,
    Vec3,
    Vec3,
    topo::EdgeRef<Curve3>,
    topo::EdgeRef<Curve3>,
)> {
    let faces = s.faces();
    if faces.len() != 3 {
        return None;
    }
    let mut wall: Option<Cylinder> = None;
    let mut cap_lo: Option<(Vec3, topo::EdgeRef<Curve3>)> = None;
    let mut cap_hi: Option<(Vec3, topo::EdgeRef<Curve3>)> = None;
    for f in &faces {
        let fb = f.borrow();
        match &fb.surface {
            Surface::Cylinder(cy) => {
                if cy.arc.is_some() || cy.cross.is_some() || wall.is_some() {
                    return None;
                }
                wall = Some(cy.clone());
            }
            Surface::Plane(_) => {
                let Some((center, _radius)) = circle_boundary_of_wire(&fb) else {
                    return None;
                };
                let Some(e) = single_circle_edge(&fb) else {
                    return None;
                };
                // outward normal +axis → top cap; −axis → bottom.
                // The wall is known only after the loop; classify by comparing
                // the rim centre's height along +e1 after the wall is read.
                if cap_lo.is_none() {
                    cap_lo = Some((center, e));
                } else {
                    cap_hi = Some((center, e));
                }
            }
            _ => return None,
        }
    }
    let wall = wall?;
    let (mut ca_lo, mut ea_lo) = cap_lo?;
    let (mut ca_hi, mut ea_hi) = cap_hi?;
    let axis = normalize(wall.axis);
    // Order the caps by height along the wall's axis: the wall spans
    // [vmin, vmax] from its origin, so the bottom cap sits at
    // origin + axis·vmin.
    let h_lo = dot(sub(ca_lo, wall.origin), axis);
    let h_hi = dot(sub(ca_hi, wall.origin), axis);
    if (h_lo - wall.vmin).abs() > 1e-7 || (h_hi - wall.vmax).abs() > 1e-7 {
        // Swap so cap_lo really is the vmin end (cylinder_solid builds
        // bottom-first, but do not rely on face order).
        std::mem::swap(&mut ca_lo, &mut ca_hi);
        std::mem::swap(&mut ea_lo, &mut ea_hi);
    }
    // The cap rim circles must match the wall's radius and position.
    for (cap_center, e) in [(&ca_lo, &ea_lo), (&ca_hi, &ea_hi)] {
        let _ = cap_center;
        match &e.borrow().curve {
            Curve::Circle { radius, .. } if (radius - wall.radius).abs() <= 1e-7 => {}
            _ => return None,
        }
    }
    Some((wall, ca_lo, ca_hi, ea_lo, ea_hi))
}

/// The single full-circle boundary edge of a disk planar face, if any.
fn single_circle_edge(fb: &Face<Curve3, Surface3>) -> Option<topo::EdgeRef<Curve3>> {
    let w = fb.boundary.first()?;
    let uses = w.borrow().edges.clone();
    if uses.len() != 1 {
        return None;
    }
    let is_circle = matches!(&uses[0].edge.borrow().curve, Curve::Circle { .. });
    if is_circle {
        Some(uses[0].edge.clone())
    } else {
        None
    }
}

/// `circle_boundary` without the single-wire requirement — reads the first
/// wire's circle geometry.
fn circle_boundary_of_wire(fb: &Face<Curve3, Surface3>) -> Option<(Vec3, f64)> {
    let w = fb.boundary.first()?;
    let mut found: Option<(Vec3, f64)> = None;
    for u in &w.borrow().edges {
        match &u.edge.borrow().curve {
            Curve::Circle { center, radius, .. } => found = Some((*center, *radius)),
            _ => return None,
        }
    }
    found
}

/// W3 (shell on a cylinder), open-top flush case, built directly with shared
/// edge handles — the same frame-consistency discipline as
/// [`cylinder_pair_boolean`]: the generic boolean path rebuilds rims in
/// different sample phases than the annuli's hole rings, which the mesh gate
/// catches as T-vertex cracks. Here every rim circle is ONE edge handle
/// reused by the wall piece(s) and cap(s) that border it, and `curve_points`'s
/// Circle sampling is frame-sign-robust (`frame(+axis)` and `frame(-axis)`
/// produce the same point set), so a rim shared through a flipped use still
/// samples identically on both sides.
///
/// Layout (subtract, outer `a`, inner `b`, b's top cap FLUSH with a's, b's
/// bottom strictly inside): the void spans z in [b.lo, a.hi], so the result
/// is 6 faces — a's wall split at b's bottom plane (2 pieces), b's wall
/// flipped (the void wall), a's own bottom cap (full disk, untouched), the
/// top annulus (a's top rim + b's top rim reversed), and b's bottom cap
/// flipped (the void floor). `None` for any other configuration.
pub fn cylinder_open_hollow(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    if op != "subtract" {
        return None;
    }
    let Some((wa, ca_lo, ca_hi, fa_lo, fa_hi)) = cylinder_parts(a) else { return None };
    let Some((wb, cb_lo, cb_hi, _fb_lo, fb_hi)) = cylinder_parts(b) else { return None };
    let axis = normalize(wa.axis);
    if (dot(axis, normalize(wb.axis)) - 1.0).abs() > 1e-9 {
        return None;
    }
    let off = sub(cb_lo, ca_lo);
    if crate::math::len(sub(off, scale(axis, dot(off, axis)))) > 1e-9 {
        return None; // not coaxial
    }
    if wb.radius >= wa.radius - 1e-9 {
        return None;
    }
    if crate::math::len(sub(ca_hi, cb_hi)) > 1e-7 {
        return None; // top caps not flush
    }
    let bottom_gap = dot(sub(cb_lo, ca_lo), axis);
    let height = wa.vmax - wa.vmin;
    if bottom_gap <= 1e-9 || bottom_gap >= height - 1e-9 {
        return None;
    }
    // a's original bottom cap (full disk, untouched by the void) and bottom
    // rim are reused as-is; the wall splits at the tool's bottom plane.
    let cap_bottom = a
        .faces()
        .into_iter()
        .find(|f| matches!(&f.borrow().surface, Surface::Plane(p) if dot(p.n, axis) < -1e-9))?;
    // b's bottom cap, flipped into the void's floor.
    let floor = {
        let bf = b
            .faces()
            .into_iter()
            .find(|f| matches!(&f.borrow().surface, Surface::Plane(p) if dot(p.n, axis) < -1e-9))?;
        flip_planar(&bf)
    };
    // The split rim circle at b's bottom height, in a's frame (+axis normal
    // so both wall pieces and any neighbour sample the same set).
    let rim_split_centre = add(wa.origin, scale(axis, bottom_gap));
    let rim_split = topo::edge(
        topo::vertex(add(rim_split_centre, scale(wa.e1, wa.radius))),
        topo::vertex(add(rim_split_centre, scale(wa.e1, wa.radius))),
        true,
        Curve::Circle { center: rim_split_centre, radius: wa.radius, normal: axis },
    );
    // A full-turn wall piece over [vlo, vhi] reusing the shared rim handles
    // (same wire shape as [`partial_wall`], rims supplied not built).
    let wall_piece = |vlo: f64, vhi: f64, rim_lo: &topo::EdgeRef<Curve3>, rim_hi: &topo::EdgeRef<Curve3>| -> TFace {
        let pa = add(wa.origin, scale(axis, vlo));
        let pb = add(wa.origin, scale(axis, vhi));
        let v_lo = topo::vertex(add(pa, scale(wa.e1, wa.radius)));
        let v_hi = topo::vertex(add(pb, scale(wa.e1, wa.radius)));
        let seam = topo::edge(
            v_lo.clone(),
            v_hi.clone(),
            true,
            Curve::Segment { a: v_lo.borrow().point, b: v_hi.borrow().point },
        );
        let vm = 0.5 * (vlo + vhi);
        let uses = vec![
            topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vlo], end: [0.0, vhi], mid: [0.0, vm] } },
            topo::EdgeUse { edge: rim_hi.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vhi], end: [TWO_PI, vhi], mid: [std::f64::consts::PI, vhi] } },
            topo::EdgeUse { edge: seam.clone(), forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vhi], end: [TWO_PI, vlo], mid: [TWO_PI, vm] } },
            topo::EdgeUse { edge: rim_lo.clone(), forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vlo], end: [0.0, vlo], mid: [std::f64::consts::PI, vlo] } },
        ];
        let surf = Surface::Cylinder(Cylinder {
            origin: wa.origin,
            axis: wa.axis,
            e1: wa.e1,
            e2: wa.e2,
            radius: wa.radius,
            vmin: vlo,
            vmax: vhi,
            arc: None, cross: None,
        });
        Rc::new(RefCell::new(Face {
            boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
            forward: true,
            surface: surf,
            uv_domain: [[0.0, TWO_PI], [vlo, vhi]],
        }))
    };
    let wall_lower = wall_piece(wa.vmin, bottom_gap, &fa_lo, &rim_split);
    let wall_upper = wall_piece(bottom_gap, wa.vmax, &rim_split, &fa_hi);
    // The void wall: b's wall flipped; its rim handles (fb_lo/fb_hi) stay
    // b's, which the annulus hole and the floor reuse.
    let wall_inner = flip_face(
        &b.faces()
            .into_iter()
            .find(|f| matches!(&f.borrow().surface, Surface::Cylinder(c) if c.arc.is_none() && (c.radius - wb.radius).abs() < 1e-9))?,
    )?;
    // The top annulus: outer ring = a's top rim (forward, CCW about +axis
    // as a's own cap used it), hole ring = b's top rim wound the other way.
    let annulus = |outer: &topo::EdgeRef<Curve3>, hole: &topo::EdgeRef<Curve3>, at: Vec3, normal: Vec3| -> TFace {
        let plane = Plane::new(at, normal);
        let zero = topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] };
        Rc::new(RefCell::new(Face {
            boundary: vec![
                Rc::new(RefCell::new(Wire { edges: vec![topo::EdgeUse { edge: outer.clone(), forward: true, pcurve: zero } ] })),
                Rc::new(RefCell::new(Wire { edges: vec![topo::EdgeUse { edge: hole.clone(), forward: false, pcurve: zero } ] })),
            ],
            forward: true,
            surface: Surface::Plane(plane),
            uv_domain: [[0.0, 1.0], [0.0, 1.0]],
        }))
    };
    let top = annulus(&fa_hi, &fb_hi, ca_hi, axis);
    Some(Solid {
        shells: vec![Rc::new(RefCell::new(Shell {
            faces: vec![wall_lower, wall_upper, wall_inner, cap_bottom, top, floor],
        }))],
    })
}

/// A bore straight down through a sphere's centre (`sphere` minus a plain cylinder
/// whose axis passes through the sphere's centre). The bore wall meets the sphere in
/// two CIRCLES (z = +-h, h = sqrt(R^2 - r^2)), so no new curve type is needed: the
/// sphere keeps the zone between them (a colatitude range [asin(r/R), pi - asin(r/R)])
/// and the bore wall is a plain cylinder. THROUGH: two faces. BLIND, entered from
/// one side with its flat floor strictly between the two circles: sphere with one
/// polar hole, bore wall, floor disk. Everything else (off-centre axis, r/R > 0.95,
/// a floor in a polar cap, a tool that does not clear the sphere) returns None and
/// the caller refuses in words. Closed forms (derived, not read off the kernel):
/// through V = 4/3 pi h^3; blind V = 4/3 pi R^3 - pi r^2 (h - f) - pi c^2 (3R - c) / 3,
/// c = R - h, f = the floor's height from the centre.
pub fn sphere_axial_bore(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    if op != "subtract" {
        return None;
    }
    let fa = a.faces();
    if fa.len() != 1 {
        return None;
    }
    let sp = match &fa[0].borrow().surface {
        Surface::Sphere(sp)
            if sp.trim.is_none()
                && (sp.u_range[1] - sp.u_range[0] - TWO_PI).abs() < 1e-9
                && (sp.v_range[1] - sp.v_range[0] - std::f64::consts::PI).abs() < 1e-9 =>
        {
            sp.clone()
        }
        _ => return None,
    };
    let (wall, c_lo, c_hi, _, _) = cylinder_parts(b)?;
    let (big_r, r) = (sp.radius, wall.radius);
    if r <= 1e-9 || r > 0.95 * big_r {
        return None;
    }
    let ax = normalize(wall.axis);
    // the axis must pass through the centre
    let off = sub(sp.center, wall.origin);
    if crate::math::len(sub(off, scale(ax, dot(off, ax)))) > 1e-7 {
        return None;
    }
    let h = (big_r * big_r - r * r).sqrt();
    let eps = 1e-7;
    let (t_lo, t_hi) = (dot(sub(c_lo, sp.center), ax), dot(sub(c_hi, sp.center), ax));
    // Frame with the entry on the +z side. `lo` is the floor height (None = through).
    let (z, lo): (Vec3, Option<f64>) = if t_lo < -h - eps && t_hi > h + eps {
        (ax, None)
    } else if t_hi > h + eps && t_lo > -h + eps && t_lo < h - eps {
        (ax, Some(t_lo))
    } else if t_lo < -h - eps && t_hi > -h + eps && t_hi < h - eps {
        (scale(ax, -1.0), Some(-t_hi))
    } else {
        return None;
    };
    let (e1, e2, z) = crate::geom::frame(z);
    let c = sp.center;
    let theta = (r / big_r).asin();
    let pi = std::f64::consts::PI;
    let zero = topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] };
    let circle_edge = |height: f64| {
        let centre = add(c, scale(z, height));
        let v = topo::vertex(add(centre, scale(e1, r)));
        topo::edge(v.clone(), v, true, Curve::Circle { center: centre, radius: r, normal: z })
    };
    let rim_top = circle_edge(h);
    let sphere_surface = |v0: f64, v1: f64| {
        Surface::Sphere(crate::geom::SphereSurf {
            center: c,
            radius: big_r,
            axis: z,
            e1,
            e2,
            u_range: [0.0, TWO_PI],
            v_range: [v0, v1],
            trim: None,
        })
    };
    // the sphere's meridian seam at u = 0 (colatitude measured from -z)
    let point_at = |v: f64| add(c, add(scale(e1, big_r * v.sin()), scale(z, -big_r * v.cos())));
    let meridian = |v0: f64, v1: f64| {
        let x_axis = normalize(sub(point_at(v0), c));
        topo::edge(
            topo::vertex(point_at(v0)),
            topo::vertex(point_at(v1)),
            true,
            Curve::Arc { center: c, radius: big_r, normal: scale(e2, -1.0), x_axis, sweep: v1 - v0 },
        )
    };
    let two_pi = TWO_PI;
    let use_of = |edge: &topo::EdgeRef<Curve3>, forward: bool, s: [f64; 2], e: [f64; 2], m: [f64; 2]| topo::EdgeUse {
        edge: edge.clone(),
        forward,
        pcurve: topo::Pcurve { start: s, end: e, mid: m },
    };
    // bore wall (void side: e2 negated) between heights [z0, h]; rims supplied
    let bore_wall = |z0: f64, rim_lo: &topo::EdgeRef<Curve3>| -> TFace {
        let vlo = topo::vertex(add(add(c, scale(z, z0)), scale(e1, r)));
        let vhi = topo::vertex(add(add(c, scale(z, h)), scale(e1, r)));
        let seam = topo::edge(
            vlo.clone(),
            vhi.clone(),
            true,
            Curve::Segment { a: vlo.borrow().point, b: vhi.borrow().point },
        );
        let vm = 0.5 * (z0 + h);
        let uses = vec![
            use_of(&seam, true, [0.0, z0], [0.0, h], [0.0, vm]),
            use_of(&rim_top, true, [0.0, h], [two_pi, h], [pi, h]),
            use_of(&seam, false, [two_pi, h], [two_pi, z0], [two_pi, vm]),
            use_of(rim_lo, false, [two_pi, z0], [0.0, z0], [pi, z0]),
        ];
        Rc::new(RefCell::new(Face {
            boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
            forward: true,
            surface: Surface::Cylinder(Cylinder {
                origin: c,
                axis: z,
                e1,
                e2: scale(e2, -1.0),
                radius: r,
                vmin: z0,
                vmax: h,
                arc: None,
                cross: None,
            }),
            uv_domain: [[0.0, two_pi], [z0, h]],
        }))
    };
    let faces: Vec<TFace> = match lo {
        None => {
            let rim_bot = circle_edge(-h);
            let seam = meridian(theta, pi - theta);
            let uses = vec![
                use_of(&seam, true, [0.0, theta], [0.0, pi - theta], [0.0, 0.5 * pi]),
                use_of(&rim_top, true, [0.0, pi - theta], [two_pi, pi - theta], [pi, pi - theta]),
                use_of(&seam, false, [two_pi, pi - theta], [two_pi, theta], [two_pi, 0.5 * pi]),
                use_of(&rim_bot, false, [two_pi, theta], [0.0, theta], [pi, theta]),
            ];
            let zone = Rc::new(RefCell::new(Face {
                boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
                forward: true,
                surface: sphere_surface(theta, pi - theta),
                uv_domain: [[0.0, two_pi], [theta, pi - theta]],
            }));
            vec![zone, bore_wall(-h, &rim_bot)]
        }
        Some(f) => {
            let seam = meridian(0.0, pi - theta);
            let uses = vec![
                use_of(&seam, true, [0.0, 0.0], [0.0, pi - theta], [0.0, 0.5 * (pi - theta)]),
                use_of(&rim_top, true, [0.0, pi - theta], [two_pi, pi - theta], [pi, pi - theta]),
                use_of(&seam, false, [two_pi, pi - theta], [two_pi, 0.0], [two_pi, 0.5 * (pi - theta)]),
            ];
            let outer = Rc::new(RefCell::new(Face {
                boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
                forward: true,
                surface: sphere_surface(0.0, pi - theta),
                uv_domain: [[0.0, two_pi], [0.0, pi - theta]],
            }));
            let rim_floor = circle_edge(f);
            let floor = Rc::new(RefCell::new(Face {
                boundary: vec![Rc::new(RefCell::new(Wire {
                    edges: vec![topo::EdgeUse { edge: rim_floor.clone(), forward: true, pcurve: zero }],
                }))],
                forward: true,
                surface: Surface::Plane(Plane::new(add(c, scale(z, f)), z)),
                uv_domain: [[0.0, 1.0], [0.0, 1.0]],
            }));
            vec![outer, bore_wall(f, &rim_floor), floor]
        }
    };
    Some(Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] })
}

#[allow(clippy::too_many_arguments)]
fn build_cyl_pair_result(
    op: &str,
    wa: &Cylinder,
    ca_lo: Vec3,
    ca_hi: Vec3,
    wb: &Cylinder,
    cb_lo: Vec3,
    r1: f64,
    r2: f64,
    dist: f64,
    phi: f64,
    phi_b: f64,
    theta1: f64,
    theta2: f64,
) -> Option<TSolid> {
    let axis = normalize(wa.axis);
    let (vlo, vhi) = (wa.vmin, wa.vmax);
    let cb_hi = add(cb_lo, scale(axis, vhi - vlo));
    // Only true partial overlaps are built here; disjoint/contained cases
    // fall through to the general path (identity, subtract_enclosed, refuse).
    if dist >= r1 + r2 - 1e-9 || dist + r2 <= r1 + 1e-9 || dist + r1 <= r2 + 1e-9 {
        return None;
    }
    // Crossing angles per circle, in each cylinder's own frame (the frames
    // agree because the axes agree in direction and geom::frame is
    // deterministic per axis).
    let (a_in0, a_in1) = (phi - theta1, phi + theta1);
    let (b_in0, b_in1) = (phi_b - theta2, phi_b + theta2);
    let at = |c: &Cylinder, centre: Vec3, ang: f64| -> Vec3 {
        add(centre, add(scale(c.e1, c.radius * ang.cos()), scale(c.e2, c.radius * ang.sin())))
    };
    // The four world crossing points per cap: on a's rim (Pa_lo/Pa_hi at
    // angles a_in0/a_in1) and on b's rim (Pb_lo/Pb_hi at b_in0/b_in1). The
    // pair (Pa, Pb) at the same cap coincide (the circles' intersection),
    // so a's rim vertex and b's rim vertex are the same world point.
    let pa_lo0 = at(wa, ca_lo, a_in0);
    let pa_lo1 = at(wa, ca_lo, a_in1);
    let pa_hi0 = at(wa, ca_hi, a_in0);
    let pa_hi1 = at(wa, ca_hi, a_in1);
    let pb_lo0 = at(wb, cb_lo, b_in0);
    let pb_lo1 = at(wb, cb_lo, b_in1);
    let pb_hi0 = at(wb, cb_hi, b_in0);
    let pb_hi1 = at(wb, cb_hi, b_in1);

    // --- Edges. Rim arcs are built ONCE per (circle, cap, world arc) in the
    // owning cylinder's own frame (x_axis at the arc's start, normal +axis),
    // and are SHARED by the wall and the cap via the same handle — the
    // frame-consistency that makes the mesh watertight without relying on
    // the geometric welder.
    let arc_edge = |centre: Vec3, e1: Vec3, e2: Vec3, radius: f64, start: f64, sweep: f64| -> topo::EdgeRef<Curve3> {
        topo::edge(
            topo::vertex(add(centre, add(scale(e1, radius * start.cos()), scale(e2, radius * start.sin())))),
            topo::vertex(add(centre, add(scale(e1, radius * (start + sweep).cos()), scale(e2, radius * (start + sweep).sin())))),
            true,
            Curve::Arc {
                center: centre,
                radius,
                normal: axis,
                x_axis: add(scale(e1, start.cos()), scale(e2, start.sin())),
                sweep,
            },
        )
    };
    // Ruling seams between the two crossing points at each crossing angle.
    let seam_edge = |centre_lo: Vec3, e1: Vec3, e2: Vec3, radius: f64, ang: f64| -> topo::EdgeRef<Curve3> {
        let pa = add(centre_lo, add(scale(e1, radius * ang.cos()), scale(e2, radius * ang.sin())));
        let pb = add(pa, scale(axis, vhi - vlo));
        topo::edge(topo::vertex(pa), topo::vertex(pb), true, Curve::Segment { a: pa, b: pb })
    };

    // a's rim arcs: inside arc traversed a_in0 -> a_in1 (x_axis at a_in0,
    // sweep +2·theta1); outside arc traversed a_in1 -> a_in0 the long way
    // (x_axis at a_in1, sweep −(2π−2·theta1)). Same for b.
    let a_in_sweep = 2.0 * theta1;
    let a_out_sweep = TWO_PI - 2.0 * theta1;
    let b_in_sweep = 2.0 * theta2;
    let b_out_sweep = TWO_PI - 2.0 * theta2;
    // Per circle, per cap: (inside_arc, outside_arc). The rim edges are the
    // SAME handles the walls and caps both use.
    let e_a_in_lo = arc_edge(ca_lo, wa.e1, wa.e2, r1, a_in0, a_in_sweep);
    let e_a_in_hi = arc_edge(ca_hi, wa.e1, wa.e2, r1, a_in0, a_in_sweep);
    let e_a_out_lo = arc_edge(ca_lo, wa.e1, wa.e2, r1, a_in1, a_out_sweep);
    let e_a_out_hi = arc_edge(ca_hi, wa.e1, wa.e2, r1, a_in1, a_out_sweep);
    let e_b_in_lo = arc_edge(cb_lo, wb.e1, wb.e2, r2, b_in0, b_in_sweep);
    let e_b_in_hi = arc_edge(cb_hi, wb.e1, wb.e2, r2, b_in0, b_in_sweep);
    let e_b_out_lo = arc_edge(cb_lo, wb.e1, wb.e2, r2, b_in1, b_out_sweep);
    let e_b_out_hi = arc_edge(cb_hi, wb.e1, wb.e2, r2, b_in1, b_out_sweep);
    let e_seam_a0 = seam_edge(ca_lo, wa.e1, wa.e2, r1, a_in0);
    let e_seam_a1 = seam_edge(ca_lo, wa.e1, wa.e2, r1, a_in1);
    let e_seam_b0 = seam_edge(cb_lo, wb.e1, wb.e2, r2, b_in0);
    let e_seam_b1 = seam_edge(cb_lo, wb.e1, wb.e2, r2, b_in1);

    // --- Walls. partial-wall surface + 4 uses, referencing the SHARED rim
    // edges. The pcurves live in the cylinder's own (angle, v) space.
    // Built UNREVERSED: a tool-side wall (subtract's b) is reversed by
    // [`flip_face`] at the call site, which negates e2 and reflects the arc
    // range while keeping the boundary wires and their shared handles.
    let wall = |c: &Cylinder, centre_lo: Vec3, e_seam0: &topo::EdgeRef<Curve3>, e_seam1: &topo::EdgeRef<Curve3>, e_rim_lo: topo::EdgeRef<Curve3>, e_rim_hi: topo::EdgeRef<Curve3>, start: f64, sweep: f64| -> TFace {
        let vm = 0.5 * (vlo + vhi);
        let (s0, s1) = (start, start + sweep);
        let uses = vec![
            topo::EdgeUse { edge: e_seam0.clone(), forward: true, pcurve: topo::Pcurve { start: [s0, vlo], end: [s0, vhi], mid: [s0, vm] } },
            topo::EdgeUse { edge: e_rim_hi.clone(), forward: true, pcurve: topo::Pcurve { start: [s0, vhi], end: [s1, vhi], mid: [0.5 * (s0 + s1), vhi] } },
            topo::EdgeUse { edge: e_seam1.clone(), forward: true, pcurve: topo::Pcurve { start: [s1, vhi], end: [s1, vlo], mid: [s1, vm] } },
            topo::EdgeUse { edge: e_rim_lo.clone(), forward: false, pcurve: topo::Pcurve { start: [s1, vlo], end: [s0, vlo], mid: [0.5 * (s0 + s1), vlo] } },
        ];
        let surf = Surface::Cylinder(Cylinder {
            origin: centre_lo,
            axis: c.axis,
            e1: c.e1,
            e2: c.e2,
            radius: c.radius,
            vmin: vlo,
            vmax: vhi,
            arc: Some(crate::geom::ArcRange { start, span: sweep }), cross: None,
        });
        Rc::new(RefCell::new(Face {
            boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
            forward: true,
            surface: surf,
            uv_domain: [[s0, s1], [vlo, vhi]],
        }))
    };

    // --- Caps. A cap is a two-arc loop reusing the shared rim edges.
    // Circle-a's lune (a's disk minus b's): a's outside arc + b's outside
    // arc traversed back. The lens: a's inside arc + b's inside arc back.
    // `flip` inverts the outward normal (a tool-side cap in a subtract).
    let two_arc_cap = |centre: Vec3, normal: Vec3, e_outer: topo::EdgeRef<Curve3>, fwd_outer: bool, e_inner: topo::EdgeRef<Curve3>, fwd_inner: bool| -> TFace {
        let plane = Plane::new(centre, normal);
        let mk = |e: &topo::EdgeRef<Curve3>, fwd: bool| {
            let eb = e.borrow();
            let pa = if fwd { eb.a.borrow().point } else { eb.b.borrow().point };
            let pb = if fwd { eb.b.borrow().point } else { eb.a.borrow().point };
            topo::EdgeUse {
                edge: e.clone(),
                forward: fwd,
                pcurve: topo::Pcurve { start: plane.project(pa), end: plane.project(pb), mid: plane.project(scale(add(pa, pb), 0.5)) },
            }
        };
        Rc::new(RefCell::new(Face {
            boundary: vec![Rc::new(RefCell::new(Wire { edges: vec![mk(&e_outer, fwd_outer), mk(&e_inner, fwd_inner)] }))],
            forward: true,
            surface: Surface::Plane(plane),
            uv_domain: [[0.0, 1.0], [0.0, 1.0]],
        }))
    };

    let n_top = axis;
    let n_bot = scale(axis, -1.0);
    let faces: Vec<TFace> = match op {
        "subtract" => {
            // a's wall outside arc, b's wall inside arc flipped. a's caps
            // = lune (a outside b); b's caps dropped (interior).
            let wall_a = wall(wa, ca_lo, &e_seam_a1, &e_seam_a0, e_a_out_lo.clone(), e_a_out_hi.clone(), a_in1, a_out_sweep);
            let wall_b = wall(wb, cb_lo, &e_seam_b0, &e_seam_b1, e_b_in_lo.clone(), e_b_in_hi.clone(), b_in0, b_in_sweep);
            // a's caps = the LUNE: a's outside arc (a_in1 -> a_in0 the far
            // way) chained with b's INSIDE arc traversed backwards
            // (b_in1 -> b_in0), since the removed lens region is bounded by
            // b's inside rim.
            let cap_a_lo = two_arc_cap(ca_lo, n_bot, e_a_out_lo.clone(), true, e_b_in_lo.clone(), false);
            let cap_a_hi = two_arc_cap(ca_hi, n_top, e_a_out_hi.clone(), true, e_b_in_hi.clone(), false);
    vec![wall_a, flip_face(&wall_b)?, cap_a_lo, cap_a_hi]
        }
        "union" => {
            // Both walls keep their outside arcs. Each cap is ONE face: the
            // outer boundary of the union of the two disks — a's outside arc
            // (a_in1 -> a_in0 the far way) chained with b's outside arc
            // (b_in1 -> b_in0 the far way), which share the crossing points.
            // A full disk + a separate lune would double-cover the lens
            // region with two coplanar faces (non-manifold, cracked mesh).
            let cap_lo = two_arc_cap(ca_lo, n_bot, e_a_out_lo.clone(), true, e_b_out_lo.clone(), true);
            let cap_hi = two_arc_cap(ca_hi, n_top, e_a_out_hi.clone(), true, e_b_out_hi.clone(), true);
            let wall_a = wall(wa, ca_lo, &e_seam_a1, &e_seam_a0, e_a_out_lo.clone(), e_a_out_hi.clone(), a_in1, a_out_sweep);
            let wall_b = wall(wb, cb_lo, &e_seam_b1, &e_seam_b0, e_b_out_lo.clone(), e_b_out_hi.clone(), b_in1, b_out_sweep);
            vec![wall_a, wall_b, cap_lo, cap_hi]
        }
        "intersect" => {
            // Both walls keep their inside arcs (outward normals); caps = lens.
            let wall_a = wall(wa, ca_lo, &e_seam_a0, &e_seam_a1, e_a_in_lo.clone(), e_a_in_hi.clone(), a_in0, a_in_sweep);
            let wall_b = wall(wb, cb_lo, &e_seam_b0, &e_seam_b1, e_b_in_lo.clone(), e_b_in_hi.clone(), b_in0, b_in_sweep);
            let cap_lo = two_arc_cap(ca_lo, n_bot, e_a_in_lo.clone(), true, e_b_in_lo.clone(), true);
            let cap_hi = two_arc_cap(ca_hi, n_top, e_a_in_hi.clone(), true, e_b_in_hi.clone(), true);
            vec![wall_a, wall_b, cap_lo, cap_hi]
        }
        _ => return None,
    };
    let _ = (n_bot, n_top, at, pa_lo0, pa_lo1, pa_hi0, pa_hi1, pb_lo0, pb_lo1, pb_hi0, pb_hi1, e_seam_a1, e_seam_b1, e_seam_b0, e_seam_a0);
    Some(Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] })
}

/// Largest tool-to-part radius ratio the cross bore builds. Past this the two
/// surfaces are nearly tangent, the meeting curve's tips pinch toward the
/// part's silhouette, and the exact quadrature stops being worth trusting.
const CROSS_BORE_MAX_RATIO: f64 = 0.95;

/// What a cross bore through a plain cylinder removes, by an INDEPENDENT
/// route: with y = r sin(th) the removed volume is
/// `integral of 2 r^2 cos^2(th) * x_extent(th) d th`, `x_extent` being
/// `2 sqrt(R^2 - y^2)` for a through bore and `sqrt(R^2 - y^2) - floor` for a
/// blind one (the elliptic integral of SPEC-transverse-bore.md). The result's
/// own faces are measured by surface integrals; this is the cross-check that
/// keeps a wrong solid from shipping.
fn cross_bore_removed_volume(big_r: f64, r: f64, floor: Option<f64>) -> f64 {
    let half = std::f64::consts::FRAC_PI_2;
    crate::geom::integrate_composite(-half, half, 96, |th| {
        let y = r * th.sin();
        let f = (big_r * big_r - y * y).max(0.0).sqrt();
        let ext = match floor {
            None => 2.0 * f,
            Some(x0) => f - x0,
        };
        2.0 * r * r * th.cos() * th.cos() * ext
    })
}

/// A bore that runs straight across a plain cylinder and through its axis
/// (docs/specs/SPEC-transverse-bore.md): a plain cylinder tool, its axis
/// perpendicular to the part's and meeting it, radius `r` with `r / R` at most
/// [`CROSS_BORE_MAX_RATIO`]. Either a THROUGH bore (the tool's ends are clear
/// of the wall on both sides) or a BLIND one (clear on one side, a flat floor
/// strictly inside the part on the other). The two cylinders meet in the closed
/// space curve `Curve::CylCyl`; the result is the part's wall pierced by one or
/// two holes, the bore's own wall (bounded by the curve), the two caps and, for
/// a blind bore, the floor -- every face an analytic surface, trimmed exactly.
///
/// `None` for anything else (off-centre, skew, a bore through a cap or ending
/// in the wall, a tangent or near-tangent bore, a part that is not a plain
/// cylinder): the caller refuses in a sentence.
pub fn cylinder_cross_bore(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    if op != "subtract" {
        return None;
    }
    let (wall, _, _, _, _) = cylinder_parts(a)?;
    let (tool, tb_lo, tb_hi, _, _) = cylinder_parts(b)?;
    let av = normalize(wall.axis);
    let dv = normalize(tool.axis);
    if dot(av, dv).abs() > 1e-9 {
        return None;
    }
    let (big_r, r) = (wall.radius, tool.radius);
    if !(r > 1e-6 * big_r) || r > big_r * CROSS_BORE_MAX_RATIO {
        return None;
    }
    // The tool's axis must meet the part's: coplanar, and (being perpendicular)
    // that is enough for them to cross.
    let delta = sub(tool.origin, wall.origin);
    let n0 = normalize(cross(av, dv));
    let scale_len = big_r.max(1.0);
    if dot(delta, n0).abs() > 1e-9 * scale_len {
        return None;
    }
    let c_v = dot(delta, av);
    let p0 = add(wall.origin, scale(av, c_v));
    let xa = dot(sub(tb_lo, p0), dv);
    let xb = dot(sub(tb_hi, p0), dv);
    let (xl, xh) = (xa.min(xb), xa.max(xb));
    let s0 = (big_r * big_r - r * r).sqrt();
    let m = 1e-6 * big_r;
    let tol = 1e-9 * scale_len;
    // Through, or blind entering at +d, or blind entering at -d (then turn the
    // bore round so it always enters at +d).
    let (flip, floor): (f64, Option<f64>) = if xh >= big_r - tol && xl <= -big_r + tol {
        (1.0, None)
    } else if xh >= big_r - tol && xl > -s0 + m && xl < s0 - m {
        (1.0, Some(xl))
    } else if xl <= -big_r + tol && xh < s0 - m && xh > -s0 + m {
        (-1.0, Some(-xh))
    } else {
        return None;
    };
    // The bore must stay clear of both caps (it would otherwise break through
    // them, a different shape).
    if !(c_v - r > wall.vmin + m && c_v + r < wall.vmax - m) {
        return None;
    }
    let d = scale(dv, flip);
    let n = normalize(cross(av, d));
    let through = floor.is_none();

    // --- vertices and edges -------------------------------------------------
    let seg = |p: Vec3, q: Vec3| Curve::Segment { a: p, b: q };
    let curve = |sign: f64| Curve::CylCyl { center: p0, d, n, a: av, big_r, r, sign };
    let tip_p = curve(1.0).point_at(0.0);
    let v_tp = topo::vertex(tip_p);
    let loop_p = topo::edge(v_tp.clone(), v_tp.clone(), true, curve(1.0));
    let tau = 2.0 * std::f64::consts::PI;

    let lo_c = add(wall.origin, scale(av, wall.vmin));
    let hi_c = add(wall.origin, scale(av, wall.vmax));
    let rim = |c: Vec3| Curve::Arc { center: c, radius: big_r, normal: av, x_axis: n, sweep: tau };
    let v_rb = topo::vertex(add(lo_c, scale(n, big_r)));
    let v_rt = topo::vertex(add(hi_c, scale(n, big_r)));
    let rim_lo = topo::edge(v_rb.clone(), v_rb.clone(), true, rim(lo_c));
    let rim_hi = topo::edge(v_rt.clone(), v_rt.clone(), true, rim(hi_c));
    let seam_w = topo::edge(v_rb.clone(), v_rt.clone(), true, seg(v_rb.borrow().point, v_rt.borrow().point));

    let z = topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] };
    let us = |e: &topo::EdgeRef<Curve3>, forward: bool| topo::EdgeUse { edge: e.clone(), forward, pcurve: z };
    let wire = |uses: Vec<topo::EdgeUse<Curve3>>| Rc::new(RefCell::new(Wire { edges: uses }));
    let face = |boundary: Vec<topo::WireRef<Curve3>>, surface: Surface| -> TFace {
        Rc::new(RefCell::new(Face { boundary, forward: true, surface, uv_domain: [[0.0, tau], [0.0, 1.0]] }))
    };

    // --- caps ---------------------------------------------------------------
    let top = face(vec![wire(vec![us(&rim_hi, true)])], Surface::Plane(Plane::new(v_rt.borrow().point, av)));
    let bottom = face(vec![wire(vec![us(&rim_lo, true)])], Surface::Plane(Plane::new(v_rb.borrow().point, scale(av, -1.0))));

    // --- the part's pierced wall -------------------------------------------
    let mut wall_wires = vec![wire(vec![us(&seam_w, true), us(&rim_hi, true), us(&seam_w, false), us(&rim_lo, false)])];
    wall_wires.push(wire(vec![us(&loop_p, false)]));
    let mut faces: Vec<TFace> = vec![top, bottom];

    // --- the bore's own wall (and floor) -----------------------------------
    let mut tool_uses: Vec<topo::EdgeUse<Curve3>> = Vec::new();
    let mut extra: Option<TFace> = None;
    let (lo_b, hi_b);
    if through {
        let tip_m = curve(-1.0).point_at(0.0);
        let v_tm = topo::vertex(tip_m);
        let loop_m = topo::edge(v_tm.clone(), v_tm.clone(), true, curve(-1.0));
        let seam_t = topo::edge(v_tm.clone(), v_tp.clone(), true, seg(tip_m, tip_p));
        wall_wires.push(wire(vec![us(&loop_m, false)]));
        tool_uses = vec![us(&loop_p, true), us(&seam_t, false), us(&loop_m, false), us(&seam_t, true)];
        lo_b = None;
        hi_b = None;
    } else {
        let x0 = floor.unwrap();
        let fc = add(p0, scale(d, x0));
        let v_f = topo::vertex(add(fc, scale(n, r)));
        let floor_arc = topo::edge(v_f.clone(), v_f.clone(), true, Curve::Arc { center: fc, radius: r, normal: d, x_axis: n, sweep: tau });
        let seam_t = topo::edge(v_f.clone(), v_tp.clone(), true, seg(v_f.borrow().point, tip_p));
        tool_uses = vec![us(&loop_p, true), us(&seam_t, false), us(&floor_arc, true), us(&seam_t, true)];
        extra = Some(face(vec![wire(vec![us(&floor_arc, true)])], Surface::Plane(Plane::new(v_f.borrow().point, d))));
        lo_b = Some(x0);
        hi_b = None;
    }
    let wall_face = face(
        wall_wires,
        Surface::Cylinder(Cylinder {
            origin: wall.origin,
            axis: av,
            e1: n,
            e2: scale(d, -1.0),
            radius: big_r,
            vmin: wall.vmin,
            vmax: wall.vmax,
            arc: None,
            cross: Some(crate::geom::Cross::Wall { r, c_v, plus: true, minus: through }),
        }),
    );
    let tool_face = face(
        vec![wire(tool_uses)],
        Surface::Cylinder(Cylinder {
            origin: p0,
            axis: d,
            e1: n,
            e2: scale(av, -1.0),
            radius: r,
            vmin: lo_b.unwrap_or(-big_r),
            vmax: big_r,
            arc: None,
            cross: Some(crate::geom::Cross::Tool { big_r, lo: lo_b, hi: hi_b, lo_sign: -1.0, hi_sign: 1.0 }),
        }),
    );
    faces.push(wall_face);
    faces.push(tool_face);
    if let Some(f) = extra {
        faces.push(f);
    }
    let result = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };

    // The safety net. The result's faces are measured by surface integrals; the
    // removed volume has a closed one-dimensional form. They must agree, or this
    // is a wrong solid and the bore refuses.
    let want = cross_bore_removed_volume(big_r, r, floor);
    let got = build::solid_volume(a) - build::solid_volume(&result);
    if !got.is_finite() || (got - want).abs() > 1e-10 * build::solid_volume(a).max(1.0) {
        return None;
    }
    Some(result)
}

/// True when any face of `s` carries a cross-bore trim (`geom::Cross`). Such a
/// solid is only ever the RESULT of [`cylinder_cross_bore`]: the generic face
/// machinery would treat its faces as whole cylinders and return a wrong solid,
/// so every other boolean refuses it.
pub fn has_cross_trim(s: &TSolid) -> bool {
    s.faces().iter().any(|f| matches!(&f.borrow().surface, Surface::Cylinder(c) if c.cross.is_some()))
}

/// Boolean two solids of the `combine` kind. Returns None when the kernel
/// cannot build the exact result, so the caller refuses the feature in words.



/// Debug text split into its skeleton (names, punctuation, enum variants) and the numbers in it.
/// Two values are "the same to `tol`" when the skeletons are equal and every number agrees.
fn debug_numbers(s: &str) -> (String, Vec<f64>) {
    let b = s.as_bytes();
    let (mut skel, mut nums) = (String::new(), Vec::new());
    let mut i = 0;
    while i < b.len() {
        let starts = b[i].is_ascii_digit() || (b[i] == b'-' && i + 1 < b.len() && b[i + 1].is_ascii_digit());
        // a digit that belongs to an identifier (e1, e2) is part of the skeleton, not a number
        let in_ident = i > 0 && (b[i - 1].is_ascii_alphabetic() || b[i - 1] == b'_') && b[i].is_ascii_digit();
        if starts && !in_ident {
            let st = i;
            if b[i] == b'-' {
                i += 1;
            }
            while i < b.len() && (b[i].is_ascii_digit() || b[i] == b'.') {
                i += 1;
            }
            if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
                let mut j = i + 1;
                if j < b.len() && (b[j] == b'-' || b[j] == b'+') {
                    j += 1;
                }
                if j < b.len() && b[j].is_ascii_digit() {
                    while j < b.len() && b[j].is_ascii_digit() {
                        j += 1;
                    }
                    i = j;
                }
            }
            nums.push(s[st..i].parse::<f64>().unwrap_or(f64::NAN));
            skel.push('#');
        } else {
            skel.push(b[i] as char);
            i += 1;
        }
    }
    (skel, nums)
}

fn debug_same<T: std::fmt::Debug>(a: &T, b: &T, tol: f64) -> bool {
    let (sa, na) = debug_numbers(&format!("{a:?}"));
    let (sb, nb) = debug_numbers(&format!("{b:?}"));
    sa == sb
        && na.len() == nb.len()
        && na.iter().zip(&nb).all(|(x, y)| x.is_finite() && y.is_finite() && (x - y).abs() <= tol * x.abs().max(y.abs()).max(1.0))
}

/// True only when `a` and `b` are PROVABLY the same solid: the same surfaces (kind, parameters, trims,
/// orientation), the same boundary edges (curve and endpoints) on every face, every number equal to
/// 1e-9. Volume is never consulted. A match is a bijection of faces, so the check is conservative: any
/// difference at all, or any doubt, says false.
pub(crate) fn solids_identical(a: &TSolid, b: &TSolid) -> bool {
    const TOL: f64 = 1e-9;
    let (fa, fb) = (a.faces(), b.faces());
    if fa.is_empty() || fa.len() != fb.len() || a.shells.len() != b.shells.len() {
        return false;
    }
    let (ba, bb) = (build::solid_aabb(a), build::solid_aabb(b));
    if !(0..3).all(|i| (ba.lo[i] - bb.lo[i]).abs() <= 1e-6 && (ba.hi[i] - bb.hi[i]).abs() <= 1e-6) {
        return false;
    }
    let edge_same = |x: &topo::EdgeUse<Curve3>, y: &topo::EdgeUse<Curve3>| {
        let (ex, ey) = (x.edge.borrow(), y.edge.borrow());
        x.forward == y.forward
            && ex.forward == ey.forward
            && debug_same(&ex.curve, &ey.curve, TOL)
            && debug_same(&ex.a.borrow().point, &ey.a.borrow().point, TOL)
            && debug_same(&ex.b.borrow().point, &ey.b.borrow().point, TOL)
    };
    let wire_same = |x: &topo::WireRef<Curve3>, y: &topo::WireRef<Curve3>| {
        let (wx, wy) = (x.borrow(), y.borrow());
        if wx.edges.len() != wy.edges.len() {
            return false;
        }
        let mut used = vec![false; wy.edges.len()];
        wx.edges.iter().all(|ux| match (0..wy.edges.len()).find(|&k| !used[k] && edge_same(ux, &wy.edges[k])) {
            Some(k) => {
                used[k] = true;
                true
            }
            None => false,
        })
    };
    let face_same = |x: &TFace, y: &TFace| {
        let (px, py) = (x.borrow(), y.borrow());
        if px.forward != py.forward
            || px.boundary.len() != py.boundary.len()
            || !debug_same(&px.surface, &py.surface, TOL)
            || !debug_same(&px.uv_domain, &py.uv_domain, TOL)
        {
            return false;
        }
        let mut used = vec![false; py.boundary.len()];
        px.boundary.iter().all(|wx| match (0..py.boundary.len()).find(|&k| !used[k] && wire_same(wx, &py.boundary[k])) {
            Some(k) => {
                used[k] = true;
                true
            }
            None => false,
        })
    };
    let mut used = vec![false; fb.len()];
    fa.iter().all(|x| match (0..fb.len()).find(|&k| !used[k] && face_same(x, &fb[k])) {
        Some(k) => {
            used[k] = true;
            true
        }
        None => false,
    })
}

/// The boolean entry point. The face-by-face path runs first, exactly as
/// before; only when it refuses does the planar split-and-classify path
/// (`ops_planar`, SPEC-brep-boolean-split-classify S1) get a turn, so nothing
/// that built before can change. A refusal from the planar path is final.
pub fn boolean(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    let r = boolean_unchecked(op, a, b)?;
    // An operand with an inner shell (a hollow part, a sealed cavity) is the one case the per-face
    // probes of `boolean_result_is_sound` cannot vouch for: a handful of samples on the planar faces
    // can all miss the thin overlap of two walls, and the result then comes back as one operand
    // unchanged (cut of one hollow box by another overlapping it: V(A) instead of V(A) - V(A*B),
    // 10.2% off; the union of three hollow boxes in a row: 3.3% off; both found by the S4 integration
    // sweep, present before S4). So such a result must also satisfy inclusion-exclusion with its
    // partner operation, V(A+B) + V(A*B) = V(A) + V(B) and V(A-B) + V(A*B) = V(A), to 1e-9; if the
    // partner cannot be built the answer cannot be vouched for and is refused.
    if (needs_partner(a) || needs_partner(b)) && !PARTNER_RUNNING.with(|p| p.get()) {
        PARTNER_RUNNING.with(|p| p.set(true));
        let partner = boolean_unchecked(if op == "intersect" { "union" } else { "intersect" }, a, b);
        PARTNER_RUNNING.with(|p| p.set(false));
        // No partner is not a verdict: an empty intersection (a tool wholly inside a cavity) comes back as None too.
        if let Some(p) = partner {
            let (va, vb, vr, vp) = (build::solid_volume(a), build::solid_volume(b), build::solid_volume(&r), build::solid_volume(&p));
            let want = if op == "subtract" { va } else { va + vb };
            if (vr + vp - want).abs() > 1e-9 * want.abs().max(1.0) {
                return None;
            }
        }
    }
    Some(r)
}

/// Whether a boolean on `s` needs its partner operation as a check: it has an inner shell, or it is a
/// polyhedron that is not convex (an open cup, a pocketed block, an L). The face-by-face path reads
/// the other operand as an intersection of half-spaces, which is only true while it is convex, and the
/// per-face probes of `boolean_result_is_sound` can miss a thin overlap (an open hollow box cut by
/// another: V(A) returned, 7.7% high). Parts with a curved face are left to the older guards.
fn needs_partner(s: &TSolid) -> bool {
    if s.shells.len() > 1 {
        return true;
    }
    let faces = s.faces();
    let mut planes: Vec<(Vec3, Vec3)> = Vec::new();
    let mut pts: Vec<Vec3> = Vec::new();
    for f in &faces {
        let fb = f.borrow();
        let Surface::Plane(p) = &fb.surface else { return false };
        let n = if fb.forward { normalize(p.n) } else { scale(normalize(p.n), -1.0) };
        planes.push((p.origin, n));
        for w in &fb.boundary {
            for u in &w.borrow().edges {
                pts.push(u.edge.borrow().a.borrow().point);
            }
        }
    }
    let scale_len = pts.iter().fold(1.0_f64, |m, p| m.max(crate::math::len(*p)));
    planes.iter().any(|(o, n)| pts.iter().any(|p| dot(sub(*p, *o), *n) > 1e-7 * scale_len))
}

thread_local! {
    /// Set while `boolean` builds the partner operation of a multi-shell result, so the partner is not itself partnered.
    static PARTNER_RUNNING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn boolean_unchecked(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    // The same solid twice: union and intersection are that solid, proven by geometry (never by
    // volume); the difference is empty, which is no solid at all.
    if solids_identical(a, b) {
        return match op {
            "union" | "intersect" => Some(build::transform_solid(a, &crate::math::Transform::identity())),
            _ => None,
        };
    }
    if let Some(r) = boolean_legacy(op, a, b) {
        // The face-by-face path splits a face along the other solid's edges without splitting
        // the face next door, leaving a vertex in the middle of a neighbour's edge (a T-junction):
        // the volume is right but a mesh of it has open seams (measured: 78% of overlapping box
        // pairs). The planar path keeps both sides consistent, so it wins when it can build it;
        // when it cannot, the open result is refused.
        let open = crate::ops_planar::has_t_junction(&r) || !mesh_is_closed_coarse(&r);
        if open {
            if let crate::ops_planar::Outcome::Built(p) = crate::ops_planar::boolean_planar(op, a, b) {
                if !crate::ops_planar::has_t_junction(&p) && mesh_is_closed_coarse(&p) {
                    return Some(p);
                }
            }
            // Right volume, but a mesh of it may have open seams (an STL would break) and the
            // planar path cannot build a seam-free one: measure the mesh, and refuse rather than
            // hand back an open solid.
            if !mesh_is_closed_coarse(&r) {
                return None;
            }
        }
        return Some(r);
    }
    match crate::ops_planar::boolean_planar(op, a, b) {
        crate::ops_planar::Outcome::Built(r) => mesh_is_closed_coarse(&r).then_some(r),
        _ => None,
    }
}

/// Whether a mesh of the solid is closed at any of a few chord tolerances (0.3, 0.1 and 0.03
/// percent of its size). An open mesh at every one of them is a real open seam, not a
/// tolerance artefact, and an STL of it would break.
fn mesh_is_closed_coarse(s: &TSolid) -> bool {
    let bb = build::solid_aabb(s);
    let diag = crate::math::len(sub(bb.hi, bb.lo));
    [0.003, 0.001, 0.0003].iter().any(|k| match crate::mesh::mesh_solid(s, (k * diag).max(0.005)) {
        Some(m) => crate::mesh::mesh_is_closed(&m),
        None => false,
    })
}

fn boolean_legacy(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
 if has_cross_trim(a) || has_cross_trim(b) {
 return None;
 }
 if let Some(r) = cylinder_cross_bore(op, a, b) {
 return volume_is_translation_invariant(&r).then_some(r);
 }
 if let Some(r) = sphere_axial_bore(op, a, b) {
 return (volume_is_translation_invariant(&r) && boolean_result_is_sound(op, a, b, &r)).then_some(r);
 }
 if op == "subtract" {
 if let Some(cavity) = subtract_enclosed(a, b) {
 return volume_is_translation_invariant(&cavity).then_some(cavity);
 }
 }
 if let Some(r) = cylinder_pair_boolean(op, a, b) {
 return volume_is_translation_invariant(&r).then_some(r);
 }
 if let Some(r) = cylinder_open_hollow(op, a, b) {
 return volume_is_translation_invariant(&r).then_some(r);
    }
    let mut faces: Vec<TFace> = Vec::new();
    for f in a.faces() {
        process_face(&f, b, op, true, &mut faces)?;
    }
    for f in b.faces() {
        process_face(&f, a, op, false, &mut faces)?;
    }
    dedupe(&mut faces);
    drop_degenerate_faces(&mut faces);
    split_t_junctions(&mut faces);
    weld_shared_edges(&mut faces);
    if faces.is_empty() {
        return None;
    }
    // SPEC 4.5's own guard: the result's boundary must be a CLOSED 2-
    // manifold — every edge shared by exactly two face uses. A boolean
    // whose caps did not merge (an interior face left behind) cracks the
    // shell; shipping it would be the wrong-solid class outright, so
    // refuse honestly instead.
    {
        // A zero-length seam/rim edge (a closed circle's own seam,
        // both uses in one wire) is legitimately used twice by one
        // face — the count is per-use, so a legal closed rim reads
        // 2, a seam reads 1 per face but totals 2 across both its
        // wires. Anything else is a cracked shell.
        //
        // A count outside {1, 2} is a cracked or over-shared shell. A count
        // of 1 is legal only for a closed curve whose geometric twin is also
        // used once (a seam the weld did not merge): `unmatched_once_edges`
        // returns whatever has no twin, which is an open rim (G1).
        if edge_use_counts(&faces).values().any(|&n| n != 1 && n != 2) {
            return None;
        }
        if !unmatched_once_edges(&faces).is_empty() {
            return None;
        }
        // A face whose inner wires overlap (two holes, or a hole and a boss rim, that cross)
        // is not a face at all: its area and area vector can still come out right while the
        // surface over the overlap is missing, so neither closure nor translation invariance
        // sees it. This used to be refused only because an arc-sampling error in
        // `plane_face_contains` happened to trip the soundness probe.
        if inner_circles_overlap(&faces) {
            return None;
        }
    }
 let result = Solid {
 shells: vec![Rc::new(RefCell::new(Shell { faces }))],
 };
 // The manifold guard above cannot see a result that is closed and WRONG
    // (the base's own shell with the tool's faces silently dropped is a
    // perfectly closed shell). Check the result as a SET instead.
 if !boolean_result_is_sound(op, a, b, &result) {
 return None;
 }
 if !volume_is_translation_invariant(&result) {
 return None;
 }
 Some(result)
}

/// A divergence-theorem volume is independent of origin only for a closed
/// shell. Translation exposes an unmatched area vector without trusting edge
/// handles, which curved seams can legitimately leave unshared. This mirrors
/// `solid_volume` face by face without cloning the result topology.
pub(crate) fn volume_is_translation_invariant(solid: &TSolid) -> bool {
 let shift = crate::math::Transform::translation([37.0, -23.0, 11.0]);
 let mut sum = 0.0;
 let mut moved_sum = 0.0;
 for face in solid.faces() {
 let face = face.borrow();
 match &face.surface {
 Surface::Plane(plane) => {
 let (area, centroid) = build::face_area_centroid(&face);
 sum += area * dot(plane.n, centroid);
 moved_sum += area * dot(plane.n, add(centroid, shift.t));
 }
 surface => {
 let term = surface.volume_term();
 sum += term;
 moved_sum += surface.transform(&shift).volume_term();
 }
 }
 }
 let volume = (sum / 3.0).abs();
 let moved_volume = (moved_sum / 3.0).abs();
 (moved_volume - volume).abs() <= 1e-9 * volume.abs().max(1.0)
}

/// Uses per edge HANDLE across `faces`, keyed by the handle's address. On a
/// closed 2-manifold every edge reads 2; `boolean` refuses a count outside
/// {1, 2}.
pub(crate) fn edge_use_counts(faces: &[TFace]) -> std::collections::HashMap<usize, usize> {
    let mut use_count: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for f in faces {
        let fb = f.borrow();
        for w in &fb.boundary {
            for u in &w.borrow().edges {
                let key = std::rc::Rc::as_ptr(&u.edge) as *const () as usize;
                *use_count.entry(key).or_insert(0) += 1;
            }
        }
    }
    use_count
}

/// Edge handles used once across `faces` that have no geometric twin: the rim
/// of a shell that is not closed. A once-used handle is legal only when it is a
/// seam the weld left unmerged, i.e. another once-used handle carries the same
/// curve between the same end points (or, for a full circle, the same circle,
/// since its seam vertex may sit elsewhere). Twins are paired one-to-one.
pub(crate) fn unmatched_once_edges(faces: &[TFace]) -> Vec<topo::EdgeRef<Curve3>> {
    let counts = edge_use_counts(faces);
    let mut once: Vec<topo::EdgeRef<Curve3>> = Vec::new();
    for f in faces {
        for w in &f.borrow().boundary {
            for u in &w.borrow().edges {
                let key = std::rc::Rc::as_ptr(&u.edge) as *const () as usize;
                if counts.get(&key) == Some(&1) && !once.iter().any(|e| topo::same(e, &u.edge)) {
                    once.push(u.edge.clone());
                }
            }
        }
    }
    let ends = |e: &topo::EdgeRef<Curve3>| {
        let e = e.borrow();
        let (a, b) = (e.a.borrow().point, e.b.borrow().point);
        (a, b)
    };
    let mut open: Vec<topo::EdgeRef<Curve3>> = Vec::new();
    let mut taken = vec![false; once.len()];
    for i in 0..once.len() {
        if taken[i] {
            continue;
        }
        taken[i] = true;
        let (ea, eb) = ends(&once[i]);
        let closed_curve = near3(ea, eb);
        let twin = (i + 1..once.len()).find(|&j| {
            if taken[j] || !same_edge_geometry(&once[i].borrow(), &once[j].borrow()) {
                return false;
            }
            let (ja, jb) = ends(&once[j]);
            closed_curve || (near3(ea, ja) && near3(eb, jb)) || (near3(ea, jb) && near3(eb, ja))
        });
        match twin {
            Some(j) => taken[j] = true,
            None => open.push(once[i].clone()),
        }
    }
    // A face of revolution can omit its own rim edge (a cone's wire is just
    // its seam), leaving the neighbour's circle used once. That is a missing
    // handle, not a missing face, when the circle lies on a curved face of
    // this shell.
    open.retain(|e| {
        let (a, b) = ends(e);
        if !near3(a, b) {
            return true;
        }
        // A zero-radius arc is a point (a half-disc tool's pole), not a rim.
        if let Curve::Arc { radius, .. } | Curve::Circle { radius, .. } = &e.borrow().curve {
            if *radius <= WELD_TOL {
                return false;
            }
        }
        let pts = closed_curve_samples(&e.borrow().curve);
        if pts.is_empty() {
            return true;
        }
        let uses_edge = |f: &TFace| {
            f.borrow().boundary.iter().any(|w| w.borrow().edges.iter().any(|u| topo::same(&u.edge, e)))
        };
        let is_curved = |f: &TFace| !matches!(f.borrow().surface, Surface::Plane(_));
        // The rim is excused only when a PLANAR face holds it and a curved face
        // that does not list it lies on the circle. A curved face that lists the
        // handle itself is the one-sided rim of an open shell.
        if faces.iter().any(|f| uses_edge(f) && is_curved(f)) {
            return true;
        }
        !faces.iter().any(|f| {
            is_curved(f) && !uses_edge(f) && pts.iter().all(|&p| point_on_curved_face(&f.borrow().surface, p))
        })
    });
    // Collinear segments may be split differently on the two sides of a seam (a
    // T-junction): whole on one face, in pieces on the other. The handles do
    // not pair, but the span is closed when the signed uses along each line
    // cancel everywhere.
    // Every segment USE, directed as traversed: a whole edge on one face can
    // be cancelled by pieces that other faces also use, so the balance counts
    // all uses on the line, not only the once-used handles.
    let mut uses: Vec<(Vec3, Vec3)> = Vec::new();
    for f in faces {
        for w in &f.borrow().boundary {
            for u in &w.borrow().edges {
                if matches!(u.edge.borrow().curve, Curve::Segment { .. }) {
                    let (a, b) = ends(&u.edge);
                    uses.push(if u.forward { (a, b) } else { (b, a) });
                }
            }
        }
    }
    let mut resolved = vec![false; open.len()];
    for i in 0..open.len() {
        if resolved[i] || !matches!(open[i].borrow().curve, Curve::Segment { .. }) {
            continue;
        }
        let (p, q) = ends(&open[i]);
        let d = sub(q, p);
        let len = crate::math::len(d);
        if len < 1e-12 {
            continue;
        }
        let dir = scale(d, 1.0 / len);
        let on_line = |x: Vec3| {
            let r = sub(x, p);
            crate::math::len(sub(r, scale(dir, dot(r, dir)))) <= WELD_TOL
        };
        // (start, end) along `dir`: the sign of the traversal is the sign of end - start.
        let spans: Vec<(f64, f64)> = uses
            .iter()
            .filter(|&&(a, b)| on_line(a) && on_line(b))
            .map(|&(a, b)| (dot(sub(a, p), dir), dot(sub(b, p), dir)))
            .collect();
        let mut cuts: Vec<f64> = spans.iter().flat_map(|&(a, b)| [a, b]).collect();
        cuts.sort_by(|x, y| x.partial_cmp(y).unwrap());
        let balanced = cuts.windows(2).all(|w| {
            if w[1] - w[0] <= WELD_TOL {
                return true;
            }
            let mid = 0.5 * (w[0] + w[1]);
            let net: i32 = spans
                .iter()
                .map(|&(a, b)| {
                    let (lo, hi) = (a.min(b), a.max(b));
                    if mid > lo && mid < hi {
                        if b > a { 1 } else { -1 }
                    } else {
                        0
                    }
                })
                .sum();
            net == 0
        });
        if balanced {
            for j in 0..open.len() {
                let (a, b) = ends(&open[j]);
                if on_line(a) && on_line(b) {
                    resolved[j] = true;
                }
            }
        }
    }
    open.into_iter().enumerate().filter(|&(i, _)| !resolved[i]).map(|(_, e)| e).collect()
}

/// Four points on a closed circular edge, empty for any other curve.
fn closed_curve_samples(curve: &Curve3) -> Vec<Vec3> {
    match curve {
        Curve::Circle { center, radius, normal } => {
            let n = normalize(*normal);
            let h = if n[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
            let u = normalize(cross(n, h));
            let v = cross(n, u);
            (0..4)
                .map(|k| {
                    let t = k as f64 * std::f64::consts::FRAC_PI_2 + 0.3;
                    add(*center, add(scale(u, radius * t.cos()), scale(v, radius * t.sin())))
                })
                .collect()
        }
        Curve::Arc { center, radius, normal, x_axis, sweep } if (sweep.abs() - std::f64::consts::TAU).abs() < 1e-9 => {
            let n = normalize(*normal);
            let u = normalize(*x_axis);
            let v = cross(n, u);
            (0..4)
                .map(|k| {
                    let t = k as f64 * std::f64::consts::FRAC_PI_2 + 0.3;
                    add(*center, add(scale(u, radius * t.cos()), scale(v, radius * t.sin())))
                })
                .collect()
        }
        _ => Vec::new(),
    }
}

/// Does `p` lie on a curved (non-plane) surface, to `WELD_TOL`? The trim is not
/// consulted: this only asks whether a face of revolution could carry the
/// circle, which is what a missing rim handle needs.
fn point_on_curved_face(surface: &Surface3, p: Vec3) -> bool {
    let radial = |origin: Vec3, axis: Vec3| {
        let a = normalize(axis);
        let r = sub(p, origin);
        let h = dot(r, a);
        (crate::math::len(sub(r, scale(a, h))), h)
    };
    match surface {
        Surface::Cylinder(c) => (radial(c.origin, c.axis).0 - c.radius).abs() <= WELD_TOL,
        Surface::Cone(c) => {
            let (rho, h) = radial(c.base, c.axis);
            let t = c.half_angle.tan();
            (rho - (c.base_radius + h * t)).abs() <= WELD_TOL || (rho - (c.base_radius - h * t)).abs() <= WELD_TOL
        }
        Surface::Sphere(s) => (crate::math::len(sub(p, s.center)) - s.radius).abs() <= WELD_TOL,
        Surface::Torus(t) => {
            let (rho, h) = radial(t.center, t.axis);
            (((rho - t.ring).powi(2) + h * h).sqrt() - t.tube).abs() <= WELD_TOL
        }
        _ => false,
    }
}

/// Edge handles used exactly once across `faces`: the rim of a shell that is
/// not closed. Sorted so a failure message is stable. Test-only until the
/// closure-guard slice makes `boolean` refuse on it.
#[cfg(test)]
fn once_used_edges(faces: &[TFace]) -> Vec<usize> {
 let mut once: Vec<usize> = edge_use_counts(faces).into_iter().filter(|&(_, n)| n == 1).map(|(k, _)| k).collect();
 once.sort_unstable();
 once
}

/// Points that lie ON a face, each with the face's outward normal, for the
/// set-theoretic soundness check.
///
/// PLANAR faces: polygonal (Segment edges only) and single-circle disks, with
/// or without inner wires; anything with an arc or other curve on a wire
/// yields no samples, because a chord polygon would put samples off the true
/// face. Points are the face's vertex centroid and each vertex pulled 30%
/// toward it, kept only when they lie in the outer wire and outside every
/// inner wire.
///
/// CYLINDRICAL and CONICAL faces matter just as much: a bore or countersink's
/// entire volume error lives on its wall. Full cylinder and cone walls with one
/// boundary wire are sampled as a mid-v ring, clear of both rims. Everything
/// else abstains, per the rule `boolean_result_is_sound` states for itself: an
/// unreliable check must abstain rather than refuse a correct solid.
pub(crate) fn planar_face_samples(face: &TFace) -> Vec<(Vec3, Vec3)> {
    let fb = face.borrow();
    let plane = match &fb.surface {
        Surface::Plane(p) => p.clone(),
 // A trimmed cylinder (`cross`) is not a whole wall: a sample at mid-height
 // around the full circle would land off the face, so it abstains.
 Surface::Cylinder(cy) if cy.arc.is_none() && cy.cross.is_none() && fb.boundary.len() == 1 => {
            // The probe offset is 1e-4 (DELTA in boolean_result_is_sound); stay
            // well clear of both rims so a sample can never land on a trimmed
            // edge and probe the wrong side of it.
            if cy.vmax - cy.vmin <= 4.0e-4 {
                return Vec::new();
            }
            let v = 0.5 * (cy.vmin + cy.vmax);
            return (0..8)
                .filter_map(|k| {
                    let u = k as f64 * std::f64::consts::FRAC_PI_4;
                    let radial = add(scale(cy.e1, u.cos()), scale(cy.e2, u.sin()));
                    let p = add(add(cy.origin, scale(radial, cy.radius)), scale(cy.axis, v));
                    // Outward normal = cross(d/du, d/dv). At u=0 that is
                    // cross(e2, axis) -- the convention the void-wall normal test
                    // above documents -- and `flip_face` negates e2, so the flip is
                    // already encoded here. Normalised because the probe is a
                    // fixed-length step; a degenerate frame abstains rather than
                    // emit a zero normal, which would probe the face's own point.
                    let du = add(scale(cy.e1, -u.sin()), scale(cy.e2, u.cos()));
                    let n = cross(du, cy.axis);
                    let len = crate::math::len(n);
                    if len < 1e-12 {
                        return None;
                    }
                    Some((p, scale(n, 1.0 / len)))
                })
 .collect();
 }
 Surface::Cone(c) if fb.boundary.len() == 1 => {
 let v = 0.5 * (c.v_range[0] + c.v_range[1]);
 let r = c.base_radius - v * c.half_angle.sin();
 if v <= c.v_range[0] + 2.0e-4 || v >= c.v_range[1] - 2.0e-4 || r <= 1e-9 {
 return Vec::new();
 }
 return (0..8)
 .filter_map(|k| {
 let u = k as f64 * std::f64::consts::FRAC_PI_4;
 let rho = add(scale(c.e1, u.cos()), scale(c.e2, u.sin()));
 let p = add(c.base, add(scale(rho, r), scale(c.axis, v * c.half_angle.cos())));
 let du = scale(add(scale(c.e1, -u.sin()), scale(c.e2, u.cos())), r);
 let dv = add(scale(rho, -c.half_angle.sin()), scale(c.axis, c.half_angle.cos()));
 let n = cross(du, dv);
 let len = crate::math::len(n);
 (len >= 1e-12).then_some((p, scale(n, 1.0 / len)))
 })
 .collect();
 }
 Surface::Sphere(sp) if fb.boundary.len() <= 2 => {
            // A grid over the face's own (u, v) patch, kept only where the face
            // really is (a drilled sphere has holes) and clear of its rims by far
            // more than the probe step. The outward normal is radial, negated
            // when the face is reversed relative to the frame's handedness.
            let outward = if fb.forward == (dot(cross(sp.e1, sp.e2), sp.axis) > 0.0) { 1.0 } else { -1.0 };
            let (v0, v1) = (sp.v_range[0], sp.v_range[1]);
            let (u0, u1) = (sp.u_range[0], sp.u_range[1]);
            let mut out = Vec::new();
            for i in 1..=5 {
                for j in 1..=8 {
                    let v = v0 + (v1 - v0) * i as f64 / 6.0;
                    let u = u0 + (u1 - u0) * (j as f64 - 0.5) / 8.0;
                    let p = fb.surface.param(u, v);
                    let w = sub(p, sp.center);
                    let len = crate::math::len(w);
                    if len < 1e-12 || !sphere_face_contains(sp, p) {
                        continue;
                    }
                    // Stay off a trim edge: the point must still be contained
                    // when moved 2e-3 sideways in any direction we can name.
                    let n = scale(w, outward / len);
                    let tangent = normalize(cross(n, if n[2].abs() < 0.9 { [0.0, 0.0, 1.0] } else { [1.0, 0.0, 0.0] }));
                    let near = |d: Vec3| {
                        let q = add(p, scale(d, 2.0e-3));
                        let q = add(sp.center, scale(sub(q, sp.center), sp.radius / crate::math::len(sub(q, sp.center))));
                        sphere_face_contains(sp, q)
                    };
                    let other = cross(n, tangent);
                    if near(tangent) && near(scale(tangent, -1.0)) && near(other) && near(scale(other, -1.0)) {
                        out.push((p, n));
                    }
                }
            }
            return out;
        }
 Surface::Torus(tor) if fb.boundary.len() <= 2 => {
            // A grid over the tube angle strictly inside the face's range (the
            // ring angle is a full turn). Outward normal is the tube's radial
            // direction, negated when the face is reversed against its frame.
            let outward = if fb.forward == (dot(cross(tor.e1, tor.e2), tor.axis) > 0.0) { 1.0 } else { -1.0 };
            let a = normalize(tor.axis);
            let mut out = Vec::new();
            for i in 1..=5 {
                for j in 0..8 {
                    let v = tor.v_range[0] + (tor.v_range[1] - tor.v_range[0]) * i as f64 / 6.0;
                    let u = (j as f64 + 0.37) * std::f64::consts::FRAC_PI_4;
                    let p = fb.surface.param(u, v);
                    let radial = normalize(sub(sub(p, tor.center), scale(a, dot(sub(p, tor.center), a))));
                    let ring_pt = add(tor.center, scale(radial, tor.ring));
                    let n = scale(normalize(sub(p, ring_pt)), outward);
                    if torus_face_contains(tor, p) && crate::math::len(n) > 0.5 {
                        out.push((p, n));
                    }
                }
            }
            return out;
        }
 _ => return Vec::new(),
    };
    let n = plane.n;
    // A wire is either one Circle edge (centre, radius) or all Segments.
    enum Loop { Circle(Vec3, f64), Poly(Vec<[f64; 2]>) }
    let read = |w: &topo::WireRef<Curve3>| -> Option<Loop> {
        let wb = w.borrow();
        if wb.edges.len() == 1 {
            if let Curve::Circle { center, radius, .. } = &wb.edges[0].edge.borrow().curve {
                return Some(Loop::Circle(*center, *radius));
            }
        }
        for u in &wb.edges {
            if !matches!(&u.edge.borrow().curve, Curve::Segment { .. }) {
                return None;
            }
        }
        let pts = wire_uv_points(w, &plane);
        if pts.len() < 3 { None } else { Some(Loop::Poly(pts)) }
    };
    let inside_loop = |l: &Loop, p: Vec3| match l {
        Loop::Circle(c, r) => crate::math::len(sub(p, *c)) < *r,
        Loop::Poly(poly) => point_in_poly(poly, plane.project(p)),
    };
    let Some(outer_wire) = fb.boundary.first() else { return Vec::new() };
    let Some(outer) = read(outer_wire) else { return Vec::new() };
    let mut inner: Vec<Loop> = Vec::new();
    for w in fb.boundary.iter().skip(1) {
        let Some(l) = read(w) else { return Vec::new() };
        inner.push(l);
    }
    let mut cands: Vec<Vec3> = Vec::new();
    match &outer {
        Loop::Circle(c, r) => {
            cands.push(*c);
            for (du, dv) in [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
                cands.push(add(*c, add(scale(plane.u, 0.7 * r * du), scale(plane.v, 0.7 * r * dv))));
            }
            // Off-centre points too: a disk with a central bore still has
            // material at 0.85r.
            for (du, dv) in [(0.85, 0.0), (-0.85, 0.0), (0.0, 0.85), (0.0, -0.85)] {
                cands.push(add(*c, add(scale(plane.u, r * du), scale(plane.v, r * dv))));
            }
        }
        Loop::Poly(poly) => {
            let k = poly.len() as f64;
            let cu = [poly.iter().map(|q| q[0]).sum::<f64>() / k, poly.iter().map(|q| q[1]).sum::<f64>() / k];
            cands.push(plane.point(cu));
            for q in poly.iter().take(12) {
                for t in [0.7, 0.3] {
                    cands.push(plane.point([cu[0] + t * (q[0] - cu[0]), cu[1] + t * (q[1] - cu[1])]));
                }
            }
        }
    }
    // A sample must be clear of every boundary of its own face: on an L-shaped face a 0.7/0.3 point
    // can land exactly on an edge, where the probe at +/- DELTA n straddles the other solid's own
    // edge line and reads the same on both sides, which would refuse a correct solid (G5).
    const CLEAR: f64 = 1.0e-3;
    let boundary_dist = |l: &Loop, p: Vec3| -> f64 {
        match l {
            Loop::Circle(c, r) => (crate::math::len(sub(p, *c)) - *r).abs(),
            Loop::Poly(poly) => {
                let q = plane.project(p);
                let mut best = f64::INFINITY;
                for i in 0..poly.len() {
                    let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
                    let d = [b[0] - a[0], b[1] - a[1]];
                    let l2 = d[0] * d[0] + d[1] * d[1];
                    let t = if l2 < 1e-24 { 0.0 } else { (((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / l2).clamp(0.0, 1.0) };
                    let (dx, dy) = (q[0] - (a[0] + t * d[0]), q[1] - (a[1] + t * d[1]));
                    best = best.min((dx * dx + dy * dy).sqrt());
                }
                best
            }
        }
    };
    cands
        .into_iter()
        .filter(|p| inside_loop(&outer, *p) && !inner.iter().any(|l| inside_loop(l, *p)))
        .filter(|p| boundary_dist(&outer, *p) > CLEAR && inner.iter().all(|l| boundary_dist(l, *p) > CLEAR))
        .map(|p| (p, n))
        .collect()
}

/// Verify a general-path boolean as a SET, independent of how it was built.
/// A point q is in the result iff the operation's formula says so of its
/// membership in `a` and `b` -- `inside_solid` is a parity ray test, so it
/// is right for a non-convex operand where the convex `Region` algebra the
/// builder relies on is not (that gap is the msgbox #383 wrong-solid class).
///
/// Two checks over sample points p on planar faces, probed at p +/- DELTA n:
///  * every face of `a` and `b`: the result's membership at both probes must
///    match the formula (a dropped tool wall, or a kept interior face, fails);
///  * every face of the result: the formula must differ across it (a face
///    that bounds nothing is an interior or exterior sliver left behind).
/// A face that fails to yield samples is simply not checked, so this can only
/// turn a wrong solid into a refusal, never a correct solid into a wrong one.
pub(crate) fn boolean_result_is_sound(op: &str, a: &TSolid, b: &TSolid, r: &TSolid) -> bool {
    const DELTA: f64 = 1e-4;
 // The parity ray test is trusted on planar, cylindrical, and conical
 // operands; a sphere or torus still makes this check abstain rather than
 // refuse a correct solid.
    let plain = |s: &TSolid| {
 s.faces().iter().all(|f| matches!(&f.borrow().surface, Surface::Plane(_) | Surface::Cylinder(_) | Surface::Cone(_) | Surface::Sphere(_) | Surface::Torus(_)))
    };
    if !plain(a) || !plain(b) {
        return true;
    }
 let member = |q: Vec3| -> bool {
        let (ia, ib) = (inside_solid(a, q), inside_solid(b, q));
        match op {
            "union" => ia || ib,
            "subtract" => ia && !ib,
            _ => ia && ib,
 }
 };
    // While a boolean carries faces the cut never reaches (`RAY_AVOID` set), those faces are
    // unchanged by construction and cannot be probed from beside them, so they are skipped.
    let carry_mode = RAY_AVOID.with(|v| !v.borrow().is_empty());
    let apart = |f: &TFace| carry_mode && unsafe_surface(f);
    for (faces, is_result) in [(a.faces(), false), (b.faces(), false), (r.faces(), true)] {
        for f in &faces {
            if apart(f) {
                continue;
            }
            // A result face bounds nothing only if EVERY sample says so: a
            // sample can sit on a tangent line of the other operand, where
            // both probes are legitimately inside (tangent-union-cylinder).
            let mut bounds_nothing = None;
            for (p, n) in planar_face_samples(f) {
                let q1 = add(p, scale(n, DELTA));
                let q2 = sub(p, scale(n, DELTA));
                let (e1, e2) = (member(q1), member(q2));
                if is_result {
                    bounds_nothing = Some(bounds_nothing.unwrap_or(true) && e1 == e2);
 } else if e1 != inside_solid(r, q1) || e2 != inside_solid(r, q2) {
 return false;
                }
            }
 if bounds_nothing == Some(true) {
 return false;
            }
        }
    }
    true
}

#[test]
fn cone_soundness_rejects_wrong_half_angle() {
 let correct_profile = [[0.0, -11.0], [3.0, -11.0], [3.0, 7.0], [6.0, 10.0], [6.0, 11.0], [0.0, 11.0]];
 let wrong_profile = [[0.0, -11.0], [3.0, -11.0], [3.0, 7.0], [5.0, 10.0], [5.0, 11.0], [0.0, 11.0]];
 let tool = build::revolve_profile(&correct_profile, [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], 360.0).unwrap().0;
 let wrong_tool = build::revolve_profile(&wrong_profile, [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], 360.0).unwrap().0;
 let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
 let wrong_result = boolean("subtract", &base, &wrong_tool).expect("wrong-angle cone cut still builds");
 let mesh = crate::mesh::mesh_solid(&wrong_result, 0.05).expect("wrong-angle result meshes");
 assert!(check_watertight(&mesh), "wrong-angle result remains closed");
 assert!(volume_is_translation_invariant(&wrong_result), "wrong-angle result remains translation invariant");
 assert!(!boolean_result_is_sound("subtract", &base, &tool, &wrong_result));
}

/// Remove zero-area output faces. A boolean can emit a planar face that is a
/// single zero-length segment when the two operands' surfaces touch tangentially
/// (coplanar-subtract-caps: a cylinder's cap lies coplanar with the box's, so its
/// whole circle is trimmed away and its boundary collapses to a point). Such a
/// face has no area, contributes nothing to volume, and cannot be tessellated
/// (its boundary does not close), so it is not a real face of the result. Faces
/// with a genuine (if small) area are kept.
/// True when a plane face has two inner circular wires that cross, touch or nest.
fn inner_circles_overlap(faces: &[TFace]) -> bool {
    for f in faces {
        let fb = f.borrow();
        if !matches!(fb.surface, Surface::Plane(_)) || fb.boundary.len() < 3 {
            continue;
        }
        let circles: Vec<(Vec3, f64)> = fb
            .boundary
            .iter()
            .skip(1)
            .filter_map(|w| {
                let uses = &w.borrow().edges;
                if uses.len() != 1 {
                    return None;
                }
                let e = uses[0].edge.borrow();
                if let Curve::Circle { center, radius, .. } = &e.curve {
                    Some((*center, *radius))
                } else {
                    None
                }
            })
            .collect();
        for i in 0..circles.len() {
            for j in (i + 1)..circles.len() {
                let d = crate::math::len(sub(circles[i].0, circles[j].0));
                if d < circles[i].1 + circles[j].1 - 1e-9 {
                    return true;
                }
            }
        }
    }
    false
}

pub(crate) fn drop_degenerate_faces(faces: &mut Vec<TFace>) {
    faces.retain(|f| {
        let (area, _) = build::face_area_centroid(&f.borrow());
        area > 1e-9
    });
}

/// Tolerance for the seam weld, in mm. The duplicated copies are computed by
/// different formulas: a wall's clip disk is taken at the probe-offset plane
/// (`keep_polygon` probes `PROBE` inside the other solid), while
/// `polar_hole_wire` uses the exact sphere -- the two agree to about 3.8e-7
/// here (measured on sphere-minus-box), not to float precision. One micron is
/// 100x below the parity gate's `approx` tolerance and above the mesh gate's
/// own 5e-7 vertex weld, so the seam joins without merging real features.
const WELD_TOL: f64 = 1e-6;

fn near3(p: Vec3, q: Vec3) -> bool {
    crate::math::len(sub(p, q)) <= WELD_TOL
}

/// Do two edges carry the same curve geometry? Same type and parameters, and --
/// for arcs -- the same angular span (each arc's sampled points must lie on the
/// other's range, so a sub-arc is NOT a match). Handle identity is never
/// considered here; this is the geometric test the seam weld needs, and it does
/// not replace `topo::same` anywhere identity is the question (§4.2).
fn same_edge_geometry(a: &topo::Edge<Curve3>, b: &topo::Edge<Curve3>) -> bool {
    let parallel = |p: Vec3, q: Vec3| crate::math::len(cross(p, q)) <= 1e-9;
    match (&a.curve, &b.curve) {
        (Curve::Segment { a: p1, b: p2 }, Curve::Segment { a: q1, b: q2 }) => {
            (near3(*p1, *q1) && near3(*p2, *q2)) || (near3(*p1, *q2) && near3(*p2, *q1))
        }
        (
            Curve::Circle { center: c1, radius: r1, normal: n1 },
            Curve::Circle { center: c2, radius: r2, normal: n2 },
        ) => near3(*c1, *c2) && (r1 - r2).abs() <= WELD_TOL && parallel(*n1, *n2),
        (
            Curve::Arc { center: c1, radius: r1, normal: n1, x_axis: x1, sweep: s1 },
            Curve::Arc { center: c2, radius: r2, normal: n2, x_axis: x2, sweep: s2 },
        ) => {
            if !(near3(*c1, *c2) && (r1 - r2).abs() <= WELD_TOL && parallel(*n1, *n2)) {
                return false;
            }
            // Same circle; same span iff every sample of each arc lies on the
            // other's curve (radius AND angular range).
            let on = |p: Vec3, c: Vec3, r: f64, n: Vec3, x: Vec3, sweep: f64| {
                let d = sub(p, c);
                if (crate::math::len(d) - r).abs() > WELD_TOL {
                    return false;
                }
                let xa = normalize(x);
                let ya = normalize(cross(n, xa));
                let ang = dot(d, ya).atan2(dot(d, xa));
                let tol_a = WELD_TOL / r.max(1e-9);
                if sweep >= 0.0 {
                    let mut rel = ang;
                    while rel < -tol_a {
                        rel += TWO_PI;
                    }
                    rel <= sweep + tol_a
                } else {
                    let mut rel = ang;
                    while rel > tol_a {
                        rel -= TWO_PI;
                    }
                    rel >= sweep - tol_a
                }
            };
            let curve_a = Curve::Arc { center: *c1, radius: *r1, normal: *n1, x_axis: *x1, sweep: *s1 };
            let curve_b = Curve::Arc { center: *c2, radius: *r2, normal: *n2, x_axis: *x2, sweep: *s2 };
            [0.0, 0.25, 0.5, 0.75, 1.0].iter().all(|t| {
                on(curve_a.point_at(*t), *c2, *r2, *n2, *x2, *s2)
                    && on(curve_b.point_at(*t), *c1, *r1, *n1, *x1, *s1)
            })
        }
        _ => false,
    }
}

/// W0 seam weld (SPEC-brep-kernel-rs §4.2): a boolean must share one edge
/// handle per seam, not one per side. The pieces that make a seam — a wall's
/// mixed segment/arc boundary (`build_mixed_face`), a trimmed sphere's polar
/// hole (`polar_hole_wire`) and the adjacent walls' own corner segments — each
/// build their own `Rc` along the same curve, so no SINGLE edge is used by both
/// faces and a `between` name on that seam cannot resolve (FUTURE.md
/// 2026-09-15). Volume, area, bbox and face count cannot see the duplication.
///
/// Every group of geometrically equal edges (same curve, compatible endpoints)
/// keeps its first handle as canonical; every later use is rewritten to that
/// handle, with `forward` set so the face still traverses the same geometric
/// direction. The pcurve is expressed in the face's own uv at the traversal's
/// start/end points, so it needs no change. Coincident end vertices are welded
/// the same way, or a corner name still sees two vertices at one point.
/// The vector a WHOLE-turn curve (a circle, or an arc that sweeps a full 2 pi)
/// runs counter-clockwise about, or `None` for any other curve.
fn full_turn_normal(c: &Curve) -> Option<Vec3> {
    match c {
        Curve::Circle { normal, .. } => Some(*normal),
        Curve::Arc { normal, sweep, .. } if sweep.abs() >= TWO_PI - 1e-9 => Some(scale(*normal, sweep.signum())),
        _ => None,
    }
}

/// Split every straight edge at the vertices of OTHER faces that lie strictly inside it (a
/// T-junction), so that the neighbour that has the vertex and the face that does not end up
/// with the same edge pieces. The geometry does not change by a hair: an edge becomes two or
/// more collinear edges. Returns whether anything was split. Run `weld_shared_edges` after it.
pub(crate) fn split_t_junctions(faces: &mut [TFace]) -> bool {
    // Distinct vertex positions, one handle each, from every edge end of every face.
    let mut verts: Vec<topo::VertexRef> = Vec::new();
    let mut handle_at = |v: &topo::VertexRef, verts: &mut Vec<topo::VertexRef>| -> topo::VertexRef {
        let p = v.borrow().point;
        for w in verts.iter() {
            if crate::math::len(sub(w.borrow().point, p)) < 1e-9 {
                return w.clone();
            }
        }
        verts.push(v.clone());
        v.clone()
    };
    let mut edges: Vec<topo::EdgeRef<Curve3>> = Vec::new();
    for f in faces.iter() {
        for w in &f.borrow().boundary {
            for u in &w.borrow().edges {
                if !edges.iter().any(|e| topo::same(e, &u.edge)) {
                    edges.push(u.edge.clone());
                }
                let (a, b) = (u.edge.borrow().a.clone(), u.edge.borrow().b.clone());
                handle_at(&a, &mut verts);
                handle_at(&b, &mut verts);
            }
        }
    }
    // Per segment edge: the replacement chain, edge a to edge b.
    let mut chains: Vec<Option<Vec<topo::EdgeRef<Curve3>>>> = vec![None; edges.len()];
    let mut any = false;
    for (i, e) in edges.iter().enumerate() {
        let (ea, eb, fwd, is_seg) = {
            let eb_ = e.borrow();
            (eb_.a.clone(), eb_.b.clone(), eb_.forward, matches!(eb_.curve, Curve::Segment { .. }))
        };
        if !is_seg {
            continue;
        }
        let (pa, pb) = (ea.borrow().point, eb.borrow().point);
        let d = sub(pb, pa);
        let l2 = dot(d, d);
        if l2 < 1e-18 {
            continue;
        }
        let mut on: Vec<(f64, topo::VertexRef)> = Vec::new();
        for v in &verts {
            let p = v.borrow().point;
            let t = dot(sub(p, pa), d) / l2;
            if t > 1e-9
                && t < 1.0 - 1e-9
                && crate::math::len(sub(p, add(pa, scale(d, t)))) < 1e-7
                && crate::math::len(sub(p, pa)) > 1e-7
                && crate::math::len(sub(p, pb)) > 1e-7
            {
                on.push((t, v.clone()));
            }
        }
        if on.is_empty() {
            continue;
        }
        on.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
        let mut chain = Vec::new();
        let mut prev = ea.clone();
        for v in on.iter().map(|(_, v)| v.clone()).chain(std::iter::once(eb.clone())) {
            let (p, q) = (prev.borrow().point, v.borrow().point);
            chain.push(topo::edge(prev.clone(), v.clone(), fwd, Curve::Segment { a: p, b: q }));
            prev = v;
        }
        chains[i] = Some(chain);
        any = true;
    }
    if !any {
        return false;
    }
    for f in faces.iter() {
        for w in &f.borrow().boundary {
            let old = w.borrow().edges.clone();
            let mut out: Vec<topo::EdgeUse<Curve3>> = Vec::with_capacity(old.len());
            for u in old {
                let Some(idx) = edges.iter().position(|e| topo::same(e, &u.edge)) else {
                    out.push(u);
                    continue;
                };
                let Some(chain) = &chains[idx] else {
                    out.push(u);
                    continue;
                };
                // The use runs start -> end in its own uv; each piece takes the share of that run
                // its length is of the whole edge (the pcurve of a straight edge is linear).
                let total: f64 = chain.iter().map(|c| crate::math::len(sub(c.borrow().b.borrow().point, c.borrow().a.borrow().point))).sum();
                let seq: Vec<&topo::EdgeRef<Curve3>> = if u.forward { chain.iter().collect() } else { chain.iter().rev().collect() };
                let mut acc = 0.0;
                for c in seq {
                    let l = crate::math::len(sub(c.borrow().b.borrow().point, c.borrow().a.borrow().point));
                    let (t0, t1) = (acc / total, (acc + l) / total);
                    acc += l;
                    let lerp = |t: f64| [u.pcurve.start[0] + (u.pcurve.end[0] - u.pcurve.start[0]) * t, u.pcurve.start[1] + (u.pcurve.end[1] - u.pcurve.start[1]) * t];
                    out.push(topo::EdgeUse {
                        edge: c.clone(),
                        forward: u.forward,
                        pcurve: topo::Pcurve { start: lerp(t0), end: lerp(t1), mid: lerp((t0 + t1) / 2.0) },
                    });
                }
            }
            w.borrow_mut().edges = out;
        }
    }
    true
}

pub(crate) fn weld_shared_edges(faces: &mut [TFace]) {
    // 1. Every distinct edge handle in the result.
    let mut edges: Vec<topo::EdgeRef<Curve3>> = Vec::new();
    for f in faces.iter() {
        for w in &f.borrow().boundary {
            for u in &w.borrow().edges {
                if !edges.iter().any(|e| topo::same(e, &u.edge)) {
                    edges.push(u.edge.clone());
                }
            }
        }
    }
    // 2. Which earlier edge each duplicate welds to.
    let mut weld_to: Vec<Option<usize>> = vec![None; edges.len()];
    for i in 0..edges.len() {
        for j in 0..i {
            let canonical = weld_to[j].unwrap_or(j);
            if !same_edge_geometry(&edges[i].borrow(), &edges[canonical].borrow()) {
                continue;
            }
            // Endpoints must line up in one direction or the other; a full
            // circle with a different seam vertex is not welded (nothing needs
            // it and a wrong merge is worse than a duplicate).
            let (ca, cb) = {
                let c = edges[canonical].borrow();
                let (pa, pb) = (c.a.borrow().point, c.b.borrow().point);
                (pa, pb)
            };
            let (ea, eb) = {
                let e = edges[i].borrow();
                let (pa, pb) = (e.a.borrow().point, e.b.borrow().point);
                (pa, pb)
            };
            if (near3(ea, ca) && near3(eb, cb)) || (near3(ea, cb) && near3(eb, ca)) {
                weld_to[i] = Some(canonical);
                break;
            }
        }
    }
    // 3. Rewrite every use to its canonical handle.
    for f in faces.iter() {
        for w in &f.borrow().boundary {
            for u in w.borrow_mut().edges.iter_mut() {
                let Some(idx) = edges.iter().position(|e| topo::same(e, &u.edge)) else {
                    continue;
                };
                let Some(target) = weld_to[idx] else { continue };
                let (ca, cb) = {
                    let c = edges[target].borrow();
                    let (pa, pb) = (c.a.borrow().point, c.b.borrow().point);
                    (pa, pb)
                };
                let (ea, eb) = {
                    let e = edges[idx].borrow();
                    let (pa, pb) = (e.a.borrow().point, e.b.borrow().point);
                    (pa, pb)
                };
                // A WHOLE circle starts and ends at one point, so the endpoint
                // test below cannot tell which way this use runs round it. The
                // direction is the normal it turns counter-clockwise about
                // (flipped for a reversed use); keep it against the canonical
                // handle's own normal, or a hole's winding silently reverses and
                // its area is added instead of removed.
                if let (Some(n_use), Some(n_canon)) = (full_turn_normal(&edges[idx].borrow().curve), full_turn_normal(&edges[target].borrow().curve)) {
                    let turn = scale(n_use, if u.forward { 1.0 } else { -1.0 });
                    let forward = dot(turn, n_canon) > 0.0;
                    u.edge = edges[target].clone();
                    u.forward = forward;
                    continue;
                }
                let use_start = if u.forward { ea } else { eb };
                let use_end = if u.forward { eb } else { ea };
                if near3(use_start, ca) && near3(use_end, cb) {
                    u.edge = edges[target].clone();
                    u.forward = true;
                } else if near3(use_start, cb) && near3(use_end, ca) {
                    u.edge = edges[target].clone();
                    u.forward = false;
                }
            }
        }
    }
    // 4. Weld coincident end vertices to one handle.
    let mut verts: Vec<topo::VertexRef> = Vec::new();
    for e in &edges {
        let eb = e.borrow();
        for v in [&eb.a, &eb.b] {
            if !verts.iter().any(|u| Rc::ptr_eq(u, v)) {
                verts.push(v.clone());
            }
        }
    }
    let mut canon: Vec<Option<usize>> = vec![None; verts.len()];
    for i in 0..verts.len() {
        for j in 0..i {
            let target = canon[j].unwrap_or(j);
            if near3(verts[i].borrow().point, verts[target].borrow().point) {
                canon[i] = Some(target);
                break;
            }
        }
    }
    for e in &edges {
        let (ka, kb) = {
            let eb = e.borrow();
            let ka = verts.iter().position(|v| Rc::ptr_eq(v, &eb.a)).unwrap();
            let kb = verts.iter().position(|v| Rc::ptr_eq(v, &eb.b)).unwrap();
            drop(eb);
            (ka, kb)
        };
        let (ta, tb) = (canon[ka].unwrap_or(ka), canon[kb].unwrap_or(kb));
        if ta != ka || tb != kb {
            let mut eb = e.borrow_mut();
            eb.a = verts[ta].clone();
            eb.b = verts[tb].clone();
        }
    }
}

/// Does `p` lie strictly inside every face's own surface (and inside the arc
/// range of a partial cylinder)? Unlike `inside_surface` this uses the real
/// face, so a trimmed/arc-bounded wall counts. `margin` is required clearance.
fn strictly_inside_face(f: &Face<Curve3, Surface3>, p: Vec3, margin: f64) -> bool {
    match &f.surface {
        Surface::Plane(g) => dot(sub(p, g.origin), g.n) <= -margin,
        Surface::Cylinder(c) => {
            let d = sub(p, c.origin);
            let along = dot(d, c.axis);
            if along < c.vmin + margin || along > c.vmax - margin {
                return false;
            }
            let radial = sub(d, scale(c.axis, along));
            if crate::math::len(radial) > c.radius - margin {
                return false;
            }
            if let Some(arc) = &c.arc {
                let e1 = dot(radial, c.e1);
                let e2v = dot(radial, c.e2);
                let mut ang = e2v.atan2(e1) - arc.start;
                ang = ang.rem_euclid(TWO_PI);
                if ang > arc.span - margin / c.radius.max(1e-9) {
                    return false;
                }
            }
            true
        }
        Surface::Sphere(s) => crate::math::len(sub(p, s.center)) <= s.radius - margin,
        Surface::Cone(c) => {
            let d = sub(p, c.base);
            let along = dot(d, c.axis);
            if along < margin || along > c.slant * c.half_angle.cos() - margin {
                return false;
            }
            let radial = sub(d, scale(c.axis, along));
            c.base_radius - along * c.half_angle.tan() - crate::math::len(radial) >= margin
        }
        Surface::Torus(t) => {
            let d = sub(p, t.center);
            let axial = dot(d, t.axis);
            let radial = crate::math::len(sub(d, scale(t.axis, axial)));
            let dq = (radial - t.ring).powi(2) + axial * axial;
            (t.tube - dq.sqrt()) >= margin
        }
    }
}

/// True when the surfaces of two torus bands cannot meet and neither lies inside the other's
/// tube: the distance between their centre circles exceeds the sum of the tube radii. The
/// distance is bounded from below by sampling circle A at 256 points, taking each point's exact
/// distance to circle B, and subtracting the largest gap to the nearest sample (the distance
/// function is 1-Lipschitz). A nested or overlapping pair fails the test; callers refuse it.
fn tori_provably_apart(a: &crate::geom::TorusSurf, b: &crate::geom::TorusSurf) -> bool {
    const N: usize = 256;
    let (ea1, ea2, _) = crate::geom::frame(normalize(a.axis));
    let nb = normalize(b.axis);
    let mut best = f64::INFINITY;
    for k in 0..N {
        let ang = TWO_PI * k as f64 / N as f64;
        let p = add(a.center, add(scale(ea1, a.ring * ang.cos()), scale(ea2, a.ring * ang.sin())));
        let d = sub(p, b.center);
        let h = dot(d, nb);
        let rho = crate::math::len(sub(d, scale(nb, h)));
        let dist = ((rho - b.ring).powi(2) + h * h).sqrt();
        best = best.min(dist);
    }
    let lower = best - a.ring * std::f64::consts::PI / N as f64;
    lower > a.tube + b.tube + 1e-6
}

/// Points covering a solid's boundary densely enough to find where it pokes out of a base:
/// every vertex, 96 points along every edge (so a rim circle is sampled every 3.75 degrees),
/// and, on each curved face, a 12 x 12 grid over its parameter domain (points that fall off a
/// trimmed face can only make the caller refuse, never accept).
fn tool_boundary_samples(faces: &[TFace]) -> Vec<Vec3> {
    let mut pts: Vec<Vec3> = Vec::new();
    for f in faces {
        let fb = f.borrow();
        for w in &fb.boundary {
            for u in &w.borrow().edges {
                let e = u.edge.borrow();
                pts.push(e.a.borrow().point);
                pts.push(e.b.borrow().point);
                for k in 1..96 {
                    pts.push(e.curve.point_at(k as f64 / 96.0));
                }
            }
        }
        if !matches!(fb.surface, Surface::Plane(_)) {
            let (du, dv) = fb.surface.domain();
            for i in 0..=12 {
                for j in 0..=12 {
                    let u = du[0] + (du[1] - du[0]) * i as f64 / 12.0;
                    let v = dv[0] + (dv[1] - dv[0]) * j as f64 / 12.0;
                    pts.push(fb.surface.param(u, v));
                }
            }
        }
    }
    pts
}

/// The fully-enclosed-cavity case of `subtract`: every face of `b` lies
/// strictly inside `a`, and no face of `a` lies inside `b`, with clearance.
/// The result is `a`'s own shell plus `b`'s shell reversed as an inner void
/// (SPEC-brep-pocket.md). Returns None for any other configuration, leaving the
/// general face-by-face path to handle or refuse it.
fn subtract_enclosed(a: &TSolid, b: &TSolid) -> Option<TSolid> {
    let a_faces = a.faces();
    let b_faces = b.faces();
    if a_faces.is_empty() || b_faces.is_empty() {
        return None;
    }
    // Every corner of the tool's own bbox must be strictly inside the base;
    // this is a cheap necessary condition, and the per-face checks below are
    // the sufficient one.
    let bb = build::solid_aabb(b);
    for i in 0..3 {
        for edge in [bb.lo[i], bb.hi[i]] {
            let mut p = bb.center();
            p[i] = edge;
            if !inside_solid(a, p) {
                return None;
            }
        }
    }
    // The tool's shell must not touch the base's. `strictly_inside_face` below
    // reads each face of `a` as a HALF-SPACE, which is only true while `a` is
    // convex: a base with a cavity or a planar step (an L-bracket) fails it for
    // a tool that is perfectly enclosed, and that decline used to fall through
    // to the convex-only general path, which silently dropped the tool's faces
    // (msgbox #383: (a-t)-u came back as a-t). A face of `a` whose own reach box
    // is clear of the tool's bbox cannot touch the tool at all, whatever `a`'s
    // shape; with the tool's shell connected and one point of it inside `a`,
    // that is a sound proof of enclosure. Curved faces have loose boxes and
    // simply fall back to the half-space test.
    let bb_grown = crate::math::Aabb {
        lo: [bb.lo[0] - 1e-3, bb.lo[1] - 1e-3, bb.lo[2] - 1e-3],
        hi: [bb.hi[0] + 1e-3, bb.hi[1] + 1e-3, bb.hi[2] + 1e-3],
    };
    let a_clear_of_tool = a_faces.iter().all(|g| match face_reach_box(g) {
        Some(gb) => !aabbs_touch(&gb, &bb_grown),
        None => true,
    });
    // Every face of b must lie strictly inside every face's own surface of a.
    for f in &b_faces {
        let (area, c) = build::face_area_centroid(&f.borrow());
        if area <= 0.0 {
            return None;
        }
        if !inside_solid(a, c) {
            return None;
        }
        if a_clear_of_tool {
            continue;
        }
        for g in &a_faces {
            if !strictly_inside_face(&g.borrow(), c, CAVITY_MARGIN) {
                return None;
            }
        }
    }
    // The checks above look at the tool's bbox face midpoints and its face centroids only. A
    // tool whose CORNERS (or any rim, or an extremal point of a curved face) poke out of a curved
    // base passes both, and was built as a sealed void, volume V(a) - V(b) (G1: 40 sweep cases,
    // 7781.2 against the true 7792.6 for a 1 x 20 x 20 slab through a sphere). Test every point
    // of the tool's boundary that could be extremal: its vertices, its edges at fine spacing, and
    // a grid over each curved face. Each must be inside `a` and, when `a`'s faces may touch the
    // tool, inside every half-space of `a` as well.
    for p in tool_boundary_samples(&b_faces) {
        if !inside_solid(a, p) {
            return None;
        }
        if !a_clear_of_tool {
            for g in &a_faces {
                if !strictly_inside_face(&g.borrow(), p, CAVITY_MARGIN) {
                    return None;
                }
            }
        }
    }
    // No face of a may lie inside b. (a's own faces lie on its surface, and
    // b's bbox is clear of that surface by the margin checked above.)
    // A CURVED face's area centroid can sit ON ITS AXIS (a cylinder wall's
    // centroid is on the axis, a sphere's at the centre) — inside any coaxial
    // tool even though the SURFACE is clear of it. Probe a point on the
    // surface instead: the face's uv midpoint (an enclosed void's wall,
    // coaxial, is genuinely clear of the tool by the margin checked above).
    for g in &a_faces {
        let (area, c) = build::face_area_centroid(&g.borrow());
        if area <= 0.0 {
            return None;
        }
        let probe = match &g.borrow().surface {
            Surface::Plane(_) => c,
            surface => {
                let (u0, u1) = surface.domain();
                let (_, v1) = surface.domain();
                let u_mid = 0.5 * (u0[0] + u0[1]);
                let v_mid = 0.5 * (v1[0] + v1[1]);
                surface.param(u_mid, v_mid)
            }
        };
        if inside_solid(b, probe) {
            return None;
        }
    }
    // Outer shell keeps a's faces; the void shell is b's faces reversed so
    // their normals point into the cavity (away from the material).
    // The base keeps every shell it already had (a prior cavity stays its own
    // shell); the tool's faces reversed become one more void shell, normals
    // pointing into the cavity (away from the material).
    let void: Vec<TFace> = b_faces.iter().map(|f| flip_face(f)).collect::<Option<_>>()?;
    let mut shells = a.shells.clone();
    shells.push(Rc::new(RefCell::new(Shell { faces: void })));
    Some(Solid { shells })
}

/// A copy of any analytic face with its outward normal reversed, so a
/// subtracted tool's face becomes a wall of the resulting cavity. Planar and
/// cylindrical faces (the two a pocket tool can have) have their orientation
/// carried by their frame; a cylinder reverses by flipping `e2`, exactly as a
/// subtracted wall does in [`partial_wall`]. Any other surface returns
/// `None` -- fail closed (I-1): an unreversed copy would ADD the void's
/// volume and hand back a closed wrong solid.
pub(crate) fn flip_face(face: &TFace) -> Option<TFace> {
    let fb = face.borrow();
    match &fb.surface {
        Surface::Plane(p) => {
            let flipped = Plane { origin: p.origin, n: scale(p.n, -1.0), u: p.u, v: p.v };
            // Keep the ORIGINAL boundary wires: rebuilding from a vertex ring
            // collapses a face with holes (a revolve tool's annulus has an
            // outer and an inner wire, each a single closed circle), losing
            // its area and hence the cavity's volume. Only the surface's
            // outward normal is reversed; the wires are geometry, not
            // orientation, and read correctly either way.
        Some(Rc::new(RefCell::new(Face {
                boundary: fb.boundary.clone(),
                forward: fb.forward,
                surface: Surface::Plane(flipped),
                uv_domain: fb.uv_domain,
        })))
        }
        Surface::Cylinder(cy) => {
            // A cross-bore trim (geom::Cross) is not a rectangle in (u, v); a
            // flip would need its own pcurves. Refuse rather than flip wrongly.
            if cy.cross.is_some() {
                return None;
            }
            let mut uses = Vec::new();
            for w in &fb.boundary {
                for u in &w.borrow().edges {
                    uses.push(u.clone());
                }
            }
            // Flipping e2 turns p(u) = R(e1 cos u + e2 sin u) into the point
            // at angle -u, which reverses the surface's normal -- but it also
            // MIRRORS a partial arc (an angular range [a, a+s] would land on
            // the opposite half of the circle, the groove-half bug). Reflect
            // the range too so the flipped wall covers the SAME arc points in
            // reverse, keeping it shared with the neighbouring caps.
            let arc = cy.arc.as_ref().map(|a| crate::geom::ArcRange {
                start: -(a.start + a.span),
                span: a.span,
            });
            let surf = Surface::Cylinder(Cylinder {
                origin: cy.origin,
                axis: cy.axis,
                e1: cy.e1,
                e2: scale(cy.e2, -1.0),
                radius: cy.radius,
                vmin: cy.vmin,
                vmax: cy.vmax,
                arc, cross: None,
            });
 Some(make_face(surf, fb.uv_domain, uses))
 }
 Surface::Cone(c) => {
 let mut uses = Vec::new();
 for w in &fb.boundary {
 for u in &w.borrow().edges {
 uses.push(u.clone());
 }
 }
 Some(make_face(
 Surface::Cone(Cone {
 base: c.base,
 axis: c.axis,
 e1: c.e1,
 e2: scale(c.e2, -1.0),
 base_radius: c.base_radius,
 half_angle: c.half_angle,
 slant: c.slant,
 v_range: c.v_range,
 }),
 fb.uv_domain,
 uses,
 ))
 }
 // A whole-turn sphere zone reverses by flipping `e2`, like the cone: the point at angle u
 // becomes the point at -u, and the normal du x dv turns inward. A sphere with a partial
 // turn or a polar-square trim would need its range mirrored too, so it still fails closed.
 Surface::Sphere(sp)
 if sp.trim.is_none() && (sp.u_range[1] - sp.u_range[0] - TWO_PI).abs() < 1e-9 && sp.u_range[0].abs() < 1e-9 =>
 {
 let mut uses = Vec::new();
 for w in &fb.boundary {
 for u in &w.borrow().edges {
 uses.push(u.clone());
 }
 }
 Some(make_face(
 Surface::Sphere(crate::geom::SphereSurf { e2: scale(sp.e2, -1.0), ..sp.clone() }),
 fb.uv_domain,
 uses,
 ))
 }
 // Fail closed (I-1): a surface with no reversal arm must refuse,
        // never return an unreversed copy -- the subtracted void's volume
        // would be ADDED, and the wrong solid is closed, with 0 open edges.
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build;

    fn show(op: &str, a: &TSolid, b: &TSolid, label: &str) {
        match boolean(op, a, b) {
            None => println!("{label}: REFUSED"),
            Some(s) => {
                let bb = build::solid_aabb(&s);
                println!(
                    "{label}: faces={} vol={:.6} bbox={:?}..{:?}",
                    s.faces().len(),
                    build::solid_volume(&s),
                    bb.lo,
                    bb.hi
                );
                for (i, f) in s.faces().iter().enumerate() {
                    let fb = f.borrow();
                    let (area, c) = build::face_area_centroid(&fb);
                    let sn = match &fb.surface {
                        Surface::Plane(_) => "plane",
                        Surface::Cylinder(_) => "cyl",
                        Surface::Sphere(_) => "sphere",
                        Surface::Cone(_) => "cone",
                        Surface::Torus(_) => "torus",
                    };
                    println!("   f{i} area={area:.6} centroid={c:?} {sn} n={:?}", match &fb.surface {
                        Surface::Plane(p) => p.n,
                        _ => [0.0, 0.0, 0.0],
                    });
                    if let Surface::Cylinder(cy) = &fb.surface {
                        let aa = fb.surface.aabb();
                        println!("      cyl origin={:?} axis={:?} vmin={} vmax={} aabb={:?}..{:?}", cy.origin, cy.axis, cy.vmin, cy.vmax, aa.lo, aa.hi);
                        let lo2 = crate::math::add(cy.origin, crate::math::scale(cy.axis, cy.vmin));
                        let hi2 = crate::math::add(cy.origin, crate::math::scale(cy.axis, cy.vmax));
                        println!("      expected z {}..{} (lo2={:?} hi2={:?})", lo2[2] - cy.radius, hi2[2] + cy.radius, lo2, hi2);
                    }
                    let fb2 = fb;
                    let mut one = crate::math::Aabb::empty();
                    for p in build::face_ring_points(&fb2) { one.expand(p); }
                    println!("      ring aabb={:?}..{:?} boundary_wires={}", one.lo, one.hi, fb2.boundary.len());
                    if let Surface::Plane(pp) = &fb2.surface {
                        for (wi, w) in fb2.boundary.iter().enumerate() {
                            let mut uv = Vec::new();
                            let mut curve_kinds = Vec::new();
                            for u in &w.borrow().edges {
                                let eb = u.edge.borrow();
                                let pk = if u.forward { eb.a.borrow().point } else { eb.b.borrow().point };
                                uv.push(pp.project(pk));
                                curve_kinds.push(match &eb.curve { Curve::Circle { .. } => "C", Curve::Arc { .. } => "A", _ => "L" }.to_string());
                            }
                            println!("        wire {wi} kinds={:?} signed2={:.3} pts={:?}", curve_kinds, signed_area2(&uv), uv);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn debug_boolean_cut() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let b = build::cylinder_solid([0.0, 0.0, 0.0], 8.0, 40.0, [0.0, 0.0, 1.0]);
        show("subtract", &a, &b, "cut");
    }

    #[test]
    fn debug_boolean_cut_x() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let t = crate::math::Transform::euler_deg(0.0, 90.0, 0.0);
        let c = build::cylinder_solid([0.0, 0.0, 0.0], 5.0, 60.0, [0.0, 0.0, 1.0]);
        let c = build::transform_solid(&c, &t);
        show("subtract", &a, &c, "cutx");
    }

    #[test]
    fn debug_wall_aabb() {
        let cy = crate::geom::Cylinder {
            origin: [0.0, 0.0, -20.0],
            axis: [0.0, 0.0, 1.0],
            e1: [1.0, 0.0, 0.0],
            e2: [0.0, 1.0, 0.0],
            radius: 8.0,
            vmin: 0.0,
            vmax: 40.0,
            arc: None, cross: None,
        };
        let w = partial_wall(&cy, 10.0, 30.0, false);
        let wa = w.borrow();
        let aa = wa.surface.aabb();
        println!("wall aabb {:?}..{:?}", aa.lo, aa.hi);
        if let Surface::Cylinder(c2) = &wa.surface {
            println!("wall cyl vmin={} vmax={} origin={:?}", c2.vmin, c2.vmax, c2.origin);
        }
    }

    #[test]
    fn debug_nonconvex() {
        let pts = [[0.0, 0.0], [40.0, 0.0], [40.0, 10.0], [10.0, 10.0], [10.0, 30.0], [0.0, 30.0]];
        let mut segs = Vec::new();
        for i in 0..pts.len() {
            segs.push(crate::build::ProfileSeg::Line { a: pts[i], b: pts[(i + 1) % pts.len()] });
        }
        let a = build::extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 10.0])
            .expect("debug fixture profile closes");
        let c = build::cylinder_solid([5.0, 20.0, 5.0], 3.0, 30.0, [0.0, 0.0, 1.0]);
        show("subtract", &a, &c, "nonconvex");
    }

    #[test]
    fn debug_tangent_sub() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let c = build::cylinder_solid([30.0, 0.0, 0.0], 10.0, 40.0, [0.0, 0.0, 1.0]);
        for (i, f) in a.faces().iter().enumerate() {
            let mut out = Vec::new();
            let r = process_face(f, &c, "subtract", true, &mut out);
            eprintln!("A face {i}: {:?} -> {} faces", r.is_some(), out.len());
        }
        for (i, f) in c.faces().iter().enumerate() {
            let mut out = Vec::new();
            let r = process_face(f, &a, "subtract", false, &mut out);
            eprintln!("B face {i}: {:?} -> {} faces", r.is_some(), out.len());
        }
        show("subtract", &a, &c, "tan-sub");
    }

    #[test]
    fn debug_which_refuses() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let c = build::cylinder_solid([30.0, 0.0, 0.0], 10.0, 20.0, [0.0, 0.0, 1.0]);
        for (i, f) in a.faces().iter().enumerate() {
            let mut out = Vec::new();
            let r = process_face(f, &c, "union", true, &mut out);
            println!("A face {i}: {:?} -> {} faces", r.is_some(), out.len());
        }
        for (i, f) in c.faces().iter().enumerate() {
            let mut out = Vec::new();
            let r = process_face(f, &a, "union", false, &mut out);
            println!("B face {i}: {:?} -> {} faces", r.is_some(), out.len());
        }
    }

    /// W0: a boolean must not emit two DIFFERENT edge handles for the same
    /// seam curve. `build_mixed_face` (wall arcs) and `polar_hole_wire`
    /// (sphere hole arcs) each construct their own copy of the same circle,
    /// so today a wall and the trimmed sphere face hold separate `Rc` edges
    /// along one seam and the corner vertices are duplicated. Volume, area,
    /// bbox and face count cannot see it -- a `between` name on that seam
    /// cannot resolve, because no SINGLE edge is used by both faces.
    #[test]
    fn boolean_seam_edges_are_shared_not_duplicated() {
        let s = build::sphere_solid([0.0, 0.0, 0.0], 15.0, [0.0, 0.0, 1.0]);
        let b = build::box_solid([10.0, 10.0, 40.0], [0.0, 0.0, 0.0], None);
        let result = boolean("subtract", &s, &b).expect("sphere-minus-box must not refuse");
        let edges = result.edges();
        let mut dupes = 0;
        for i in 0..edges.len() {
            for j in (i + 1)..edges.len() {
                let (ei, ej) = (edges[i].borrow(), edges[j].borrow());
                if same_edge_geometry(&ei, &ej) {
                    dupes += 1;
                    eprintln!(
                        "duplicate seam edge: {:?} vs {:?}",
                        ei.curve.point_at(0.0),
                        ej.curve.point_at(0.0)
                    );
                }
            }
        }
        assert_eq!(dupes, 0, "{dupes} duplicated seam edge(s) -- not a shared B-rep shell");
        // The seam edge of a wall must be used by BOTH the wall and the
        // trimmed sphere face: one handle, two face uses.
        let mut seam_uses: Vec<usize> = Vec::new();
        for f in result.faces() {
            for w in &f.borrow().boundary {
                for u in &w.borrow().edges {
                    if seam_uses.iter().any(|k| topo::same(&edges[*k], &u.edge)) {
                        continue;
                    }
                    if matches!(&u.edge.borrow().curve, Curve::Arc { .. }) {
                        seam_uses.push(edges.iter().position(|e| topo::same(e, &u.edge)).unwrap());
                    }
                }
            }
        }
        for k in seam_uses {
            let uses = result
                .faces()
                .iter()
                .flat_map(|f| {
                    f.borrow()
                        .boundary
                        .iter()
                        .flat_map(|w| w.borrow().edges.clone())
                        .collect::<Vec<_>>()
                })
                .filter(|u| topo::same(&edges[k], &u.edge))
                .count();
            assert_eq!(uses, 2, "seam edge at {:?} is used {uses} time(s), want 2", edges[k].borrow().curve.point_at(0.0));
        }
    }

    /// SPEC-brep-combine-sphere.md: sphere r15 minus box 10x10x40, both
    /// centered at the origin. Pinned math (lead-verified against OCCT to
    /// 1e-9): volume 11251.351911..., faces 5, bbox x/y in [-15,15], z in
    /// [-sqrt(200), sqrt(200)].
    #[test]
    fn sphere_minus_box_matches_pinned_math() {
        let s = build::sphere_solid([0.0, 0.0, 0.0], 15.0, [0.0, 0.0, 1.0]);
        let b = build::box_solid([10.0, 10.0, 40.0], [0.0, 0.0, 0.0], None);
        let result = boolean("subtract", &s, &b).expect("sphere-minus-box must not refuse");

        assert_eq!(result.faces().len(), 5, "expected 4 walls + 1 trimmed sphere face");

        let vol = build::solid_volume(&result);
        let expected_vol = (4.0 / 3.0) * std::f64::consts::PI * 15f64.powi(3)
            - box_minus_sphere_cap_volume(15.0, 5.0);
        assert!(
            (vol - expected_vol).abs() <= 1e-6 * expected_vol,
            "volume {vol} vs closed-form {expected_vol}"
        );
        // Cross-check against the lead-pinned OCCT number directly.
        assert!((vol - 11251.351911).abs() <= 1e-4, "volume {vol} vs OCCT 11251.351911");

        let bb = build::solid_aabb(&result);
        let expect_xy = 15.0;
        // sqrt(R^2 - h^2): the wall arc's own peak, the tight z extreme
        // (SPEC pinned math -- NOT sqrt(R^2 - 2h^2), which is the corner).
        let zmax = (225.0 - 25.0f64).sqrt();
        for i in 0..2 {
            assert!((bb.lo[i] + expect_xy).abs() <= 1e-6, "bbox lo[{i}]={:?}", bb.lo);
            assert!((bb.hi[i] - expect_xy).abs() <= 1e-6, "bbox hi[{i}]={:?}", bb.hi);
        }
        assert!((bb.lo[2] + zmax).abs() <= 1e-6, "bbox z lo {:?} vs -{zmax}", bb.lo);
        assert!((bb.hi[2] - zmax).abs() <= 1e-6, "bbox z hi {:?} vs {zmax}", bb.hi);
    }

    /// The volume removed from a sphere of radius `r` by an infinite square
    /// tube of half-width `h` centered on the sphere: twice the spherical
    /// cap volume above `z = sqrt(r^2 - 2h^2)`... computed here instead by
    /// direct double integration (independent of the kernel under test), so
    /// the pinned OCCT number is the real cross-check and this is a sanity
    /// bound, not the source of truth.
    fn box_minus_sphere_cap_volume(r: f64, h: f64) -> f64 {
        // V_removed = integral over |x|,|y|<=h of 2*sqrt(r^2-x^2-y^2) dx dy
        // (both caps). 64x64 midpoint rule is far more than enough at 1e-6.
        let n = 400;
        let step = 2.0 * h / n as f64;
        let mut acc = 0.0;
        for i in 0..n {
            let x = -h + step * (i as f64 + 0.5);
            for j in 0..n {
                let y = -h + step * (j as f64 + 0.5);
                let z2 = r * r - x * x - y * y;
                if z2 > 0.0 {
                    acc += 2.0 * z2.sqrt();
                }
            }
        }
        acc * step * step
    }

    #[test]
    fn debug_tangent() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let c = build::cylinder_solid([30.0, 0.0, 0.0], 10.0, 20.0, [0.0, 0.0, 1.0]);
        show("union", &a, &c, "tan-union");
    }

    /// SPEC-brep-pocket.md: a tool strictly inside a base is one inner void.
    /// box 40x40x20 minus a fully-enclosed 10x8x5 box (its own volume 400) is
    /// 32000 - 400, with exactly base+tool = 12 faces (6 outer + 6 void).
    #[test]
    fn enclosed_box_cavity_volume_and_faces() {
        let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let tool = build::box_solid([10.0, 8.0, 5.0], [0.0, 0.0, -2.5], None);
        let result = boolean("subtract", &base, &tool).expect("enclosed cavity must not refuse");
        assert_eq!(result.faces().len(), 12, "6 outer + 6 inner void faces");
        let vol = build::solid_volume(&result);
        assert!((vol - (32000.0 - 400.0)).abs() <= 1e-6 * 32000.0, "volume {vol}");
        // bbox equals the base's own (the void is strictly inside).
        let bb = build::solid_aabb(&result);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0]);
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
    }

    /// SPEC-brep-pocket.md: box 60x60x8 minus a fully-enclosed cylinder r5 h5
    /// is 28800 - 125*pi, with 6 + 3 = 9 faces (the lateral cylinder stays an
    /// analytic partial wall, not facets).
    #[test]
    fn enclosed_cylinder_cavity_volume_and_faces() {
        let base = build::box_solid([60.0, 60.0, 8.0], [0.0, 0.0, 4.0], None);
        let tool = build::cylinder_solid([12.0, -6.0, 3.5], 5.0, 5.0, [0.0, 0.0, 1.0]);
        let result = boolean("subtract", &base, &tool).expect("enclosed cylinder cavity must not refuse");
        assert_eq!(result.faces().len(), 9, "6 outer + 3 void (wall + 2 caps)");
        let want = 28800.0 - 125.0 * std::f64::consts::PI;
        let vol = build::solid_volume(&result);
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
}

    /// S4i (1): the same solid twice. Identity is proven by geometry; union and intersection are a
    /// copy of it, the difference is empty (a refusal), and a different solid of EQUAL volume is
    /// not mistaken for it.
    #[test]
    fn coincident_operands_union_and_intersect_are_a_copy_and_subtract_is_empty() {
        let pi = std::f64::consts::PI;
        let cases: Vec<(&str, TSolid, TSolid, f64)> = vec![
            ("box", build::box_solid([20.0, 30.0, 40.0], [1.0, 2.0, 3.0], None), build::box_solid([20.0, 30.0, 40.0], [1.0, 2.0, 3.0], None), 24000.0),
            ("cylinder", build::cylinder_solid([0.0; 3], 10.0, 30.0, [0.0, 0.0, 1.0]), build::cylinder_solid([0.0; 3], 10.0, 30.0, [0.0, 0.0, 1.0]), pi * 100.0 * 30.0),
            ("sphere", build::sphere_solid([0.0; 3], 10.0, [0.0, 0.0, 1.0]), build::sphere_solid([0.0; 3], 10.0, [0.0, 0.0, 1.0]), 4.0 / 3.0 * pi * 1000.0),
            ("cone", build::cone_solid([0.0; 3], 10.0, 30.0, [0.0, 0.0, 1.0]), build::cone_solid([0.0; 3], 10.0, 30.0, [0.0, 0.0, 1.0]), pi * 100.0 * 10.0),
        ];
        for (name, a, b, v) in &cases {
            assert!(solids_identical(a, b), "{name} identical to its twin");
            for op in ["union", "intersect"] {
                let r = boolean(op, a, b).unwrap_or_else(|| panic!("{name} {op} of coincident operands must build"));
                assert_eq!(r.faces().len(), a.faces().len(), "{name} {op}: face count");
                let vol = build::solid_volume(&r);
                assert!((vol - v).abs() <= 1e-9 * v, "{name} {op}: {vol} vs {v}");
            }
            assert!(boolean("subtract", a, b).is_none(), "{name}: cutting a solid from itself is empty, a refusal");
        }
        // equal volume, different shape: never identical
        let p = build::box_solid([20.0, 30.0, 40.0], [0.0; 3], None);
        let q = build::box_solid([30.0, 20.0, 40.0], [0.0; 3], None);
        assert!(!solids_identical(&p, &q));
        // a cylinder off by 1e-6 in radius is not identical either
        let c1 = build::cylinder_solid([0.0; 3], 10.0, 30.0, [0.0, 0.0, 1.0]);
        let c2 = build::cylinder_solid([0.0; 3], 10.000001, 30.0, [0.0, 0.0, 1.0]);
        assert!(!solids_identical(&c1, &c2));
        // a shifted copy is not identical
        let c3 = build::cylinder_solid([1e-6, 0.0, 0.0], 10.0, 30.0, [0.0, 0.0, 1.0]);
        assert!(!solids_identical(&c1, &c3));
    }

/// K0a regression pin (I-1): a 40^3 box minus an ENCLOSED r5 sphere.
/// flip_face has no Sphere arm, so the cavity's faces cannot be reversed:
/// the case must refuse, or be exact at 63476.4012 (= 64000 - 4/3*pi*5^3).
/// The pre-fix fall-through returned the sphere UNREVERSED and built
/// 64523.5988 with refusals empty -- the void's volume ADDED -- a closed
/// wrong solid with 0 open edges, which every guard waved through.
#[test]
fn enclosed_sphere_cavity_refuses_or_is_exact() {
    let base = build::box_solid([40.0, 40.0, 40.0], [0.0, 0.0, 0.0], None);
    let tool = build::sphere_solid([0.0, 0.0, 0.0], 5.0, [0.0, 0.0, 1.0]);
    match boolean("subtract", &base, &tool) {
        None => {} // refused: honest, the sphere has no reversal arm
        Some(s) => {
            let vol = build::solid_volume(&s);
            assert!(
                (vol - 64523.5988).abs() > 1.0,
                "C6 returned the KNOWN WRONG solid {vol} (64523.5988): flip_face handed back an unreversed face and the void's volume was ADDED"
            );
            assert!(
                (vol - 63476.4012).abs() <= 1e-6 * 63476.4012,
                "C6 built {vol}; the only buildable answer is the exact 63476.4012"
            );
        }
    }
}

    /// SPEC-brep-pocket.md: a pocket tool is a prism swept NEGATIVE along the
    /// plane normal, which can turn the prism inside out. Its volume must stay
    /// positive and equal the profile area times depth.
    #[test]
    fn negative_sweep_tool_is_outward() {
        let segs = vec![
            build::ProfileSeg::Line { a: [-5.0, -4.0], b: [5.0, -4.0] },
            build::ProfileSeg::Line { a: [5.0, -4.0], b: [5.0, 4.0] },
            build::ProfileSeg::Line { a: [5.0, 4.0], b: [-5.0, 4.0] },
            build::ProfileSeg::Line { a: [-5.0, 4.0], b: [-5.0, -4.0] },
        ];
        let tool = build::extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -5.0])
            .expect("test profile closes");
        // extrude_profile's walls read the profile's winding, so a negative
        // sweep is outward too (not inside-out), and its volume is positive.
        assert!(
            build::signed_volume(&tool) > 0.0,
            "a negative-sweep prism must still wind outward"
        );
        let fixed = build::ensure_outward(&tool);
        assert!(
            (build::solid_volume(&fixed) - 400.0).abs() <= 1e-6,
            "tool volume {:?}",
            build::solid_volume(&fixed)
        );
        assert!(
            (build::solid_aabb(&fixed).lo[2] + 5.0).abs() < 1e-9,
            "the tool must occupy z in [-5, 0]"
        );
    }
}


/// Watertight check mirroring the mesh gate: every welded directed edge must
/// have exactly one opposite partner.
pub fn check_watertight(m: &crate::mesh::Mesh) -> bool {
    let key = |p: [f64; 3]| [(p[0] / 1e-6).round() as i64, (p[1] / 1e-6).round() as i64, (p[2] / 1e-6).round() as i64];
    let mut wid = std::collections::HashMap::new();
    let mut canon = vec![0usize; m.positions.len()];
    for (i, p) in m.positions.iter().enumerate() {
        let n = wid.len();
        canon[i] = *wid.entry(key(*p)).or_insert(n);
    }
    let mut dir: std::collections::HashMap<(usize, usize), i32> = std::collections::HashMap::new();
    for t in m.indices.chunks(3) {
        let ids = [canon[t[0] as usize], canon[t[1] as usize], canon[t[2] as usize]];
        for e in 0..3 {
            let (u, v) = (ids[e], ids[(e + 1) % 3]);
            if u != v {
                *dir.entry((u, v)).or_insert(0) += 1;
            }
        }
    }
    let mut open = 0usize;
    for (&(u, v), &c) in &dir {
        if dir.get(&(v, u)).copied().unwrap_or(0) != c {
            open += 1;
            if open <= 8 {
                let find = |id: usize| -> [f64; 3] {
                    for (i, p) in m.positions.iter().enumerate() {
                        if canon[i] == id { return *p; }
                    }
                    [0.0; 3]
                };
                eprintln!("  open edge {}->{} c={} at {:?} / {:?}", u, v, c, find(u), find(v));
            }
        }
    }
    eprintln!("  open directed edges: {open}");
    open == 0
}

/// Ground rule 2, made checkable. A produced solid is CLOSED and the right
/// size only if every check below holds; this returns every one that does not,
/// because an open shell usually breaks several at once and WHICH ones is the
/// diagnosis. Empty means closed and exact.
///   1. volume equals the caller's independently derived closed form;
///   2. volume is translation invariant, `|V(r) - V(r+t)| <= 1e-9*V` for
///      t = (37, -23, 11): the divergence-theorem sum is origin-free over a
///      closed shell and moves by t.(integral of n dA)/3 over an open one;
///   3. no edge handle is used exactly once (`once_used_edges`): `boolean`'s
///      {1, 2} guard admits a count of 1, so it cannot see an open rim;
///   4. the 0.05 tessellation is watertight (`check_watertight`);
///   5. the bounding box is exactly `want_lo`..`want_hi`.
#[cfg(test)]
fn closed_failures(s: &TSolid, want_vol: f64, want_lo: Vec3, want_hi: Vec3) -> Vec<String> {
    let mut bad: Vec<String> = Vec::new();
    let v = build::solid_volume(s);
    if (v - want_vol).abs() > 1e-9 * want_vol.abs().max(1.0) {
        bad.push(format!("volume {v} != closed form {want_vol}"));
    }
    let moved = build::transform_solid(s, &crate::math::Transform::translation([37.0, -23.0, 11.0]));
    let vm = build::solid_volume(&moved);
    if (vm - v).abs() > 1e-9 * v.abs().max(1.0) {
        bad.push(format!("volume is not translation invariant: {v} -> {vm} (the shell is not closed)"));
    }
    let open = once_used_edges(&s.faces());
    if !open.is_empty() {
        bad.push(format!("{} edge handle(s) used exactly once (an open rim)", open.len()));
    }
    match crate::mesh::mesh_solid(s, 0.05) {
        Some(m) => {
            if !check_watertight(&m) {
                bad.push("tessellation is not watertight".to_string());
            }
        }
        None => bad.push("tessellation refused".to_string()),
    }
    let bb = build::solid_aabb(s);
    if (0..3).any(|k| (bb.lo[k] - want_lo[k]).abs() > 1e-9 || (bb.hi[k] - want_hi[k]).abs() > 1e-9) {
        bad.push(format!("bbox {:?}..{:?} != {:?}..{:?}", bb.lo, bb.hi, want_lo, want_hi));
    }
    bad
}

/// `closed_failures`, asserted: one panic listing every check that failed.
#[cfg(test)]
fn assert_closed(what: &str, s: &TSolid, want_vol: f64, want_lo: Vec3, want_hi: Vec3) {
    let bad = closed_failures(s, want_vol, want_lo, want_hi);
    assert!(bad.is_empty(), "{what} is not a closed, exact solid:\n  - {}", bad.join("\n  - "));
}

/// K-H: the harness must be able to fail. A box is closed (every edge handle
/// used twice); take one face away and exactly its four edges are used once.
#[test]
fn closedness_harness_counts_the_rim_of_a_missing_face() {
    let s = build::box_solid([10.0, 20.0, 30.0], [1.0, 2.0, 3.0], None);
    assert!(once_used_edges(&s.faces()).is_empty(), "a box is closed");
    let mut faces = s.faces();
    faces.pop();
    assert_eq!(once_used_edges(&faces).len(), 4, "a missing quad leaves its four edges used once");
}

/// G1: the production closure guard sees an open rim. A closed box has none;
/// a box missing a face leaves its four edges unmatched, and nothing pairs them.
#[test]
fn closure_guard_flags_an_open_shell_and_passes_a_closed_one() {
    let s = build::box_solid([10.0, 20.0, 30.0], [1.0, 2.0, 3.0], None);
    assert!(unmatched_once_edges(&s.faces()).is_empty(), "a closed box has no open rim");
    let mut faces = s.faces();
    faces.pop();
    assert_eq!(unmatched_once_edges(&faces).len(), 4, "a missing face leaves four open edges");
}

/// G1: a cylinder with one cap removed is open, and the circle rim left behind
/// is NOT excused as a missing rim handle: no curved face carries it twice.
#[test]
fn closure_guard_flags_a_cylinder_missing_a_cap() {
    let s = build::cylinder_solid([0.0, 0.0, 0.0], 5.0, 10.0, [0.0, 0.0, 1.0]);
    assert!(unmatched_once_edges(&s.faces()).is_empty(), "a closed cylinder has no open rim");
    let mut faces: Vec<TFace> = s.faces();
    let cap = faces
        .iter()
        .position(|f| matches!(f.borrow().surface, Surface::Plane(_)))
        .expect("a cylinder has a planar cap");
    faces.remove(cap);
    // The wall still lies on the removed cap's circle, so the retain rule would
    // excuse it unless the wall's own rim handle is present: it is, and used once.
    assert!(!unmatched_once_edges(&faces).is_empty(), "a missing cap must leave an open rim");
}

/// K-H: and it must be able to pass. A box at a non-origin centre against its
/// closed form and exact bbox.
#[test]
fn closedness_harness_accepts_a_closed_box() {
    let s = build::box_solid([10.0, 20.0, 30.0], [1.0, 2.0, 3.0], None);
    assert_closed("box", &s, 6000.0, [-4.0, -8.0, -12.0], [6.0, 12.0, 18.0]);
}

/// K-H: a shell with a face missing is refused, and the message names the rim.
#[test]
#[should_panic(expected = "used exactly once")]
fn closedness_harness_rejects_an_open_shell() {
    let s = build::box_solid([10.0, 20.0, 30.0], [1.0, 2.0, 3.0], None);
    let mut faces = s.faces();
    faces.pop();
    let open = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
    assert_closed("open box", &open, 6000.0, [-4.0, -8.0, -12.0], [6.0, 12.0, 18.0]);
}

/// K-H: the seven measured cases of the brep-fix plan (section 0), pinned in the
/// repo's own convention for a known defect (`spike_`, plain red tests): each
/// asserts the CORRECT closed form, so it is red for as long as its defect is
/// live. As of K-H (2026-09-30) C0, C2 and C6 are red; C1, C3, C4 and C5 pass
/// by refusing.
///
/// Every case is a ModelDoc, the JSON `runScript()` hands `build_doc_json`, so a
/// pin runs the path a student's script runs rather than a hand-built solid.
/// Every case is EXACT-OR-REFUSED (ground rule 1): a refusal in a sentence is a
/// pass, because turning a wrong solid into an honest refusal is what a slice
/// may do; the exact value closes the case properly. Every case is built twice,
/// at the origin and shifted by t = (37, -23, 11): C2's error moved by 3.1e-2
/// under exactly that shift, so a fixture that passes in one frame proves
/// nothing. Closed forms are OCCT-refereed (ground rule 4), never read off
/// brep-rs.
#[cfg(test)]
mod closedness_pins {
    use super::*;
    use serde_json::{json, Value};

    const SHIFT: Vec3 = [37.0, -23.0, 11.0];
    /// The L-bracket's bbox; C1-C5 only remove material inside it.
    const BRACKET_LO: Vec3 = [-20.0, -15.0, -15.0];
    const BRACKET_HI: Vec3 = [20.0, 15.0, 5.0];

    /// What the pin REQUIRES of its case, as distinct from what the case
    /// happens to do today.
    ///
    /// Until this existed, `pin()` reported a case as passing whether it built
    /// the right solid OR refused -- so a pin whose case had regressed into an
    /// honest refusal read exactly like a pin whose case was repaired. Two
    /// consequences, both bad: a slice could claim a fix that was really a new
    /// refusal, and a suite could be green for the wrong reason. Declaring the
    /// requirement here means a slice that intends to fix a case must flip its
    /// pin to `Exact`, and from that moment the pin fails if the case still
    /// refuses. (msgbox #429.)
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    enum Want {
        /// The case must build, and build exactly. A refusal is a FAILURE.
        Exact,
        /// The case must build exactly OR refuse with a plain sentence. Honest
        /// either way. Used only where refusal is the documented current state.
        ExactOrRefused,
    }

    struct Pin {
        name: &'static str,
        /// What is wrong today; for a case that refuses today, what a failure
        /// would mean.
        known: &'static str,
        doc: fn(Vec3) -> Value,
        /// The feature whose solid is under test.
        last: &'static str,
        want: Want,
        vol: f64,
        lo: Vec3,
        hi: Vec3,
    }

    fn doc(features: Vec<Value>) -> Value {
        json!({ "version": 1, "features": features })
    }

    fn subtract(id: &str, from: &str, tool: &str) -> Value {
        json!({ "id": id, "kind": "combine", "op": "subtract", "targets": [from, tool] })
    }

    /// A 40x30x10 plate under a 20x20x10 block, joined (op1). Volume 16000.
    fn bracket(t: Vec3) -> Vec<Value> {
        vec![
            json!({ "id": "box1", "kind": "box", "size": [40, 30, 10], "center": [t[0], t[1], t[2] - 10.0] }),
            json!({ "id": "box2", "kind": "box", "size": [20, 20, 10], "center": t }),
            json!({ "id": "op1", "kind": "combine", "op": "union", "targets": ["box1", "box2"] }),
        ]
    }

    /// The oblique triangular prism of C0 and C1 (move1): a sketch on the front
    /// plane, pulled 110, moved.
    fn prism(t: Vec3) -> Vec<Value> {
        vec![
            json!({ "id": "sk1", "kind": "sketch", "plane": "xz", "offset": 0, "points": [[2, 1], [-2, 1], [2, -3]] }),
            json!({ "id": "pull1", "kind": "extrude", "target": "sk1", "height": 110 }),
            json!({ "id": "move1", "kind": "move", "target": "pull1", "offset": [8.0 + t[0], 55.0 + t[1], 4.0 + t[2]], "copy": false }),
        ]
    }

    /// The bracket minus a box tool (op2).
    fn bracket_minus_box(t: Vec3, size: Vec3, at: Vec3) -> Value {
        let mut f = bracket(t);
        f.push(json!({ "id": "box3", "kind": "box", "size": size, "center": add(at, t) }));
        f.push(subtract("op2", "op1", "box3"));
        doc(f)
    }

    fn c0(t: Vec3) -> Value {
        let mut f = vec![json!({ "id": "box1", "kind": "box", "size": [20, 20, 10], "center": t })];
        f.extend(prism(t));
        f.push(subtract("op1", "box1", "move1"));
        doc(f)
    }

    fn c1(t: Vec3) -> Value {
        let mut f = bracket(t);
        f.extend(prism(t));
        f.push(subtract("op2", "op1", "move1"));
        doc(f)
    }

    fn c2(t: Vec3) -> Value {
        bracket_minus_box(t, [8.0, 40.0, 7.0], [11.0, 0.0, 6.5])
    }

    fn c3(t: Vec3) -> Value {
        bracket_minus_box(t, [8.0, 8.0, 8.0], [0.0, 0.0, 6.0])
    }

    /// C3's pocket authored with `pocket()`: the tool is FLUSH with the block's
    /// top (z 2..5), a different configuration from C3's at boolean level.
    fn c4(t: Vec3) -> Value {
        let mut f = bracket(t);
        let (x, y) = (t[0], t[1]);
        f.push(json!({
            "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 5.0 + t[2],
            "points": [[-4.0 + x, -4.0 + y], [4.0 + x, -4.0 + y], [4.0 + x, 4.0 + y], [-4.0 + x, 4.0 + y]],
            "constraints": [
                { "kind": "horizontal", "edge": 0 }, { "kind": "vertical", "edge": 1 },
                { "kind": "horizontal", "edge": 2 }, { "kind": "vertical", "edge": 3 },
            ],
        }));
        f.push(json!({ "id": "pocket1", "kind": "pocket", "target": "sk1", "into": "op1", "depth": 3 }));
        doc(f)
    }

    fn c5(t: Vec3) -> Value {
        bracket_minus_box(t, [6.0, 10.0, 8.0], [-15.0, 0.0, -4.0])
    }

    fn c6(t: Vec3) -> Value {
        doc(vec![
            json!({ "id": "box1", "kind": "box", "size": [40, 40, 40], "center": t }),
            json!({ "id": "ball1", "kind": "sphere", "radius": 5, "center": t }),
            subtract("op1", "box1", "ball1"),
        ])
    }

    /// Build `last`, or return the sentence it was refused with. A case that
    /// built NEITHER is a malformed pin, and exact-or-refused would pass it
    /// vacuously, so that panics.
    fn build_case(doc: &Value, last: &str) -> Result<TSolid, String> {
        let (hist, refusals) = crate::wasm::build_doc(doc);
        if let Some(s) = hist.shapes.get(last) {
            return Ok(s.clone());
        }
        match refusals.get(last).and_then(|r| r.as_str()) {
            Some(sentence) if !sentence.is_empty() => Err(sentence.to_string()),
            _ => panic!("the case built neither a solid nor a refusal for {last}; refusals: {refusals:?}"),
        }
    }

    fn pin(p: &Pin) {
        let mut bad: Vec<String> = Vec::new();
        for t in [[0.0, 0.0, 0.0], SHIFT] {
            match build_case(&(p.doc)(t), p.last) {
                Err(sentence) => match p.want {
                    Want::Exact => bad.push(format!(
                        "at shift {t:?}: REFUSED ({sentence}) but this pin requires an exact build"
                    )),
                    Want::ExactOrRefused => {
                        eprintln!("{} at shift {t:?} is refused: {sentence}", p.name)
                    }
                },
                Ok(s) => {
                    for b in closed_failures(&s, p.vol, add(p.lo, t), add(p.hi, t)) {
                        bad.push(format!("at shift {t:?}: {b}"));
                    }
                }
            }
        }
        assert!(bad.is_empty(), "{} is neither exact nor refused.\nKNOWN: {}\n  - {}", p.name, p.known, bad.join("\n  - "));
    }

    /// K0b fixed the I-7 oblique-trim defect, so C0 is now BUILT and EXACT rather
    /// than refused: 3840 at origin and at SHIFT, zero once-used edges, no closure
    /// failures. K0c's translation-invariance guard is what made the crack visible
    /// first; on this case it now has nothing left to catch.
    #[test]
    fn spike_c0_block_minus_oblique_prism_is_exact_or_refused() {
        pin(&Pin {
            want: Want::Exact,
            name: "C0 block minus oblique triangular prism",
            known: "I-7: region_inside evaluated non-parallel face constants at the probe offset (~1e-6), so the oblique trims landed off the true plane and the shell cracked. K0b evaluates them at offset 0. Measured 2026-10-01: built, 3840 exact at both positions, zero once-used edges, no closure failures.",
            doc: c0,
            last: "op1",
            vol: 3840.0,
            lo: [-10.0, -10.0, -5.0],
            hi: [10.0, 10.0, 5.0],
        });
 }

 /// Refused today: a class-1 case. Exact closes it; a wrong solid reopens class 2.
    /// Refuses today (class 1). K2b -- the chamfer on a boolean result -- must flip this to
    /// `Exact`, and the pin then fails until the case builds.
    #[test]
    fn spike_c1_bracket_minus_chamfer_prism_is_exact_or_refused() {
        pin(&Pin {
            want: Want::ExactOrRefused,
            name: "C1 bracket minus chamfer prism on the block's top +x edge",
            known: "refused today (class 1). A failure means a slice turned an honest refusal into a wrong solid.",
            doc: c1,
            last: "op2",
            vol: 15840.0,
            lo: BRACKET_LO,
            hi: BRACKET_HI,
        });
    }

/// K0c refuses the known-open result; K1a fixes its I-5 region defect.
    /// Refuses today under K0c's translation-invariance guard, which turned I-5's WRONG SOLID
    /// into an honest refusal. The case is NOT exact. Option (b) (design committed at
    /// 31cbaed) must make it exact at 15880 and flip this to `Exact`. K1a tried the
    /// reach-filter route and stopped at its stop rule; see msgbox #430.
    #[test]
    fn spike_c2_bracket_minus_top_notch_is_exact_or_refused() {
        pin(&Pin {
            want: Want::ExactOrRefused,
            name: "C2 bracket minus a box notch over the block's top +x edge",
 known: "K0c refuses C2's open I-5 shell by translation invariance. K1a fixes the underlying region_inside assumption that the L-bracket is convex.",
            doc: c2,
            last: "op2",
            vol: 15880.0,
            lo: BRACKET_LO,
            hi: BRACKET_HI,
        });
    }

    /// Refuses today (class 1). No slice has claimed it. Whoever fixes it flips this to
    /// `Exact`.
    #[test]
    fn spike_c3_bracket_minus_block_top_pocket_is_exact_or_refused() {
        pin(&Pin {
            want: Want::ExactOrRefused,
            name: "C3 bracket minus a box pocket straddling the block's top face",
            known: "refused today (class 1). A failure means a slice turned an honest refusal into a wrong solid.",
            doc: c3,
            last: "op2",
            vol: 15808.0,
            lo: BRACKET_LO,
            hi: BRACKET_HI,
        });
    }

    /// Refuses today (class 1), same family as C3. No slice has claimed it.
    #[test]
    fn spike_c4_pocket_authored_with_pocket_is_exact_or_refused() {
        pin(&Pin {
            want: Want::ExactOrRefused,
            name: "C4 the C3 pocket authored with pocket() (flush tool)",
            known: "refused today (class 1). A failure means a slice turned an honest refusal into a wrong solid.",
            doc: c4,
            last: "pocket1",
            vol: 15808.0,
            lo: BRACKET_LO,
            hi: BRACKET_HI,
        });
    }

    /// Refuses today (class 1), same family as C3. No slice has claimed it.
    #[test]
    fn spike_c5_bracket_minus_plate_top_pocket_is_exact_or_refused() {
        pin(&Pin {
            want: Want::ExactOrRefused,
            name: "C5 bracket minus a box pocket in the plate's exposed top",
            known: "refused today (class 1). A failure means a slice turned an honest refusal into a wrong solid.",
            doc: c5,
            last: "op2",
            vol: 15820.0,
            lo: BRACKET_LO,
            hi: BRACKET_HI,
        });
    }

    /// KNOWN WRONG (I-1, measured 2026-09-30): 64523.5988 vs 63476.4012, refusals empty.
    /// K0a FIXED this defect, and the fix was to refuse rather than return a wrong solid:
    /// it had measured 64523.5988 against a closed form of 63476.4012, refusals empty and
    /// 0 open edges. Refusing is the honest floor, not the repair. A future slice that
    /// reverses a cone's faces properly flips this to `Exact`.
    #[test]
    fn spike_c6_box_minus_enclosed_sphere_is_exact_or_refused() {
        pin(&Pin {
            want: Want::ExactOrRefused,
            name: "C6 40^3 box minus an enclosed r5 sphere",
            known: "I-1: flip_face has Plane and Cylinder arms only, so a sphere's faces are not reversed and the void's volume is ADDED. Measured: 64523.5988 vs 63476.4012, refusals empty, 0 open edges. K0a makes flip_face fail closed.",
            doc: c6,
            last: "op1",
            vol: 64000.0 - 4.0 / 3.0 * std::f64::consts::PI * 125.0,
            lo: [-20.0, -20.0, -20.0],
            hi: [20.0, 20.0, 20.0],
        });
    }
}

/// W8: subtract of two overlapping parallel-axis cylinders. Pinned against
/// OCCT via the parity fixture boolean-cylinder-minus-cylinder
/// (10055.344981); here the volume is checked against the closed form
/// c1 + c2's overlap: V = pi*(r1^2 - lens_area/... ) — computed as
/// c1_volume - lens_volume with the lens from the intersect test's own
/// number, and the mesh must be watertight (the gate's stricter check).
#[test]
fn cylinder_cylinder_boolean_subtract() {
    let c1 = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let c2 = build::cylinder_solid([10.0, 0.0, 0.0], 8.0, 30.0, [0.0, 0.0, 1.0]);
    let result = boolean("subtract", &c1, &c2).expect("cylinder-cylinder subtract must not refuse");
    let vol = build::solid_volume(&result);
    // lens volume (verified against OCCT by the intersect fixture):
    let lens = 3516.3352821993412;
    let want = build::solid_volume(&c1) - lens;
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
    assert_eq!(result.faces().len(), 4, "2 walls + 2 lune caps");
    let m = crate::mesh::mesh_solid(&result, 0.05).expect("subtract meshes");
    assert!(check_watertight(&m), "subtract mesh must be watertight");
}

/// W8: intersect of two overlapping parallel-axis cylinders. Lens prism
/// volume pinned against OCCT (boolean-cylinder-intersect-cylinder).
#[test]
fn cylinder_cylinder_boolean_intersect() {
    let c1 = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let c2 = build::cylinder_solid([10.0, 0.0, 0.0], 8.0, 30.0, [0.0, 0.0, 1.0]);
    let result = boolean("intersect", &c1, &c2).expect("cylinder-cylinder intersect must not refuse");
    let vol = build::solid_volume(&result);
    assert!((vol - 3516.3352821993412).abs() <= 1e-6 * vol, "volume {vol}");
    assert_eq!(result.faces().len(), 4, "2 walls + 2 lens caps");
    let m = crate::mesh::mesh_solid(&result, 0.05).expect("intersect meshes");
    assert!(check_watertight(&m), "intersect mesh must be watertight");
}

/// W8: union of two overlapping parallel-axis cylinders:
/// V = c1 + c2 - lens, pinned against OCCT (boolean-cylinder-union-cylinder).
#[test]
fn cylinder_cylinder_boolean_union() {
    let c1 = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let c2 = build::cylinder_solid([10.0, 0.0, 0.0], 8.0, 30.0, [0.0, 0.0, 1.0]);
    let result = boolean("union", &c1, &c2).expect("cylinder-cylinder union must not refuse");
    let vol = build::solid_volume(&result);
    let want = build::solid_volume(&c1) + build::solid_volume(&c2) - 3516.3352821993412;
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
    assert_eq!(result.faces().len(), 4, "2 walls + 2 outer-boundary caps");
    let m = crate::mesh::mesh_solid(&result, 0.05).expect("union meshes");
    assert!(check_watertight(&m), "union mesh must be watertight");
}

/// W3 (shell on a cylinder), open-top case via the flush subtract: the
/// inner void is a cylinder of radius r − thickness and height h − t,
/// top face FLUSH with the outer cap, bottom inset by t. Outer caps keep
/// an annulus (disk with a circular hole); the void wall is the tool's
/// wall flipped. Pinned volume: pi*R^2*h − (pi*(R−t)^2*(h−t)).
#[test]
fn shell_cylinder_open_top_flush_subtract() {
    let outer = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let inner = build::cylinder_solid([0.0, 0.0, 1.0], 10.0, 28.0, [0.0, 0.0, 1.0]);
    let result = boolean("subtract", &outer, &inner).expect("open-top cylinder hollow must not refuse");
    let want = std::f64::consts::PI * 144.0 * 30.0 - std::f64::consts::PI * 100.0 * 28.0;
    let vol = build::solid_volume(&result);
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
    assert_eq!(result.faces().len(), 6, "2 outer walls + void wall + bottom cap + top annulus + void floor");
    let m = crate::mesh::mesh_solid(&result, 0.05).expect("open-top hollow meshes");
    assert!(check_watertight(&m), "open-top hollow mesh must be watertight");
}

/// W3 closed case: a fully-enclosed cylindrical void inside a cylinder is
/// one inner shell (the existing subtract_enclosed path handles it if its
/// per-face checks accept cylinders; if it refuses, the boolean still must
/// not return a wrong solid).
#[test]
fn shell_cylinder_closed_void() {
    let outer = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let inner = build::cylinder_solid([0.0, 0.0, 0.0], 10.0, 28.0, [0.0, 0.0, 1.0]);
    match boolean("subtract", &outer, &inner) {
        Some(result) => {
            let want = std::f64::consts::PI * (144.0 * 30.0 - 100.0 * 28.0);
            let vol = build::solid_volume(&result);
            assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        }
        None => {
            // An honest refusal is acceptable for the closed case; the
            // open-top path is the fixture-class one (shell-open-top).
        }
    }
}

/// SPEC-brep-hole.md: four pairwise-disjoint bores subtracted one after
/// another must give the same solid as a single fused cut. box 40x40x20
/// minus 4 x r3 through-holes at (±15, ±10): 32000 - 4*9*pi*20, 10 faces.
#[test]
fn four_disjoint_successive_cuts() {
        let mut shape = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        for c in [[-15.0, -10.0, 0.0], [15.0, -10.0, 0.0], [-15.0, 10.0, 0.0], [15.0, 10.0, 0.0]] {
            let tool = build::cylinder_solid(c, 3.0, 22.0, [0.0, 0.0, 1.0]);
            shape = boolean("subtract", &shape, &tool)
                .unwrap_or_else(|| panic!("successive disjoint cut at {c:?} refused"));
        }
        assert_eq!(shape.faces().len(), 10, "6 box + 4 bores");
        let want = 32000.0 - 4.0 * 9.0 * std::f64::consts::PI * 20.0;
        let vol = build::solid_volume(&shape);
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        let bb = build::solid_aabb(&shape);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0]);
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
    }


#[cfg(test)]
mod shell_flush_tests {
    use super::*;
    use crate::build;

    /// SPEC-brep-shell.md: the open-shell subtract is a coplanar-flush cut
    /// (inner flush with the open face's side). box 40x40x20 minus a
    /// flush-top inner 36x36x18 is 32000 - 36*36*18, on 11 faces.
    #[test]
    fn coplanar_flush_top_subtract_shell_inner() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let b = build::box_solid([36.0, 36.0, 18.0], [0.0, 0.0, 1.0], None);
        let r = boolean("subtract", &a, &b);
        assert!(r.is_some(), "flush-top inner subtract must not refuse");
        let got = r.unwrap();
        let want = 32000.0 - 36.0 * 36.0 * 18.0;
        let vol = build::solid_volume(&got);
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(got.faces().len(), 11, "5 outer + top ring + 5 inner");
    }
}

/// Coaxial bores of differing diameter. A second, smaller bore's circle lands
/// wholly inside the first bore's hole, where it removes nothing (`a - b = a`);
/// `planar_measure` sums every wire's signed area without collapsing nesting, so
/// appending it re-trimmed the cap as if the tool had bitten real material. That
/// was a silent wrong solid of exactly 60*pi on a 40x40x20 box.
///
/// Pinned by `hole_wholly_inside_inner` (the new hole already inside an existing
/// wire) and `wires_consumed_by_hole` (an existing wire swallowed by the new one,
/// which stands down whenever any wire straddles the new hole's boundary).
///
/// SPEC-brep-feature-provenance §4.3b, §4.3f.
#[test]
fn coaxial_bores_of_differing_diameter_are_exact() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let d12 = build::cylinder_solid([0.0, 0.0, 0.0], 6.0, 22.0, [0.0, 0.0, 1.0]);
    let d6 = build::cylinder_solid([0.0, 0.0, 0.0], 3.0, 22.0, [0.0, 0.0, 1.0]);
    let d8 = build::cylinder_solid([0.0, 0.0, 0.0], 4.0, 22.0, [0.0, 0.0, 1.0]);
    // A through bore of radius r leaves 32000 - pi*r^2*20 in a 40x40x20 box.
    let thru = |r: f64| 32000.0 - std::f64::consts::PI * r * r * 20.0;
    let vol = |s: &TSolid| build::solid_volume(s);
    let near = |got: f64, want: f64| (got - want).abs() <= 1e-6 * want;

    // Larger first: the d6 lands inside the d12 hole and is already void.
    let big_first = boolean("subtract", &base, &d12).expect("d12 through");
    let big_first = boolean("subtract", &big_first, &d6).expect("d6 inside d12");
    assert!(
        near(vol(&big_first), thru(6.0)),
        "d12 then d6 is the d12 bore exactly; got {}",
        vol(&big_first)
    );

    // Smaller first: the d12 swallows the d6 wire it now encloses.
    let small_first = boolean("subtract", &base, &d6).expect("d6 through");
    let grown = boolean("subtract", &small_first, &d12).expect("d12 swallows d6");
    assert!(
        near(vol(&grown), thru(6.0)),
        "d6 then d12 is the d12 bore exactly; got {}",
        vol(&grown)
    );

    // The same bore twice: a duplicate must not become a second wire.
    let twice = boolean("subtract", &small_first, &d6).expect("duplicate d6");
    assert!(
        near(vol(&twice), thru(3.0)),
        "two identical coaxial d6 bores are one d6 bore; got {}",
        vol(&twice)
    );

    // Growing in steps must land on the same solid as cutting it outright.
    let stepped = boolean("subtract", &base, &d8).expect("d8 through");
    let stepped = boolean("subtract", &stepped, &d12).expect("d12 swallows d8");
    assert!(
        near(vol(&stepped), thru(6.0)),
        "d8 then d12 is the d12 bore exactly; got {}",
        vol(&stepped)
    );
}

/// THE CLASS-2 SILENT WRONG SOLID (msgbox #329): region_inside() builds a
/// convex region from EVERY face of `other`. Once the base carries a bore,
/// that bore's void wall/floor must not constrain the next tool's region --
/// otherwise every subsequent bore's floor is silently dropped. Each blind
/// bore removes exactly pi*r^2*depth: N disjoint blind d6 depth-8 bores in a
/// 40x40x20 box give 32000 - N * 6pi * 8.
#[test]
fn successive_blind_bores_keep_every_floor() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let offs: [[f64; 3]; 4] =
        [[-15.0, -10.0, 0.0], [15.0, -10.0, 0.0], [-15.0, 10.0, 0.0], [15.0, 10.0, 0.0]];
    let mut shape = base;
    let mut want = 32000.0f64;
    for off in offs {
        let tool = build::cylinder_solid(off, 3.0, 8.0, [0.0, 0.0, 1.0]);
        let r = boolean("subtract", &shape, &tool);
        assert!(r.is_some(), "a disjoint blind bore must not refuse");
        shape = r.unwrap();
        want -= std::f64::consts::PI * 9.0 * 8.0;
        let vol = build::solid_volume(&shape);
        assert!(
            (vol - want).abs() <= 1e-6 * want,
            "bore at {off:?}: volume {vol} vs exact {want} (a lost floor is a silent wrong solid)"
        );
    }
}

/// SPIKE fixture 2026-09-28: the coplanar chamfer the boolean gets WRONG, and
/// the exit criterion for the coplanar work.
///
/// A triangular corner prism -- two of its three sides COPLANAR with the base's own
/// faces, the third (the bevel) transverse -- subtracted from a plain box is exact:
/// 31680.000000 against the closed form, and with no boolean involved at all,
/// because the box fillet path re-extrudes the cross-section. The IDENTICAL prism
/// subtracted from a BOOLEAN RESULT is not: below, the union is exact (16000) and
/// the prism is exact (880), yet `boolean` returns `Some` and the result measures
/// 15546.666766666667 against a closed-form 15840 -- a silent wrong volume, which is
/// SPEC 4.5's cardinal sin rather than a refusal.
///
/// Kept as a FAILING test on purpose. It is the measurable definition of done for
/// this work: until it passes, "chamfer any edge" is true for boxes and cylinder rims
/// and false everywhere else, and no amount of green elsewhere makes that so.
#[test]
fn spike_coplanar_chamfer_on_a_boolean_result_is_exact() {
    // An L-bracket: a 40x30x10 plate under a 20x20x10 block, touching coplanarly at
    // z = -5. The union is exact, which is what makes this a boolean-only defect.
    let plate = build::box_solid([40.0, 30.0, 10.0], [0.0, 0.0, -10.0], None);
    let block = build::box_solid([20.0, 20.0, 10.0], [0.0, 0.0, 0.0], None);
    let bracket = boolean("union", &plate, &block).expect("union must build");
    let base_vol = build::solid_volume(&bracket);
    assert!((base_vol - 16000.0).abs() <= 1e-6 * 16000.0, "union volume {base_vol}");

    // The chamfer tool for the step's top +x/+z edge (x = 10, z = 5), distance 4:
    // a triangle in the corner, swept along y and overshot well past both ends so the
    // caps cannot clip the cut. Two of its three sides are coplanar with the block's
    // own +x and +z faces.
    let d = 4.0_f64;
    let segs = vec![
        crate::build::ProfileSeg::Line { a: [0.0, 0.0], b: [d, 0.0] },
        crate::build::ProfileSeg::Line { a: [d, 0.0], b: [0.0, d] },
        crate::build::ProfileSeg::Line { a: [0.0, d], b: [0.0, 0.0] },
    ];
    let over = 45.0_f64;
    let prism = build::ensure_outward(
        &build::extrude_profile(
            &segs,
            [10.0, -over, 5.0],
            [-1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0],
            [0.0, 2.0 * over + 20.0, 0.0],
        )
        .expect("prism builds"),
    );
    let tool_vol = build::solid_volume(&prism);
    let tool_want = 0.5 * d * d * (20.0 + 2.0 * over);
    assert!(
        (tool_vol - tool_want).abs() <= 1e-6 * tool_want,
        "prism volume {tool_vol} vs {tool_want}"
    );

    let got = boolean("subtract", &bracket, &prism).expect("currently builds -- and wrongly");
    // Closed form: the bracket less one right-triangle prism of area d^2/2 over
    // the step's 20mm edge, i.e. 16000 - 8 * 20.
    let want = 16000.0 - 0.5 * d * d * 20.0;
    let vol = build::solid_volume(&got);
    assert!(
        (vol - want).abs() <= 1e-6 * want,
        "chamfered volume {vol} vs closed form {want}: removed {} instead of {} (a silent wrong solid, not a refusal)",
            base_vol - vol,
            base_vol - want
    );
    // A 45-degree face must EXIST in the result. Measured on the failing run:
    // the boolean emits the bracket's 11 faces with no bevel among them, having
    // deleted each coplanar face's whole overlap rectangle (the 80mm strip
    // x 6..10) rather than trimming it by the tool's 8mm triangular section --
    // so the shell is closed and manifold, which is why the guard in `boolean`
    // waves it through, while measuring 15546.666766666667. Volume alone
    // catches it; the face check says WHY.
    let bevels = got
        .faces()
        .iter()
        .filter(|f| match &f.borrow().surface {
            Surface::Plane(p) => {
                let n = crate::math::normalize(p.n);
                let q = std::f64::consts::FRAC_1_SQRT_2;
                let comps: Vec<usize> = (0..3).filter(|&i| n[i].abs() > 1e-7).collect();
                comps.len() == 2
                    && (n[comps[0]].abs() - q).abs() < 1e-7
                    && (n[comps[1]].abs() - q).abs() < 1e-7
            }
            _ => false,
        })
        .count();
    assert_eq!(bevels, 1, "the chamfer's own 45-degree face must be in the result");
    // 11 bracket faces, with the two coplanar ones trimmed in place, plus the bevel.
    assert_eq!(got.faces().len(), 12, "result face count");
}

/// The through-bore variant (msgbox #329 proof): a THROUGH bore's wall also
/// poisons the next blind bore's floor -- exactly one floor lost when the
/// through cut comes first and a blind bore elsewhere second.
/// poisons the next blind bore's floor -- exactly one floor lost when the
/// through cut comes first and a blind bore elsewhere second.
#[test]
fn through_bore_then_blind_bore_keeps_the_floor() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let through = build::cylinder_solid([-15.0, -10.0, 0.0], 3.0, 40.0, [0.0, 0.0, 1.0]);
    let shape = boolean("subtract", &base, &through).expect("first bore cuts");
    let blind = build::cylinder_solid([15.0, 10.0, 0.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
    let want =
        32000.0 - std::f64::consts::PI * 9.0 * 20.0 - std::f64::consts::PI * 9.0 * 8.0;
    let r = boolean("subtract", &shape, &blind);
    assert!(r.is_some(), "a second, disjoint bore must not refuse");
    let vol = build::solid_volume(&r.unwrap());
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs exact {want}");
}

#[test]
fn flush_four_corner_bores_exact() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let offs: [[f64; 3]; 4] =
        [[-15.0, -10.0, 0.0], [15.0, -10.0, 0.0], [-15.0, 10.0, 0.0], [15.0, 10.0, 0.0]];
    let mut shape = base;
    for off in offs {
        let tool = build::cylinder_solid([off[0], off[1], 6.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
        shape = boolean("subtract", &shape, &tool)
            .unwrap_or_else(|| panic!("flush corner bore refused"));
    }
    let vol = build::solid_volume(&shape);
    let want = 32000.0 - 4.0 * std::f64::consts::PI * 9.0 * 8.0;
    assert!(
        (vol - want).abs() <= 1e-6 * want,
        "the ledger's silent wrong volume case: {vol} vs exact {want}"
    );
}


/// Two PARTIALLY overlapping bores (centres 4mm apart, r3 each): the fused
/// tool's volume is the stadium-of-two-disks union; subtracting it once must
/// equal subtracting each in turn would NOT (that double-counts the lens
/// only when the lens region's removal is idempotent — actually subtracting
/// sequentially removes the same material since the second bore's lens part
/// is already gone; the exactness check is against the fused tool).
#[test]
fn partially_overlapping_bores_fuse_exact() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let a = build::cylinder_solid([-2.0, 0.0, 0.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
    let b = build::cylinder_solid([2.0, 0.0, 0.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
    let u = crate::ops::cylinder_pair_boolean("union", &a, &b)
        .expect("overlapping pair must fuse");
    let want = 32000.0 - build::solid_volume(&u);
    let r = boolean("subtract", &base, &u);
    assert!(r.is_some(), "subtracting the fused tool must not refuse");
    let vol = build::solid_volume(&r.unwrap());
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs exact {want}");
}

/// Two FULLY overlapping bores (same centre): the hole branch's fuse loop
/// must not even pair them — identical AABBs DO overlap, so the fuse sees
/// them; the pair union refuses on concentric and the branch keeps the
/// first tool alone, which removes exactly one bore's volume.
#[test]
fn fully_overlapping_bores_cut_one_bore_exact() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let t = build::cylinder_solid([0.0, 0.0, 0.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
    // Direct pair fuse refuses concentric (documented in build_cyl_pair_result);
    // the hole branch must therefore dedupe rather than lose the bore.
    assert!(crate::ops::cylinder_pair_boolean("union", &t, &t).is_none());
    let r = boolean("subtract", &base, &t);
    let vol = build::solid_volume(&r.expect("cut"));
    let want = 32000.0 - std::f64::consts::PI * 9.0 * 8.0;
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs exact {want}");
}

/// The Y2 bench bug (found benching the yardstick): union of two coaxial
/// cylinders of different radii whose caps are NOT coplanar (a flange plus
/// a standing cylinder, the exact Y2 shape). The wall bug that dropped the
/// small cylinder's entire wall is FIXED (parallel-cylinder u-clipping now
/// checks the shared axial band). The union's caps at the interface plane
/// still build inexact — this test is the next slice's RED gate: green
/// only when the union is exact.
#[test]
/// The Y1 bench final: plate + pocket + 3 bores + leg join. The void-scan
/// fix (4-direction beside-sampling) and the coplanar-face rescue route
/// (the partner's own wires as the footprint) make the whole sequence

    /// WHY a bore through a rounded box refuses (2026-09-28, the studio visual
    /// QA pass). `fillet_box` builds 6 planes + 12 cylindrical edge bands + 8
    /// SPHERICAL corner patches, and `ops::process_face`'s sphere arm
    /// (ops.rs) accepts a tool made only of PLANES -- the one pinned case is a
    /// centered square tube along an equatorial axis. A cylindrical drill is
    /// not a plane, so the arm's `_ => return None` fires on the first corner
    /// patch and the whole boolean refuses. This test pins BOTH halves of that
    /// sentence: the face composition that creates the sphere, and the refusal
    /// itself, so the pair cannot drift apart silently.
    #[test]
    fn bore_through_rounded_box_builds_and_a_wide_one_refuses() {
        let rounded = crate::build::fillet_box(30.0, 20.0, 10.0, 5.0, [0.0, 0.0, 0.0]);
        let (mut n_plane, mut n_cyl, mut n_sphere) = (0, 0, 0);
        for f in rounded.faces() {
            match f.borrow().surface {
                Surface::Plane(_) => n_plane += 1,
                Surface::Cylinder(_) => n_cyl += 1,
                Surface::Sphere(_) => n_sphere += 1,
                _ => {}
            }
        }
        assert_eq!((n_plane, n_cyl, n_sphere), (6, 12, 8), "rounded box composition");
        assert_eq!(rounded.faces().len(), 26, "6 + 12 + 8");

        let drill = crate::build::cylinder_solid([0.0, 0.0, 0.0], 6.0, 24.0, [0.0, 0.0, 1.0]);
        // S4c: it used to refuse. The bore reaches only the flat top and bottom, so every round and
        // corner sphere is carried through untouched: V = rounded box 60 x 40 x 20 (r 5) - pi 6^2 20.
        let pi = std::f64::consts::PI;
        let (x, y, z, r) = (50.0, 30.0, 10.0, 5.0);
        let rounded_vol = x * y * z + 2.0 * r * (x * y + y * z + x * z) + pi * r * r * (x + y + z) + 4.0 / 3.0 * pi * r * r * r;
        let want = rounded_vol - pi * 36.0 * 20.0;
        let cut = crate::ops::boolean("subtract", &rounded, &drill).expect("S4c: a bore clear of the rounds builds");
        assert!((build::solid_volume(&cut) - want).abs() < 1e-6 * want, "{} vs {want}", build::solid_volume(&cut));
        // A drill wide enough to reach the rounds still refuses, never returns a wrong solid.
        let wide = crate::build::cylinder_solid([0.0, 0.0, 0.0], 28.0, 24.0, [0.0, 0.0, 1.0]);
        assert!(crate::ops::boolean("subtract", &rounded, &wide).is_none(), "a bore across the rounds must refuse");

        // Control: the SAME drill through a plain box builds, so the sphere
        // corners are the cause and not the drill size or the through-depth.
        let plain = crate::build::box_solid([60.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        assert!(
            crate::ops::boolean("subtract", &plain, &drill).is_some(),
            "the same drill through a plain box must still build"
        );
    }
/// build exactly. Closed form 48000 + 24000 - 3000 - 848.23.
#[test]
fn y1_bench_final_exact() {
    let mut plate = build::box_solid([80.0, 60.0, 10.0], [0.0, 0.0, 5.0], None);
    let pt = build::box_solid([30.0, 20.0, 5.0], [-20.0, 0.0, 7.5], None);
    plate = boolean("subtract", &plate, &pt).expect("pocket");
    for c in [[-25.0f64, -15.0], [25.0, -15.0], [0.0, 15.0]] {
        let t = build::cylinder_solid([c[0], c[1], 5.0], 3.0, 12.0, [0.0, 0.0, 1.0]);
        plate = boolean("subtract", &plate, &t).expect("bore");
    }
    let leg = build::box_solid([10.0, 60.0, 40.0], [35.0, 0.0, 30.0], None);
    let r = boolean("union", &plate, &leg);
    let Some(s) = r else { panic!("the Y1 bench final refused; it should build exactly") };
    let vol = build::solid_volume(&s);
    let want = 48000.0 + 24000.0 - 3000.0 - 3.0 * std::f64::consts::PI * 9.0 * 10.0;
    assert!(
        (vol - want).abs() <= 1e-6 * want,
        "a wrong solid with no refusal: volume {vol} vs exact {want}"
    );
}

/// The Y2 bench final: holed flanged cylinder unioned with the standing
/// cylinder (the doc-path join that refused before the coplanar-face route).
/// Holes sit clear of the boss (r = 20) and of the fillet band (rho 29 and out), so the
/// flange's top face keeps one circle per hole. Closed form: flange-with-holes
/// + cylinder, touching caps; the flange less four holes was 22202.858373491622.
#[test]
fn y2_bench_final_exact() {
    let mut fl = build::round_cylinder_one_rim([0.0, 0.0, 0.0], 35.0, 6.0, [0.0, 0.0, 1.0], 3.0, true);
    for c in [[-24.0f64, 0.0], [24.0, 0.0]] {
        let b = build::cylinder_solid([c[0], c[1], 0.0], 2.5, 6.0, [0.0, 0.0, 1.0]);
        fl = boolean("subtract", &fl, &b).expect("hole");
    }
    let cyl = build::cylinder_solid([0.0, 0.0, 18.0], 20.0, 30.0, [0.0, 0.0, 1.0]);
    let r = boolean("union", &fl, &cyl);
    let Some(s) = r else { panic!("the Y2 bench final refused; it should build exactly") };
    let vol = build::solid_volume(&s);
    let pi = std::f64::consts::PI;
    let hole = pi * 2.5 * 2.5 * 6.0;
    let want = 22202.858373491622 + 4.0 * hole - 2.0 * hole + pi * 20.0 * 20.0 * 30.0;
    assert!(
        (vol - want).abs() <= 1e-6 * want,
        "a wrong solid with no refusal: volume {vol} vs exact {want}"
    );
    assert!(
        crate::ops::check_watertight(&crate::mesh::mesh_solid(&s, 0.05).expect("meshes")),
        "the union must also mesh watertight"
    );
}

/// The Y2 bench with holes at rho 6 and 18, whose rims straddle the boss's r = 20.
/// This used to "build exactly": its volume and area vector are right, but the
/// top face carried the hole circles as overlapping inner wires and the ceiling
/// over (hole AND boss) was never emitted, so the mesh had 44 open edges. Neither
/// the closure guard nor translation invariance could see it (the over-subtracted
/// area cancels the missing ceiling); the torus-aware soundness check does. It
/// refuses now, which is honest; building it needs the split-and-classify boolean.
#[test]
fn y2_bench_holes_straddling_the_boss_refuse() {
    let mut fl = build::round_cylinder_one_rim([0.0, 0.0, 0.0], 35.0, 6.0, [0.0, 0.0, 1.0], 3.0, true);
    for c in [[-18.0f64, 0.0], [-6.0, 0.0], [6.0, 0.0], [18.0, 0.0]] {
        let b = build::cylinder_solid([c[0], c[1], 0.0], 2.5, 6.0, [0.0, 0.0, 1.0]);
        fl = boolean("subtract", &fl, &b).expect("hole");
    }
    let cyl = build::cylinder_solid([0.0, 0.0, 18.0], 20.0, 30.0, [0.0, 0.0, 1.0]);
    assert!(boolean("union", &fl, &cyl).is_none(), "a union whose mesh is open must refuse");
}

fn flange_cylinder_union_exact() {
    let a = build::cylinder_solid([0.0, 0.0, 0.0], 35.0, 6.0, [0.0, 0.0, 1.0]);
    let b = build::cylinder_solid([0.0, 0.0, 18.0], 20.0, 30.0, [0.0, 0.0, 1.0]);
    let r = boolean("union", &a, &b);
    // Either an exact union or an honest refusal — a wrong solid is the
    // one thing SPEC 4.5 forbids.
    // Touching stacked cylinders (bands share only the z=3 plane): the
    // general path builds this exactly. Closed form pi*(35^2*6 + 20^2*30).
    let Some(s) = r else { panic!("the flange/cylinder stack union refused; it should build exactly") };
    let vol = build::solid_volume(&s);
    let want = 60789.8178469625;
    assert!(
        (vol - want).abs() <= 1e-6 * want,
        "a wrong solid with no refusal: volume {vol} vs exact {want}"
    );
}

/// The Y2 bench bug, second act: a filleted flange (torus band at the BOTTOM
/// rim) unioned with a stacked cylinder whose bottom cap is COPLANAR with the
/// flange's top cap. The torus band's hole hid the r35 containment from the
/// +PROBE probe, the tool cap read "empty", and the W3 re-probe's containment
/// arm kept the full cap back (-pi*400). Now: the region's disk covering the
/// face drops it. Closed form pi*(35^2*6 - removed_corner + 20^2*30).
#[test]
fn fillet_flange_stack_touch_exact() {
    // Both rims: the fillet at the BOTTOM rim (torus far from the coplanar
    // interface) and at the TOP rim (torus adjacent to it — the case that
    // exposed the region_inside short-circuit).
    for treated_top in [false, true] {
        let a = build::round_cylinder_one_rim([0.0, 0.0, 0.0], 35.0, 6.0, [0.0, 0.0, 1.0], 3.0, treated_top);
        let b = build::cylinder_solid([0.0, 0.0, 18.0], 20.0, 30.0, [0.0, 0.0, 1.0]);
        let r = boolean("union", &a, &b);
        let Some(s) = r else { panic!("the filleted flange stack union refused; it should build exactly") };
        let vol = build::solid_volume(&s);
        // removed corner at the filleted rim: pi*(585 - 144*pi)... computed:
        // pi * (192*3 - 64*(9*pi/4) + 9).
        let inner = 192.0 * 3.0 - 64.0 * (9.0 * std::f64::consts::PI / 4.0) + 9.0;
        let removed = std::f64::consts::PI * inner;
        let want = std::f64::consts::PI * (35.0 * 35.0 * 6.0 - removed / std::f64::consts::PI + 20.0 * 20.0 * 30.0);
        assert!(
        (vol - want).abs() <= 1e-6 * want,
        "a wrong solid with no refusal: volume {vol} vs exact {want} (treated_top={treated_top})"
        );
    }
}

/// Overlapping stacked cylinders (the small one's bottom cap INSIDE the
/// flange, bands sharing 2mm): the wall-break frame bug used to merge the
/// inside band with an outside band and drop both. Exact now:
/// pi*(35^2*6 + 20^2*30 - 20^2*2).
#[test]
fn overlap_stack_exact() {
    let a = build::cylinder_solid([0.0, 0.0, 0.0], 35.0, 6.0, [0.0, 0.0, 1.0]);
    let b = build::cylinder_solid([0.0, 0.0, 16.0], 20.0, 30.0, [0.0, 0.0, 1.0]);
    let r = boolean("union", &a, &b);
    let Some(s) = r else { panic!("the overlap stack union refused; it should build exactly") };
    let vol = build::solid_volume(&s);
    let want = std::f64::consts::PI * (35.0 * 35.0 * 6.0 + 20.0 * 20.0 * 30.0 - 20.0 * 20.0 * 2.0);
    assert!(
        (vol - want).abs() <= 1e-6 * want,
        "a wrong solid with no refusal: volume {vol} vs exact {want}"
    );
}

/// The Y1 bench bug (found benching the yardstick): a box-box join whose
/// boxes overlap in a VOLUME (not just a face) runs the general path and
/// keeps BOTH solids' full face sets — the interior faces are not
/// dissolved and the shared volume double-counts (72000 vs exact 66000).
/// The interior-face guard misses it because a face spanning both the
/// overlap and free space probes as boundary at its centroid. This is
/// W5's trimmed-face membership, stated as the red gate: exact or
/// refused, never this.
#[test]
fn y1_box_join_exact() {
    let a = build::box_solid([80.0, 60.0, 10.0], [0.0, 0.0, 0.0], None);
    let b = build::box_solid([60.0, 10.0, 40.0], [0.0, 25.0, 10.0], None);
    let r = boolean("union", &a, &b);
    // The coplanar rescue builds this exactly: base keeps the shared band,
    // tool's coplanar wall drops it (emitted once). Pin the exact volume.
    let Some(solid) = r else { panic!("the Y1 box-join union refused; it should build exactly") };
    let vol = build::solid_volume(&solid);
    let want = 66000.0; // 48000 + 24000 − 6000 overlap
    assert!(
        (vol - want).abs() <= 1e-6 * want,
        "a wrong solid with no refusal: volume {vol} vs exact {want} (interior faces not dissolved)"
    );
}

/// msgbox #383: a second boolean onto a boolean result used to vanish (the
/// convex `Region` algebra drops a tool against a base with a void or step
/// wall) and return a closed, WRONG solid. Closed forms below; every cell is
/// either exact or refused, and the enclosed-tool cells must be exact.
#[test]
fn second_cut_onto_a_boolean_result_is_exact_or_refused() {
    use std::f64::consts::PI;
    let bx = |s: [f64; 3], c: [f64; 3]| build::box_solid(s, c, None);
    let cy = |c: [f64; 3], r: f64, h: f64| build::cylinder_solid(c, r, h, [0.0, 0.0, 1.0]);
    // Some(true)=exact, Some(false)=WRONG, None=refused
    let cut = |base: &TSolid, tool: &TSolid, want: f64| {
        boolean("subtract", base, tool).map(|r| (build::solid_volume(&r) - want).abs() <= 1e-6 * want)
    };
    let a = bx([40.0, 40.0, 30.0], [0.0, 0.0, 0.0]);
    let cav = boolean("subtract", &a, &bx([6.0; 3], [-12.0, 0.0, 10.0])).unwrap();
    let notch = boolean("subtract", &a, &bx([6.0; 3], [-12.0, 0.0, 13.0])).unwrap();
    let bore = boolean("subtract", &a, &cy([-12.0, 0.0, 0.0], 3.0, 8.0)).unwrap();
    let plate = bx([40.0, 30.0, 10.0], [0.0, 0.0, -10.0]);
    let l = boolean("union", &plate, &bx([20.0, 20.0, 10.0], [0.0, 0.0, 0.0])).unwrap();
    // (a-t)-u = 47568 and union(plate,block)-t2 = 15784: the two handoff repros.
    assert_eq!(cut(&cav, &bx([6.0; 3], [12.0, 0.0, 10.0]), 47568.0), Some(true));
    assert_eq!(cut(&l, &bx([6.0; 3], [15.0, 0.0, -10.0]), 15784.0), Some(true));
    assert_eq!(cut(&bore, &cy([12.0, 0.0, 0.0], 3.0, 8.0), 48000.0 - 144.0 * PI), Some(true));
    // Tools that break a face or pass through: exact if built, never wrong.
    for (base, bv) in [(&cav, 47784.0), (&notch, 47820.0), (&l, 16000.0)] {
        let x = if std::ptr::eq(base, &l) { 15.0 } else { 12.0 };
        let z = if std::ptr::eq(base, &l) { -6.0 } else { 13.0 };
        let dv = if std::ptr::eq(base, &l) { 144.0 } else { 180.0 };
        assert_ne!(cut(base, &bx([6.0; 3], [x, 0.0, z]), bv - dv), Some(false), "face-break box");
    }
}


/// The chord bug: `outer_uv` and `coplanar_face_wires` used to push edge
/// endpoints only, so a quarter-disk cap read as its 50 mm2 triangle instead of
/// 78.5 mm2. Latent (the boolean refuses arc-bounded planar faces first), so
/// it is pinned here at the ring level.
#[test]
fn arc_bounded_cap_ring_follows_the_arc() {
    use crate::build::ProfileSeg;
    let segs = [
        ProfileSeg::Line { a: [0.0, 0.0], b: [10.0, 0.0] },
        ProfileSeg::Arc { centre: [0.0, 0.0], radius: 10.0, start: 0.0, sweep: std::f64::consts::FRAC_PI_2 },
        ProfileSeg::Line { a: [0.0, 10.0], b: [0.0, 0.0] },
    ];
    let solid = build::extrude_profile(&segs, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 5.0]).unwrap();
    let cap = solid
        .faces()
        .into_iter()
        .find(|f| matches!(&f.borrow().surface, Surface::Plane(p) if p.n[2].abs() > 0.9 && p.origin[2] > 1.0))
        .expect("top cap");
    let Surface::Plane(plane) = cap.borrow().surface.clone() else { unreachable!() };
    let ring = outer_uv(&cap.borrow(), &plane).unwrap();
    let want = std::f64::consts::PI * 100.0 / 4.0;
    let got = poly_area(&ring);
    assert!((got - want).abs() < 0.01 * want, "cap ring area {got} vs {want} (chord triangle would be 50)");
}

/// A counterbore tool's shoulder that crosses a prior pocket must never be read as
/// untouched. The region algebra reads that pocketed base as contradictory
/// half-planes (the pocket's own walls: x <= 4 and x >= 8), which once classified
/// the whole shoulder CLEAR and dropped it -- caught downstream only by where a
/// soundness sample happened to fall. Exact or refused, never dropped: OCCT,
/// measured 2026-09-29, cuts it to 30810.86233585891.
#[test]
fn counterbore_shoulder_across_a_pocket_is_never_dropped() {
    let bx = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let pocket = build::box_solid([4.0, 4.0, 12.0], [6.0, 0.0, 6.0], None);
    let prof = [[0.0, -11.0], [3.0, -11.0], [3.0, 4.0], [6.0, 4.0], [6.0, 11.0], [0.0, 11.0]];
    let tool = build::revolve_profile(&prof, [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], 360.0).unwrap().0;
    let base = boolean("subtract", &bx, &pocket).expect("pocket");
    let shoulder = tool.faces().into_iter().find(|f| f.borrow().boundary.len() == 2).expect("the annulus");
    let mut out = Vec::new();
    let kept = process_face(&shoulder, &base, "subtract", false, &mut out);
    assert!(kept.is_none() || !out.is_empty(), "the shoulder was dropped as if the tool never met it");
    if let Some(r) = boolean("subtract", &base, &tool) {
        let (got, want) = (build::solid_volume(&r), 30810.86233585891);
        assert!((got - want).abs() <= 1e-6 * want, "volume {got} vs OCCT {want}");
    }
}

/// K0a-era parity classification (plan option (b) section 3.4). Nothing routes
/// here yet; these tests exist so the piece step 2's safety depends on is
/// measured on its own rather than assumed.
#[cfg(test)]
mod parity_tests {
    use super::*;
    use crate::build;

    fn box_at(c: Vec3) -> TSolid {
        build::box_solid([40.0, 40.0, 40.0], c, None)
    }

    #[test]
    fn planar_and_full_cylinder_solids_reach_parity_consensus() {
        let b = box_at([0.0, 0.0, 0.0]);
        assert!(
            matches!(parity_classification(&b, [0.0, 0.0, 0.0]), ParityClassification::Consensus { inside: true }),
            "a point at a box's centre is inside, and every face is planar"
        );
        assert!(
            matches!(parity_classification(&b, [100.0, 0.0, 0.0]), ParityClassification::Consensus { inside: false }),
            "a point far outside the box is outside"
        );

        let cyl = build::cylinder_solid([0.0, 0.0, 0.0], 10.0, 30.0, [0.0, 0.0, 1.0]);
        assert!(
            matches!(parity_classification(&cyl, [0.0, 0.0, 0.0]), ParityClassification::Consensus { inside: true }),
            "a cylinder's axis point is inside, and it is a full cylinder plus two caps"
        );
    }

    #[test]
    fn a_sphere_is_unavailable_because_its_crossing_count_has_no_containment_check() {
        // The reason this type exists. `crossings` counts a sphere's ray ROOTS with
        // no finite-face containment test, and still reports supported=true, so a
        // solid carrying a sphere can reach a confident-looking vote. The half-space
        // fallback inside_solid uses on a tie is "right whenever the solid is
        // convex" -- the exact assumption this work retires.
        let s = build::sphere_solid([0.0, 0.0, 0.0], 10.0, [0.0, 0.0, 1.0]);
        assert!(
            matches!(parity_classification(&s, [0.0, 0.0, 0.0]), ParityClassification::Unavailable),
            "a sphere must not report parity consensus; its roots are not a boundary count"
        );
    }

    #[test]
    fn a_cone_is_unavailable_because_parity_over_a_cone_is_unverified() {
        // K3 gave the boolean a real cone arm, and it is used. That is not a claim
        // that parity over a cone is exact: region-arrangement-design.md section 3.4
        // says so explicitly and declines to claim it works.
        let c = build::cone_solid([0.0, 0.0, 0.0], 10.0, 20.0, [0.0, 0.0, 1.0]);
        assert!(
            matches!(parity_classification(&c, [0.0, 0.0, 5.0]), ParityClassification::Unavailable),
            "cone parity is unverified, so the honest answer is Unavailable"
        );
    }

    #[test]
    fn a_torus_is_unavailable_because_ray_counting_abstains_on_it() {
        let t = build::torus_solid([0.0, 0.0, 0.0], 14.0, 4.0, [0.0, 0.0, 1.0]);
        assert!(matches!(parity_classification(&t, [0.0, 0.0, 0.0]), ParityClassification::Unavailable));
    }

    #[test]
    fn a_planar_solid_containing_a_curved_face_is_unavailable_not_partly_decided() {
        // The mixed case that a per-face vote would get wrong: the box's own faces
        // vote fine, but one sphere face makes the WHOLE crossing count untrustworthy.
        // Consensus must be all-or-nothing, or a caller reads a partial answer as a
        // real one.
        // A box's planar faces unioned with a sphere's, as ONE shell: the mixed
        // case a per-face vote would get wrong.
        let mut faces = build::sphere_solid([0.0, 0.0, 0.0], 10.0, [0.0, 0.0, 1.0]).faces();
        faces.extend(box_at([0.0, 0.0, 0.0]).faces());
        let s = TSolid {
            shells: vec![Rc::new(RefCell::new(topo::Shell { faces }))],
        };
        assert!(
            matches!(parity_classification(&s, [0.0, 0.0, 0.0]), ParityClassification::Unavailable),
            "one curved face must make the whole solid Unavailable, not merely reduce confidence"
        );
    }

    #[test]
    fn inside_solid_is_unchanged_and_still_half_spaces_on_a_tie() {
        // This slice is additive. If `inside_solid` ever stops answering for a
        // sphere, the boolean that every gate depends on has changed behaviour and
        // this test is the one that says so.
        let s = build::sphere_solid([0.0, 0.0, 0.0], 10.0, [0.0, 0.0, 1.0]);
        assert!(inside_solid(&s, [0.0, 0.0, 0.0]), "centre of a sphere is inside");
        assert!(!inside_solid(&s, [100.0, 0.0, 0.0]), "far point is outside");
    }
}

/// Option (b) step 1b: the cell representation. Nothing constructs a `Cell` yet --
/// the decomposition does -- so these tests pin what a `Cell` is ALLOWED to be,
/// before any code has to live up to it.
#[cfg(test)]
mod cell_tests {
    use super::*;

    /// 10x10 square.
    fn square() -> Vec<Vec<[f64; 2]>> {
        vec![vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]]]
    }

    /// A 10x10 square with a 2x2 hole at (4,4)-(6,6), wound the other way.
    fn square_with_hole() -> Cell {
        Cell {
            loops: vec![
                vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]],
                vec![[4.0, 4.0], [4.0, 6.0], [6.0, 6.0], [6.0, 4.0]],
            ],
        }
    }

    #[test]
    fn a_plain_cell_contains_its_interior_and_not_the_outside() {
        let c = Cell { loops: square() };
        assert!(cell_contains(&c, [5.0, 5.0]), "centre is inside");
        assert!(!cell_contains(&c, [20.0, 5.0]), "far right is outside");
        assert!(!cell_contains(&c, [5.0, -1.0]), "below the bottom edge is outside");
    }

    #[test]
    fn a_hole_is_genuinely_outside_and_that_is_why_a_cell_is_not_a_region() {
        // THE test. `Region` is an intersection of half-planes, so it cannot
        // represent this cell at all -- a hole would need "not inside", which no
        // conjunction of keep-sides expresses. If this ever starts passing by
        // accident, the hole logic is wrong.
        let c = square_with_hole();
        assert!(cell_contains(&c, [1.0, 1.0]), "solid part of the square is inside");
        assert!(!cell_contains(&c, [5.0, 5.0]), "the HOLE must be outside");
        assert!(!cell_contains(&c, [20.0, 20.0]), "outside the square is outside");
    }

    #[test]
    fn hole_winding_does_not_matter_to_the_predicate() {
        // cell_contains counts crossings across all loops together, so it must give
        // the same answer whichever way the hole is wound. An arrangement bug that
        // emitted a hole wound like an outer boundary would still produce a correct
        // verdict, which is why this is pinned rather than assumed.
        let ccw = square_with_hole();
        let mut same = ccw.clone();
        same.loops[1].reverse();
        assert!(!cell_contains(&same, [5.0, 5.0]), "reversed hole is still a hole");
        assert_eq!(cell_contains(&ccw, [1.0, 1.0]), cell_contains(&same, [1.0, 1.0]));
    }

    #[test]
    fn a_non_convex_cell_needs_no_convex_decomposition() {
        // An L. Its two arms are inside, the notch between them is outside, and a
        // single convex piece cannot do that -- which is why poly_minus_poly's
        // convex-pieces approach is not sufficient and design 3.2 forbids collapsing
        // to a convex Region.
        let l = Cell {
            loops: vec![vec![
                [0.0, 0.0], [2.0, 0.0], [2.0, 1.0],
                [1.0, 1.0], [1.0, 2.0], [0.0, 2.0],
            ]],
        };
        assert!(cell_contains(&l, [1.5, 0.5]), "horizontal arm is inside");
        assert!(cell_contains(&l, [0.5, 1.5]), "vertical arm is inside");
        assert!(!cell_contains(&l, [1.5, 1.5]), "the notch is OUTSIDE");
        assert!(!cell_contains(&l, [5.0, 5.0]), "far away is outside");
    }

    #[test]
    fn a_disconnected_arrangement_is_several_cells_not_one_union() {
        let a = Cell { loops: vec![vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]] };
        let b = Cell { loops: vec![vec![[5.0, 5.0], [6.0, 5.0], [6.0, 6.0], [5.0, 6.0]]] };
        assert!(cell_contains(&a, [0.5, 0.5]));
        assert!(cell_contains(&b, [5.5, 5.5]));
        assert!(!cell_contains(&a, [5.5, 5.5]), "cell A must not contain cell B's interior");
        assert!(!cell_contains(&b, [0.5, 0.5]));
    }

    #[test]
    fn area_is_outer_minus_holes_and_degenerate_cells_are_zero() {
        assert!((cell_area(&Cell { loops: square() }) - 100.0).abs() < 1e-9, "10x10 is 100");
        let holed = cell_area(&square_with_hole());
        assert!(
            (holed - 96.0).abs() < 1e-9,
            "100 minus a 2x2 hole is 96, got {holed} -- a hole must SUBTRACT"
        );
        // Design 3.2 wants non-zero-area open cells, so a caller can drop these.
        assert!(cell_area(&Cell { loops: vec![vec![[1.0, 1.0], [2.0, 1.0], [1.0, 2.0]]] }) > 0.0, "a triangle has area");
        assert_eq!(cell_area(&Cell { loops: vec![vec![]] }), 0.0, "an empty loop is degenerate");
        assert_eq!(cell_area(&Cell { loops: vec![vec![[1.0, 1.0], [2.0, 2.0]]] }), 0.0, "a single edge is degenerate");
    }
}

/// Option (b) step 1c: the exact bounded trace of a planar face on the probe plane.
/// Nothing routes here yet. The load-bearing property is BOUNDED: the trace is the
/// face's own extent along the intersection line, not the whole line.
#[cfg(test)]
mod trace_tests {
    use super::*;
    use crate::build;

    /// The z = 0 plane, with uv = (x, y).
    fn z0() -> Plane {
        Plane { origin: [0.0, 0.0, 0.0], n: [0.0, 0.0, 1.0], u: [1.0, 0.0, 0.0], v: [0.0, 1.0, 0.0] }
    }

    /// The face of `solid` whose outward normal is closest to `want`.
    fn face_toward(solid: &TSolid, want: Vec3) -> TFace {
        let mut best: Option<(f64, TFace)> = None;
        for fc in solid.faces() {
            let n = {
                let fb = fc.borrow();
                match &fb.surface {
                    Surface::Plane(g) => {
                        let nn = if fb.forward { g.n } else { scale(g.n, -1.0) };
                        nn
                    }
                    Surface::Cylinder(c) => {
                        let q = [c.origin[0] - want[0], c.origin[1] - want[1], c.origin[2] - want[2]];
                        let _ = q;
                        continue;
                    }
                    _ => continue,
                }
            };
            let d = dot(normalize(n), normalize(want));
            if best.as_ref().map_or(true, |(bd, _)| d > *bd) {
                best = Some((d, fc.clone()));
            }
        }
        best.expect("no candidate face").1
    }

    #[test]
    fn a_planar_face_traces_on_a_transverse_plane_within_its_own_extent() {
        // THE test. The z=0 plane cuts a 40x40x20 box's +x face along the line
        // x = 20, and that face only spans y in [-20, 20]. If the trace came back
        // as the whole intersection LINE rather than the face's extent, a student's
        // cell would be cut far outside the geometry.
        let b = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let face = face_toward(&b, [1.0, 0.0, 0.0]);
        let segs = planar_face_trace_on_plane(&face, &z0()).expect("a transverse planar face traces");
        assert_eq!(segs.len(), 1, "one crossing of one rectangle gives one segment: {segs:?}");
        let pts = &segs[0];
        for q in pts {
            assert!((q[0] - 20.0).abs() < 1e-9, "the trace lies in the face's plane x=20, got {q:?}");
            assert!(q[1].abs() <= 20.0 + 1e-9, "the trace is BOUNDED by the face, got {q:?}");
        }
        let lo = pts.iter().map(|q| q[1]).fold(f64::MAX, f64::min);
        let hi = pts.iter().map(|q| q[1]).fold(f64::MIN, f64::max);
        assert!((lo + 20.0).abs() < 1e-9 && (hi - 20.0).abs() < 1e-9, "the segment spans the face exactly: {lo} .. {hi}");
    }

    #[test]
    fn the_trace_scales_with_the_face_not_with_the_plane() {
        // A smaller box must give a SHORTER trace on the same plane. Without this,
        // a bug that returned the unbounded line would pass the first test.
        let small = build::box_solid([4.0, 4.0, 4.0], [0.0, 0.0, 0.0], None);
        let face = face_toward(&small, [1.0, 0.0, 0.0]);
        let segs = planar_face_trace_on_plane(&face, &z0()).expect("traces");
        let hi = segs[0].iter().map(|q| q[1]).fold(f64::MIN, f64::max);
        assert!((hi - 2.0).abs() < 1e-9, "a 4mm box's +x face is at x=2 spanning y in [-2,2], got {hi}");
    }

    #[test]
    fn a_parallel_plane_refuses_rather_than_producing_a_degenerate_trace() {
        // The box's +z face is parallel to z=0. There is no transverse interval, so
        // there is nothing to split a cell on. Section 3.1 forbids silently omitting
        // it, and a zero-length "trace" would be exactly that omission.
        let b = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let face = face_toward(&b, [0.0, 0.0, 1.0]);
        assert_eq!(
            planar_face_trace_on_plane(&face, &z0()),
            Err(NoTrace::ParallelPlane),
            "a parallel face must refuse, not return a degenerate segment"
        );
    }

    #[test]
    fn a_coplanar_face_refuses_as_parallel_rather_than_claiming_a_footprint() {
        // Coincident faces are a DIFFERENT arrangement input -- a bounded footprint,
        // section 3.1 -- and this function is not that function. It must not
        // pretend to produce one.
        let coplanar = Plane { origin: [0.0, 0.0, 0.0], n: [0.0, 0.0, 1.0], u: [1.0, 0.0, 0.0], v: [0.0, 1.0, 0.0] };
        let b = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 10.0], None);
        let face = face_toward(&b, [0.0, 0.0, 1.0]);
        assert_eq!(planar_face_trace_on_plane(&face, &coplanar), Err(NoTrace::ParallelPlane));
    }

    #[test]
    fn a_curved_face_refuses_and_is_never_sampled() {
        // A plane cuts a full cylinder in an ellipse. Sampling it into facets is the
        // move section 3.1 names as forbidden, so the honest answer is Unavailable.
        let cyl = build::cylinder_solid([0.0, 0.0, 0.0], 10.0, 30.0, [0.0, 0.0, 1.0]);
        let wall = cyl
            .faces()
            .into_iter()
            .find(|fc| matches!(&fc.borrow().surface, Surface::Cylinder(_)))
            .expect("a cylinder has a curved wall");
        assert_eq!(planar_face_trace_on_plane(&wall, &z0()), Err(NoTrace::CurvedUnsupported));

        let sph = build::sphere_solid([0.0, 0.0, 0.0], 10.0, [0.0, 0.0, 1.0]);
        let cap = sph.faces().into_iter().next().expect("a sphere has a face");
        assert_eq!(planar_face_trace_on_plane(&cap, &z0()), Err(NoTrace::CurvedUnsupported));
    }

    #[test]
    fn a_plane_that_misses_the_face_yields_no_trace_rather_than_a_full_line() {
        // The z=20 plane is above a 20-tall box centred at the origin, so it crosses
        // no face at all. An implementation that returned the unbounded line here
        // would hand the arrangement a cut through empty space.
        let b = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let above = Plane { origin: [0.0, 0.0, 20.0], n: [0.0, 0.0, 1.0], u: [1.0, 0.0, 0.0], v: [0.0, 1.0, 0.0] };
        let face = face_toward(&b, [1.0, 0.0, 0.0]);
        let segs = planar_face_trace_on_plane(&face, &above).expect("planar, so it answers");
        assert!(segs.is_empty(), "no face crosses the z=20 plane, so there is no trace: {segs:?}");
    }
}

/// Option (b) step 2 warning, pinned. See clip_halfplane's own doc comment: on a
/// non-convex subject a half-plane clip returns ONE loop even when the correct
/// answer is several contours, and the merge leaves no topological trace. This
/// test exists so that trap is a standing measurement rather than a comment
/// someone has to trust -- and so the day a real multi-contour clip lands, this
/// test is the thing that fails and says so.
#[cfg(test)]
mod clip_convexity_contract {
    use super::*;

    /// Two 2x2 squares joined by a 1-wide bridge at y in [4,5]: one loop,
    /// genuinely connected, and genuinely NON-convex.
    fn dumbbell() -> Vec<[f64; 2]> {
        vec![
            [0.0, 0.0], [8.0, 0.0], [8.0, 2.0], [6.0, 2.0],
            [6.0, 5.0], [8.0, 5.0], [8.0, 7.0], [0.0, 7.0],
            [0.0, 5.0], [2.0, 5.0], [2.0, 2.0], [0.0, 2.0],
        ]
    }

    fn area(p: &[[f64; 2]]) -> f64 {
        let mut a = 0.0;
        for i in 0..p.len() {
            let q = p[i];
            let r = p[(i + 1) % p.len()];
            a += q[0] * r[1] - r[0] * q[1];
        }
        (a * 0.5).abs()
    }

    #[test]
    fn a_convex_subject_clips_exactly() {
        // The contract both live callers rely on. If this ever fails, the whole
        // safe basis for clip_poly_by_poly and poly_minus_poly is gone.
        let sq = vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]];
        let out = clip_halfplane(&sq, 1.0, 0.0, -2.0); // keep u <= 2
        assert!((area(&out) - 8.0).abs() < 1e-9, "a 4x4 square clipped to u<=2 is area 8, got {}", area(&out));
    }

    #[test]
    fn a_NON_convex_subject_is_merged_and_the_area_wrongly_doubles() {
        // THE trap. The correct answer for the dumbbell below y=2 is the two 2x2
        // squares, total area 8, as TWO contours. What comes back is ONE simple
        // polygon spanning the full 8x2, area 16.
        let out = clip_halfplane(&dumbbell(), 0.0, 1.0, -2.0); // keep y <= 2
        // One Vec comes back -- the function has no way to express two contours --
        // so the count that matters is the AREA it encloses.
        assert!(
            (area(&out) - 16.0).abs() < 1e-9,
            "the merged outline covers the gap too: area {} not 16",
            area(&out)
        );
        assert!(
            (area(&out) - 8.0).abs() > 1e-9,
            "if this ever equals 8 the trap is gone and step 2 may use a real clip"
        );
        // And the reason a guard cannot catch it: the result is a SIMPLE polygon.
        // No self-intersection, no repeated non-adjacent vertex -- just collinear
        // points flattened along the top edge.
        let n = out.len();
        for i in 0..n {
            for j in (i + 1)..n {
                if j == i + 1 || (i == 0 && j == n - 1) {
                    continue;
                }
                let d = (out[i][0] - out[j][0]).abs() + (out[i][1] - out[j][1]).abs();
                assert!(d > 1e-9, "a guard could spot a repeated vertex at {i},{j} -- the trap would be detectable after all");
            }
        }
    }
}

/// Cone bores. A pointed cone (apex up, base at z = -H/2) drilled by a cylinder.
/// Every expected value is a closed form worked out here, not read off the
/// kernel: removed volume = integral over height of pi * min(r, R(z))^2 where
/// R(z) = R (1 - z/H), piecewise (a plain cylinder below zc = H (1 - r/R), where
/// the cone narrows to the bore, the cone itself above). Each case is built at
/// the origin and shifted by SHIFT, and must be closed, exact, and watertight.
#[cfg(test)]
mod cone_bore_pins {
    use super::*;
    use serde_json::json;

    const PI: f64 = std::f64::consts::PI;
    const SHIFT: Vec3 = [37.0, -23.0, 11.0];

    fn cone_up_to(rb: f64, h: f64, z: f64) -> f64 {
        PI * rb * rb * h / 3.0 * (1.0 - (1.0 - z / h).powi(3))
    }
    /// Cone volume left after a coaxial bore of radius r spanning relative
    /// heights [a, b] (0 = the base).
    fn left(rb: f64, h: f64, r: f64, a: f64, b: f64) -> f64 {
        let (a, b) = (a.max(0.0), b.min(h));
        let zc = h * (1.0 - r / rb);
        let cyl = |lo: f64, hi: f64| if hi > lo { PI * r * r * (hi - lo) } else { 0.0 };
        let cone = |lo: f64, hi: f64| if hi > lo { cone_up_to(rb, h, hi) - cone_up_to(rb, h, lo) } else { 0.0 };
        PI * rb * rb * h / 3.0 - (cyl(a, b.min(zc)) + cone(a.max(zc), b))
    }

    fn doc(rb: f64, h: f64, r: f64, off: [f64; 2], lo: f64, hi: f64, t: Vec3) -> serde_json::Value {
        let mid = -h / 2.0 + 0.5 * (lo + hi);
        json!({ "features": [
            { "id": "t", "kind": "cone", "radius": rb, "height": h, "center": t },
            { "id": "h", "kind": "hole", "target": "t", "diameter": 2.0 * r, "depth": hi - lo,
              "center": [off[0], off[1], mid], "axis": "z" } ] })
    }

    /// Some(solid) when it built; the sentence is checked when it refused.
    fn run(rb: f64, h: f64, r: f64, off: [f64; 2], lo: f64, hi: f64, t: Vec3) -> Option<TSolid> {
        let (hist, refusals) = crate::wasm::build_doc(&doc(rb, h, r, off, lo, hi, t));
        match hist.shapes.get("h") {
            Some(s) => {
                assert!(refusals.is_empty(), "built with refusals {refusals:?}");
                Some(s.clone())
            }
            None => {
                assert!(!refusals["h"].as_str().unwrap_or("").is_empty());
                None
            }
        }
    }

    /// Must build, at origin and shifted, matching `want` and the bbox top.
    fn exact(name: &str, rb: f64, h: f64, r: f64, off: [f64; 2], lo: f64, hi: f64, want: f64, faces: usize, top: f64) {
        for t in [[0.0; 3], SHIFT] {
            let s = run(rb, h, r, off, lo, hi, t).unwrap_or_else(|| panic!("{name}: refused at {t:?}"));
            assert_eq!(s.faces().len(), faces, "{name}: face count");
            // Volume, translation invariance, watertight mesh, bbox. The
            // once-used-edge count is set aside: a circle rim whose seam
            // vertex differs between the planar face and the wall (every bore
            // in a box does this too) reads as used once, and the weld does
            // not merge differently-seamed circles on purpose.
            let bad: Vec<String> = closed_failures(&s, want,
                [t[0] - rb, t[1] - rb, t[2] - h / 2.0], [t[0] + rb, t[1] + rb, t[2] - h / 2.0 + top])
                .into_iter().filter(|m| !m.contains("used exactly once")).collect();
            assert!(bad.is_empty(), "{name} at {t:?}: {bad:?}");
        }
    }

    #[test]
    fn coaxial_through_bore_is_exact() {
        // R=10 H=20 r=2, bore overshoots both ends: base annulus, bore wall,
        // cone band from the base rim to the bore. Top at zc = 16.
        let v = left(10.0, 20.0, 2.0, -50.0, 80.0);
        assert!((v - (cone_up_to(10.0, 20.0, 16.0) - PI * 4.0 * 16.0)).abs() < 1e-9);
        exact("through", 10.0, 20.0, 2.0, [0.0; 2], -50.0, 80.0, v, 3, 16.0);
    }

    #[test]
    fn coaxial_blind_bores_are_exact() {
        // From the base, ending well below the crossing (zc = 16) and just
        // under it. (A bore that ends BETWEEN the crossing and the apex strands
        // the tip as a second lump: see what_cannot_be_exact_stays_a_refusal.)
        exact("blind 6", 10.0, 20.0, 2.0, [0.0; 2], -5.0, 6.0, left(10.0, 20.0, 2.0, -5.0, 6.0), 4, 20.0);
        exact("blind 15", 10.0, 20.0, 2.0, [0.0; 2], -5.0, 15.0, left(10.0, 20.0, 2.0, -5.0, 15.0), 4, 20.0);
    }

    #[test]
    fn off_axis_bore_inside_the_cone_is_exact() {
        // r=1, 3 mm off axis, base to z=5: 3+1 < R(5)=7.5, so it stays inside.
        exact("off-axis blind", 10.0, 20.0, 1.0, [3.0, 0.0], -5.0, 5.0,
            PI * 100.0 * 20.0 / 3.0 - PI * 5.0, 4, 20.0);
    }

    #[test]
    fn what_cannot_be_exact_stays_a_refusal() {
        // An off-axis bore that reaches the cone wall meets it in a space curve.
        assert!(run(10.0, 20.0, 1.0, [3.0, 0.0], -50.0, 80.0, [0.0; 3]).is_none());
        assert!(run(10.0, 20.0, 1.0, [8.5, 0.0], -5.0, 5.0, [0.0; 3]).is_none());
        // Ending above the crossing but short of the apex leaves the tip
        // floating free of the body: two lumps, which is not one solid.
        assert!(run(10.0, 20.0, 2.0, [0.0; 2], -5.0, 18.0, [0.0; 3]).is_none());
    }
}


/// Transverse (cross) bore through a cylinder's side, docs/specs/SPEC-transverse-bore.md.
#[cfg(test)]
mod cross_bore_pins {
    use super::*;

    const SHIFT: Vec3 = [37.0, -23.0, 11.0];

    fn part(big_r: f64, h: f64, at: Vec3) -> TSolid {
        build::cylinder_solid(at, big_r, h, [0.0, 0.0, 1.0])
    }

    fn tool(r: f64, x_lo: f64, x_hi: f64, at: Vec3) -> TSolid {
        let mid = 0.5 * (x_lo + x_hi);
        build::cylinder_solid(add(at, [mid, 0.0, 0.0]), r, x_hi - x_lo, [1.0, 0.0, 0.0])
    }

    /// The removed volume by a route that shares nothing with the kernel:
    /// Simpson's rule, 400000 intervals, on y = r sin(th) (the integrand is
    /// smooth there). Through: `x_extent = 2 sqrt(R^2 - y^2)`; blind:
    /// `sqrt(R^2 - y^2) - floor`.
    fn oracle_removed(big_r: f64, r: f64, floor: Option<f64>) -> f64 {
        let n = 400_000usize;
        let (a, b) = (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2);
        let h = (b - a) / n as f64;
        let g = |th: f64| {
            let y = r * th.sin();
            let f = (big_r * big_r - y * y).sqrt();
            let ext = match floor { None => 2.0 * f, Some(x0) => f - x0 };
            2.0 * r * r * th.cos() * th.cos() * ext
        };
        let mut acc = g(a) + g(b);
        for i in 1..n {
            acc += g(a + h * i as f64) * if i % 2 == 1 { 4.0 } else { 2.0 };
        }
        acc * h / 3.0
    }

    fn bbox_of_part(big_r: f64, h: f64, at: Vec3) -> (Vec3, Vec3) {
        ([at[0] - big_r, at[1] - big_r, at[2] - h / 2.0], [at[0] + big_r, at[1] + big_r, at[2] + h / 2.0])
    }

    /// The removed volume equals the numeric integral at 1e-9, and the result is
    /// a closed, watertight solid of the right box. Returns the solid.
    fn check(big_r: f64, h: f64, r: f64, x_lo: f64, x_hi: f64, floor: Option<f64>, at: Vec3, faces: usize) -> TSolid {
        let a = part(big_r, h, at);
        let t = tool(r, x_lo, x_hi, at);
        let res = boolean("subtract", &a, &t).unwrap_or_else(|| panic!("refused R={big_r} r={r} {x_lo}..{x_hi} at {at:?}"));
        assert_eq!(res.faces().len(), faces, "face count");
        let want = std::f64::consts::PI * big_r * big_r * h - oracle_removed(big_r, r, floor);
        let (lo, hi) = bbox_of_part(big_r, h, at);
        assert_closed(&format!("R={big_r} r={r} floor={floor:?} at {at:?}"), &res, want, lo, hi);
        let v = build::solid_volume(&res);
        assert!((v - want).abs() <= 1e-9 * want, "volume {v} vs oracle {want}");
        res
    }

    #[test]
    fn through_bore_matches_the_numeric_integral() {
        // The spec's pinned numbers.
        let o = oracle_removed(10.0, 2.0, None);
        assert!((o - 250.06441209661864).abs() < 1e-8, "{o}");
        for at in [[0.0; 3], SHIFT] {
            let res = check(10.0, 30.0, 2.0, -20.0, 20.0, None, at, 4);
            assert!((build::solid_volume(&res) - 9174.71354867276).abs() < 1e-8 * 9174.7);
            for ratio in [0.05, 0.2, 0.5, 0.9, 0.95] {
                check(10.0, 30.0, 10.0 * ratio, -20.0, 20.0, None, at, 4);
            }
        }
    }

    #[test]
    fn blind_bore_that_stays_inside_matches_the_numeric_integral() {
        for at in [[0.0; 3], SHIFT] {
            for ratio in [0.05, 0.2, 0.5, 0.9] {
                let r: f64 = 10.0 * ratio;
                let s0 = (100.0 - r * r).sqrt();
                for frac in [-0.9, 0.0, 0.9] {
                    let floor = frac * s0;
                    // Enters at +x, floor inside; and the mirror image, entering at -x.
                    check(10.0, 30.0, r, floor, 20.0, Some(floor), at, 5);
                    check(10.0, 30.0, r, -20.0, -floor, Some(floor), at, 5);
                }
            }
        }
    }

    #[test]
    fn a_turned_bore_and_a_sideways_part_build_too() {
        // Tool along y; and a part lying along x with the tool along z.
        for at in [[0.0; 3], SHIFT] {
            let a = build::cylinder_solid(at, 10.0, 30.0, [0.0, 0.0, 1.0]);
            let t = build::cylinder_solid(at, 2.0, 40.0, [0.0, 1.0, 0.0]);
            let res = boolean("subtract", &a, &t).expect("y tool");
            let want = std::f64::consts::PI * 100.0 * 30.0 - oracle_removed(10.0, 2.0, None);
            assert!((build::solid_volume(&res) - want).abs() <= 1e-9 * want);
            let a = build::cylinder_solid(at, 10.0, 30.0, [1.0, 0.0, 0.0]);
            let t = build::cylinder_solid(at, 3.0, 40.0, [0.0, 0.0, 1.0]);
            let res = boolean("subtract", &a, &t).expect("x part, z tool");
            let want = std::f64::consts::PI * 100.0 * 30.0 - oracle_removed(10.0, 3.0, None);
            assert!((build::solid_volume(&res) - want).abs() <= 1e-9 * want);
            assert!(once_used_edges(&res.faces()).is_empty());
            let m = crate::mesh::mesh_solid(&res, 0.05).expect("mesh");
            assert!(check_watertight(&m));
        }
    }

    /// Every tessellated vertex lies on its own surface, the meeting curve on
    /// BOTH, the bore wall inside the part and the pierced wall outside the bore.
    #[test]
    fn tessellated_vertices_lie_on_the_surfaces() {
        for (floor, x_lo) in [(None, -20.0), (Some(-3.0), -3.0)] {
            for at in [[0.0; 3], SHIFT] {
                let r = 4.0;
                let res = check(10.0, 30.0, r, x_lo, 20.0, floor, at, if floor.is_some() { 5 } else { 4 });
                let m = crate::mesh::mesh_solid(&res, 0.05).unwrap();
                let rho_part = |p: [f64; 3]| ((p[0] - at[0]).powi(2) + (p[1] - at[1]).powi(2)).sqrt();
                let rho_tool = |p: [f64; 3]| ((p[1] - at[1]).powi(2) + (p[2] - at[2]).powi(2)).sqrt();
                let faces = res.faces();
                let mut checked = 0usize;
                for (fi, f) in faces.iter().enumerate() {
                    let (start, count) = m.faces[fi];
                    let cy = match &f.borrow().surface { Surface::Cylinder(c) => c.cross.clone(), _ => None };
                    let verts: std::collections::BTreeSet<u32> = m.indices[start..start + count].iter().cloned().collect();
                    for vi in verts {
                        let p = m.positions[vi as usize];
                        match cy {
                            Some(crate::geom::Cross::Wall { .. }) => {
                                assert!((rho_part(p) - 10.0).abs() < 1e-9, "wall vertex off its cylinder");
                                assert!(rho_tool(p) >= r - 1e-9, "wall vertex inside the bore");
                            }
                            Some(crate::geom::Cross::Tool { .. }) => {
                                assert!((rho_tool(p) - r).abs() < 1e-9, "bore vertex off its cylinder");
                                assert!(rho_part(p) <= 10.0 + 1e-9, "bore vertex outside the part");
                            }
                            None | Some(crate::geom::Cross::Patch { .. }) => {}
                        }
                        checked += 1;
                    }
                }
                assert!(checked > 100);
                // The meeting curve itself lies on BOTH surfaces.
                for e in res.edges() {
                    if let Curve::CylCyl { .. } = &e.borrow().curve {
                        for p in crate::mesh::curve_points(&e.borrow().curve, 0.05) {
                            assert!((rho_part(p) - 10.0).abs() < 1e-9 && (rho_tool(p) - r).abs() < 1e-9);
                        }
                    }
                }
            }
        }
    }

    /// The mesh volume agrees with the exact one to within the chord tolerance's
    /// own bound, so the triangulation really covers the surface.
    #[test]
    fn mesh_volume_tracks_the_exact_volume() {
        for floor in [None, Some(0.0)] {
            let res = check(10.0, 30.0, 4.0, if floor.is_some() { 0.0 } else { -20.0 }, 20.0, floor, [0.0; 3], if floor.is_some() { 5 } else { 4 });
            let exact = build::solid_volume(&res);
            for defl in [0.05, 0.01] {
                let m = crate::mesh::mesh_solid(&res, defl).unwrap();
                let mut v6 = 0.0;
                for t in m.indices.chunks(3) {
                    let (a, b, c) = (m.positions[t[0] as usize], m.positions[t[1] as usize], m.positions[t[2] as usize]);
                    v6 += dot(a, cross(b, c));
                }
                let mesh_v = v6 / 6.0;
                assert!((mesh_v - exact).abs() < 0.01 * exact, "defl {defl}: mesh {mesh_v} vs exact {exact}");
                assert!(check_watertight(&m));
            }
        }
    }

    /// Across the whole ratio range, both bore kinds, both deflections: the mesh
    /// is watertight and its volume tracks the exact one.
    #[test]
    fn meshes_are_watertight_across_the_ratio_range() {
        for ratio in [0.05, 0.2, 0.5, 0.9, 0.95] {
            let r: f64 = 10.0 * ratio;
            let s0 = (100.0 - r * r).sqrt();
            for (x_lo, floor) in [(-20.0, None), (0.5 * s0, Some(0.5 * s0))] {
                let res = check(10.0, 30.0, r, x_lo, 20.0, floor, [0.0; 3], if floor.is_some() { 5 } else { 4 });
                let exact = build::solid_volume(&res);
                for defl in [0.05, 0.01] {
                    let m = crate::mesh::mesh_solid(&res, defl).expect("mesh");
                    assert!(check_watertight(&m), "ratio {ratio} defl {defl}");
                    let mut v6 = 0.0;
                    for t in m.indices.chunks(3) {
                        let (a, b, c) = (m.positions[t[0] as usize], m.positions[t[1] as usize], m.positions[t[2] as usize]);
                        v6 += dot(a, cross(b, c));
                    }
                    assert!((v6 / 6.0 - exact).abs() < 0.01 * exact, "ratio {ratio} defl {defl}: {} vs {exact}", v6 / 6.0);
                }
            }
        }
    }

    #[test]
    fn every_near_miss_still_refuses() {
        let a = part(10.0, 30.0, [0.0; 3]);
        // Tangent (r = R) and near-tangent.
        assert!(boolean("subtract", &a, &tool(10.0, -20.0, 20.0, [0.0; 3])).is_none());
        assert!(boolean("subtract", &a, &tool(9.8, -20.0, 20.0, [0.0; 3])).is_none());
        // Off-centre in the part's cross-section (the axes do not meet), and
        // off-centre along the part's axis is fine but through a cap is not.
        let off = build::cylinder_solid([0.0, 1.0, 0.0], 2.0, 40.0, [1.0, 0.0, 0.0]);
        assert!(boolean("subtract", &a, &off).is_none());
        let cap = build::cylinder_solid([0.0, 0.0, 14.0], 2.0, 40.0, [1.0, 0.0, 0.0]);
        assert!(boolean("subtract", &a, &cap).is_none());
        // Skew: not perpendicular.
        let skew = build::cylinder_solid([0.0; 3], 2.0, 40.0, [1.0, 0.0, 0.3]);
        assert!(boolean("subtract", &a, &skew).is_none());
        // A blind bore whose floor lies in the wall (between sqrt(R^2-r^2) and R),
        // or that stops short of the axis only on the far side beyond the wall.
        assert!(boolean("subtract", &a, &tool(2.0, 9.9, 20.0, [0.0; 3])).is_none());
        // Sealed inside: both ends inside the part (the generic enclosed path
        // owns this shape, and the hole feature refuses it as a sealed cavity).
        assert!(cylinder_cross_bore("subtract", &a, &tool(2.0, -3.0, 3.0, [0.0; 3])).is_none());
        // Union and intersect are not this feature.
        assert!(cylinder_cross_bore("union", &a, &tool(2.0, -20.0, 20.0, [0.0; 3])).is_none());
        assert!(cylinder_cross_bore("intersect", &a, &tool(2.0, -20.0, 20.0, [0.0; 3])).is_none());
    }

    /// Nothing else may touch a pierced solid: the generic face machinery would
    /// read its walls as whole cylinders.
    #[test]
    fn a_pierced_solid_is_not_a_boolean_operand() {
        let a = part(10.0, 30.0, [0.0; 3]);
        let bored = boolean("subtract", &a, &tool(2.0, -20.0, 20.0, [0.0; 3])).unwrap();
        let second = build::cylinder_solid([0.0, 0.0, 8.0], 1.0, 40.0, [0.0, 1.0, 0.0]);
        assert!(boolean("subtract", &bored, &second).is_none());
        assert!(boolean("union", &bored, &second).is_none());
        assert!(boolean("subtract", &second, &bored).is_none());
        assert!(has_cross_trim(&bored) && !has_cross_trim(&a));
    }
}

/// G3: every operation x every surface kind either refuses or is exact.
///
/// One solid per `Surface` variant, each symmetric about the plane x = 0 that
/// contains its axis, so a half-space box (x >= 0) halves it and every closed
/// form is known without trusting the kernel: V/2 for intersect and subtract,
/// V + Vbox - V/2 for union. A silent wrong volume fails; a refusal is recorded
/// and allowed. Adding a Surface variant means adding a row here.
#[cfg(test)]
mod surface_op_table {
    use super::*;
    use std::f64::consts::PI;

    struct Case {
        name: &'static str,
        solid: TSolid,
        volume: f64,
    }

    fn cases() -> Vec<Case> {
        let o = [0.0, 0.0, 0.0];
        let z = [0.0, 0.0, 1.0];
        vec![
            Case { name: "plane (box)", solid: build::box_solid([20.0, 20.0, 20.0], o, None), volume: 8000.0 },
            Case { name: "cylinder", solid: build::cylinder_solid(o, 6.0, 14.0, z), volume: PI * 36.0 * 14.0 },
            Case { name: "cone", solid: build::cone_solid(o, 6.0, 14.0, z), volume: PI * 36.0 * 14.0 / 3.0 },
            Case { name: "sphere", solid: build::sphere_solid(o, 7.0, z), volume: 4.0 / 3.0 * PI * 343.0 },
            Case { name: "torus", solid: build::torus_solid(o, 9.0, 3.0, z), volume: 2.0 * PI * PI * 9.0 * 9.0 },
        ]
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() <= 1e-6 * b.abs().max(1.0)
    }

    /// Outcome of one cell: Ok(true) exact, Ok(false) refused, Err(msg) wrong.
    type Cell = Result<bool, String>;

    fn check_volume(got: Option<TSolid>, want: f64) -> Cell {
        match got {
            None => Ok(false),
            Some(r) => {
                let v = build::solid_volume(&r);
                if near(v, want) && build::signed_volume(&r) > 0.0 {
                    Ok(true)
                } else {
                    Err(format!("volume {v} (signed {}) vs closed form {want}", build::signed_volume(&r)))
                }
            }
        }
    }

    /// S4a: a reflected curved face must keep its outward normal, so the mirrored solid has the
    /// same positive volume, a closed mesh and a mirrored bbox, across every plane.
    #[test]
    fn mirrored_curved_solids_keep_volume_mesh_and_bbox() {
        for c in cases() {
            for axis in 0..3 {
                let mut n = [0.0; 3];
                n[axis] = 1.0;
                let mut through = [0.0; 3];
                through[axis] = 5.0;
                let m = build::transform_solid(&c.solid, &crate::math::Transform::mirror(through, n));
                assert!(near(build::solid_volume(&m), c.volume), "{} axis {axis}: volume {}", c.name, build::solid_volume(&m));
                assert!(build::signed_volume(&m) > 0.0, "{} axis {axis}: inside-out", c.name);
                let mesh = crate::mesh::mesh_solid(&m, 0.05).unwrap_or_else(|| panic!("{} axis {axis}: no mesh", c.name));
                assert!(crate::mesh::mesh_is_closed(&mesh), "{} axis {axis}: open mesh", c.name);
                let (b0, b1) = (build::solid_aabb(&c.solid), build::solid_aabb(&m));
                assert!((b1.lo[axis] - (10.0 - b0.hi[axis])).abs() < 1e-6 && (b1.hi[axis] - (10.0 - b0.lo[axis])).abs() < 1e-6, "{} axis {axis}: bbox", c.name);
            }
        }
    }

    #[test]
    fn every_operation_on_every_surface_refuses_or_is_exact() {
        let big = [60.0, 60.0, 60.0];
        // A half-space tool: x in [0, 30], covering y and z entirely.
        let half = || build::box_solid(big, [30.0, 0.0, 0.0], None);
        let vbox = 60.0 * 60.0 * 60.0;
        let mut wrong: Vec<String> = Vec::new();
        let mut refused: Vec<String> = Vec::new();
        // Cells known to be wrong at the PRIMITIVE, each guarded at a higher layer. Empty since
        // S4a: a reflection now flips a curved surface's e2 and its pcurve u. Kept so a new
        // wrong cell can be recorded here on purpose; each entry must STILL be wrong.
        const KNOWN_WRONG: [&str; 0] = [];
        let mut stale: Vec<String> = Vec::new();
        let mut note = |case: &str, op: &str, cell: Cell| {
            let key = format!("{case} / {op}");
            let known = KNOWN_WRONG.contains(&key.as_str());
            match cell {
                Ok(true) if known => stale.push(key),
                Ok(true) => {}
                Ok(false) => refused.push(key),
                Err(_) if known => {}
                Err(m) => wrong.push(format!("{key}: {m}")),
            }
        };
        for c in cases() {
            let v = c.volume;
            // Boolean against a half-space, both operand orders where it matters.
            note(c.name, "intersect half", check_volume(boolean("intersect", &c.solid, &half()), v / 2.0));
            note(c.name, "subtract half", check_volume(boolean("subtract", &c.solid, &half()), v / 2.0));
            note(c.name, "union half", check_volume(boolean("union", &c.solid, &half()), v + vbox - v / 2.0));
            note(c.name, "half minus solid", check_volume(boolean("subtract", &half(), &c.solid), vbox - v / 2.0));
            // A solid wholly inside a big block: a cavity, which flips every face.
            let block = build::box_solid(big, [0.0, 0.0, 0.0], None);
            note(c.name, "cavity (flip_face)", match boolean("subtract", &block, &c.solid) {
                None => Ok(false),
                Some(r) => {
                    let vol = build::solid_volume(&r);
                    if near(vol, vbox - v) { Ok(true) } else { Err(format!("volume {vol} vs {}", vbox - v)) }
                }
            });
            // Measure and mesh of the bare solid.
            note(c.name, "measure", if near(build::solid_volume(&c.solid), v) { Ok(true) } else { Err(format!("volume {} vs {v}", build::solid_volume(&c.solid))) });
            note(c.name, "mesh", match crate::mesh::mesh_solid(&c.solid, 0.05) {
                None => Ok(false),
                Some(m) => if check_watertight(&m) { Ok(true) } else { Err("mesh not watertight".into()) },
            });
            // A rigid move keeps the volume.
            let moved = build::transform_solid(&c.solid, &crate::math::Transform::translation([5.0, -3.0, 2.0]));
            note(c.name, "translate", check_volume(Some(moved), v));
            // A reflection must come back with its normals still outward.
            let mirrored = build::transform_solid(&c.solid, &crate::math::Transform::mirror([5.0, 0.0, 0.0], [1.0, 0.0, 0.0]));
            note(c.name, "mirror", check_volume(Some(mirrored), v));
            // STEP: a sentence or a document; either way not a panic.
            note(c.name, "step", match crate::step::write_solid(&c.solid, "t") {
                Ok(_) => Ok(true),
                Err(_) => Ok(false),
            });
        }
        eprintln!("surface x op table: refused cells ({}):\n  {}", refused.len(), refused.join("\n  "));
        assert!(wrong.is_empty(), "silently wrong cells:\n  {}", wrong.join("\n  "));
        assert!(stale.is_empty(), "known-wrong cells are now exact, drop them from KNOWN_WRONG:\n  {}", stale.join("\n  "));
    }
}

/// G2: the soundness check no longer abstains on a sphere. Each mutant below is a
/// closed, translation-invariant, meshable solid -- exactly what the older guards
/// wave through -- and each must be refused against the tool it was NOT cut by.
#[cfg(test)]
mod sphere_soundness {
    use super::*;

    fn fixture(r: f64, floor: Option<f64>) -> (TSolid, TSolid) {
        let sphere = build::sphere_solid([0.0, 0.0, 0.0], 10.0, [0.0, 0.0, 1.0]);
        let (len, centre) = match floor {
            None => (40.0, 0.0),
            Some(f) => (30.0 - f, (f + 30.0) / 2.0),
        };
        let tool = build::cylinder_solid([0.0, 0.0, centre], r, len, [0.0, 0.0, 1.0]);
        (sphere, tool)
    }

    #[test]
    fn a_correct_through_and_blind_bore_passes() {
        for floor in [None, Some(2.0)] {
            let (sphere, tool) = fixture(3.0, floor);
            let r = boolean("subtract", &sphere, &tool).expect("a sphere bore builds");
            assert!(boolean_result_is_sound("subtract", &sphere, &tool, &r), "{floor:?}");
        }
    }

    #[test]
    fn a_bore_of_the_wrong_radius_is_refused() {
        let (sphere, tool) = fixture(3.0, None);
        let (_, wrong_tool) = fixture(3.4, None);
        let wrong = boolean("subtract", &sphere, &wrong_tool).expect("the wrong-radius bore still builds");
        assert!(volume_is_translation_invariant(&wrong), "the mutant is a closed solid");
        assert!(!boolean_result_is_sound("subtract", &sphere, &tool, &wrong), "wrong radius slipped through");
    }

    #[test]
    fn a_blind_bore_with_the_wrong_floor_is_refused() {
        let (sphere, tool) = fixture(3.0, Some(2.0));
        let (_, wrong_tool) = fixture(3.0, Some(4.0));
        let wrong = boolean("subtract", &sphere, &wrong_tool).expect("the wrong-floor bore still builds");
        assert!(volume_is_translation_invariant(&wrong), "the mutant is a closed solid");
        assert!(!boolean_result_is_sound("subtract", &sphere, &tool, &wrong), "wrong floor slipped through");
    }

    #[test]
    fn a_result_missing_the_bore_wall_is_refused() {
        let (sphere, tool) = fixture(3.0, None);
        let r = boolean("subtract", &sphere, &tool).expect("a sphere bore builds");
        let faces: Vec<TFace> = r
            .faces()
            .into_iter()
            .filter(|f| !matches!(f.borrow().surface, Surface::Cylinder(_)))
            .collect();
        let gutted = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
        assert!(!boolean_result_is_sound("subtract", &sphere, &tool, &gutted), "a dropped wall slipped through");
    }

    #[test]
    fn a_result_with_the_sphere_zone_dropped_is_refused() {
        let (sphere, tool) = fixture(3.0, None);
        let r = boolean("subtract", &sphere, &tool).expect("a sphere bore builds");
        let faces: Vec<TFace> = r
            .faces()
            .into_iter()
            .filter(|f| !matches!(f.borrow().surface, Surface::Sphere(_)))
            .collect();
        let gutted = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
        assert!(!boolean_result_is_sound("subtract", &sphere, &tool, &gutted), "a dropped zone slipped through");
    }
}

/// G2, torus half: a rounded rim is a quarter torus, and a bore through the flange
/// leaves it untouched in the result. Ray parity now counts a torus, so the check no
/// longer abstains on it; each mutant is closed and meshable but wrong.
#[cfg(test)]
mod torus_soundness {
    use super::*;

    fn flange() -> TSolid {
        build::round_cylinder_one_rim([0.0, 0.0, 0.0], 35.0, 6.0, [0.0, 0.0, 1.0], 3.0, true)
    }

    fn bore(r: f64, x: f64) -> TSolid {
        build::cylinder_solid([x, 0.0, 0.0], r, 6.0, [0.0, 0.0, 1.0])
    }

    #[test]
    fn a_ray_counts_the_torus_band_of_a_rounded_rim() {
        let fl = flange();
        let up = normalize([0.3, 0.2, 1.0]);
        // Straight down at rho 34: in through the rounded corner, out through the flat bottom.
        assert_eq!(crossings(&fl, [34.0, 0.0, 5.0], normalize([0.0, 0.0, -1.0])).map(|c| c.0), Some(2), "torus entry plus bottom exit");
        // The same line at rho 31 meets the flat cap instead of the torus.
        assert_eq!(crossings(&fl, [31.0, 0.0, 5.0], normalize([0.0, 0.0, -1.0])).map(|c| c.0), Some(2), "cap entry plus bottom exit");
        assert_eq!(crossings(&fl, [33.0, 0.0, 2.0], up).map(|c| c.0), Some(1), "from inside the band: one exit");
        assert!(inside_solid(&fl, [34.9, 0.0, 0.5]) && !inside_solid(&fl, [34.6, 0.0, 2.0]));
    }

    #[test]
    fn a_correct_bore_in_a_rounded_flange_passes() {
        let (fl, tool) = (flange(), bore(2.5, 10.0));
        let r = boolean("subtract", &fl, &tool).expect("a bore in a rounded flange builds");
        assert!(boolean_result_is_sound("subtract", &fl, &tool, &r));
    }

    #[test]
    fn a_bore_of_the_wrong_radius_is_refused() {
        let (fl, tool) = (flange(), bore(2.5, 10.0));
        let wrong = boolean("subtract", &fl, &bore(3.1, 10.0)).expect("the wrong bore still builds");
        assert!(volume_is_translation_invariant(&wrong), "the mutant is a closed solid");
        assert!(!boolean_result_is_sound("subtract", &fl, &tool, &wrong), "wrong radius slipped through");
    }

    #[test]
    fn a_result_missing_the_torus_band_is_refused() {
        let (fl, tool) = (flange(), bore(2.5, 10.0));
        let r = boolean("subtract", &fl, &tool).expect("builds");
        let faces: Vec<TFace> = r.faces().into_iter().filter(|f| !matches!(f.borrow().surface, Surface::Torus(_))).collect();
        assert!(faces.len() < r.faces().len(), "the result has a torus face to drop");
        let gutted = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
        assert!(!boolean_result_is_sound("subtract", &fl, &tool, &gutted), "a dropped band slipped through");
    }

    #[test]
    fn a_result_missing_the_bore_wall_is_refused() {
        let (fl, tool) = (flange(), bore(2.5, 10.0));
        let r = boolean("subtract", &fl, &tool).expect("builds");
        let faces: Vec<TFace> = r
            .faces()
            .into_iter()
            .filter(|f| match &f.borrow().surface {
                Surface::Cylinder(c) => c.radius < 3.0,
                _ => true,
            })
            .collect();
        let gutted = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
        assert!(!boolean_result_is_sound("subtract", &fl, &tool, &gutted), "a dropped wall slipped through");
    }

    // G4/G5 (mesh closure after a boolean): the planar and legacy paths can each leave a T-junction.
    fn mesh_closed(s: &TSolid) -> bool {
        let m = crate::mesh::mesh_solid(s, 0.1).expect("meshes");
        crate::mesh::mesh_is_closed(&m)
    }

    #[test]
    fn g5_two_integer_boxes_join_has_a_closed_mesh() {
        let a = build::box_solid([9.0, 10.0, 9.0], [0.0, 0.0, 0.0], None);
        let b = build::box_solid([8.0, 1.0, 9.0], [1.0, 0.0, -1.0], None);
        match boolean("union", &a, &b) {
            None => println!("g5: REFUSED"),
            Some(r) => {
                println!("g5: faces={} vol={} closed={}", r.faces().len(), build::solid_volume(&r), mesh_closed(&r));
                assert!((build::solid_volume(&r) - 822.0).abs() < 1e-6);
                assert!(mesh_closed(&r), "open mesh");
            }
        }
    }

    #[test]
    fn g4_holed_box_then_join_or_cut_has_a_closed_mesh() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let hole = build::cylinder_solid([0.0, 0.0, 0.0], 4.0, 30.0, [0.0, 0.0, 1.0]);
        let a = boolean("subtract", &a, &hole).expect("hole");
        let b = build::box_solid([10.0, 10.0, 10.0], [15.0, 0.0, 8.0], None);
        let c = build::box_solid([50.0, 10.0, 4.0], [0.0, -20.0, 0.0], None);
        for (op, t, vol) in [("union", &b, 31294.69), ("subtract", &c, 30194.69)] {
            match boolean(op, &a, t) {
                None => println!("g4 {op}: REFUSED"),
                Some(r) => {
                    println!("g4 {op}: faces={} vol={} closed={}", r.faces().len(), build::solid_volume(&r), mesh_closed(&r));
                    assert!((build::solid_volume(&r) - vol).abs() < 0.01, "{op} volume");
                    assert!(mesh_closed(&r), "{op}: open mesh");
                }
            }
        }
    }

    #[test]
    fn g5_two_stubs_on_one_face_with_collinear_hole_edges_mesh_closed() {
        // Two stubs whose footprints on the big box's face have left edges on one line: the
        // face's two holes are collinear there, earcut emits a zero-area triangle and the
        // mesh used to lose the edge.
        let a = build::box_solid([2.0, 8.0, 3.0], [-1.0, 4.0, 3.0], None);
        let b = build::box_solid([10.0, 6.0, 10.0], [-1.0, 2.0, 0.0], None);
        let v = boolean("union", &a, &b).expect("v1");
        let p2 = build::box_solid([4.0, 8.0, 3.0], [0.0, 4.0, -3.0], None);
        let r = boolean("union", &v, &p2).expect("builds");
        assert!((build::solid_volume(&r) - 654.0).abs() < 1e-6);
        assert!(mesh_closed(&r), "open mesh");
    }
}

/// Findings G1 and G6 of the wrong-solid sweep (docs/PLAN-next.md section 25): a boolean
/// that built a closed, wrong solid with an empty refusals map.
#[cfg(test)]
mod g1_g6_tests {
    use super::*;
    use crate::build;

    const PI: f64 = std::f64::consts::PI;

    /// G1: the tool's six face-midpoints and six face centroids are inside the sphere, but its
    /// eight corners (distance 10.39 from the centre against a radius of 10) are not. The old
    /// enclosure test looked only at the midpoints and centroids and built a sealed void,
    /// V(sphere) - V(box) = 2460.6, a wrong solid. It must refuse (or build the true boolean).
    #[test]
    fn sphere_minus_box_poking_out_at_the_corners_is_not_a_sealed_void() {
        let a = build::sphere_solid([0.0, 0.0, 0.0], 10.0, [0.0, 0.0, 1.0]);
        let b = build::box_solid([12.0, 12.0, 12.0], [0.0, 0.0, 0.0], None);
        let wrong = 4.0 / 3.0 * PI * 1000.0 - 1728.0;
        if let Some(r) = boolean("subtract", &a, &b) {
            let v = build::solid_volume(&r);
            assert!((v - wrong).abs() > 1.0, "built the sealed-void wrong solid {v}");
        }
    }

    /// A cylinder base and a tool whose corner is barely outside: the smallest G1 case.
    #[test]
    fn cylinder_minus_box_with_one_corner_barely_outside_is_not_a_sealed_void() {
        let a = build::cylinder_solid([0.0, 0.0, 0.0], 10.0, 20.0, [0.0, 0.0, 1.0]);
        // half-diagonal of the 14 x 14 footprint is 9.899; shift it so one corner is at 10.05
        let b = build::box_solid([14.0, 14.0, 6.0], [0.1, 0.1, 0.0], None);
        let wrong = PI * 100.0 * 20.0 - 14.0 * 14.0 * 6.0;
        if let Some(r) = boolean("subtract", &a, &b) {
            let v = build::solid_volume(&r);
            // the true result is one shell (the corner opens the "cavity" to the outside) and its
            // volume exceeds the sealed-void figure by the sliver the corner removes from the wall
            assert!(r.shells.len() == 1 && v > wrong, "built the sealed-void wrong solid {v}");
        }
    }

    /// A tool really inside a curved base is still a sealed void (no regression).
    #[test]
    fn box_well_inside_a_cylinder_is_still_a_sealed_void() {
        let a = build::cylinder_solid([0.0, 0.0, 0.0], 10.0, 20.0, [0.0, 0.0, 1.0]);
        let b = build::box_solid([8.0, 8.0, 6.0], [0.0, 0.0, 0.0], None);
        let r = boolean("subtract", &a, &b).expect("a tool well inside the base is a cavity");
        let v = build::solid_volume(&r);
        let want = PI * 100.0 * 20.0 - 8.0 * 8.0 * 6.0;
        assert!((v - want).abs() <= 1e-6 * want, "{v} vs {want}");
    }

    fn torus_vol(ring: f64, tube: f64) -> f64 {
        2.0 * PI * PI * ring * tube * tube
    }

    /// G6: two tori whose tubes overlap (centre circles about 1.4 apart, tube radii 5 and 5.5)
    /// were treated as disjoint: every probe of each torus is outside the other, so both were
    /// kept whole and the union was two shells with volume V1 + V2. Must refuse, or be the real
    /// union.
    #[test]
    fn overlapping_tori_union_is_not_two_disjoint_shells() {
        let a = build::torus_solid([1.0, 1.0, 10.0], 14.5, 5.5, [0.0, 0.0, 1.0]);
        let b = build::torus_solid([1.0, 0.0, 0.0], 15.0, 5.0, [0.0, 0.0, 1.0]);
        let sum = torus_vol(14.5, 5.5) + torus_vol(15.0, 5.0);
        if let Some(r) = boolean("union", &a, &b) {
            assert!(r.shells.len() == 1 && (build::solid_volume(&r) - sum).abs() > 1.0, "two disjoint shells, volume {}", build::solid_volume(&r));
        }
    }

    /// Overlapping tori, subtract: A must not come back whole.
    #[test]
    fn overlapping_tori_subtract_is_not_a_whole() {
        let a = build::torus_solid([0.0, 0.0, 0.0], 15.0, 5.0, [0.0, 0.0, 1.0]);
        let b = build::torus_solid([2.0, 3.0, 1.0], 15.0, 5.0, [0.0, 0.0, 1.0]);
        if let Some(r) = boolean("subtract", &a, &b) {
            assert!((build::solid_volume(&r) - torus_vol(15.0, 5.0)).abs() > 1.0, "A returned whole");
        }
    }

    /// Genuinely disjoint tori still union as two shells (stacked far apart).
    #[test]
    fn disjoint_tori_union_is_two_shells() {
        let a = build::torus_solid([0.0, 0.0, 0.0], 15.0, 5.0, [0.0, 0.0, 1.0]);
        let b = build::torus_solid([0.0, 0.0, 30.0], 15.0, 5.0, [0.0, 0.0, 1.0]);
        let r = boolean("union", &a, &b).expect("disjoint tori union");
        assert!((build::solid_volume(&r) - 2.0 * torus_vol(15.0, 5.0)).abs() < 1e-6);
    }
}


/// Residuals of the wrong-solid sweep (docs/PLAN-next.md section 27).
#[cfg(test)]
mod residual_tests {
    use super::*;

    fn bx(s: [f64; 3], c: [f64; 3]) -> TSolid {
        build::box_solid(s, c, None)
    }

    fn closed(s: &TSolid) -> bool {
        mesh_is_closed_coarse(s)
    }

    /// Two chains from the grid family whose every step is a box boolean. The planar result had
    /// a vertex on its top and bottom faces (the corner of a notch the intersection removed)
    /// that the +y face, built from the other operand, did not: a T-junction, an open mesh,
    /// and the closure guard refused a correct 3 x 3.5 x 6 box. The edge is now split where its
    /// neighbour has the vertex.
    #[test]
    fn box_chains_ending_in_keep_build_closed() {
        let v = bx([8.0, 10.0, 6.0], [-1.0, 4.0, 2.0]);
        let v = boolean("union", &v, &bx([7.0, 3.0, 10.0], [1.0, 4.0, 0.0])).expect("join");
        let v = boolean("intersect", &v, &bx([3.0, 4.0, 6.0], [-2.0, 1.0, 2.0])).expect("keep 1");
        let r = boolean("intersect", &v, &bx([10.0, 9.0, 8.0], [-3.0, -2.0, 3.0])).expect("keep 2 builds");
        assert!((build::solid_volume(&r) - 63.0).abs() < 1e-9);
        assert!(closed(&r) && !crate::ops_planar::has_t_junction(&r), "open mesh");

        let v = bx([4.0, 6.0, 3.0], [3.0, 0.0, -1.0]);
        let v = boolean("union", &v, &bx([10.0, 3.0, 2.0], [0.0, 1.0, 0.0])).expect("join");
        let v = boolean("subtract", &v, &bx([10.0, 7.0, 8.0], [-2.0, 0.0, -1.0])).expect("cut");
        let r = boolean("intersect", &v, &bx([8.0, 5.0, 9.0], [3.0, -3.0, 0.0])).expect("keep builds");
        assert!((build::solid_volume(&r) - 15.0).abs() < 1e-9);
        assert!(closed(&r) && !crate::ops_planar::has_t_junction(&r), "open mesh");
    }

    /// A hole (or counterbore) whose rim is tangent to the part's side wall touches an edge of
    /// the top face at one point. The rim's polyline had that point and the straight edge did
    /// not, so the mesh had an open seam at some chord tolerances and not at others.
    #[test]
    fn counterbore_tangent_to_the_side_wall_meshes_closed_at_every_tolerance() {
        let a = bx([31.0, 31.0, 28.0], [0.0, 0.0, 0.0]);
        let cb = build::cylinder_solid([-8.0, 2.0, 13.0], 7.5, 4.0, [0.0, 0.0, 1.0]);
        let r = boolean("subtract", &a, &cb).expect("counterbore builds");
        for defl in [0.2, 0.1, 0.07, 0.05, 0.02] {
            let m = crate::mesh::mesh_solid(&r, defl).expect("meshes");
            assert!(crate::mesh::mesh_is_closed(&m), "open mesh at chord tolerance {defl}");
        }
    }

    /// A flat face whose outline carries arcs (here: a tool that only touches the part's bottom
    /// face with a disc, splitting that face along the disc's circle) must survive a mirror. The
    /// reflected arc kept its old normal, so it ran the other way round the circle, its endpoints
    /// no longer matched and the mesh was empty although the volume was right (perm#11509 seed 2).
    #[test]
    fn mirrored_face_with_arc_edges_meshes_closed_with_the_same_volume() {
        let a = build::prism_solid([-3.48, 2.17, -3.35], 6, 24.21, 31.97, [0.0, 0.0, 1.0]);
        let t = build::cylinder_solid([-12.93, 6.44, -27.05], 18.865, 15.43, [0.0, 0.0, 1.0]);
        let r = boolean("subtract", &a, &t).expect("touching cut builds");
        assert!(r.faces().iter().any(|f| f.borrow().boundary.iter().any(|w| w.borrow().edges.iter().any(|u| matches!(u.edge.borrow().curve, Curve::Arc { .. })))), "the fixture must carry an arc");
        let bb = build::solid_aabb(&r);
        let m = crate::math::Transform::mirror([0.0, bb.hi[1], 0.0], [0.0, 1.0, 0.0]);
        let fl = build::transform_solid(&r, &m);
        let mesh = crate::mesh::mesh_solid(&fl, 0.1).expect("the mirrored copy meshes");
        assert!(crate::mesh::mesh_is_closed(&mesh), "open mesh");
        assert!((build::solid_volume(&fl) - build::solid_volume(&r)).abs() < 1e-6);
    }

    /// A straight edge with another face's vertex in its middle becomes two edges; nothing else moves.
    #[test]
    fn split_t_junctions_splits_only_where_a_neighbour_has_the_vertex() {
        let b = bx([4.0, 4.0, 4.0], [0.0, 0.0, 0.0]);
        let mut faces = b.faces();
        let n = edge_use_counts(&faces).len();
        assert!(!split_t_junctions(&mut faces), "a plain box has no T-junction");
        assert_eq!(edge_use_counts(&faces).len(), n);
    }

    /// Area of the rectangle centred `c` with half-sizes `half`, inside the disk of radius `r`.
    fn overlap_area(half: [f64; 2], c: [f64; 2], r: f64) -> f64 {
        let (a, b) = (c[0] - half[0], c[0] + half[0]);
        let n = 400_000;
        let mut s = 0.0;
        for i in 0..n {
            let x = a + (i as f64 + 0.5) * (b - a) / n as f64;
            let h = (r * r - x * x).max(0.0).sqrt();
            s += ((c[1] + half[1]).min(h) - (c[1] - half[1]).max(-h)).max(0.0);
        }
        s * (b - a) / n as f64
    }

    /// G1 note: a tool whose corner or edge is barely outside a cylinder must build the true cut
    /// (closed form: V(cylinder) - height x area of the footprint inside the disk) or refuse.
    #[test]
    fn cylinder_minus_box_barely_poking_out_matches_the_closed_form() {
        let pi = std::f64::consts::PI;
        for (w, off) in [(14.0, 0.1), (14.0, 0.5), (14.1422, 0.0), (14.1434, 0.0), (14.15, 0.0), (9.0, 5.49), (9.0, 5.51), (4.0, 7.9), (4.0, 8.05)] {
            let a = build::cylinder_solid([0.0, 0.0, 0.0], 10.0, 20.0, [0.0, 0.0, 1.0]);
            let b = bx([w, w, 6.0], [off, off, 0.0]);
            let exact = pi * 100.0 * 20.0 - 6.0 * overlap_area([w / 2.0, w / 2.0], [off, off], 10.0);
            if let Some(r) = boolean("subtract", &a, &b) {
                let v = build::solid_volume(&r);
                assert!((v - exact).abs() < 1e-5 * exact, "w={w} off={off}: {v} vs {exact}");
            }
        }
    }
}
